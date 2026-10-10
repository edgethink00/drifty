"""Minimized browser clues and extension-free macOS capture.

The product path uses the bundled AX helper, not an extension/socket. The old
native-messaging transport remains an explicitly named research adapter.
"""
from __future__ import annotations

import json
import os
import socket
import stat
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from app.tracker.browser_content_policy import policy_snapshot
from app.tracker.macos_capture import CommandScope

from app.tracker.chatgpt_session import packaged_helper_path

EXTENSION_ORIGIN = "chrome-extension://neihkehcijfcfplmfomahlimejiiledi/"
# Read from the address bar instead of scripting; the helper binds their page
# clues to the focused window's exact title through accessibility.
ADDRESS_BAR_CONTENT_BUNDLES = frozenset({"com.apple.Safari", "org.mozilla.firefox"})
BROWSER_BUNDLES = frozenset({"com.google.Chrome", "com.google.Chrome.canary", "com.google.Chrome.forTesting", "com.google.chrome.for.testing", "org.chromium.Chromium", "com.microsoft.edgemac", "com.brave.Browser", "com.naver.Whale", "com.vivaldi.Vivaldi"}) | ADDRESS_BAR_CONTENT_BUNDLES
MAX_MESSAGE_BYTES = 32768


def bridge_directory() -> Path:
    return Path(os.environ.get("DRIFTY_BROWSER_CONTEXT_DIR", str(Path.home() / "Library/Caches/so.drifty/browser-context")))


def private_directory(path: Path, create: bool = False) -> bool:
    if create:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        info = path.lstat()
        return stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0
    except OSError:
        return False


