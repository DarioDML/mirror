"""Password hashing, JWT tokens and rate limiting. Standard library + PyJWT only."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt

from . import config

# ---------------------------------------------------------------- passwords (scrypt)
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return "scrypt${}${}${}${}${}".format(
        _N, _R, _P, base64.b64encode(salt).decode(), base64.b64encode(digest).decode()
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(digest_b64)
        digest = hashlib.scrypt(password.encode(), salt=salt, n=int(n), r=int(r), p=int(p), dklen=len(expected))
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


# A real hash to verify against when the user does not exist, so timing does not reveal valid usernames.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))

# ---------------------------------------------------------------- tokens (JWT, HS256)


def create_token(username: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "iss": config.JWT_ISSUER,
        "iat": now,
        "exp": now + timedelta(minutes=config.TOKEN_TTL_MINUTES),
        "jti": secrets.token_urlsafe(8),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm="HS256")


def decode_token(token: str) -> dict:
    """Raises jwt.PyJWTError on anything suspicious. Algorithm is pinned: no 'none', no RS/HS confusion."""
    return jwt.decode(
        token,
        config.JWT_SECRET,
        algorithms=["HS256"],
        issuer=config.JWT_ISSUER,
        options={"require": ["exp", "iat", "sub", "iss"]},
    )


# ---------------------------------------------------------------- rate limiting (in-memory sliding window)


_MAX_KEYS = 5000
_MAX_WINDOW_S = 60.0


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_s: float) -> bool:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > _MAX_KEYS:
                self._prune(now)
            q = self._hits[key]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def blocked(self, key: str, limit: int, window_s: float) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                return False
            while q and now - q[0] > window_s:
                q.popleft()
            return len(q) >= limit

    def record(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > _MAX_KEYS:
                self._prune(now)
            self._hits[key].append(now)

    def _prune(self, now: float) -> None:
        for k in [k for k, q in self._hits.items() if not q or now - q[-1] > _MAX_WINDOW_S]:
            del self._hits[k]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()

# bucket name -> (limit, window seconds)
LIMITS = {
    "login_user": (10, 60),   # failed attempts per username, whatever the address
    "login_ip": (120, 60),    # attempts per client address (generous: many users can share one address)
    "ai": (30, 60),           # AI-written messages per user
    "voice": (6, 60),         # text-to-speech per user (costly)
    "run": (6, 60),           # full population runs per product owner
    "write": (60, 60),        # feedback / consent changes per user
    "sim": (120, 60),         # what-if simulations per user (read-only, debounced sliders)
    "theater": (20, 60),      # reasoning-theater replays per user
    "whynot": (60, 60),       # why-not explanations per user
    "galaxy": (30, 60),       # population galaxy reads per product owner
}


def check_rate(bucket: str, key: str) -> bool:
    limit, window = LIMITS[bucket]
    return limiter.allow(f"{bucket}:{key}", limit, window)


def login_blocked(username: str) -> bool:
    limit, window = LIMITS["login_user"]
    return limiter.blocked(f"login_user:{username}", limit, window)


def login_failed(username: str) -> None:
    limiter.record(f"login_user:{username}")
