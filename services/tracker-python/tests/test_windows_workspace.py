from __future__ import annotations

import threading
import time
import unittest
from unittest.mock import Mock, patch

from app.tracker import platform_workspace, windows_workspace
from app.tracker.windows_workspace import (
    ForegroundWindow,
    ProcessIdentity,
    aumid_display_name,
    build_snapshot,
    capture_windows_browser_content,
    enrich_browser_snapshot,
    exe_display_name,
    identity_key_for,
    resolve_identity,
)
from app.tracker.browser_automation import BrowserMetadata
from app.tracker.windows_browser_capture import _UrlWorker
from app.tracker.windows_browser_uia import WindowsBrowserCluesResult, WindowsBrowserUiaResult


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

    def test_unreadable_frame_host_resolves_packaged_child(self) -> None:
        window = ForegroundWindow(hwnd=500, title="Calculator", pid=10)
        aumid_reads = []

        def read_aumid(pid: int) -> str | None:
            aumid_reads.append(pid)
            return "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" if pid == 77 else None

        identity, diagnostic = resolve_identity(
            window,
            read_exe_path=lambda pid: None,
            read_aumid=read_aumid,
            resolve_hosted_pid=lambda hwnd, pid: 77 if (hwnd, pid) == (500, 10) else None,
            read_window_class=lambda hwnd: "ApplicationFrameWindow",
        )
        self.assertIsNone(diagnostic)
        self.assertEqual(identity.aumid, "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App")
        self.assertIsNone(identity.exe_path)
        self.assertEqual(aumid_reads, [77])
        snapshot = build_snapshot(window, identity)
        self.assertEqual(snapshot.app_name, "WindowsCalculator")
        self.assertEqual(snapshot.bundle_id, "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App")
        self.assertEqual(snapshot.frontmost_capture_source, "uwp-frame-host")

    def test_unreadable_frame_host_never_uses_host_identity_if_child_fails(self) -> None:
        window = ForegroundWindow(hwnd=501, title="Calculator", pid=10)
        aumid_reads = []

        def read_aumid(pid: int) -> str | None:
            aumid_reads.append(pid)
            return "Host.Wrong_abc!App" if pid == 10 else None

        identity, diagnostic = resolve_identity(
            window,
            read_exe_path=lambda pid: None,
            read_aumid=read_aumid,
            resolve_hosted_pid=lambda hwnd, pid: None,
            read_window_class=lambda hwnd: "ApplicationFrameWindow",
        )
        self.assertEqual(identity.exe_name, "unresolved-uwp")
        self.assertIsNone(identity.aumid)
        self.assertIsNotNone(diagnostic)
        self.assertEqual(aumid_reads, [])

    def test_unreadable_frame_host_needs_child_aumid_not_just_exe(self) -> None:
        window = ForegroundWindow(hwnd=502, title="Calculator", pid=10)
        identity, diagnostic = resolve_identity(
            window,
            read_exe_path=lambda pid: r"C:\Apps\wrong.exe" if pid == 77 else None,
            read_aumid=lambda pid: None,
            resolve_hosted_pid=lambda hwnd, pid: 77,
            read_window_class=lambda hwnd: "ApplicationFrameWindow",
        )
        self.assertIsNone(identity.exe_path)
        self.assertIsNone(identity.aumid)
        self.assertIsNotNone(diagnostic)

    def test_unreadable_regular_window_keeps_its_own_packaged_identity(self) -> None:
        window = ForegroundWindow(hwnd=503, title="Editor", pid=10)
        hosted_calls = []

        def resolve_hosted(hwnd: int, pid: int) -> int | None:
            hosted_calls.append((hwnd, pid))
            return 77

        identity, diagnostic = resolve_identity(
            window,
            read_exe_path=lambda pid: None,
            read_aumid=lambda pid: "Contoso.Editor_abc!Editor" if pid == 10 else None,
            resolve_hosted_pid=resolve_hosted,
            read_window_class=lambda hwnd: "RegularWindow",
        )
        self.assertIsNone(diagnostic)
        self.assertEqual(identity.aumid, "Contoso.Editor_abc!Editor")
        self.assertEqual(hosted_calls, [])

    def test_known_regular_exe_does_not_use_frame_class_fallback(self) -> None:
        window = ForegroundWindow(hwnd=504, title="Editor", pid=10)
        identity, diagnostic = resolve_identity(
            window,
            read_exe_path=lambda pid: r"C:\Apps\editor.exe",
            read_aumid=lambda pid: None,
            resolve_hosted_pid=lambda hwnd, pid: self.fail("regular app must not unwrap"),
            read_window_class=lambda hwnd: "ApplicationFrameWindow",
        )
        self.assertIsNone(diagnostic)
        self.assertEqual(identity.exe_path, r"C:\Apps\editor.exe")


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

    def test_unreadable_process_identity_is_a_failed_capture(self) -> None:
        window = ForegroundWindow(hwnd=1, title="A real window", pid=5)
        for identity, diagnostic in (
            (ProcessIdentity(None, None, None), None),
            (ProcessIdentity(None, "unresolved-uwp", None), "Hosted app not resolved."),
        ):
            with self.subTest(identity=identity):
                snapshot = build_snapshot(window, identity, capture_error=diagnostic)
                self.assertEqual(snapshot.app_name, "Unavailable")
                self.assertIsNone(snapshot.bundle_id)
                self.assertIsNone(snapshot.window_title)
                self.assertEqual(snapshot.source, "unknown")
                self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
                self.assertEqual(
                    snapshot.frontmost_capture_error,
                    diagnostic or "Foreground process identity unavailable.",
                )

    def test_named_unavailable_app_and_aumid_only_app_keep_verified_identity(self) -> None:
        window = ForegroundWindow(hwnd=1, title="A real window", pid=5)
        named_app = build_snapshot(
            window, ProcessIdentity(r"C:\Apps\Unavailable.exe", "Unavailable", None)
        )
        self.assertEqual(named_app.app_name, "Unavailable")
        self.assertEqual(named_app.bundle_id, r"c:\apps\unavailable.exe")
        self.assertEqual(named_app.frontmost_capture_source, "win32-foreground")

        packaged_app = build_snapshot(
            window, ProcessIdentity(None, None, "Contoso.Editor_abc!Editor")
        )
        self.assertEqual(packaged_app.app_name, "Editor")
        self.assertEqual(packaged_app.bundle_id, "Contoso.Editor_abc!Editor")
        self.assertEqual(packaged_app.frontmost_capture_source, "uwp-frame-host")


