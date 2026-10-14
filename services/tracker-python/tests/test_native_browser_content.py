from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.tracker.browser_content import capture_browser_content


class NativeBrowserContentTests(unittest.TestCase):
    def setUp(self):
        self.enabled = patch.dict("os.environ", {"DRIFTY_BROWSER_CONTENT_CONTEXT": "1"})
        self.platform = patch("sys.platform", "darwin")
        self.enabled.start(); self.platform.start()
        self.addCleanup(self.enabled.stop); self.addCleanup(self.platform.stop)
        settings = patch("app.tracker.browser_content_policy._settings_path", None)
        settings.start(); self.addCleanup(settings.stop)
        self.arguments = dict(pid=42, bundle_id="com.google.Chrome", page_url="https://example.org/course",
                              page_title="Course", observed_at="2026-10-06T01:00:00Z", helper_path=Path("/packaged/helper"))
        self.reply = dict(version=1, pid=42, bundleId="com.google.Chrome", pageUrl="https://example.org/course",
                          pageTitle="Course", clues={"headings": ["Data Structures"], "visibleTopic": ["asyncio is a library to write concurrent code using the async/await syntax."]})

    def test_native_transport_uses_existing_contract_and_no_socket(self):
        run = Mock(return_value=json.dumps(self.reply))
        with patch("socket.socket") as socket, patch("subprocess.run") as spawn:
            result = capture_browser_content(**self.arguments, run_command=run)
        self.assertEqual(result, dict(version=1, collectedAt=self.arguments["observed_at"],
                                     pageUrl=self.arguments["page_url"], pageTitle="Course", **self.reply["clues"]))
        self.assertEqual(run.call_args.args[0][:7], [str(self.arguments["helper_path"]), "--browser-content", "42", "com.google.Chrome",
                                              "https://example.org/course", "Course", "620"])
        self.assertEqual(run.call_args.args[0][7], "--description-stdio")
        self.assertFalse(run.call_args.kwargs["cancelled"]())
        self.assertEqual(run.call_args.kwargs["timeout"], 0.65)
        socket.assert_not_called(); spawn.assert_not_called()

    def test_disabled_unsupported_and_expired_capture_never_start_helper(self):
        run = Mock()
        with patch.dict("os.environ", {"DRIFTY_BROWSER_CONTENT_CONTEXT": "0"}):
            self.assertIsNone(capture_browser_content(**self.arguments, run_command=run))
        for change in ({"timeout": 0}, {"pid": True}, {"pid": 0}, {"bundle_id": "unsupported.browser"},
                       {"page_url": "file:///tmp/page"}, {"page_url": "https://[bad"},
                       {"page_title": ""}, {"page_title": "x" * 501}):
            with self.subTest(change=change):
                self.assertIsNone(capture_browser_content(**dict(self.arguments, **change), run_command=run))
        with patch("sys.platform", "win32"):
            self.assertIsNone(capture_browser_content(**self.arguments, run_command=run))
        run.assert_not_called()

    def test_wrong_owner_page_or_extra_fields_cannot_be_persisted(self):
        for change in ({"pid": 43}, {"pid": True}, {"bundleId": "other"}, {"pageUrl": "https://other.org/"},
                       {"pageTitle": "Other"}, {"version": 2}, {"version": True}, {"description": "unsolicited"},
                       {"clues": {"rawFullPageText": "secret"}}, {"clues": {"visibleTopic": ["x" * 121]}}):
            with self.subTest(change=change):
                run = Mock(return_value=json.dumps(dict(self.reply, **change)))
                self.assertIsNone(capture_browser_content(**self.arguments, run_command=run))

    def test_unavailable_permission_or_crashed_helper_never_falls_back_to_extension(self):
        for reply in ("null", "[]", "{}", "not-json"):
            with self.subTest(reply=reply), patch("socket.socket") as socket:
                self.assertIsNone(capture_browser_content(**self.arguments, run_command=Mock(return_value=reply)))
                socket.assert_not_called()
        for error in (FileNotFoundError(), subprocess.TimeoutExpired("helper", 0.65), RuntimeError("private data")):
            self.assertIsNone(capture_browser_content(**self.arguments, run_command=Mock(side_effect=error)))
        with patch("app.tracker.browser_content.packaged_helper_path", return_value=None), patch("subprocess.run") as run:
            arguments = dict(self.arguments); arguments.pop("helper_path")
            self.assertIsNone(capture_browser_content(**arguments))
            run.assert_not_called()

    def test_late_result_is_discarded_not_saved_for_next_sample(self):
        run = Mock(return_value=json.dumps(self.reply))
        with patch("app.tracker.browser_content.time.monotonic", side_effect=[100, 100.7]):
            self.assertIsNone(capture_browser_content(**self.arguments, run_command=run))
        self.assertIsNotNone(capture_browser_content(**self.arguments, run_command=run))

    def test_small_remaining_scope_is_not_granted_a_fresh_full_timeout(self):
        run = Mock(return_value="null")
        self.assertIsNone(capture_browser_content(**self.arguments, timeout=0.1, run_command=run))
        self.assertEqual(run.call_args.kwargs["timeout"], 0.1)
        self.assertEqual(run.call_args.args[0][6], "70")

    def test_frozen_reader_uses_early_sidecar_mode_instead_of_python_source(self):
        calls = []
        def run(command, **options):
            calls.append(command)
            if "reply" in options:
                preface = dict(self.reply, phase="description", lookupBudgetMs=300)
                self.assertEqual(json.loads(options["reply"](json.dumps(preface))), {"description": "Public summary"})
                return json.dumps(self.reply)
            return json.dumps({"description": "Public summary"})
        with patch.object(__import__('sys'), 'frozen', True, create=True), patch('sys.executable', '/qa/tracker-sidecar'):
            self.assertIsNotNone(capture_browser_content(**self.arguments, run_command=run))
        self.assertEqual(calls[1][:2], ['/qa/tracker-sidecar', 'browser-public-description'])

    def test_invalid_native_preface_never_starts_public_reader(self):
        for change in ({"pid": 43}, {"version": True}, {"pageUrl": "https://other.org"},
                       {"lookupBudgetMs": 621}, {"clues": {"rawHtml": "excluded"}},
                       {"clues": {"description": "unexpected", "headings": ["Heading"]}}):
            with self.subTest(change=change):
                calls=[]
                def run(command, **options):
                    calls.append(command)
                    preface=dict(self.reply, phase="description", lookupBudgetMs=300)
                    preface.update(change)
                    options["reply"](json.dumps(preface))
                    return json.dumps(self.reply)
                self.assertIsNone(capture_browser_content(**self.arguments, run_command=run))
                self.assertEqual(len(calls), 1)

    def opera_capture(self, *, preface_change=None, result_clues=None, reader_reply=None):
        calls = []
        arguments = dict(self.arguments, bundle_id="com.operasoftware.Opera")
        result = dict(self.reply, bundleId=arguments["bundle_id"], clues={"description": "Public summary"})
        if result_clues is not None:
            result["clues"] = result_clues
        def run(command, **options):
            calls.append(command)
            if "reply" in options:
                self.assertEqual(command[-1], "--public-description-only-stdio")
                preface = dict(result, phase="publicDescriptionOnly", clues={}, lookupBudgetMs=300)
                preface.update(preface_change or {})
                options["reply"](json.dumps(preface))
                return json.dumps(result)
            return json.dumps({"description": "Public summary"} if reader_reply is None else reader_reply)
        return capture_browser_content(**arguments, run_command=run), calls

    def test_opera_description_only_admits_empty_native_clues_and_existing_d_contract(self):
        result, calls = self.opera_capture()
        self.assertEqual(result, dict(version=1, collectedAt=self.arguments["observed_at"],
                                     pageUrl=self.arguments["page_url"], pageTitle="Course", description="Public summary"))
        self.assertEqual(len(calls), 2)

    def test_description_only_cannot_relax_other_browser_or_identity_admission(self):
        for change in ({"phase": "description"}, {"bundleId": "com.google.Chrome"},
                       {"pageUrl": "https://other.org"}, {"pageTitle": "Other"}, {"pid": 43},
                       {"lookupBudgetMs": 0}, {"clues": {"headings": ["Unexpected heading"]}}):
            with self.subTest(change=change):
                result, calls = self.opera_capture(preface_change=change)
                self.assertIsNone(result)
                self.assertEqual(len(calls), 1)
        calls = []
        def run(command, **options):
            calls.append(command)
            options["reply"](json.dumps(dict(self.reply, phase="description", clues={}, lookupBudgetMs=300)))
            return json.dumps(self.reply)
        self.assertIsNone(capture_browser_content(**self.arguments, run_command=run))
        self.assertEqual(len(calls), 1)

    def test_opera_never_emits_body_or_unsolicited_description(self):
        for clues in ({}, {"description": "Other summary"}, {"headings": ["Unexpected"]},
                      {"description": "Public summary", "visibleTopic": ["Unexpected body"]}):
            with self.subTest(clues=clues):
                self.assertIsNone(self.opera_capture(result_clues=clues)[0])
        for reply in ("null", {"description": "x" * 161}, {"description": "Unrelated summary"}):
            with self.subTest(reply=reply):
                self.assertIsNone(self.opera_capture(reader_reply=reply)[0])

    def test_opera_disabled_http_and_excluded_pages_start_neither_helper_nor_reader(self):
        run = Mock()
        arguments = dict(self.arguments, bundle_id="com.operasoftware.Opera")
        for url in ("http://example.org/course", "https://example.org/login", "https://mail.google.com/"):
            self.assertIsNone(capture_browser_content(**dict(arguments, page_url=url), run_command=run))
        with patch.dict("os.environ", {"DRIFTY_BROWSER_CONTENT_CONTEXT": "0"}):
            self.assertIsNone(capture_browser_content(**arguments, run_command=run))
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
