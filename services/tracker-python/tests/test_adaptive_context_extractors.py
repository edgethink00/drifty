import json
import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.main import _apply_developer_diagnostics_env
from app.storage.db import TrackerDatabase
from app.tracker.adaptive_context.normalization import (
    ai_conversation_structured_fields,
    communication_structured_fields,
    developer_workspace_structured_fields,
    document_editor_structured_fields,
)
from app.tracker.macos_workspace import (
    AdaptiveContextCaptureInput,
    BrowserMetadata,
    adaptive_content_context_for_capture,
    current_snapshot,
)
from tests.support_cleanup import temp_dir_closing_databases


_MACOS_ONLY = unittest.skipUnless(sys.platform == "darwin", "macOS foreground capture stack")


@_MACOS_ONLY
class AdaptiveContextExtractorTests(unittest.TestCase):
    def test_ai_conversation_extractor_keeps_thread_shape_without_bodies(self) -> None:
        # Given: a measured ChatGPT web title plus collector fields that must never
        # become enhanced context.
        capture = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="Aside",
            bundle_id="com.browser.aside",
            window_title="Migration strategy - ChatGPT - Aside - person@example.com",
            browser_name="Aside",
            site_domain="chatgpt.com",
            site_title="Migration strategy",
            site_url="https://chatgpt.com/c/01234567-89ab-cdef-0123-456789abcdef",
            structured_fields={
                "message_body": ["Do not retain this prompt or response"],
                "raw_full_page_text": ["Private conversation transcript"],
            },
        )

        # When: only the Dev AI-conversation family is enabled.
        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "ai_conversation",
            },
        ):
            context = adaptive_content_context_for_capture(capture)

        # Then: the bounded thread label and route type survive, while bodies and
        # account suffixes do not.
        self.assertIsNotNone(context)
        items = context["items"] if context is not None else []
        values_by_kind = {item["kind"]: item["values"] for item in items}
        self.assertEqual(values_by_kind["thread"], ["Migration strategy"])
        self.assertEqual(values_by_kind["conversationType"], ["chat"])
        serialized = json.dumps(items)
        self.assertNotIn("prompt", serialized.lower())
        self.assertNotIn("transcript", serialized.lower())
        self.assertNotIn("person@example.com", serialized)

        # And: a generic native title contains no additional information, so the
        # experimental family emits nothing instead of echoing the app name.
        generic = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="ChatGPT",
            bundle_id="com.openai.chat",
            window_title="ChatGPT",
        )
        self.assertEqual(ai_conversation_structured_fields(generic), {})

        stale_native_title = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="ChatGPT",
            bundle_id="com.openai.chat",
            window_title="#private | workspace - Discord",
        )
        self.assertEqual(ai_conversation_structured_fields(stale_native_title), {})

        learning_page = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="Aside",
            bundle_id="com.browser.aside",
            window_title="OpenAI Academy course - Aside",
            browser_name="Aside",
            site_domain="learn.chatgpt.com",
            site_title="OpenAI Academy course",
            site_url="https://learn.chatgpt.com/courses/context-engineering",
        )
        self.assertEqual(ai_conversation_structured_fields(learning_page), {})

    def test_developer_workspace_extractor_accepts_projects_and_rejects_commands(self) -> None:
        # Given: the high-volume cmux title shapes observed in dogfood data.
        project = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="cmux",
            bundle_id="dev.cmux",
            window_title="drifty_mac",
            structured_fields={"terminal_command": ["export SECRET=hidden"]},
        )
        command = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="cmux",
            bundle_id="dev.cmux",
            window_title="ssh production",
        )
        task_sentence = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="cmux",
            bundle_id="dev.cmux",
            window_title="✳ review the deployment status",
        )

        # Then: a stable project slug becomes workspace metadata, while command and
        # task text do not become context.
        self.assertEqual(developer_workspace_structured_fields(project), {"workspace": ["drifty_mac"]})
        self.assertEqual(developer_workspace_structured_fields(command), {})
        self.assertEqual(developer_workspace_structured_fields(task_sentence), {})
        command_with_path = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="cmux",
            bundle_id="dev.cmux",
            window_title="git checkout feature/private",
        )
        self.assertEqual(developer_workspace_structured_fields(command_with_path), {})

        # And: editor title structure may expose the workspace slot without copying
        # the active filename.
        editor = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="Visual Studio Code",
            bundle_id="com.microsoft.VSCode",
            window_title="main.ts - drifty_mac - Visual Studio Code",
        )
        self.assertEqual(developer_workspace_structured_fields(editor), {"workspace": ["drifty_mac"]})

    def test_document_editor_extractor_normalizes_document_metadata_without_body(self) -> None:
        # Given: a measured PowerPoint presenter-view title and an injected body.
        capture = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="Microsoft PowerPoint",
            bundle_id="com.microsoft.Powerpoint",
            window_title="PowerPoint 발표자 보기 - [Q3_launch]",
            structured_fields={"document_body": ["Confidential slide body"]},
        )

        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "document_editor",
            },
        ):
            context = adaptive_content_context_for_capture(capture)

        self.assertIsNotNone(context)
        items = context["items"] if context is not None else []
        values_by_kind = {item["kind"]: item["values"] for item in items}
        self.assertEqual(values_by_kind["document"], ["Q3_launch"])
        self.assertEqual(values_by_kind["documentType"], ["presentation"])
        self.assertNotIn("Confidential", json.dumps(context))

        # And: Overleaf is a document editor, not a knowledge-base hierarchy.
        overleaf = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="Aside",
            bundle_id="com.browser.aside",
            window_title="Agent evaluation paper - Overleaf, Online LaTeX Editor - Aside",
            browser_name="Aside",
            site_domain="overleaf.com",
            site_title="Agent evaluation paper - Overleaf, Online LaTeX Editor",
            site_url="https://www.overleaf.com/project/0123456789abcdef",
        )
        self.assertEqual(
            document_editor_structured_fields(overleaf),
            {"document": ["Agent evaluation paper"], "document_type": ["paper"]},
        )

        blank_powerpoint = AdaptiveContextCaptureInput(
            observed_at="2026-08-24T00:00:00+00:00",
            app_name="Microsoft PowerPoint",
            bundle_id="com.microsoft.Powerpoint",
            window_title=None,
        )
        self.assertEqual(document_editor_structured_fields(blank_powerpoint), {})

    def test_current_snapshot_extracts_notion_context_from_production_metadata(self) -> None:
        # Given: a browser snapshot sees a Notion-like page with only URL/title metadata.
        metadata = BrowserMetadata(
            browser_name="Arc",
            site_domain="notion.so",
            site_title="Reddit - Product research - Acquisition ideas",
            site_url="https://www.notion.so/acme/Product-research-Reddit",
            ax_window_title="Reddit - Product research - Acquisition ideas - Arc",
            match_state="matched",
            browser_automation_status="granted",
        )

        # When: adaptive capture and the document source family are enabled.
        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "document_knowledge",
            },
        ), patch("app.tracker.macos_workspace._run_osascript") as mock_run, patch(
            "app.tracker.macos_workspace._browser_metadata",
            return_value=metadata,
        ):
            mock_run.return_value = "Arc\ncompany.thebrowser.Browser\nReddit"
            snapshot = current_snapshot(include_system_transient=False)

        # Then: only derived container/structure fields are emitted.
        context = snapshot.adaptive_content_context
        self.assertIsNotNone(context)
        items = context["items"] if context is not None else []
        self.assertEqual(context["localStorage"], "stored_local")
        self.assertEqual({item["sourceFamily"] for item in items}, {"document_knowledge"})
        values_by_kind = {item["kind"]: item["values"] for item in items}
        self.assertIn("Product research", values_by_kind["parentPage"])
        self.assertIn("Acquisition ideas", values_by_kind["database"])
        serialized = json.dumps(context)
        self.assertNotIn("body", serialized.lower())

    def test_current_snapshot_extracts_obsidian_path_frontmatter_and_headings(self) -> None:
        # Given: an Obsidian snapshot exposes a Markdown path in the active window title.
        with temp_dir_closing_databases() as tempdir:
            note_path = Path(tempdir) / "Work" / "Client Alpha" / "Daily.md"
            note_path.parent.mkdir(parents=True)
            note_path.write_text(
                "---\ntags: [postmortem, incident]\n---\n"
                "# Timeline\nPrivate body paragraph must not be copied.\n## Root cause\n",
                encoding="utf-8",
            )

            # When: adaptive capture and local notes are enabled.
            with patch.dict(
                os.environ,
                {
                    "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                    "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "local_notes_markdown",
                },
            ), patch("app.tracker.macos_workspace._run_osascript") as mock_run, patch(
                "app.tracker.macos_workspace._browser_metadata",
                return_value=BrowserMetadata(),
            ):
                mock_run.return_value = f"Obsidian\nmd.obsidian\n{note_path}"
                snapshot = current_snapshot(include_system_transient=False)

        # Then: title text is not counted, while path segments, tags, and headings are.
        context = snapshot.adaptive_content_context
        self.assertIsNotNone(context)
        items = context["items"] if context is not None else []
        self.assertEqual({item["sourceFamily"] for item in items}, {"local_notes_markdown"})
        self.assertIn("project", {item["kind"] for item in items})
        self.assertIn("folder", {item["kind"] for item in items})
        self.assertIn("tag", {item["kind"] for item in items})
        self.assertIn("heading", {item["kind"] for item in items})
        serialized = json.dumps(context)
        self.assertNotIn("Private body paragraph", serialized)
        self.assertNotIn('"Daily"', serialized)

    def test_current_snapshot_extracts_issue_context_from_production_metadata(self) -> None:
        # Given: a GitHub issue snapshot exposes repo URL and compact metadata in its title.
        metadata = BrowserMetadata(
            browser_name="Google Chrome",
            site_domain="github.com",
            site_title="[bug][auth] Login - Issue #42 - edgethink/drifty - In progress - Reproduction",
            site_url="https://github.com/edgethink/drifty/issues/42",
            ax_window_title="[bug][auth] Login - Issue #42 - edgethink/drifty - In progress - Reproduction",
            match_state="matched",
            browser_automation_status="granted",
        )

        # When: adaptive capture and work tracker/dev platform extraction are enabled.
        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "work_tracker_dev_platform",
            },
        ), patch("app.tracker.macos_workspace._run_osascript") as mock_run, patch(
            "app.tracker.macos_workspace._browser_metadata",
            return_value=metadata,
        ):
            mock_run.return_value = "Google Chrome\ncom.google.Chrome\nLogin"
            snapshot = current_snapshot(include_system_transient=False)

        # Then: issue/project structure is emitted without relying on the title.
        context = snapshot.adaptive_content_context
        self.assertIsNotNone(context)
        items = context["items"] if context is not None else []
        self.assertEqual({item["sourceFamily"] for item in items}, {"work_tracker_dev_platform"})
        self.assertEqual({item["depth"] for item in items}, {1, 2})
        self.assertEqual(
            {item["kind"] for item in items},
            {"repo", "issueType", "label", "status", "visibleSection"},
        )
        values = {value for item in items for value in item["values"]}
        self.assertIn("edgethink/drifty", values)
        self.assertIn("issue", values)
        self.assertIn("bug", values)
        self.assertIn("auth", values)
        self.assertIn("In progress", values)
        self.assertIn("Reproduction", values)
        self.assertNotIn("Login", values)

    def test_production_source_families_do_not_capture_experimental_figma_context(self) -> None:
        # Given: Figma is frontmost while only shipped source families are enabled.
        production_families = ",".join(
            (
                "document_knowledge",
                "local_notes_markdown",
                "work_tracker_dev_platform",
                "calendar_meeting",
                "communication_metadata",
            )
        )
        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": production_families,
            },
        ), patch(
            "app.tracker.macos_workspace._run_osascript"
        ) as mock_run, patch(
            "app.tracker.macos_workspace._browser_metadata",
            return_value=BrowserMetadata(
                browser_name="Figma",
                site_domain="figma.com",
                site_url="https://www.figma.com/file/abc123/Drifty-App",
            ),
        ):
            mock_run.return_value = "Figma\ncom.figma.Desktop\nMobile onboarding - Design - Frame"
            figma_context = current_snapshot(include_system_transient=False).adaptive_content_context

        # Then: the experimental family cannot leak into production capture.
        self.assertIsNone(figma_context)

    def test_current_snapshot_extracts_design_calendar_and_communication_metadata_only(self) -> None:
        # Given: production snapshots expose metadata-only app/window titles.
        with patch.dict(os.environ, {"DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1"}):
            with patch.dict(os.environ, {"DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "design_dev_tool"}), patch(
                "app.tracker.macos_workspace._run_osascript"
            ) as mock_run, patch(
                "app.tracker.macos_workspace._browser_metadata",
                return_value=BrowserMetadata(
                    browser_name="Figma",
                    site_domain="figma.com",
                    site_url="https://www.figma.com/file/abc123/Drifty-App",
                ),
            ):
                mock_run.return_value = "Figma\ncom.figma.Desktop\nMobile onboarding - Design - Frame"
                figma_context = current_snapshot(include_system_transient=False).adaptive_content_context
            with patch.dict(os.environ, {"DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "calendar_meeting"}), patch(
                "app.tracker.macos_workspace._run_osascript"
            ) as mock_run, patch(
                "app.tracker.macos_workspace._browser_metadata",
                return_value=BrowserMetadata(
                    browser_name="Google Chrome",
                    site_domain="calendar.google.com",
                    site_url="https://calendar.google.com/calendar/u/0/r/eventedit",
                ),
            ):
                mock_run.return_value = "Google Chrome\ncom.google.Chrome\nSprint planning - Drifty - Calendar"
                calendar_context = current_snapshot(include_system_transient=False).adaptive_content_context
            with patch.dict(os.environ, {"DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "communication_metadata"}), patch(
                "app.tracker.macos_workspace._run_osascript"
            ) as mock_run, patch(
                "app.tracker.macos_workspace._browser_metadata",
                return_value=BrowserMetadata(),
            ):
                mock_run.return_value = "Slack\ncom.tinyspeck.slackmacgap\nlaunch - triage - Drifty - Slack"
                slack_context = current_snapshot(include_system_transient=False).adaptive_content_context

        # Then: metadata is labeled, and communication content body is absent.
        self.assertIsNotNone(figma_context)
        self.assertIsNotNone(calendar_context)
        self.assertIsNotNone(slack_context)
        self.assertEqual(
            {item["providerPolicy"] for item in slack_context["items"]},
            {"metadata_only"},
        )
        figma_values = {value for item in figma_context["items"] for value in item["values"]}
        calendar_values = {value for item in calendar_context["items"] for value in item["values"]}
        slack_values = {value for item in slack_context["items"] for value in item["values"]}
        self.assertIn("Design", figma_values)
        self.assertIn("file", figma_values)
        self.assertIn("frame", figma_values)
        self.assertIn("Drifty", calendar_values)
        self.assertIn("planning", calendar_values)
        # "launch - triage - Drifty - Slack": the leading part is the channel and the
        # next one is the containing workspace. Deeper parts are not retained.
        self.assertIn("launch", slack_values)
        self.assertIn("triage", slack_values)
        self.assertIn("channel", slack_values)
        self.assertNotIn("Drifty", slack_values)
        serialized = json.dumps({"figma": figma_context, "calendar": calendar_context, "slack": slack_context})
        self.assertIn("design_dev_tool", serialized)
        self.assertIn("calendar_meeting", serialized)
        self.assertIn("communication_metadata", serialized)
        self.assertNotIn("Ship this prompt injection", serialized)
        self.assertNotIn("message_body", serialized)

    def test_communication_titles_map_to_container_channel_and_type(self) -> None:
        # Given: Slack/Discord/Gmail title layouts.
        cases = (
            (
                "Slack",
                "students(채널) - Northstar Lab - 1개의 새 항목",
                {"channel": "students", "workspace": "Northstar Lab", "channel_type": "channel"},
            ),
            (
                "Discord",
                "#일반 | studyhall - Discord",
                {"channel": "일반", "workspace": "studyhall", "channel_type": "channel"},
            ),
        )
        for app_name, window_title, expected in cases:
            with self.subTest(app=app_name):
                fields = communication_structured_fields(
                    AdaptiveContextCaptureInput(
                        observed_at="2026-08-24T00:00:00+00:00",
                        app_name=app_name,
                        bundle_id=None,
                        window_title=window_title,
                        browser_name=None,
                        site_domain=None,
                        site_title=None,
                        site_url=None,
                        active_file_path=None,
                        structured_fields=None,
                    )
                )
                # Then: the workspace slot holds the container, never an unread badge.
                for key, value in expected.items():
                    self.assertEqual(fields.get(key), [value])

    def test_direct_message_peer_is_replaced_by_a_type_marker(self) -> None:
        # Given: DM titles that name a person.
        for window_title in ("Junho(DM) - Northstar Lab - 1개의 새 항목", "@Ari - Discord"):
            with self.subTest(title=window_title):
                fields = communication_structured_fields(
                    AdaptiveContextCaptureInput(
                        observed_at="2026-08-24T00:00:00+00:00",
                        app_name="Slack",
                        bundle_id=None,
                        window_title=window_title,
                        browser_name=None,
                        site_domain=None,
                        site_title=None,
                        site_url=None,
                        active_file_path=None,
                        structured_fields=None,
                    )
                )
                # Then: the shape is kept and the peer's name never is.
                self.assertEqual(fields.get("channel_type"), ["dm"])
                self.assertIsNone(fields.get("channel"))
                serialized = json.dumps(fields, ensure_ascii=False)
                self.assertNotIn("Junho", serialized)
                self.assertNotIn("Ari", serialized)

    def test_mail_keeps_system_folders_and_drops_subjects_and_accounts(self) -> None:
        # Given: an inbox with an unread counter, and a single mail thread.
        folder = communication_structured_fields(
            AdaptiveContextCaptureInput(
                observed_at="2026-08-24T00:00:00+00:00",
                app_name="Aside",
                bundle_id=None,
                window_title="받은편지함 (1,106) - alex@example.com - Gmail",
                browser_name=None,
                site_domain="mail.google.com",
                site_title=None,
                site_url=None,
                active_file_path=None,
                structured_fields=None,
            )
        )
        # Then: the churning unread count is normalized away and the account is dropped.
        self.assertEqual(folder.get("channel"), ["받은편지함"])
        self.assertEqual(folder.get("channel_type"), ["folder"])
        self.assertNotIn("alex@example.com", json.dumps(folder, ensure_ascii=False))

        subject = communication_structured_fields(
            AdaptiveContextCaptureInput(
                observed_at="2026-08-24T00:00:00+00:00",
                app_name="Aside",
                bundle_id=None,
                window_title="Action required: Supabase endpoint is being removed - alex@example.com - Gmail",
                browser_name=None,
                site_domain="mail.google.com",
                site_title=None,
                site_url=None,
                active_file_path=None,
                structured_fields=None,
            )
        )
        # Then: a mail subject is reported only as a shape, never as text.
        self.assertEqual(subject.get("channel_type"), ["thread"])
        self.assertIsNone(subject.get("channel"))
        self.assertNotIn("Supabase", json.dumps(subject, ensure_ascii=False))

    def test_communication_capture_skips_surfaces_with_an_unverified_layout(self) -> None:
        # Given: Teams and Outlook, whose title layouts have never been captured.
        # Teams renders a direct message as "Chat | <person>", so the position the
        # parsers read as a workspace would hold someone's name.
        unverified = (
            ("Microsoft Teams", "Chat | John Smith | Microsoft Teams", None),
            ("Google Chrome", "Chat | John Smith | Microsoft Teams", "teams.microsoft.com"),
            ("Google Chrome", "Q3 planning - john@corp.com - Outlook", "outlook.office.com"),
        )
        with patch.dict(os.environ, {
            "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
            "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "communication_metadata",
        }):
            for app_name, window_title, site_domain in unverified:
                with self.subTest(app=app_name, domain=site_domain):
                    context = adaptive_content_context_for_capture(AdaptiveContextCaptureInput(
                        observed_at="2026-08-24T00:00:00+00:00",
                        app_name=app_name,
                        bundle_id=None,
                        window_title=window_title,
                        browser_name=None,
                        site_domain=site_domain,
                        site_title=None,
                        site_url=None,
                        active_file_path=None,
                        structured_fields=None,
                    ))
                    # Then: nothing is captured rather than guessed at.
                    self.assertIsNone(context)

            # And: the measured surfaces still produce context.
            slack = adaptive_content_context_for_capture(AdaptiveContextCaptureInput(
                observed_at="2026-08-24T00:00:00+00:00",
                app_name="Slack",
                bundle_id=None,
                window_title="#general - Acme - 1개의 새 항목",
                browser_name=None,
                site_domain=None,
                site_title=None,
                site_url=None,
                active_file_path=None,
                structured_fields=None,
            ))
            self.assertIsNotNone(slack)

    def test_unsupported_or_disabled_capture_returns_no_context(self) -> None:
        # Given: an unsupported app and an otherwise supported Notion fixture.
        unsupported = AdaptiveContextCaptureInput(
            observed_at="2026-07-08T00:00:00+00:00",
            app_name="Preview",
            bundle_id="com.apple.Preview",
            window_title="receipt.pdf",
        )
        supported = AdaptiveContextCaptureInput(
            observed_at="2026-07-08T00:00:00+00:00",
            app_name="Arc",
            bundle_id="company.thebrowser.Browser",
            window_title="Reddit",
            site_domain="notion.so",
            site_url="https://www.notion.so/acme/reddit",
            structured_fields={"breadcrumb": ["Product research"]},
        )

        # When: capture is disabled or the enabled source-family set excludes the source.
        with patch.dict(os.environ, {"DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "0"}):
            disabled_context = adaptive_content_context_for_capture(supported)
        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "calendar_meeting",
            },
        ):
            excluded_context = adaptive_content_context_for_capture(supported)
            unsupported_context = adaptive_content_context_for_capture(unsupported)

        # Then: extraction is a no-op and Depth 0 behavior remains unchanged.
        self.assertIsNone(disabled_context)
        self.assertIsNone(excluded_context)
        self.assertIsNone(unsupported_context)

    def test_developer_diagnostics_bridge_disables_capture_without_stored_toggle(self) -> None:
        # Given: an env var is set externally, but no user-visible Dev setting is stored.
        capture = AdaptiveContextCaptureInput(
            observed_at="2026-07-08T00:00:00+00:00",
            app_name="Arc",
            bundle_id="company.thebrowser.Browser",
            window_title="Reddit",
            site_domain="notion.so",
            site_url="https://www.notion.so/acme/reddit",
            structured_fields={"breadcrumb": ["Product research"]},
        )

        with TemporaryDirectory() as tempdir, patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "document_knowledge",
            },
        ):
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")

            # When: the tracker applies persisted Dev diagnostics before capture.
            _apply_developer_diagnostics_env(database)
            context = adaptive_content_context_for_capture(capture)

        # Then: capture is skipped because the UI-backed toggle was not enabled.
        self.assertIsNone(context)

    def test_developer_diagnostics_bridge_enables_capture_from_stored_toggle(self) -> None:
        # Given: Dev enhanced-context capture and one source family are stored in tracker meta.
        capture = AdaptiveContextCaptureInput(
            observed_at="2026-07-08T00:00:00+00:00",
            app_name="Arc",
            bundle_id="company.thebrowser.Browser",
            window_title="Reddit",
            site_domain="notion.so",
            site_url="https://www.notion.so/acme/reddit",
            structured_fields={"breadcrumb": ["Product research"]},
        )

        with TemporaryDirectory() as tempdir, patch.dict(os.environ, {}, clear=True):
            database = TrackerDatabase(Path(tempdir) / "tracker.sqlite3")
            database.set_meta("developer_diagnostics_enhanced_context_enabled", "true")
            database.set_meta("developer_diagnostics_enhanced_context_capture_local", "true")
            database.set_meta(
                "developer_diagnostics_enhanced_context_source_families",
                "document_knowledge",
            )

            # When: the tracker applies the stored Dev diagnostics before capture.
            _apply_developer_diagnostics_env(database)
            context = adaptive_content_context_for_capture(capture)

        # Then: the enabled UI-backed settings allow bounded derived context capture.
        self.assertIsNotNone(context)
        items = context["items"] if context is not None else []
        self.assertEqual({item["sourceFamily"] for item in items}, {"document_knowledge"})

    def test_current_snapshot_attaches_context_only_when_capture_gate_is_enabled(self) -> None:
        # Given: current macOS snapshot capture sees a supported document browser page.
        metadata = BrowserMetadata(
            browser_name="Google Chrome",
            site_domain="notion.so",
            site_title="Reddit",
            site_url="https://www.notion.so/acme/Product-research-Reddit",
            match_state="matched",
            browser_automation_status="granted",
        )

        # When: the local diagnostic gate and source-family gate are enabled.
        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "document_knowledge",
            },
        ), patch("app.tracker.macos_workspace._run_osascript") as mock_run, patch(
            "app.tracker.macos_workspace._browser_metadata",
            return_value=metadata,
        ):
            mock_run.return_value = "Google Chrome\ncom.google.Chrome\nReddit"
            snapshot = current_snapshot(include_system_transient=False)

        # Then: the snapshot carries derived local context without new provider-visible body.
        self.assertIsNotNone(snapshot.adaptive_content_context)
        items = snapshot.adaptive_content_context["items"] if snapshot.adaptive_content_context is not None else []
        self.assertEqual({item["sourceFamily"] for item in items}, {"document_knowledge"})
        self.assertEqual({item["providerPolicy"] for item in items}, {"metadata_only"})


if __name__ == "__main__":
    unittest.main()
