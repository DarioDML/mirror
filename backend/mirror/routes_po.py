from __future__ import annotations

from fastapi import APIRouter, Depends

from . import galaxy
from .api import User, rate, role, state
from .security import LIMITS

router = APIRouter()

_BUCKET = "galaxy" if "galaxy" in LIMITS else "ai"


@router.get("/api/po/galaxy", response_model=None)
def po_galaxy(user: User = Depends(role("product_owner"))) -> galaxy.Payload:
    rate(_BUCKET, user.username)
    return galaxy.SERVICE.get(state.db, state.engine)
