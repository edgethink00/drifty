import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.browser_history import BrowserHistoryCandidate, match_browser_history_title

CHROMIUM_EPOCH_OFFSET_SECONDS = 11_644_473_600
HISTORY_TIMESTAMP_MICROSECONDS = 1_000_000


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

    def test_matcher_rejects_distinct_profile_urls_even_when_one_visit_is_nearer(self) -> None:
        observed_at = "2026-06-28T17:06:30+00:00"
        candidates = [
            BrowserHistoryCandidate(
                url="https://one.example.test/plan",
                title="Quarterly planning",
                visited_at=chromium_timestamp("2026-06-28T17:07:30+00:00"),
                browser_name="Google Chrome",
                profile_name="Default",
            ),
            BrowserHistoryCandidate(
                url="https://two.example.test/plan",
                title="Quarterly planning",
                visited_at=chromium_timestamp("2026-06-28T17:06:35+00:00"),
                browser_name="Google Chrome",
                profile_name="Profile 1",
            ),
        ]

        result = match_browser_history_title("Quarterly planning - Google Chrome", candidates, observed_at)

        self.assertIsNone(result.candidate)
        self.assertEqual(result.reason, "ambiguous_url")

    def test_matcher_rejects_distinct_urls_before_preferring_a_longer_title(self) -> None:
        observed_at = "2026-06-28T17:06:30+00:00"
        candidates = [
            BrowserHistoryCandidate(
                url="https://current.example.test/",
                title="Quarterly planning",
                visited_at=chromium_timestamp("2026-06-28T17:06:25+00:00"),
                browser_name="Google Chrome",
                profile_name="Default",
            ),
            BrowserHistoryCandidate(
                url="https://other.example.test/",
                title="Quarterly planning - Google Chrome",
                visited_at=chromium_timestamp("2026-06-28T17:06:28+00:00"),
                browser_name="Google Chrome",
                profile_name="Profile 1",
            ),
        ]

        result = match_browser_history_title(
            "Quarterly planning - Google Chrome - Profile 1",
            candidates,
            observed_at,
        )

        self.assertIsNone(result.candidate)
        self.assertEqual(result.reason, "ambiguous_url")

    def test_matcher_accepts_duplicate_profile_records_for_the_same_url(self) -> None:
        observed_at = "2026-06-28T17:06:30+00:00"
        candidates = [
            BrowserHistoryCandidate(
                url="https://one.example.test/plan",
                title="Quarterly planning",
                visited_at=chromium_timestamp("2026-06-28T17:07:30+00:00"),
                browser_name="Google Chrome",
                profile_name="Default",
            ),
            BrowserHistoryCandidate(
                url="https://one.example.test/plan",
                title="Quarterly planning",
                visited_at=chromium_timestamp("2026-06-28T17:06:35+00:00"),
                browser_name="Google Chrome",
                profile_name="Profile 1",
            ),
        ]

        result = match_browser_history_title("Quarterly planning - Google Chrome", candidates, observed_at)

        self.assertEqual(result.candidate, candidates[1])
        self.assertEqual(result.reason, "matched")

    def test_rejects_less_specific_title_collision_instead_of_guessing(self) -> None:
        observed_at = "2026-06-28T17:06:30+00:00"
        candidates = [
            BrowserHistoryCandidate(
                url="https://project.example.test/",
                title="Project",
                visited_at=chromium_timestamp("2026-06-28T17:06:20+00:00"),
                browser_name="Google Chrome",
                profile_name="Default",
            ),
            BrowserHistoryCandidate(
                url="https://overview.example.test/project",
                title="Project - Overview",
                visited_at=chromium_timestamp("2026-06-28T17:04:30+00:00"),
                browser_name="Google Chrome",
                profile_name="Default",
            ),
        ]

        result = match_browser_history_title("Project - Overview - Google Chrome", candidates, observed_at)

        self.assertIsNone(result.candidate)
        self.assertEqual(result.reason, "ambiguous_url")

    def test_matcher_accepts_unique_title_after_long_dwell(self) -> None:
        observed_at = "2026-06-28T17:06:30+00:00"
        candidates = [
            BrowserHistoryCandidate(
                url="https://docs.example.test/plan",
                title="Quarterly planning",
                visited_at=chromium_timestamp("2026-06-28T17:02:59+00:00"),
                browser_name="Google Chrome",
                profile_name="Default",
            )
        ]

        result = match_browser_history_title("Quarterly planning - Google Chrome", candidates, observed_at)

        self.assertEqual(result.candidate, candidates[0])
        self.assertEqual(result.reason, "matched")

    def test_matcher_accepts_unique_meet_title_after_an_hour(self) -> None:
        observed_at = "2026-06-28T18:10:00+00:00"
        candidates = [
            BrowserHistoryCandidate(
                url="https://meet.google.com/abc-defg-hij",
                title="Meet - abc-defg-hij",
                visited_at=chromium_timestamp("2026-06-28T17:05:00+00:00"),
                browser_name="Aside",
                profile_name="Default",
            )
        ]

        result = match_browser_history_title(
            "Meet - abc-defg-hij - Alex Kim (직장)",
            candidates,
            observed_at,
        )

        self.assertEqual(result.candidate, candidates[0])
        self.assertEqual(result.reason, "matched")

    def test_matcher_still_rejects_shared_title_outside_time_window(self) -> None:
        observed_at = "2026-06-28T17:06:30+00:00"
        candidates = [
            BrowserHistoryCandidate(
                url="https://chatgpt.com/c/one",
                title="ChatGPT",
                visited_at=chromium_timestamp("2026-06-28T17:02:00+00:00"),
                browser_name="Aside",
                profile_name="Default",
            ),
            BrowserHistoryCandidate(
                url="https://chatgpt.com/c/two",
                title="ChatGPT",
                visited_at=chromium_timestamp("2026-06-28T16:50:00+00:00"),
                browser_name="Aside",
                profile_name="Default",
            ),
        ]

        result = match_browser_history_title("ChatGPT - Aside - Alex Kim (직장)", candidates, observed_at)

        self.assertIsNone(result.candidate)
        self.assertEqual(result.reason, "outside_time_window")

    def test_matcher_picks_the_timely_url_when_the_title_is_shared(self) -> None:
        observed_at = "2026-06-28T17:06:30+00:00"
        candidates = [
            BrowserHistoryCandidate(
                url="https://chatgpt.com/c/old",
                title="ChatGPT",
                visited_at=chromium_timestamp("2026-06-28T16:50:00+00:00"),
                browser_name="Aside",
                profile_name="Default",
            ),
            BrowserHistoryCandidate(
                url="https://chatgpt.com/c/now",
                title="ChatGPT",
                visited_at=chromium_timestamp("2026-06-28T17:06:10+00:00"),
                browser_name="Aside",
                profile_name="Default",
            ),
        ]

        result = match_browser_history_title("ChatGPT - Aside", candidates, observed_at)

        self.assertEqual(result.candidate, candidates[1])
        self.assertEqual(result.reason, "matched")

    def test_matcher_accepts_specific_title_inside_time_window(self) -> None:
        observed_at = "2026-06-28T17:06:30+00:00"
        candidates = [
            BrowserHistoryCandidate(
                url="https://docs.example.test/plan",
                title="Quarterly planning",
                visited_at=chromium_timestamp("2026-06-28T17:03:30+00:00"),
                browser_name="Google Chrome",
                profile_name="Default",
            )
        ]

        result = match_browser_history_title("Quarterly planning - Google Chrome", candidates, observed_at)

        self.assertEqual(result.candidate, candidates[0])
        self.assertEqual(result.reason, "matched")

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


def chromium_timestamp(iso_value: str) -> int:
    parsed = datetime.fromisoformat(iso_value).astimezone(timezone.utc)
    return int((parsed.timestamp() + CHROMIUM_EPOCH_OFFSET_SECONDS) * HISTORY_TIMESTAMP_MICROSECONDS)


if __name__ == "__main__":
    unittest.main()
