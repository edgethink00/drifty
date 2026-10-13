from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from app.tracker import windows_browser_uia

from app.tracker.windows_browser_uia import (
    is_live_uia_browser,
    normalize_uia_url,
    parse_clues_response,
    parse_uia_response,
)


class WindowsBrowserUiaTests(unittest.TestCase):
    def setUp(self) -> None:
        shutdown = patch.object(windows_browser_uia, "_host_shutdown", threading.Event())
        shutdown.start()
        self.addCleanup(shutdown.stop)

    def test_only_measured_browsers_use_live_uia(self) -> None:
        self.assertTrue(is_live_uia_browser("Google Chrome"))
        self.assertTrue(is_live_uia_browser("Google Chrome Beta"))
        self.assertTrue(is_live_uia_browser("Google Chrome Dev"))
        self.assertTrue(is_live_uia_browser("Google Chrome Canary"))
        self.assertTrue(is_live_uia_browser("Microsoft Edge"))
        self.assertTrue(is_live_uia_browser("Brave Browser"))
        self.assertTrue(is_live_uia_browser("Opera"))
        self.assertTrue(is_live_uia_browser("Vivaldi"))
        self.assertTrue(is_live_uia_browser("Whale"))
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
        self.assertEqual(windows_browser_uia._uia_family("Opera"), "chromium")
        script = windows_browser_uia._POWERSHELL_UIA_HOST
        self.assertIn("'tabbrowser-tabpanels'", script)
        self.assertIn("'private-browsing-indicator-icon'", script)
        self.assertIn("'private-browsing-indicator-label'", script)
        # Firefox 157 shows an indicator button and the private-session button instead.
        self.assertIn("'private-browsing-indicator-button toolbarbutton-1'", script)
        self.assertIn("$auto::AutomationIdProperty, 'reset-pbm-toolbar-button'", script)
        self.assertIn("^READ ([0-9]+)(?: (chromium|gecko|vivaldi|whale))?$", script)

    def test_vivaldi_requests_its_interface_page_rules(self) -> None:
        self.assertEqual(windows_browser_uia._uia_family("Vivaldi"), "vivaldi")

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

            def poll(self) -> None:
                return None

        host = object.__new__(windows_browser_uia._WindowsUiaHost)
        host._process = FakeProcess()
        host._has_completed_request = True
        with patch.object(windows_browser_uia, "_readline_with_timeout", return_value='{"found":true,"url":"https://example.com/","error":""}'):
            result = host.read(303, "vivaldi")
        self.assertEqual(host._process.stdin.writes, ["READ 303 vivaldi\n"])
        self.assertEqual(result.url, "https://example.com/")
        self.assertEqual(result.privacy_state, "unknown")
        script = windows_browser_uia._POWERSHELL_UIA_HOST
        self.assertIn("$vivaldiInterfaceUrl = 'chrome-extension://mpognobbkildjkofajifpdfhcoklimli/window.html'", script)
        self.assertIn("$auto::ClassNameProperty, 'UrlBar-PrivateWindowIndicator')", script)

    def test_whale_and_chrome_use_the_profile_button_private_check(self) -> None:
        self.assertEqual(windows_browser_uia._uia_family("Whale"), "whale")
        self.assertEqual(windows_browser_uia._uia_family("Google Chrome"), "chromium")
        script = windows_browser_uia._POWERSHELL_UIA_HOST
        self.assertIn("$auto::ClassNameProperty, 'AvatarToolbarButton')", script)
        # The Korean label is spelled with code points so the host stays ASCII.
        self.assertTrue(script.isascii())
        self.assertIn("0xC2DC, 0xD06C, 0xB9BF, 0x20, 0xBAA8, 0xB4DC", script)
        self.assertEqual("".join(map(chr, (0xC2DC, 0xD06C, 0xB9BF, 0x20, 0xBAA8, 0xB4DC))), "시크릿 모드")
        # Chrome incognito refuses only the page clues; the READ stays unchanged.
        clues = script.split("function Read-Clues", 1)[1].split("\nfunction ", 1)[0]
        self.assertIn("Test-ChromiumClueIncognito ([string]$last.Family)", clues)
        self.assertIn("error = 'private browsing window'", clues)

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
        # The URL reader (everything before the lazily compiled clue reader)
        # never touches editable fields, text ranges or the clipboard.
        script = windows_browser_uia._POWERSHELL_UIA_HOST.split("$script:ClueReaderSource = @'", 1)[0]
        self.assertNotIn("ControlType]::Edit", script)
        # Vivaldi's privacy probe only proves its address bar toolbar exists; it reads no value there.
        self.assertEqual(script.count("ControlType]::ToolBar"), 1)
        privacy_probe = script.split("function Get-VivaldiWindowPrivacy", 1)[1].split("\nfunction ", 1)[0]
        self.assertNotIn("Pattern", privacy_probe)
        self.assertNotIn("TextPattern", script)
        self.assertNotIn("Clipboard", script)
        self.assertNotIn("DriftyTrackerBrowserClues", script)
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

    def test_clue_reader_is_compiled_lazily_and_reads_only_the_last_validated_document(self) -> None:
        script = windows_browser_uia._POWERSHELL_UIA_HOST
        url_reader, clue_reader = script.split("$script:ClueReaderSource = @'", 1)
        # Every READ clears the Document a CLUES request may inspect before reading.
        self.assertIn(
            "function Read-Document([IntPtr]$handle, [string]$family) {\n"
            "  # Every READ replaces the one Document a following CLUES request may inspect.\n"
            "  $script:lastDocument = $null\n  $script:lastPage = $null",
            url_reader,
        )
        # A CLUES request consumes that Document once, for the same foreground HWND.
        self.assertIn("$last = $script:lastDocument\n  $script:lastDocument = $null", clue_reader)
        self.assertIn("$last.Handle -ne $handle -or [DriftyTrackerUiaNative]::GetForegroundWindow() -ne $handle", clue_reader)
        # Compiled only inside Initialize-ClueReader, which only Read-Clues calls.
        self.assertEqual(script.count("Add-Type -TypeDefinition $script:ClueReaderSource"), 1)
        self.assertLess(script.index("function Initialize-ClueReader"), script.index("Add-Type -TypeDefinition $script:ClueReaderSource"))
        self.assertEqual(script.count("Initialize-ClueReader"), 2)
        self.assertIn("'^CLUES ([0-9]+) ([0-9]+)$'", clue_reader)
        self.assertNotIn("__DRIFTY_CLUE_READER_SOURCE__", script)
        # Structural sensitivity and bounds mirror the macOS helper.
        for marker in ("multiline=true", "IsPasswordId", "MaxNodes = 8192", "budgetMs > 620", "Failure(\"sensitive\")",
                       "thread.Join(budgetMs + 40)", "ElementFromPoint"):
            self.assertIn(marker, clue_reader)
        self.assertNotIn("Clipboard", clue_reader)

    def test_clue_reply_keeps_only_capped_clues_bound_to_their_document(self) -> None:
        ok = parse_clues_response(json.dumps({
            "found": True, "url": "https://example.com/a", "title": "A",
            "headings": ["Week 2"], "visibleTopic": ["Assignment closes Friday"],
        }))
        self.assertEqual((ok.url, ok.title, ok.error), ("https://example.com/a", "A", None))
        self.assertEqual(ok.clues, {"headings": ["Week 2"], "visibleTopic": ["Assignment closes Friday"]})
        empty_list = parse_clues_response(json.dumps({
            "found": True, "url": "https://example.com/a", "title": "A", "headings": [], "visibleTopic": ["x y"],
        }))
        self.assertEqual(empty_list.clues, {"visibleTopic": ["x y"]})
        for payload in (
            {"found": False, "error": "sensitive"},
            {"found": True, "url": "https://example.com/a", "title": "A", "headings": [], "visibleTopic": []},
            {"found": True, "url": "javascript:alert(1)", "title": "A", "headings": ["H"]},
            {"found": True, "url": "https://example.com/a", "title": "", "headings": ["H"]},
            {"found": True, "url": "https://example.com/a", "title": "A" * 501, "headings": ["H"]},
            {"found": True, "url": "https://example.com/a", "title": "A", "headings": ["H"], "rawText": "body"},
            {"found": True, "url": "https://example.com/a", "title": "A", "visibleTopic": ["a" * 121]},
            {"found": True, "url": "https://example.com/a", "title": "A", "headings": ["a", "b", "c", "d"]},
            {"found": True, "url": "https://example.com/a", "title": "A", "headings": ["  padded"]},
        ):
            result = parse_clues_response(json.dumps(payload))
            self.assertIsNone(result.clues, payload)
            self.assertIsNotNone(result.error, payload)
        self.assertEqual(parse_clues_response('{"found":false,"error":"sensitive"}').error, "sensitive")
        self.assertIsNone(parse_clues_response("not json").clues)

    def test_clue_requests_name_the_window_and_budget_and_only_the_first_compiles(self) -> None:
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
        reply = '{"found":true,"url":"https://example.com/a","title":"A","headings":["H"],"visibleTopic":[]}'
        with patch.object(windows_browser_uia, "_readline_with_timeout", side_effect=[reply, reply]) as read_reply:
            first = host.read_clues(101, 570)
            second = host.read_clues(101, 300)
        self.assertEqual(first.clues, {"headings": ["H"]})
        self.assertEqual(second.title, "A")
        self.assertEqual(host._process.stdin.writes, ["CLUES 101 570\n", "CLUES 101 300\n"])
        timeouts = [call.args[1] for call in read_reply.call_args_list]
        self.assertAlmostEqual(timeouts[0], 0.57 + windows_browser_uia._CLUES_COLD_REPLY_SLACK_SECONDS)
        self.assertAlmostEqual(timeouts[1], 0.30 + windows_browser_uia._CLUES_REPLY_SLACK_SECONDS)
        self.assertLess(timeouts[1], windows_browser_uia._REQUEST_TIMEOUT_SECONDS)
        for budget in (99, 621, 0.5):
            with self.assertRaises(ValueError):
                host.read_clues(101, budget)

    def test_clue_reads_never_start_a_host_and_a_failed_exchange_retires_it(self) -> None:
        with (
            patch.object(windows_browser_uia.sys, "platform", "win32"),
            patch.object(windows_browser_uia, "_host", None),
            patch.object(windows_browser_uia, "_WindowsUiaHost") as factory,
        ):
            missing = windows_browser_uia.read_live_browser_clues(101, "Google Chrome", 500)
        factory.assert_not_called()
        self.assertIsNone(missing.clues)

        class BrokenHost:
            closed = False

            def read_clues(self, hwnd, budget_ms):
                raise TimeoutError("late reply with https://private.example/")

            def close(self) -> None:
                BrokenHost.closed = True

        with (
            patch.object(windows_browser_uia.sys, "platform", "win32"),
            patch.object(windows_browser_uia, "_host", BrokenHost()),
        ):
            failed = windows_browser_uia.read_live_browser_clues(101, "Google Chrome", 500)
            self.assertIsNone(windows_browser_uia._host)
        self.assertTrue(BrokenHost.closed)
        self.assertEqual(failed.error, "Windows page clues failed.")
        with patch.object(windows_browser_uia.sys, "platform", "win32"):
            self.assertIsNone(windows_browser_uia.read_live_browser_clues(101, "Tor Browser", 500).clues)

        class Host:
            closed = False

            def read_clues(self, hwnd, budget_ms):
                raise AssertionError("an invalid budget must not reach the host")

            def close(self) -> None:
                Host.closed = True

        kept = Host()
        with (
            patch.object(windows_browser_uia.sys, "platform", "win32"),
            patch.object(windows_browser_uia, "_host", kept),
        ):
            refused = windows_browser_uia.read_live_browser_clues(101, "Google Chrome", 5000)
            self.assertIs(windows_browser_uia._host, kept)
        self.assertFalse(Host.closed)
        self.assertIsNotNone(refused.error)

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

        def launch(owned_process, command, **_kwargs):
            captured_script.append(Path(command[-1]).read_text(encoding="utf-8-sig"))
            owned_process.stdin = process.stdin
            owned_process.stdout = process.stdout
            owned_process.pid = 4242
            owned_process._handle = object()
            owned_process.poll = process.poll
            owned_process.wait = process.wait
            owned_process.kill = process.kill

        with (
            patch.object(
                windows_browser_uia,
                "_powershell_executable",
                return_value=r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            ),
            patch.object(windows_browser_uia.subprocess.Popen, "__init__", autospec=True, side_effect=launch) as popen,
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
        command = popen.call_args.args[1]
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

    def test_opera_live_reader_uses_the_requested_hwnd_and_chromium_rules(self) -> None:
        class FakeHost:
            def __init__(self) -> None:
                self.requests: list[tuple[int, str]] = []

            def read(self, hwnd: int, family: str) -> windows_browser_uia.WindowsBrowserUiaResult:
                self.requests.append((hwnd, family))
                return windows_browser_uia.WindowsBrowserUiaResult("https://example.com/opera", None)

        host = FakeHost()
        with (
            patch.object(windows_browser_uia.sys, "platform", "win32"),
            patch.object(windows_browser_uia, "_host", host),
        ):
            result = windows_browser_uia.read_live_browser_url(8195128, "Opera")
        self.assertEqual(result.url, "https://example.com/opera")
        self.assertEqual(host.requests, [(8195128, "chromium")])


class WindowsBrowserUiaShutdownTests(unittest.TestCase):
    """Use real child processes and pipe readers, without needing Windows UIA."""

    def setUp(self) -> None:
        self.stack = ExitStack()
        self.processes = []
        self.threads = []
        self.releases = []
        self.script_paths = []
        self.real_popen_init = subprocess.Popen.__init__
        self.real_readline = windows_browser_uia._readline_with_timeout
        self.stack.enter_context(patch.object(windows_browser_uia, "_host", None))
        self.stack.enter_context(patch.object(windows_browser_uia, "_host_lock", threading.Lock()))
        self.stack.enter_context(patch.object(windows_browser_uia, "_host_shutdown", threading.Event()))
        self.stack.enter_context(patch.object(windows_browser_uia, "_owned_hosts", set()))
        self.stack.enter_context(patch.object(windows_browser_uia.sys, "platform", "win32"))
        self.stack.enter_context(patch.object(windows_browser_uia, "_powershell_executable", return_value=sys.executable))

    def tearDown(self) -> None:
        windows_browser_uia._close_host()
        for release in self.releases:
            release.set()
        for process in self.processes:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=1.0)
            for stream in (process.stdin, process.stdout):
                if stream is not None:
                    stream.close()
        for thread in self.threads:
            thread.join(timeout=1.0)
            self.assertFalse(thread.is_alive())
        for path in self.script_paths:
            self.assertFalse(path.exists())
        self.stack.close()

    def launch_fixture(self, process, command, **kwargs):
        self.script_paths.append(Path(command[-1]))
        self.real_popen_init(
            process,
            [sys.executable, "-u", "-c", self.child_code],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", creationflags=kwargs.get("creationflags", 0),
        )
        self.processes.append(process)

    def start_read(self):
        results = []
        thread = threading.Thread(target=lambda: results.append(windows_browser_uia.read_live_browser_url(101, "Opera")))
        self.threads.append(thread)
        thread.start()
        return thread, results

    def assert_stopped(self, thread, results, launch) -> None:
        thread.join(timeout=1.0)
        self.assertFalse(thread.is_alive())
        self.assertEqual(launch.call_count, 1)
        self.assertIsNone(results[0].url)
        self.assertIn("stopped", results[0].error or "")
        self.assertIsNone(windows_browser_uia._host)
        self.assertEqual(windows_browser_uia._owned_hosts, set())
        self.assertIsNotNone(self.processes[0].poll())
        self.assertFalse(self.script_paths[0].exists())

    def test_shutdown_stops_an_unpublished_constructor_waiting_for_ready(self) -> None:
        self.child_code = "import time; time.sleep(60)"
        waiting = threading.Event()

        def read_reply(stream, timeout):
            waiting.set()
            return self.real_readline(stream, timeout)

        with patch.object(windows_browser_uia.subprocess.Popen, "__init__", autospec=True, side_effect=self.launch_fixture) as launch, patch.object(
            windows_browser_uia, "_readline_with_timeout", side_effect=read_reply,
        ):
            thread, results = self.start_read()
            self.assertTrue(waiting.wait(timeout=1.0))
            self.assertIsNone(windows_browser_uia._host)
            self.assertEqual(len(windows_browser_uia._owned_hosts), 1)
            self.assertTrue(windows_browser_uia._host_lock.locked())
            began = time.monotonic()
            windows_browser_uia._close_host()
            self.assertLess(time.monotonic() - began, 1.0)
            self.assert_stopped(thread, results, launch)

    def test_shutdown_does_not_wait_for_the_busy_host_lock_or_spawn_a_retry(self) -> None:
        self.child_code = 'import sys,time; print(\'{"ready":true}\', flush=True); sys.stdin.readline(); time.sleep(60)'
        waiting = threading.Event()
        reads = []

        def read_reply(stream, timeout):
            reads.append(timeout)
            if len(reads) == 2:
                waiting.set()
            return self.real_readline(stream, timeout)

        with patch.object(windows_browser_uia.subprocess.Popen, "__init__", autospec=True, side_effect=self.launch_fixture) as launch, patch.object(
            windows_browser_uia, "_readline_with_timeout", side_effect=read_reply,
        ):
            thread, results = self.start_read()
            self.assertTrue(waiting.wait(timeout=1.0))
            self.assertIsNotNone(windows_browser_uia._host)
            self.assertTrue(windows_browser_uia._host_lock.locked())
            began = time.monotonic()
            windows_browser_uia._close_host()
            self.assertLess(time.monotonic() - began, 1.0)
            self.assert_stopped(thread, results, launch)

    def test_process_created_during_shutdown_is_closed_before_it_can_read(self) -> None:
        self.child_code = "import time; time.sleep(60)"
        creating = threading.Event()
        release = threading.Event()
        self.releases.append(release)

        def launch_during_exit(process, command, **kwargs):
            self.launch_fixture(process, command, **kwargs)
            creating.set()
            self.assertTrue(release.wait(timeout=3.0))

        with patch.object(windows_browser_uia.subprocess.Popen, "__init__", autospec=True, side_effect=launch_during_exit) as launch, patch.object(
            windows_browser_uia, "_readline_with_timeout",
        ) as read_reply:
            thread, results = self.start_read()
            self.assertTrue(creating.wait(timeout=1.0))
            self.assertIsNone(windows_browser_uia._host)
            began = time.monotonic()
            windows_browser_uia._close_host()
            self.assertLess(time.monotonic() - began, 0.5)
            release.set()
            self.assert_stopped(thread, results, launch)
        read_reply.assert_not_called()

    def test_failed_popen_initialization_removes_registration_and_owned_script(self) -> None:
        def fail_init(_process, command, **_kwargs):
            self.script_paths.append(Path(command[-1]))
            raise OSError("fixture launch failed before native creation")

        with patch.object(windows_browser_uia.subprocess.Popen, "__init__", autospec=True, side_effect=fail_init) as launch:
            result = windows_browser_uia.read_live_browser_url(101, "Opera")
        self.assertEqual(launch.call_count, 2)
        self.assertIsNone(result.url)
        self.assertEqual(windows_browser_uia._owned_hosts, set())
        self.assertTrue(all(not path.exists() for path in self.script_paths))

    def test_partial_popen_without_pid_or_handle_stays_owned_during_bounded_shutdown(self) -> None:
        initializing = threading.Event()
        release = threading.Event()
        self.releases.append(release)

        def partial_init(_process, command, **_kwargs):
            self.script_paths.append(Path(command[-1]))
            initializing.set()
            self.assertTrue(release.wait(timeout=3.0))
            raise OSError("fixture initialization cancelled before native creation")

        with patch.object(windows_browser_uia.subprocess.Popen, "__init__", autospec=True, side_effect=partial_init) as launch:
            thread, results = self.start_read()
            self.assertTrue(initializing.wait(timeout=1.0))
            host = next(iter(windows_browser_uia._owned_hosts))
            self.assertIsNotNone(host._process)
            self.assertIsNone(getattr(host._process, "pid", None))
            self.assertIsNone(getattr(host._process, "_handle", None))
            began = time.monotonic()
            windows_browser_uia._close_host()
            elapsed = time.monotonic() - began
            self.assertGreaterEqual(elapsed, 0.45)
            self.assertLess(elapsed, 1.0)
            self.assertEqual(windows_browser_uia._owned_hosts, {host})
            self.assertFalse(self.script_paths[0].exists())
            # No child was created in this partial-initialization fixture. The
            # cancelled constructor can finish and release its retained owner.
            release.set()
            thread.join(timeout=1.0)
            self.assertFalse(thread.is_alive())
            self.assertEqual(launch.call_count, 1)
            self.assertIsNone(results[0].url)
            self.assertEqual(windows_browser_uia._owned_hosts, set())

    def test_one_shot_exit_invalidates_worker_then_kills_owned_child_and_removes_script(self) -> None:
        # The observer is registered first, so it runs after the production
        # worker/UIA callbacks. Production registrations and real exit ordering
        # remain intact; only the OS PowerShell launch is a local pipe fixture.
        code = textwrap.dedent('''
            import atexit,json,subprocess,sys
            from pathlib import Path
            child = None
            script = None
            launches = 0
            def observe_exit():
                print(json.dumps({"childStopped": child.poll() is not None,
                                  "scriptRemoved": not script.exists(), "launches": launches}), flush=True)
            atexit.register(observe_exit)
            from app.tracker import windows_browser_capture,windows_browser_uia
            real_init = subprocess.Popen.__init__
            def launch(process, command, **kwargs):
                global child,script,launches
                launches += 1
                script = Path(command[-1])
                child_code = "import sys,time; print('ready', flush=True); sys.stdin.readline(); time.sleep(60)"
                real_init(process, [sys.executable, "-u", "-c", child_code], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
                          creationflags=kwargs.get("creationflags", 0))
                child = process
            # Substitute only ready parsing, retaining the actual pipe wait for
            # the URL request that follows it and the production child cleanup.
            real_readline = windows_browser_uia._readline_with_timeout
            def read_reply(stream, timeout):
                line = real_readline(stream, timeout)
                return '{"ready":true}' if line == 'ready' else line
            subprocess.Popen.__init__ = launch
            windows_browser_uia._powershell_executable = lambda: sys.executable
            windows_browser_uia._readline_with_timeout = read_reply
            sys.platform = "win32"
            result = windows_browser_capture.read_browser_url_with_budget(101, "Opera")
            print(json.dumps({"url": result.url, "error": result.error}), flush=True)
        ''')
        environment = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
        # setUp's global subprocess patch is deliberately not active here.
        began = time.monotonic()
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=3.0, env=environment)
        self.assertLess(time.monotonic() - began, 3.0)
        self.assertEqual(result.returncode, 0, result.stderr)
        sample, exit_state = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertIsNone(sample["url"])
        self.assertIn("time budget", sample["error"])
        self.assertEqual(exit_state, {"childStopped": True, "scriptRemoved": True, "launches": 1})

    def test_one_shot_exit_kills_a_created_child_before_popen_init_can_return(self) -> None:
        # Delay __init__ indefinitely *after* the actual child exists. No test
        # release or constructor join runs before atexit observes the outcome.
        # The observer cleans up a failing pre-fix child only after recording
        # production cleanup's result, so a red regression cannot leak it.
        code = textwrap.dedent('''
            import atexit,json,subprocess,sys,threading
            from pathlib import Path
            child = None
            script = None
            launches = 0
            created = threading.Event()
            def observe_exit():
                state = {"childStopped": child.poll() is not None,
                         "scriptRemoved": not script.exists(), "launches": launches,
                         "registeredHosts": len(windows_browser_uia._owned_hosts)}
                print(json.dumps(state), flush=True)
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=1.0)
            atexit.register(observe_exit)
            from app.tracker import windows_browser_capture,windows_browser_uia
            real_init = subprocess.Popen.__init__
            def delayed_init(process, command, **kwargs):
                global child,script,launches
                launches += 1
                script = Path(command[-1])
                real_init(process, [sys.executable, "-u", "-c", "import time; time.sleep(60)"],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          text=True, encoding="utf-8", creationflags=kwargs.get("creationflags", 0))
                child = process
                created.set()
                threading.Event().wait(timeout=60.0)
            subprocess.Popen.__init__ = delayed_init
            windows_browser_uia._powershell_executable = lambda: sys.executable
            sys.platform = "win32"
            result = windows_browser_capture.read_browser_url_with_budget(101, "Opera")
            assert created.wait(timeout=1.0), "fixture child not created"
            print(json.dumps({"url": result.url, "error": result.error}), flush=True)
        ''')
        environment = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1]))
        began = time.monotonic()
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=3.0, env=environment)
        elapsed = time.monotonic() - began
        self.assertLess(elapsed, 3.0)
        self.assertEqual(result.returncode, 0, result.stderr)
        sample, exit_state = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertIsNone(sample["url"])
        self.assertIn("time budget", sample["error"])
        self.assertEqual(exit_state, {
            "childStopped": True, "scriptRemoved": True, "launches": 1, "registeredHosts": 0,
        })


@unittest.skipUnless(sys.platform == "win32", "requires Windows PowerShell 5.1")
class WindowsBrowserUiaPowerShellTests(unittest.TestCase):
    def setUp(self) -> None:
        shutdown = patch.object(windows_browser_uia, "_host_shutdown", threading.Event())
        shutdown.start()
        self.addCleanup(shutdown.stop)

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
            # A CLUES request without a just-validated Document is refused
            # without compiling or reading anything.
            clues = host.read_clues(0, 500)
            self.assertIsNone(clues.clues)
            self.assertEqual(clues.error, "document unavailable")
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
