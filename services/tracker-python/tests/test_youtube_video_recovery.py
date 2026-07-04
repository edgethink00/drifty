import sys
import unittest
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.youtube_video_recovery import (  # noqa: E402
    YouTubeVideoIdMemory,
    canonical_watch_url,
    youtube_video_name,
)

WATCH = "https://www.youtube.com/watch?v=abc123&t=10s"
BASE = "https://www.youtube.com/"
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
