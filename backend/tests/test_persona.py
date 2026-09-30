"""Persona derivation: golden payloads, constant key set, no care leakage, overrides never change decisions."""
import json

from conftest import login

from mirror.persona import Ui, derive

BASE = dict(age=40, household_size=2, language="en", top_category=None, top_state=None, confidence=0.0,
            consent_app=True, app_events_180d=0, care=False)


def ui(**kw) -> Ui:
    return derive(**{**BASE, **kw})


def test_care_input_selects_calm_presentation_and_ignores_age():
    for age in (20, 44, 80):
        u = ui(care=True, age=age, top_category="work", app_events_180d=30)
        assert (u["layout"], u["theme"], u["density"], u["text_scale"], u["motion"], u["tone"], u["register"],
                u["math"]) == ("guided", "linen", "airy", 1.25, "none", "reassuring", "formal", "hidden")


def test_work_with_app_engagement_gets_studio_only_with_consent():
    assert ui(top_category="work", app_events_180d=20)["layout"] == "studio"
    assert ui(top_category="work", app_events_180d=11)["layout"] == "guided"
    assert ui(top_category="work", app_events_180d=20, consent_app=False)["layout"] == "guided"


def test_young_mover_and_default_rules():
    q = ui(age=23, top_category="household", top_state="act")
    assert (q["layout"], q["theme"], q["motion"], q["tone"], q["emphasis"]) == ("quick", "pop", "lively", "playful", "plan")
    d = ui(age=50, top_category="family", top_state="ask")
    assert (d["layout"], d["theme"], d["tone"], d["math"], d["accent"], d["emphasis"]) == (
        "guided", "daylight", "neutral", "summary", "family", "question")
    assert ui(age=25, top_category="family")["tone"] == "playful"
    assert ui()["accent"] == "other" and ui()["emphasis"] == "overview"


def test_key_set_is_constant_and_has_no_care_marker():
    sets = {tuple(sorted(ui(care=c, age=a, top_category=t)))
            for c in (True, False) for a in (20, 70) for t in (None, "work", "housing")}
    assert len(sets) == 1
    dumped = json.dumps(ui(care=True)).lower()
    assert "care" not in dumped and "vulnerable" not in dumped


def test_overrides_change_presentation_only_and_auto_flags_follow():
    u = ui(care=True, overrides={"text_scale": "s", "motion": "subtle", "detail": "full", "tone": "playful"})
    assert (u["text_scale"], u["motion"], u["math"], u["tone"]) == (1.0, "subtle", "full", "playful")
    assert u["auto"] == {"text_scale": False, "motion": False, "detail": False, "tone": False}
    back = ui(care=True, overrides={"text_scale": "auto", "tone": "auto"})
    assert back["text_scale"] == 1.25 and back["tone"] == "reassuring" and back["auto"]["tone"] is True


def test_golden_demo_customers(client):
    sofie = client.get("/api/me/twin", headers=login(client, "sofie")).json()
    lucas = client.get("/api/me/twin", headers=login(client, "lucas")).json()
    marc = client.get("/api/me/twin", headers=login(client, "marc")).json()
    assert sofie["as_of"] and sofie["ui"]["layout"] == "guided" and sofie["ui"]["theme"] == "daylight"
    assert sofie["ui"]["math"] == "summary" and sofie["ui"]["tone"] == "neutral"
    assert lucas["ui"]["layout"] == "studio" and lucas["ui"]["density"] == "compact" and lucas["ui"]["tone"] == "direct"
    assert marc["ui"]["theme"] == "linen" and marc["ui"]["text_scale"] == 1.25 and marc["ui"]["math"] == "hidden"
    assert marc["ui"]["tone"] == "reassuring" and marc["ui"]["motion"] == "none"
    assert set(sofie["ui"]) == set(lucas["ui"]) == set(marc["ui"])


def test_customer_json_never_names_care(client):
    for user in ("sofie", "lucas", "marc"):
        h = login(client, user)
        for path in ("/api/me", "/api/me/twin", "/api/me/guidance"):
            text = json.dumps(client.get(path, headers=h).json()).lower()
            assert "vulnerable" not in text and "care" not in text


def test_preferences_persist_and_validate(client):
    h = login(client, "sofie")
    r = client.put("/api/me/preferences", headers=h, json={"text_scale": "l", "tone": "reassuring"})
    assert r.status_code == 200 and r.json()["ui"]["text_scale"] == 1.25 and r.json()["ui"]["tone"] == "reassuring"
    again = client.get("/api/me/twin", headers=h).json()["ui"]
    assert again["text_scale"] == 1.25 and again["auto"]["text_scale"] is False and again["auto"]["motion"] is True
    assert client.get("/api/me/guidance", headers=h).json()["items"][0]["tone"] == "reassuring"
    reset = client.put("/api/me/preferences", headers=h, json={"text_scale": "auto", "tone": "auto"}).json()["ui"]
    assert reset["text_scale"] == 1.0 and reset["auto"]["tone"] is True
    assert client.put("/api/me/preferences", headers=h, json={}).status_code == 422
    assert client.put("/api/me/preferences", headers=h, json={"theme": "dark"}).status_code == 422
    assert client.put("/api/me/preferences", headers=h, json={"motion": "lively"}).status_code == 422
    assert client.put("/api/me/preferences", headers=h, json={"language": "fr"}).json()["customer"]["language"] == "fr"
    client.put("/api/me/preferences", headers=h, json={"language": "en"})


def test_overrides_never_change_decisions(client):
    h = login(client, "marc")
    before = client.get("/api/me/guidance", headers=h).json()["items"]
    client.put("/api/me/preferences", headers=h,
               json={"text_scale": "s", "motion": "subtle", "detail": "full", "tone": "playful"})
    after = client.get("/api/me/guidance", headers=h).json()["items"]
    client.put("/api/me/preferences", headers=h,
               json={"text_scale": "auto", "motion": "auto", "detail": "auto", "tone": "auto"})
    assert [(i["moment_id"], i["type"]) for i in before] == [(i["moment_id"], i["type"]) for i in after]
    assert all(i["type"] == "advisor" and i["steps"] == [] for i in after)