class BrowserEnrichmentTests(unittest.TestCase):
    def _snapshot(self, app_name: str = "Google Chrome"):
        paths = {
            "Google Chrome": r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            "Microsoft Edge": r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            "Brave Browser": r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
            "Firefox": r"C:\Program Files\Mozilla Firefox\firefox.exe",
            "Editor": r"C:\Apps\Editor\editor.exe",
        }
        path = paths[app_name]
        return build_snapshot(
            ForegroundWindow(hwnd=44, title=f"Example - {app_name}", pid=5),
            ProcessIdentity(exe_path=path, exe_name=path.rsplit("\\", 1)[-1], aumid=None),
            observed_at="2026-08-20T00:00:00+00:00",
        )

    def test_live_uia_url_is_primary_and_populates_browser_contract(self) -> None:
        snapshot = enrich_browser_snapshot(
            self._snapshot(),
            44,
            live_reader=lambda hwnd, app: WindowsBrowserUiaResult("https://www.example.com/docs", None),
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(snapshot.browser_name, "Google Chrome")
        self.assertEqual(snapshot.site_domain, "example.com")
        self.assertEqual(snapshot.site_url, "https://www.example.com/docs")
        self.assertEqual(snapshot.site_source, "windows-uia-document")
        self.assertEqual(snapshot.capture_confidence, 0.8)
        self.assertEqual(snapshot.browser_automation_status, "granted")

    def test_even_claimed_normal_gecko_without_live_url_has_no_site(self) -> None:
        # No currently measured Gecko signal proves a normal window when the
        # Document URL fails; a future explicit state must not revive title
        # matching without a separate foreground binding proof.
        snapshot = enrich_browser_snapshot(
            self._snapshot("Firefox"),
            44,
            live_reader=lambda hwnd, app: WindowsBrowserUiaResult(None, "document URL unavailable", privacy_state="normal"),
            bridge_reader=lambda *_: None,
        )
        self.assertIsNone(snapshot.site_url)
        self.assertIsNone(snapshot.site_source)
        self.assertEqual(snapshot.browser_automation_status, "unavailable")
        self.assertIn("document URL", snapshot.browser_automation_error or "")
        self.assertIsNone(snapshot.browser_history_status)
        self.assertEqual(snapshot.capture_confidence, 1.0)

    def test_document_http_url_identity_reaches_snapshot_unchanged(self) -> None:
        url = "http://127.0.0.1:4173/Docs/?Q=Case#Fragment"
        snapshot = enrich_browser_snapshot(
            self._snapshot(),
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult(url, None),
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(snapshot.site_url, url)
        self.assertEqual(snapshot.site_source, "windows-uia-document")
        self.assertEqual(snapshot.site_domain, "127.0.0.1")
        metadata = windows_workspace._browser_metadata_from_live_uia(
            "Google Chrome", WindowsBrowserUiaResult(url, None)
        )
        self.assertEqual(metadata.match_state, "windows-uia-document")

    def test_portable_browser_keeps_app_identity_when_live_url_fails(self) -> None:
        snapshot = self._snapshot()
        snapshot.bundle_id = r"c:\temp\chrome.exe"
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult(None, "address bar unavailable"),
            bridge_reader=lambda *_: None,
        )
        self.assertIsNone(enriched.site_url)
        self.assertEqual(enriched.capture_confidence, 1.0)

    def test_non_browser_never_starts_uia(self) -> None:
        snapshot = self._snapshot("Editor")
        snapshot.app_name = "Editor"
        unchanged = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: self.fail("UIA must not run"),
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
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(enriched.browser_name, "Arc")

    def test_exact_firefox_bridge_needs_a_matching_foreground_document(self) -> None:
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
            live_reader=lambda *_: WindowsBrowserUiaResult("https://example.com/firefox", None),
            bridge_reader=lambda app, url: bridge if (app, url) == ("Firefox", bridge.site_url) else None,
        )
        self.assertEqual(enriched.site_url, "https://example.com/firefox")
        self.assertEqual(enriched.site_source, "windows-uia-document")
        self.assertEqual(enriched.capture_confidence, 0.8)

    def test_cross_browser_bridge_cannot_replace_the_foreground_document_url(self) -> None:
        snapshot = self._snapshot("Microsoft Edge")
        snapshot.app_name = "Microsoft Edge"
        bridge = BrowserMetadata(
            browser_name="Microsoft Edge",
            site_domain="chrome.example",
            site_url="https://chrome.example/private",
            site_title="Chrome tab",
            browser_automation_status="granted",
        )
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult("https://edge.example/current", None),
            bridge_reader=lambda *_: bridge,
        )
        self.assertEqual(enriched.site_url, "https://edge.example/current")
        self.assertEqual(enriched.site_domain, "edge.example")
        self.assertEqual(enriched.site_source, "windows-uia-document")
        self.assertIsNone(enriched.site_title)
        self.assertEqual(enriched.capture_confidence, 0.8)

    def test_same_url_bridge_cannot_supply_another_windows_title_or_page_fields(self) -> None:
        snapshot = self._snapshot("Microsoft Edge")
        snapshot.app_name = "Microsoft Edge"
        bridge = BrowserMetadata(
            browser_name="Microsoft Edge",
            site_domain="other.example",
            site_title="Other window's private title",
            site_url="https://example.com/shared",
            youtube_video_id="other-video",
            browser_automation_status="denied",
            browser_automation_error="other window's bridge failure",
        )
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult("https://example.com/shared", None),
            bridge_reader=lambda *_: bridge,
        )
        self.assertEqual(enriched.site_url, "https://example.com/shared")
        self.assertEqual(enriched.site_domain, "example.com")
        self.assertIsNone(enriched.site_title)
        self.assertIsNone(enriched.youtube_video_id)
        self.assertEqual(enriched.site_source, "windows-uia-document")
        self.assertEqual(enriched.capture_confidence, 0.8)
        self.assertEqual(enriched.browser_automation_status, "granted")
        self.assertIsNone(enriched.browser_automation_error)

    def test_bridge_without_a_foreground_document_keeps_unknown_site(self) -> None:
        enriched = enrich_browser_snapshot(
            self._snapshot(),
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult(None, "document URL unavailable"),
            bridge_reader=lambda *_: BrowserMetadata(
                browser_name="Google Chrome", site_url="https://other.example/stale"
            ),
        )
        self.assertIsNone(enriched.site_url)
        self.assertIsNone(enriched.site_source)
        self.assertEqual(enriched.capture_confidence, 1.0)

    def test_chromium_private_same_title_history_cannot_supply_a_url(self) -> None:
        # The normal profile contains this exact title, but an inaccessible
        # private Document gives no proof that the current HWND is normal.
        for app_name in ("Google Chrome", "Microsoft Edge", "Brave Browser"):
            with self.subTest(app_name=app_name):
                snapshot = self._snapshot(app_name)
                original_identity = snapshot.bundle_id
                normal_history_sentinel = Mock(return_value=BrowserMetadata(
                    browser_name=app_name,
                    site_url="https://normal-history.example/same-title",
                    browser_history_status="matched",
                ))
                with patch("app.tracker.browser_history.browser_history_metadata", normal_history_sentinel):
                    enriched = enrich_browser_snapshot(
                        snapshot,
                        44,
                        live_reader=lambda *_: WindowsBrowserUiaResult(None, "document URL unavailable"),
                        bridge_reader=lambda *_: None,
                    )
                normal_history_sentinel.assert_not_called()
                self.assertEqual(enriched.app_name, app_name)
                self.assertEqual(enriched.bundle_id, original_identity)
                self.assertEqual(enriched.browser_name, app_name)
                self.assertIsNone(enriched.site_url)
                self.assertIsNone(enriched.site_source)
                self.assertEqual(enriched.browser_automation_status, "unavailable")
                self.assertEqual(enriched.capture_confidence, 1.0)

    def test_gecko_host_failure_keeps_app_time_without_history(self) -> None:
        snapshot = self._snapshot("Firefox")
        normal_history_sentinel = Mock(return_value=BrowserMetadata(
            browser_name="Firefox", site_url="https://normal-history.example/same-title"
        ))
        with patch("app.tracker.browser_history.browser_history_metadata", normal_history_sentinel):
            enriched = enrich_browser_snapshot(
                snapshot,
                44,
                live_reader=lambda *_: WindowsBrowserUiaResult(None, "Windows UIA host unavailable"),
                bridge_reader=lambda *_: None,
            )
        normal_history_sentinel.assert_not_called()
        self.assertEqual(enriched.app_name, "Firefox")
        self.assertIsNotNone(enriched.bundle_id)
        self.assertEqual(enriched.browser_name, "Firefox")
        self.assertIsNone(enriched.site_url)
        self.assertIsNone(enriched.site_source)
        self.assertEqual(enriched.browser_automation_error, "Windows UIA host unavailable")

    def test_private_window_rejects_a_recent_bridge_and_history(self) -> None:
        snapshot = self._snapshot("Firefox")
        snapshot.app_name = "Firefox"
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult(None, "private browsing window", privacy_state="private"),
            bridge_reader=lambda *_: BrowserMetadata(
                browser_name="Firefox", site_url="https://example.com/normal"
            ),
        )
        self.assertIsNone(enriched.site_url)
        self.assertIsNone(enriched.site_source)

    def test_firefox_private_window_records_no_page_and_skips_history(self) -> None:
        snapshot = self._snapshot("Firefox")
        snapshot.app_name = "Firefox"
        enriched = enrich_browser_snapshot(
            snapshot,
            44,
            live_reader=lambda *_: WindowsBrowserUiaResult(None, "private browsing window", privacy_state="private"),
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
            bridge_reader=lambda *_: None,
        )
        self.assertEqual(enriched.site_url, "https://www.youtube.com/watch?v=abc")
        self.assertEqual(enriched.site_source, "windows-uia-document")
        self.assertEqual(enriched.youtube_video_id, "abc")


class OperaUrlCaptureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.window = ForegroundWindow(hwnd=8195128, title="Example - Opera", pid=29704)
        self.identity = ProcessIdentity(
            exe_path=r"C:\Users\Public\Documents\drifty-opera-portable-20260930\opera.exe",
            exe_name="opera.exe",
            aumid=None,
        )

    def snapshot(self):
        return build_snapshot(self.window, self.identity, "2026-09-30T00:00:00+00:00")

    def test_portable_opera_uses_only_its_foreground_document_url(self) -> None:
        requested: list[tuple[int, str | None]] = []

        def live_reader(hwnd: int, app: str | None) -> WindowsBrowserUiaResult:
            requested.append((hwnd, app))
            return WindowsBrowserUiaResult("https://example.com/?drifty_qa=opera_one", None)

        snapshot = self.snapshot()
        self.assertEqual(snapshot.app_name, "Opera")
        self.assertEqual(
            snapshot.bundle_id,
            r"c:\users\public\documents\drifty-opera-portable-20260930\opera.exe",
        )
        with patch("app.tracker.browser_history.browser_history_metadata") as history_reader:
            enriched = enrich_browser_snapshot(
                snapshot,
                self.window.hwnd,
                live_reader=live_reader,
                bridge_reader=lambda *_: self.fail("generic Chromium bridge has no Opera HWND binding"),
            )
        history_reader.assert_not_called()
        self.assertEqual(requested, [(8195128, "Opera")])
        self.assertEqual(enriched.browser_name, "Opera")
        self.assertEqual(enriched.site_url, "https://example.com/?drifty_qa=opera_one")
        self.assertEqual(enriched.site_domain, "example.com")
        self.assertEqual(enriched.site_source, "windows-uia-document")
        self.assertIsNone(enriched.site_title)
        self.assertEqual(enriched.capture_confidence, 0.8)

    def test_url_failure_remains_opera_app_only(self) -> None:
        with patch("app.tracker.browser_history.browser_history_metadata") as history_reader:
            enriched = enrich_browser_snapshot(
                self.snapshot(),
                self.window.hwnd,
                live_reader=lambda *_: WindowsBrowserUiaResult(None, "document URL unavailable"),
                bridge_reader=lambda *_: self.fail("generic bridge must not fill an Opera URL gap"),
            )
        history_reader.assert_not_called()
        self.assertEqual(enriched.app_name, "Opera")
        self.assertEqual(enriched.browser_name, "Opera")
        self.assertIsNone(enriched.site_url)
        self.assertIsNone(enriched.site_source)
        self.assertEqual(enriched.browser_automation_status, "unavailable")

    def test_changed_foreground_hwnd_discards_opera_page(self) -> None:
        other = ForegroundWindow(hwnd=74777726, title="Example - Opera", pid=29704)
        requested: list[int] = []

        def enrich(snapshot, hwnd, *, url_timeout_seconds):
            requested.append(hwnd)
            return enrich_browser_snapshot(
                snapshot,
                hwnd,
                live_reader=lambda *_: WindowsBrowserUiaResult("https://example.com/opera", None),
                bridge_reader=lambda *_: self.fail("Opera must use only UIA"),
            )

        with (
            patch("app.tracker.browser_history.browser_history_metadata") as history_reader,
            patch.object(windows_workspace, "is_windows", return_value=True),
            patch.object(windows_workspace, "process_session_id", return_value=1),
            # A later foreground-retry implementation may read once more to
            # confirm that the other window has gone away. Neither path may
            # retain the first Opera window's URL.
            patch.object(windows_workspace, "read_foreground_window", side_effect=[self.window, self.window, other, None]),
            patch.object(windows_workspace, "resolve_identity", return_value=(self.identity, None)),
            patch.object(windows_workspace, "enrich_browser_snapshot", side_effect=enrich),
        ):
            result = windows_workspace.current_snapshot()
        history_reader.assert_not_called()
        self.assertEqual(requested, [8195128])
        self.assertEqual(result.app_name, "Unavailable")
        self.assertIsNone(result.site_url)
        self.assertIsNone(result.site_source)
        self.assertIsNotNone(result.frontmost_capture_error)


