"""Security properties the design promises: no IDOR, role separation, no SQL from users, consent enforced server-side."""
import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt

from conftest import login

EV = json.loads((Path(__file__).resolve().parent.parent / "examples" / "ev_purchase.json").read_text())


# ---------------------------------------------------------------- authentication

def test_requires_auth(client):
    for path in ["/api/me/twin", "/api/me/guidance", "/api/advisor/customers", "/api/po/funnel"]:
        assert client.get(path).status_code == 401


def test_wrong_password_is_generic(client):
    r1 = client.post("/api/auth/login", json={"username": "sofie", "password": "nope"})
    r2 = client.post("/api/auth/login", json={"username": "nobody", "password": "nope"})
    assert r1.status_code == r2.status_code == 401
    assert r1.json() == r2.json()  # does not reveal which usernames exist


def test_login_is_rate_limited(client):
    codes = [client.post("/api/auth/login", json={"username": "sofie", "password": "bad"}).status_code
             for _ in range(12)]
    assert 429 in codes


def test_forged_and_expired_tokens_rejected(client):
    now = datetime.now(timezone.utc)
    forged = jwt.encode({"sub": "po", "iss": "mirror", "iat": now, "exp": now + timedelta(hours=1)},
                        "wrong-secret-" + "y" * 40, algorithm="HS256")
    assert client.get("/api/po/funnel", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    import os
    expired = jwt.encode({"sub": "po", "iss": "mirror", "iat": now - timedelta(hours=2),
                          "exp": now - timedelta(hours=1)}, os.environ["MIRROR_JWT_SECRET"], algorithm="HS256")
    assert client.get("/api/po/funnel", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    unsigned = jwt.encode({"sub": "po", "iss": "mirror", "iat": now, "exp": now + timedelta(hours=1)},
                          key=None, algorithm="none")
    assert client.get("/api/po/funnel", headers={"Authorization": f"Bearer {unsigned}"}).status_code == 401


# ---------------------------------------------------------------- IDOR / authorization

def test_customer_sees_only_own_twin(client):
    sofie = client.get("/api/me/twin", headers=login(client, "sofie")).json()
    lucas = client.get("/api/me/twin", headers=login(client, "lucas")).json()
    assert sofie["customer"]["first_name"] == "Sofie"
    assert lucas["customer"]["first_name"] == "Lucas"
    assert {b["moment_id"] for b in sofie["beliefs"]} == {"buying_home", "growing_family"}
    assert {b["moment_id"] for b in lucas["beliefs"]} == {"going_freelance"}


def test_customer_cannot_use_other_roles(client):
    h = login(client, "sofie")
    assert client.get("/api/advisor/customers", headers=h).status_code == 403
    assert client.get("/api/advisor/customers/2/brief", headers=h).status_code == 403
    assert client.get("/api/po/funnel", headers=h).status_code == 403
    assert client.post("/api/po/moments", headers=h, json=EV).status_code == 403


def test_advisor_only_sees_assigned_customers(client):
    an, jan = login(client, "an"), login(client, "jan")
    assert client.get("/api/advisor/customers/1/brief", headers=an).status_code == 200   # Sofie -> An
    assert client.get("/api/advisor/customers/1/brief", headers=jan).status_code == 404  # not Jan's
    assert client.get("/api/advisor/customers/2/brief", headers=an).status_code == 404   # Lucas -> Jan
    assert client.get("/api/advisor/customers/999999/brief", headers=an).status_code == 404
    listed = client.get("/api/advisor/customers", headers=jan).json()["customers"]
    assert all(c["customer_id"] != 1 for c in listed)
    assert client.get("/api/me/twin", headers=an).status_code == 403


def test_product_owner_sees_no_personal_data(client):
    h = login(client, "po")
    funnel = client.post("/api/po/run", headers=h).text + client.get("/api/po/funnel", headers=h).text
    for name in ["Sofie", "Lucas", "Marc", "first_name", "customer_id"]:
        assert name not in funnel
    assert client.get("/api/me/twin", headers=h).status_code == 403
    assert client.get("/api/advisor/customers/1/brief", headers=h).status_code == 403


# ---------------------------------------------------------------- moment DSL: no injection

def test_moment_definition_rejects_injection_and_nonsense(client):
    h = login(client, "po")
    bad = []
    m = copy.deepcopy(EV); m["id"] = "x2"; m["signals"][0]["kind"] = "car_dealer' OR 1=1 --"; bad.append(m)
    m = copy.deepcopy(EV); m["id"] = "x3"; m["signals"][0]["within_days"] = 100000; bad.append(m)
    m = copy.deepcopy(EV); m["id"] = "x4"; m["signals"][0] = {
        "id": "p", "label": {"en": "x"}, "source": "profile", "field": "first_name", "op": "=", "value": "Sofie",
        "weight": 0.5}; bad.append(m)
    m = copy.deepcopy(EV); m["id"] = "x5"; m["sql"] = "DROP TABLE customers"; bad.append(m)
    m = copy.deepcopy(EV); m["id"] = "Robert'); DROP TABLE users;--"; bad.append(m)
    m = copy.deepcopy(EV); m["id"] = "x6"; m["thresholds"] = {"ask": 0.9, "act": 0.5}; bad.append(m)
    m = copy.deepcopy(EV); m["id"] = "x7"; m["signals"] = [{
        "id": "p", "label": {"en": "x"}, "source": "profile", "field": "age", "op": ">=", "value": 18,
        "weight": 0.5}]; bad.append(m)  # profile-only moments would target everyone of an age
    for body in bad:
        assert client.post("/api/po/moments", headers=h, json=body).status_code == 422, body["id"]
    assert client.delete("/api/po/moments/buying_home", headers=h).status_code == 404  # built-ins are protected


def test_create_run_and_delete_custom_moment(client):
    h = login(client, "po")
    assert client.post("/api/po/moments", headers=h, json=EV).status_code == 201
    assert client.post("/api/po/moments", headers=h, json=EV).status_code == 409
    stats = client.post("/api/po/run", headers=h).json()
    assert any(r["moment_id"] == "ev_purchase" for r in stats["per_moment"])
    assert client.delete("/api/po/moments/ev_purchase", headers=h).status_code == 200


# ---------------------------------------------------------------- business logic

def test_rejecting_a_belief_removes_it_everywhere(client):
    sofie, an = login(client, "sofie"), login(client, "an")
    g = client.get("/api/me/guidance", headers=sofie).json()["items"]
    assert "growing_family" in {i["moment_id"] for i in g}
    r = client.post("/api/me/beliefs/growing_family/feedback", headers=sofie,
                    json={"status": "rejected", "note": "gifts for my nephew"})
    assert r.status_code == 200
    g = client.get("/api/me/guidance", headers=sofie).json()["items"]
    assert "growing_family" not in {i["moment_id"] for i in g}
    brief = client.get("/api/advisor/customers/1/brief", headers=an).json()
    item = next(i for i in brief["items"] if i["moment_id"] == "growing_family")
    assert item["state"] == "suppressed_feedback" and item["talking_points"] == []
    client.post("/api/me/beliefs/growing_family/feedback", headers=sofie, json={"status": "clear"})


def test_confirming_turns_a_question_into_a_plan(client):
    sofie = login(client, "sofie")
    twin = client.get("/api/me/twin", headers=sofie).json()
    home = next(b for b in twin["beliefs"] if b["moment_id"] == "buying_home")
    assert home["state"] == "ask" and 0.8 <= home["confidence"] < 0.85
    client.post("/api/me/beliefs/buying_home/feedback", headers=sofie, json={"status": "confirmed"})
    items = client.get("/api/me/guidance", headers=sofie).json()["items"]
    home = next(i for i in items if i["moment_id"] == "buying_home")
    assert home["type"] == "act" and len(home["steps"]) == 3
    client.post("/api/me/beliefs/buying_home/feedback", headers=sofie, json={"status": "clear"})


def test_consent_is_enforced_by_the_engine(client):
    sofie = login(client, "sofie")
    r = client.put("/api/me/consents", headers=sofie, json={"transactions": False, "app": True}).json()
    home = next(b for b in r["beliefs"] if b["moment_id"] == "buying_home")
    assert all(e["source"] != "transactions" for e in home["evidence"])
    assert home["confidence"] < 0.6
    client.put("/api/me/consents", headers=sofie, json={"transactions": True, "app": True})


def test_vulnerable_customer_goes_to_a_human(client):
    marc = login(client, "marc")
    items = client.get("/api/me/guidance", headers=marc).json()["items"]
    assert [i["type"] for i in items] == ["advisor"]
    assert items[0]["steps"] == []  # no automated product plan


def test_feedback_on_unknown_moment_and_bad_input(client):
    sofie = login(client, "sofie")
    assert client.post("/api/me/beliefs/not_a_moment/feedback", headers=sofie,
                       json={"status": "confirmed"}).status_code == 404
    assert client.post("/api/me/beliefs/buying_home/feedback", headers=sofie,
                       json={"status": "confirmed", "customer_id": 2}).status_code == 422  # no smuggled ids
    assert client.post("/api/me/beliefs/buying_home/feedback", headers=sofie,
                       json={"status": "hacked"}).status_code == 422


def test_voice_only_for_own_active_guidance(client):
    sofie = login(client, "sofie")
    # not configured in tests -> 503; but a moment without active guidance must be 404 first
    assert client.post("/api/me/guidance/going_freelance/voice", headers=sofie).status_code == 404
    assert client.post("/api/me/guidance/buying_home/voice", headers=sofie).status_code == 503


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "default-src 'self'" in r.headers["Content-Security-Policy"]
    assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_confirming_cannot_bypass_the_care_guardrail(client):
    marc = login(client, "marc")
    client.post("/api/me/beliefs/buying_home/feedback", headers=marc, json={"status": "confirmed"})
    items = client.get("/api/me/guidance", headers=marc).json()["items"]
    home = next(i for i in items if i["moment_id"] == "buying_home")
    assert home["type"] == "advisor" and home["steps"] == []  # still a human conversation, never an automated plan
    client.post("/api/me/beliefs/buying_home/feedback", headers=marc, json={"status": "clear"})
