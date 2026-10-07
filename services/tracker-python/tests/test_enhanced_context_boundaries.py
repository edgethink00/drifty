import json
import os
import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.adaptive_context import AdaptiveContextCaptureInput, adaptive_content_context_for_capture
from app.tracker.adaptive_context.settings import SUPPORTED_ADAPTIVE_SOURCE_FAMILIES
from app.storage.db import TrackerDatabase
from tests.support_cleanup import temp_dir_closing_databases
from app.tracker import windows_workspace

PRODUCTION_FAMILIES = ",".join(sorted(SUPPORTED_ADAPTIVE_SOURCE_FAMILIES - {"design_dev_tool"}))
from app.tracker.windows_workspace import ForegroundWindow, ProcessIdentity


class EnhancedContextBoundaryTests(unittest.TestCase):
    def context(self, app="Safari", title=None, domain=None, url=None, **kwargs):
        with patch.dict(os.environ, {"DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1", "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": PRODUCTION_FAMILIES}):
            return adaptive_content_context_for_capture(AdaptiveContextCaptureInput(
                observed_at="2026-10-04T00:00:00+00:00", app_name=app,
                bundle_id=None, window_title=title, site_domain=domain, site_url=url, **kwargs,
            ))

    def test_outlook_mail_auth_and_unknown_routes_produce_no_calendar_context(self):
        for path in ("mail/inbox", "mail/0/deeplink/read/abc", "auth", "", "calendar-like"):
            with self.subTest(path=path):
                self.assertIsNone(self.context(title="Inbox - person@example.test - Outlook",
                    domain="outlook.office.com", url="https://outlook.office.com/" + path))
        self.assertIsNone(self.context(title="Planning - person@example.test - Outlook",
            domain="outlook.office.com.evil.test", url="https://outlook.office.com.evil.test/calendar"))

    def test_calendar_keeps_meeting_shape_without_guessing_attendee_or_workspace(self):
        for app, domain, url in (
            ("Safari", "outlook.office.com", "https://outlook.office.com/calendar/view/week"),
            ("Safari", "calendar.google.com", "https://calendar.google.com/calendar/u/0/r"),
            ("Calendar", None, None),
        ):
            with self.subTest(app=app, domain=domain):
                context = self.context(app=app, title="Sprint planning - person@example.test - Calendar",
                    domain=domain, url=url)
                self.assertIsNotNone(context)
                self.assertEqual({item["kind"] for item in context["items"]}, {"meetingType"})
                self.assertNotIn("person@example.test", json.dumps(context["items"]))

    def test_jira_issue_has_project_without_document_or_repository_route_labels(self):
        context = self.context(title="PRJ-123: Fix page - Jira", domain="demo.atlassian.net",
            url="https://demo.atlassian.net/browse/PRJ-123")
        items = context["items"]
        self.assertEqual({item["sourceFamily"] for item in items}, {"work_tracker_dev_platform"})
        self.assertEqual(next(item["values"] for item in items if item["kind"] == "project"), ["PRJ"])
        self.assertNotIn("repo", {item["kind"] for item in items})
        self.assertNotIn("browse", json.dumps(items))

    def test_confluence_space_is_not_a_database_or_repo(self):
        context = self.context(title="Launch plan - Confluence", domain="demo.atlassian.net",
            url="https://demo.atlassian.net/wiki/spaces/ENG/pages/123/Launch-plan")
        items = context["items"]
        self.assertEqual(next(item["values"] for item in items if item["kind"] == "workspace"), ["ENG"])
        self.assertFalse({"database", "repo", "parentPage"} & {item["kind"] for item in items})

    def test_gitlab_nested_repository_and_github_repository_keep_their_container(self):
        for domain, path, expected in (
            ("gitlab.com", "group/subgroup/project/-/issues/123", "group/subgroup/project"),
            ("github.com", "org/project/issues/123", "org/project"),
        ):
            with self.subTest(domain=domain):
                context = self.context(title="Fix page", domain=domain, url="https://" + domain + "/" + path)
                self.assertEqual(next(item["values"] for item in context["items"] if item["kind"] == "repo"), [expected])

    def test_windows_executable_names_and_drive_path_need_no_file_or_command_capture(self):
        cases = (
            ("POWERPNT", "Quarterly plan - PowerPoint", "document", "Quarterly plan"),
            ("WINWORD", "Launch plan - Word", "document", "Launch plan"),
            ("WindowsTerminal", r"C:\Users\tester\work\drifty", "workspace", "drifty"),
            ("slack", "@Synthetic person - Work - Slack", "channelType", "dm"),
        )
        # PowerPoint's Windows executable is POWERPNT, distinct from its app title.
        for app, title, kind, expected in cases:
            with self.subTest(app=app):
                context = self.context(app=app, title=title, allow_local_file_read=False)
                self.assertIsNotNone(context)
                self.assertIn(expected, next(item["values"] for item in context["items"] if item["kind"] == kind))
        self.assertIsNone(self.context(app="WindowsTerminal", title=r"C:\work\drifty && secret command", allow_local_file_read=False))
        with patch("app.tracker.adaptive_context.extractors.bounded_markdown_text") as read:
            self.context(app="obsidian", title="/private/synthetic.md - Work - Obsidian", allow_local_file_read=False)
            read.assert_not_called()


