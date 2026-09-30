"""Synthetic population generator.

Creates N fake customers with ~6 months of transactions and app events. Hidden inside the noise are
"life scripts" (buying a home, moving in together, a growing family, going freelance, buying an EV)
that emit correlated but incomplete signals. The planted scripts are stored in a `truth` table so the
engine's detection quality can be measured honestly (precision / recall) instead of claimed.

There are also confounders on purpose: people who buy toys as gifts, people who already own an EV.

Usage:  python -m mirror.generate --customers 100000
"""
from __future__ import annotations

import argparse
import os
import secrets
import time

import numpy as np
import pandas as pd
import pyarrow as pa

from . import config
from .db import DB, ensure_app_tables
from .security import hash_password

# kind -> (probability, mean amount EUR, lognormal sigma)
TX_KINDS: dict[str, tuple[float, float, float]] = {
    "groceries": (0.26, 45, 0.6),
    "restaurants": (0.11, 35, 0.5),
    "fuel": (0.07, 60, 0.3),
    "public_transport": (0.05, 20, 0.5),
    "utilities": (0.05, 120, 0.4),
    "rent": (0.04, 850, 0.3),
    "clothing": (0.07, 60, 0.6),
    "online_shopping": (0.10, 40, 0.8),
    "subscriptions": (0.06, 15, 0.5),
    "electronics": (0.03, 180, 0.8),
    "travel": (0.03, 400, 0.7),
    "leisure": (0.05, 40, 0.6),
    "toy_store": (0.010, 30, 0.5),
    "furniture": (0.010, 220, 0.8),
    "baby_store": (0.0012, 40, 0.5),
    "ev_charging": (0.0008, 15, 0.4),
    "car_dealer": (0.0005, 900, 1.0),
    "notary": (0.0004, 250, 0.7),
    "moving_company": (0.0004, 300, 0.6),
    "business_registration": (0.0002, 90, 0.2),
    "accounting_software": (0.0008, 25, 0.3),
}
APP_KINDS: dict[str, float] = {
    "login": 0.45,
    "view_accounts": 0.20,
    "payments": 0.12,
    "view_savings": 0.08,
    "view_investments": 0.05,
    "view_cards": 0.05,
    "mortgage_simulation": 0.002,
    "view_home_insurance": 0.004,
    "view_joint_account": 0.003,
    "view_child_savings": 0.002,
    "view_business_account": 0.002,
    "view_car_insurance": 0.004,
}

REGIONS = {
    "flanders": (0.58, ["Gent", "Antwerpen", "Leuven", "Brugge", "Mechelen", "Hasselt", "Kortrijk", "Aalst"]),
    "wallonia": (0.31, ["Liège", "Namur", "Charleroi", "Mons", "Wavre", "Tournai"]),
    "brussels": (0.11, ["Brussel", "Schaerbeek", "Ixelles", "Etterbeek", "Jette"]),
}
NAMES = {
    "nl": ["Lotte", "Emma", "Noah", "Lucas", "Liam", "Elise", "Jana", "Wout", "Arne", "Fien", "Lars", "Ruben",
           "Hanne", "Jef", "Nina", "Stijn", "Lien", "Bram", "Sara", "Tom", "Ann", "Koen", "Eline", "Pieter"],
    "fr": ["Camille", "Louis", "Chloé", "Hugo", "Manon", "Arthur", "Léa", "Jules", "Inès", "Nathan", "Clara",
           "Théo", "Julie", "Maxime", "Sarah", "Antoine", "Pauline", "Martin"],
    "en": ["Alex", "Sam", "Chris", "Taylor", "Jordan", "Robin", "Maya", "Daniel"],
}

