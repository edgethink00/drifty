from __future__ import annotations

import copy
import io
import os
import struct
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.tracker.browser_content import (
    BROWSER_BUNDLES,
    CONTENT_EXCLUDED_HOSTS,
    CONTENT_EXCLUDED_PATH,
    capture_browser_content,
    content_excluded_url,
    normalize_clues,
    normalize_context,
)
from app.tracker.browser_content_host import admitted_clues, browser_parent_pid, read_native, write_native
from app.storage.adaptive_context_serialization import sanitized_raw_context_json


def fixture():
    bounds = dict(left=10, top=20, width=1000, height=700)
    identity = dict(workerEpoch="worker", revision=2, tabId=3, windowId=4, documentId="document", lifecycle="active", focused=True, incognito=False, permission=True, sensitive=False, url="https://example.org/course", title="Course", bounds=bounds)
    dom = dict(documentId="document", revision=5, visible=True, pageFocused=True)
    sample = dict(before=copy.deepcopy(identity), after=copy.deepcopy(identity), dom=dict(before=copy.deepcopy(dom), after=copy.deepcopy(dom), url=identity["url"], title=identity["title"], clues=dict(description="Course description", headings=["Homework"], visibleTopic=["Deadline Friday"])))
    current = dict(identity=copy.deepcopy(identity), after=copy.deepcopy(identity), dom=copy.deepcopy(dom))
    owner = dict(pid=100, bundleId="com.google.Chrome", processAlive=True, processLaunchTime=123.5, frontmostOwned=True, focusRevision=2, windowRevision=3, windows=[dict(id=99, **bounds)])
    expected = dict(pageUrl=identity["url"], pageTitle=identity["title"], bundleId=owner["bundleId"])
    return sample, current, [copy.deepcopy(owner) for _ in range(3)], expected


