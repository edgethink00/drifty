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
    def test_only_measured_browsers_use_live_uia(self) -> None:
        self.assertTrue(is_live_uia_browser("Google Chrome"))
        self.assertTrue(is_live_uia_browser("Google Chrome Beta"))
        self.assertTrue(is_live_uia_browser("Google Chrome Dev"))
        self.assertTrue(is_live_uia_browser("Google Chrome Canary"))
        self.assertTrue(is_live_uia_browser("Microsoft Edge"))
        self.assertTrue(is_live_uia_browser("Brave Browser"))
        self.assertTrue(is_live_uia_browser("Firefox"))
        self.assertTrue(is_live_uia_browser("Floorp"))
        self.assertTrue(is_live_uia_browser("LibreWolf"))
        self.assertTrue(is_live_uia_browser("Zen"))
        self.assertTrue(is_live_uia_browser("Waterfox"))
        self.assertFalse(is_live_uia_browser("Tor Browser"))

    def test_firefox_requests_the_gecko_document_rules(self) -> None:
        self.assertEqual(windows_browser_uia._uia_family("Firefox"), "gecko")
        self.assertEqual(windows_browser_uia._uia_family("Firefox Developer Edition"), "gecko")
        self.assertEqual(windows_browser_uia._uia_family("Zen"), "gecko")
        self.assertEqual(windows_browser_uia._uia_family("Waterfox"), "gecko")
        self.assertEqual(windows_browser_uia._uia_family("Microsoft Edge"), "chromium")
        script = windows_browser_uia._POWERSHELL_UIA_HOST
        self.assertIn("'tabbrowser-tabpanels'", script)
        self.assertIn("'private-browsing-indicator-icon'", script)
        self.assertIn("'private-browsing-indicator-label'", script)
        self.assertIn("^READ ([0-9]+)(?: (chromium|gecko))?$", script)

    def test_private_window_reply_carries_no_page(self) -> None:
        result = parse_uia_response(
            '{"found":false,"url":"https://example.com/private","error":"private browsing window","privacy":"private"}',
            "gecko",
        )
        self.assertIsNone(result.url)
        self.assertEqual(result.privacy_state, "private")
        self.assertEqual(
            parse_uia_response('{"found":false,"url":"","error":"x","privacy":"private"}').privacy_state,
            "private",
        )

    def test_explicit_normal_reply_is_not_inferred_from_a_false_private_flag(self) -> None:
        normal = '{"found":false,"url":"","error":"document URL unavailable","privacy":"normal"}'
        self.assertEqual(parse_uia_response(normal, "gecko").privacy_state, "normal")
        self.assertEqual(parse_uia_response(normal, "chromium").privacy_state, "unknown")
        self.assertEqual(parse_uia_response(normal).privacy_state, "unknown")
        self.assertEqual(
            parse_uia_response('{"found":false,"url":"","error":"host failed","private":false}', "gecko").privacy_state,
            "unknown",
        )

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
        self.assertEqual(result.privacy_state, "unknown")

    def test_host_failure_has_unknown_privacy(self) -> None:
        with (
            patch.object(windows_browser_uia.sys, "platform", "win32"),
            patch.object(windows_browser_uia, "_host", None),
            patch.object(windows_browser_uia, "_WindowsUiaHost", side_effect=RuntimeError("host unavailable")),
        ):
            result = windows_browser_uia.read_live_browser_url(44, "Firefox")
        self.assertIsNone(result.url)
        self.assertEqual(result.privacy_state, "unknown")

    def test_host_close_error_keeps_retry_and_typed_failure(self) -> None:
        class FailingHost:
            def read(self, _hwnd, _family):
                raise TimeoutError("UIA read timed out")

            def close(self):
                raise OSError("process exit race")

        with (
            patch.object(windows_browser_uia.sys, "platform", "win32"),
            patch.object(windows_browser_uia, "_host", None),
            patch.object(windows_browser_uia, "_WindowsUiaHost", side_effect=[FailingHost(), FailingHost()]) as launch,
        ):
            result = windows_browser_uia.read_live_browser_url(44, "Firefox")
            self.assertIsNone(windows_browser_uia._host)
        self.assertEqual(launch.call_count, 2)
        self.assertIsNone(result.url)
        self.assertEqual(result.error, "UIA read timed out")

    def test_kill_failure_still_removes_owned_host_script(self) -> None:
        class FailingProcess:
            stdin = None

            def poll(self):
                return None

            def wait(self, timeout):
                raise subprocess.TimeoutExpired("powershell", timeout)

            def kill(self):
                raise OSError("process already exited")

        with tempfile.TemporaryDirectory() as temp_dir:
            script_path = Path(temp_dir) / "drifty-uia-host.ps1"
            script_path.write_text("script", encoding="utf-8")
            host = object.__new__(windows_browser_uia._WindowsUiaHost)
            host._process = FailingProcess()
            host._script_path = script_path
            host.close()
            self.assertFalse(script_path.exists())

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
        captured_script = []

        def launch(command, **_kwargs):
            captured_script.append(Path(command[-1]).read_text(encoding="utf-8-sig"))
            return process

        with (
            patch.object(
                windows_browser_uia,
                "_powershell_executable",
                return_value=r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            ),
            patch.object(windows_browser_uia.subprocess, "Popen", side_effect=launch) as popen,
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
        self.assertEqual(command[-2], "-File")
        self.assertNotIn("-EncodedCommand", command)
        self.assertLess(len(subprocess.list2cmdline(command)), 32767)
        self.assertEqual(captured_script, [windows_browser_uia._POWERSHELL_UIA_HOST])
        self.assertFalse(Path(command[-1]).exists())

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
            '{"found":true,"url":"https://example.com/second","error":"","privacy":"normal"}',
        ]
        with patch.object(
            windows_browser_uia,
            "_readline_with_timeout",
            side_effect=replies,
        ) as read_reply:
            first = host.read(101)
            second = host.read(202, "gecko")

        self.assertEqual(first.url, "https://example.com/first")
        self.assertEqual(first.privacy_state, "unknown")
        self.assertEqual(second.url, "https://example.com/second")
        self.assertEqual(second.privacy_state, "normal")
        self.assertEqual(host._process.stdin.writes, ["READ 101 chromium\n", "READ 202 gecko\n"])
        with self.assertRaises(ValueError):
            host.read(303, "webkit")
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
    def test_real_host_file_launch_read_and_cleanup(self) -> None:
        created_scripts: list[Path] = []
        original = tempfile.NamedTemporaryFile

        def record_script(*args, **kwargs):
            script = original(*args, **kwargs)
            created_scripts.append(Path(script.name))
            return script

        with patch.object(windows_browser_uia.tempfile, "NamedTemporaryFile", side_effect=record_script):
            host = windows_browser_uia._WindowsUiaHost()
        process = host._process
        try:
            result = host.read(0)
            self.assertIsNone(result.url)
            self.assertEqual(result.error, "document window unavailable or changed")
        finally:
            host.close()
        self.assertIsNotNone(process)
        self.assertIsNotNone(process.poll())
        self.assertEqual(len(created_scripts), 1)
        self.assertFalse(created_scripts[0].exists())

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
