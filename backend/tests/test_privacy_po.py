"""Adversarial differencing against the product owner funnel: hidden small cells must not be recoverable from totals."""
from conftest import login

from mirror.api import state

PLANTED = {"buying_home": 16, "going_freelance": 13, "growing_family": 12, "moving_in_together": 4}


def _plant_advisor_cells() -> None:
    with state.db.lock:
        for moment_id, n in PLANTED.items():
            state.db.execute(
                "UPDATE twin SET state = 'advisor' WHERE (customer_id, moment_id) IN "
                "(SELECT customer_id, moment_id FROM twin WHERE moment_id = $m AND state = 'wait' ORDER BY customer_id LIMIT $n)",
                {"m": moment_id, "n": n},
            )


def _recovered_hidden_cells(funnel: dict, total_key: str, cell_key: str) -> list[int]:
    total = funnel["states"][total_key]
    cells = [r[cell_key] for r in funnel["per_moment"]]
    hidden = [c for c in cells if isinstance(c, str)]
    if not isinstance(total, int) or len(hidden) != 1:
        return []
    return [total - sum(c for c in cells if isinstance(c, int))]


def test_funnel_does_not_reveal_a_hidden_care_cell_by_differencing(client):
    try:
        _plant_advisor_cells()
        funnel = state.engine.stats(0)
        advisor_cells = {r["moment_id"]: r["advisor"] for r in funnel["per_moment"]}
        assert isinstance(advisor_cells["moving_in_together"], str) or advisor_cells["moving_in_together"] % 5 == 0
        recovered = _recovered_hidden_cells(funnel, "advisor", "advisor")
        assert PLANTED["moving_in_together"] not in recovered, (
            f"advisor total {funnel['states']['advisor']} minus visible cells reveals the hidden cell exactly")
    finally:
        client.post("/api/po/run", headers=login(client, "po"))


def test_funnel_sensitive_totals_are_rounded(client):
    try:
        _plant_advisor_cells()
        funnel = state.engine.stats(0)
        total = funnel["states"]["advisor"]
        assert isinstance(total, str) or total % 5 == 0, f"exact advisor total published: {total}"
    finally:
        client.post("/api/po/run", headers=login(client, "po"))
