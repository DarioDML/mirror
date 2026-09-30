"""The moment DSL.

A product team describes *a moment it can help with* as data (YAML/JSON), not code:
which signals point to it, how sure we must be to ask or to act, which guardrails apply,
and what the journey across products looks like.

Security: definitions can be created through the API by product owners, so they are never
turned into SQL by string concatenation. Every value becomes a bound parameter, and every
identifier (column, operator, source) comes from a fixed whitelist below.
"""
from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

ID_PATTERN = r"^[a-z][a-z0-9_]{1,39}$"
LANGS = ("en", "nl", "fr")
REGIONS = {"flanders", "wallonia", "brussels"}


class Text(BaseModel):
    model_config = ConfigDict(extra="forbid")
    en: str = Field(min_length=1, max_length=400)
    nl: Optional[str] = Field(default=None, max_length=400)
    fr: Optional[str] = Field(default=None, max_length=400)

    def get(self, lang: str) -> str:
        return getattr(self, lang, None) or self.en


Scalar = Union[int, float, str]


class Signal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=ID_PATTERN)
    label: Text  # a noun phrase that reads well inside a sentence: "a transfer to a notary"
    source: Literal["transactions", "app", "profile"]
    weight: float = Field(gt=0, le=0.95)
    # transactions / app
    kind: Optional[str] = Field(default=None, pattern=ID_PATTERN)
    min_count: int = Field(default=1, ge=1, le=100)
    min_amount: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    within_days: int = Field(default=90, ge=1, le=365)
    # profile
    field: Optional[Literal["age", "household_size", "region"]] = None
    op: Optional[Literal[">=", "<=", "=", "between", "in"]] = None
    value: Optional[Union[Scalar, list[Scalar]]] = None

    @model_validator(mode="after")
    def _check(self) -> "Signal":
        if self.source in ("transactions", "app"):
            if not self.kind:
                raise ValueError("kind is required for transactions/app signals")
            if self.field or self.op or self.value is not None:
                raise ValueError("field/op/value are only allowed on profile signals")
            if self.source == "app" and self.min_amount is not None:
                raise ValueError("min_amount is only allowed on transaction signals")
            return self
        if self.kind or self.min_amount is not None:
            raise ValueError("kind/min_amount are not allowed on profile signals")
        if not self.field or not self.op or self.value is None:
            raise ValueError("profile signals need field, op and value")
        numeric = self.field in ("age", "household_size")
        vals = self.value if isinstance(self.value, list) else [self.value]
        for v in vals:
            if numeric and (isinstance(v, bool) or not isinstance(v, (int, float))):
                raise ValueError(f"{self.field} values must be numbers")
            if not numeric and (not isinstance(v, str) or v not in REGIONS):
                raise ValueError(f"region values must be one of {sorted(REGIONS)}")
        if self.op == "between":
            if not isinstance(self.value, list) or len(self.value) != 2 or not numeric or vals[0] > vals[1]:
                raise ValueError("between needs [low, high] numbers")
        elif self.op == "in":
            if not isinstance(self.value, list) or not 1 <= len(self.value) <= 20:
                raise ValueError("in needs a list of 1-20 values")
        else:
            if isinstance(self.value, list):
                raise ValueError(f"operator {self.op} needs a single value")
            if self.op in (">=", "<=") and not numeric:
                raise ValueError(f"operator {self.op} only works on numeric fields")
        return self


