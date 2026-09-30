import re
from typing import Any

from conftest import login

from mirror.api import state
from mirror.explain import CHANNELS_BY_STATE, WhatIfIn


def _cid(username: str) -> int:
    row = state.db.one("SELECT customer_id FROM users WHERE username = $u", {"u": username})
    assert row is not None and row["customer_id"] is not None
    return int(row["customer_id"])


def _sig(scenario: dict[str, Any]) -> list[tuple[str, str, float]]:
    return sorted((b["moment_id"], b["state"], round(b["confidence"], 3)) for b in scenario["beliefs"])


def _checksum() -> list[Any]:
    return [
        state.db.scalar(f"SELECT count(*) || '-' || coalesce(sum(hash(t)), 0) FROM {name} t")
        for name in ("feedback", "customers", "twin", "signal_hits", "custom_moments")
    ]


def test_whatif_matches_stored_twin(client):
    rows = state.db.rows("SELECT DISTINCT customer_id FROM twin ORDER BY customer_id LIMIT 60")
    ids = {int(r["customer_id"]) for r in rows} | {_cid("sofie"), _cid("marc"), _cid("lucas")}
    assert len(ids) >= 50
    for cid in ids:
        assert _sig(state.engine.simulate(cid)) == _sig(state.engine.stored_scenario(cid)), cid


def test_twin_states_all_have_channel_policy(client):
    used = {r["state"] for r in state.db.rows("SELECT DISTINCT state FROM twin")}
    assert used <= set(CHANNELS_BY_STATE)


def test_whatif_is_read_only(client):
    h = login(client, "sofie")
    before = _checksum()
    body = {"consents": {"app": False}, "feedback": {"buying_home": "rejected"}, "signals_off": [], "max_active": 1}
    assert client.post("/api/me/whatif", json=body, headers=h).status_code == 200
    assert client.get("/api/me/theater", headers=h).status_code == 200
    assert client.get("/api/me/why-not/buying_home?target=act", headers=h).status_code == 200
    assert _checksum() == before


def test_whatif_matches_reality_for_consent_and_feedback(client):
    cid = _cid("sofie")
    wi_consent = WhatIfIn.model_validate({"consents": {"app": False}})
    predicted = _sig(state.engine.simulate(cid, wi_consent))
    state.db.execute("UPDATE customers SET consent_app = false WHERE customer_id = $c", {"c": cid})
    try:
        state.engine.refresh_customer(cid)
        assert _sig(state.engine.stored_scenario(cid)) == predicted
    finally:
        state.db.execute("UPDATE customers SET consent_app = true WHERE customer_id = $c", {"c": cid})
        state.engine.refresh_customer(cid)
    top = state.engine.stored_scenario(cid)["beliefs"][0]["moment_id"]
    for status in ("rejected", "confirmed"):
        predicted = _sig(state.engine.simulate(cid, WhatIfIn.model_validate({"feedback": {top: status}})))
        state.db.execute("INSERT OR REPLACE INTO feedback (customer_id, moment_id, status) VALUES ($c, $m, $s)",
                         {"c": cid, "m": top, "s": status})
        try:
            state.engine.refresh_customer(cid)
            assert _sig(state.engine.stored_scenario(cid)) == predicted
        finally:
            state.db.execute("DELETE FROM feedback WHERE customer_id = $c", {"c": cid})
            state.engine.refresh_customer(cid)


def test_whatif_consent_is_reduce_only(client):
    h = login(client, "lucas")
    cid = _cid("lucas")
    state.db.execute("UPDATE customers SET consent_app = false WHERE customer_id = $c", {"c": cid})
    try:
        state.engine.refresh_customer(cid)
        r = client.post("/api/me/whatif", json={"consents": {"app": True, "transactions": True}}, headers=h)
        assert r.status_code == 200
        assert r.json()["effective_consents"]["app"] is False
    finally:
        state.db.execute("UPDATE customers SET consent_app = true WHERE customer_id = $c", {"c": cid})
        state.engine.refresh_customer(cid)


