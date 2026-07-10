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
        # Given: Obsidian exposes a title hierarchy but no readable file path.
        capture = AdaptiveContextCaptureInput(
            observed_at="2026-07-10T00:00:00+00:00",
            app_name="Obsidian",
            bundle_id="md.obsidian",
            window_title="Daily note - Client Alpha - Work Vault - Obsidian",
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

        # Then: title-derived local note structure is stored without body text.
        self.assertIsNotNone(context)
        items = context["items"] if context is not None else []
        self.assertEqual({item["sourceFamily"] for item in items}, {"local_notes_markdown"})
        values_by_kind = {item["kind"]: item["values"] for item in items}
        self.assertIn("Daily note", values_by_kind["heading"])
        self.assertIn("Client Alpha", values_by_kind["folder"])
        self.assertIn("Work Vault", values_by_kind["project"])
        serialized = json.dumps(context)
        self.assertNotIn("body", serialized.lower())


if __name__ == "__main__":
    unittest.main()
