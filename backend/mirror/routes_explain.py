from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from .api import User, rate, role, state
from .dsl import ID_PATTERN
from .explain import WhatIfIn
from .security import LIMITS

router = APIRouter()


def _bucket(name: str) -> str:
    return name if name in LIMITS else "ai"


@router.post("/api/me/whatif")
def my_whatif(body: WhatIfIn, user: User = Depends(role("customer"))) -> dict[str, Any]:
    rate(_bucket("sim"), user.username)
    if user.customer_id is None:
        raise HTTPException(403, "Not allowed for your role")
    if body.care_flag is not None:
        raise HTTPException(422, "care_flag is not available here")
    try:
        return state.engine.whatif(user.customer_id, body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/api/me/theater")
def my_theater(user: User = Depends(role("customer"))) -> dict[str, Any]:
    rate(_bucket("theater"), user.username)
    if user.customer_id is None:
        raise HTTPException(403, "Not allowed for your role")
    return state.engine.theater(user.customer_id)


@router.get("/api/me/why-not/{moment_id}")
def my_why_not(
    moment_id: str = Path(pattern=ID_PATTERN),
    target: Literal["ask", "act"] = Query("ask"),
    user: User = Depends(role("customer")),
) -> dict[str, Any]:
    rate(_bucket("whynot"), user.username)
    if user.customer_id is None:
        raise HTTPException(403, "Not allowed for your role")
    try:
        return state.engine.why_not(user.customer_id, moment_id, target)
    except LookupError as exc:
        raise HTTPException(404, "Unknown moment") from exc
