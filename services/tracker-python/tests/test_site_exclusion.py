from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import ImportedActivitySegment, TrackerDatabase
from app.tracker.app_exclusion import (
    REDACTED_APP_NAME,
    ExcludedAppRule,
    match_app_exclusion,
    match_exclusion,
    normalize_excluded_site,
)
from app.tracker.capture_contract import Snapshot
from tests.support_cleanup import cleanup_temp_dir


def browser_snapshot(observed_at: str, domain: str, title: str, url: str | None = None) -> Snapshot:
    return Snapshot(
        observed_at=observed_at,
        app_name="Google Chrome",
        bundle_id="com.google.Chrome",
        window_title=f"{title} - Google Chrome",
        source="frontmost",
        browser_name="Google Chrome",
        site_domain=domain,
        site_title=title,
        site_url=url or f"https://{domain}/",
    )


class SiteRuleMatchingTests(unittest.TestCase):
    def test_a_site_rule_covers_its_subdomains_and_nothing_that_only_looks_alike(self) -> None:
        rules = [ExcludedAppRule(id="site:kbstar.com", name="kbstar.com", bundle_id=None, source="user")]
        for domain in ["kbstar.com", "www.kbstar.com", "obank.kbstar.com", "OBank.KBStar.com."]:
            self.assertIsNotNone(match_exclusion("Google Chrome", None, domain, None, rules), domain)
        for domain in ["xkbstar.com", "kbstar.com.evil.io", "kbstar.co"]:
            self.assertIsNone(match_exclusion("Google Chrome", None, domain, None, rules), domain)
        self.assertIsNotNone(match_exclusion("Safari", None, None, "https://www.kbstar.com/quics?page=1", rules))

    def test_site_rules_never_exclude_an_app_by_name(self) -> None:
        rules = [ExcludedAppRule(id="site:notion.so", name="notion.so", bundle_id=None, source="user")]
        self.assertIsNone(match_app_exclusion("notion.so", None, rules))

    def test_addresses_are_reduced_to_one_comparable_host(self) -> None:
        self.assertEqual(normalize_excluded_site("https://www.KBStar.com:443/quics?page=1"), "kbstar.com")
        self.assertEqual(normalize_excluded_site("한국.kr"), normalize_excluded_site("xn--3e0b707e.kr"))
        for invalid in ["", "localhost", "a b.com", "a..b", "https://"]:
            self.assertIsNone(normalize_excluded_site(invalid), invalid)


class SiteExclusionStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        self.database = TrackerDatabase(Path(self.tempdir.name) / "tracker.sqlite3")

    def tearDown(self) -> None:
        self.database.close()
        cleanup_temp_dir(self.tempdir)

    def test_saving_a_site_stores_its_bare_domain_and_rejects_text_that_is_not_a_site(self) -> None:
        saved = self.database.save_excluded_app("site:https://www.KBStar.com/quics", "ignored", "com.ignored")
        self.assertEqual((saved["id"], saved["name"], saved["bundleId"], saved["kind"]), ("site:kbstar.com", "kbstar.com", None, "site"))
        listed = {item["id"]: item["kind"] for item in self.database.get_excluded_apps()}
        self.assertEqual(listed["site:kbstar.com"], "site")
        self.assertEqual(listed["com.1password.1password"], "app")
        with self.assertRaises(ValueError):
            self.database.save_excluded_app("site:not a site", "not a site")

    def test_an_excluded_site_keeps_its_time_and_loses_the_app_title_and_address(self) -> None:
        self.database.save_excluded_app("site:kbstar.com", "kbstar.com")
        self.database.record_snapshot(browser_snapshot("2026-09-11T10:00:00Z", "obank.kbstar.com", "Account balance"), sample_seconds=30)
        self.database.record_snapshot(browser_snapshot("2026-09-11T10:05:00Z", "github.com", "Pull requests"), sample_seconds=30)

        excluded, kept = self.database.fetch_timeline("2026-09-11")
        self.assertEqual(excluded["appName"], REDACTED_APP_NAME)
        self.assertEqual(excluded["durationSeconds"], 30)
        self.assertEqual(excluded["exclusionSource"], "user")
        for field in ["bundleId", "windowTitle", "siteDomain", "siteTitle", "siteUrl", "browserName"]:
            self.assertIsNone(excluded.get(field), field)
        self.assertEqual((kept["appName"], kept["siteDomain"], kept["siteTitle"]), ("Google Chrome", "github.com", "Pull requests"))
        self.assertIsNone(kept.get("exclusionSource"))

    def test_past_records_of_a_site_are_counted_and_deleted_by_domain(self) -> None:
        for minute, domain in enumerate(["kbstar.com", "www.kbstar.com", "obank.kbstar.com", "xkbstar.com", "github.com"]):
            self.database.record_snapshot(browser_snapshot(f"2026-09-11T1{minute}:00:00Z", domain, f"Page {minute}"), sample_seconds=60)
        self.assertEqual(self.database.get_excluded_app_history_count("kbstar.com", None, "kbstar.com"), 3)

        self.assertEqual(self.database.delete_excluded_app_history("kbstar.com", None, "kbstar.com"), 3)
        remaining = sorted(segment["siteDomain"] for segment in self.database.fetch_timeline("2026-09-11"))
        self.assertEqual(remaining, ["github.com", "xkbstar.com"])

    def test_a_record_from_another_device_on_an_excluded_site_arrives_redacted(self) -> None:
        self.database.save_excluded_app("site:kbstar.com", "kbstar.com")
        self.database.set_meta("sync_device_id", "33333333-3333-4333-8333-333333333333")
        result = self.database.apply_synced_segments([{
            "segmentUid": "11111111-1111-4111-8111-111111111111",
            "originDeviceId": "22222222-2222-4222-8222-222222222222",
            "startedAt": "2026-09-11T10:00:00Z",
            "endedAt": "2026-09-11T10:01:00Z",
            "durationSeconds": 60,
            "appName": "Google Chrome",
            "bundleId": "com.google.Chrome",
            "windowTitle": "Account balance - Google Chrome",
            "siteDomain": "obank.kbstar.com",
            "siteTitle": "Account balance",
            "siteUrl": "https://obank.kbstar.com/quics",
            "platform": "macos",
            "source": "unknown",
        }])
        self.assertEqual(result["inserted"], 1)
        segment = self.database.fetch_timeline("2026-09-11")[0]
        self.assertEqual(segment["appName"], REDACTED_APP_NAME)
        self.assertIsNone(segment["siteDomain"])
        self.assertIsNone(segment["siteTitle"])
        self.assertEqual(segment["exclusionSource"], "user")

    def test_imported_browser_history_skips_excluded_sites(self) -> None:
        self.database.save_excluded_app("site:kbstar.com", "kbstar.com")

        def imported(key: str, start: str, domain: str) -> ImportedActivitySegment:
            return ImportedActivitySegment(
                import_key=key, started_at=start, ended_at=start.replace(":00:00", ":10:00"), duration_seconds=600,
                app_name="Google Chrome", bundle_id="com.google.Chrome", window_title=None,
                site_domain=domain, site_title="Page", site_url=f"https://{domain}/",
                youtube_video_id=None, youtube_playlist_id=None, youtube_is_shorts=None,
                browser_name="Google Chrome", site_source="browser-history", platform="macos",
                source="browser-history", confidence=0.5, raw_context_json="{}",
            )

        result = self.database.insert_imported_activity_segments(
            [imported("a", "2026-09-10T09:00:00Z", "obank.kbstar.com"), imported("b", "2026-09-10T10:00:00Z", "github.com")],
            imported_at="2026-09-11T00:00:00Z",
        )
        self.assertEqual(result.inserted_count, 1)
        self.assertEqual([segment["siteDomain"] for segment in self.database.fetch_timeline("2026-09-10")], ["github.com"])


if __name__ == "__main__":
    unittest.main()

