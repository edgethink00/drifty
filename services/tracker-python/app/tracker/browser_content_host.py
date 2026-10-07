"""Chrome native-messaging host. No activity database, telemetry or page IPC."""
from __future__ import annotations

import errno
import json
import os
import queue
import re
import select
import signal
import stat
import socket
import struct
import subprocess
import sys
import threading
import time
from typing import Any

from app.tracker.browser_content import BROWSER_BUNDLES, EXTENSION_ORIGIN, MAX_MESSAGE_BYTES, bridge_directory, normalize_clues, private_directory, read_json_line
from app.tracker.chatgpt_session import packaged_helper_path


def read_exact(stream, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        piece = stream.read(size - len(data))
        if not piece:
            raise EOFError()
        data.extend(piece)
    return bytes(data)


def read_native(stream) -> Any:
    size = struct.unpack("=I", read_exact(stream, 4))[0]
    if not 0 < size <= MAX_MESSAGE_BYTES:
        raise ValueError("native_message_size")
    return json.loads(read_exact(stream, size))


def write_native(stream, value: Any) -> None:
    data = json.dumps(value).encode()
    if len(data) > MAX_MESSAGE_BYTES:
        raise ValueError("native_message_size")
    stream.write(struct.pack("=I", len(data)) + data)
    stream.flush()


def admitted_clues(sample: Any, current: Any, owners: list[dict[str, Any]], expected: dict[str, Any], pid: int) -> dict[str, Any] | None:
    try:
        identities = [sample["before"], sample["after"], current["identity"], current["after"]]
        for identity in identities:
            if identity["incognito"] is not False or identity["sensitive"] is not False or identity["permission"] is not True or identity["focused"] is not True or identity["lifecycle"] != "active": return None
            if identity["url"] != expected["pageUrl"] or identity["title"] != expected["pageTitle"]: return None
        for key in ("workerEpoch", "revision", "tabId", "windowId", "documentId", "bounds"):
            if any(identity[key] != identities[0][key] for identity in identities): return None
        if not identities[0]["documentId"] or not identities[0]["workerEpoch"]: return None
        for key in ("revision", "tabId", "windowId"):
            if type(identities[0][key]) is not int or identities[0][key] < 0: return None
        doms = [sample["dom"]["before"], sample["dom"]["after"], current["dom"]]
        if any(d["documentId"] != identities[0]["documentId"] or d["revision"] != doms[0]["revision"] or type(d["revision"]) is not int or d["revision"] < 0 or d["visible"] is not True or d["pageFocused"] is not True for d in doms): return None
        if sample["dom"]["url"] != expected["pageUrl"] or sample["dom"]["title"] != expected["pageTitle"]: return None
        if len(owners) != 3 or any(o["pid"] != pid or o["bundleId"] != expected["bundleId"] or o["frontmostOwned"] is not True or o["processAlive"] is not True or not isinstance(o["processLaunchTime"], (float, int)) for o in owners): return None
        for key in ("processLaunchTime", "focusRevision", "windowRevision"):
            if any(o[key] != owners[0][key] for o in owners): return None
        bounds = identities[0]["bounds"]
        # Do not confuse equal-sized browser windows or a background window.
        linked = []
        for owner in owners:
            windows = owner["windows"]
            matches = [w for w in windows if all(abs(w[k] - bounds[k]) <= 2 for k in ("left", "top", "width", "height"))]
            if len(matches) != 1 or windows[0]["id"] != matches[0]["id"]: return None
            linked.append(matches[0]["id"])
        if len(set(linked)) != 1: return None
        return normalize_clues(sample["dom"]["clues"])
    except (KeyError, TypeError, ValueError, IndexError, OverflowError):
        return None


def browser_parent_pid(helper) -> int | None:
    command = [str(helper), "--native-browser-parent", str(os.getpid())]
    if getattr(sys, "frozen", False):
        command.append(os.path.realpath(sys.executable))
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=1, check=False)
        if result.returncode != 0: return None
        pid = json.loads(result.stdout).get("browserPid")
        return pid if type(pid) is int and pid > 1 else None
    except (OSError, subprocess.TimeoutExpired, ValueError, AttributeError):
        return None


