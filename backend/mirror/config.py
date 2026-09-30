"""Runtime configuration. Everything secret comes from environment variables (or a local .env)."""
from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

log = logging.getLogger("mirror")

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


def _load_dotenv() -> None:
    """Tiny .env loader (no extra dependency). Real environment variables always win."""
    for candidate in (REPO_DIR / ".env", BACKEND_DIR / ".env"):
        if not candidate.is_file():
            continue
        for raw in candidate.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and value and key not in os.environ:
                os.environ[key] = value


_load_dotenv()

ENV = (os.getenv("MIRROR_ENV") or "dev")
DB_PATH = Path((os.getenv("MIRROR_DB_PATH") or str(BACKEND_DIR / "data" / "mirror.duckdb")))
MOMENTS_DIR = BACKEND_DIR / "moments"
WEB_DIST = Path((os.getenv("MIRROR_WEB_DIST") or str(REPO_DIR / "web" / "dist")))

# The synthetic world ends on this date; all "within N days" signals are relative to it.
SIM_NOW = (os.getenv("MIRROR_SIM_NOW") or "2026-09-30")
SIM_DAYS = 180

# Orchestrator policy
MAX_ACTIVE = int((os.getenv("MIRROR_MAX_ACTIVE") or "2"))  # max act/ask items shown to one customer at once
MAX_CUSTOM_MOMENTS = 20

# Auth
TOKEN_TTL_MINUTES = int((os.getenv("MIRROR_TOKEN_TTL_MINUTES") or "60"))
_secret = (os.getenv("MIRROR_JWT_SECRET") or "")
if len(_secret) < 32:
    if ENV != "dev":
        raise RuntimeError("MIRROR_JWT_SECRET must be set (>= 32 chars) outside dev")
    log.warning("MIRROR_JWT_SECRET not set (or too short): using a random per-process secret")
    _secret = secrets.token_urlsafe(48)
JWT_SECRET = _secret
JWT_ISSUER = "mirror"

CORS_ORIGINS = [o.strip() for o in (os.getenv("MIRROR_CORS_ORIGINS") or "http://localhost:5173").split(",") if o.strip()]

# Privacy: aggregate counts below this are hidden from product owners
K_ANON = 10

# AI tier (optional). Without keys the app falls back to templates.
GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "")
GOOGLE_CLOUD_PROJECT = (os.getenv("GOOGLE_CLOUD_PROJECT") or "")
GOOGLE_CLOUD_LOCATION = (os.getenv("GOOGLE_CLOUD_LOCATION") or "europe-west1")
GEMINI_MODEL = (os.getenv("GEMINI_MODEL") or "gemini-2.5-flash")

# Voice channel (optional)
ELEVENLABS_API_KEY = (os.getenv("ELEVENLABS_API_KEY") or "")
ELEVENLABS_VOICE_ID = (os.getenv("ELEVENLABS_VOICE_ID") or "21m00Tcm4TlvDq8ikWAM")
ELEVENLABS_MODEL = (os.getenv("ELEVENLABS_MODEL") or "eleven_multilingual_v2")

# Scale story: numbers used for the extrapolation card
TARGET_CUSTOMERS = 2_300_000
AVG_TOKENS_PER_MESSAGE = int((os.getenv("MIRROR_AVG_TOKENS_PER_MESSAGE") or "350"))
_price = os.getenv("MIRROR_LLM_EUR_PER_1K_TOKENS", "")
LLM_EUR_PER_1K_TOKENS: float | None = float(_price) if _price else None
