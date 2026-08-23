from __future__ import annotations

import unittest
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

    def test_normalizes_schemaless_address_bar_values(self) -> None:
        self.assertEqual(normalize_uia_url("example.com/docs"), "https://example.com/docs")
        self.assertEqual(
            normalize_uia_url("127.0.0.1:4173/docs"),
            "https://127.0.0.1:4173/docs",
        )
        self.assertEqual(
            normalize_uia_url("localhost:4173/docs"),
            "https://localhost:4173/docs",
        )
        self.assertEqual(
            normalize_uia_url("xn--e1afmkfd.xn--p1ai/docs"),
            "https://xn--e1afmkfd.xn--p1ai/docs",
        )
        self.assertEqual(normalize_uia_url("https://example.com/docs"), "https://example.com/docs")

    def test_refuses_search_text_and_non_web_schemes(self) -> None:
        self.assertIsNone(normalize_uia_url("search terms"))
        self.assertIsNone(normalize_uia_url("file:///C:/private.txt"))
        self.assertIsNone(normalize_uia_url("example.com:99999/docs"))
        self.assertIsNone(normalize_uia_url("999.999.999.999/docs"))

    def test_parses_success_and_bounds_failure_text(self) -> None:
        success = parse_uia_response('{"found":true,"url":"example.com/path","error":""}')
        self.assertEqual(success.url, "https://example.com/path")
        self.assertIsNone(success.error)
        failure = parse_uia_response('{"found":false,"url":"","error":"  no   URL  "}')
        self.assertIsNone(failure.url)
        self.assertEqual(failure.error, "no URL")

    def test_invalid_json_fails_closed(self) -> None:
        result = parse_uia_response("not-json")
        self.assertIsNone(result.url)
        self.assertIn("invalid JSON", result.error or "")

    def test_host_restricts_url_edits_to_browser_toolbar(self) -> None:
        script = windows_browser_uia._POWERSHELL_UIA_HOST
        self.assertIn("ControlType]::ToolBar", script)
        self.assertIn("ControlType]::Document", script)
        self.assertIn("$rootRect.Height * 0.25", script)
        self.assertIn("Is-BrowserToolbarEdit $edit $root", script)
        self.assertIn("Looks-Like-WebLocation $trimmed", script)
        self.assertIn("[Uri]::CheckHostName", script)
        self.assertIn("[UriHostNameType]::IPv4", script)
        self.assertIn("[UriHostNameType]::IPv6", script)
        self.assertIn("$uri.Host.Contains('.')", script)
        self.assertIn("$uri.Host -match '^[0-9.]+$'", script)

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


if __name__ == "__main__":
    unittest.main()
