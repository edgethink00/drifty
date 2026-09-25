from __future__ import annotations

import unittest
from unittest.mock import patch

from app.tracker import platform_workspace, windows_workspace
from app.tracker.windows_workspace import (
    ForegroundWindow,
    ProcessIdentity,
    aumid_display_name,
    build_snapshot,
    enrich_browser_snapshot,
    exe_display_name,
    identity_key_for,
    is_verified_browser_history_identity,
    resolve_identity,
)
from app.tracker.browser_automation import BrowserMetadata
from app.tracker.windows_browser_uia import WindowsBrowserUiaResult


class ExeDisplayNameTests(unittest.TestCase):
    def test_strips_directory_and_exe_suffix(self) -> None:
        self.assertEqual(exe_display_name("C:\\Program Files\\Notepad\\notepad.exe"), "notepad")

    def test_handles_forward_slashes(self) -> None:
        self.assertEqual(exe_display_name("C:/Tools/app.exe"), "app")

    def test_canonicalizes_browser_executable_names(self) -> None:
        self.assertEqual(exe_display_name("C:\\Program Files\\Google\\Chrome\\chrome.exe"), "Google Chrome")
        self.assertEqual(exe_display_name("C:\\Program Files (x86)\\Microsoft\\Edge\\msedge.exe"), "Microsoft Edge")

    def test_canonicalizes_chrome_channels_from_the_full_path(self) -> None:
        self.assertEqual(
            exe_display_name(r"C:\Program Files\Google\Chrome Beta\Application\chrome.exe"),
            "Google Chrome Beta",
        )
        self.assertEqual(
            exe_display_name(r"C:\Users\qa\AppData\Local\Google\Chrome SxS\Application\chrome.exe"),
            "Google Chrome Canary",
        )

    def test_keeps_non_exe_names(self) -> None:
        self.assertEqual(exe_display_name("C:\\Tools\\helper.bin"), "helper.bin")

    def test_names_every_browser_executable_it_knows(self) -> None:
        # An unnamed browser is recorded as an ordinary app ("zen"), so page
        # capture never runs and a drift verdict closes the whole browser.
        cases = {
            r"C:\Program Files\Zen Browser\zen.exe": "Zen",
            r"C:\Program Files\Ablaze Floorp\floorp.exe": "Floorp",
            r"C:\Program Files\LibreWolf\librewolf.exe": "LibreWolf",
            r"C:\Program Files\Waterfox\waterfox.exe": "Waterfox",
            r"C:\Users\qa\AppData\Local\Mullvad\mullvadbrowser.exe": "Mullvad Browser",
            r"C:\Program Files\WindowsApps\TheBrowserCompany.Arc_1.0.0.0_x64__ttt1ap7aakyb4\Arc.exe": "Arc",
            r"C:\Users\qa\AppData\Local\Perplexity\Comet\Application\comet.exe": "Comet",
            r"C:\Users\qa\AppData\Local\Thorium\Application\thorium.exe": "Thorium",
            r"C:\Users\qa\AppData\Local\Yandex\YandexBrowser\Application\browser.exe": "Yandex Browser",
            r"C:\Program Files\Mozilla Firefox\firefox.exe": "Firefox",
            r"C:\Program Files\Firefox Developer Edition\firefox.exe": "Firefox",
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                self.assertEqual(exe_display_name(path), expected)

    def test_tor_browser_is_not_firefox(self) -> None:
        # Tor Browser ships firefox.exe; it must not reach Firefox page capture
        # or tab closing.
        self.assertEqual(
            exe_display_name(r"C:\Users\qa\Desktop\Tor Browser\Browser\firefox.exe"),
            "Tor Browser",
        )

    def test_generic_browser_basename_needs_its_install_path(self) -> None:
        self.assertEqual(exe_display_name(r"C:\Tools\browser.exe"), "browser")

    def test_none_and_empty_are_none(self) -> None:
        self.assertIsNone(exe_display_name(None))
        self.assertIsNone(exe_display_name(""))


class IdentityKeyTests(unittest.TestCase):
    def test_aumid_wins_over_exe_path(self) -> None:
        key = identity_key_for("C:\\Windows\\System32\\ApplicationFrameHost.exe", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App")
        self.assertEqual(key, "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App")

    def test_exe_path_is_lowercased(self) -> None:
        key = identity_key_for("C:\\Program Files\\Notepad++\\Notepad++.exe", None)
        self.assertEqual(key, "c:\\program files\\notepad++\\notepad++.exe")

    def test_no_sources_is_none(self) -> None:
        self.assertIsNone(identity_key_for(None, None))


class AumidDisplayNameTests(unittest.TestCase):
    def test_reads_package_leaf_name(self) -> None:
        self.assertEqual(
            aumid_display_name("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"),
            "WindowsCalculator",
        )

    def test_falls_back_to_app_id_when_leaf_is_generic(self) -> None:
        self.assertEqual(aumid_display_name("Contoso.App_abc123!Editor"), "Editor")

    def test_plain_aumid_without_separator(self) -> None:
        self.assertEqual(aumid_display_name("Microsoft.WindowsTerminal_x!Terminal"), "WindowsTerminal")


class ResolveIdentityTests(unittest.TestCase):
    def test_classic_win32_process(self) -> None:
        window = ForegroundWindow(hwnd=100, title="readme - Notepad", pid=42)
        identity, diagnostic = resolve_identity(
            window,
            read_exe_path=lambda pid: "C:\\Windows\\notepad.exe",
            read_aumid=lambda pid: None,
            resolve_hosted_pid=lambda hwnd, pid: None,
        )
        self.assertIsNone(diagnostic)
        self.assertEqual(identity.exe_path, "C:\\Windows\\notepad.exe")
        self.assertEqual(identity.exe_name, "notepad")
        self.assertIsNone(identity.aumid)

    def test_uwp_frame_host_unwraps_to_hosted_app(self) -> None:
        window = ForegroundWindow(hwnd=200, title="Calculator", pid=10)
        exe_paths = {
            10: "C:\\Windows\\System32\\ApplicationFrameHost.exe",
            77: "C:\\Program Files\\WindowsApps\\Calc\\CalculatorApp.exe",
        }
        identity, diagnostic = resolve_identity(
            window,
            read_exe_path=lambda pid: exe_paths.get(pid),
            read_aumid=lambda pid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" if pid == 77 else None,
            resolve_hosted_pid=lambda hwnd, pid: 77,
        )
        self.assertIsNone(diagnostic)
        self.assertEqual(identity.aumid, "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App")
        self.assertEqual(identity.exe_name, "CalculatorApp")
        self.assertNotIn("applicationframehost", (identity.exe_path or "").lower())

    def test_unresolved_frame_host_never_reports_host_identity(self) -> None:
        window = ForegroundWindow(hwnd=300, title="Settings", pid=10)
        identity, diagnostic = resolve_identity(
            window,
            read_exe_path=lambda pid: "C:\\Windows\\System32\\ApplicationFrameHost.exe" if pid == 10 else None,
            read_aumid=lambda pid: None,
            resolve_hosted_pid=lambda hwnd, pid: None,
        )
        self.assertIsNotNone(diagnostic)
        self.assertEqual(identity.exe_name, "unresolved-uwp")
        self.assertIsNone(identity.exe_path)
        self.assertIsNone(identity.aumid)

    def test_frame_host_detection_is_case_insensitive(self) -> None:
        window = ForegroundWindow(hwnd=400, title="x", pid=10)
        identity, diagnostic = resolve_identity(
            window,
            read_exe_path=lambda pid: "C:\\WINDOWS\\SYSTEM32\\APPLICATIONFRAMEHOST.EXE" if pid == 10 else None,
            read_aumid=lambda pid: None,
            resolve_hosted_pid=lambda hwnd, pid: None,
        )
        self.assertEqual(identity.exe_name, "unresolved-uwp")
        self.assertIsNotNone(diagnostic)


class BuildSnapshotTests(unittest.TestCase):
    def test_normal_window_snapshot(self) -> None:
        window = ForegroundWindow(hwnd=1, title="doc - Editor", pid=5)
        identity = ProcessIdentity(exe_path="C:\\Apps\\Editor.exe", exe_name="Editor", aumid=None)
        snapshot = build_snapshot(window, identity, observed_at="2026-08-17T00:00:00+00:00")
        self.assertEqual(snapshot.app_name, "Editor")
        self.assertEqual(snapshot.bundle_id, "c:\\apps\\editor.exe")
        self.assertEqual(snapshot.window_title, "doc - Editor")
        self.assertEqual(snapshot.source, "win32-foreground")
        self.assertEqual(snapshot.capture_confidence, 1.0)
        self.assertIsNone(snapshot.frontmost_capture_error)
        # The diagnostic must name the mechanism that produced the read. An
        # earlier revision reported the macOS "system-events" value here,
        # which no test caught because none asserted the success path.
        self.assertEqual(snapshot.frontmost_capture_source, "win32-foreground")

    def test_uwp_snapshot_uses_aumid_identity(self) -> None:
        window = ForegroundWindow(hwnd=1, title="Calculator", pid=5)
        identity = ProcessIdentity(
            exe_path="C:\\Program Files\\WindowsApps\\Calc\\CalculatorApp.exe",
            exe_name="CalculatorApp",
            aumid="Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
        )
        snapshot = build_snapshot(window, identity, observed_at="2026-08-17T00:00:00+00:00")
        self.assertEqual(snapshot.bundle_id, "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App")
        self.assertEqual(snapshot.app_name, "WindowsCalculator")
        self.assertEqual(snapshot.frontmost_capture_source, "uwp-frame-host")

    def test_untitled_window_uses_untitled_source(self) -> None:
        window = ForegroundWindow(hwnd=1, title="   ", pid=5)
        identity = ProcessIdentity(exe_path="C:\\Apps\\bg.exe", exe_name="bg", aumid=None)
        snapshot = build_snapshot(window, identity, observed_at="2026-08-17T00:00:00+00:00")
        self.assertIsNone(snapshot.window_title)
        self.assertEqual(snapshot.source, "win32-foreground-untitled")

    def test_missing_window_reports_unavailable(self) -> None:
        snapshot = build_snapshot(None, None, observed_at="2026-08-17T00:00:00+00:00", capture_error="boom")
        self.assertEqual(snapshot.app_name, "Unavailable")
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertEqual(snapshot.frontmost_capture_error, "boom")
        self.assertEqual(snapshot.source, "unknown")

    def test_missing_window_has_default_error(self) -> None:
        snapshot = build_snapshot(None, None, observed_at="2026-08-17T00:00:00+00:00")
        self.assertIn("foreground window", snapshot.frontmost_capture_error or "")


class BrowserEnrichmentTests(unittest.TestCase):
    def _snapshot(self, app_name: str = "Google Chrome"):
        return build_snapshot(
            ForegroundWindow(hwnd=44, title="Example - Google Chrome", pid=5),
            ProcessIdentity(exe_path="C:\\Program Files\\Google\\Chrome\\chrome.exe", exe_name=app_name, aumid=None),
            observed_at="2026-08-20T00:00:00+00:00",
        )

    def test_live_uia_url_is_primary_and_populates_browser_contract(self) -> None:
        snapshot = enrich_browser_snapshot(
            self._snapshot(),
            44,
            live_reader=lambda hwnd, app: WindowsBrowserUiaResult("https://www.example.com/docs", None),
            history_reader=lambda *_: self.fail("history must not run after a live URL"),
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(snapshot.browser_name, "Google Chrome")
        self.assertEqual(snapshot.site_domain, "example.com")
        self.assertEqual(snapshot.site_url, "https://www.example.com/docs")
        self.assertEqual(snapshot.site_source, "windows-uia-document")
        self.assertEqual(snapshot.capture_confidence, 0.8)
        self.assertEqual(snapshot.browser_automation_status, "granted")

    def test_history_is_only_a_fallback_and_preserves_uia_diagnostic(self) -> None:
        history = BrowserMetadata(
            browser_name="Google Chrome",
            site_domain="example.com",
            site_url="https://example.com/fallback",
            browser_history_status="matched",
            browser_history_reason="matched",
            browser_history_database_found=True,
            browser_history_profile_count=1,
            browser_history_candidate_count=3,
            browser_history_error_count=0,
        )
        snapshot = enrich_browser_snapshot(
            self._snapshot(),
            44,
            live_reader=lambda hwnd, app: WindowsBrowserUiaResult(None, "no URL-shaped edit control value"),
            history_reader=lambda *_: history,
            history_identity_checker=lambda *_: True,
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(snapshot.site_url, "https://example.com/fallback")
        self.assertEqual(snapshot.site_source, "browser-history-title")
        self.assertEqual(snapshot.browser_automation_status, "unavailable")
        self.assertIn("URL-shaped", snapshot.browser_automation_error or "")
        self.assertEqual(snapshot.browser_history_status, "matched")
        self.assertEqual(snapshot.capture_confidence, 0.45)

    def test_document_http_url_identity_reaches_snapshot_unchanged(self) -> None:
        url = "http://127.0.0.1:4173/Docs/?Q=Case#Fragment"
        snapshot = enrich_browser_snapshot(
            self._snapshot(),
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult(url, None),
            history_reader=lambda *_: self.fail("history must not replace Document identity"),
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(snapshot.site_url, url)
        self.assertEqual(snapshot.site_source, "windows-uia-document")
        self.assertEqual(snapshot.site_domain, "127.0.0.1")
        metadata = windows_workspace._browser_metadata_from_live_uia(
            "Google Chrome", WindowsBrowserUiaResult(url, None)
        )
        self.assertEqual(metadata.match_state, "windows-uia-document")

    def test_unverified_portable_browser_never_reads_canonical_history(self) -> None:
        snapshot = self._snapshot()
        snapshot.bundle_id = r"c:\temp\chrome.exe"
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult(None, "address bar unavailable"),
            history_reader=lambda *_: self.fail("unverified executable must not read browser history"),
            bridge_reader=lambda *_: None,
        )
        self.assertIsNone(enriched.site_url)
        self.assertEqual(enriched.capture_confidence, 1.0)

    def test_non_browser_never_starts_uia_or_history(self) -> None:
        snapshot = self._snapshot("Editor")
        snapshot.app_name = "Editor"
        unchanged = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: self.fail("UIA must not run"),
            history_reader=lambda *_: self.fail("history must not run"),
            bridge_reader=lambda *_: None,
        )
        self.assertIs(unchanged, snapshot)
        self.assertIsNone(unchanged.browser_name)

    def test_browser_without_a_history_root_is_still_a_browser(self) -> None:
        snapshot = build_snapshot(
            ForegroundWindow(hwnd=44, title="YouTube — Zen Browser", pid=5),
            ProcessIdentity(exe_path=r"C:\Program Files\Zen Browser\zen.exe", exe_name="zen.exe", aumid=None),
            observed_at="2026-09-25T00:00:00+00:00",
        )
        self.assertEqual(snapshot.app_name, "Zen")
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult(None, "Windows UIA is not applicable."),
            history_reader=lambda *_: self.fail("an unverified browser must not read history"),
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(enriched.browser_name, "Zen")
        self.assertIsNone(enriched.site_url)
        self.assertIsNone(enriched.site_domain)

    def test_packaged_arc_is_a_browser(self) -> None:
        snapshot = build_snapshot(
            ForegroundWindow(hwnd=44, title="Arc", pid=5),
            ProcessIdentity(
                exe_path=r"C:\Program Files\WindowsApps\TheBrowserCompany.Arc_1.0.0.0_x64__ttt1ap7aakyb4\Arc.exe",
                exe_name="Arc.exe",
                aumid="TheBrowserCompany.Arc_ttt1ap7aakyb4!Arc",
            ),
            observed_at="2026-09-25T00:00:00+00:00",
        )
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult(None, "Windows UIA is not applicable."),
            history_reader=lambda *_: self.fail("an unverified browser must not read history"),
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(enriched.browser_name, "Arc")

    def test_exact_firefox_bridge_skips_uia_and_history(self) -> None:
        snapshot = self._snapshot("Firefox")
        snapshot.app_name = "Firefox"
        bridge = BrowserMetadata(
            browser_name="Firefox",
            site_domain="example.com",
            site_title="Exact Firefox tab",
            site_url="https://example.com/firefox",
            match_state="browser-extension",
            browser_automation_status="granted",
        )
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: self.fail("UIA must not run after an exact bridge match"),
            history_reader=lambda *_: self.fail("history must not run after an exact bridge match"),
            bridge_reader=lambda *_: bridge,
        )
        self.assertEqual(enriched.site_url, "https://example.com/firefox")
        self.assertEqual(enriched.site_source, "browser-extension")
        self.assertEqual(enriched.capture_confidence, 1.0)

    def test_firefox_private_window_records_no_page_and_skips_history(self) -> None:
        snapshot = self._snapshot("Firefox")
        snapshot.app_name = "Firefox"
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult(None, "private browsing window", private_window=True),
            history_reader=lambda *_: self.fail("a private window must not be matched against history"),
            history_identity_checker=lambda *_: True,
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(enriched.browser_name, "Firefox")
        self.assertIsNone(enriched.site_url)
        self.assertEqual(enriched.browser_automation_error, "private browsing window")

    def test_firefox_live_document_url_is_used_without_the_bridge(self) -> None:
        snapshot = self._snapshot("Firefox")
        snapshot.app_name = "Firefox"
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult("https://www.youtube.com/watch?v=abc", None),
            history_reader=lambda *_: self.fail("history must not replace a live Document URL"),
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(enriched.site_url, "https://www.youtube.com/watch?v=abc")
        self.assertEqual(enriched.site_source, "windows-uia-document")
        self.assertEqual(enriched.youtube_video_id, "abc")


class BrowserHistoryIdentityTests(unittest.TestCase):
    def test_accepts_exact_vendor_install_path(self) -> None:
        self.assertTrue(is_verified_browser_history_identity(
            "Google Chrome",
            r"c:\program files\google\chrome\application\chrome.exe",
            {"PROGRAMFILES": r"C:\Program Files"},
        ))

    def test_rejects_same_basename_outside_vendor_install(self) -> None:
        self.assertFalse(is_verified_browser_history_identity(
            "Google Chrome",
            r"C:\Temp\chrome.exe",
            {"PROGRAMFILES": r"C:\Program Files", "LOCALAPPDATA": r"C:\Users\qa\AppData\Local"},
        ))

    def test_accepts_beta_binary_only_for_the_beta_profile_identity(self) -> None:
        path = r"C:\Program Files\Google\Chrome Beta\Application\chrome.exe"
        environment = {"PROGRAMFILES": r"C:\Program Files"}
        self.assertTrue(is_verified_browser_history_identity(
            "Google Chrome Beta",
            path,
            environment,
        ))
        self.assertFalse(is_verified_browser_history_identity(
            "Google Chrome",
            path,
            environment,
        ))

class ForegroundSnapshotFreshnessTests(unittest.TestCase):
    def capture(self, windows):
        identity = ProcessIdentity(
            exe_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            exe_name="Google Chrome",
            aumid=None,
        )

        def enrich(snapshot, hwnd):
            snapshot.site_url = "http://127.0.0.1/PageB"
            snapshot.site_source = "windows-uia-document"
            return snapshot

        with (
            patch.object(windows_workspace, "is_windows", return_value=True),
            patch.object(windows_workspace, "process_session_id", return_value=1),
            patch.object(windows_workspace, "read_foreground_window", side_effect=windows),
            patch.object(windows_workspace, "resolve_identity", return_value=(identity, None)),
            patch.object(windows_workspace, "enrich_browser_snapshot", side_effect=enrich) as enrichment,
        ):
            snapshot = windows_workspace.current_snapshot()
        return snapshot, enrichment

    def test_stable_foreground_keeps_enrichment(self) -> None:
        stable = ForegroundWindow(hwnd=100, title="Page B", pid=10)
        snapshot, enrichment = self.capture([stable, stable, stable])
        self.assertEqual(snapshot.window_title, "Page B")
        self.assertEqual(snapshot.site_url, "http://127.0.0.1/PageB")
        enrichment.assert_called_once()

    def test_changed_identity_refuses_before_enrichment(self) -> None:
        old = ForegroundWindow(hwnd=100, title="Page A", pid=10)
        changed = ForegroundWindow(hwnd=100, title="Page A", pid=20)
        snapshot, enrichment = self.capture([old, changed])
        enrichment.assert_not_called()
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertIsNone(snapshot.site_url)

    def test_changed_foreground_discards_enriched_context(self) -> None:
        old = ForegroundWindow(hwnd=100, title="Page A", pid=10)
        for changed in (
            ForegroundWindow(hwnd=200, title="Page A", pid=10),
            ForegroundWindow(hwnd=100, title="Page A", pid=20),
            ForegroundWindow(hwnd=100, title="Page B", pid=10),
            None,
        ):
            with self.subTest(changed=changed):
                snapshot, enrichment = self.capture([old, old, changed])
                enrichment.assert_called_once()
                self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
                self.assertIn("changed", snapshot.frontmost_capture_error or "")
                self.assertIsNone(snapshot.window_title)
                self.assertIsNone(snapshot.site_url)
                self.assertIsNone(snapshot.site_source)


class SessionZeroRefusalTests(unittest.TestCase):
    def test_session_zero_refuses_capture(self) -> None:
        with (
            patch.object(windows_workspace, "is_windows", return_value=True),
            patch.object(windows_workspace, "process_session_id", return_value=0),
        ):
            snapshot = windows_workspace.current_snapshot()
        self.assertEqual(snapshot.app_name, "Unavailable")
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertIn("no interactive desktop", snapshot.frontmost_capture_error or "")

    def test_unknown_session_refuses_before_foreground_capture(self) -> None:
        with (
            patch.object(windows_workspace, "is_windows", return_value=True),
            patch.object(windows_workspace, "process_session_id", return_value=None),
            patch.object(windows_workspace, "read_foreground_window") as foreground,
        ):
            snapshot = windows_workspace.current_snapshot()
        foreground.assert_not_called()
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertIn("session is unknown", snapshot.frontmost_capture_error or "")

    def test_non_windows_platform_refuses_capture(self) -> None:
        with patch.object(windows_workspace, "is_windows", return_value=False):
            snapshot = windows_workspace.current_snapshot()
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertIn("requires Windows", snapshot.frontmost_capture_error or "")


class PlatformDispatchTests(unittest.TestCase):
    def test_non_windows_uses_macos_capture(self) -> None:
        sentinel = object()
        with (
            patch.object(platform_workspace.sys, "platform", "darwin"),
            patch("app.tracker.macos_workspace.current_snapshot", return_value=sentinel) as mac_capture,
        ):
            result = platform_workspace.current_snapshot(include_system_transient=False)
        self.assertIs(result, sentinel)
        mac_capture.assert_called_once_with(include_system_transient=False)

    def test_windows_platform_uses_windows_capture(self) -> None:
        sentinel = object()
        with (
            patch.object(platform_workspace.sys, "platform", "win32"),
            patch("app.tracker.windows_workspace.current_snapshot", return_value=sentinel) as win_capture,
        ):
            result = platform_workspace.current_snapshot()
        self.assertIs(result, sentinel)
        win_capture.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
