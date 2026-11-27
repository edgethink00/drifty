"""Tests for the Windows browser-history profile roots.

The history fallback logic is shared with macOS; only the profile locations
differ. These tests pin the two Windows-specific shapes that a wrong path
table would silently break: Chromium profiles nest under ``User Data``, and
Firefox profiles live under ``%APPDATA%`` rather than a Local subtree.

A wrong root does not crash. It reports "no history database found", which
looks identical to a user who genuinely has no history, so these paths need
assertions rather than manual inspection.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.windows_browser_history import windows_browser_roots  # noqa: E402
from app.tracker.windows_browser_uia import _SUPPORTED_BROWSERS  # noqa: E402


class WindowsBrowserRootTests(unittest.TestCase):
    @staticmethod
    def _parts(path) -> list:
        """Path components, independent of the separator the host Path uses.

        These roots are Windows paths, but the suite also runs on macOS where
        Path renders them with forward slashes. Comparing components keeps the
        assertions about *structure* rather than about separators.
        """
        return str(path).replace("\\", "/").split("/")

    def _roots(self) -> dict:
        with patch.dict(
            "os.environ",
            {"LOCALAPPDATA": r"C:\Users\tester\AppData\Local", "APPDATA": r"C:\Users\tester\AppData\Roaming"},
        ):
            return windows_browser_roots()

    def test_chromium_profiles_nest_under_user_data(self) -> None:
        roots = self._roots()
        self.assertEqual(self._parts(roots["Google Chrome"])[-3:], ["Google", "Chrome", "User Data"])
        self.assertEqual(self._parts(roots["Google Chrome Beta"])[-3:], ["Google", "Chrome Beta", "User Data"])
        self.assertEqual(self._parts(roots["Google Chrome Canary"])[-3:], ["Google", "Chrome SxS", "User Data"])
        self.assertEqual(self._parts(roots["Microsoft Edge"])[-3:], ["Microsoft", "Edge", "User Data"])
        self.assertEqual(
            self._parts(roots["Brave Browser"])[-3:], ["BraveSoftware", "Brave-Browser", "User Data"]
        )

    def test_chromium_roots_live_under_local_appdata(self) -> None:
        roots = self._roots()
        self.assertIn("Local", self._parts(roots["Google Chrome"]))

    def test_firefox_family_profiles_live_under_roaming_appdata(self) -> None:
        roots = self._roots()
        self.assertEqual(self._parts(roots["Firefox"])[-3:], ["Mozilla", "Firefox", "Profiles"])
        self.assertIn("Roaming", self._parts(roots["Firefox"]))

    def test_opera_keeps_its_roaming_profile_layout(self) -> None:
        # Opera is the one Chromium browser that does not use a User Data root.
        roots = self._roots()
        self.assertEqual(self._parts(roots["Opera"])[-2:], ["Opera Software", "Opera Stable"])

    def test_every_browser_read_live_on_windows_has_a_history_root(self) -> None:
        # The first-day import reads only these roots; Comet, LibreWolf and Waterfox were
        # read live without one until 2026-11-27.
        self.assertEqual(sorted(set(_SUPPORTED_BROWSERS) - set(self._roots())), [])

    def test_comet_and_gecko_forks_use_their_own_folders(self) -> None:
        roots = self._roots()
        self.assertEqual(self._parts(roots["Comet"])[-4:], ["Local", "Perplexity", "Comet", "User Data"])
        self.assertEqual(self._parts(roots["LibreWolf"])[-3:], ["Roaming", "librewolf", "Profiles"])
        self.assertEqual(self._parts(roots["Waterfox"])[-3:], ["Roaming", "Waterfox", "Profiles"])

    def test_no_macos_only_browsers_are_offered(self) -> None:
        # Safari and Arc have no Windows builds; offering them would produce a
        # permanently empty lookup that reads like a missing-history result.
        roots = self._roots()
        self.assertNotIn("Safari", roots)
        self.assertNotIn("Arc", roots)

    def test_missing_environment_falls_back_to_the_user_profile(self) -> None:
        with patch.dict("os.environ", {}, clear=True), patch(
            "pathlib.Path.home", return_value=Path(r"C:\Users\tester")
        ):
            roots = windows_browser_roots()
        self.assertIn("AppData", self._parts(roots["Google Chrome"]))

    def test_unresolvable_home_yields_no_roots_instead_of_raising(self) -> None:
        """A stripped environment must not crash a capture tick.

        Path.home() raises on Windows when USERPROFILE and HOMEDRIVE/HOMEPATH
        are all absent. This lookup feeds an optional URL fallback, so the
        honest degradation is "no history roots", which downstream already
        reports as no readable database.
        """
        with patch.dict("os.environ", {}, clear=True), patch(
            "pathlib.Path.home", side_effect=RuntimeError("no home directory")
        ):
            self.assertEqual(windows_browser_roots(), {})


if __name__ == "__main__":
    unittest.main()
