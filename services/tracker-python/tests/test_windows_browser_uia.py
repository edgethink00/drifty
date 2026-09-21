from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.tracker import windows_browser_uia

from app.tracker.windows_browser_uia import (
    is_live_uia_browser,
    normalize_uia_url,
    parse_uia_response,
)


class WindowsBrowserUiaTests(unittest.TestCase):
    def test_only_measured_chromium_browsers_use_live_uia(self) -> None:
        self.assertTrue(is_live_uia_browser("Google Chrome"))
        self.assertTrue(is_live_uia_browser("Google Chrome Beta"))
        self.assertTrue(is_live_uia_browser("Google Chrome Dev"))
        self.assertTrue(is_live_uia_browser("Google Chrome Canary"))
        self.assertTrue(is_live_uia_browser("Microsoft Edge"))
        self.assertTrue(is_live_uia_browser("Brave Browser"))
        self.assertFalse(is_live_uia_browser("Firefox"))

    def test_requires_explicit_http_and_preserves_url_identity(self) -> None:
        self.assertIsNone(normalize_uia_url("example.com/docs"))
        self.assertIsNone(normalize_uia_url("127.0.0.1:4173/docs"))
        self.assertIsNone(normalize_uia_url("localhost:4173/docs"))
        self.assertEqual(
            normalize_uia_url("http://127.0.0.1:4173/Docs/?Q=Case#Fragment"),
            "http://127.0.0.1:4173/Docs/?Q=Case#Fragment",
        )
        self.assertEqual(
            normalize_uia_url("https://example.com/Path/?Q=Case#Fragment"),
            "https://example.com/Path/?Q=Case#Fragment",
        )

    def test_refuses_search_text_and_non_web_schemes(self) -> None:
        self.assertIsNone(normalize_uia_url("search terms"))
        self.assertIsNone(normalize_uia_url("file:///C:/private.txt"))
        self.assertIsNone(normalize_uia_url("example.com:99999/docs"))
        self.assertIsNone(normalize_uia_url("999.999.999.999/docs"))
        self.assertIsNone(normalize_uia_url("http://user:pass@example.com/private"))
        self.assertIsNone(normalize_uia_url("http://example.com\\private"))
        self.assertIsNone(normalize_uia_url(" https://example.com/private"))
        self.assertIsNone(normalize_uia_url("https://example.com/private\n"))
        self.assertIsNone(normalize_uia_url("https://example.com/%not-hex"))
        self.assertIsNone(normalize_uia_url(123))  # type: ignore[arg-type]

    def test_parses_success_and_bounds_failure_text(self) -> None:
        success = parse_uia_response('{"found":true,"url":"http://example.com/Path/","error":""}')
        self.assertEqual(success.url, "http://example.com/Path/")
        self.assertIsNone(success.error)
        inferred = parse_uia_response('{"found":true,"url":"127.0.0.1:4173/docs","error":""}')
        self.assertIsNone(inferred.url)
        failure = parse_uia_response('{"found":false,"url":"","error":"  no   URL  "}')
        self.assertIsNone(failure.url)
        self.assertEqual(failure.error, "no URL")

    def test_malformed_success_payloads_fail_closed(self) -> None:
        for line in (
            '{"found":"true","url":"https://example.com/"}',
            '{"found":true,"url":42}',
            '{"found":true,"url":"https://user@example.com/"}',
        ):
            with self.subTest(line=line):
                self.assertIsNone(parse_uia_response(line).url)

    def test_invalid_json_fails_closed(self) -> None:
        result = parse_uia_response("not-json")
        self.assertIsNone(result.url)
        self.assertIn("invalid JSON", result.error or "")

    def test_host_reads_only_unambiguous_top_level_document_value(self) -> None:
        script = windows_browser_uia._POWERSHELL_UIA_HOST
        self.assertNotIn("ControlType]::Edit", script)
        self.assertNotIn("ControlType]::ToolBar", script)
        self.assertNotIn("TextPattern", script)
        self.assertNotIn("Clipboard", script)
        self.assertIn("ControlType]::Document", script)
        self.assertIn("TryGetCurrentPattern", script)
        self.assertIn("multiple visible top-level documents", script)
        self.assertIn("document ancestry", script)
        self.assertIn("document geometry", script)
        self.assertIn("Find-FocusedTopLevelDocument", script)
        self.assertIn("Read-ValidatedDocumentUrl", script)
        self.assertIn("$auto::FocusedElement", script)
        self.assertIn(
            "Read-TopLevelDocument $root $walker $documentCondition ($auto::FocusedElement)",
            script,
        )
        self.assertLess(
            script.index("$focusedDocument = Find-FocusedTopLevelDocument"),
            script.index("$documents = $root.FindAll"),
        )

    def test_startup_failure_closes_the_spawned_host(self) -> None:
        class FakeInput:
            def __init__(self) -> None:
                self.writes: list[str] = []

            def write(self, value: str) -> None:
                self.writes.append(value)

            def flush(self) -> None:
                pass

        class FakeProcess:
            def __init__(self) -> None:
                self.stdin = FakeInput()
                self.stdout = object()
                self.waited = False

            def poll(self):
                return None

            def wait(self, timeout: float):
                self.waited = True

            def kill(self) -> None:
                pass

        process = FakeProcess()
        with (
            patch.object(
                windows_browser_uia,
                "_powershell_executable",
                return_value=r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            ),
            patch.object(windows_browser_uia.subprocess, "Popen", return_value=process) as popen,
            patch.object(
                windows_browser_uia,
                "_readline_with_timeout",
                side_effect=TimeoutError("startup timeout"),
            ),
            self.assertRaises(TimeoutError),
        ):
            windows_browser_uia._WindowsUiaHost()

        self.assertTrue(process.waited)
        self.assertEqual(process.stdin.writes, ["QUIT\n"])
        command = popen.call_args.args[0]
        self.assertEqual(
            command[0],
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
        )

    def test_only_the_first_completed_request_gets_the_cold_provider_budget(self) -> None:
        class FakeInput:
            def __init__(self) -> None:
                self.writes: list[str] = []

            def write(self, value: str) -> None:
                self.writes.append(value)

            def flush(self) -> None:
                pass

        class FakeProcess:
            def __init__(self) -> None:
                self.stdin = FakeInput()
                self.stdout = object()

            def poll(self):
                return None

        host = object.__new__(windows_browser_uia._WindowsUiaHost)
        host._process = FakeProcess()
        host._has_completed_request = False
        replies = [
            '{"found":true,"url":"https://example.com/first","error":""}',
            '{"found":true,"url":"https://example.com/second","error":""}',
        ]
        with patch.object(
            windows_browser_uia,
            "_readline_with_timeout",
            side_effect=replies,
        ) as read_reply:
            first = host.read(101)
            second = host.read(202)

        self.assertEqual(first.url, "https://example.com/first")
        self.assertEqual(second.url, "https://example.com/second")
        self.assertEqual(host._process.stdin.writes, ["READ 101\n", "READ 202\n"])
        self.assertEqual(
            [call.args[1] for call in read_reply.call_args_list],
            [
                windows_browser_uia._COLD_REQUEST_TIMEOUT_SECONDS,
                windows_browser_uia._REQUEST_TIMEOUT_SECONDS,
            ],
        )
        self.assertEqual(windows_browser_uia._COLD_REQUEST_TIMEOUT_SECONDS, 30.0)
        self.assertEqual(windows_browser_uia._REQUEST_TIMEOUT_SECONDS, 2.0)


@unittest.skipUnless(sys.platform == "win32", "requires Windows PowerShell 5.1")
class WindowsBrowserUiaPowerShellTests(unittest.TestCase):
    def test_embedded_functions_with_synthetic_uia_objects(self) -> None:
        suite_path = Path(__file__).with_name("windows_browser_uia.test.ps1")
        with tempfile.TemporaryDirectory() as temp_dir:
            script_path = Path(temp_dir) / "windows_browser_uia_host.ps1"
            script_path.write_text(windows_browser_uia._POWERSHELL_UIA_HOST, encoding="utf-8")
            completed = subprocess.run(
                [
                    windows_browser_uia._powershell_executable(),
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(suite_path),
                    "-ScriptPath",
                    str(script_path),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=30,
                check=False,
            )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        payload = json.loads(completed.stdout.strip())
        self.assertEqual(payload["failed"], 0, payload)
        self.assertGreaterEqual(payload["passed"], 10, payload)


if __name__ == "__main__":
    unittest.main()
