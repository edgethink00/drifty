from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from app.storage.db import TrackerDatabase
from app.text_safety import replace_lone_surrogates, without_lone_surrogates
from app.tracker.capture_contract import Snapshot
from app.tracker.windows_workspace import ForegroundWindow, ProcessIdentity, build_snapshot

TRUNCATED_EMOJI_TITLE = "Party \U0001F389 plan \ud83d"


class ReplaceLoneSurrogatesTests(unittest.TestCase):
    def test_replaces_only_the_unpaired_half(self) -> None:
        self.assertEqual(replace_lone_surrogates(TRUNCATED_EMOJI_TITLE), "Party \U0001F389 plan \ufffd")
        self.assertEqual(replace_lone_surrogates("\ude00 tail"), "\ufffd tail")

    def test_leaves_ordinary_text_untouched(self) -> None:
        for value in ("", "plain", "한국어 제목", "emoji \U0001F600 ok"):
            self.assertIs(replace_lone_surrogates(value), value)

    def test_copies_a_dataclass_only_when_a_field_needs_it(self) -> None:
        clean = Snapshot(observed_at="t", app_name="Chrome", bundle_id=None, window_title="ok", source="test")
        self.assertIs(without_lone_surrogates(clean), clean)
        dirty = Snapshot(observed_at="t", app_name="Chrome", bundle_id=None, window_title=TRUNCATED_EMOJI_TITLE, source="test")
        self.assertEqual(without_lone_surrogates(dirty).window_title, "Party \U0001F389 plan \ufffd")
        self.assertEqual(dirty.window_title, TRUNCATED_EMOJI_TITLE)


class TruncatedWindowsTitleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp())
        self.database = TrackerDatabase(self.root / "tracker.sqlite3")

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def test_windows_snapshot_repairs_a_title_cut_inside_an_emoji(self) -> None:
        window = ForegroundWindow(hwnd=1, title=TRUNCATED_EMOJI_TITLE, pid=5)
        identity = ProcessIdentity(exe_path="C:\\Apps\\Chat.exe", exe_name="Chat", aumid=None)

        snapshot = build_snapshot(window, identity, observed_at="2026-09-26T22:44:00+00:00")

        self.assertEqual(snapshot.window_title, "Party \U0001F389 plan \ufffd")

    def test_record_snapshot_stores_a_title_with_an_unpaired_surrogate(self) -> None:
        # DRIFTY-MAC-NATIVE-16: "surrogates not allowed" rejected the whole row.
        self.database.record_snapshot(
            Snapshot(
                observed_at="2026-09-26T22:44:00+00:00",
                app_name="Chat",
                bundle_id="c:\\apps\\chat.exe",
                window_title=TRUNCATED_EMOJI_TITLE,
                source="win32-foreground",
            ),
            5,
        )

        with self.database.connect() as conn:
            titles = [row["window_title"] for row in conn.execute("SELECT window_title FROM activity_segments")]
        self.assertEqual(titles, ["Party \U0001F389 plan \ufffd"])


if __name__ == "__main__":
    unittest.main()
