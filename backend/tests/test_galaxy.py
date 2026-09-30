"""The galaxy endpoint serves aggregates only: no individual rows, rounded sensitive counts, cached per run."""
import copy
import json
import re
from pathlib import Path

from conftest import login

from mirror import galaxy

EV = json.loads((Path(__file__).resolve().parent.parent / "examples" / "ev_purchase.json").read_text())
SENSITIVE = {"advisor", "deferred_fatigue", "blocked_guardrail", "suppressed_feedback"}


def _ok_sensitive(n: object) -> bool:
    return n == "<10" or (isinstance(n, int) and n % 5 == 0 and n >= 10)


def _galaxy(client) -> dict:
    r = client.get("/api/po/galaxy", headers=login(client, "po"))
    assert r.status_code == 200, r.text
    return r.json()


def test_galaxy_shape(client):
    g = _galaxy(client)
    assert g["synthetic_ground_truth"] is True
    assert g["customers"] == 4000 and g["events"] > 100_000
    assert isinstance(g["run_ms"], int) and "galaxy_ms" in g["timings"]
    assert [s["id"] for s in g["stages"]] == [
        "population", "consent", "behavioural", "above_ask", "delivered", "advisor", "fatigue"]
    assert g["stages"][0]["n"] == 4000
    assert g["no_signal"] == 4000 - g["stages"][2]["n"]
    home = next(c for c in g["clusters"] if c["moment_id"] == "buying_home")
    assert {"moment_id", "title", "custom", "priority", "thresholds", "cells", "missed", "operating_points",
            "precision", "recall", "precision_act"} <= home.keys()
    assert home["custom"] is False and home["thresholds"]["ask"] < home["thresholds"]["act"]
    assert {(c["state"], c["truth"]) for c in home["cells"]} >= {("act", "tp"), ("act", "fp"), ("ask", "tp"),
                                                                ("ask", "fp"), ("wait", "any"), ("advisor", "any")}
    assert home["operating_points"]
    cum = [p["n"] for p in home["operating_points"]]
    assert all(n >= 10 for n in cum)
    vs = [p["v"] for p in home["operating_points"]]
    assert vs == sorted(vs, reverse=True)


def test_galaxy_is_for_product_owners_only(client):
    for user in ("sofie", "an"):
        assert client.get("/api/po/galaxy", headers=login(client, user)).status_code == 403
    assert client.get("/api/po/galaxy").status_code == 401


def test_galaxy_contains_no_individual_data(client):
    text = client.get("/api/po/galaxy", headers=login(client, "po")).text
    for needle in ["first_name", "customer_id", "Sofie", "Lucas", "Marc", "username"]:
        assert needle not in text
    assert not re.search(r"\b(age|region|city)\b", text)


def test_sensitive_counts_are_rounded_and_never_split(client):
    g = _galaxy(client)
    for cluster in g["clusters"]:
        for cell in cluster["cells"]:
            if cell["state"] in SENSITIVE:
                assert cell["truth"] == "any"
                assert _ok_sensitive(cell["n"]), cell
            else:
                assert cell["n"] == 0 or cell["n"] == "<10" or cell["n"] >= 10
    stages = {s["id"]: s["n"] for s in g["stages"]}
    assert _ok_sensitive(stages["advisor"]) and _ok_sensitive(stages["fatigue"])
    for key in ("behavioural", "above_ask", "delivered"):
        assert stages[key] % 5 == 0


def test_totals_cannot_be_differenced_to_a_hidden_cell(client):
    g = _galaxy(client)
    stages = {s["id"]: s["n"] for s in g["stages"]}
    advisor_cells = [c["n"] for cl in g["clusters"] for c in cl["cells"] if c["state"] == "advisor"]
    published = sum(n for n in advisor_cells if isinstance(n, int)) + 5 * sum(1 for n in advisor_cells if isinstance(n, str))
    assert stages["advisor"] == (published if published >= 10 else "<10")
    assert all(_ok_sensitive(n) for n in advisor_cells)


def test_second_call_is_served_from_cache(client):
    _galaxy(client)
    before = galaxy.SERVICE.builds
    first = _galaxy(client)
    second = _galaxy(client)
    assert galaxy.SERVICE.builds == before
    assert first == second


def test_new_moment_and_run_refresh_the_cached_result(client):
    h = login(client, "po")
    before = _galaxy(client)
    assert "ev_galaxy" not in {c["moment_id"] for c in before["clusters"]}
    ev = copy.deepcopy(EV)
    ev["id"] = "ev_galaxy"
    assert client.post("/api/po/moments", headers=h, json=ev).status_code == 201
    try:
        assert client.post("/api/po/run", headers=h).status_code == 200
        builds = galaxy.SERVICE.builds
        after = _galaxy(client)
        assert galaxy.SERVICE.builds == builds + 1
        cluster = next(c for c in after["clusters"] if c["moment_id"] == "ev_galaxy")
        assert cluster["custom"] is True
        assert after != before
    finally:
        assert client.delete("/api/po/moments/ev_galaxy", headers=h).status_code == 200
        client.post("/api/po/run", headers=h)
    assert "ev_galaxy" not in {c["moment_id"] for c in _galaxy(client)["clusters"]}


def test_merge_points_hides_small_buckets():
    merged = galaxy.merge_points([(0.9, 12, 11), (0.8, 3, 1), (0.7, 4, 0), (0.6, 20, 2), (0.5, 2, 0)], planted=40)
    assert [p["n"] for p in merged] == [12, 29]
    assert merged[-1]["tp"] == 3
    assert all(p["n"] >= 10 for p in merged)
    assert merged[-1]["v"] == 0.5
