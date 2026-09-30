"""Thin DuckDB wrapper: one connection per process, serialized with a lock, named parameters only."""
from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any

import duckdb

_PARAM = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)")


def _used_params(sql: str, params: dict[str, Any] | None) -> dict[str, Any]:
    """DuckDB rejects unused named parameters, so pass only the ones the SQL references."""
    if not params:
        return {}
    names = set(_PARAM.findall(sql))
    missing = names - params.keys()
    if missing:
        raise KeyError(f"missing SQL parameters: {sorted(missing)}")
    return {k: v for k, v in params.items() if k in names}


class DB:
    def __init__(self, path: Path | str, read_only: bool = False):
        self.path = str(path)
        self.con = duckdb.connect(self.path, read_only=read_only)
        self.lock = threading.RLock()

    def execute(self, sql: str, params: dict[str, Any] | None = None) -> None:
        with self.lock:
            self.con.execute(sql, _used_params(sql, params))

    def rows(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        with self.lock:
            cur = self.con.execute(sql, _used_params(sql, params))
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]

    def one(self, sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        r = self.rows(sql, params)
        return r[0] if r else None

    def scalar(self, sql: str, params: dict[str, Any] | None = None) -> Any:
        with self.lock:
            row = self.con.execute(sql, _used_params(sql, params)).fetchone()
            return row[0] if row else None

    def table_exists(self, name: str) -> bool:
        return bool(
            self.scalar(
                "SELECT count(*) FROM information_schema.tables WHERE table_name = $t", {"t": name}
            )
        )

    def close(self) -> None:
        with self.lock:
            self.con.close()


APP_TABLES_SQL = [
    """CREATE TABLE IF NOT EXISTS feedback (
        customer_id INTEGER NOT NULL,
        moment_id VARCHAR NOT NULL,
        status VARCHAR NOT NULL,          -- confirmed | rejected
        note VARCHAR,
        updated_at TIMESTAMP DEFAULT current_timestamp,
        PRIMARY KEY (customer_id, moment_id)
    )""",
    """CREATE TABLE IF NOT EXISTS custom_moments (
        moment_id VARCHAR PRIMARY KEY,
        definition VARCHAR NOT NULL,      -- validated JSON
        created_by VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT current_timestamp
    )""",
    """CREATE TABLE IF NOT EXISTS runs (
        run_id INTEGER PRIMARY KEY,
        started_at TIMESTAMP DEFAULT current_timestamp,
        stats VARCHAR NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS message_cache (
        customer_id INTEGER NOT NULL,
        moment_id VARCHAR NOT NULL,
        state VARCHAR NOT NULL,
        lang VARCHAR NOT NULL,
        channel VARCHAR NOT NULL,
        text VARCHAR NOT NULL,
        source VARCHAR NOT NULL,          -- llm | template
        created_at TIMESTAMP DEFAULT current_timestamp,
        PRIMARY KEY (customer_id, moment_id, state, lang, channel)
    )""",
    """CREATE TABLE IF NOT EXISTS customer_prefs (
        customer_id INTEGER PRIMARY KEY,
        text_scale VARCHAR,
        motion VARCHAR,
        detail VARCHAR,
        tone VARCHAR,
        updated_at TIMESTAMP DEFAULT current_timestamp
    )""",
]


def ensure_app_tables(db: DB) -> None:
    for sql in APP_TABLES_SQL:
        db.execute(sql)