class ForegroundSnapshotFreshnessTests(unittest.TestCase):
    def capture(self, windows, identity_reader=None):
        def resolve(window):
            if identity_reader is not None:
                return identity_reader(window)
            return ProcessIdentity(
                exe_path=rf"C:\Apps\app{window.pid}.exe",
                exe_name=f"app{window.pid}",
                aumid=None,
            ), None

        def enrich(snapshot, hwnd, *, url_timeout_seconds):
            snapshot.site_url = f"http://127.0.0.1/{(snapshot.window_title or '').replace(' ', '')}"
            snapshot.site_source = "windows-uia-document"
            return snapshot

        with (
            patch.object(windows_workspace, "is_windows", return_value=True),
            patch.object(windows_workspace, "process_session_id", return_value=1),
            patch.object(windows_workspace, "read_foreground_window", side_effect=windows),
            patch.object(windows_workspace, "resolve_identity", side_effect=resolve) as identity,
            patch.object(windows_workspace, "enrich_browser_snapshot", side_effect=enrich) as enrichment,
        ):
            snapshot = windows_workspace.current_snapshot()
        return snapshot, identity, enrichment

    def test_stable_foreground_keeps_enrichment(self) -> None:
        stable = ForegroundWindow(hwnd=100, title="Page B", pid=10)
        snapshot, identity, enrichment = self.capture([stable, stable, stable])
        self.assertEqual(snapshot.window_title, "Page B")
        self.assertEqual(snapshot.site_url, "http://127.0.0.1/PageB")
        identity.assert_called_once_with(stable)
        enrichment.assert_called_once()

    def test_changed_owner_recaptures_new_foreground(self) -> None:
        old = ForegroundWindow(hwnd=100, title="Page A", pid=10)
        changed = ForegroundWindow(hwnd=200, title="Page B", pid=20)
        snapshot, identity, enrichment = self.capture([old, changed, changed, changed, changed])
        self.assertEqual(snapshot.bundle_id, r"c:\apps\app20.exe")
        self.assertEqual(snapshot.window_title, "Page B")
        self.assertEqual(snapshot.site_url, "http://127.0.0.1/PageB")
        self.assertEqual(identity.call_count, 2)
        enrichment.assert_called_once()

    def test_changed_tab_title_recaptures_matching_title_and_url(self) -> None:
        old = ForegroundWindow(hwnd=100, title="Page A", pid=10)
        changed = ForegroundWindow(hwnd=100, title="Page B", pid=10)
        snapshot, identity, enrichment = self.capture([old, old, changed, changed, changed, changed])
        self.assertEqual(snapshot.window_title, "Page B")
        self.assertEqual(snapshot.site_url, "http://127.0.0.1/PageB")
        self.assertEqual(identity.call_count, 2)
        self.assertEqual(enrichment.call_count, 2)

    def test_second_change_refuses_without_stale_context(self) -> None:
        old = ForegroundWindow(hwnd=100, title="Page A", pid=10)
        changed = ForegroundWindow(hwnd=100, title="Page B", pid=10)
        changed_again = ForegroundWindow(hwnd=100, title="Page C", pid=10)
        snapshot, identity, enrichment = self.capture(
            [old, old, changed, changed, changed, changed_again]
        )
        self.assertEqual(identity.call_count, 2)
        self.assertEqual(enrichment.call_count, 2)
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertIn("(title)", snapshot.frontmost_capture_error or "")
        self.assertIsNone(snapshot.window_title)
        self.assertIsNone(snapshot.site_url)
        self.assertIsNone(snapshot.site_source)

    def test_delayed_first_capture_does_not_credit_new_app(self) -> None:
        old = ForegroundWindow(hwnd=100, title="Page A", pid=10)
        changed = ForegroundWindow(hwnd=100, title="Page B", pid=10)
        with patch.object(windows_workspace.time, "monotonic", side_effect=[0.0, 0.01, 2.0]):
            snapshot, identity, enrichment = self.capture([old, old, changed])
        identity.assert_called_once_with(old)
        enrichment.assert_called_once()
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertIsNone(snapshot.site_url)

    def test_slow_identity_with_stable_title_is_a_gap_before_url_capture(self) -> None:
        # The URL worker does not waive the whole observation's identity gate.
        stable = ForegroundWindow(hwnd=100, title="Page A", pid=10)
        with patch.object(windows_workspace.time, "monotonic", side_effect=[0.0, 2.0]):
            snapshot, identity, enrichment = self.capture([stable, stable, stable])
        identity.assert_called_once_with(stable)
        enrichment.assert_not_called()
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertIn("time budget", snapshot.frontmost_capture_error or "")
        self.assertIsNone(snapshot.bundle_id)
        self.assertIsNone(snapshot.site_url)

    def test_delayed_retry_does_not_credit_new_app(self) -> None:
        old = ForegroundWindow(hwnd=100, title="Page A", pid=10)
        changed = ForegroundWindow(hwnd=100, title="Page B", pid=10)
        with patch.object(windows_workspace.time, "monotonic", side_effect=[0.0, 0.01, 0.2, 0.21, 2.0]):
            snapshot, identity, enrichment = self.capture(
                [old, old, changed, changed, changed, changed]
            )
        self.assertEqual(identity.call_count, 2)
        self.assertEqual(enrichment.call_count, 2)
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertIn("time budget", snapshot.frontmost_capture_error or "")
        self.assertIsNone(snapshot.site_url)

    def test_missing_foreground_once_can_recover(self) -> None:
        stable = ForegroundWindow(hwnd=100, title="Page B", pid=10)
        snapshot, identity, enrichment = self.capture([None, stable, stable, stable])
        self.assertEqual(snapshot.window_title, "Page B")
        identity.assert_called_once_with(stable)
        enrichment.assert_called_once()

    def test_unreadable_identity_once_can_recover(self) -> None:
        stable = ForegroundWindow(hwnd=100, title="Page B", pid=10)
        valid = ProcessIdentity(r"C:\Apps\app10.exe", "app10", None)
        reads = iter([(ProcessIdentity(None, None, None), None), (valid, None)])
        snapshot, identity, enrichment = self.capture(
            [stable] * 6, identity_reader=lambda _: next(reads)
        )
        self.assertEqual(snapshot.bundle_id, r"c:\apps\app10.exe")
        self.assertEqual(identity.call_count, 2)
        enrichment.assert_called_once()

    def test_persistent_unreadable_identity_stays_unavailable(self) -> None:
        stable = ForegroundWindow(hwnd=100, title="Page B", pid=10)
        snapshot, identity, enrichment = self.capture(
            [stable] * 4,
            identity_reader=lambda _: (ProcessIdentity(None, None, None), None),
        )
        self.assertEqual(identity.call_count, 2)
        enrichment.assert_not_called()
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertIsNone(snapshot.site_url)


class BoundedBrowserSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.window = ForegroundWindow(hwnd=101, title="Same title - Opera", pid=10)
        self.requests = []
        self.releases = []
        self.workers = []

    def tearDown(self) -> None:
        for release in self.releases:
            release.set()
        for worker in self.workers:
            worker.close()
            if worker._thread is not None:
                worker._thread.join(timeout=1.0)
                self.assertFalse(worker._thread.is_alive())

    def worker(self, reader):
        worker = _UrlWorker(reader)
        self.workers.append(worker)
        return worker

    def release(self):
        release = threading.Event()
        self.releases.append(release)
        return release

    def capture(self, worker, identity_delay=0.0):
        def resolve(window):
            if identity_delay:
                time.sleep(identity_delay)
            return ProcessIdentity(rf"C:\Browser{window.pid}\opera.exe", "Opera", None), None

        with (
            patch.object(windows_workspace, "is_windows", return_value=True),
            patch.object(windows_workspace, "process_session_id", return_value=1),
            patch.object(windows_workspace, "read_foreground_window", side_effect=lambda: self.window),
            patch.object(windows_workspace, "resolve_identity", side_effect=resolve) as identity,
            patch.object(windows_workspace, "read_browser_url_with_budget", side_effect=worker.read),
            patch("app.tracker.browser_history.browser_history_metadata") as history,
        ):
            snapshot = windows_workspace.current_snapshot()
        history.assert_not_called()
        return snapshot, identity

    def wait_idle(self, worker):
        with worker._condition:
            self.assertTrue(worker._condition.wait_for(lambda: worker._active is None, timeout=1.0))

    def capture_after_slow_identity(self, worker, *, url_finished_at: float):
        elapsed = [0.0]

        def resolve(window):
            elapsed[0] = 1.25
            return ProcessIdentity(rf"C:\Browser{window.pid}\opera.exe", "Opera", None), None

        def read(hwnd, app, *, timeout_seconds):
            self.assertEqual(timeout_seconds, 0.20)
            result = worker.read(hwnd, app, timeout_seconds=timeout_seconds)
            elapsed[0] = url_finished_at
            return result

        with (
            # Keep the worker's real timed wait and threading clocks untouched.
            # Only the composed snapshot's elapsed identity/URL time is controlled.
            patch.object(windows_workspace, "time", Mock(monotonic=lambda: elapsed[0])),
            patch.object(windows_workspace, "is_windows", return_value=True),
            patch.object(windows_workspace, "process_session_id", return_value=1),
            patch.object(windows_workspace, "read_foreground_window", side_effect=lambda: self.window),
            patch.object(windows_workspace, "resolve_identity", side_effect=resolve) as identity,
            patch.object(windows_workspace, "read_browser_url_with_budget", side_effect=read) as url,
            patch("app.tracker.browser_history.browser_history_metadata") as history,
        ):
            snapshot = windows_workspace.current_snapshot()
        identity.assert_called_once_with(self.window)
        url.assert_called_once_with(101, "Opera", timeout_seconds=0.20)
        history.assert_not_called()
        return snapshot

    def test_slow_url_returns_verified_app_quickly_without_mutating_it_later(self) -> None:
        release = self.release()
        started = threading.Event()

        def read(hwnd, app):
            self.requests.append((hwnd, app))
            started.set()
            self.assertTrue(release.wait(timeout=3.0))
            return WindowsBrowserUiaResult("https://example.test/late", None)

        worker = self.worker(read)
        began = time.monotonic()
        snapshot, identity = self.capture(worker)
        elapsed = time.monotonic() - began
        self.assertTrue(started.is_set())
        self.assertLess(elapsed, 0.75)
        identity.assert_called_once_with(self.window)
        self.assertEqual(snapshot.app_name, "Opera")
        self.assertEqual(snapshot.bundle_id, r"c:\browser10\opera.exe")
        self.assertEqual(snapshot.window_title, self.window.title)
        self.assertEqual(snapshot.frontmost_capture_source, "win32-foreground")
        self.assertEqual(snapshot.browser_name, "Opera")
        self.assertEqual(snapshot.capture_confidence, 1.0)
        self.assertIsNone(snapshot.frontmost_capture_error)
        self.assertIsNone(snapshot.site_url)
        self.assertIn("time budget", snapshot.browser_automation_error or "")
        observed = snapshot.observed_at
        release.set()
        self.wait_idle(worker)
        self.assertEqual(snapshot.observed_at, observed)
        self.assertIsNone(snapshot.site_url)
        self.assertIsNone(snapshot.site_source)
        self.assertEqual(self.requests, [(101, "Opera")])

    def test_new_hwnd_and_pid_get_fresh_identity_while_the_old_url_is_busy(self) -> None:
        release = self.release()
        changed = ForegroundWindow(hwnd=202, title="New page - Opera", pid=20)

        def read(hwnd, app):
            self.requests.append((hwnd, app))
            if len(self.requests) == 1:
                self.window = changed
                self.assertTrue(release.wait(timeout=3.0))
                return WindowsBrowserUiaResult("https://example.test/old-window", None)
            return WindowsBrowserUiaResult("https://example.test/new-window", None)

        worker = self.worker(read)
        snapshot, identity = self.capture(worker)
        self.assertEqual(identity.call_count, 2)
        self.assertEqual(snapshot.bundle_id, r"c:\browser20\opera.exe")
        self.assertEqual(snapshot.window_title, changed.title)
        self.assertIsNone(snapshot.site_url)
        self.assertIn("busy", snapshot.browser_automation_error or "")
        release.set()
        self.wait_idle(worker)
        fresh, identity = self.capture(worker)
        identity.assert_called_once_with(changed)
        self.assertEqual(fresh.site_url, "https://example.test/new-window")
        self.assertEqual(fresh.site_source, "windows-uia-document")
        self.assertEqual(self.requests, [(101, "Opera"), (202, "Opera")])
        self.assertIsNone(snapshot.site_url)

    def test_fast_title_change_retries_without_reusing_the_previous_url(self) -> None:
        old = self.window
        changed = ForegroundWindow(hwnd=old.hwnd, title="Next page - Opera", pid=old.pid)

        def read(hwnd, app):
            self.requests.append((hwnd, app))
            if len(self.requests) == 1:
                self.window = changed
                return WindowsBrowserUiaResult("https://example.test/old-tab", None)
            return WindowsBrowserUiaResult("https://example.test/new-tab", None)

        snapshot, identity = self.capture(self.worker(read))
        self.assertEqual(identity.call_count, 2)
        self.assertEqual(snapshot.window_title, changed.title)
        self.assertEqual(snapshot.site_url, "https://example.test/new-tab")
        self.assertEqual(self.requests, [(101, "Opera"), (101, "Opera")])

    def test_fast_opera_url_keeps_the_existing_source_and_confidence(self) -> None:
        worker = self.worker(lambda *_: WindowsBrowserUiaResult("https://example.test/opera", None))
        snapshot, _ = self.capture(worker)
        self.assertEqual(snapshot.app_name, "Opera")
        self.assertEqual(snapshot.browser_name, "Opera")
        self.assertEqual(snapshot.site_url, "https://example.test/opera")
        self.assertEqual(snapshot.site_source, "windows-uia-document")
        self.assertEqual(snapshot.capture_confidence, 0.8)
        self.assertEqual(snapshot.browser_automation_status, "granted")

    def test_failed_fast_url_keeps_verified_app_identity_and_diagnostic(self) -> None:
        worker = self.worker(lambda *_: WindowsBrowserUiaResult(None, "document URL unavailable"))
        snapshot, _ = self.capture(worker)
        self.assertEqual(snapshot.bundle_id, r"c:\browser10\opera.exe")
        self.assertEqual(snapshot.frontmost_capture_source, "win32-foreground")
        self.assertIsNone(snapshot.site_url)
        self.assertEqual(snapshot.browser_automation_status, "unavailable")
        self.assertEqual(snapshot.browser_automation_error, "document URL unavailable")

    def test_url_wait_uses_the_remaining_budget_after_slow_but_timely_identity(self) -> None:
        release = self.release()

        def read(_hwnd, _app):
            self.assertTrue(release.wait(timeout=3.0))
            return WindowsBrowserUiaResult("https://example.test/late", None)

        snapshot = self.capture_after_slow_identity(self.worker(read), url_finished_at=1.45)
        self.assertEqual(snapshot.bundle_id, r"c:\browser10\opera.exe")
        self.assertEqual(snapshot.frontmost_capture_source, "win32-foreground")
        self.assertIsNone(snapshot.site_url)
        self.assertIn("time budget", snapshot.browser_automation_error or "")

    def test_url_completion_past_the_whole_budget_discards_even_stable_identity(self) -> None:
        release = self.release()

        def read(_hwnd, _app):
            self.assertTrue(release.wait(timeout=3.0))
            return WindowsBrowserUiaResult("https://example.test/late", None)

        snapshot = self.capture_after_slow_identity(self.worker(read), url_finished_at=1.501)
        self.assertIsNone(snapshot.bundle_id)
        self.assertIsNone(snapshot.window_title)
        self.assertIsNone(snapshot.site_url)
        self.assertIsNone(snapshot.site_source)
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")
        self.assertIn("time budget", snapshot.frontmost_capture_error or "")


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