def run_native_host(origin: str, *, helper_path=None) -> int:
    if origin != EXTENSION_ORIGIN or sys.platform != "darwin": return 1
    import fcntl
    helper = helper_path or packaged_helper_path()
    directory = bridge_directory()
    if helper is None or not private_directory(directory, create=True): return 1
    pid = browser_parent_pid(helper)
    if pid is None: return 1
    path = directory / f"{pid}.sock"
    # One host owns this browser-PID port; a crashed host cannot leave it stuck.
    descriptor = os.open(str(directory / f"{pid}.lock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    lock_file = os.fdopen(descriptor, "r+")
    info = os.fstat(descriptor)
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        lock_file.close(); return 1
    try: fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError: lock_file.close(); return 1
    if path.exists() or path.is_symlink():
        info = path.lstat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            lock_file.close(); return 1
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
            try: probe.connect(str(path)); lock_file.close(); return 1
            except OSError as error:
                if error.errno != errno.ECONNREFUSED or path.lstat().st_ino != info.st_ino:
                    lock_file.close(); return 1
        path.unlink()
    owned_inode = None
    monitor = subprocess.Popen([str(helper), "--browser-owner-monitor", str(pid)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", bufsize=1)
    replies: queue.Queue = queue.Queue(maxsize=16)
    stopped = threading.Event()
    for number in (signal.SIGTERM, signal.SIGINT): signal.signal(number, lambda *_: stopped.set())
    def reader():
        try:
            while not stopped.is_set(): replies.put(read_native(sys.stdin.buffer), timeout=0.1)
        except (EOFError, ValueError, OSError, queue.Full): stopped.set()
    threading.Thread(target=reader, daemon=True).start()
    def owner(deadline: float):
        monitor.stdin.write("read\n"); monitor.stdin.flush()
        if not select.select([monitor.stdout], [], [], max(0, deadline-time.monotonic()))[0]: raise TimeoutError()
        return json.loads(monitor.stdout.readline())
    def ask(kind: str, request_id: str, deadline: float):
        write_native(sys.stdout.buffer, {"kind": kind, "requestId": request_id})
        while True:
            reply = replies.get(timeout=max(0.001, deadline-time.monotonic()))
            if isinstance(reply, dict) and reply.get("requestId") == request_id and isinstance(reply.get("result"), dict): return reply["result"]
            if isinstance(reply, dict) and reply.get("requestId") == request_id: raise ValueError("unavailable")
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(str(path)); owned_inode = path.lstat().st_ino; os.chmod(path, 0o600); server.listen(1); server.settimeout(0.25)
            while not stopped.is_set():
                try: connection, _ = server.accept()
                except socket.timeout: continue
                with connection:
                    connection.settimeout(2.0); request_id = ""
                    try:
                        deadline = time.monotonic()+1.8
                        request = read_json_line(connection); request_id = request.get("requestId", "")
                        if not re.fullmatch(r"[a-f0-9]{32}", request_id) or request.get("bundleId") not in BROWSER_BUNDLES: raise ValueError("bad_request")
                        first = owner(deadline)
                        if first.get("bundleId") != request["bundleId"] or first.get("frontmostOwned") is not True: raise ValueError("not_current_owner")
                        sample = ask("capture", request_id, deadline)
                        second = owner(deadline)
                        current = ask("current", request_id, deadline)
                        third = owner(deadline)
                        clues = admitted_clues(sample, current, [first, second, third], request, pid) if time.monotonic() <= deadline else None
                    except (OSError, ValueError, TypeError, AttributeError, queue.Empty): clues = None
                    try: connection.sendall((json.dumps({"requestId": request_id, "clues": clues})+"\n").encode())
                    except OSError: pass
    finally:
        stopped.set(); monitor.terminate()
        try: monitor.wait(timeout=1)
        except subprocess.TimeoutExpired: monitor.kill(); monitor.wait()
        try:
            if owned_inode is not None and path.lstat().st_ino == owned_inode: path.unlink()
        except FileNotFoundError: pass
        lock_file.close()
    return 0
