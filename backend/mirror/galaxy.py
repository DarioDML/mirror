"""Aggregate-only data for the product owner "galaxy": stage counts, per-moment cells, operating points.

Privacy rules (there is no per-customer row anywhere in this module):
- Cells of the sensitive states are never split by anything but moment; counts under K are "<K", else rounded to a multiple of 5.
- Stage totals that could be differenced against public cells are rounded to a multiple of 5 independently; the advisor
  total is computed from the published rounded cells only ("<K" cells count as a constant 5), like the funnel.
- Operating points with fewer than K customers are merged into the next lower point.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from . import config
from .db import DB
from .engine import Engine

K = config.K_ANON
ROUND_TO = 5

SENSITIVE_STATES = ("advisor", "deferred_fatigue", "blocked_guardrail", "suppressed_feedback")
TRUTH_SPLIT_STATES = ("act", "ask")
CELL_STATES = ("act", "ask", "wait", *SENSITIVE_STATES)

Count = int | str
Payload = dict[str, object]

_STATE_RANK = (
    "CASE t.state WHEN 'act' THEN 1 WHEN 'ask' THEN 2 WHEN 'advisor' THEN 3 WHEN 'deferred_fatigue' THEN 4 "
    "WHEN 'blocked_guardrail' THEN 5 WHEN 'suppressed_feedback' THEN 6 ELSE 7 END"
)

CELLS_SQL = f"""
WITH ranked AS (
  SELECT t.customer_id, t.moment_id, t.state,
         row_number() OVER (PARTITION BY t.customer_id ORDER BY {_STATE_RANK}, t.priority * t.confidence DESC, t.moment_id) AS rk
  FROM twin t WHERE t.inferred > 0
)
SELECT r.moment_id, r.state, (tr.customer_id IS NOT NULL) AS is_true, count(*) AS n
FROM ranked r LEFT JOIN truth tr ON tr.customer_id = r.customer_id AND tr.moment_id = r.moment_id
WHERE r.rk = 1 GROUP BY ALL
"""

STAGES_SQL = """
SELECT count(DISTINCT customer_id) AS behavioural,
       count(DISTINCT customer_id) FILTER (WHERE state IN ('act','ask','advisor','deferred_fatigue','blocked_guardrail')) AS above_ask,
       count(DISTINCT customer_id) FILTER (WHERE state IN ('act','ask')) AS delivered,
       count(DISTINCT customer_id) FILTER (WHERE state = 'advisor') AS advisor,
       count(DISTINCT customer_id) FILTER (WHERE state = 'deferred_fatigue') AS fatigue
FROM twin WHERE inferred > 0
"""

QUALITY_SQL = """
WITH det AS (SELECT customer_id, moment_id, inferred >= act_t AS strong FROM twin WHERE inferred >= ask_t),
tp AS (SELECT d.moment_id, count(*) AS n, count(*) FILTER (WHERE d.strong) AS n_strong
       FROM det d JOIN truth t ON t.customer_id = d.customer_id AND t.moment_id = d.moment_id GROUP BY 1),
dn AS (SELECT moment_id, count(*) AS n, count(*) FILTER (WHERE strong) AS n_strong FROM det GROUP BY 1),
tn AS (SELECT moment_id, count(*) AS n FROM truth GROUP BY 1)
SELECT m.moment_id, coalesce(dn.n, 0) AS detected, coalesce(tp.n, 0) AS tp, coalesce(tn.n, 0) AS planted,
       coalesce(dn.n_strong, 0) AS detected_strong, coalesce(tp.n_strong, 0) AS tp_strong
