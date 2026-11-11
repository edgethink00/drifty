"""Observe Content context OFF/ON generations across tracker/RPC processes."""
import os
import re
import stat
import sqlite3
import uuid
from pathlib import Path

ENABLED_KEY = "browser_content_context_enabled"
REVISION_KEY = "browser_content_context_revision"
_SETTINGS_UNAVAILABLE = object()
_PERMIT_PATH_ENV = "DRIFTY_BROWSER_CONTENT_PERMIT_PATH"
_PERMIT = re.compile(rb"v1:([0-9a-f]{32}):([0-9a-f]{32})\n")
_settings_path = None


def configure_settings(path):
    global _settings_path
    try:
        _settings_path = path.resolve() if isinstance(path, Path) else None
    except OSError:
        # Optional content settings must not stop the underlying capture tick.
        # Do not retain a previous DB or use None: None permits standalone
        # content capture. Retry binding on the next normal settings refresh.
        _settings_path = _SETTINGS_UNAVAILABLE


def _open_permit(path):
    if os.name == "nt":
        from app.tracker.windows_shareable_file import open_read_delete_shared
        return open_read_delete_shared(path)
    return path.open("rb")


def _allowed_generation(path, session):
    try:
        if not stat.S_ISREG(path.lstat().st_mode):
            return None
        with _open_permit(path) as permit:
            match = _PERMIT.fullmatch(permit.read(70))
    except (OSError, ValueError):
        return None
    if match and match.group(1).decode("ascii") == session:
        return match.group(2)
    return None


def policy_snapshot():
    if os.environ.get("DRIFTY_BROWSER_CONTENT_CONTEXT") != "1":
        return None
    if _settings_path is _SETTINGS_UNAVAILABLE:
        return None
    session = os.environ.get("DRIFTY_BROWSER_CONTENT_SESSION")
    if _settings_path is None:
        return (None, "standalone") if session is None else None
    # The desktop app always supplies its session. A new app starts with
    # no permit and cannot inherit an earlier app's permission after a crash.
    # Standalone tools retain their existing explicit environment opt-in.
    generation = permit = None
    if session is not None:
        # The app owns a separate gate even when the configured database
        # directory has been replaced. Never fall back to an adjacent file.
        permit = Path(os.environ.get(_PERMIT_PATH_ENV, ""))
        if not permit.is_absolute():
            return None
        generation = _allowed_generation(permit, session)
        if generation is None:
            return None
    try:
        db = sqlite3.connect(_settings_path.as_uri()+"?mode=ro", uri=True, timeout=0.01)
        try:
            rows = dict(db.execute("SELECT key,value FROM tracker_meta WHERE key IN (?,?)", (ENABLED_KEY, REVISION_KEY)))
        finally:
            db.close()
        if rows.get(ENABLED_KEY) != "true":
            return None
        if session is None:
            return (_settings_path, rows.get(REVISION_KEY, ""))
        if _allowed_generation(permit, session) != generation:
            return None
        return (_settings_path, rows.get(REVISION_KEY, ""), generation)
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