# Life scripts: moment_id -> (eligibility, base rate, center window (days ago), emitted signals)
# signal spec: (source, kind, probability, (min_count, max_count), (offset_lo, offset_hi), amount_mean, sigma)
# offset > 0 means "before the life event", offset < 0 "after it". Events that would be in the future are dropped.
SCRIPTS = {
    "buying_home": dict(
        age=(25, 55), rate=0.025, center=(10, 150),
        signals=[
            ("transactions", "notary", 0.85, (1, 1), (-3, 3), 9000, 0.6),
            ("app", "mortgage_simulation", 0.75, (1, 4), (5, 60), None, None),
            ("app", "view_home_insurance", 0.50, (1, 2), (-20, 10), None, None),
            ("transactions", "furniture", 0.40, (1, 3), (-60, -5), 450, 0.7),
        ],
    ),
    "moving_in_together": dict(
        age=(21, 40), rate=0.03, center=(10, 150), max_household=2,
        signals=[
            ("transactions", "furniture", 0.70, (1, 3), (-30, 5), 400, 0.7),
            ("transactions", "moving_company", 0.45, (1, 1), (-3, 3), 450, 0.5),
            ("app", "view_joint_account", 0.65, (1, 3), (-30, 0), None, None),
        ],
    ),
    "growing_family": dict(
        age=(24, 42), rate=0.02, center=(10, 170),
        signals=[
            ("transactions", "baby_store", 0.80, (2, 6), (-60, 30), 60, 0.6),
            ("app", "view_child_savings", 0.50, (1, 2), (-60, 0), None, None),
            ("transactions", "toy_store", 0.30, (1, 3), (-60, 0), 30, 0.5),
        ],
    ),
    "going_freelance": dict(
        age=(23, 60), rate=0.012, center=(10, 150),
        signals=[
            ("transactions", "business_registration", 0.70, (1, 1), (-2, 2), 95, 0.15),
            ("app", "view_business_account", 0.70, (1, 4), (-30, 10), None, None),
            ("transactions", "accounting_software", 0.60, (1, 5), (-150, -5), 25, 0.2),
        ],
    ),
    "ev_purchase": dict(
        age=(25, 70), rate=0.02, center=(10, 150),
        signals=[
            ("transactions", "car_dealer", 0.60, (1, 1), (-3, 3), 35000, 0.35),
            ("transactions", "ev_charging", 0.85, (3, 12), (-120, -1), 14, 0.5),
            ("app", "view_car_insurance", 0.50, (1, 3), (-30, 10), None, None),
        ],
    ),
}


def _events_frame(cids, days_ago, source, kinds, amounts) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "customer_id": np.asarray(cids, dtype=np.int32),
            "days_ago": np.asarray(days_ago, dtype=np.int16),
            "source": source,
            "kind": np.asarray(kinds, dtype=object),
            "amount": np.asarray(amounts, dtype=np.float64) if amounts is not None else np.nan,
        }
    )