FROM moments_rt m
LEFT JOIN dn ON dn.moment_id = m.moment_id LEFT JOIN tp ON tp.moment_id = m.moment_id
LEFT JOIN tn ON tn.moment_id = m.moment_id
"""

POINTS_SQL = """
SELECT t.moment_id, round(t.inferred, 4) AS v, count(*) AS n, count(tr.customer_id) AS tp
FROM twin t LEFT JOIN truth tr ON tr.customer_id = t.customer_id AND tr.moment_id = t.moment_id
WHERE t.inferred > 0 GROUP BY 1, 2 ORDER BY 1, 2 DESC
"""


def hide_small(n: int) -> Count:
    if n == 0:
        return 0
    return n if n >= K else f"<{K}"


def round_coarse(n: int) -> int:
    return ROUND_TO * ((n + ROUND_TO // 2) // ROUND_TO)


def coarse(n: int) -> Count:
    return f"<{K}" if n < K else round_coarse(n)


def coarse_or_zero(n: int) -> Count:
    return 0 if n == 0 else coarse(n)


def _int(value: object) -> int:
    return int(value) if isinstance(value, (int, float)) else 0


def _ratio(num: int, den: int) -> float | None:
    return round(num / den, 3) if den else None


def _cells(counts: dict[tuple[str, bool], int]) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for state in CELL_STATES:
        if state in TRUTH_SPLIT_STATES:
            out.append({"state": state, "truth": "tp", "n": hide_small(counts.get((state, True), 0))})
            out.append({"state": state, "truth": "fp", "n": hide_small(counts.get((state, False), 0))})
            continue
        total = counts.get((state, True), 0) + counts.get((state, False), 0)
        out.append({"state": state, "truth": "any", "n": coarse(total) if state in SENSITIVE_STATES else coarse_or_zero(total)})
    return out


def merge_points(raw: list[tuple[float, int, int]], planted: int) -> list[dict[str, object]]:
    """raw: (inferred value, customers, true positives), sorted by value descending. Buckets of fewer than K customers are merged."""
    buckets: list[list[float | int]] = []
    cur_n = cur_tp = 0
    cur_v = 0.0
    for v, n, tp in raw:
        cur_n += n
        cur_tp += tp
        cur_v = v
        if cur_n >= K:
            buckets.append([cur_v, cur_n, cur_tp])
            cur_n = cur_tp = 0
    if cur_n and buckets:
        buckets[-1][0] = cur_v
        buckets[-1][1] = int(buckets[-1][1]) + cur_n
        buckets[-1][2] = int(buckets[-1][2]) + cur_tp
    out: list[dict[str, object]] = []
    cum_n = cum_tp = 0
    for v, n, tp in buckets:
        cum_n += int(n)
        cum_tp += int(tp)
        out.append({
            "v": v, "n": int(n), "tp": int(tp),
            "precision": _ratio(cum_tp, cum_n) if cum_n >= K and planted else None,
            "recall": _ratio(cum_tp, planted) if planted >= K else None,
        })
    return out


def _group_points(rows: list[dict[str, object]]) -> dict[str, list[tuple[float, int, int]]]:
    grouped: dict[str, list[tuple[float, int, int]]] = {}
    for r in rows:
        grouped.setdefault(str(r["moment_id"]), []).append((float(str(r["v"])), _int(r["n"]), _int(r["tp"])))
    return grouped


def _sum_of_published(clusters: list[dict[str, object]], state: str) -> Count:
    """A sensitive total uses only published cells ("<K" counts as a constant ROUND_TO), so it cannot be differenced to a hidden cell."""
    shown = [c["n"] for cl in clusters for c in _cells_of(cl) if c["state"] == state]
    total = sum(n for n in shown if isinstance(n, int)) + ROUND_TO * sum(1 for n in shown if isinstance(n, str))
    return total if total >= K else f"<{K}"


def _cells_of(cluster: dict[str, object]) -> list[dict[str, object]]:
    cells = cluster["cells"]
    return [c for c in cells if isinstance(c, dict)] if isinstance(cells, list) else []


def compute(db: DB, engine: Engine) -> Payload:
    t0 = time.perf_counter()
    moments = engine.moments()
    pop = db.one(
        "SELECT count(*) AS customers, count(*) FILTER (WHERE consent_transactions OR consent_app) AS consented FROM customers"
    ) or {}
    stage_row = db.one(STAGES_SQL) or {}
    cell_rows = db.rows(CELLS_SQL)
    quality = {str(r["moment_id"]): r for r in db.rows(QUALITY_SQL)}
    points = _group_points(db.rows(POINTS_SQL))

    per_moment: dict[str, dict[tuple[str, bool], int]] = {}
    for r in cell_rows:
        per_moment.setdefault(str(r["moment_id"]), {})[(str(r["state"]), bool(r["is_true"]))] = _int(r["n"])

    population = _int(pop.get("customers"))
    behavioural = round_coarse(_int(stage_row.get("behavioural")))
    stages: list[dict[str, object]] = [
        {"id": "population", "n": population},
        {"id": "consent", "n": _int(pop.get("consented"))},
        {"id": "behavioural", "n": behavioural},
        {"id": "above_ask", "n": round_coarse(_int(stage_row.get("above_ask")))},
        {"id": "delivered", "n": round_coarse(_int(stage_row.get("delivered")))},
        {"id": "advisor", "n": 0},
        {"id": "fatigue", "n": coarse(_int(stage_row.get("fatigue")))},
    ]

    clusters: list[dict[str, object]] = []
    for m in sorted(moments.values(), key=lambda x: (-x.priority, x.id)):
        q = quality.get(m.id, {})
        det, tp, planted = _int(q.get("detected")), _int(q.get("tp")), _int(q.get("planted"))
        det_s, tp_s = _int(q.get("detected_strong")), _int(q.get("tp_strong"))
        clusters.append({
            "moment_id": m.id,
            "title": m.title.en,
            "custom": m.id not in engine.builtin,
            "priority": m.priority,
            "thresholds": {"ask": m.thresholds.ask, "act": m.thresholds.act},
            "cells": _cells(per_moment.get(m.id, {})),
            "planted": hide_small(planted),
            "missed": hide_small(max(planted - tp, 0)) if planted >= K else None,
            "operating_points": merge_points(points.get(m.id, []), planted),
            "precision": _ratio(tp, det) if det >= K and planted else None,
            "recall": _ratio(tp, planted) if planted >= K else None,
            "precision_act": _ratio(tp_s, det_s) if det_s >= K and planted else None,
        })

    stages[5]["n"] = _sum_of_published(clusters, "advisor")

    stats = engine.last_stats() or {}
    timings = stats.get("timings")
    galaxy_ms = int((time.perf_counter() - t0) * 1000)
    return {
        "as_of": config.SIM_NOW,
        "customers": population,
        "events": _int(stats.get("events")),
        "run_ms": _int(stats.get("run_ms")),
        "timings": {**timings, "galaxy_ms": galaxy_ms} if isinstance(timings, dict) else {"galaxy_ms": galaxy_ms},
        "synthetic_ground_truth": True,
        "rounding": {"k": K, "round_to": ROUND_TO},
        "stages": stages,
        "no_signal": max(population - behavioural, 0),
        "clusters": clusters,
        "scale": stats.get("scale"),
    }


@dataclass(frozen=True)
class _Entry:
    key: tuple[int, tuple[str, ...]]
    payload: Payload


class GalaxyService:
    """Serves the galaxy payload from memory; recomputed only when a new run (or a new moment set) appears."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entry: _Entry | None = None
        self.builds = 0

    @staticmethod
    def _key(db: DB, engine: Engine) -> tuple[int, tuple[str, ...]]:
        run_id = db.scalar("SELECT max(run_id) FROM runs")
        if run_id is None:
            engine.run_population()
            run_id = db.scalar("SELECT max(run_id) FROM runs")
        return int(run_id or 0), tuple(sorted(engine.moments()))

    def get(self, db: DB, engine: Engine) -> Payload:
        key = self._key(db, engine)
        with self._lock:
            entry = self._entry
            if entry is not None and entry.key == key:
                return entry.payload
        payload = compute(db, engine)
        settled = self._key(db, engine)
        if settled != key:
            key, payload = settled, compute(db, engine)
        with self._lock:
            self._entry = _Entry(key, payload)
            self.builds += 1
        return payload

    def invalidate(self) -> None:
        with self._lock:
            self._entry = None


SERVICE = GalaxyService()
