"""The engine: signals -> beliefs -> decisions, for 1 customer or for the whole population with the same SQL."""
from __future__ import annotations

import json
import time
from typing import Any

import yaml

from . import config
from .db import DB, ensure_app_tables
from .dsl import Moment, compile_hits, twin_sql

ACTIVE_STATES = ("act", "ask", "advisor")


def load_builtin() -> dict[str, Moment]:
    out: dict[str, Moment] = {}
    for path in sorted(config.MOMENTS_DIR.glob("*.yaml")):
        m = Moment.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
        out[m.id] = m
    return out


def _k(n: int | None) -> int | str | None:
    """Hide small counts from aggregate views (k-anonymity)."""
    if n is None:
        return None
    return n if n == 0 or n >= config.K_ANON else f"<{config.K_ANON}"


class Engine:
    def __init__(self, db: DB):
        self.db = db
        self.builtin = load_builtin()
        ensure_app_tables(db)
        self.sync_runtime()
        if not (db.table_exists("twin") and db.table_exists("signal_hits")):
            self.run_population()

    # ------------------------------------------------------------ moment registry
    def custom(self) -> dict[str, Moment]:
        rows = self.db.rows("SELECT definition FROM custom_moments ORDER BY created_at")
        ms = [Moment.model_validate_json(r["definition"]) for r in rows]
        return {m.id: m for m in ms}

    def moments(self) -> dict[str, Moment]:
        return {**self.builtin, **self.custom()}

    def sync_runtime(self) -> None:
        with self.db.lock:
            self.db.execute(
                "CREATE OR REPLACE TABLE moments_rt (moment_id VARCHAR, ask_t DOUBLE, act_t DOUBLE, "
                "priority INTEGER, min_age INTEGER, vulnerable_policy VARCHAR)"
            )
            for m in self.moments().values():
                self.db.execute(
                    "INSERT INTO moments_rt VALUES ($id, $ask, $act, $prio, $age, $vuln)",
                    {"id": m.id, "ask": m.thresholds.ask, "act": m.thresholds.act, "prio": m.priority,
                     "age": m.guardrails.min_age, "vuln": m.guardrails.vulnerable},
                )

    def add_custom(self, m: Moment, created_by: str) -> None:
        with self.db.lock:
            if m.id in self.moments():
                raise ValueError(f"a moment with id '{m.id}' already exists")
            if len(self.custom()) >= config.MAX_CUSTOM_MOMENTS:
                raise ValueError("too many custom moments")
            self.db.execute(
                "INSERT INTO custom_moments (moment_id, definition, created_by) VALUES ($id, $def, $by)",
                {"id": m.id, "def": m.model_dump_json(), "by": created_by},
            )
            self.sync_runtime()

    def delete_custom(self, moment_id: str) -> bool:
        with self.db.lock:
            if moment_id not in self.custom():
                return False
            self.db.execute("DELETE FROM custom_moments WHERE moment_id = $id", {"id": moment_id})
            self.db.execute("DELETE FROM twin WHERE moment_id = $id", {"id": moment_id})
            self.db.execute("DELETE FROM signal_hits WHERE moment_id = $id", {"id": moment_id})
            self.sync_runtime()
            return True

    # ------------------------------------------------------------ computation
    def _params(self, extra: dict | None = None) -> dict:
        p = {"now": config.SIM_NOW, "max_active": config.MAX_ACTIVE}
        p.update(extra or {})
        return p

    def run_population(self) -> dict:
        t0 = time.perf_counter()
        moments = list(self.moments().values())
        hits_sql, params = compile_hits(moments, customer_filter=False)
        params.update(self._params())
        with self.db.lock:
            self.sync_runtime()
            self.db.execute(f"CREATE OR REPLACE TABLE signal_hits AS {hits_sql}", params)
            self.db.execute(f"CREATE OR REPLACE TABLE twin AS {twin_sql('signal_hits', False)}", params)
            run_ms = int((time.perf_counter() - t0) * 1000)
            stats = self.stats(run_ms)
            run_id = (self.db.scalar("SELECT max(run_id) FROM runs") or 0) + 1
            self.db.execute("INSERT INTO runs (run_id, stats) VALUES ($id, $s)", {"id": run_id, "s": json.dumps(stats)})
        return stats

    def refresh_customer(self, customer_id: int) -> None:
        """Recompute one customer after feedback/consent changes. Same SQL as the population run."""
        moments = list(self.moments().values())
        hits_sql, params = compile_hits(moments, customer_filter=True)
        params.update(self._params({"cid": customer_id}))
        own_hits = "(SELECT * FROM signal_hits WHERE customer_id = $cid)"
        with self.db.lock:
            self.db.execute("DELETE FROM signal_hits WHERE customer_id = $cid", {"cid": customer_id})
            self.db.execute(f"INSERT INTO signal_hits BY NAME {hits_sql}", params)
            self.db.execute("DELETE FROM twin WHERE customer_id = $cid", {"cid": customer_id})
            self.db.execute(f"INSERT INTO twin BY NAME {twin_sql(own_hits, True)}", params)

    # ------------------------------------------------------------ reads
    def customer_rows(self, customer_id: int) -> tuple[list[dict], list[dict]]:
        twin = self.db.rows(
            "SELECT moment_id, confidence, inferred, feedback, state, priority, ask_t, act_t "
            "FROM twin WHERE customer_id = $cid ORDER BY confidence DESC, priority DESC",
            {"cid": customer_id},
        )
        hits = self.db.rows(
            "SELECT moment_id, signal_id, source, weight, n, last_seen FROM signal_hits "
            "WHERE customer_id = $cid ORDER BY weight DESC",
            {"cid": customer_id},
        )
        return twin, hits

    def beliefs(self, customer_id: int, lang: str) -> list[dict[str, Any]]:
        moments = self.moments()
        twin, hits = self.customer_rows(customer_id)
        out = []
        for row in twin:
            m = moments.get(row["moment_id"])
            if not m:
                continue
            sigs = {s.id: s for s in m.signals}
            evidence = [
                {
                    "signal_id": h["signal_id"],
                    "label": sigs[h["signal_id"]].label.get(lang),
                    "source": h["source"],
                    "weight": h["weight"],
                    "count": int(h["n"]),
                    "last_seen": h["last_seen"].isoformat() if h["last_seen"] else None,
                }
                for h in hits
                if h["moment_id"] == m.id and h["signal_id"] in sigs
            ]
            out.append(
                {
                    "moment_id": m.id,
                    "title": m.title.get(lang),
                    "category": m.category,
                    "confidence": round(float(row["confidence"]), 3),
                    "inferred": round(float(row["inferred"]), 3),
                    "feedback": row["feedback"],
                    "state": row["state"],
                    "thresholds": {"ask": row["ask_t"], "act": row["act_t"]},
                    "evidence": evidence if row["feedback"] != "rejected" else [],
                }
            )
        return out

    # ------------------------------------------------------------ aggregate stats (product owner view: no PII)
    def stats(self, run_ms: int) -> dict:
        top = self.db.one(
            """SELECT
                 (SELECT count(*) FROM customers) AS customers,
                 (SELECT count(*) FROM events) AS events,
                 (SELECT count(*) FROM signal_hits WHERE source <> 'profile') AS signal_hits,
                 (SELECT count(*) FROM customers WHERE NOT consent_transactions) AS opted_out_transactions,
                 (SELECT count(*) FROM customers WHERE NOT consent_app) AS opted_out_app,
                 (SELECT count(*) FROM twin) AS beliefs,
                 (SELECT count(*) FROM twin WHERE state <> 'wait') AS moments,
                 (SELECT count(DISTINCT customer_id) FROM twin WHERE state IN ('act','ask')) AS customers_reached,
                 (SELECT count(*) FROM twin WHERE state IN ('act','ask','advisor')) AS messages"""
        )
        states = {r["state"]: int(r["n"]) for r in self.db.rows("SELECT state, count(*) AS n FROM twin GROUP BY state")}
        per = self.db.rows(
            """WITH det AS (SELECT customer_id, moment_id, inferred >= act_t AS strong FROM twin WHERE inferred >= ask_t),
               tp AS (SELECT d.moment_id, count(*) AS n, count(*) FILTER (WHERE d.strong) AS n_strong FROM det d
                      JOIN truth t ON t.customer_id = d.customer_id AND t.moment_id = d.moment_id GROUP BY 1),
               dn AS (SELECT moment_id, count(*) AS n, count(*) FILTER (WHERE strong) AS n_strong FROM det GROUP BY 1),
               tn AS (SELECT moment_id, count(*) AS n FROM truth GROUP BY 1),
               st AS (SELECT moment_id,
                        count(*) FILTER (WHERE state = 'act') AS act,
                        count(*) FILTER (WHERE state = 'ask') AS ask,
                        count(*) FILTER (WHERE state = 'advisor') AS advisor,
                        count(*) FILTER (WHERE state = 'deferred_fatigue') AS deferred,
                        count(*) FILTER (WHERE state = 'blocked_guardrail') AS blocked,
                        count(*) FILTER (WHERE state = 'suppressed_feedback') AS rejected_by_customer
                      FROM twin GROUP BY 1)
               SELECT m.moment_id, m.priority,
                      coalesce(st.act, 0) AS act, coalesce(st.ask, 0) AS ask, coalesce(st.advisor, 0) AS advisor,
                      coalesce(st.deferred, 0) AS deferred, coalesce(st.blocked, 0) AS blocked,
                      coalesce(st.rejected_by_customer, 0) AS rejected_by_customer,
                      coalesce(dn.n, 0) AS detected, coalesce(tp.n, 0) AS true_positives, coalesce(tn.n, 0) AS planted,
                      coalesce(dn.n_strong, 0) AS detected_strong, coalesce(tp.n_strong, 0) AS true_positives_strong
               FROM moments_rt m
               LEFT JOIN st ON st.moment_id = m.moment_id LEFT JOIN dn ON dn.moment_id = m.moment_id
               LEFT JOIN tp ON tp.moment_id = m.moment_id LEFT JOIN tn ON tn.moment_id = m.moment_id
               ORDER BY m.priority DESC"""
        )
        moments = self.moments()
        per_moment = []
        for r in per:
            det, tp, planted = int(r["detected"]), int(r["true_positives"]), int(r["planted"])
            det_s, tp_s = int(r["detected_strong"]), int(r["true_positives_strong"])
            per_moment.append(
                {
                    "moment_id": r["moment_id"],
                    "title": moments[r["moment_id"]].title.en if r["moment_id"] in moments else r["moment_id"],
                    "custom": r["moment_id"] not in self.builtin,
                    "act": _k(int(r["act"])), "ask": _k(int(r["ask"])), "advisor": _k(int(r["advisor"])),
                    "deferred": _k(int(r["deferred"])), "blocked": _k(int(r["blocked"])),
                    "rejected_by_customer": _k(int(r["rejected_by_customer"])),
                    "reach": _k(int(r["act"]) + int(r["ask"])),
                    "precision": round(tp / det, 3) if det >= config.K_ANON and planted else None,
                    "recall": round(tp / planted, 3) if planted >= config.K_ANON else None,
                    # how often the engine is right when it is confident enough to act without asking
                    "precision_act": round(tp_s / det_s, 3) if det_s >= config.K_ANON and planted else None,
                }
            )
        customers = int(top["customers"])
        messages = int(top["messages"])
        factor = config.TARGET_CUSTOMERS / customers if customers else 0
        at_target_messages = round(messages * factor)
        tokens = at_target_messages * config.AVG_TOKENS_PER_MESSAGE
        return {
            "run_ms": run_ms,
            "customers": customers,
            "events": int(top["events"]),
            "signal_hits": int(top["signal_hits"]),
            "beliefs": int(top["beliefs"]),
            "moments": int(top["moments"]),
            "customers_reached": int(top["customers_reached"]),
            "messages_to_write": messages,
            "ai_share_of_customers": round(messages / customers, 4) if customers else 0,
            "opted_out": {"transactions": int(top["opted_out_transactions"]), "app": int(top["opted_out_app"])},
            "states": {k: _k(v) for k, v in sorted(states.items())},
            "per_moment": per_moment,
            "scale": {
                "target_customers": config.TARGET_CUSTOMERS,
                "method": "linear extrapolation of this run",
                "messages": at_target_messages,
                "tokens": tokens,
                "avg_tokens_per_message": config.AVG_TOKENS_PER_MESSAGE,
                "eur": round(tokens / 1000 * config.LLM_EUR_PER_1K_TOKENS, 2) if config.LLM_EUR_PER_1K_TOKENS else None,
            },
        }

    def last_stats(self) -> dict | None:
        row = self.db.one("SELECT stats FROM runs ORDER BY run_id DESC LIMIT 1")
        return json.loads(row["stats"]) if row else None
