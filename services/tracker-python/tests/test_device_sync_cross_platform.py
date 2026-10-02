"""Portable Mac/Windows exchange through the shipped JSONL tracker protocol."""
from __future__ import annotations

import json
from contextlib import closing
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.db import TrackerDatabase


class CrossPlatformDeviceSyncTests(unittest.TestCase):
    def _serve(self, path: Path, command: str, payload: dict) -> dict:
        # Raw UTF-8 exercises Korean Windows' pipe decoding, not just escaped
        # ASCII JSON. Use disposable stores, never the user's tracker database.
        wire = json.dumps({"id": 7, "command": command, "payload": payload}, ensure_ascii=False)
        result = subprocess.run(
            [sys.executable, str(SERVICE_ROOT / "app/main.py"), "serve", "--db", str(path)],
            input=(wire + "\n").encode("utf-8"), capture_output=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
        response = json.loads(result.stdout)
        self.assertTrue(response["ok"], response)
        self.assertEqual(response["id"], 7)
        return response["data"]

    def test_bidirectional_windows_macos_exchange_preserves_unicode_classification_and_local_origin(self) -> None:
        with TemporaryDirectory() as directory:
            stores = []
            for index, platform in enumerate(("macos", "windows"), 1):
                path = Path(directory) / f"{platform}.sqlite3"
                with closing(TrackerDatabase(path, perform_maintenance=False)) as db:
                    device = f"00000000-0000-4000-8000-{index:012d}"
                    db.set_sync_state({"sync_account_id": "qa-account", "sync_device_id": device})
                    db.insert_segment({
                        "started_at": "2026-01-01T09:00:00+00:00", "ended_at": "2026-01-01T09:01:00+00:00",
                        "duration_seconds": 60, "app_name": "QA Editor", "bundle_id": "qa.editor",
                        "window_title": "동기화 작업 — " + platform, "platform": platform,
                        "source": "uia" if platform == "windows" else "accessibility",
                        "confidence": None, "raw_context_json": "{}",
                    })
                    with db.connect() as conn:
                        row = conn.execute("select id,segment_uid from activity_segments").fetchone()
                    db.save_classifications([{
                        "segmentId": row["id"], "category": "Coding", "productivity": "focus",
                        "source": "llm", "confidence": 0.9,
                    }])
                stores.append((path, platform, device, str(row["id"]), row["segment_uid"]))

            for sender, receiver in ((stores[0], stores[1]), (stores[1], stores[0])):
                outbox = self._serve(sender[0], "get_sync_outbox", {"afterSeq": 0, "hotGraceSeconds": 0})
                self.assertEqual(len(outbox["items"]), 1)
                item = {**outbox["items"][0], "originDeviceId": sender[2]}
                self.assertEqual(self._serve(receiver[0], "apply_synced_segments", {"segments": [item]})["inserted"], 1)
                replay = self._serve(receiver[0], "apply_synced_segments", {"segments": [item]})
                self.assertEqual(replay["inserted"], 0)

            for path, platform, _, _, uid in stores:
                rows = self._serve(path, "get_timeline", {"start": "2026-01-01T00:00:00Z", "end": "2026-01-02T00:00:00Z"})
                self.assertEqual(sorted(row["platform"] for row in rows), ["macos", "windows"])
                self.assertTrue(all("동기화 작업" in row["windowTitle"] for row in rows))
                self.assertTrue(all(row["classification"]["category"] == "Coding" for row in rows))
                outbox = self._serve(path, "get_sync_outbox", {"afterSeq": 0, "hotGraceSeconds": 0})
                self.assertEqual([item["segmentUid"] for item in outbox["items"]], [uid])
                self.assertEqual(outbox["items"][0]["platform"], platform)

            mac, windows = stores
            self._serve(mac[0], "delete_activity_segments", {"ids": [mac[3]]})
            tombstones = self._serve(mac[0], "get_pending_sync_deletions", {})
            self.assertEqual(tombstones[0]["segmentUids"], [mac[4]])
            self.assertEqual(self._serve(windows[0], "apply_synced_deletions", {"deletions": tombstones})["applied"], 1)
            self.assertEqual(self._serve(windows[0], "get_pending_sync_deletions", {}), [])
            self.assertEqual(self._serve(windows[0], "purge_remote_segments", {})["purged"], 0)
            self.assertEqual(self._serve(mac[0], "purge_remote_segments", {})["purged"], 1)
            outbox = self._serve(windows[0], "get_sync_outbox", {"afterSeq": 0, "hotGraceSeconds": 0})
            self.assertEqual(outbox["items"][0]["segmentUid"], windows[4])


if __name__ == "__main__":
    unittest.main()
