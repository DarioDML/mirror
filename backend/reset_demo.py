"""Reset the demo database to a clean state and optionally verify the demo numbers.

Usage (from backend/):
    python reset_demo.py --verify            regenerate at config.DB_PATH, then assert the demo numbers
    python reset_demo.py --verify-only       assert the numbers on the existing database, change nothing
Stop the API first: a running server holds the database file and would keep serving the old data.
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

import duckdb

from mirror import config


@dataclass(frozen=True)
class Expectation:
    user: str
    customer_id: int
    moment_id: str
    confidence: float
    state: str


EXPECTED = (
    Expectation("sofie", 1, "buying_home", 0.82, "ask"),
    Expectation("sofie", 1, "growing_family", 0.545, "ask"),
    Expectation("lucas", 2, "going_freelance", 0.839, "act"),
    Expectation("marc", 3, "buying_home", 0.874, "advisor"),
)


def database_is_locked() -> bool:
    if not config.DB_PATH.exists():
        return False
    try:
        duckdb.connect(str(config.DB_PATH)).close()
    except duckdb.IOException:
        return True
    return False


def stop_instruction() -> str:
    return (f"The database {config.DB_PATH} is in use by another process (most likely the API).\n"
            "Stop the API (Ctrl+C in its terminal), then run this command again.")


def verify() -> list[str]:
    from mirror.db import DB
    from mirror.engine import Engine

    db = DB(config.DB_PATH)
    failures: list[str] = []
    try:
        engine = Engine(db)
        for exp in EXPECTED:
            belief = next((b for b in engine.beliefs(exp.customer_id, "en") if b["moment_id"] == exp.moment_id), None)
            got = (belief["confidence"], belief["state"]) if belief else None
            ok = belief is not None and abs(belief["confidence"] - exp.confidence) < 0.0015 and belief["state"] == exp.state
            print(f"  {'ok  ' if ok else 'FAIL'} {exp.user:6} {exp.moment_id:16} expected {exp.confidence} {exp.state}, got {got}")
            if not ok:
                failures.append(f"{exp.user}/{exp.moment_id}: expected {exp.confidence} {exp.state}, got {got}")
        dirty = {t: db.scalar(f"SELECT count(*) FROM {t}") for t in ("feedback", "custom_moments")}
        print(f"  state: {dirty}")
        if any(dirty.values()):
            failures.append(f"demo state is not clean: {dirty}")
        jan_sees_sofie = db.scalar("SELECT count(*) FROM customers WHERE customer_id = 1 AND advisor_id = "
                                   "(SELECT advisor_id FROM users WHERE username = 'jan')")
        print(f"  {'ok  ' if jan_sees_sofie == 0 else 'FAIL'} jan cannot see sofie (rows visible: {jan_sees_sofie})")
        if jan_sees_sofie:
            failures.append("jan can see sofie")
    finally:
        db.close()
    return failures


def main() -> int:
    ap = argparse.ArgumentParser(description="Reset the Mirror demo database")
    ap.add_argument("--customers", type=int, default=100_000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--verify", action="store_true", help="assert the demo numbers after the reset")
    ap.add_argument("--verify-only", action="store_true", help="only assert the demo numbers, do not reset")
    args = ap.parse_args()

    if database_is_locked():
        print(stop_instruction(), file=sys.stderr)
        return 2

    if not args.verify_only:
        password = os.getenv("DEMO_PASSWORD") or None
        if password is None and config.ENV != "dev":
            print("Set DEMO_PASSWORD outside dev.", file=sys.stderr)
            return 2
        from mirror.generate import generate

        print(f"Regenerating {config.DB_PATH} ({args.customers:,} customers, seed {args.seed}) ...")
        print(generate(args.customers, args.seed, password))

    if args.verify or args.verify_only:
        print("Verifying demo numbers:")
        failures = verify()
        if failures:
            print("VERIFY FAILED:\n  " + "\n  ".join(failures), file=sys.stderr)
            return 1
        print("All demo numbers match.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
