import sqlite3
import subprocess
import sys
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.browser_history import (
    browser_history_metadata,
    chromium_history_paths_for_root,
    firefox_history_paths_for_root,
)


class BrowserHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.root = Path(self.tempdir.name)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_browser_history_imports_with_system_python(self) -> None:
        system_python = Path("/usr/bin/python3")
        if not system_python.exists():
            self.skipTest("/usr/bin/python3 is not available on this host")

        script = (
            "import sys; "
            f"sys.path.insert(0, {str(SERVICE_ROOT)!r}); "
            "import app.tracker.browser_history"
        )
        result = subprocess.run(
            [str(system_python), "-c", script],
            capture_output=True,
            check=False,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def _write_chromium_history(self, profile: str, rows: list[tuple[str, str, int]]) -> Path:
        history_path = self.root / profile / "History"
        history_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(history_path)) as conn:
            conn.execute("CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_time INTEGER)")
            conn.execute("CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER)")
            for index, (url, title, visited_at) in enumerate(rows, start=1):
                conn.execute(
                    "INSERT INTO urls(id, url, title, last_visit_time) VALUES (?, ?, ?, ?)",
                    (index, url, title, visited_at),
                )
                conn.execute(
                    "INSERT INTO visits(url, visit_time) VALUES (?, ?)",
                    (index, visited_at),
                )
            conn.commit()
        return history_path

    def _write_firefox_places(self, profile: str, rows: list[tuple[str, str, int]]) -> Path:
        places_path = self.root / profile / "places.sqlite"
        places_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(places_path)) as conn:
            conn.execute("CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER)")
            conn.execute("CREATE TABLE moz_historyvisits(id INTEGER PRIMARY KEY, place_id INTEGER, visit_date INTEGER)")
            for index, (url, title, visited_at) in enumerate(rows, start=1):
                conn.execute(
                    "INSERT INTO moz_places(id, url, title, last_visit_date) VALUES (?, ?, ?, ?)",
                    (index, url, title, visited_at),
                )
                conn.execute(
                    "INSERT INTO moz_historyvisits(place_id, visit_date) VALUES (?, ?)",
                    (index, visited_at),
                )
            conn.commit()
        return places_path

    def test_chromium_history_paths_for_root_discovers_profiles(self) -> None:
        self._write_chromium_history("Default", [])
        self._write_chromium_history("Profile 1", [])

        paths = chromium_history_paths_for_root(self.root)

        self.assertEqual(paths, [self.root / "Default" / "History", self.root / "Profile 1" / "History"])

    def test_firefox_history_paths_for_root_discovers_profiles(self) -> None:
        self._write_firefox_places("abcd.default-release", [])

        paths = firefox_history_paths_for_root(self.root)

        self.assertEqual(paths, [self.root / "abcd.default-release" / "places.sqlite"])

    def test_browser_history_metadata_reads_chromium_unique_match(self) -> None:
        self._write_chromium_history(
            "Default",
            [("https://www.youtube.com/watch?v=lecture", "Lecture - YouTube", 50)],
        )

        metadata = browser_history_metadata(
            "Google Chrome",
            "Lecture - YouTube - Google Chrome",
            profile_roots={"Google Chrome": self.root},
        )

        self.assertEqual(metadata.site_url, "https://www.youtube.com/watch?v=lecture")
        self.assertEqual(metadata.site_domain, "youtube.com")
        self.assertEqual(metadata.youtube_video_id, "lecture")
        self.assertEqual(metadata.site_title, "Lecture - YouTube")
        self.assertEqual(metadata.match_state, "browser-history-title")
        self.assertEqual(metadata.browser_automation_status, "granted")
        self.assertEqual(metadata.browser_history_status, "matched")
        self.assertEqual(metadata.browser_history_reason, "matched")
        self.assertTrue(metadata.browser_history_database_found)
        self.assertEqual(metadata.browser_history_profile_count, 1)
        self.assertEqual(metadata.browser_history_candidate_count, 1)
        self.assertEqual(metadata.browser_history_error_count, 0)

    def test_browser_history_metadata_reads_firefox_unique_match(self) -> None:
        self._write_firefox_places(
            "abcd.default-release",
            [("https://docs.example.test/local", "Local test page", 40)],
        )

        metadata = browser_history_metadata(
            "Firefox",
            "Local test page - Mozilla Firefox",
            profile_roots={"Firefox": self.root},
        )

        self.assertEqual(metadata.site_url, "https://docs.example.test/local")
        self.assertEqual(metadata.site_domain, "docs.example.test")
        self.assertEqual(metadata.match_state, "browser-history-title")

    def test_browser_history_metadata_rejects_non_url_rows(self) -> None:
        self._write_chromium_history("Default", [("not a url", "Lecture - YouTube", 50)])

        metadata = browser_history_metadata(
            "Google Chrome",
            "Lecture - YouTube - Google Chrome",
            profile_roots={"Google Chrome": self.root},
        )

        self.assertIsNone(metadata.site_url)
        self.assertEqual(metadata.browser_automation_status, "unavailable")
        self.assertIn("no unique browser history title match", metadata.browser_automation_error or "")
        self.assertEqual(metadata.browser_history_status, "no_match")
        self.assertEqual(metadata.browser_history_reason, "no_match")
        self.assertTrue(metadata.browser_history_database_found)
        self.assertEqual(metadata.browser_history_profile_count, 1)
        self.assertEqual(metadata.browser_history_candidate_count, 1)
        self.assertEqual(metadata.browser_history_error_count, 0)

    def test_browser_history_metadata_rejects_internal_browser_urls(self) -> None:
        self._write_chromium_history("Default", [("chrome://settings/privacy", "Privacy", 50)])

        metadata = browser_history_metadata(
            "Google Chrome",
            "Privacy - Google Chrome",
            profile_roots={"Google Chrome": self.root},
        )

        self.assertIsNone(metadata.site_url)
        self.assertEqual(metadata.browser_history_status, "no_match")
        self.assertEqual(metadata.browser_history_reason, "no_match")
        self.assertTrue(metadata.browser_history_database_found)
        self.assertEqual(metadata.browser_history_candidate_count, 1)

    def test_browser_history_metadata_handles_missing_db(self) -> None:
        metadata = browser_history_metadata("Google Chrome", "Docs - Google Chrome", profile_roots={"Google Chrome": self.root})

        self.assertIsNone(metadata.site_url)
        self.assertEqual(metadata.browser_automation_status, "unavailable")
        self.assertIn("no readable browser history database", metadata.browser_automation_error or "")
        self.assertEqual(metadata.browser_history_status, "no_readable_database")
        self.assertEqual(metadata.browser_history_reason, "missing_database")
        self.assertFalse(metadata.browser_history_database_found)
        self.assertEqual(metadata.browser_history_profile_count, 0)
        self.assertEqual(metadata.browser_history_candidate_count, 0)
        self.assertEqual(metadata.browser_history_error_count, 0)

    def test_browser_history_metadata_respects_empty_profile_roots(self) -> None:
        metadata = browser_history_metadata("Google Chrome", "Docs - Google Chrome", profile_roots={})

        self.assertIsNone(metadata.site_url)
        self.assertEqual(metadata.browser_automation_status, "unavailable")
        self.assertIn("no profile root", metadata.browser_automation_error or "")
        self.assertEqual(metadata.browser_history_status, "no_profile_root")
        self.assertEqual(metadata.browser_history_reason, "missing_profile_root")
        self.assertFalse(metadata.browser_history_database_found)

    def test_browser_history_metadata_handles_malformed_db(self) -> None:
        history_path = self.root / "Default" / "History"
        history_path.parent.mkdir(parents=True, exist_ok=True)
        history_path.write_text("not sqlite")

        metadata = browser_history_metadata("Google Chrome", "Docs - Google Chrome", profile_roots={"Google Chrome": self.root})

        self.assertIsNone(metadata.site_url)
        self.assertEqual(metadata.browser_automation_status, "unavailable")
        self.assertEqual(metadata.browser_history_status, "no_readable_database")
        self.assertEqual(metadata.browser_history_reason, "read_error")
        self.assertTrue(metadata.browser_history_database_found)
        self.assertEqual(metadata.browser_history_profile_count, 1)
        self.assertEqual(metadata.browser_history_candidate_count, 0)
        self.assertEqual(metadata.browser_history_error_count, 1)

    def test_browser_history_metadata_handles_copy_failure(self) -> None:
        self._write_chromium_history("Default", [("https://docs.example.test/", "Docs", 10)])

        with patch("app.tracker.browser_history.shutil.copy2", side_effect=OSError("database is locked")):
            metadata = browser_history_metadata("Google Chrome", "Docs - Google Chrome", profile_roots={"Google Chrome": self.root})

        self.assertIsNone(metadata.site_url)
        self.assertEqual(metadata.browser_automation_status, "unavailable")
        self.assertIn("copy failed", metadata.browser_automation_error or "")

    def test_browser_history_metadata_copies_wal_sidecar_when_present(self) -> None:
        history_path = self._write_chromium_history("Default", [("https://docs.example.test/", "Docs", 10)])
        history_path.with_name("History-wal").write_bytes(b"")

        with patch("app.tracker.browser_history.shutil.copy2", wraps=__import__("shutil").copy2) as copy_file:
            browser_history_metadata("Google Chrome", "Docs - Google Chrome", profile_roots={"Google Chrome": self.root})

        copied_names = [Path(call.args[0]).name for call in copy_file.call_args_list]
        self.assertIn("History", copied_names)
        self.assertIn("History-wal", copied_names)

    def test_browser_history_metadata_reports_unsupported_safari(self) -> None:
        metadata = browser_history_metadata("Safari", "Docs - Safari", profile_roots={"Safari": self.root})

        self.assertIsNone(metadata.site_url)
        self.assertIsNone(metadata.browser_name)
        self.assertIsNone(metadata.browser_automation_status)


if __name__ == "__main__":
    unittest.main()