class BrowserContentTests(unittest.TestCase):
    def test_page_exclusions_match_the_macos_helper_exactly(self):
        import re
        swift = (Path(__file__).resolve().parents[1] / "app/tracker/chatgpt_session_ax.swift").read_text(encoding="utf-8")
        hosts_line = next(line for line in swift.splitlines() if line.strip().startswith("let excluded = ["))
        self.assertEqual(tuple(re.findall(r'"([^"]+)"', hosts_line)), CONTENT_EXCLUDED_HOSTS)
        path_pattern = re.search(r'url\.path\.range\(of: #"(.+?)"#', swift).group(1)
        self.assertEqual(path_pattern, CONTENT_EXCLUDED_PATH.pattern)

    def test_page_clue_browsers_match_the_macos_helper_allowlist(self):
        import re
        swift = (Path(__file__).resolve().parents[1] / "app/tracker/chatgpt_session_ax.swift").read_text(encoding="utf-8")
        sample = swift.split("func sample()", 1)[1]
        gecko = re.findall(r'"([^"]+)"', next(line for line in sample.splitlines() if "let geckoBundles = [" in line))
        allowed = re.findall(r'"([^"]+)"', next(line for line in sample.splitlines() if "let allowed = [" in line))
        self.assertEqual(set(allowed) | set(gecko), set(BROWSER_BUNDLES))
        # Arc's scripting window class is WiND and it has no bounds property.
        self.assertIn("company.thebrowser.Browser", BROWSER_BUNDLES)
        self.assertIn('specifier(arc ? "WiND" : "cwin"', sample)

    def test_message_mail_chat_editor_and_account_pages_are_excluded(self):
        for url in ("https://mail.google.com/mail/u/0/#inbox", "https://app.slack.com/client/T1/C2",
                    "https://teams.microsoft.com/v2/", "https://chatgpt.com/c/abc", "https://www.notion.so/page",
                    "https://docs.google.com/document/d/1/edit", "https://example.org/login",
                    "https://example.org/Account/settings", "https://shop.example/checkout/", "https://example.org/My%20x/inbox",
                    "not a url", ""):
            self.assertTrue(content_excluded_url(url), url)
        for url in ("https://github.com/rust-lang/rust", "https://en.wikipedia.org/wiki/Authentication",
                    "https://docs.python.org/3/library/asyncio.html", "https://notslack.com/", "https://example.org/accounting"):
            self.assertFalse(content_excluded_url(url), url)

    def test_browser_parent_resolver_passes_own_pid_and_only_frozen_executable(self):
        helper = Path("/task/helper")
        executable = str(Path("/task/tracker"))
        canonical_executable = os.path.realpath(executable)
        for frozen in (False, True):
            with self.subTest(frozen=frozen), patch.object(sys,"frozen",frozen,create=True), patch("os.getpid",return_value=321), patch("sys.executable",executable), patch("subprocess.run",return_value=SimpleNamespace(returncode=0,stdout='{"browserPid":100}')) as run:
                self.assertEqual(browser_parent_pid(helper),100)
                command=run.call_args.args[0]
                self.assertEqual(command,[str(helper),"--native-browser-parent","321"]+([canonical_executable] if frozen else []))
                self.assertEqual(run.call_args.kwargs["timeout"],1)

    def test_unverified_or_unavailable_native_parent_opens_no_bridge(self):
        for reply in ['{}','null','{"browserPid":true}','{"browserPid":1}','{"browserPid":"100"}','not-json']:
            with self.subTest(reply=reply), patch("subprocess.run",return_value=SimpleNamespace(returncode=0,stdout=reply)):
                self.assertIsNone(browser_parent_pid(Path("helper")))
        for failure in [OSError(),subprocess.TimeoutExpired("helper",1)]:
            with patch("subprocess.run",side_effect=failure):self.assertIsNone(browser_parent_pid(Path("helper")))
        with patch("sys.platform","darwin"), patch.dict(sys.modules, {"fcntl": SimpleNamespace()}), patch("app.tracker.browser_content_host.private_directory",return_value=True), patch("app.tracker.browser_content_host.browser_parent_pid",return_value=None), patch("os.open") as open_bridge:
            from app.tracker.browser_content import EXTENSION_ORIGIN
            from app.tracker.browser_content_host import run_native_host
            self.assertEqual(run_native_host(EXTENSION_ORIGIN,helper_path=Path("helper")),1)
            open_bridge.assert_not_called()

    def test_unsupported_native_host_opens_no_bridge_or_mac_dependencies(self):
        from app.tracker.browser_content import EXTENSION_ORIGIN
        from app.tracker.browser_content_host import run_native_host
        for platform in ("win32", "linux"):
            with self.subTest(platform=platform), patch("sys.platform", platform), patch.dict(sys.modules, {"fcntl": None}), patch("app.tracker.browser_content_host.private_directory") as directory, patch("app.tracker.browser_content_host.browser_parent_pid") as parent, patch("os.open") as open_bridge:
                self.assertEqual(run_native_host(EXTENSION_ORIGIN, helper_path=Path("helper")), 1)
                directory.assert_not_called()
                parent.assert_not_called()
                open_bridge.assert_not_called()

    def test_packaged_native_dispatch_bypasses_cli_database_and_telemetry(self):
        from app import main
        from app.tracker.browser_content import EXTENSION_ORIGIN
        for arguments in [["tracker", EXTENSION_ORIGIN], ["tracker", "browser-context-host", EXTENSION_ORIGIN]]:
            with self.subTest(arguments=arguments), patch("sys.argv", arguments), patch("app.tracker.browser_content_host.run_native_host", return_value=0) as host, patch.object(main, "init_tracker_sentry") as telemetry, patch.object(main, "TrackerDatabase") as database, patch("app.cli.run_cli") as cli:
                with self.assertRaises(SystemExit) as exit:
                    main.main()
                self.assertEqual(exit.exception.code, 0)
                host.assert_called_once_with(EXTENSION_ORIGIN)
                telemetry.assert_not_called()
                database.assert_not_called()
                cli.assert_not_called()

    def test_native_and_document_agreement_required(self):
        s, c, owners, e = fixture()
        self.assertEqual(admitted_clues(s, c, owners, e, 100), s["dom"]["clues"])
        for field, value in [("incognito", True), ("permission", False), ("focused", False), ("sensitive", True), ("documentId", "new"), ("revision", 4), ("workerEpoch", "restart"), ("url", "https://other.org/")]:
            with self.subTest(field=field):
                s, c, owners, e = fixture(); c["after"][field] = value
                self.assertIsNone(admitted_clues(s, c, owners, e, 100))

    def test_native_focus_aba_restart_and_equal_geometry_fail_closed(self):
        for field, value in [("focusRevision", 4), ("processLaunchTime", 999), ("windowRevision", 8), ("frontmostOwned", False), ("pid", 101), ("bundleId", "other")]:
            s, c, owners, e = fixture(); owners[2][field] = value
            self.assertIsNone(admitted_clues(s, c, owners, e, 100))
        s, c, owners, e = fixture(); owners[0]["windows"].append(dict(owners[0]["windows"][0], id=98))
        self.assertIsNone(admitted_clues(s, c, owners, e, 100))

    def test_dom_mutation_hidden_or_spoofed_body_cannot_pass(self):
        for field, value in [("revision", 7), ("visible", False), ("pageFocused", False), ("documentId", "other")]:
            s, c, owners, e = fixture(); c["dom"][field] = value
            self.assertIsNone(admitted_clues(s, c, owners, e, 100))
        s, c, owners, e = fixture(); s["dom"]["clues"]["rawFullPageText"] = "private"
        self.assertIsNone(admitted_clues(s, c, owners, e, 100))

    def test_capture_disabled_never_opens_bridge(self):
        with patch.dict("os.environ", {"DRIFTY_BROWSER_CONTENT_CONTEXT":"0"}), patch("socket.socket") as sock:
            self.assertIsNone(capture_browser_content(pid=100,bundle_id="com.google.Chrome",page_url="https://example.org/",page_title="Page",observed_at="2026-10-05T01:00:00Z"))
            sock.assert_not_called()

    def test_limits_match_utf16_provider_contract(self):
        self.assertIsNone(normalize_clues(dict(description="😀"*81)))
        prose = "asyncio is a library to write concurrent code using the async/await syntax."
        self.assertEqual(normalize_clues(dict(visibleTopic=[prose])), dict(visibleTopic=[prose]))
        self.assertEqual(normalize_clues(dict(visibleTopic=["😀"*60])), dict(visibleTopic=["😀"*60]))
        self.assertIsNone(normalize_clues(dict(visibleTopic=["😀"*61])))
        self.assertIsNone(normalize_clues(dict(visibleTopic=["a"*121])))
        self.assertIsNone(normalize_clues(dict(visibleTopic=["a"*120,"b"*120,"c"])))
        self.assertIsNone(normalize_clues(dict(visibleTopic=["a"*60,"b"*60,"c"*60,"d"*60,"e"])))
        self.assertIsNone(normalize_clues(dict(description="x",providerPolicy="allowed")))

    def test_native_framing_rejects_oversize_truncation_and_eof(self):
        stream=io.BytesIO(); write_native(stream, {"requestId":"a"*32}); stream.seek(0)
        self.assertEqual(read_native(stream), {"requestId":"a"*32})
        with self.assertRaises(ValueError): read_native(io.BytesIO(struct.pack("=I", 40000)))
        with self.assertRaises(EOFError): read_native(io.BytesIO(struct.pack("=I", 10)+b"{}"))

    def test_storage_removes_unknown_and_body_fields(self):
        import json
        valid=dict(version=1,collectedAt="2026-10-05T01:00:00Z",pageUrl="https://example.org/",pageTitle="Page",description="Public course")
        self.assertEqual(normalize_context(valid), valid)
        bad=dict(valid, rawFullPageText="secret")
        result=json.loads(sanitized_raw_context_json(json.dumps({"browser_content_context":bad,"documentBody":"secret"})))
        self.assertNotIn("browser_content_context", result)
        self.assertNotIn("documentBody", result)

    def test_changed_clues_start_new_segments_and_do_not_reclassify_an_earlier_view(self):
        from pathlib import Path
        from datetime import datetime
        from app.storage.db import TrackerDatabase
        from app.tracker.capture_contract import Snapshot
        from tests.support_cleanup import temp_dir_closing_databases
        def snapshot(at, topic):
            context = dict(version=1,collectedAt=at,pageUrl="https://example.org/course",pageTitle="Course",visibleTopic=[topic]) if topic else None
            return Snapshot(observed_at=at,app_name="Google Chrome",bundle_id="com.google.Chrome",window_title="Course",source="accessibility",browser_name="Google Chrome",site_domain="example.org",site_url="https://example.org/course",site_title="Course",site_source="applescript",browser_content_context=context)
        with temp_dir_closing_databases() as tempdir:
            db=TrackerDatabase(Path(tempdir)/"tracker.sqlite3")
            for at, topic in [("2026-10-05T01:00:00Z","Python lesson"),("2026-10-05T01:00:05Z","Python lesson"),("2026-10-05T01:00:10Z","Casual puzzle"),("2026-10-05T01:00:15Z",None)]:
                db.record_snapshot(snapshot(at,topic),sample_seconds=5)
            day=datetime.fromisoformat("2026-10-05T01:00:00+00:00").astimezone().date().isoformat()
            rows=db.fetch_timeline(day)
            self.assertEqual(len(rows),3)
            topics=[row.get("browserContentContext",{}).get("visibleTopic") for row in rows]
            self.assertCountEqual(topics, [["Python lesson"],["Casual puzzle"],None])
            db.set_meta("sync_device_id","local-test-device")
            import json
            self.assertNotIn("browserContentContext",json.dumps(db.get_sync_outbox(0)))
            self.assertNotIn("browser_content_context",json.dumps(db.get_sync_outbox(0)))


if __name__ == "__main__": unittest.main()