class WindowsEnhancedContextIntegrationTests(unittest.TestCase):
    def capture(self, title, exe, domain=None, url=None, enabled="1", changed=False):
        window = ForegroundWindow(hwnd=100, title=title, pid=10)
        other = ForegroundWindow(hwnd=200, title="Changed", pid=20)
        def enrich(snapshot, *args, **kwargs):
            snapshot.site_domain = domain
            snapshot.site_url = url
            return snapshot
        with (
            patch.dict(os.environ, {"DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": enabled, "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": PRODUCTION_FAMILIES}),
            patch.object(windows_workspace, "is_windows", return_value=True),
            patch.object(windows_workspace, "process_session_id", return_value=1),
            patch.object(windows_workspace, "read_foreground_window", side_effect=[window, window, other] * 2 if changed else [window] * 3),
            patch.object(windows_workspace, "resolve_identity", return_value=(ProcessIdentity(exe_path=exe, exe_name=None, aumid=None), None)),
            patch.object(windows_workspace, "enrich_browser_snapshot", side_effect=enrich),
        ):
            return windows_workspace.current_snapshot()

    def test_verified_browser_capture_attaches_ai_metadata(self):
        snapshot = self.capture("Launch plan - ChatGPT", r"C:\Apps\chrome.exe",
            "chatgpt.com", "https://chatgpt.com/c/synthetic")
        context = snapshot.adaptive_content_context
        self.assertIsNotNone(context)
        self.assertIn("Launch plan", json.dumps(context["items"]))
        self.assertEqual({item["sourceFamily"] for item in context["items"]}, {"ai_conversation"})

    def test_verified_capture_context_round_trips_through_tracker_storage(self):
        snapshot = self.capture("Launch plan - ChatGPT", r"C:\Apps\chrome.exe",
            "chatgpt.com", "https://chatgpt.com/c/synthetic")
        with temp_dir_closing_databases() as tempdir:
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.record_snapshot(snapshot, sample_seconds=5)
            day = datetime.fromisoformat(snapshot.observed_at).astimezone().date().isoformat()
            segment = database.fetch_timeline(day)[0]
            self.assertEqual(segment["adaptiveContentContext"], snapshot.adaptive_content_context)
            self.assertNotIn("messageBody", json.dumps(segment["adaptiveContentContext"]))

    def test_disabled_or_changed_foreground_does_not_attach_context(self):
        for options in ({"enabled": "0"}, {"changed": True}):
            with self.subTest(options=options):
                snapshot = self.capture("Launch plan - ChatGPT", r"C:\Apps\chrome.exe",
                    "chatgpt.com", "https://chatgpt.com/c/synthetic", **options)
                self.assertIsNone(snapshot.adaptive_content_context)


if __name__ == "__main__":
    unittest.main()
