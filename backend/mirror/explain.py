"""Explain layer: models, channel policy and the read-only SQL fragments behind what-if, theater and why-not."""
from __future__ import annotations

import re
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .dsl import ID_PATTERN

KEY_PATTERN = r"^[a-z][a-z0-9_]{1,39}\.[a-z][a-z0-9_]{1,39}$"
_KEY_RE = re.compile(KEY_PATTERN)
_ID_RE = re.compile(ID_PATTERN)

CHANNELS_BY_STATE: dict[str, dict[str, str]] = {
    "act": {"app_card": "deliver", "voice": "deliver", "advisor": "note_only"},
    "ask": {"app_card": "deliver", "voice": "deliver", "advisor": "note_only"},
    "advisor": {"app_card": "deliver", "voice": "deliver", "advisor": "deliver"},
    "wait": {},
    "deferred_fatigue": {"advisor": "muted"},
    "blocked_guardrail": {"advisor": "severed"},
    "suppressed_feedback": {"advisor": "flag_do_not_mention"},
}

CUSTOMER_GATE = {"care_advisor": "human_first", "care_suppress": "human_first", "min_age": "human_first"}

Feedback = Literal["confirmed", "rejected", "clear"]


class ConsentOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")
    transactions: Optional[bool] = None
    app: Optional[bool] = None


class ThresholdOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ask: float = Field(ge=0.05, le=0.99)
    act: float = Field(ge=0.05, le=1.0)

    @model_validator(mode="after")
    def _order(self) -> "ThresholdOverride":
        if self.ask >= self.act:
            raise ValueError("ask must be lower than act")
        return self


class GuardrailOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min_age: Optional[int] = Field(default=None, ge=18, le=100)
    vulnerable: Optional[Literal["advisor", "suppress"]] = None


def _keys_ok(keys: list[str]) -> list[str]:
    for k in keys:
        if not _KEY_RE.match(k):
            raise ValueError("invalid signal key")
    return keys


class WhatIfIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    as_of: Optional[date] = None
    consents: Optional[ConsentOverride] = None
    feedback: dict[str, Feedback] = Field(default_factory=dict, max_length=8)
    signals_off: list[str] = Field(default_factory=list, max_length=12)
    signals_on: list[str] = Field(default_factory=list, max_length=12)
    weights: dict[str, float] = Field(default_factory=dict, max_length=12)
    thresholds: dict[str, ThresholdOverride] = Field(default_factory=dict, max_length=12)
    guardrails: dict[str, GuardrailOverride] = Field(default_factory=dict, max_length=12)
    max_active: Optional[int] = Field(default=None, ge=1, le=5)
    care_flag: Optional[bool] = None

    @field_validator("signals_off", "signals_on")
    @classmethod
    def _keys(cls, v: list[str]) -> list[str]:
        return _keys_ok(v)

    @field_validator("weights")
    @classmethod
    def _weights(cls, v: dict[str, float]) -> dict[str, float]:
        _keys_ok(list(v))
        if any(not 0.01 <= w <= 0.95 for w in v.values()):
            raise ValueError("weights must be between 0.01 and 0.95")
        return v

    @field_validator("feedback", "thresholds", "guardrails")
    @classmethod
    def _ids(cls, v: dict) -> dict:
        if any(not _ID_RE.match(k) for k in v):
            raise ValueError("invalid moment id")
        return v


def split_key(key: str) -> tuple[str, str]:
    mid, _, sid = key.partition(".")
    return mid, sid


CONTRIBUTIONS_SQL = """
WITH h AS (SELECT * FROM ({hits})),
x AS (SELECT *, sum(ln(1 - weight)) OVER w AS all_ln,
             count(*) FILTER (WHERE source <> 'profile') OVER w AS behav
      FROM h WINDOW w AS (PARTITION BY customer_id, moment_id))
SELECT moment_id, signal_id, source, weight, n, last_seen,
  1 - exp(sum(ln(1 - weight)) OVER (PARTITION BY customer_id, moment_id ORDER BY weight DESC, signal_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS cumulative,
  CASE WHEN behav - CAST(source <> 'profile' AS INTEGER) = 0 THEN 0.0 ELSE 1 - exp(all_ln - ln(1 - weight)) END AS without_this
FROM x ORDER BY moment_id, weight DESC, signal_id
"""

TIMELINE_SQL = (
    "SELECT ts, source, kind, amount FROM events WHERE customer_id = $cid AND ts <= CAST($now AS DATE) "
    "AND ({pairs}) ORDER BY ts, rowid"
)
