from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Final

CHATGPT_APP_NAMES: Final = frozenset({"chatgpt"})
CHATGPT_BUNDLE_IDS: Final = frozenset({"com.openai.codex", "com.openai.chat"})
GENERIC_WINDOW_TITLES: Final = frozenset({"", "chatgpt", "codex"})
HELPER_TIMEOUT_SECONDS: Final = 0.4
MAX_SESSION_TITLE_CHARS: Final = 80
SWIFT_SOURCE_NAME: Final = "chatgpt_session_ax.swift"
PACKAGED_HELPER_NAME: Final = "chatgpt-session-ax"
TAB_CLOSE_MARKERS: Final = ("탭 닫기", "close tab")
TITLE_LEAK_MARKERS: Final = (
    " - discord",
    " | discord",
    " - youtube",
    " - slack",
    "비밀번호를 저장",
    "휴지통",
)
NON_SESSION_TITLES: Final = frozenset(
    {
        "computer use controls",
        "codex pet composition surface",
        "drifty pet mode",
        "codex",
        "chatgpt",
    }
)

CommandRunner = Callable[..., str]


@dataclass(frozen=True)
class ChatGPTSessionContext:
    project: str | None
    thread: str | None

    @property
    def window_title(self) -> str | None:
        thread = sanitize_session_label(self.thread)
        if thread is None:
            return None
        project = sanitize_session_label(self.project)
        return f"{thread} - {project}" if project else thread


def is_native_chatgpt_app(app_name: str | None, bundle_id: str | None = None) -> bool:
    if (bundle_id or "").casefold() in CHATGPT_BUNDLE_IDS:
        return True
    return (app_name or "").casefold() in CHATGPT_APP_NAMES


def is_generic_chatgpt_window_title(window_title: str | None) -> bool:
    return (window_title or "").strip().casefold() in GENERIC_WINDOW_TITLES


def sanitize_session_label(value: str | None) -> str | None:
    text = " ".join((value or "").split())
    if not text or len(text) > MAX_SESSION_TITLE_CHARS:
        return None
    lowered = text.casefold()
    if lowered in GENERIC_WINDOW_TITLES or lowered in NON_SESSION_TITLES:
        return None
    if any(marker in lowered for marker in TITLE_LEAK_MARKERS):
        return None
    if any(marker in lowered for marker in TAB_CLOSE_MARKERS):
        return None
    return text


def native_chatgpt_session_context(
    app_name: str | None,
    bundle_id: str | None,
    pid: int | None,
    run_command: CommandRunner,
    helper_path: Path | None | bool = False,
) -> ChatGPTSessionContext | None:
    if not is_native_chatgpt_app(app_name, bundle_id) or pid is None or pid <= 0:
        return None
    # Production capture is macOS-only. Tests may inject a helper path on any
    # platform so Windows pre-push can exercise the title replacement without
    # compiling or executing the Swift AX helper.
    if helper_path is False:
        if sys.platform != "darwin":
            return None
        helper = compiled_helper_path()
    else:
        helper = helper_path
    if helper is None:
        return None
    try:
        output = run_command([str(helper), str(int(pid))], timeout=HELPER_TIMEOUT_SECONDS)
    except TypeError:
        try:
            output = run_command([str(helper), str(int(pid))])
        except Exception:
            return None
    except Exception:
        return None
    return parse_helper_output(output)


def apply_native_chatgpt_session_title(
    app_name: str | None,
    bundle_id: str | None,
    window_title: str | None,
    pid: int | None,
    run_command: CommandRunner,
    helper_path: Path | None | bool = False,
) -> str | None:
    if not is_generic_chatgpt_window_title(window_title):
        return window_title
    context = native_chatgpt_session_context(app_name, bundle_id, pid, run_command, helper_path=helper_path)
    if context is None:
        return window_title
    return context.window_title or window_title


def parse_helper_output(output: str) -> ChatGPTSessionContext | None:
    fields: dict[str, str] = {}
    for line in output.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        fields[key.strip()] = value.strip()
    if fields.get("ok") != "1":
        return None
    thread = sanitize_session_label(fields.get("thread"))
    if thread is None:
        return None
    project = sanitize_session_label(fields.get("project"))
    return ChatGPTSessionContext(project=project, thread=thread)


def helper_source_path() -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if isinstance(meipass, str) and meipass:
        bundled = Path(meipass) / "app" / "tracker" / SWIFT_SOURCE_NAME
        if bundled.is_file():
            return bundled
    return Path(__file__).with_name(SWIFT_SOURCE_NAME)


def _runtime_is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def packaged_helper_candidates() -> tuple[Path, ...]:
    names = (PACKAGED_HELPER_NAME,)
    roots: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if isinstance(meipass, str) and meipass:
        meipass_path = Path(meipass)
        roots.extend((meipass_path, meipass_path / "app" / "tracker"))
    if getattr(sys, "executable", None):
        roots.append(Path(sys.executable).resolve().parent)
    roots.append(Path(__file__).resolve().parent)
    return tuple(root / name for root in roots for name in names)


def packaged_helper_path() -> Path | None:
    for candidate in packaged_helper_candidates():
        if candidate.is_file():
            return candidate
    return None


@lru_cache(maxsize=1)
def compiled_helper_path() -> Path | None:
    packaged = packaged_helper_path()
    if packaged is not None:
        return packaged
    # Packaged Drifty never compiles a helper at capture time: /tmp binaries
    # do not inherit the app's Accessibility grant, and release machines do
    # not ship a compiler.
    if _runtime_is_frozen():
        return None
    source = helper_source_path()
    if not source.is_file():
        return None
    compiler = shutil.which("swiftc")
    if compiler is None:
        return None
    cache_root = Path(tempfile.gettempdir()) / "drifty-chatgpt-session-ax"
    try:
        cache_root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    helper = cache_root / PACKAGED_HELPER_NAME
    stamp = cache_root / f"{PACKAGED_HELPER_NAME}.stamp"
    expected = f"{source.stat().st_mtime_ns}:{source.stat().st_size}"
    try:
        if helper.is_file() and stamp.is_file() and stamp.read_text() == expected:
            return helper
    except OSError:
        return None
    try:
        result = subprocess.run(
            [compiler, "-O", "-o", str(helper), str(source)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0 or not helper.is_file():
        return None
    try:
        stamp.write_text(expected)
    except OSError:
        pass
    return helper
