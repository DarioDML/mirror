"""HTTP API.

Access model (this is what the security audit should find):
- Customers only ever reach their own data through /api/me/*. The customer id comes from the
  authenticated user record, never from the URL or the body, so there is nothing to tamper with (no IDOR).
- Advisors only see customers assigned to them. Unassigned customers return 404, so ids cannot be probed.
- Product owners see aggregates only (small counts hidden) and manage moment definitions. They never see names.
- Role and ids are read from the database on every request, not trusted from the token.
- Moment definitions are validated data compiled to parameterized SQL; there is no user-written SQL.
- Consent and guardrails are enforced inside the engine on the server, not by hiding things in the UI.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Literal, Optional

import jwt
from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import config
from .channels import Channels, evidence_phrase, tts
from .db import DB
from .dsl import ID_PATTERN, Moment
from .engine import Engine
from .persona import DetailOverride, MotionOverride, Overrides, TextScaleOverride, ToneOverride, Ui, derive
from .security import (DUMMY_HASH, check_rate, create_token, decode_token, login_blocked, login_failed,
                       verify_password)

log = logging.getLogger("mirror.api")


class State:
    db: DB
    engine: Engine
    channels: Channels


state = State()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not config.DB_PATH.exists():
        raise RuntimeError(f"No database at {config.DB_PATH}. Run: python -m mirror.generate")
    state.db = DB(config.DB_PATH)
    state.engine = Engine(state.db)
    state.channels = Channels(state.db)
    yield
    state.db.close()


dev = config.ENV == "dev"
app = FastAPI(
    title="Mirror API",
    lifespan=lifespan,
    docs_url="/api/docs" if dev else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if dev else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path.startswith("/api/docs"):
        return response  # Swagger UI (dev only) needs its own CDN assets
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; "
        "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("unhandled error: %s", type(exc).__name__)
    return JSONResponse({"detail": "Internal error"}, status_code=500)


# ------------------------------------------------------------------ auth


class User(BaseModel):
    username: str
    display_name: str
    role: Literal["customer", "advisor", "product_owner"]
    customer_id: Optional[int] = None
    advisor_id: Optional[int] = None


bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(401, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    row = state.db.one(
        "SELECT username, display_name, role, customer_id, advisor_id FROM users "
        "WHERE username = $u AND NOT disabled",
        {"u": payload["sub"]},
    )
    if not row:
        raise HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return User(**row)


def role(required: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role != required:
            raise HTTPException(403, "Not allowed for your role")
        if required == "customer" and user.customer_id is None:
            raise HTTPException(403, "Not allowed for your role")
        if required == "advisor" and user.advisor_id is None:
            raise HTTPException(403, "Not allowed for your role")
        return user

    return dep


def rate(bucket: str, key: str) -> None:
    if not check_rate(bucket, key):
        raise HTTPException(429, "Too many requests, slow down")


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(min_length=1, max_length=200)


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request):
    ip = request.client.host if request.client else "unknown"
    username = body.username.lower()
    rate("login_ip", ip)
    if login_blocked(username):
        raise HTTPException(429, "Too many requests, slow down")
    row = state.db.one(
        "SELECT username, display_name, role, password_hash FROM users WHERE username = $u AND NOT disabled",
        {"u": username},
    )
    ok = verify_password(body.password, row["password_hash"] if row else DUMMY_HASH)
    if not row or not ok:
        login_failed(username)
        raise HTTPException(401, "Invalid username or password")
    return {"token": create_token(row["username"]), "role": row["role"], "display_name": row["display_name"],
            "expires_in": config.TOKEN_TTL_MINUTES * 60}


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"username": user.username, "display_name": user.display_name, "role": user.role}


@app.get("/api/health")
def health():
    return {"ok": True}


# ------------------------------------------------------------------ customer: /api/me/*  (own data only)

MomentId = Path(pattern=ID_PATTERN)


def _customer(cid: int) -> dict:
    return state.db.one(
        "SELECT customer_id, first_name, language, consent_transactions, consent_app FROM customers "
        "WHERE customer_id = $cid",
        {"cid": cid},
    )


def _overrides(cid: int) -> Overrides:
    row = state.db.one("SELECT text_scale, motion, detail, tone FROM customer_prefs WHERE customer_id = $cid",
                       {"cid": cid})
    if not row:
        return {}
    return {"text_scale": row["text_scale"], "motion": row["motion"], "detail": row["detail"], "tone": row["tone"]}


def _ui(cid: int) -> Ui:
    c = state.db.one(
        "SELECT age, household_size, language, vulnerable, consent_app FROM customers WHERE customer_id = $cid",
        {"cid": cid},
    )
    app_events = 0
    if c["consent_app"]:
        app_events = int(state.db.scalar(
            "SELECT count(*) FROM events WHERE customer_id = $cid AND source = 'app' "
            "AND ts > CAST($now AS DATE) - 180", {"cid": cid, "now": config.SIM_NOW}) or 0)
    moments = state.engine.moments()
    twin, _ = state.engine.customer_rows(cid)
    active = [r for r in twin if r["state"] in ("act", "ask", "advisor") and r["moment_id"] in moments]
    top = max(active, key=lambda r: r["priority"] * r["confidence"], default=None)
    return derive(
        age=int(c["age"]), household_size=int(c["household_size"]), language=c["language"],
        top_category=moments[top["moment_id"]].category if top else None,
        top_state=top["state"] if top else None, confidence=float(top["confidence"]) if top else 0.0,
        consent_app=bool(c["consent_app"]), app_events_180d=app_events, care=bool(c["vulnerable"]),
        overrides=_overrides(cid),
    )


def _twin_payload(cid: int) -> dict:
    c = _customer(cid)
    lang = c["language"]
    beliefs = state.engine.beliefs(cid, lang)
    known = {b["moment_id"] for b in beliefs}
    plans = [{"moment_id": m.id, "title": m.title.get(lang), "category": m.category}
             for m in state.engine.moments().values() if m.id not in known]
    return {
        "customer": {"first_name": c["first_name"], "language": lang,
                     "consents": {"transactions": c["consent_transactions"], "app": c["consent_app"]}},
        "beliefs": beliefs,
        "plans": plans,
        "ui": _ui(cid),
        "as_of": config.SIM_NOW,
    }


@app.get("/api/me/twin")
def my_twin(user: User = Depends(role("customer"))):
    return _twin_payload(user.customer_id)


class FeedbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["confirmed", "rejected", "clear"]
    note: Optional[str] = Field(default=None, max_length=200)  # stored, never sent to the AI


@app.post("/api/me/beliefs/{moment_id}/feedback")
def my_feedback(body: FeedbackIn, moment_id: str = MomentId, user: User = Depends(role("customer"))):
    rate("write", user.username)
    if moment_id not in state.engine.moments():
        raise HTTPException(404, "Unknown moment")
    cid = user.customer_id
    with state.db.lock:
        if body.status == "clear":
            state.db.execute("DELETE FROM feedback WHERE customer_id = $cid AND moment_id = $mid",
                             {"cid": cid, "mid": moment_id})
        else:
            state.db.execute(
                "INSERT OR REPLACE INTO feedback (customer_id, moment_id, status, note, updated_at) "
                "VALUES ($cid, $mid, $status, $note, current_timestamp)",
                {"cid": cid, "mid": moment_id, "status": body.status, "note": body.note},
            )
        state.engine.refresh_customer(cid)
        state.channels.invalidate(cid)
    return _twin_payload(cid)


class ConsentsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    transactions: bool
    app: bool


@app.put("/api/me/consents")
def my_consents(body: ConsentsIn, user: User = Depends(role("customer"))):
    rate("write", user.username)
    with state.db.lock:
        state.db.execute(
            "UPDATE customers SET consent_transactions = $t, consent_app = $a WHERE customer_id = $cid",
            {"t": body.transactions, "a": body.app, "cid": user.customer_id},
        )
        state.engine.refresh_customer(user.customer_id)
        state.channels.invalidate(user.customer_id)
    return _twin_payload(user.customer_id)


class PrefsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: Optional[Literal["en", "nl", "fr"]] = None
    text_scale: Optional[TextScaleOverride] = None
    motion: Optional[MotionOverride] = None
    detail: Optional[DetailOverride] = None
    tone: Optional[ToneOverride] = None

    @model_validator(mode="after")
    def at_least_one(self) -> "PrefsIn":
        if not any(getattr(self, f) is not None for f in type(self).model_fields):
            raise ValueError("at least one preference is required")
        return self


DISPLAY_PREFS = ("text_scale", "motion", "detail", "tone")


@app.put("/api/me/preferences")
def my_preferences(body: PrefsIn, user: User = Depends(role("customer"))):
    rate("write", user.username)
    cid = user.customer_id
    with state.db.lock:
        if body.language is not None:
            state.db.execute("UPDATE customers SET language = $l WHERE customer_id = $cid",
                             {"l": body.language, "cid": cid})
        changes = {k: getattr(body, k) for k in DISPLAY_PREFS if getattr(body, k) is not None}
        if changes:
            merged = {**_overrides(cid), **{k: (None if v == "auto" else v) for k, v in changes.items()}}
            state.db.execute(
                "INSERT OR REPLACE INTO customer_prefs (customer_id, text_scale, motion, detail, tone, updated_at) "
                "VALUES ($cid, $ts, $mo, $de, $to, current_timestamp)",
                {"cid": cid, "ts": merged.get("text_scale"), "mo": merged.get("motion"),
                 "de": merged.get("detail"), "to": merged.get("tone")},
            )
    return _twin_payload(cid)


def _guidance_items(cid: int) -> list[dict]:
    c = _customer(cid)
    lang = c["language"]
    tone = _ui(cid)["tone"]
    moments = state.engine.moments()
    items = []
    for b in state.engine.beliefs(cid, lang):
        if b["state"] not in ("act", "ask", "advisor") or b["moment_id"] not in moments:
            continue
        m = moments[b["moment_id"]]
        shown = [e for e in b["evidence"] if e["source"] != "profile"]
        labels = [e["label"] for e in shown]
        intro = state.channels.intro(c, m, b["state"], lang, labels, tone=tone,
                                     signal_ids=[e["signal_id"] for e in shown], confidence=b["confidence"])
        items.append({
            "moment_id": m.id,
            "type": b["state"],
            "title": m.title.get(lang),
            "category": m.category,
            "intro": intro["text"],
            "written_by": intro["source"],
            "tone": intro["tone"],
            "parts": intro["parts"],
            "confidence": b["confidence"],
            "voice_script": state.channels.voice_script(intro["text"], m, b["state"], lang, intro["parts"]),
            "question": m.question.get(lang) if b["state"] == "ask" else None,
            "steps": [{"product": s.product, "title": s.title.get(lang), "body": s.body.get(lang)}
                      for s in m.journey] if b["state"] == "act" else [],
            "why": evidence_phrase(labels, lang) if b["feedback"] != "confirmed" else None,
            "confirmed_by_you": b["feedback"] == "confirmed",
        })
    return items


@app.get("/api/me/guidance")
def my_guidance(user: User = Depends(role("customer"))):
    rate("ai", user.username)
    return {"items": _guidance_items(user.customer_id),
            "voice": {"provider": "elevenlabs" if config.ELEVENLABS_API_KEY else "browser"}}


@app.post("/api/me/guidance/{moment_id}/voice")
def my_voice(moment_id: str = MomentId, user: User = Depends(role("customer"))):
    rate("voice", user.username)
    # Only speak messages the engine actually decided for this customer; the text is always built server-side.
    item = next((i for i in _guidance_items(user.customer_id) if i["moment_id"] == moment_id), None)
    if not item:
        raise HTTPException(404, "No active guidance for this moment")
    try:
        audio = tts(item["voice_script"])
    except Exception as exc:
        log.warning("TTS failed: %s", type(exc).__name__)
        raise HTTPException(502, "Voice service unavailable")
    if audio is None:
        raise HTTPException(503, "voice_unconfigured")
    return Response(content=audio, media_type="audio/mpeg")


# ------------------------------------------------------------------ advisor: assigned customers only


@app.get("/api/advisor/customers")
def advisor_customers(
    q: Optional[str] = Query(default=None, max_length=40, pattern=r"^[\w\- ]*$"),
    user: User = Depends(role("advisor")),
):
    params = {"aid": user.advisor_id}
    name_filter = ""
    if q:
        name_filter = " AND lower(c.first_name) LIKE $q"
        params["q"] = q.lower().replace("%", "").replace("_", "") + "%"
    return {"customers": state.db.rows(
        f"""SELECT c.customer_id, c.first_name, c.age, c.city,
               count(*) FILTER (WHERE t.state IN ('act','ask','advisor')) AS active,
               bool_or(t.state = 'advisor') AS needs_you,
               max(f.updated_at) AS last_feedback,
               list(t.moment_id ORDER BY t.priority DESC) FILTER (WHERE t.state IN ('act','ask','advisor')) AS moments
            FROM customers c JOIN twin t ON t.customer_id = c.customer_id
            LEFT JOIN feedback f ON f.customer_id = t.customer_id AND f.moment_id = t.moment_id
            WHERE c.advisor_id = $aid{name_filter}
            GROUP BY c.customer_id, c.first_name, c.age, c.city
            HAVING active > 0 OR last_feedback IS NOT NULL
            ORDER BY last_feedback DESC NULLS LAST, needs_you DESC, max(t.priority * t.confidence) DESC
            LIMIT 50""",
        params,
    )}


NOTES = {
    "advisor": "Needs a personal conversation. Automated offers are switched off for this customer (care flag).",
    "act": "The customer sees this plan in the app.",
    "ask": "The customer is being asked in the app whether this is right.",
    "suppressed_feedback": "The customer told us this is not true. Do not bring it up.",
    "deferred_fatigue": "Held back so the customer is not overloaded.",
    "blocked_guardrail": "Blocked by a guardrail.",
    "wait": "Not enough evidence. Nothing is shown to the customer.",
}


@app.get("/api/advisor/customers/{customer_id}/brief")
def advisor_brief(customer_id: int = Path(ge=1, le=100_000_000), user: User = Depends(role("advisor"))):
    c = state.db.one(
        "SELECT customer_id, first_name, age, city, language, vulnerable, consent_transactions, consent_app "
        "FROM customers WHERE customer_id = $cid AND advisor_id = $aid",
        {"cid": customer_id, "aid": user.advisor_id},
    )
    if not c:
        raise HTTPException(404, "Customer not found")  # same answer for "not yours" and "does not exist"
    moments = state.engine.moments()
    order = {"advisor": 0, "act": 1, "ask": 2, "suppressed_feedback": 3, "deferred_fatigue": 4}
    items = []
    for b in state.engine.beliefs(customer_id, "en"):
        m = moments.get(b["moment_id"])
        if not m or (b["state"] == "wait" and not b["feedback"]):
            continue
        items.append({
            "moment_id": m.id,
            "title": m.title.en,
            "state": b["state"],
            "confidence": b["confidence"],
            "feedback": b["feedback"],
            "evidence": [e["label"] for e in b["evidence"]],
            "talking_points": [s.title.en for s in m.journey] if b["state"] != "suppressed_feedback" else [],
            "note": "The customer confirmed this." if b["feedback"] == "confirmed" else NOTES.get(b["state"], ""),
        })
    items.sort(key=lambda i: (order.get(i["state"], 9), -i["confidence"]))
    open_q = sum(1 for i in items if i["state"] == "ask")
    corrected = sum(1 for i in items if i["feedback"] == "rejected")
    summary = (f"{c['first_name']} ({c['age']}, {c['city']}). {len(items)} moment(s) in view, "
               f"{open_q} open question(s) in the app, {corrected} correction(s) by the customer.")
    return {
        "customer": {"customer_id": c["customer_id"], "first_name": c["first_name"], "age": c["age"],
                     "city": c["city"], "language": c["language"], "care_flag": c["vulnerable"],
                     "consents": {"transactions": c["consent_transactions"], "app": c["consent_app"]}},
        "summary": summary,
        "items": items,
    }


# ------------------------------------------------------------------ product owner: aggregates + moment definitions


@app.get("/api/po/moments")
def po_moments(user: User = Depends(role("product_owner"))):
    custom = state.engine.custom()
    return {"moments": [{"custom": m.id in custom, "definition": m.model_dump()}
                        for m in state.engine.moments().values()]}


@app.post("/api/po/moments", status_code=201)
def po_create_moment(body: Moment, user: User = Depends(role("product_owner"))):
    rate("write", user.username)
    try:
        state.engine.add_custom(body, user.username)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    return {"created": body.id}


@app.delete("/api/po/moments/{moment_id}")
def po_delete_moment(moment_id: str = MomentId, user: User = Depends(role("product_owner"))):
    rate("write", user.username)
    if not state.engine.delete_custom(moment_id):
        raise HTTPException(404, "No custom moment with that id (built-in moments cannot be deleted)")
    return {"deleted": moment_id}


@app.post("/api/po/run")
def po_run(user: User = Depends(role("product_owner"))):
    rate("run", user.username)
    return state.engine.run_population()


@app.get("/api/po/funnel")
def po_funnel(user: User = Depends(role("product_owner"))):
    return state.engine.last_stats() or state.engine.run_population()


@app.get("/api/po/signal-kinds")
def po_signal_kinds(user: User = Depends(role("product_owner"))):
    rows = state.db.rows("SELECT source, kind, count(*) AS events FROM events GROUP BY 1, 2 ORDER BY 1, 3 DESC")
    return {"kinds": [r for r in rows if r["events"] >= config.K_ANON]}


# ------------------------------------------------------------------ feature routers (must be included before the static mount)

from .routes_explain import router as explain_router  # noqa: E402
from .routes_po import router as po_router  # noqa: E402

app.include_router(explain_router)
app.include_router(po_router)


# ------------------------------------------------------------------ static frontend (production build)

if config.WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(config.WEB_DIST), html=True), name="web")
