"""The engine: signals -> beliefs -> decisions, for 1 customer or for the whole population with the same SQL."""
from __future__ import annotations

import itertools
import json
import time
from datetime import date, timedelta
from typing import Any

import yaml

from . import config
from .db import DB, ensure_app_tables
from .dsl import Moment, compile_hits, twin_sql
from .explain import (CHANNELS_BY_STATE, CONTRIBUTIONS_SQL, CUSTOMER_GATE, TIMELINE_SQL, WhatIfIn, split_key)

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


def _coarse(n: int | None) -> int | str | None:
    """Sensitive cells: below K_ANON hidden, everything else rounded to a multiple of 5 so differencing reveals nothing."""
    if n is None:
        return None
    if n == 0:
        return 0
    if n < config.K_ANON:
        return f"<{config.K_ANON}"
    return 5 * ((n + 2) // 5)


COARSE_STATES = ("advisor", "deferred_fatigue", "blocked_guardrail", "suppressed_feedback")


class Engine:
    def __init__(self, db: DB):
        self.db = db
        self.builtin = load_builtin()
        ensure_app_tables(db)
        self.sync_runtime()
        if not (db.table_exists("twin") and db.table_exists("signal_hits")) or not self._twin_has_gate():
            self.run_population()

    def _twin_has_gate(self) -> bool:
        return bool(self.db.scalar(
            "SELECT count(*) FROM information_schema.columns WHERE table_name = 'twin' AND column_name = 'gate'"
        ))

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
            self.db.execute("DELETE FROM feedback WHERE moment_id = $id", {"id": moment_id})
            self.db.execute("DELETE FROM message_cache WHERE moment_id = $id", {"id": moment_id})
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
            t1 = time.perf_counter()
            self.db.execute(f"CREATE OR REPLACE TABLE signal_hits AS {hits_sql}", params)
            t2 = time.perf_counter()
            self.db.execute(f"CREATE OR REPLACE TABLE twin AS {twin_sql('signal_hits', False)}", params)
            t3 = time.perf_counter()
            run_ms = int((t3 - t0) * 1000)
            stats = self.stats(run_ms)
            stats["timings"] = {"hits_ms": int((t2 - t1) * 1000), "twin_ms": int((t3 - t2) * 1000),
                                "stats_ms": int((time.perf_counter() - t3) * 1000)}
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
                    "act": _k(int(r["act"])), "ask": _k(int(r["ask"])), "advisor": _coarse(int(r["advisor"])),
                    "deferred": _coarse(int(r["deferred"])), "blocked": _coarse(int(r["blocked"])),
                    "rejected_by_customer": _coarse(int(r["rejected_by_customer"])),
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
            "moments": 5 * ((int(top["moments"]) + 2) // 5),
            "customers_reached": int(top["customers_reached"]),
            "messages_to_write": 5 * ((messages + 2) // 5),
            "ai_share_of_customers": round(5 * ((messages + 2) // 5) / customers, 4) if customers else 0,
            "opted_out": {"transactions": int(top["opted_out_transactions"]), "app": int(top["opted_out_app"])},
            "states": self._public_states(states, per_moment),
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

    @staticmethod
    def _public_states(states: dict[str, int], per_moment: list[dict[str, Any]]) -> dict[str, int | str | None]:
        cell = {"advisor": "advisor", "deferred_fatigue": "deferred", "blocked_guardrail": "blocked",
                "suppressed_feedback": "rejected_by_customer"}
        out: dict[str, int | str | None] = {}
        for k, v in sorted(states.items()):
            if k not in COARSE_STATES:
                out[k] = _k(v)
                continue
            cells = [pm[cell[k]] for pm in per_moment]
            total = sum(c for c in cells if isinstance(c, int)) + 5 * sum(1 for c in cells if isinstance(c, str))
            out[k] = total if total >= config.K_ANON or total == 0 else f"<{config.K_ANON}"
        return out

    def last_stats(self) -> dict | None:
        row = self.db.one("SELECT stats FROM runs ORDER BY run_id DESC LIMIT 1")
        return json.loads(row["stats"]) if row else None

    # ------------------------------------------------------------ explain: what-if, theater, why-not (read-only)
    def _customer_row(self, cid: int) -> dict[str, Any]:
        row = self.db.one(
            "SELECT customer_id, age, region, household_size, vulnerable, consent_transactions, consent_app, language "
            "FROM customers WHERE customer_id = $cid", {"cid": cid})
        if row is None:
            raise LookupError("unknown customer")
        return row

    def _validate_keys(self, wi: WhatIfIn) -> dict[str, Moment]:
        moments = self.moments()
        for key in [*wi.signals_off, *wi.signals_on, *wi.weights]:
            mid, sid = split_key(key)
            if mid not in moments or sid not in {s.id for s in moments[mid].signals}:
                raise ValueError(f"unknown signal {key}")
        for mid in [*wi.feedback, *wi.thresholds, *wi.guardrails]:
            if mid not in moments:
                raise ValueError(f"unknown moment {mid}")
        return moments

    @staticmethod
    def _sig_state(m: Moment, sig_weight: float | None, hit: dict[str, Any] | None, forced: str | None,
                   consents: dict[str, bool], sid: str, lang: str) -> dict[str, Any]:
        s = next(x for x in m.signals if x.id == sid)
        return {
            "key": f"{m.id}.{s.id}", "signal_id": s.id, "label": s.label.get(lang), "source": s.source,
            "weight": round(float(sig_weight if sig_weight is not None else s.weight), 4),
            "hit": hit is not None, "n": int(hit["n"]) if hit else 0,
            "last_seen": hit["last_seen"].isoformat() if hit and hit["last_seen"] else None,
            "cumulative": round(float(hit["cumulative"]), 4) if hit else None,
            "without_this": round(float(hit["without_this"]), 4) if hit else None,
            "forced": forced, "consent_off": s.source != "profile" and not consents[s.source],
        }

    def _scenario(self, twin: list[dict[str, Any]], contrib: list[dict[str, Any]], moments: dict[str, Moment],
                  consents: dict[str, bool], lang: str, as_of: str, max_active: int, audience: str,
                  weights: dict[str, float], off: set[str], on: set[str]) -> dict[str, Any]:
        by_moment: dict[str, dict[str, dict[str, Any]]] = {}
        for c in contrib:
            by_moment.setdefault(c["moment_id"], {})[c["signal_id"]] = c
        beliefs = []
        for row in sorted(twin, key=lambda r: (-float(r["confidence"]), -int(r["priority"]), r["moment_id"])):
            m = moments.get(row["moment_id"])
            if m is None:
                continue
            hits = by_moment.get(m.id, {})
            sigs = []
            for sig in m.signals:
                key = f"{m.id}.{sig.id}"
                forced = "off" if key in off else ("on" if key in on else None)
                sigs.append(self._sig_state(m, weights.get(key), hits.get(sig.id), forced, consents, sig.id, lang))
            gate = row["gate"]
            if audience == "customer":
                gate = CUSTOMER_GATE.get(gate, gate)
            active = row["state"] in ("act", "ask", "deferred_fatigue")
            beliefs.append({
                "moment_id": m.id, "title": m.title.get(lang), "category": m.category, "priority": m.priority,
                "inferred": round(float(row["inferred"]), 4), "confidence": round(float(row["confidence"]), 4),
                "feedback": row["feedback"], "state": row["state"], "gate": gate,
                "thresholds": {"ask": row["ask_t"], "act": row["act_t"]},
                "rank": int(row["rk"]) if active and row["rk"] is not None else None,
                "score": round(float(row["score"]), 4), "signals": sigs,
            })
        return {"as_of": as_of, "max_active": max_active, "consents": dict(consents), "beliefs": beliefs}

    def stored_scenario(self, cid: int, audience: str = "customer") -> dict[str, Any]:
        cust = self._customer_row(cid)
        moments = self.moments()
        twin = self.db.rows(
            "SELECT moment_id, confidence, inferred, feedback, priority, ask_t, act_t, state, gate, rk, score "
            "FROM twin WHERE customer_id = $cid", {"cid": cid})
        contrib = self.db.rows(
            CONTRIBUTIONS_SQL.format(hits="SELECT * FROM signal_hits WHERE customer_id = $cid"), {"cid": cid})
        consents = {"transactions": bool(cust["consent_transactions"]), "app": bool(cust["consent_app"])}
        return self._scenario(twin, contrib, moments, consents, cust["language"], config.SIM_NOW, config.MAX_ACTIVE,
                              audience, {}, set(), set())

    def simulate(self, cid: int, wi: WhatIfIn | None = None, *, as_of: date | None = None,
                 use_feedback: bool = True, audience: str = "customer") -> dict[str, Any]:
        """Pure read: the same SQL as the population run over in-memory copies of the rules. Never writes."""
        wi = wi or WhatIfIn()
        moments = self._validate_keys(wi)
        cust = self._customer_row(cid)
        lang = cust["language"]
        sim_now = date.fromisoformat(config.SIM_NOW)
        now = as_of or wi.as_of or sim_now
        if now > sim_now or now < sim_now - timedelta(days=180):
            raise ValueError("as_of out of range")
        ov = wi.consents
        consents = {
            "transactions": bool(cust["consent_transactions"]) and not (ov is not None and ov.transactions is False),
            "app": bool(cust["consent_app"]) and not (ov is not None and ov.app is False),
        }
        off, on = set(wi.signals_off), set(wi.signals_on)
        mods: list[Moment] = []
        rt_rows: list[tuple[str, float, float, int, int, str]] = []
        for m in moments.values():
            sigs = [s.model_copy(update={"weight": wi.weights.get(f"{m.id}.{s.id}", s.weight)})
                    for s in m.signals if f"{m.id}.{s.id}" not in off]
            mods.append(m.model_copy(update={"signals": sigs}))
            th = wi.thresholds.get(m.id)
            g = wi.guardrails.get(m.id)
            rt_rows.append((m.id, th.ask if th else m.thresholds.ask, th.act if th else m.thresholds.act, m.priority,
                            g.min_age if g and g.min_age is not None else m.guardrails.min_age,
                            g.vulnerable if g and g.vulnerable is not None else m.guardrails.vulnerable))
        params: dict[str, Any] = {
            "cid": cid, "now": now.isoformat(), "max_active": wi.max_active or config.MAX_ACTIVE,
            "ov_age": cust["age"], "ov_region": cust["region"], "ov_hh": cust["household_size"],
            "ov_v": bool(cust["vulnerable"]) if wi.care_flag is None else wi.care_flag,
            "ov_ct": consents["transactions"], "ov_ca": consents["app"],
        }
        cust_rel = ("(SELECT CAST($cid AS INTEGER) AS customer_id, CAST($ov_age AS INTEGER) AS age, "
                    "CAST($ov_region AS VARCHAR) AS region, CAST($ov_hh AS INTEGER) AS household_size, "
                    "CAST($ov_v AS BOOLEAN) AS vulnerable, CAST($ov_ct AS BOOLEAN) AS consent_transactions, "
                    "CAST($ov_ca AS BOOLEAN) AS consent_app)")
        hits_sql, hp = compile_hits(mods, True, customers=cust_rel)
        params.update(hp)
        if on:
            have = {(r["moment_id"], r["signal_id"])
                    for r in self.db.rows(f"SELECT moment_id, signal_id FROM ({hits_sql})", params)}
            parts: list[str] = []
            for i, key in enumerate(sorted(on)):
                mid, sid = split_key(key)
                sig = next(x for x in moments[mid].signals if x.id == sid)
                if sig.source == "profile":
                    raise ValueError("profile signals cannot be added")
                if not consents[sig.source] or (mid, sid) in have:
                    continue
                w = wi.weights.get(key, sig.weight)
                params.update({f"vm{i}": mid, f"vs{i}": sid, f"vsrc{i}": sig.source, f"vw{i}": float(w),
                               f"vn{i}": int(sig.min_count), f"vd{i}": now.isoformat()})
                parts.append(f"SELECT CAST($cid AS INTEGER) AS customer_id, CAST($vm{i} AS VARCHAR) AS moment_id, "
                             f"CAST($vs{i} AS VARCHAR) AS signal_id, CAST($vsrc{i} AS VARCHAR) AS source, "
                             f"CAST($vw{i} AS DOUBLE) AS weight, CAST($vn{i} AS BIGINT) AS n, "
                             f"CAST($vd{i} AS DATE) AS last_seen")
            if parts:
                hits_sql = hits_sql + "\nUNION ALL\n" + "\nUNION ALL\n".join(parts)
        fb: dict[str, str] = {}
        if use_feedback:
            fb = {r["moment_id"]: r["status"] for r in self.db.rows(
                "SELECT moment_id, status FROM feedback WHERE customer_id = $cid", {"cid": cid})}
        for mid, status in wi.feedback.items():
            if status == "clear":
                fb.pop(mid, None)
            else:
                fb[mid] = status
        if fb:
            fvals = []
            for i, (mid, status) in enumerate(sorted(fb.items())):
                params.update({f"fm{i}": mid, f"fs{i}": status})
                fvals.append(f"(CAST($fm{i} AS VARCHAR), CAST($fs{i} AS VARCHAR))")
            fb_rel = f"(SELECT CAST($cid AS INTEGER) AS customer_id, * FROM (VALUES {', '.join(fvals)}) t(moment_id, status))"
        else:
            fb_rel = ("(SELECT CAST(NULL AS INTEGER) AS customer_id, CAST(NULL AS VARCHAR) AS moment_id, "
                      "CAST(NULL AS VARCHAR) AS status WHERE false)")
        rvals = []
        for i, (mid, ask, act, prio, min_age, pol) in enumerate(rt_rows):
            params.update({f"rm{i}": mid, f"ra{i}": ask, f"rt{i}": act, f"rp{i}": prio, f"rg{i}": min_age, f"rv{i}": pol})
            rvals.append(f"(CAST($rm{i} AS VARCHAR), CAST($ra{i} AS DOUBLE), CAST($rt{i} AS DOUBLE), "
                         f"CAST($rp{i} AS INTEGER), CAST($rg{i} AS INTEGER), CAST($rv{i} AS VARCHAR))")
        mom_rel = ("(SELECT * FROM (VALUES " + ", ".join(rvals) +
                   ") t(moment_id, ask_t, act_t, priority, min_age, vulnerable_policy))")
        twin = self.db.rows(
            "SELECT moment_id, confidence, inferred, feedback, priority, ask_t, act_t, state, gate, rk, score FROM ("
            + twin_sql(f"({hits_sql})", True, feedback=fb_rel, customers=cust_rel, moments=mom_rel) + ")", params)
        contrib = self.db.rows(CONTRIBUTIONS_SQL.format(hits=hits_sql), params)
        weights = {k: float(v) for k, v in wi.weights.items()}
        return self._scenario(twin, contrib, moments, consents, lang, now.isoformat(), int(params["max_active"]),
                              audience, weights, off, on)

    @staticmethod
    def _changes(base: dict[str, Any], scen: dict[str, Any]) -> list[dict[str, Any]]:
        b = {x["moment_id"]: x for x in base["beliefs"]}
        s = {x["moment_id"]: x for x in scen["beliefs"]}
        out = []
        for mid in [*b, *(k for k in s if k not in b)]:
            x, y = b.get(mid), s.get(mid)
            fs, ts = (x["state"] if x else None), (y["state"] if y else None)
            fc, tc = (x["confidence"] if x else 0.0), (y["confidence"] if y else 0.0)
            if fs != ts or abs(fc - tc) >= 0.0005:
                out.append({"moment_id": mid, "from_state": fs, "to_state": ts, "from_conf": fc, "to_conf": tc})
        return out

    @staticmethod
    def _same(a: dict[str, Any], b: dict[str, Any]) -> bool:
        def sig(sc: dict[str, Any]) -> list[tuple[str, str, float]]:
            return sorted((x["moment_id"], x["state"], round(x["confidence"], 3)) for x in sc["beliefs"])
        return sig(a) == sig(b)

    def whatif(self, cid: int, wi: WhatIfIn, audience: str = "customer") -> dict[str, Any]:
        baseline = self.stored_scenario(cid, audience)
        scenario = self.simulate(cid, wi, audience=audience)
        plain = self.simulate(cid, WhatIfIn(), audience=audience)
        return {
            "baseline": baseline, "scenario": scenario, "effective_consents": scenario["consents"],
            "changes": self._changes(baseline, scenario), "matches_stored": self._same(plain, baseline),
        }

    @staticmethod
    def _relevant_pairs(moments: dict[str, Moment], consents: dict[str, bool]) -> dict[tuple[str, str], list[tuple[str, Any]]]:
        pairs: dict[tuple[str, str], list[tuple[str, Any]]] = {}
        for m in moments.values():
            for s in m.signals:
                if s.source != "profile" and consents[s.source] and s.kind:
                    pairs.setdefault((s.source, s.kind), []).append((f"{m.id}.{s.id}", s))
        return pairs

    def _customer_events(self, cid: int, pairs: list[tuple[str, str]], now: str) -> list[dict[str, Any]]:
        if not pairs:
            return []
        params: dict[str, Any] = {"cid": cid, "now": now}
        conds = []
        for i, (src, kind) in enumerate(pairs):
            params.update({f"es{i}": src, f"ek{i}": kind})
            conds.append(f"(source = $es{i} AND kind = $ek{i})")
        return self.db.rows(TIMELINE_SQL.format(pairs=" OR ".join(conds)), params)

    def theater(self, cid: int, audience: str = "customer") -> dict[str, Any]:
        cust = self._customer_row(cid)
        consents = {"transactions": bool(cust["consent_transactions"]), "app": bool(cust["consent_app"])}
        moments = self.moments()
        pairs = self._relevant_pairs(moments, consents)
        raw = self._customer_events(cid, list(pairs), config.SIM_NOW)
        allowed_sources = [k for k, v in consents.items() if v]
        allowed = 0
        if allowed_sources:
            allowed = int(self.db.scalar(
                "SELECT count(*) FROM events WHERE customer_id = $cid AND ts <= CAST($now AS DATE) "
                "AND list_contains($srcs, source)",
                {"cid": cid, "now": config.SIM_NOW, "srcs": allowed_sources}) or 0)
        events = []
        for i, e in enumerate(raw):
            amount = None if audience == "advisor" or e["amount"] is None else float(e["amount"])
            events.append({
                "i": i, "date": e["ts"].isoformat(), "source": e["source"], "kind": e["kind"], "amount": amount,
                "matches": [{"key": key,
                             "counts": s.min_amount is None or (e["amount"] is not None and float(e["amount"]) >= s.min_amount)}
                            for key, s in pairs[(e["source"], e["kind"])]],
            })
        dates = sorted({e["ts"] for e in raw} | {date.fromisoformat(config.SIM_NOW)})[-24:]
        frames = []
        for d in dates:
            sc = self.simulate(cid, as_of=d, use_feedback=False, audience=audience)
            frames.append({
                "as_of": d.isoformat(), "event_ids": [e["i"] for e in events if e["date"] == d.isoformat()],
                "beliefs": [{"moment_id": b["moment_id"], "inferred": b["inferred"], "state": b["state"],
                             "gate": b["gate"], "hit_keys": [s["key"] for s in b["signals"] if s["hit"]]}
                            for b in sc["beliefs"]],
            })
        first = self.db.scalar("SELECT first_name FROM customers WHERE customer_id = $cid", {"cid": cid})
        return {
            "as_of": config.SIM_NOW,
            "customer": {"first_name": first, "language": cust["language"], "consents": consents,
                         "max_active": config.MAX_ACTIVE},
            "events": events, "ignored_events": max(0, allowed - len(events)), "frames": frames,
            "final": self.stored_scenario(cid, audience), "channels": CHANNELS_BY_STATE,
        }

    def why_not(self, cid: int, moment_id: str, target: str, audience: str = "customer") -> dict[str, Any]:
        moments = self.moments()
        m = moments.get(moment_id)
        if m is None:
            raise LookupError("unknown moment")
        scen = self.simulate(cid, audience=audience)
        b = next((x for x in scen["beliefs"] if x["moment_id"] == moment_id), None)
        thr = m.thresholds.ask if target == "ask" else m.thresholds.act
        lang = self._customer_row(cid)["language"]
        cur = {"state": b["state"] if b else "wait", "gate": b["gate"] if b else "below_ask",
               "confidence": b["confidence"] if b else 0.0, "inferred": b["inferred"] if b else 0.0}
        goal = ("act", "ask", "advisor") if target == "ask" else ("act",)
        out: dict[str, Any] = {"moment_id": moment_id, "title": m.title.get(lang), "target": target,
                               "target_threshold": thr, "current": cur, "blockers": [], "paths": [],
                               "near_misses": [], "cannot_change": []}
        gate = cur["gate"]
        if cur["state"] in goal:
            out["verdict"] = "already_there"
            return out
        if gate == "rejected":
            out["verdict"] = "rejected_by_you"
            out["blockers"].append({"code": "rejected_by_you", "detail": "clear your answer to bring it back"})
            return out
        if gate in ("human_first", "care_advisor", "care_suppress", "min_age"):
            out["verdict"] = "blocked_by_rule"
            out["blockers"].append({"code": "human_first", "detail": "a person decides this one with you"})
            return out
        if gate == "fatigue_cap":
            out["verdict"] = "held_back"
            holders = [x for x in scen["beliefs"] if x["state"] in ("act", "ask")]
            out["blockers"] = [{"code": "slots_full", "detail": f"{x['title']} ({x['score']})"} for x in holders]
            return out
        pairs = self._relevant_pairs({moment_id: m}, {"transactions": True, "app": True})
        events = self._customer_events(cid, list(pairs), config.SIM_NOW)
        hit_ids = {s["signal_id"] for s in (b["signals"] if b else []) if s["hit"]}
        now = date.fromisoformat(config.SIM_NOW)
        addable: list[dict[str, Any]] = []
        consents = scen["consents"]
        for s in m.signals:
            key = f"{m.id}.{s.id}"
            if s.source == "profile":
                if s.id not in hit_ids:
                    out["cannot_change"].append({"key": key, "label": s.label.get(lang), "reason": "profile"})
                continue
            if s.id in hit_ids:
                continue
            if not consents[s.source]:
                out["cannot_change"].append({"key": key, "label": s.label.get(lang), "reason": "consent_off"})
                continue
            win = [e for e in events if e["source"] == s.source and e["kind"] == s.kind
                   and now - timedelta(days=s.within_days) < e["ts"] <= now]
            ok = [e for e in win if s.min_amount is None or (e["amount"] is not None and float(e["amount"]) >= s.min_amount)]
            entry = {"key": key, "signal_id": s.id, "label": s.label.get(lang), "weight": s.weight,
                     "need": {"min_count": s.min_count, "min_amount": s.min_amount, "within_days": s.within_days},
                     "have": len(ok), "missing_events": max(0, s.min_count - len(ok)),
                     "saw_amount_below_min": len(win) > len(ok)}
            addable.append(entry)
            if win:
                out["near_misses"].append(entry)
        base = cur["inferred"]
        cands: list[tuple[int, int, tuple[dict[str, Any], ...]]] = []
        for k in range(1, min(3, len(addable)) + 1):
            for combo in itertools.combinations(addable, k):
                prod = 1.0 - base
                for a in combo:
                    prod *= 1.0 - a["weight"]
                if 1.0 - prod >= thr:
                    cands.append((k, sum(a["missing_events"] for a in combo), combo))
        cands.sort(key=lambda c: (c[0], c[1]))
        before = {x["moment_id"]: x["state"] for x in scen["beliefs"]}
        checked = 0
        for _, _, combo in cands:
            if len(out["paths"]) >= 3 or checked >= 6:
                break
            checked += 1
            sim = self.simulate(cid, WhatIfIn(signals_on=[a["key"] for a in combo]), audience=audience)
            nb = next((x for x in sim["beliefs"] if x["moment_id"] == moment_id), None)
            if nb is None or nb["state"] not in goal:
                continue
            displaces = [x["moment_id"] for x in sim["beliefs"]
                         if x["moment_id"] != moment_id and before.get(x["moment_id"]) in ("act", "ask")
                         and x["state"] == "deferred_fatigue"]
            out["paths"].append({"add": [dict(a) for a in combo],
                                 "result": {"confidence": nb["confidence"], "state": nb["state"], "gate": nb["gate"],
                                            "displaces": displaces, "verified": True}})
        out["verdict"] = "evidence_gap" if out["paths"] else "unreachable"
        return out
