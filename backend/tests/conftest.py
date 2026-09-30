import os
import tempfile
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp(prefix="mirror-test-"))
os.environ["MIRROR_DB_PATH"] = str(_tmp / "test.duckdb")
os.environ["DEMO_PASSWORD"] = "correct-horse-battery"
os.environ["MIRROR_JWT_SECRET"] = "test-secret-" + "x" * 40
os.environ["MIRROR_WEB_DIST"] = str(_tmp / "no-web")
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("GOOGLE_CLOUD_PROJECT", None)
os.environ.pop("ELEVENLABS_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from mirror.generate import generate  # noqa: E402
from mirror.security import limiter  # noqa: E402

PASSWORD = os.environ["DEMO_PASSWORD"]


@pytest.fixture(scope="session")
def client():
    generate(4000, seed=7, demo_password=PASSWORD)
    from mirror.api import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_limits():
    limiter.reset()
    yield


def login(client, username, password=PASSWORD):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
