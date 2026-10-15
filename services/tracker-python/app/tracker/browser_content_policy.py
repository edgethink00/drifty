"""Observe Content context OFF/ON generations across tracker/RPC processes."""
import os
import sqlite3
import uuid
from pathlib import Path

ENABLED_KEY = "browser_content_context_enabled"
REVISION_KEY = "browser_content_context_revision"
_settings_path = None


def configure_settings(path):
    global _settings_path
    _settings_path = path.resolve() if isinstance(path, Path) else None


def policy_snapshot():
    if os.environ.get("DRIFTY_BROWSER_CONTENT_CONTEXT") != "1":
        return None
    if _settings_path is None:
        return (None, "standalone")  # Explicit environment opt-in for standalone capture.
    try:
        db = sqlite3.connect(_settings_path.as_uri()+"?mode=ro", uri=True, timeout=0.01)
        try:
            rows = dict(db.execute("SELECT key,value FROM tracker_meta WHERE key IN (?,?)", (ENABLED_KEY, REVISION_KEY)))
        finally:
            db.close()
        return (_settings_path, rows.get(REVISION_KEY, "")) if rows.get(ENABLED_KEY) == "true" else None
    except (OSError, ValueError, sqlite3.Error):
        return None


def save_content_setting(db, enabled, *, meta_updates=()):
    # Both fields commit together, including OFF->ON during one in-flight sample.
    with db.connect() as conn:
        previous = conn.execute("SELECT value FROM tracker_meta WHERE key=?", (ENABLED_KEY,)).fetchone()
        old = previous[0] if previous else "false"
        entries = [(ENABLED_KEY, "true" if enabled else "false")]
        if old != entries[0][1]:
            entries.append((REVISION_KEY, uuid.uuid4().hex))
        # A diagnostics save includes its other flags in this transaction so
        # a later write failure cannot leave only the content policy changed.
        entries.extend(meta_updates)
        conn.executemany("INSERT INTO tracker_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", entries)