def _background(rng: np.random.Generator, n: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    ids = np.arange(1, n + 1, dtype=np.int32)
    activity = rng.lognormal(0, 0.35, n)

    tx_names = list(TX_KINDS)
    p = np.array([TX_KINDS[k][0] for k in tx_names])
    tx_names.append("other")
    p = np.append(p, max(0.0, 1 - p.sum()))
    p = p / p.sum()
    means = np.array([TX_KINDS[k][1] for k in tx_names[:-1]] + [30])
    sigmas = np.array([TX_KINDS[k][2] for k in tx_names[:-1]] + [0.8])

    counts = rng.poisson(45 * activity)
    cid = np.repeat(ids, counts)
    k = rng.choice(len(tx_names), size=cid.size, p=p)
    days = rng.integers(0, config.SIM_DAYS, cid.size)
    amt = np.round(np.exp(np.log(means[k]) + sigmas[k] * rng.standard_normal(cid.size)), 2)
    tx = _events_frame(cid, days, "transactions", np.array(tx_names, dtype=object)[k], amt)

    app_names = list(APP_KINDS)
    pa = np.array([APP_KINDS[k] for k in app_names])
    app_names.append("other_app")
    pa = np.append(pa, max(0.0, 1 - pa.sum()))
    pa = pa / pa.sum()
    counts = rng.poisson(12 * activity)
    cid = np.repeat(ids, counts)
    k = rng.choice(len(app_names), size=cid.size, p=pa)
    days = rng.integers(0, config.SIM_DAYS, cid.size)
    app = _events_frame(cid, days, "app", np.array(app_names, dtype=object)[k], None)
    return tx, app


def _emit(rng, cids, centers, spec) -> pd.DataFrame | None:
    source, kind, prob, (cmin, cmax), (olo, ohi), amean, asig = spec
    mask = rng.random(cids.size) < prob
    sel, cen = cids[mask], centers[mask]
    if sel.size == 0:
        return None
    reps = rng.integers(cmin, cmax + 1, sel.size)
    c = np.repeat(sel, reps)
    days = np.repeat(cen, reps) + rng.integers(olo, ohi + 1, c.size)
    keep = (days >= 0) & (days < config.SIM_DAYS)
    c, days = c[keep], days[keep]
    amt = None
    if amean is not None:
        amt = np.round(np.exp(np.log(amean) + asig * rng.standard_normal(c.size)), 2)
    return _events_frame(c, days, source, np.full(c.size, kind, dtype=object), amt)


def _plant(rng, customers: pd.DataFrame) -> tuple[list[pd.DataFrame], pd.DataFrame]:
    frames, truth = [], []
    for moment_id, s in SCRIPTS.items():
        lo, hi = s["age"]
        elig = (customers.age >= lo) & (customers.age <= hi)
        if "max_household" in s:
            elig &= customers.household_size <= s["max_household"]
        pool = customers.customer_id[elig].to_numpy()
        chosen = pool[rng.random(pool.size) < s["rate"]]
        centers = rng.integers(s["center"][0], s["center"][1] + 1, chosen.size)
        truth.append(pd.DataFrame({"customer_id": chosen, "moment_id": moment_id, "days_ago": centers}))
        for spec in s["signals"]:
            f = _emit(rng, chosen, centers, spec)
            if f is not None:
                frames.append(f)

    # Confounders: gift buyers (toys, sometimes a baby shop) and existing EV owners.
    ids = customers.customer_id.to_numpy()
    gifts = ids[(rng.random(ids.size) < 0.015) & (customers.age.to_numpy() >= 20)]
    g_centers = rng.integers(20, 160, gifts.size)
    for spec in [("transactions", "toy_store", 1.0, (2, 4), (-20, 20), 35, 0.5),
                 ("transactions", "baby_store", 0.25, (1, 1), (-20, 20), 45, 0.4)]:
        f = _emit(rng, gifts, g_centers, spec)
        if f is not None:
            frames.append(f)
    owners = ids[rng.random(ids.size) < 0.03]
    f = _emit(rng, owners, np.full(owners.size, 90), ("transactions", "ev_charging", 1.0, (4, 15), (-89, 89), 14, 0.5))
    if f is not None:
        frames.append(f)
    return frames, pd.concat(truth, ignore_index=True)


def _customers(rng: np.random.Generator, n: int) -> pd.DataFrame:
    ids = np.arange(1, n + 1, dtype=np.int32)
    region_names = list(REGIONS)
    region = rng.choice(region_names, size=n, p=[REGIONS[r][0] for r in region_names])
    lang = np.where(region == "flanders", "nl", "fr").astype(object)
    bxl = region == "brussels"
    lang[bxl] = rng.choice(["fr", "nl", "en"], size=bxl.sum(), p=[0.7, 0.2, 0.1])
    city = np.array([rng.choice(REGIONS[r][1]) for r in region], dtype=object)
    first = np.array([rng.choice(NAMES[l]) for l in lang], dtype=object)
    age = np.clip(rng.normal(46, 16, n), 18, 90).astype(np.int16)
    household = np.clip(rng.poisson(1.4, n) + 1, 1, 6).astype(np.int16)
    n_adv = max(2, n // 2000)
    return pd.DataFrame(
        {
            "customer_id": ids,
            "first_name": first,
            "age": age,
            "region": region,
            "city": city,
            "language": lang,
            "household_size": household,
            "vulnerable": rng.random(n) < 0.02,
            "consent_transactions": rng.random(n) < 0.92,
            "consent_app": rng.random(n) < 0.85,
            "advisor_id": ((ids - 1) % n_adv + 1).astype(np.int32),
        }
    )


def _demo_customers(customers: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Three hand-written customers used in the demo. Their generated history is replaced."""
    demo = {
        1: dict(first_name="Sofie", age=31, region="flanders", city="Gent", language="en", household_size=2,
                vulnerable=False, consent_transactions=True, consent_app=True, advisor_id=1),
        2: dict(first_name="Lucas", age=27, region="flanders", city="Antwerpen", language="nl", household_size=1,
                vulnerable=False, consent_transactions=True, consent_app=True, advisor_id=2),
        3: dict(first_name="Marc", age=44, region="wallonia", city="Liège", language="fr", household_size=3,
                vulnerable=True, consent_transactions=True, consent_app=True, advisor_id=1),
    }
    for cid, vals in demo.items():
        for k, v in vals.items():
            customers.loc[customers.customer_id == cid, k] = v

    rows: list[tuple] = []
    def add(cid, days, source, kind, amount=None):
        rows.append((cid, days, source, kind, np.nan if amount is None else amount))

    for cid in demo:
        for m in range(6):  # a plain monthly life
            add(cid, 5 + 30 * m, "transactions", "rent", 780.0)
            add(cid, 8 + 30 * m, "transactions", "utilities", 95.0)
            add(cid, 12 + 30 * m, "transactions", "subscriptions", 12.99)
            for d in (2, 9, 16, 23):
                add(cid, d + 30 * m, "transactions", "groceries", 38.5 + d)
            add(cid, 19 + 30 * m, "transactions", "restaurants", 42.0)
            for d in (1, 11, 21):
                add(cid, d + 30 * m, "app", "login")
    # Sofie: buying a home (true) ... and toy/baby purchases that are gifts for her nephew (a false lead)
    add(1, 20, "transactions", "notary", 4500.0)
    add(1, 35, "app", "mortgage_simulation")
    add(1, 28, "app", "mortgage_simulation")
    for d in (60, 45, 12):
        add(1, d, "transactions", "toy_store", 29.95)
    add(1, 40, "transactions", "baby_store", 54.0)
    # Lucas: going freelance (true)
    add(2, 25, "transactions", "business_registration", 94.5)
    add(2, 22, "app", "view_business_account")
    add(2, 10, "app", "view_business_account")
    add(2, 14, "transactions", "accounting_software", 24.0)
    # Marc: buying a home (true), but flagged as needing care -> must go to a human, never an automated offer
    add(3, 30, "transactions", "notary", 12000.0)
    add(3, 45, "app", "mortgage_simulation")
    add(3, 26, "app", "view_home_insurance")

    ev = pd.DataFrame(rows, columns=["customer_id", "days_ago", "source", "kind", "amount"])
    truth = pd.DataFrame(
        [(1, "buying_home", 20), (2, "going_freelance", 25), (3, "buying_home", 30)],
        columns=["customer_id", "moment_id", "days_ago"],
    )
    return ev, truth


def generate(n: int, seed: int, demo_password: str | None) -> dict:
    t0 = time.perf_counter()
    rng = np.random.default_rng(seed)
    customers = _customers(rng, n)
    tx, app = _background(rng, n)
    planted, truth = _plant(rng, customers)
    demo_events, demo_truth = _demo_customers(customers)

    events = pd.concat([tx, app, *planted], ignore_index=True)
    events = events[~events.customer_id.isin([1, 2, 3])]
    events = pd.concat([events, demo_events], ignore_index=True)
    truth = pd.concat([truth[~truth.customer_id.isin([1, 2, 3])], demo_truth], ignore_index=True)
    truth = truth.drop_duplicates(["customer_id", "moment_id"])

    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("", ".wal"):
        p = config.DB_PATH.with_name(config.DB_PATH.name + suffix)
        if p.exists():
            p.unlink()
    db = DB(config.DB_PATH)
    con = db.con
    # Hand DuckDB Arrow tables: works the same on pandas 2 and 3 (pandas 2 keeps numpy strings DuckDB can't read)
    con.register("customers_df", pa.Table.from_pandas(customers, preserve_index=False))
    con.register("events_df", pa.Table.from_pandas(events, preserve_index=False))
    con.register("truth_df", pa.Table.from_pandas(truth, preserve_index=False))
    con.execute("""CREATE TABLE customers AS SELECT customer_id::INTEGER AS customer_id, first_name::VARCHAR AS first_name,
        age::INTEGER AS age, region::VARCHAR AS region, city::VARCHAR AS city, language::VARCHAR AS language,
        household_size::INTEGER AS household_size, vulnerable::BOOLEAN AS vulnerable,
        consent_transactions::BOOLEAN AS consent_transactions, consent_app::BOOLEAN AS consent_app,
        advisor_id::INTEGER AS advisor_id FROM customers_df""")
    con.execute(
        "CREATE TABLE events AS SELECT customer_id::INTEGER AS customer_id, "
        "CAST($now AS DATE) - CAST(days_ago AS INTEGER) AS ts, source::VARCHAR AS source, kind::VARCHAR AS kind, "
        "amount::DOUBLE AS amount FROM events_df ORDER BY customer_id, ts",
        {"now": config.SIM_NOW},
    )
    con.execute(
        "CREATE TABLE truth AS SELECT customer_id::INTEGER AS customer_id, moment_id::VARCHAR AS moment_id, "
        "CAST($now AS DATE) - CAST(days_ago AS INTEGER) AS event_date FROM truth_df",
        {"now": config.SIM_NOW},
    )
    con.execute("CREATE TABLE meta AS SELECT $now::DATE AS sim_now, $n::INTEGER AS customers, $seed::INTEGER AS seed",
                {"now": config.SIM_NOW, "n": n, "seed": seed})

    # Users. Passwords are never hardcoded: they come from DEMO_PASSWORD or are generated and printed once.
    generated = demo_password is None
    password = demo_password or secrets.token_urlsafe(9)
    n_adv = int(customers.advisor_id.max())
    users = [
        ("sofie", "Sofie", "customer", 1, None),
        ("lucas", "Lucas", "customer", 2, None),
        ("marc", "Marc", "customer", 3, None),
        ("an", "An Peeters", "advisor", None, 1),
        ("jan", "Jan Claes", "advisor", None, 2),
        ("po", "Product owner", "product_owner", None, None),
    ]
    con.execute("""CREATE TABLE users (username VARCHAR PRIMARY KEY, display_name VARCHAR, role VARCHAR,
                   customer_id INTEGER, advisor_id INTEGER, password_hash VARCHAR, disabled BOOLEAN DEFAULT false)""")
    for username, display, role, cid, aid in users:  # one demo password, but every user gets its own salt
        con.execute("INSERT INTO users VALUES ($u, $d, $r, $c, $a, $h, false)",
                    {"u": username, "d": display, "r": role, "c": cid, "a": aid, "h": hash_password(password)})
    ensure_app_tables(db)
    stats = {
        "customers": n,
        "events": int(con.execute("SELECT count(*) FROM events").fetchone()[0]),
        "planted_moments": int(con.execute("SELECT count(*) FROM truth").fetchone()[0]),
        "advisors": n_adv,
        "seconds": round(time.perf_counter() - t0, 1),
        "db": str(config.DB_PATH),
    }
    db.close()
    if generated:
        print(f"\nDemo password for all demo users (not stored anywhere else): {password}\n"
              "Set DEMO_PASSWORD in .env to choose your own.\n")
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate the synthetic Mirror population")
    ap.add_argument("--customers", type=int, default=100_000)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    if args.customers < 100:
        raise SystemExit("--customers must be at least 100")
    password = os.getenv("DEMO_PASSWORD") or None
    if password is None and config.ENV != "dev":
        raise SystemExit("Set DEMO_PASSWORD outside dev (a generated one would end up in logs)")
    print(generate(args.customers, args.seed, password))


if __name__ == "__main__":
    main()
