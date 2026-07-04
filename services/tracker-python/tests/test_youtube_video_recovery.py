import sys
import unittest
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.youtube_video_recovery import (  # noqa: E402
    YouTubeVideoIdMemory,
    canonical_watch_url,
    is_base_url_blip,
    youtube_video_name,
)

WATCH = "https://www.youtube.com/watch?v=abc123&t=10s"
BASE = "https://www.youtube.com/"
SEARCH = "https://www.youtube.com/results?search_query=%EC%97%98%ED%94%84"
PLAYLIST = "https://www.youtube.com/playlist?list=PL123"
VIDEO_TITLE = "판타지 애니 몰아보기 [애니리뷰] - YouTube - 오디오 재생 - Aside"
HOME_TITLE = "YouTube - Aside"


class YouTubeVideoNameTests(unittest.TestCase):
    def test_extracts_name_before_youtube_marker(self) -> None:
        self.assertEqual(
            youtube_video_name(VIDEO_TITLE, "youtube.com"),
            "판타지 애니 몰아보기 [애니리뷰]",
        )

    def test_home_title_is_not_a_video(self) -> None:
        self.assertIsNone(youtube_video_name(HOME_TITLE, "youtube.com"))
        self.assertIsNone(youtube_video_name("YouTube", "youtube.com"))

    def test_non_youtube_domain_is_ignored(self) -> None:
        self.assertIsNone(youtube_video_name("Cool video - YouTube - Aside", "example.com"))
        self.assertIsNone(youtube_video_name(VIDEO_TITLE, None))

    def test_missing_title_returns_none(self) -> None:
        self.assertIsNone(youtube_video_name(None, "youtube.com"))
        self.assertIsNone(youtube_video_name("just a window", "youtube.com"))

    def test_notification_count_prefix_is_stripped(self) -> None:
        self.assertEqual(
            youtube_video_name("(3) Cool video - YouTube - Aside", "youtube.com"),
            "Cool video",
        )
        # A prefix-only title must not degenerate into an empty or "youtube" key.
        self.assertIsNone(youtube_video_name("(3) YouTube - Aside", "youtube.com"))


class BaseUrlBlipTests(unittest.TestCase):
    def test_bare_base_urls_are_blips(self) -> None:
        for url in (BASE, "https://www.youtube.com", "https://youtube.com/", "https://m.youtube.com/", "http://www.youtube.com/"):
            with self.subTest(url=url):
                self.assertTrue(is_base_url_blip(url))

    def test_page_urls_are_not_blips(self) -> None:
        for url in (
            WATCH,
            SEARCH,
            PLAYLIST,
            "https://www.youtube.com/@somechannel",
            "https://www.youtube.com/feed/subscriptions",
            "https://www.youtube.com/?bp=abc",
            "https://www.youtube.com/#shorts",
            "https://music.youtube.com/",
            "https://example.com/",
        ):
            with self.subTest(url=url):
                self.assertFalse(is_base_url_blip(url))

    def test_missing_or_unparseable_url_is_not_a_blip(self) -> None:
        self.assertFalse(is_base_url_blip(None))
        self.assertFalse(is_base_url_blip(""))
        self.assertFalse(is_base_url_blip("not a url"))


class YouTubeVideoIdMemoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.memory = YouTubeVideoIdMemory()

    def test_recovers_video_id_and_url_for_title_only_blip(self) -> None:
        # First the /watch capture with a real id — remembered.
        vid, url = self.memory.observe(VIDEO_TITLE, "youtube.com", WATCH, "abc123")
        self.assertEqual(vid, "abc123")
        self.assertEqual(url, WATCH)
        # Then a base-URL blip of the SAME video — id + canonical url recovered.
        vid, url = self.memory.observe(VIDEO_TITLE, "youtube.com", BASE, None)
        self.assertEqual(vid, "abc123")
        self.assertEqual(url, canonical_watch_url("abc123"))

    def test_home_page_blip_is_not_recovered(self) -> None:
        self.memory.observe(VIDEO_TITLE, "youtube.com", WATCH, "abc123")
        vid, url = self.memory.observe(HOME_TITLE, "youtube.com", BASE, None)
        self.assertIsNone(vid)
        self.assertEqual(url, BASE)

    def test_unseen_video_title_is_not_recovered(self) -> None:
        vid, url = self.memory.observe("Different video - YouTube - Aside", "youtube.com", BASE, None)
        self.assertIsNone(vid)
        self.assertEqual(url, BASE)

    def test_search_results_for_a_learned_title_are_not_rewritten(self) -> None:
        # Searching YouTube for a watched video's exact name yields the same "<name> - YouTube"
        # title with a /results URL and no v param — that is a browse page, not a watch blip.
        self.memory.observe(VIDEO_TITLE, "youtube.com", WATCH, "abc123")
        vid, url = self.memory.observe(VIDEO_TITLE, "youtube.com", SEARCH, None)
        self.assertIsNone(vid)
        self.assertEqual(url, SEARCH)

    def test_playlist_sharing_a_learned_title_is_not_rewritten(self) -> None:
        self.memory.observe(VIDEO_TITLE, "youtube.com", WATCH, "abc123")
        vid, url = self.memory.observe(VIDEO_TITLE, "youtube.com", PLAYLIST, None)
        self.assertIsNone(vid)
        self.assertEqual(url, PLAYLIST)

    def test_music_youtube_base_url_is_not_rewritten(self) -> None:
        music_base = "https://music.youtube.com/"
        self.memory.observe(VIDEO_TITLE, "youtube.com", WATCH, "abc123")
        vid, url = self.memory.observe(VIDEO_TITLE, "music.youtube.com", music_base, None)
        self.assertIsNone(vid)
        self.assertEqual(url, music_base)

    def test_low_confidence_capture_does_not_teach_the_memory(self) -> None:
        # A front-fallback tab read may describe a different window; its id must not be
        # remembered, so a later blip with the same title stays unrecovered.
        vid, url = self.memory.observe(VIDEO_TITLE, "youtube.com", WATCH, "abc123", learn=False)
        self.assertEqual((vid, url), ("abc123", WATCH))  # capture itself passes through
        vid, url = self.memory.observe(VIDEO_TITLE, "youtube.com", BASE, None)
        self.assertIsNone(vid)
        self.assertEqual(url, BASE)

    def test_low_confidence_blip_still_gets_a_learned_recovery(self) -> None:
        self.memory.observe(VIDEO_TITLE, "youtube.com", WATCH, "abc123")
        vid, url = self.memory.observe(VIDEO_TITLE, "youtube.com", BASE, None, learn=False)
        self.assertEqual(vid, "abc123")
        self.assertEqual(url, canonical_watch_url("abc123"))

    def test_notification_count_prefix_shares_the_memory_key(self) -> None:
        self.memory.observe(f"(3) {VIDEO_TITLE}", "youtube.com", WATCH, "abc123")
        vid, url = self.memory.observe(VIDEO_TITLE, "youtube.com", BASE, None)
        self.assertEqual(vid, "abc123")
        self.assertEqual(url, canonical_watch_url("abc123"))

    def test_present_id_passes_through_unchanged(self) -> None:
        vid, url = self.memory.observe(VIDEO_TITLE, "youtube.com", WATCH, "xyz789")
        self.assertEqual((vid, url), ("xyz789", WATCH))

    def test_latest_id_wins_for_a_reused_title(self) -> None:
        self.memory.observe(VIDEO_TITLE, "youtube.com", WATCH, "first")
        self.memory.observe(VIDEO_TITLE, "youtube.com", WATCH, "second")
        vid, _ = self.memory.observe(VIDEO_TITLE, "youtube.com", BASE, None)
        self.assertEqual(vid, "second")

    def test_evicts_oldest_beyond_capacity(self) -> None:
        memory = YouTubeVideoIdMemory(max_entries=2)
        memory.observe("A - YouTube", "youtube.com", WATCH, "idA")
        memory.observe("B - YouTube", "youtube.com", WATCH, "idB")
        memory.observe("C - YouTube", "youtube.com", WATCH, "idC")  # evicts A
        vid_a, _ = memory.observe("A - YouTube", "youtube.com", BASE, None)
        vid_c, _ = memory.observe("C - YouTube", "youtube.com", BASE, None)
        self.assertIsNone(vid_a)
        self.assertEqual(vid_c, "idC")


if __name__ == "__main__":
    unittest.main()
