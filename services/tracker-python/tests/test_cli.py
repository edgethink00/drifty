from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.cli.main import CLI_VERSION, run_cli
from app.storage.db import TrackerDatabase


def _iana_zones_available() -> bool:
    """Whether this interpreter can resolve IANA zone keys."""
    try:
        from zoneinfo import ZoneInfo

        ZoneInfo("Asia/Seoul")
    except Exception:
        return False
    return True


class DriftyCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.db_path = self.root / "tracker.sqlite3"
        database = TrackerDatabase(self.db_path, perform_maintenance=False)
        for segment in (
            {
                "started_at": "2026-07-29T09:00:00+09:00",
                "ended_at": "2026-07-29T10:30:00+09:00",
                "duration_seconds": 5400,
                "app_name": "Visual Studio Code",
                "window_title": "Private roadmap SENTINEL_WINDOW",
                "site_domain": None,
                "site_url": None,
            },
            {
                "started_at": "2026-07-29T11:00:00+09:00",
                "ended_at": "2026-07-29T11:45:00+09:00",
                "duration_seconds": 2700,
                "app_name": "Safari",
                "window_title": "Rust docs SENTINEL_WINDOW",
                "site_domain": "docs.rs",
                "site_title": "Tokio",
                "site_url": "https://docs.rs/private?token=SENTINEL_URL",
            },
            {
                "started_at": "2026-07-29T16:00:00+09:00",
                "ended_at": "2026-07-29T16:20:00+09:00",
                "duration_seconds": 1200,
                "app_name": "Safari",
                "window_title": "Video SENTINEL_WINDOW",
                "site_domain": "youtube.com",
                "site_url": "https://youtube.com/watch?v=SENTINEL_URL",
            },
        ):
            database.insert_segment(
                {
                    **segment,
                    "platform": "macos",
                    "source": "test",
                    "raw_context_json": '{"secret":"SENTINEL_RAW"}',
                }
            )
        rows = database.timeline()
        database.save_project({"id": "project-polaris", "name": "Polaris", "description": "Test project", "color": "#4f751e"})
        database.save_project_assignments(
            [
                {"segmentId": rows[0]["id"], "projectId": "project-polaris", "source": "manual", "confidence": 1},
                {"segmentId": rows[1]["id"], "projectId": "project-polaris", "source": "manual", "confidence": 1},
            ]
        )
        database.save_classifications(
            [
                {"segmentId": rows[0]["id"], "category": "Software Development", "productivity": "focus", "source": "manual", "confidence": 1},
                {"segmentId": rows[1]["id"], "category": "Research", "productivity": "focus", "source": "manual", "confidence": 1},
                {"segmentId": rows[2]["id"], "category": "Entertainment", "productivity": "drift", "source": "manual", "confidence": 1},
            ]
        )
        database.close()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def invoke(self, *arguments: str) -> tuple[int, dict]:
        output = io.StringIO()
        with patch.dict(os.environ, {"TZ": "Asia/Seoul"}), redirect_stdout(output):
            exit_code = run_cli(["--db", str(self.db_path), *arguments])
        return exit_code, json.loads(output.getvalue())

    def test_status_uses_read_only_database(self) -> None:
        before = self.db_path.read_bytes()

        exit_code, result = self.invoke("status")

        self.assertEqual(exit_code, 0)
        self.assertTrue(result["data"]["available"])
        self.assertTrue(result["data"]["readOnly"])
        self.assertEqual(self.db_path.read_bytes(), before)

    def test_missing_database_is_not_created(self) -> None:
        missing = self.root / "missing" / "tracker.sqlite3"
        output = io.StringIO()

        with redirect_stdout(output):
            exit_code = run_cli(["--db", str(missing), "status"])

        self.assertEqual(exit_code, 3)
        self.assertEqual(json.loads(output.getvalue())["error"]["code"], "database_not_found")
        self.assertFalse(missing.exists())
        self.assertFalse(missing.parent.exists())

    def test_invalid_arguments_do_not_open_or_create_database(self) -> None:
        missing = self.root / "invalid" / "tracker.sqlite3"
        output = io.StringIO()

        with redirect_stdout(output):
            exit_code = run_cli(["--db", str(missing), "timeline", "--day", "2026-07-29", "--limit", "0"])

        self.assertEqual(exit_code, 2)
        self.assertEqual(json.loads(output.getvalue())["error"]["code"], "invalid_arguments")
        self.assertFalse(missing.parent.exists())

    def test_invalid_cursor_is_rejected_before_missing_database_is_opened(self) -> None:
        missing = self.root / "invalid-cursor" / "tracker.sqlite3"
        output = io.StringIO()

        with redirect_stdout(output):
            exit_code = run_cli(["--db", str(missing), "timeline", "--day", "2026-07-29", "--cursor", "not-a-cursor"])

        self.assertEqual(exit_code, 2)
        self.assertEqual(json.loads(output.getvalue())["error"]["code"], "invalid_arguments")
        self.assertFalse(missing.parent.exists())

    def test_search_rejects_day_mixed_with_to_before_database_access(self) -> None:
        missing = self.root / "mixed-selector" / "tracker.sqlite3"
        output = io.StringIO()

        with redirect_stdout(output):
            exit_code = run_cli([
                "--db", str(missing), "search", "--query", "Polaris", "--day", "2026-07-29", "--to", "2026-07-30T00:00:00+09:00",
            ])

        self.assertEqual(exit_code, 2)
        self.assertEqual(json.loads(output.getvalue())["error"]["code"], "invalid_arguments")
        self.assertFalse(missing.parent.exists())

    def test_cli_version_matches_root_package(self) -> None:
        package_path = SERVICE_ROOT.parents[1] / "package.json"
        if not package_path.is_file():
            self.skipTest("root package.json is outside this checkout")
        package = json.loads(package_path.read_text(encoding="utf-8"))
        self.assertEqual(CLI_VERSION, package["version"])

    def test_summary_returns_deterministic_totals_and_local_bounds(self) -> None:
        # The fixtures are written in KST and the assertions below name the
        # zone, so this needs TZ=Asia/Seoul to actually resolve. Windows has
        # no IANA tzdata unless the optional `tzdata` package is installed.
        if not _iana_zones_available():
            self.skipTest("IANA tzdata unavailable; install the tzdata package")
        exit_code, result = self.invoke("summary", "--day", "2026-07-29")

        self.assertEqual(exit_code, 0)
        self.assertEqual(result["schemaVersion"], 1)
        self.assertEqual(result["query"]["start"], "2026-07-29T00:00:00+09:00")
        self.assertEqual(result["query"]["end"], "2026-07-29T23:59:59+09:00")
        self.assertEqual(result["query"]["timezone"], "Asia/Seoul")
        self.assertEqual(result["data"]["recordedSeconds"], 9300)
        self.assertEqual(result["data"]["focusSeconds"], 8100)
        self.assertEqual(result["data"]["driftSeconds"], 1200)
        self.assertEqual(result["data"]["otherSeconds"], 0)
        self.assertEqual(result["data"]["topApps"][0], {"name": "Visual Studio Code", "seconds": 5400})

    def test_empty_summary_warns_without_claiming_no_activity(self) -> None:
        exit_code, result = self.invoke("summary", "--day", "2026-07-28")

        self.assertEqual(exit_code, 0)
        self.assertEqual(result["data"]["recordedSeconds"], 0)
        self.assertEqual(result["warnings"][0]["code"], "no_records")
        self.assertIn("does not prove", result["warnings"][0]["message"])

    def test_safe_timeline_uses_allowlists(self) -> None:
        exit_code, result = self.invoke("timeline", "--day", "2026-07-29")

        self.assertEqual(exit_code, 0)
        serialized = json.dumps(result)
        self.assertNotIn("windowTitle", serialized)
        self.assertNotIn("siteUrl", serialized)
        self.assertNotIn("bundleId", serialized)
        self.assertNotIn("SENTINEL_WINDOW", serialized)
        self.assertNotIn("SENTINEL_URL", serialized)
        self.assertNotIn("SENTINEL_RAW", serialized)
        self.assertEqual(result["data"]["items"][1]["siteDomain"], "docs.rs")
        self.assertEqual(
            set(result["data"]["items"][0]["classification"]),
            {"category", "productivity"},
        )

    def test_full_timeline_is_explicit_but_still_omits_raw_diagnostics(self) -> None:
        exit_code, result = self.invoke("timeline", "--day", "2026-07-29", "--detail", "full")

        self.assertEqual(exit_code, 0)
        serialized = json.dumps(result)
        self.assertIn("SENTINEL_WINDOW", serialized)
        self.assertIn("SENTINEL_URL", serialized)
        self.assertNotIn("SENTINEL_RAW", serialized)
        self.assertNotIn("inputFingerprint", serialized)

    def test_timeline_pagination_round_trips_opaque_cursor(self) -> None:
        _, first = self.invoke("timeline", "--day", "2026-07-29", "--limit", "2")

        self.assertTrue(first["data"]["hasMore"])
        cursor = first["data"]["nextCursor"]
        _, second = self.invoke("timeline", "--day", "2026-07-29", "--limit", "2", "--cursor", cursor)

        self.assertFalse(second["data"]["hasMore"])
        self.assertEqual(len(second["data"]["items"]), 1)
        first_ids = {item["id"] for item in first["data"]["items"]}
        self.assertNotIn(second["data"]["items"][0]["id"], first_ids)

    def test_search_returns_bounded_matches_and_page_seconds(self) -> None:
        exit_code, result = self.invoke(
            "search",
            "--query",
            "Safari",
            "--from",
            "2026-07-29T00:00:00+09:00",
            "--to",
            "2026-07-30T00:00:00+09:00",
        )

        self.assertEqual(exit_code, 0)
        self.assertEqual(result["query"]["rangePolicy"], "explicit")
        self.assertEqual(result["data"]["resultCount"], 2)
        self.assertEqual(result["data"]["matchedSeconds"], 3900)

    def test_search_matches_assigned_project_names(self) -> None:
        exit_code, result = self.invoke("search", "--query", "Polaris", "--day", "2026-07-29")

        self.assertEqual(exit_code, 0)
        self.assertEqual(result["data"]["resultCount"], 2)
        self.assertEqual(result["data"]["matchedSeconds"], 8100)

    def test_search_accepts_trimmed_iso_fractions_without_changing_data_or_detail(self) -> None:
        before = self.db_path.read_bytes()
        for fraction in ("6", "65", "654", "6549", "65494", "654940", "6549401"):
            for hour, suffix in (("10", "+09:00"), ("01", "Z")):
                with self.subTest(fraction=fraction, suffix=suffix):
                    exit_code, result = self.invoke(
                        "search", "--query", "Safari",
                        "--from", f"2026-07-29T{hour}:59:59.{fraction}{suffix}",
                        "--to", "2026-07-29T11:45:00.5+09:00",
                    )
                    self.assertEqual(exit_code, 0, result)
                    self.assertEqual(result["data"]["resultCount"], 1)
                    self.assertEqual(result["data"]["matchedSeconds"], 2700)
                    normalized = fraction[:6].ljust(6, "0")
                    self.assertIn(f":59.{normalized}", result["query"]["start"])
                    self.assertTrue(result["query"]["end"].endswith(":00.500000+09:00"))
                    self.assertNotIn("SENTINEL", json.dumps(result))
        self.assertEqual(self.db_path.read_bytes(), before)

    def test_search_still_rejects_invalid_or_reversed_fraction_ranges_before_open(self) -> None:
        for start, end in (
            ("2026-07-29T10:59:59..65Z", "2026-07-29T11:45:00Z"),
            ("2026-07-29T10:59:59.65junkZ", "2026-07-29T11:45:00Z"),
            ("2026-07-29T25:59:59.65Z", "2026-07-30T11:45:00Z"),
            ("2026-07-29T11:45:00.65494Z", "2026-07-29T11:45:00.6549Z"),
        ):
            with self.subTest(start=start), patch("app.cli.main._open_database") as open_db:
                exit_code, result = self.invoke("search", "--query", "Safari", "--from", start, "--to", end)
                self.assertEqual(exit_code, 2)
                self.assertEqual(result["error"]["code"], "invalid_arguments")
                open_db.assert_not_called()

    def test_unreadable_schema_uses_stable_error_without_path(self) -> None:
        broken = self.root / "broken.sqlite3"
        sqlite3.connect(broken).close()
        output = io.StringIO()

        with redirect_stdout(output):
            exit_code = run_cli(["--db", str(broken), "status"])

        result = json.loads(output.getvalue())
        self.assertEqual(exit_code, 4)
        self.assertEqual(result["error"]["code"], "database_unreadable")
        self.assertNotIn(str(broken), output.getvalue())


if __name__ == "__main__":
    unittest.main()
