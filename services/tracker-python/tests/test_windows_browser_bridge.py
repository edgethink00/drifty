from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.tracker.windows_browser_bridge import (
    browser_bridge_snapshot_path,
    read_browser_bridge_metadata,
)


NOW = datetime(2026, 9, 4, 12, 0, 0, tzinfo=timezone.utc)


class WindowsBrowserBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "active-tab.json"

    def tearDown(self) -> None:
        self.directory.cleanup()

    def write(self, **overrides: object) -> None:
        payload: dict[str, object] = {
            "version": 1,
            "sequence": 7,
            "observedAt": "2026-09-04T12:00:00.000Z",
            "receivedAtEpochMs": int(NOW.timestamp() * 1000),
            "browserFamily": "firefox",
            "tab": {
                "id": 17,
                "windowId": 3,
                "url": "https://www.example.com/docs?q=1",
                "domain": "example.com",
                "title": "Example docs",
            },
        }
        payload.update(overrides)
        self.path.write_text(json.dumps(payload), encoding="utf-8")

    def test_reads_a_fresh_exact_firefox_tab(self) -> None:
        self.write()
        metadata = read_browser_bridge_metadata("Firefox", self.path, NOW)
        self.assertIsNotNone(metadata)
        self.assertEqual(metadata.site_url, "https://www.example.com/docs?q=1")
        self.assertEqual(metadata.site_domain, "example.com")
        self.assertEqual(metadata.site_title, "Example docs")
        self.assertEqual(metadata.match_state, "browser-extension")

    def test_rejects_stale_or_wrong_browser_snapshots(self) -> None:
        self.write(receivedAtEpochMs=int(NOW.timestamp() * 1000) - 6_000)
        self.assertIsNone(read_browser_bridge_metadata("Firefox", self.path, NOW))

        self.write(browserFamily="chromium")
        self.assertIsNone(read_browser_bridge_metadata("Firefox", self.path, NOW))
        self.assertIsNotNone(read_browser_bridge_metadata("Microsoft Edge", self.path, NOW))

    def test_rejects_domain_mismatch_and_non_http_urls(self) -> None:
        self.write(
            tab={
                "id": 17,
                "windowId": 3,
                "url": "https://example.com/",
                "domain": "attacker.test",
                "title": "Mismatch",
            }
        )
        self.assertIsNone(read_browser_bridge_metadata("Firefox", self.path, NOW))

        self.write(
            tab={
                "id": 17,
                "windowId": 3,
                "url": "file:///C:/secret.txt",
                "domain": "",
                "title": "Local",
            }
        )
        self.assertIsNone(read_browser_bridge_metadata("Firefox", self.path, NOW))

    def test_uses_the_per_user_local_app_data_path(self) -> None:
        self.assertEqual(
            browser_bridge_snapshot_path({"LOCALAPPDATA": r"C:\Users\qa\AppData\Local"}),
            Path(r"C:\Users\qa\AppData\Local")
            / "so.drifty.windows"
            / "browser-bridge"
            / "active-tab.json",
        )


if __name__ == "__main__":
    unittest.main()