class WindowsBrowserContentTests(unittest.TestCase):
    URL = "https://example.org/course"
    CLUES = {"headings": ["Week 2"], "visibleTopic": ["Assignment closes Friday"]}

    def setUp(self) -> None:
        env = patch.dict(windows_workspace.os.environ, {"DRIFTY_BROWSER_CONTENT_CONTEXT": "1"})
        env.start()
        self.addCleanup(env.stop)
        policy = patch.object(windows_workspace, "policy_snapshot", return_value=("settings", "revision-1"))
        self.policy = policy.start()
        self.addCleanup(policy.stop)

    def _snapshot(self, title: str = "Course - Chrome", app: str = "Google Chrome"):
        path = {
            "Google Chrome": r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            "Microsoft Edge": r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        }[app]
        snapshot = build_snapshot(
            ForegroundWindow(hwnd=44, title=title, pid=5),
            ProcessIdentity(exe_path=path, exe_name=path.rsplit("\\", 1)[-1], aumid=None),
            observed_at="2026-10-11T00:00:00+00:00",
        )
        snapshot.site_url = self.URL
        snapshot.site_source = "windows-uia-document"
        return snapshot

    def _reader(self, **fields):
        calls: list[tuple[int, str | None, float]] = []

        def read(hwnd, app, timeout_seconds):
            calls.append((hwnd, app, timeout_seconds))
            values = {"url": self.URL, "title": "Course", "clues": dict(self.CLUES)}
            values.update(fields)
            return WindowsBrowserCluesResult(**values)

        return read, calls

    def test_clues_bind_to_the_raw_window_title_of_the_same_document(self) -> None:
        reader, calls = self._reader()
        context = capture_windows_browser_content(self._snapshot(), 44, timeout_seconds=0.9, clue_reader=reader)
        self.assertEqual(context, {
            "version": 1, "collectedAt": "2026-10-11T00:00:00+00:00", "pageUrl": self.URL,
            "pageTitle": "Course - Chrome", **self.CLUES,
        })
        self.assertEqual(calls, [(44, "Google Chrome", 0.9)])
        # Edge inserts a localized "and N more pages" fragment after the page title.
        edge = "Course 외 페이지 1개 - 프로필 1 - Microsoft\u200b Edge"
        context = capture_windows_browser_content(self._snapshot(edge, "Microsoft Edge"), 44, timeout_seconds=0.9, clue_reader=reader)
        self.assertEqual(context["pageTitle"], edge)

    def test_a_different_document_or_window_title_yields_no_clues(self) -> None:
        for fields, title in (
            ({"title": "Other"}, "Course - Chrome"),
            ({}, "Course2 - Chrome"),
            ({}, "Other - Chrome"),
            ({"url": "https://example.org/other"}, "Course - Chrome"),
            ({"clues": None, "error": "sensitive"}, "Course - Chrome"),
            ({"title": None}, "Course - Chrome"),
        ):
            reader, _ = self._reader(**fields)
            self.assertIsNone(
                capture_windows_browser_content(self._snapshot(title), 44, timeout_seconds=0.9, clue_reader=reader),
                (fields, title),
            )

    def test_setting_off_private_edge_or_no_live_document_never_reads(self) -> None:
        reader, calls = self._reader()
        private = self._snapshot("Course - [InPrivate] - Microsoft\u200b Edge", "Microsoft Edge")
        self.assertIsNone(capture_windows_browser_content(private, 44, timeout_seconds=0.9, clue_reader=reader))
        history = self._snapshot()
        history.site_source = "browser-history-title"
        self.assertIsNone(capture_windows_browser_content(history, 44, timeout_seconds=0.9, clue_reader=reader))
        self.assertIsNone(capture_windows_browser_content(self._snapshot(), 44, timeout_seconds=0, clue_reader=reader))
        self.policy.return_value = None
        self.assertIsNone(capture_windows_browser_content(self._snapshot(), 44, timeout_seconds=0.9, clue_reader=reader))
        self.policy.return_value = ("settings", "revision-1")
        with patch.dict(windows_workspace.os.environ, {"DRIFTY_BROWSER_CONTENT_CONTEXT": "0"}):
            self.assertIsNone(capture_windows_browser_content(self._snapshot(), 44, timeout_seconds=0.9, clue_reader=reader))
        self.assertEqual(calls, [])

    def test_setting_change_during_the_read_discards_the_clues(self) -> None:
        reader, calls = self._reader()
        self.policy.side_effect = [("settings", "revision-1"), ("settings", "revision-2")]
        self.assertIsNone(capture_windows_browser_content(self._snapshot(), 44, timeout_seconds=0.9, clue_reader=reader))
        self.assertEqual(len(calls), 1)

    def test_foreground_capture_reads_clues_inside_its_remaining_budget(self) -> None:
        stable = ForegroundWindow(hwnd=100, title="Course - Chrome", pid=10)
        changed = ForegroundWindow(hwnd=100, title="Other - Chrome", pid=10)
        context = {"version": 1, "collectedAt": "x", "pageUrl": "https://example.org/course", "pageTitle": "Course - Chrome", "headings": ["H"]}

        def enrich(snapshot, hwnd, *, url_timeout_seconds):
            snapshot.site_url = "https://example.org/course"
            snapshot.site_source = "windows-uia-document"
            return snapshot

        def run(windows):
            with (
                patch.object(windows_workspace, "is_windows", return_value=True),
                patch.object(windows_workspace, "process_session_id", return_value=1),
                patch.object(windows_workspace, "read_foreground_window", side_effect=windows),
                patch.object(windows_workspace, "resolve_identity", return_value=(
                    ProcessIdentity(exe_path=r"C:\Apps\chrome.exe", exe_name="chrome.exe", aumid=None), None)),
                patch.object(windows_workspace, "enrich_browser_snapshot", side_effect=enrich),
                patch.object(windows_workspace, "capture_windows_browser_content", return_value=context) as clues,
            ):
                return windows_workspace.current_snapshot(), clues

        snapshot, clues = run([stable, stable, stable])
        self.assertEqual(snapshot.browser_content_context, context)
        self.assertLessEqual(clues.call_args.kwargs["timeout_seconds"], 1.45)
        self.assertGreater(clues.call_args.kwargs["timeout_seconds"], 1.0)
        # A title change after the clue read discards the whole candidate.
        snapshot, _ = run([stable, stable, changed, changed, changed, changed])
        self.assertEqual(snapshot.window_title, "Other - Chrome")
        snapshot, _ = run([stable, stable, changed, changed, changed, stable])
        self.assertIsNone(snapshot.browser_content_context)
        self.assertEqual(snapshot.frontmost_capture_source, "unavailable")


if __name__ == "__main__":
    unittest.main()
