#!/usr/bin/env python3
"""Black-box stdin/GO/EOF checks for the actual Swift worker gate, without AX or capture."""
import argparse
import atexit
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).parents[1] / "macos.swift")
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    args.artifacts.mkdir(parents=True)
    source = args.source.read_text()
    gate = source[source.index("protocol AdmissionGate:"):source.index("func recognizeImage(")]
    wait = ("let request = await gate.waitForNextRequest()" if "func waitForNextRequest()" in gate
            else "while gate.next == nil { try await Task.sleep(nanoseconds: 2_000_000) }; let request = gate.next!")
    screenshots = "class HelperExit" in gate
    # A simulated screenshot stands in for SCScreenshotManager between GO and
    # the response; the helper's real exit coordinator brackets it.
    shot = ('''
            if shot > 0 {
                emit("SHT3" + id)
                HelperExit.shared.beginScreenshot()
                try await Task.sleep(nanoseconds: shot * 1_000_000)
                HelperExit.shared.endScreenshot()
            }''' if screenshots else '''
            if shot > 0 {
                emit("SHT3" + id)
                try await Task.sleep(nanoseconds: shot * 1_000_000)
            }''')
    driver = '''
import Foundation
import Darwin
''' + gate + '''
@main struct GateTestDriver {
    static func emit(_ text: String) { FileHandle.standardOutput.write(Data(text.utf8)) }
    static func main() async throws {
        let delay = UInt64(CommandLine.arguments[1])!
        let shot = UInt64(CommandLine.arguments[2])!
        let gate = WorkerGate(mode: 2, version: 3)
        gate.ready(); emit("RDY3")
        for _ in 0..<8 {
            WAIT_FOR_REQUEST
            let id = request.uuidString.lowercased()
            emit("REQ3" + id)
            while !gate.admitted { try await Task.sleep(nanoseconds: 2_000_000) }
SCREENSHOT
            emit("ACK3" + id)
            gate.complete(); emit("END3" + id)
            if delay > 0 { try await Task.sleep(nanoseconds: delay) }
        }
    }
}
'''.replace("WAIT_FOR_REQUEST", wait).replace("SCREENSHOT", shot)
    swift = args.artifacts / "gate-driver.swift"
    swift.write_text(driver)
    binary = args.artifacts / "gate-driver"
    build = subprocess.run(["xcrun", "swiftc", "-parse-as-library", "-O", str(swift),
                            "-o", str(binary)], capture_output=True, text=True, timeout=120)
    (args.artifacts / "compile.log").write_text(build.stdout + build.stderr)
    assert build.returncode == 0, "Swift compile failed; inspect retained compile.log"
    results = []
    owned = []

    def cleanup():
        for child in owned:
            if child.poll() is not None:
                continue
            try:
                if not child.stdin.closed:
                    child.stdin.close()
                child.wait(timeout=3)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                child.terminate()
                child.wait(timeout=3)

    atexit.register(cleanup)

    def exact(p, count, timeout=2):
        end = time.monotonic() + timeout
        data = b""
        while len(data) < count:
            remaining = end - time.monotonic()
            assert remaining > 0 and select.select([p.stdout], [], [], remaining)[0], "Output deadline"
            part = os.read(p.stdout.fileno(), count - len(data))
            assert part, "Unexpected EOF"
            data += part
        return data

    def start(delay=0, shot=0):
        p = subprocess.Popen([str(binary), str(delay), str(shot)], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        owned.append(p)
        assert exact(p, 4) == b"RDY3"
        return p

    def write(p, data):
        p.stdin.write(data)
        p.stdin.flush()

    def finish(p, expected):
        if not p.stdin.closed:
            p.stdin.close()
        code = p.wait(timeout=3)
        assert code in expected, (code, expected, p.stderr.read(1000))
        assert p.stdout.read() == b"", "Unexpected extra acknowledgement"

    def frame():
        identifier = str(uuid.uuid4()).encode("ascii")
        return b"JOB3" + identifier + b"\x02", identifier

    for length in [0, 1, 4, 40]:
        p = start(); data, _ = frame()
        if length: write(p, data[:length])
        finish(p, {3}); results.append("partial-eof-" + str(length))
    for label, data in [("bad-magic", b"BAD3" + b"0" * 36 + b"\x02"),
                        ("bad-uuid", b"JOB3" + b"X" * 36 + b"\x02"),
                        ("bad-mode", b"JOB3" + str(uuid.uuid4()).encode() + b"\x00")]:
        p = start(); write(p, data); finish(p, {3}); results.append(label)
    for label, follow in [("eof-before-go", b""), ("invalid-go", b"\x00"),
                          ("overlap-request", frame()[0])]:
        p = start(); data, identifier = frame(); write(p, data)
        assert exact(p, 40) == b"REQ3" + identifier
        if follow: write(p, follow)
        finish(p, {3}); results.append(label)
    p = start(); data, identifier = frame(); write(p, data)
    assert exact(p, 40) == b"REQ3" + identifier
    start_time = time.monotonic()
    assert p.wait(timeout=3) == 4, "Missing GO must retain the existing job watchdog"
    assert .8 < time.monotonic() - start_time < 2.5
    finish(p, {4}); results.append("missing-go-watchdog")

    # macOS shows its capture alert again when a helper dies while a screenshot
    # is in flight. Each exit waits for the screenshot and writes no response.
    def screenshot_exit(shot, close_input):
        p = start(shot=shot); data, identifier = frame(); write(p, data)
        assert exact(p, 40) == b"REQ3" + identifier
        write(p, b"\x01")
        assert exact(p, 40) == b"SHT3" + identifier
        began = time.monotonic()
        if close_input:
            p.stdin.close()
        code = p.wait(timeout=6)
        assert p.stdout.read() == b"", "A response followed an interrupted screenshot"
        return code, time.monotonic() - began

    code, elapsed = screenshot_exit(600, True)
    assert code == 3 and .5 < elapsed < 1.5, ("EOF ended an in-flight screenshot", code, elapsed)
    results.append("eof-waits-for-screenshot")
    code, elapsed = screenshot_exit(1500, False)
    assert code == 4 and 1.4 < elapsed < 2.4, ("Watchdog ended an in-flight screenshot", code, elapsed)
    results.append("watchdog-waits-for-screenshot")
    code, elapsed = screenshot_exit(6000, True)
    assert code == 4 and 2.8 < elapsed < 4, ("Screenshot wait is not bounded", code, elapsed)
    results.append("screenshot-wait-bounded")
    p = start(shot=100)
    for _ in range(3):
        data, identifier = frame(); write(p, data)
        assert exact(p, 40) == b"REQ3" + identifier
        write(p, b"\x01")
        assert exact(p, 120) == b"SHT3" + identifier + b"ACK3" + identifier + b"END3" + identifier
    finish(p, {3}); results.append("completed-screenshots-keep-worker")

    handshakes = 0
    for delay in [0, 20_000_000]:
        for _ in range(16):
            p = start(delay)
            for _ in range(8):
                data, identifier = frame(); write(p, data)
                assert exact(p, 40) == b"REQ3" + identifier
                assert not select.select([p.stdout], [], [], .01)[0], "Acknowledged before GO"
                write(p, b"\x01")
                assert exact(p, 80) == b"ACK3" + identifier + b"END3" + identifier
                handshakes += 1
            try: write(p, frame()[0])
            except BrokenPipeError: pass
            try: finish(p, {0, 3})
            except BrokenPipeError:
                assert p.wait(timeout=3) in {0, 3}
                assert p.stdout.read() == b""
        results.append("eight-request-limit-delay-" + str(delay))
    result = {"passedScenarios": len(results), "freshRequestGoEndHandshakes": handshakes,
              "scenarios": results, "sourceSHA256": hashlib.sha256(source.encode()).hexdigest(),
              "actualGateExtracted": True, "platformCaptureOrPermissionsTested": False,
              "screenOrModelAccess": False}
    (args.artifacts / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
