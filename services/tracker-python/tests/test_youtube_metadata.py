import sys
import unittest
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.youtube_metadata import parse_youtube_watch_metadata


class YouTubeMetadataTests(unittest.TestCase):
    def test_parse_youtube_watch_metadata_reads_microformat_category(self) -> None:
        page = '''
        <html><script>
        var ytInitialPlayerResponse = {
          "videoDetails": {
            "videoId": "abc123",
            "title": "Lecture Title",
            "author": "MIT OpenCourseWare",
            "channelId": "channel-1",
            "shortDescription": "A useful lecture description.",
            "keywords": ["lecture", "computer science"],
            "lengthSeconds": "1200",
            "viewCount": "12345",
            "isLiveContent": false
          },
          "microformat": {
            "playerMicroformatRenderer": {
              "category": "Education",
              "isUnlisted": true,
              "publishDate": "2026-04-06",
              "uploadDate": "2026-04-05"
            }
          }
        };
        </script></html>
        '''

        metadata = parse_youtube_watch_metadata(page, "abc123")

        self.assertEqual(metadata.category, "Education")
        self.assertEqual(metadata.channel_id, "channel-1")
        self.assertEqual(metadata.channel_name, "MIT OpenCourseWare")
        self.assertEqual(metadata.title, "Lecture Title")
        self.assertEqual(metadata.description, "A useful lecture description.")
        self.assertEqual(metadata.keywords, ["lecture", "computer science"])
        self.assertEqual(metadata.duration_seconds, 1200)
        self.assertEqual(metadata.view_count, 12345)
        self.assertFalse(metadata.is_live)
        self.assertTrue(metadata.is_unlisted)
        self.assertEqual(metadata.publish_date, "2026-04-06")
        self.assertEqual(metadata.upload_date, "2026-04-05")


if __name__ == "__main__":
    unittest.main()