def test_theater_consent_off_has_no_app_events(client):
    h = login(client, "sofie")
    cid = _cid("sofie")
    state.db.execute("UPDATE customers SET consent_app = false WHERE customer_id = $c", {"c": cid})
    try:
        state.engine.refresh_customer(cid)
        data = client.get("/api/me/theater", headers=h).json()
        assert all(e["source"] != "app" for e in data["events"])
        assert data["customer"]["consents"]["app"] is False
    finally:
        state.db.execute("UPDATE customers SET consent_app = true WHERE customer_id = $c", {"c": cid})
        state.engine.refresh_customer(cid)


def test_theater_shape_and_last_frame_matches_stored(client):
    h = login(client, "sofie")
    data = client.get("/api/me/theater", headers=h).json()
    assert 1 <= len(data["frames"]) <= 24
    assert data["channels"] == CHANNELS_BY_STATE
    last = {(b["moment_id"], b["state"]) for b in data["frames"][-1]["beliefs"]}
    stored = {(b["moment_id"], b["state"]) for b in data["final"]["beliefs"] if b["feedback"] is None}
    assert last == stored
    assert all(e["i"] == i for i, e in enumerate(data["events"]))


def test_customer_json_never_mentions_care(client):
    h = login(client, "marc")
    texts = [
        client.get("/api/me/theater", headers=h).text,
        client.post("/api/me/whatif", json={}, headers=h).text,
        client.get("/api/me/why-not/buying_home?target=act", headers=h).text,
    ]
    for t in texts:
        assert not re.search(r"vulnerab|care", t, re.IGNORECASE), t[:200]


def test_advisor_token_is_forbidden_on_customer_routes(client):
    h = login(client, "jan")
    assert client.get("/api/me/theater", headers=h).status_code == 403
    assert client.post("/api/me/whatif", json={}, headers=h).status_code == 403
    assert client.get("/api/me/why-not/buying_home", headers=h).status_code == 403


def test_whatif_bounds_and_validation(client):
    h = login(client, "sofie")
    bad = [
        {"signals_off": [f"buying_home.notary_deposit{i}" for i in range(13)]},
        {"signals_off": ["buying_home.does_not_exist"]},
        {"signals_off": ["Bad Key"]},
        {"weights": {"buying_home.notary_deposit": 0.99}},
        {"max_active": 9},
        {"as_of": "2020-01-01"},
        {"feedback": {"buying_home": "maybe"}},
        {"unknown_field": 1},
        {"thresholds": {"buying_home": {"ask": 0.9, "act": 0.5}}},
        {"care_flag": True},
    ]
    for body in bad:
        assert client.post("/api/me/whatif", json=body, headers=h).status_code == 422, body
    assert client.get("/api/me/why-not/buying_home?target=nope", headers=h).status_code == 422
    assert client.get("/api/me/why-not/no_such_moment", headers=h).status_code == 404


def test_sofie_signal_on_and_guardrail_what_if(client):
    cid = _cid("sofie")
    base = {b["moment_id"]: b for b in state.engine.stored_scenario(cid)["beliefs"]}
    assert "buying_home" in base
    sim = state.engine.simulate(cid, WhatIfIn.model_validate({"guardrails": {"buying_home": {"min_age": 100}}}))
    hb = next(b for b in sim["beliefs"] if b["moment_id"] == "buying_home")
    assert hb["state"] == "blocked_guardrail"
    assert hb["gate"] == "human_first"


def test_stats_coarse_cells_and_timings(client):
    stats = state.engine.run_population()
    assert set(stats["timings"]) == {"hits_ms", "twin_ms", "stats_ms"}
    for pm in stats["per_moment"]:
        for key in ("advisor", "deferred", "blocked", "rejected_by_customer"):
            v = pm[key]
            assert v == 0 or (isinstance(v, str) and v.startswith("<")) or (isinstance(v, int) and v % 5 == 0), (key, v)
