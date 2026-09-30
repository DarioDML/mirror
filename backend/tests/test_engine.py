"""The engine behaves the same for one customer as for the whole population, and respects its policies."""
from conftest import login


def test_population_run_and_quality_metrics(client):
    stats = client.post("/api/po/run", headers=login(client, "po")).json()
    assert stats["customers"] == 4000 and stats["events"] > 100_000
    assert 0 < stats["messages_to_write"] < stats["customers"]  # the AI tier only runs for a small share
    assert stats["scale"]["target_customers"] == 2_300_000
    home = next(r for r in stats["per_moment"] if r["moment_id"] == "buying_home")
    assert home["recall"] is not None


def test_fatigue_cap(client):
    from mirror.api import state
    from mirror import config
    worst = state.db.scalar(
        "SELECT max(n) FROM (SELECT count(*) AS n FROM twin WHERE state IN ('act','ask') GROUP BY customer_id)")
    assert worst <= config.MAX_ACTIVE


def test_single_customer_refresh_matches_population(client):
    from mirror.api import state
    before = state.db.rows("SELECT moment_id, round(confidence, 6) c, state FROM twin WHERE customer_id = 1 ORDER BY 1")
    state.engine.refresh_customer(1)
    after = state.db.rows("SELECT moment_id, round(confidence, 6) c, state FROM twin WHERE customer_id = 1 ORDER BY 1")
    assert before == after


def test_guidance_falls_back_to_templates_without_ai(client):
    items = client.get("/api/me/guidance", headers=login(client, "lucas")).json()["items"]
    assert items and all(i["written_by"] == "template" for i in items)
    assert "Lucas" in items[0]["intro"]
