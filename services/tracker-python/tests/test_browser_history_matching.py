import sys
import unittest
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.browser_history import BrowserHistoryCandidate, match_browser_history_title


class BrowserHistoryTitleMatchingTests(unittest.TestCase):
    def test_matcher_accepts_unique_window_title_with_browser_suffix(self) -> None:
        candidates = [
            BrowserHistoryCandidate(
                url="https://www.youtube.com/watch?v=lecture",
                title="Lecture - YouTube",
                visited_at=20,
                browser_name="Google Chrome",
                profile_name="Default",
            )
        ]

        result = match_browser_history_title("Lecture - YouTube - Chrome - Alex", candidates)

        self.assertEqual(result.candidate, candidates[0])
        self.assertEqual(result.reason, "matched")

    def test_matcher_accepts_korean_chromium_title_suffix(self) -> None:
        candidates = [
            BrowserHistoryCandidate(
                url="https://example.test/docs",
                title="설계 문서",
                visited_at=20,
                browser_name="Google Chrome",
                profile_name="Default",
            )
        ]

        result = match_browser_history_title("설계 문서 - Google Chrome - 프로필 1", candidates)

        self.assertEqual(result.candidate, candidates[0])
        self.assertEqual(result.reason, "matched")

    def test_matcher_rejects_ambiguous_duplicate_titles(self) -> None:
        candidates = [
            BrowserHistoryCandidate(
                url="https://one.example.test/",
                title="Dashboard",
                visited_at=20,
                browser_name="Google Chrome",
                profile_name="Default",
            ),
            BrowserHistoryCandidate(
                url="https://two.example.test/",
                title="Dashboard",
                visited_at=21,
                browser_name="Google Chrome",
                profile_name="Profile 1",
            ),
        ]

        result = match_browser_history_title("Dashboard - Google Chrome", candidates)

        self.assertIsNone(result.candidate)
        self.assertEqual(result.reason, "generic_title")

    def test_matcher_rejects_non_unique_specific_titles(self) -> None:
        candidates = [
            BrowserHistoryCandidate(
                url="https://one.example.test/plan",
                title="Quarterly planning",
                visited_at=20,
                browser_name="Google Chrome",
                profile_name="Default",
            ),
            BrowserHistoryCandidate(
                url="https://two.example.test/plan",
                title="Quarterly planning",
                visited_at=21,
                browser_name="Google Chrome",
                profile_name="Profile 1",
            ),
        ]

        result = match_browser_history_title("Quarterly planning - Google Chrome", candidates)

        self.assertIsNone(result.candidate)
        self.assertEqual(result.reason, "ambiguous_title")

    def test_matcher_rejects_generic_old_candidate(self) -> None:
        candidates = [
            BrowserHistoryCandidate(
                url="https://mail.example.test/inbox",
                title="Inbox",
                visited_at=1,
                browser_name="Firefox",
                profile_name="default",
            )
        ]

        result = match_browser_history_title("Inbox - Mozilla Firefox", candidates)

        self.assertIsNone(result.candidate)
        self.assertEqual(result.reason, "generic_title")

    def test_matcher_accepts_stale_candidate_when_unique_and_specific(self) -> None:
        candidates = [
            BrowserHistoryCandidate(
                url="https://docs.example.test/deep-plan",
                title="Deep plan",
                visited_at=1,
                browser_name="Firefox",
                profile_name="default",
            )
        ]

        result = match_browser_history_title("Deep plan - Mozilla Firefox", candidates)

        self.assertEqual(result.candidate, candidates[0])


if __name__ == "__main__":
    unittest.main()
