"""Tests for Windows browser window-title decoration stripping.

These cases encode a deliberate asymmetry: the module strips what it can
prove, and refuses to guess otherwise. The refusals are as load-bearing as the
successes, because a wrong strip produces a *confident* match against the
wrong history row, while a refusal produces an honest miss.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.windows_window_titles import (  # noqa: E402
    strip_browser_window_decoration,
    windows_page_title_candidates,
)

# Captured from a Korean Windows 11 install; the zero-width space inside
# "Microsoft Edge" is Edge's own, not a typo.
EDGE_KOREAN = "Rust Programming Language \uc678 \ud398\uc774\uc9c0 1\uac1c - \ud504\ub85c\ud544 1 - Microsoft\u200b Edge"
EDGE_KOREAN_SINGLE = "Example Domain - \ud504\ub85c\ud544 1 - Microsoft\u200b Edge"
EDGE_ENGLISH = "My Great Article and 3 more pages - Profile 1 - Microsoft Edge"
CHROME = "Example Domain - Chrome"
FIREFOX = "Example Domain \u2014 Mozilla Firefox"
PYTHON_DOCS = (
    "ctypes \u2014 A foreign function library for Python "
    "\u2014 Python 3.14.7 documentation - Chrome"
)


class StripBrowserDecorationTests(unittest.TestCase):
    def test_strips_chrome_suffix(self) -> None:
        self.assertEqual(strip_browser_window_decoration(CHROME), "Example Domain")

    def test_strips_firefox_em_dash_suffix(self) -> None:
        self.assertEqual(strip_browser_window_decoration(FIREFOX), "Example Domain")

    def test_strips_edge_profile_and_zero_width_product_name(self) -> None:
        self.assertEqual(strip_browser_window_decoration(EDGE_KOREAN_SINGLE), "Example Domain")

    def test_preserves_separators_inside_a_real_title(self) -> None:
        """Rejoining split segments would rewrite the em dashes in this title."""
        self.assertEqual(
            strip_browser_window_decoration(PYTHON_DOCS),
            "ctypes \u2014 A foreign function library for Python \u2014 Python 3.14.7 documentation",
        )

    def test_keeps_dashes_that_belong_to_the_page_title(self) -> None:
        self.assertEqual(
            strip_browser_window_decoration("Some - Title - With - Dashes - Chrome"),
            "Some - Title - With - Dashes",
        )

    def test_unrecognized_suffix_is_left_alone(self) -> None:
        # Guessing here would corrupt a title that simply contains a dash.
        self.assertEqual(
            strip_browser_window_decoration("Quarterly Review - Draft"),
            "Quarterly Review - Draft",
        )

    def test_title_without_separator_is_unchanged(self) -> None:
        self.assertEqual(strip_browser_window_decoration("Just A Title"), "Just A Title")

    def test_empty_input(self) -> None:
        self.assertEqual(strip_browser_window_decoration(None), "")
        self.assertEqual(strip_browser_window_decoration("   "), "")


class PageTitleCandidateTests(unittest.TestCase):
    def test_original_title_is_always_tried_first(self) -> None:
        candidates = windows_page_title_candidates(CHROME)
        self.assertEqual(candidates[0], CHROME)
        self.assertIn("Example Domain", candidates)

    def test_english_tab_count_fragment_is_removed(self) -> None:
        self.assertIn("My Great Article", windows_page_title_candidates(EDGE_ENGLISH))

    def test_localized_tab_count_fragment_is_not_guessed_at(self) -> None:
        """The refusal that keeps a wrong match from looking like a right one.

        In "Rust Programming Language 외 페이지 1개" the word "Language" is
        indistinguishable by shape from the translated count phrase next to it,
        so trimming further would risk matching a different history row with
        full confidence. Reporting no match is the safer outcome.
        """
        candidates = windows_page_title_candidates(EDGE_KOREAN)
        self.assertIn("Rust Programming Language \uc678 \ud398\uc774\uc9c0 1\uac1c", candidates)
        self.assertNotIn("Rust Programming", candidates)
        self.assertNotIn("Rust Programming Language", candidates)

    def test_version_numbers_are_never_mistaken_for_a_tab_count(self) -> None:
        candidates = windows_page_title_candidates(PYTHON_DOCS)
        self.assertTrue(
            any(candidate.endswith("Python 3.14.7 documentation") for candidate in candidates),
            candidates,
        )

    def test_candidates_are_deduplicated_and_ordered(self) -> None:
        candidates = windows_page_title_candidates(CHROME)
        self.assertEqual(len(candidates), len(set(candidates)))

    def test_empty_title_yields_no_candidates(self) -> None:
        self.assertEqual(windows_page_title_candidates(""), [])
        self.assertEqual(windows_page_title_candidates(None), [])


if __name__ == "__main__":
    unittest.main()

