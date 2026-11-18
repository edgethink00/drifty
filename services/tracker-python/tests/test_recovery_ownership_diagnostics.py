from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))
from app.storage import database_maintenance as maintenance

TOOL = SERVICE / "app" / "storage" / "recovery_ownership_diagnostics.py"
COPY = "tracker-20261006T000000000000Z.sqlite3"
AUDITED_RUN = r"""
import os, pathlib, runpy, sys
tool, database, mode = sys.argv[1:4]
root = pathlib.Path(database).parent
changed = False
root_scans = 0
injecting = False
def audit(event, args):
    global changed, root_scans, injecting
    if injecting:
        return
    if event == 'os.scandir' and pathlib.Path(args[0]) == root:
        root_scans += 1
        if mode == 'race' and root_scans == 2:
            injecting = True
            (root / 'concurrent-publication').write_bytes(b'external publisher')
            injecting = False
    if event.startswith('socket.') or event == 'sqlite3.connect':
        raise AssertionError('Database/network access forbidden')
    if event in ('os.remove', 'os.rename', 'os.mkdir', 'os.chmod', 'os.truncate'):
        raise AssertionError('Filesystem mutation forbidden')
    if event != 'open':
        return
    path, textmode, flags = args
    if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
        raise AssertionError('Filesystem write forbidden')
    if not isinstance(path, (str, bytes)):
        return
    p = pathlib.Path(os.fsdecode(path))
    if p.parent == root and p.name == '.tracker.sqlite3.backup-order':
        if mode == 'deny':
            raise PermissionError('PRIVATE_EXCEPTION_MUST_NOT_ESCAPE')
    if p == pathlib.Path(database) or (p.parent == root and not (p.name.casefold().endswith('.backup-order') or p.name == 'tracker.pid')) or p.parent == root / 'database-backups':
        raise AssertionError('Database body read forbidden')
sys.addaudithook(audit)
sys.argv = [tool, database]
runpy.run_path(tool, run_name='__main__')
"""


class RecoveryOwnershipDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / "tracker.sqlite3"
        self.db.write_bytes(b"PRIVATE_DATABASE_CONTENT_MUST_NOT_BE_READ")
        self.backups = self.root / "database-backups"
        self.backups.mkdir()

    def copy(self, name=COPY):
        path = self.backups / name
        path.write_bytes(b"PRIVATE_BACKUP_CONTENT_MUST_NOT_BE_READ")
        return path

    def record(self, owner="tracker.sqlite3", names=(COPY,)):
        path = self.root / ("." + owner + ".backup-order")
        path.write_text("\n".join(names), encoding="utf-8")
        return path

    def snapshot(self):
        return {
            str(p.relative_to(self.root)): (
                p.lstat().st_mode, p.lstat().st_mtime_ns,
                hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() and not p.is_symlink() else None,
            ) for p in self.root.rglob("*")
        }

    def observe(self, state, *, reason=None, differential=True, mode="normal"):
        before = self.snapshot()
        process = subprocess.run(
            [sys.executable, "-B", "-c", AUDITED_RUN, str(TOOL), str(self.db), mode],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(process.returncode, {"not_observed": 0, "ambiguous": 1, "unknown": 2}[state], process.stderr)
        self.assertTrue(process.stdout.strip(), process.stderr)
        result = json.loads(process.stdout)
        self.assertEqual(result["state"], state)
        self.assertIs(result["deletionAuthorized"], False)
        self.assertEqual(result["scope"], "legacy_backup_ownership")
        if reason:
            self.assertEqual(result["reason"], reason)
        after = self.snapshot()
        if mode == "race":
            self.assertIn("concurrent-publication", after)
            del after["concurrent-publication"]
        self.assertEqual(after, before)
        for private in [str(self.root), self.db.name, COPY, "PRIVATE_", "Traceback"]:
            self.assertNotIn(private, process.stdout + process.stderr)
        if differential and state != "unknown":
            self.assertEqual(maintenance._has_ambiguous_legacy_backups(self.db), state == "ambiguous")
        return result

    def test_no_copy_does_not_claim_deletion_is_safe(self):
        self.observe("not_observed")

    def test_single_family_legacy_copy_is_not_ambiguous(self):
        self.copy()
        result = self.observe("not_observed")
        self.assertEqual(result["unattributedCopies"], 1)

    def test_same_stem_other_suffix_blocks_legacy_ownership(self):
        self.copy()
        (self.root / "tracker.db").write_bytes(b"foreign")
        self.observe("ambiguous")

    def test_hyphenated_family_and_suffixless_database_overlap(self):
        self.copy()
        (self.root / "tracker-other").write_bytes(b"foreign")
        self.observe("ambiguous")

    def test_shorter_hyphenated_family_also_overlaps(self):
        self.db.rename(self.root / "tracker-other.sqlite3")
        self.db = self.root / "tracker-other.sqlite3"
        self.copy("tracker-other-20261006T000000000000Z.sqlite3")
        (self.root / "tracker.db").write_bytes(b"foreign")
        self.observe("ambiguous")

    def test_durable_lock_claim_survives_missing_foreign_database(self):
        self.copy()
        (self.root / ".tracker.db.maintenance.lock").write_bytes(b"")
        self.observe("ambiguous")

    def test_own_record_disambiguates_our_copy(self):
        self.copy()
        self.record()
        (self.root / "tracker.db").write_bytes(b"foreign")
        self.observe("not_observed")

    def test_case_variant_own_record_is_not_mistaken_for_missing(self):
        self.copy()
        old = self.record()
        old.rename(self.root / ".tracker.sqlite3.BACKUP-ORDER")
        (self.root / "tracker.db").write_bytes(b"foreign")
        if os.name == "nt":
            self.observe("not_observed")
        elif old.exists():
            self.observe("unknown", reason="noncanonical_metadata_name")
        else:
            self.observe("ambiguous")

    def test_foreign_record_excludes_its_copy(self):
        self.copy()
        self.record("tracker.db")
        self.observe("not_observed")

    def test_foreign_claim_does_not_hide_another_unattributed_copy(self):
        self.copy()
        self.record("tracker.db")
        self.copy("tracker-legacy.sqlite3")
        self.observe("ambiguous")

    def test_valid_ascii_pid_and_own_sqlite_sidecars_are_not_other_databases(self):
        self.copy()
        (self.root / "tracker.pid").write_bytes(b"123\n")
        for suffix in ("-wal", "-shm", "-journal"):
            (self.root / (self.db.name + suffix)).write_bytes(b"own sidecar")
        self.observe("not_observed")

    def test_invalid_pid_file_remains_an_ownership_candidate(self):
        self.copy()
        (self.root / "tracker.pid").write_bytes(b"not proven process metadata")
        self.observe("ambiguous")

    def test_unrelated_names_do_not_overlap(self):
        self.copy()
        (self.root / "trackerother.db").write_bytes(b"unrelated")
        self.observe("not_observed")

    def test_invalid_duplicate_traversal_and_empty_records_are_unknown(self):
        for names in [(COPY, COPY), ("../PRIVATE_DB.sqlite3",), ()]:
            with self.subTest(names=names):
                self.record(names=names)
                self.observe("unknown", reason="invalid_order_record")

    def test_invalid_foreign_record_is_not_silently_ignored(self):
        self.record("tracker.db", ("PRIVATE_BAD_NAME",))
        self.observe("unknown", reason="invalid_order_record")

    @unittest.skipUnless(os.name == "nt", "Windows filesystem matching contract")
    def test_windows_case_insensitive_order_suffix_matches_existing_guard(self):
        self.copy()
        path = self.record("tracker.db", ("tracker-20261007T000000000000Z.sqlite3",))
        path.rename(self.root / ".tracker.db.BACKUP-ORDER")
        self.observe("ambiguous")

    def test_nonregular_own_record_is_unknown(self):
        (self.root / ".tracker.sqlite3.backup-order").mkdir()
        self.observe("unknown", reason="unsupported_metadata")

    def test_metadata_hardlink_cannot_read_the_database_body(self):
        os.link(self.db, self.root / ".tracker.sqlite3.backup-order")
        self.observe("unknown", reason="metadata_aliases_database")

    def test_metadata_hardlink_cannot_read_a_backup_body(self):
        os.link(self.copy(), self.root / ".tracker.sqlite3.backup-order")
        self.observe("unknown", reason="metadata_aliases_database")

    def test_invalid_record_encoding_is_unknown(self):
        self.record().write_bytes(b"\xff\xfe")
        self.observe("unknown", reason="invalid_order_record")

    def test_oversized_record_is_bounded_and_unknown(self):
        self.record(names=("x" * 65537,))
        self.observe("unknown", reason="record_limit")

    def test_total_metadata_budget_cannot_be_multiplied_by_many_owners(self):
        for owner in range(30):
            stem = "tracker-" + str(owner)
            self.record(stem + ".db", tuple(
                stem + "-20261006T000000" + str(index).zfill(6) + "Z.sqlite3"
                for index in range(1000)
            ))
        self.observe("unknown", reason="metadata_budget")

    def test_permission_failure_is_unknown_and_exception_is_redacted(self):
        self.record()
        self.observe("unknown", reason="permission_denied", mode="deny")

    def test_missing_database_is_unknown_without_creating_it(self):
        self.db.unlink()
        self.observe("unknown", reason="database_missing_or_not_regular")

    def test_concurrent_publication_is_unknown_without_mutating_old_files(self):
        self.copy()
        self.record()
        self.observe("unknown", reason="concurrent_change", mode="race")

    @unittest.skipIf(os.name == "nt", "Creating symlinks requires a guest privilege; do not request it")
    def test_symlink_copy_is_unknown_without_following_target(self):
        (self.backups / COPY).symlink_to(self.db)
        self.observe("unknown", reason="symbolic_link")

    def test_directory_budget_is_unknown_instead_of_partial_clear(self):
        for index in range(4096):
            (self.root / ("unrelated-" + str(index))).touch()
        self.observe("unknown", reason="entry_limit")


if __name__ == "__main__":
    unittest.main()
