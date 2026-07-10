import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.macos_workspace import AdaptiveContextCaptureInput, adaptive_content_context_for_capture


class AdaptiveContextNativeAppExtractorTests(unittest.TestCase):
    def test_native_notion_extracts_page_context_without_url_metadata(self) -> None:
        # Given: the native Notion app exposes only a window title.
        capture = AdaptiveContextCaptureInput(
            observed_at="2026-07-10T00:00:00+00:00",
            app_name="Notion",
            bundle_id="notion.id",
            window_title="Launch plan - Growth - Edgethink - Notion",
        )

        # When: document knowledge capture is enabled.
        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "document_knowledge",
            },
        ):
            context = adaptive_content_context_for_capture(capture)

        # Then: title-derived document structure is stored without body text.
        self.assertIsNotNone(context)
        items = context["items"] if context is not None else []
        self.assertEqual({item["sourceFamily"] for item in items}, {"document_knowledge"})
        values_by_kind = {item["kind"]: item["values"] for item in items}
        self.assertIn("Launch plan", values_by_kind["heading"])
        self.assertIn("Growth", values_by_kind["parentPage"])
        self.assertIn("Edgethink", values_by_kind["workspace"])
        serialized = json.dumps(context)
        self.assertNotIn("body", serialized.lower())

    def test_native_obsidian_extracts_title_context_without_file_path(self) -> None:
        # Given: Obsidian titles follow "note - vault - Obsidian <version>" on macOS.
        capture = AdaptiveContextCaptureInput(
            observed_at="2026-07-10T00:00:00+00:00",
            app_name="Obsidian",
            bundle_id="md.obsidian",
            window_title="Daily note - Work Vault - Obsidian 1.12.7",
        )

        # When: local Markdown capture is enabled.
        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "local_notes_markdown",
            },
        ):
            context = adaptive_content_context_for_capture(capture)

        # Then: the versioned app suffix is dropped instead of leaking into project values.
        self.assertIsNotNone(context)
        items = context["items"] if context is not None else []
        self.assertEqual({item["sourceFamily"] for item in items}, {"local_notes_markdown"})
        values_by_kind = {item["kind"]: item["values"] for item in items}
        self.assertIn("Daily note", values_by_kind["heading"])
        self.assertIn("Work Vault", values_by_kind["folder"])
        self.assertNotIn("project", values_by_kind)
        all_item_values = [value for item in items for value in item["values"]]
        self.assertNotIn("Obsidian 1.12.7", all_item_values)
        serialized = json.dumps(context)
        self.assertNotIn("body", serialized.lower())

    def test_issue_settings_paths_are_not_repos(self) -> None:
        # Given: a GitHub account settings page rather than a repository.
        capture = AdaptiveContextCaptureInput(
            observed_at="2026-07-10T00:00:00+00:00",
            app_name="Safari",
            bundle_id="com.apple.Safari",
            window_title="Personal access tokens",
            browser_name="Safari",
            site_domain="github.com",
            site_title="Personal access tokens",
            site_url="https://github.com/settings/tokens",
        )

        # When: work tracker capture is enabled.
        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "work_tracker_dev_platform",
            },
        ):
            context = adaptive_content_context_for_capture(capture)

        # Then: no repo item is derived from the settings path.
        items = context["items"] if context is not None else []
        self.assertNotIn("repo", {item["kind"] for item in items})

    def test_communication_channel_drops_unread_count_badge(self) -> None:
        # Given: a Gmail tab whose title carries a churning unread-count badge.
        capture = AdaptiveContextCaptureInput(
            observed_at="2026-07-10T00:00:00+00:00",
            app_name="Aside",
            bundle_id="com.aside.browser",
            window_title="받은편지함 (843) - user@example.com - Gmail",
            browser_name="Aside",
            site_domain="mail.google.com",
            site_title="받은편지함 (843) - user@example.com - Gmail",
        )

        # When: communication metadata capture is enabled.
        with patch.dict(
            os.environ,
            {
                "DRIFTY_ENABLE_ADAPTIVE_CONTEXT_CAPTURE": "1",
                "DRIFTY_ADAPTIVE_CONTEXT_SOURCE_FAMILIES": "communication_metadata",
            },
        ):
            context = adaptive_content_context_for_capture(capture)

        # Then: the channel value is stable across unread-count changes.
        self.assertIsNotNone(context)
        items = context["items"] if context is not None else []
        values_by_kind = {item["kind"]: item["values"] for item in items}
        self.assertIn("받은편지함", values_by_kind["channel"])
        self.assertNotIn("받은편지함 (843)", values_by_kind["channel"])


if __name__ == "__main__":
    unittest.main()
