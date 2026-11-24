import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.accessibility_address_bar import (
    accessibility_address_bar_script,
    is_accessibility_address_bar_browser_app,
    is_chromium_browser_app,
    metadata_from_accessibility_address_bar_result,
)
from app.tracker.macos_workspace import (
    BrowserMetadata,
    _browser_metadata,
    _browser_script,
    _run_osascript,
)


class BrowserAutomationDiagnosticsTests(unittest.TestCase):
    @unittest.skipUnless(
        sys.platform == "darwin",
        "/usr/bin/python3 is the macOS system interpreter this guard is about",
    )
    def test_accessibility_address_bar_imports_with_system_python(self) -> None:
        env = {**os.environ, "PYTHONPATH": str(SERVICE_ROOT)}

        result = subprocess.run(
            ["/usr/bin/python3", "-c", "import app.tracker.accessibility_address_bar"],
            capture_output=True,
            env=env,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_comet_uses_focused_chromium_tab_and_address_bar_fallback(self) -> None:
        self.assertTrue(is_chromium_browser_app("Comet"))
        self.assertTrue(is_accessibility_address_bar_browser_app("Comet"))
        with patch("app.tracker.macos_workspace._run_osascript", return_value="https://example.com/course\nCourse\nmatched\nCourse - Comet") as run:
            result = _browser_metadata("Comet")
        self.assertEqual(result.site_url, "https://example.com/course")
        self.assertEqual(result.site_title, "Course")
        self.assertEqual(result.browser_name, "Comet")
        self.assertIn('tell application "Comet"', run.call_args.args[0])
        self.assertIn('value of attribute "AXFocusedWindow"', run.call_args.args[0])
        self.assertIn('subrole of focusedWindow is "AXStandardWindow"', run.call_args.args[0])
        self.assertNotIn('value of attribute "AXFocusedWindow"', _browser_script("Google Chrome"))
        with patch("app.tracker.macos_workspace._run_osascript", side_effect=[RuntimeError("timed out (-1712)"), "example.com/course\nCourse - Comet"]) as run:
            result = _browser_metadata("Comet")
        self.assertEqual(result.site_url, "https://example.com/course")
        self.assertIn('process "Comet"', run.call_args.args[0])

    def test_accessibility_address_bar_script_uses_bounded_ui_element_scan(self) -> None:
        script = accessibility_address_bar_script("Google Chrome")

        self.assertIn("UI elements of theElement", script)
        self.assertIn('roleText is "AXWebArea"', script)
        self.assertIn("property maxVisited : 500", script)
        self.assertIn("property bestPriority : -1", script)
        self.assertNotIn("entire contents", script)

    def test_accessibility_address_bar_script_prioritizes_toolbar_and_stops_on_address_field(self) -> None:
        script = accessibility_address_bar_script("Google Chrome")

        self.assertIn("property toolbarMaxVisited : 120", script)
        self.assertIn("property foundAddress : false", script)
        self.assertIn("on scanToolbarFirst(theElement)", script)
        self.assertLess(
            script.index("my scanToolbarFirst(targetWindow)"),
            script.index("my scanElement(targetWindow)"),
        )
        self.assertIn("if foundAddress is true then return", script)
        self.assertIn("if foundAddress is true then exit repeat", script)

    def test_accessibility_address_bar_script_tries_known_chromium_path_before_recursive_scan(self) -> None:
        script = accessibility_address_bar_script("Google Chrome")

        self.assertIn("on scanKnownChromiumAddressBar(theWindow)", script)
        self.assertIn("set addressContainer to UI element 1 of theWindow", script)
        self.assertIn("set addressContainer to UI element 3 of addressContainer", script)
        self.assertIn("set addressFieldGroup to UI element 4 of addressToolbar", script)
        self.assertIn("my considerAddressCandidate(UI element 2 of addressFieldGroup)", script)
        self.assertLess(
            script.index("my scanKnownChromiumAddressBar(targetWindow)"),
            script.index("my scanToolbarFirst(targetWindow)"),
        )

    def test_accessibility_address_bar_script_has_edge_specific_app_bar_path(self) -> None:
        script = accessibility_address_bar_script("Microsoft Edge")

        self.assertIn("on scanKnownEdgeAddressBar(theWindow)", script)
        self.assertIn("set addressFieldGroup to UI element 3 of addressToolbar", script)
        self.assertIn("my scanKnownEdgeAddressBar(targetWindow)", script)
        self.assertLess(
            script.index("my scanKnownEdgeAddressBar(targetWindow)"),
            script.index("my scanToolbarFirst(targetWindow)"),
        )

    def test_accessibility_address_bar_script_has_brave_specific_app_bar_path(self) -> None:
        script = accessibility_address_bar_script("Brave Browser")

        self.assertIn("on scanKnownBraveAddressBar(theWindow)", script)
        self.assertIn("set addressContainer to UI element 2 of addressContainer", script)
        self.assertIn("set addressFieldGroup to UI element 5 of addressToolbar", script)
        self.assertIn("my scanKnownBraveAddressBar(targetWindow)", script)
        self.assertLess(
            script.index("my scanKnownBraveAddressBar(targetWindow)"),
            script.index("my scanToolbarFirst(targetWindow)"),
        )

    def test_accessibility_address_bar_script_has_vivaldi_specific_app_bar_path(self) -> None:
        script = accessibility_address_bar_script("Vivaldi")

        self.assertTrue(is_chromium_browser_app("Vivaldi"))
        self.assertIn("on scanKnownVivaldiAddressBar(theWindow)", script)
        self.assertIn("repeat 7 times", script)
        self.assertIn("my scanKnownVivaldiAddressBar(targetWindow)", script)
        self.assertLess(
            script.index("my scanKnownVivaldiAddressBar(targetWindow)"),
            script.index("my scanToolbarFirst(targetWindow)"),
        )

    def test_firefox_family_address_bar_is_found_by_dom_id_before_the_generic_walk(self) -> None:
        for app_name in ("Firefox", "Firefox Developer Edition", "Floorp"):
            script = accessibility_address_bar_script(app_name)

            self.assertIn("on scanKnownFirefoxAddressBar(theWindow)", script)
            self.assertIn('whose value of attribute "AXDOMIdentifier" is "nav-bar"', script)
            self.assertIn('if fieldIdentifier is not "urlbar-input" then return', script)
            self.assertIn("my scanKnownFirefoxAddressBar(targetWindow)", script)
            self.assertNotIn("my scanKnownChromiumAddressBar(targetWindow)", script)
            self.assertLess(
                script.index("my scanKnownFirefoxAddressBar(targetWindow)"),
                script.index("my scanToolbarFirst(targetWindow)"),
            )

    def test_accessibility_address_bar_script_has_opera_specific_app_bar_path(self) -> None:
        script = accessibility_address_bar_script("Opera")

        self.assertTrue(is_chromium_browser_app("Opera"))
        self.assertIn("on scanKnownOperaAddressBar(theWindow)", script)
        self.assertIn("set addressContainer to UI element 4 of theWindow", script)
        self.assertIn("repeat 10 times", script)
        self.assertIn("my scanKnownOperaAddressBar(targetWindow)", script)
        self.assertLess(
            script.index("my scanKnownOperaAddressBar(targetWindow)"),
            script.index("my scanToolbarFirst(targetWindow)"),
        )

    def test_zen_reads_its_address_bar_by_dom_id_then_its_older_layout_without_the_generic_walk(self) -> None:
        script = accessibility_address_bar_script("Zen")

        # Zen 1.23 nests #nav-bar inside #navigator-toolbox; 1.22 kept fixed positions.
        self.assertIn('whose value of attribute "AXDOMIdentifier" is "navigator-toolbox"', script)
        self.assertLess(
            script.index("my scanKnownFirefoxAddressBar(targetWindow)"),
            script.index("my scanKnownZenAddressBar(targetWindow)"),
        )
        self.assertIn("set addressToolbar to toolbar 1 of addressContainer", script)
        self.assertNotIn("my scanToolbarFirst(targetWindow)", script)
        self.assertNotIn("my scanElement(targetWindow)", script)
        self.assertNotIn("entire contents", script)

    def test_accessibility_address_bar_script_has_whale_specific_toolbar_path(self) -> None:
        script = accessibility_address_bar_script("Whale")

        self.assertTrue(is_chromium_browser_app("Whale"))
        self.assertIn("on scanKnownWhaleAddressBar(theWindow)", script)
        self.assertIn("set addressFieldGroup to UI element 7 of addressToolbar", script)
        self.assertIn("my considerAddressCandidate(text field 1 of addressFieldGroup)", script)
        self.assertLess(
            script.index("my scanKnownWhaleAddressBar(targetWindow)"),
            script.index("my scanToolbarFirst(targetWindow)"),
        )

    def test_safari_accessibility_capture_uses_fast_known_path(self) -> None:
        script = accessibility_address_bar_script("Safari")

        self.assertIn("UI element 3 of UI element 3 of toolbar 1 of targetWindow", script)
        self.assertIn("text field 1 of group 3 of toolbar 1 of targetWindow", script)
        self.assertLess(script.index("UI element 3 of UI element 3"), script.index("text field 1 of group 3"))
        self.assertNotIn("entire contents", script)
        self.assertNotIn('tell application "Safari"', script)
        # Both paths report whether the field is being edited; an unreadable focus counts as editing.
        self.assertEqual(script.count("if not (focused of addressField) then set fieldState to \"idle\""), 2)
        self.assertEqual(script.count("return currentUrl & linefeed & axTitle & linefeed & fieldState"), 2)

    def test_safari_address_field_state_is_parsed(self) -> None:
        for state, editing in [("idle", False), ("editing", True), ("unexpected", True)]:
            with self.subTest(state=state):
                metadata = metadata_from_accessibility_address_bar_result(
                    "Safari", f"https://example.com/plan\nPlan\n{state}")
                self.assertEqual(metadata.match_state, "accessibility-address-bar")
                self.assertEqual(metadata.address_field_editing, editing)
        # Browsers that do not report the field's state leave it unknown.
        self.assertIsNone(metadata_from_accessibility_address_bar_result(
            "Firefox", "https://example.com/plan\nPlan").address_field_editing)
        with patch("app.tracker.macos_workspace._run_osascript",
                   return_value="https://example.com/plan\nPlan\nediting"):
            self.assertTrue(_browser_metadata("Safari").address_field_editing)

    def test_accessibility_address_bar_script_targets_main_window_not_front_window(self) -> None:
        script = accessibility_address_bar_script("Aside")

        # The real omnibox lives in the main / standard window. Aside keeps a
        # synthetic contentless overlay ahead of it in the window order, so the
        # scan must target the main window rather than "front window".
        self.assertIn('first window whose value of attribute "AXMain" is true', script)
        self.assertIn('first window whose subrole is "AXStandardWindow"', script)
        self.assertIn("set axTitle to name of targetWindow", script)
        for call in (
            "my scanKnownChromiumAddressBar(targetWindow)",
            "my scanToolbarFirst(targetWindow)",
            "my scanElement(targetWindow)",
        ):
            self.assertIn(call, script)
        # No scan should be run directly against the raw front window.
        self.assertNotIn("scanKnownChromiumAddressBar(front window)", script)
        self.assertNotIn("scanToolbarFirst(front window)", script)
        self.assertNotIn("scanElement(front window)", script)

    def test_run_osascript_uses_timeout(self) -> None:
        with patch("app.tracker.macos_workspace.subprocess.run") as mock_run:
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = "ok\n"
            mock_run.return_value.stderr = ""

            result = _run_osascript("return \"ok\"")

        self.assertEqual(result, "ok")
        self.assertEqual(mock_run.call_args.kwargs["timeout"], 3.0)

    def test_run_osascript_reports_timeout_as_runtime_error(self) -> None:
        with patch(
            "app.tracker.macos_workspace.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd=["osascript"], timeout=3.0),
        ):
            with self.assertRaisesRegex(RuntimeError, "osascript timed out"):
                _run_osascript("delay 5")

    def test_browser_script_marks_missing_scriptable_window(self) -> None:
        script = _browser_script("Google Chrome")

        self.assertIsNotNone(script)
        self.assertIn('"NO_SCRIPTABLE_WINDOW"', script)

    def test_browser_script_supports_chrome_canary(self) -> None:
        script = _browser_script("Google Chrome Canary")

        self.assertIsNotNone(script)
        self.assertIn('tell application "Google Chrome Canary"', script)

    def test_browser_script_supports_aside_as_chromium_browser(self) -> None:
        script = _browser_script("Aside")

        self.assertIsNotNone(script)
        self.assertIn('tell application "Aside"', script)
        self.assertIn('URL of active tab of window 1', script)

    def test_browser_script_recovers_aside_main_title_from_exact_synthetic_window_shape(self) -> None:
        script = _browser_script("Aside")

        self.assertIsNotNone(script)
        self.assertIn('frontSubrole is "AXUnknown" and frontChildCount is 0', script)
        self.assertIn('first window whose value of attribute "AXMain" is true', script)
        self.assertIn('first window whose subrole is "AXStandardWindow"', script)
        self.assertLess(
            script.index('first window whose value of attribute "AXMain" is true'),
            script.index('first window whose subrole is "AXStandardWindow"'),
        )

    def test_browser_script_keeps_aside_synthetic_window_recovery_out_of_other_browsers(self) -> None:
        script = _browser_script("Google Chrome")

        self.assertIsNotNone(script)
        self.assertNotIn('frontSubrole is "AXUnknown" and frontChildCount is 0', script)

    def test_chromium_accessibility_fallback_supports_aside(self) -> None:
        script = accessibility_address_bar_script("Aside")

        self.assertTrue(is_chromium_browser_app("Aside"))
        self.assertIn('process "Aside"', script)

    def test_ax_address_bar_capture_supports_firefox_family_and_safari(self) -> None:
        for app_name in ("Firefox", "Floorp", "Safari", "Safari Technology Preview", "Zen"):
            with self.subTest(app_name=app_name):
                self.assertTrue(is_accessibility_address_bar_browser_app(app_name))
                self.assertIn(f'process "{app_name}"', accessibility_address_bar_script(app_name))

    def test_firefox_uses_ax_address_bar_capture_directly(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="https://example.com/firefox\nExample - Firefox",
        ) as mock_run:
            result = _browser_metadata("Firefox")

        self.assertEqual(result.site_url, "https://example.com/firefox")
        self.assertEqual(result.ax_window_title, "Example - Firefox")
        self.assertEqual(result.match_state, "accessibility-address-bar")
        self.assertEqual(result.browser_automation_status, "granted")
        mock_run.assert_called_once()

    def test_safari_hidden_toolbar_uses_existing_focused_tab_automation(self) -> None:
        with patch("app.tracker.macos_workspace._run_osascript", side_effect=[
            "AX_NO_ADDRESS_FIELD", "https://example.com/current\nCurrent tab\nmatched\nCurrent tab",
        ]) as run:
            result = _browser_metadata("Safari")
        self.assertEqual(result.site_url, "https://example.com/current")
        self.assertEqual(result.site_domain, "example.com")
        self.assertEqual(run.call_count, 2)
        self.assertIn('tell application "Safari"', run.call_args_list[1].args[0])

    def test_safari_readable_toolbar_does_not_request_tab_automation(self) -> None:
        with patch("app.tracker.macos_workspace._run_osascript", return_value="example.com/current\nCurrent tab") as run:
            result = _browser_metadata("Safari")
        self.assertEqual(result.site_domain, "example.com")
        self.assertEqual(run.call_count, 1)

    def test_safari_hidden_toolbar_reports_denied_automation(self) -> None:
        with patch("app.tracker.macos_workspace._run_osascript", side_effect=[
            "AX_NO_ADDRESS_FIELD", RuntimeError("Not authorized to send Apple events to Safari. (-1743)"),
            "AX_NO_ADDRESS_FIELD",
        ]):
            result = _browser_metadata("Safari")
        self.assertIsNone(result.site_url)
        self.assertEqual(result.browser_automation_status, "denied")

    def test_safari_technology_preview_uses_ax_address_bar_capture_directly(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="example.com/preview\nExample - Safari Technology Preview",
        ) as mock_run:
            result = _browser_metadata("Safari Technology Preview")

        self.assertEqual(result.browser_name, "Safari Technology Preview")
        self.assertEqual(result.site_url, "https://example.com/preview")
        self.assertEqual(result.ax_window_title, "Example - Safari Technology Preview")
        self.assertEqual(result.match_state, "accessibility-address-bar-schemaless")
        self.assertEqual(result.browser_automation_status, "granted")
        mock_run.assert_called_once()

    def test_floorp_uses_ax_address_bar_capture_directly(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="https://example.com/floorp\nExample - Floorp",
        ) as mock_run:
            result = _browser_metadata("Floorp")

        self.assertEqual(result.browser_name, "Floorp")
        self.assertEqual(result.site_url, "https://example.com/floorp")
        self.assertEqual(result.match_state, "accessibility-address-bar")
        self.assertEqual(result.browser_automation_status, "granted")
        self.assertIn('process "Floorp"', mock_run.call_args.args[0])

    def test_librewolf_and_waterfox_use_the_firefox_address_field(self) -> None:
        for app in ("LibreWolf", "Waterfox"):
            with self.subTest(app=app), patch(
                "app.tracker.macos_workspace._run_osascript",
                return_value="https://example.com/current\nCurrent page",
            ) as run:
                result = _browser_metadata(app)
                self.assertEqual(result.browser_name, app)
                self.assertEqual(result.site_url, "https://example.com/current")
                self.assertEqual(result.ax_window_title, "Current page")
                self.assertEqual(result.match_state, "accessibility-address-bar")
                run.assert_called_once()
                self.assertIn('process "' + app + '"', run.call_args.args[0])
                self.assertIn('my scanKnownFirefoxAddressBar(targetWindow)', run.call_args.args[0])

    def test_zen_uses_ax_address_bar_capture_directly(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="https://example.com/zen\nExample - Zen",
        ) as mock_run:
            result = _browser_metadata("Zen")

        self.assertEqual(result.browser_name, "Zen")
        self.assertEqual(result.site_url, "https://example.com/zen")
        self.assertEqual(result.match_state, "accessibility-address-bar")
        self.assertEqual(result.browser_automation_status, "granted")
        self.assertIn('process "Zen"', mock_run.call_args.args[0])

    def test_chrome_canary_uses_ax_address_bar_capture_directly(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="example.com/canary\nExample - Chrome Canary",
        ) as mock_run:
            result = _browser_metadata("Google Chrome Canary")

        self.assertEqual(result.browser_name, "Google Chrome Canary")
        self.assertEqual(result.site_url, "https://example.com/canary")
        self.assertEqual(result.match_state, "accessibility-address-bar-schemaless")
        self.assertEqual(result.browser_automation_status, "granted")
        script = mock_run.call_args.args[0]
        self.assertIn('process "Google Chrome Canary"', script)
        self.assertNotIn('tell application "Google Chrome Canary"', script)

    def test_firefox_developer_edition_uses_lowercase_ax_process_name(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="example.com/dev\nExample - Firefox Developer Edition",
        ) as mock_run:
            result = _browser_metadata("Firefox Developer Edition")

        self.assertEqual(result.browser_name, "Firefox Developer Edition")
        self.assertEqual(result.site_url, "https://example.com/dev")
        script = mock_run.call_args.args[0]
        self.assertIn('process "firefox"', script)
        self.assertNotIn('process "Firefox Developer Edition"', script)

    def test_whale_reads_the_scriptable_active_tab_first(self) -> None:
        # Whale 5.39 answered 400/400 tab scripting calls without a hang
        # (macOS 26, 2026-10-10); the exact URL and tab title it returns
        # are what page-content capture binds to.
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="https://example.com/whale\nExample\nmatched\nExample - NAVER Whale",
        ) as mock_run:
            result = _browser_metadata("Whale")

        self.assertEqual(result.browser_name, "Whale")
        self.assertEqual(result.site_url, "https://example.com/whale")
        self.assertEqual(result.site_title, "Example")
        self.assertEqual(result.match_state, "matched")
        self.assertIn('tell application "Whale"', mock_run.call_args.args[0])

    def test_dia_reads_the_tab_of_the_window_its_accessibility_identifier_names(self) -> None:
        # Dia 1.52 shortens the accessibility window title, so the tab is
        # found through the window id inside the focused window's identifier.
        script = _browser_script("Dia")
        self.assertIsNotNone(script)
        self.assertIn('value of attribute "AXIdentifier" of front window', script)
        self.assertIn('starts with "bigBrowserWindow_" then set windowId to text 18 thru -1', script)
        self.assertIn('starts with "bigIncognitoBrowserWindow_" then set windowId to text 27 thru -1', script)
        self.assertEqual(len("bigBrowserWindow_") + 1, 18)
        self.assertEqual(len("bigIncognitoBrowserWindow_") + 1, 27)
        self.assertIn("set w to window id windowId", script)
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="https://docs.python.org/3/library/asyncio.html\nasyncio \u2014 Asynchronous I/O\nmatched\nasyncio \u2014 Asynch\u2026",
        ):
            result = _browser_metadata("Dia")
        self.assertEqual(result.browser_name, "Dia")
        self.assertEqual(result.site_url, "https://docs.python.org/3/library/asyncio.html")
        self.assertEqual(result.site_title, "asyncio \u2014 Asynchronous I/O")
        self.assertEqual(result.match_state, "matched")
        self.assertEqual(result.browser_automation_status, "granted")

    def test_dia_without_a_known_window_identifier_reports_no_window(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="NO_SCRIPTABLE_WINDOW",
        ):
            result = _browser_metadata("Dia")
        self.assertIsNone(result.site_url)
        self.assertEqual(result.browser_automation_status, "unavailable")

    def test_whale_falls_back_to_its_address_bar_when_tab_scripting_fails(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[RuntimeError("execution error: timed out (-1712)"), "example.com/whale\nExample - NAVER Whale"],
        ) as mock_run:
            result = _browser_metadata("Whale")

        self.assertEqual(result.site_url, "https://example.com/whale")
        self.assertEqual(result.match_state, "accessibility-address-bar-schemaless")
        self.assertIn('process "Whale"', mock_run.call_args.args[0])

    def test_browser_metadata_marks_missing_scriptable_window_unavailable(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=["NO_SCRIPTABLE_WINDOW", "AX_NO_ADDRESS_FIELD"],
        ) as mock_run:
            result = _browser_metadata("Google Chrome")

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name="Google Chrome",
                browser_automation_status="unavailable",
                browser_automation_error="Google Chrome accessibility address bar fallback found no readable address field.",
            ),
        )
        self.assertIsNone(result.site_url)
        self.assertEqual(mock_run.call_count, 2)

    def test_browser_metadata_uses_accessibility_address_bar_when_scriptable_window_missing(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[
                "NO_SCRIPTABLE_WINDOW",
                "https://www.example.com/path?from=ax\nExample Page - Google Chrome",
            ],
        ):
            result = _browser_metadata("Google Chrome")

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name="Google Chrome",
                site_domain="example.com",
                site_url="https://www.example.com/path?from=ax",
                ax_window_title="Example Page - Google Chrome",
                match_state="accessibility-address-bar",
                browser_automation_status="granted",
            ),
        )

    def test_browser_metadata_can_force_chromium_accessibility_address_bar(self) -> None:
        with patch.dict(os.environ, {"DRIFTY_FORCE_CHROMIUM_AX_CAPTURE": "1"}), patch(
            "app.tracker.macos_workspace._run_osascript",
            return_value="https://www.example.com/path?from=ax\nExample Page - Google Chrome",
        ) as mock_run:
            result = _browser_metadata("Google Chrome")

        self.assertEqual(result.site_domain, "example.com")
        self.assertEqual(result.site_url, "https://www.example.com/path?from=ax")
        self.assertEqual(result.match_state, "accessibility-address-bar")
        self.assertEqual(mock_run.call_count, 1)

    def test_browser_metadata_normalizes_schemaless_accessibility_address(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[
                RuntimeError("Google Chrome got an error: active tab unavailable."),
                "example.com/docs\nExample Docs - Google Chrome",
            ],
        ):
            result = _browser_metadata("Google Chrome")

        self.assertEqual(result.site_domain, "example.com")
        self.assertEqual(result.site_url, "https://example.com/docs")
        self.assertEqual(result.match_state, "accessibility-address-bar-schemaless")
        self.assertEqual(result.browser_automation_status, "granted")

    def test_browser_metadata_rechecks_address_bar_when_front_fallback_disagrees_with_ax_title(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[
                "\n".join(
                    [
                        "http://127.0.0.1:4173/?v=drifty",
                        "drifty — AI Time Tracker for Focus & Drift",
                        "front-fallback",
                        "Lecture - YouTube - Chrome - Alex",
                    ]
                ),
                "youtube.com/watch?v=lecture\nLecture - YouTube - Chrome - Alex",
            ],
        ) as mock_run:
            result = _browser_metadata("Google Chrome")

        self.assertEqual(result.site_domain, "youtube.com")
        self.assertEqual(result.site_url, "https://youtube.com/watch?v=lecture")
        self.assertEqual(result.youtube_video_id, "lecture")
        self.assertEqual(result.match_state, "accessibility-address-bar-schemaless")
        self.assertEqual(result.browser_automation_status, "granted")
        self.assertEqual(mock_run.call_count, 2)

    def test_browser_metadata_rechecks_address_bar_when_front_fallback_has_no_ax_title(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[
                "\n".join(
                    [
                        "http://127.0.0.1:4173/?v=drifty",
                        "drifty — AI Time Tracker for Focus & Drift",
                        "front-fallback",
                    ]
                ),
                "youtube.com/watch?v=lecture\nLecture - YouTube - Chrome - Alex",
            ],
        ) as mock_run:
            result = _browser_metadata("Google Chrome")

        self.assertEqual(result.site_domain, "youtube.com")
        self.assertEqual(result.site_url, "https://youtube.com/watch?v=lecture")
        self.assertEqual(result.match_state, "accessibility-address-bar-schemaless")
        self.assertEqual(result.browser_automation_status, "granted")
        self.assertEqual(mock_run.call_count, 2)

    def test_browser_metadata_ignores_invalid_accessibility_address_value(self) -> None:
        with patch(
            "app.tracker.macos_workspace._run_osascript",
            side_effect=[
                "NO_SCRIPTABLE_WINDOW",
                "Search Google or type a URL\nNew Tab - Google Chrome",
            ],
        ):
            result = _browser_metadata("Google Chrome")

        self.assertEqual(
            result,
            BrowserMetadata(
                browser_name="Google Chrome",
                browser_automation_status="unavailable",
                browser_automation_error="Google Chrome accessibility address bar fallback returned a non-URL value.",
            ),
        )


if __name__ == "__main__":
    unittest.main()