class Thresholds(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ask: float = Field(ge=0.05, le=0.99)
    act: float = Field(ge=0.05, le=1.0)

    @model_validator(mode="after")
    def _order(self) -> "Thresholds":
        if self.ask >= self.act:
            raise ValueError("thresholds.ask must be lower than thresholds.act")
        return self


class Step(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product: str = Field(pattern=ID_PATTERN)
    title: Text
    body: Text


class Guardrails(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min_age: int = Field(default=18, ge=18, le=100)
    vulnerable: Literal["advisor", "suppress"] = "advisor"


class Moment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=ID_PATTERN)
    title: Text
    category: Literal["housing", "household", "family", "work", "mobility", "energy", "savings", "other"]
    priority: int = Field(ge=1, le=100)
    thresholds: Thresholds
    question: Text
    journey: list[Step] = Field(min_length=1, max_length=6)
    signals: list[Signal] = Field(min_length=1, max_length=12)
    guardrails: Guardrails = Guardrails()

    @model_validator(mode="after")
    def _check(self) -> "Moment":
        ids = [s.id for s in self.signals]
        if len(ids) != len(set(ids)):
            raise ValueError("signal ids must be unique within a moment")
        if not any(s.source != "profile" for s in self.signals):
            raise ValueError("a moment needs at least one behavioural (transactions/app) signal")
        return self


# ------------------------------------------------------------------ compiler

_FIELD_COLUMNS = {"age": "c.age", "household_size": "c.household_size", "region": "c.region"}
_CMP = {">=": ">=", "<=": "<=", "=": "="}
_CONSENT = {"transactions": "c.consent_transactions", "app": "c.consent_app"}


def compile_hits(moments: list[Moment], customer_filter: bool) -> tuple[str, dict]:
    """One UNION ALL query producing (customer_id, moment_id, signal_id, source, weight, n, last_seen).

    Consent is enforced here, at query level: a data source a customer switched off is never read.
    """
    parts: list[str] = []
    params: dict = {}
    for mi, m in enumerate(moments):
        for si, s in enumerate(m.signals):
            p = f"m{mi}s{si}"
            params.update({f"{p}_mid": m.id, f"{p}_sid": s.id, f"{p}_w": float(s.weight)})
            if s.source in ("transactions", "app"):
                params.update({f"{p}_src": s.source, f"{p}_kind": s.kind,
                               f"{p}_days": int(s.within_days), f"{p}_min": int(s.min_count)})
                amount = ""
                if s.min_amount is not None:
                    amount = f" AND e.amount >= ${p}_amt"
                    params[f"{p}_amt"] = float(s.min_amount)
                cf = " AND e.customer_id = $cid" if customer_filter else ""
                parts.append(
                    f"SELECT e.customer_id, ${p}_mid AS moment_id, ${p}_sid AS signal_id, ${p}_src AS source, "
                    f"${p}_w AS weight, COUNT(*) AS n, MAX(e.ts) AS last_seen "
                    f"FROM events e JOIN customers c ON c.customer_id = e.customer_id "
                    f"WHERE {_CONSENT[s.source]} AND e.source = ${p}_src AND e.kind = ${p}_kind "
                    f"AND e.ts > CAST($now AS DATE) - CAST(${p}_days AS INTEGER){amount}{cf} "
                    f"GROUP BY e.customer_id HAVING COUNT(*) >= ${p}_min"
                )
            else:
                col = _FIELD_COLUMNS[s.field]
                if s.op in _CMP:
                    cond = f"{col} {_CMP[s.op]} ${p}_v"
                    params[f"{p}_v"] = s.value
                elif s.op == "between":
                    cond = f"{col} BETWEEN ${p}_lo AND ${p}_hi"
                    params[f"{p}_lo"], params[f"{p}_hi"] = s.value
                else:
                    cond = f"list_contains(${p}_list, {col})"
                    params[f"{p}_list"] = list(s.value)
                cf = " AND c.customer_id = $cid" if customer_filter else ""
                parts.append(
                    f"SELECT c.customer_id, ${p}_mid AS moment_id, ${p}_sid AS signal_id, 'profile' AS source, "
                    f"${p}_w AS weight, CAST(1 AS BIGINT) AS n, CAST(NULL AS DATE) AS last_seen "
                    f"FROM customers c WHERE {cond}{cf}"
                )
    if not parts:
        return ("SELECT CAST(NULL AS INTEGER) AS customer_id, '' AS moment_id, '' AS signal_id, '' AS source, "
                "0.0 AS weight, CAST(0 AS BIGINT) AS n, CAST(NULL AS DATE) AS last_seen WHERE false"), params
    return "\nUNION ALL\n".join(parts), params


def twin_sql(hits_from: str, customer_filter: bool) -> str:
    """Beliefs (noisy-OR of signal weights) + customer feedback + guardrails + fatigue -> one state per moment.

    States: act | ask | advisor | wait | blocked_guardrail | deferred_fatigue | suppressed_feedback
    """
    cf = " AND customer_id = $cid" if customer_filter else ""
    return f"""
WITH h AS (SELECT * FROM {hits_from}),
agg AS (
  SELECT customer_id, moment_id,
         1 - exp(sum(ln(1 - weight))) AS inferred,
         count(*) FILTER (WHERE source <> 'profile') AS behav,
         list(signal_id ORDER BY weight DESC) AS evidence
  FROM h GROUP BY customer_id, moment_id
),
b AS (SELECT * FROM agg WHERE behav > 0),
fb AS (SELECT customer_id, moment_id, status FROM feedback
       WHERE moment_id IN (SELECT moment_id FROM moments_rt){cf}),
eff AS (
  SELECT coalesce(b.customer_id, fb.customer_id) AS customer_id,
         coalesce(b.moment_id, fb.moment_id) AS moment_id,
         coalesce(b.inferred, 0.0) AS inferred,
         fb.status AS feedback,
         CASE fb.status WHEN 'confirmed' THEN 1.0 WHEN 'rejected' THEN 0.0 ELSE coalesce(b.inferred, 0.0) END AS confidence,
         coalesce(b.evidence, CAST([] AS VARCHAR[])) AS evidence
  FROM b FULL OUTER JOIN fb ON b.customer_id = fb.customer_id AND b.moment_id = fb.moment_id
),
j AS (
  SELECT eff.*, m.ask_t, m.act_t, m.priority, m.min_age, m.vulnerable_policy, c.age, c.vulnerable
  FROM eff JOIN moments_rt m ON m.moment_id = eff.moment_id
           JOIN customers c ON c.customer_id = eff.customer_id
),
s AS (
  SELECT *, CASE
      WHEN feedback = 'rejected' THEN 'suppressed_feedback'
      WHEN confidence < ask_t THEN 'wait'
      WHEN age < min_age THEN 'blocked_guardrail'
      WHEN vulnerable AND vulnerable_policy = 'advisor' THEN 'advisor'
      WHEN vulnerable THEN 'blocked_guardrail'
      WHEN confidence >= act_t THEN 'act'
      ELSE 'ask' END AS state0
  FROM j
),
r AS (
  SELECT *, row_number() OVER (
      PARTITION BY customer_id, state0 IN ('act', 'ask')
      ORDER BY coalesce(feedback = 'confirmed', false) DESC, priority * confidence DESC, moment_id) AS rk
  FROM s
)
SELECT customer_id, moment_id, confidence, inferred, feedback, evidence, priority, ask_t, act_t,
       CASE WHEN state0 IN ('act', 'ask') AND rk > $max_active THEN 'deferred_fatigue' ELSE state0 END AS state
FROM r
"""