def normalize_clues(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or set(value) - {"description", "headings", "visibleTopic"}:
        return None
    def text(v: Any, cap: int) -> bool:
        try:
            return isinstance(v, str) and 0 < len(v.encode("utf-16-le")) // 2 <= cap and v == " ".join(v.split())
        except UnicodeError:
            return False
    if "description" in value and not text(value["description"], 160):
        return None
    for key, count, cap in (("headings", 3, 80), ("visibleTopic", 4, 120)):
        if key in value and (not isinstance(value[key], list) or len(value[key]) > count
            or not all(text(s, cap) for s in value[key]) or len(set(value[key])) != len(value[key])):
            return None
    size = lambda s: len(s.encode("utf-16-le")) // 2
    if size(value.get("description", "")) + sum(map(size, value.get("headings", []))) > 240 or sum(map(size, value.get("visibleTopic", []))) > 240:
        return None
    result = {k: v for k, v in value.items() if v}
    return result or None


def normalize_context(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or set(value) - {"version", "collectedAt", "pageUrl", "pageTitle", "description", "headings", "visibleTopic"} or value.get("version") != 1:
        return None
    try:
        date = datetime.fromisoformat(value["collectedAt"].replace("Z", "+00:00"))
        url = urlparse(value["pageUrl"])
        if date.tzinfo is None or url.scheme not in {"http", "https"} or not url.hostname or len(value["pageUrl"]) > 4096 or not isinstance(value["pageTitle"], str) or len(value["pageTitle"]) > 500:
            return None
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    clues = normalize_clues({k: v for k, v in value.items() if k in {"description", "headings", "visibleTopic"}})
    return {"version": 1, "collectedAt": value["collectedAt"], "pageUrl": value["pageUrl"], "pageTitle": value["pageTitle"], **clues} if clues else None


def read_json_line(connection: socket.socket) -> Any:
    data = bytearray()
    while b"\n" not in data and len(data) <= MAX_MESSAGE_BYTES:
        chunk = connection.recv(min(4096, MAX_MESSAGE_BYTES + 1 - len(data)))
        if not chunk:
            raise ValueError("closed_context_port")
        data.extend(chunk)
    if len(data) > MAX_MESSAGE_BYTES or not data.endswith(b"\n"):
        raise ValueError("invalid_context_frame")
    return json.loads(data)


def capture_extension_browser_content(*, pid: int, bundle_id: str | None, page_url: str | None,
                            page_title: str | None, observed_at: str, timeout: float = 1.5) -> dict[str, Any] | None:
    # Reuses the product capture switch. The UI also independently gates egress.
    if os.environ.get("DRIFTY_BROWSER_CONTENT_CONTEXT") != "1" or bundle_id not in BROWSER_BUNDLES or not page_url or not page_title or timeout <= 0:
        return None
    directory = bridge_directory()
    if not private_directory(directory):
        return None
    path = directory / f"{pid}.sock"
    try:
        info = path.lstat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            return None
        import secrets
        request_id = secrets.token_hex(16)
        started = time.monotonic()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(min(timeout, 2.0))
            connection.connect(str(path))
            connection.sendall((json.dumps({"requestId": request_id, "pageUrl": page_url, "pageTitle": page_title, "bundleId": bundle_id}) + "\n").encode())
            reply = read_json_line(connection)
        if time.monotonic() - started > min(timeout, 2.0) or not isinstance(reply, dict) or reply.get("requestId") != request_id:
            return None
        clues = normalize_clues(reply.get("clues"))
        return normalize_context({"version": 1, "collectedAt": observed_at, "pageUrl": page_url, "pageTitle": page_title, **clues}) if clues else None
    except (OSError, ValueError, UnicodeError, TypeError):
        return None


def capture_browser_content(*, pid: int, bundle_id: str | None, page_url: str | None,
                            page_title: str | None, observed_at: str, timeout: float = 0.65,
                            run_command=None, helper_path: Path | None = None) -> dict[str, Any] | None:
    """One disposable native observation; no retry, cache or extension fallback.

    The helper checks already-granted Automation permission without prompting,
    verifies normal-window mode and exact browser/window/URL identity, and emits
    bounded headings/text and optionally an anonymous public description.
    Unavailable optional context preserves tracking.
    """
    if (os.environ.get("DRIFTY_BROWSER_CONTENT_CONTEXT") != "1" or sys.platform != "darwin"
            or type(pid) is not int or pid <= 0 or bundle_id not in BROWSER_BUNDLES
            or not isinstance(page_title, str) or not page_title or len(page_title) > 500
            or timeout <= 0):
        return None
    try:
        url = urlparse(page_url or "")
        policy = policy_snapshot()
        if policy is None:
            return None
        if url.scheme not in {"http", "https"} or not url.hostname or len(page_url or "") > 4096:
            return None
        helper = helper_path or packaged_helper_path()
        if helper is None:
            return None
        allowance = min(timeout, 0.65)
        reader = ([sys.executable, "browser-public-description"] if getattr(sys, "frozen", False)
                  else [sys.executable, str(Path(__file__).with_name("browser_public_description.py"))])
        command = [str(helper), "--browser-content", str(pid), bundle_id,
                   page_url, page_title, str(max(1, int(allowance * 1000) - 30)), "--description-stdio"]
        started = time.monotonic()
        cancelled = lambda: policy_snapshot() != policy
        def reply(line):
            preface = json.loads(line)
            if not isinstance(preface, dict) or preface.get("phase") != "description":
                return None
            if (set(preface) != {"phase", "version", "pid", "bundleId", "pageUrl", "pageTitle", "clues", "lookupBudgetMs"}
                    or type(preface["version"]) is not int or preface["version"] != 1 or type(preface["pid"]) is not int or preface["pid"] != pid
                    or preface["bundleId"] != bundle_id or preface["pageUrl"] != page_url or preface["pageTitle"] != page_title
                    or type(preface["lookupBudgetMs"]) is not int or not 0 < preface["lookupBudgetMs"] <= 620
                    or not normalize_clues(preface["clues"]) or "description" in preface["clues"]):
                raise ValueError("Invalid native description admission")
            # End before the native wait does, leaving time to deliver null on
            # timeout and preserve its already-admitted H/B observation.
            remaining = min((preface["lookupBudgetMs"]-30)/1000, started+allowance-time.monotonic()-0.20)
            if cancelled() or remaining <= 0.06:
                return "null"
            try:
                # Spawn directly from this executable, respecting frozen-parent validation.
                response = run(reader+[page_url, str(max(1, int(remaining*1000)))], timeout=remaining, cancelled=cancelled)
                data = json.loads(response)
                if isinstance(data, dict) and set(data) == {"description"} and normalize_clues(data):
                    return json.dumps(data)
            except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError, UnicodeError):
                pass
            return "null"
        if run_command is not None:
            run = run_command
            output = run(command, timeout=allowance, cancelled=cancelled, reply=reply)
        else:
            scope = CommandScope(started+allowance)
            run = scope.run
            try:
                output = run(command, timeout=allowance, cancelled=cancelled, reply=reply)
            finally:
                scope.close()
        if time.monotonic() - started > allowance or policy_snapshot() != policy:
            return None
        result = json.loads(output)
        if (not isinstance(result, dict) or set(result) != {"version", "pid", "bundleId", "pageUrl", "pageTitle", "clues"}
                or type(result["version"]) is not int or result["version"] != 1 or type(result["pid"]) is not int or result["pid"] != pid
                or result["bundleId"] != bundle_id or result["pageUrl"] != page_url or result["pageTitle"] != page_title):
            return None
        clues = normalize_clues(result["clues"])
        return normalize_context({"version": 1, "collectedAt": observed_at,
                                  "pageUrl": page_url, "pageTitle": page_title, **clues}) if clues else None
    except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError, TypeError, UnicodeError):
        return None
