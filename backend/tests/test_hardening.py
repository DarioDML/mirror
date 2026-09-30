"""Offline copy, cache invalidation, login limits and voice fallback."""
import itertools

from conftest import PASSWORD, login

from mirror import copybank
from mirror.security import limiter

EVIDENCE = {
    "en": ("a transfer to a notary", "a mortgage simulation in the app", "a look at home insurance"),
    "nl": ("een overschrijving naar een notaris", "een woonkredietsimulatie in de app", "interesse in een woningverzekering"),
    "fr": ("un virement à un notaire", "une simulation de crédit hypothécaire dans l'app", "un intérêt pour une assurance habitation"),
}


def test_copybank_sandbox_rules_for_every_combination():
    for lang, tone, st, conf, n in itertools.product(
            copybank.LANGS, copybank.TONE_NAMES, copybank.STATES, (0.3, 0.6, 0.7, 0.82, 1.0), (0, 1, 2, 3)):
        facts = copybank.Facts(7, "Sofie", lang, st, tone, "buying_home", conf, EVIDENCE[lang][:n], 3, "sig")
        text = copybank.render(facts)
        assert copybank.is_valid(text), (lang, tone, st, conf, n, text)
        assert "Sofie" in text


def test_copybank_french_uses_elision_and_is_deterministic():
    facts = copybank.Facts(3, "Marc", "fr", "ask", "neutral", "buying_home", 0.874, EVIDENCE["fr"], 3, "sig")
    text = copybank.render(facts)
    assert "d'après un virement" in text and "sur la base de un" not in text.lower()
    assert copybank.render(facts) == text


def test_long_evidence_is_shortened_not_truncated():
    long = tuple("x" * 120 for _ in range(3))
    facts = copybank.Facts(1, "Lucas", "nl", "ask", "neutral", "m", 0.9, long, 3, "s")
    assert copybank.is_valid(copybank.render(facts))


def test_parts_mark_facts_tone_and_rule_words():
    facts = copybank.Facts(1, "Sofie", "en", "ask", "neutral", "m", 0.82, EVIDENCE["en"][:2], 3, "s")
    kinds = {k for _, k in copybank.compose(facts)}
    assert kinds == {"fact", "tone", "rule"}


def test_guidance_shape_and_voice_fallback(client):
    h = login(client, "sofie")
    g = client.get("/api/me/guidance", headers=h).json()
    assert g["voice"] == {"provider": "browser"}
    item = g["items"][0]
    assert item["written_by"] == "template" and item["tone"] and item["parts"] and item["voice_script"]
    assert item["voice_script"].count("?") <= 1
    r = client.post(f"/api/me/guidance/{item['moment_id']}/voice", headers=h)
    assert r.status_code == 503 and r.json() == {"detail": "voice_unconfigured"}


def test_withdrawing_consent_removes_the_signal_from_the_text(client):
    h = login(client, "sofie")
    before = client.get("/api/me/guidance", headers=h).json()["items"]
    home = next(i for i in before if i["moment_id"] == "buying_home")
    assert "mortgage simulation" in home["intro"]
    client.put("/api/me/consents", headers=h, json={"transactions": True, "app": False})
    after = client.get("/api/me/guidance", headers=h).json()["items"]
    text = next(i["intro"] for i in after if i["moment_id"] == "buying_home")
    client.put("/api/me/consents", headers=h, json={"transactions": True, "app": True})
    assert "mortgage simulation" not in text


def test_login_lockout_is_per_username_not_per_address(client):
    for _ in range(12):
        client.post("/api/auth/login", json={"username": "sofie", "password": "bad"})
    assert client.post("/api/auth/login", json={"username": "sofie", "password": PASSWORD}).status_code == 429
    assert client.post("/api/auth/login", json={"username": "lucas", "password": PASSWORD}).status_code == 200
    limiter.reset()


def test_forwarded_header_does_not_change_the_bucket(client):
    for i in range(130):
        client.post("/api/auth/login", json={"username": f"nobody{i}", "password": "x"},
                    headers={"X-Forwarded-For": f"10.0.0.{i % 250}"})
    r = client.post("/api/auth/login", json={"username": "lucas", "password": PASSWORD},
                    headers={"X-Forwarded-For": "8.8.8.8"})
    assert r.status_code == 429
    limiter.reset()


def test_preferences_require_customer_role(client):
    assert client.put("/api/me/preferences", headers=login(client, "an"), json={"language": "en"}).status_code == 403
