from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app import sentry_setup


class TrackerSentrySetupTests(unittest.TestCase):
    def test_init_without_dsn_is_noop(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(sentry_setup.init_tracker_sentry("request"))

    def test_scrubber_drops_user_request_and_filters_activity_fields(self) -> None:
        event = sentry_setup.scrub_sentry_event(
            {
                "user": {"email": "person@example.com"},
                "request": {"url": "https://example.com/private?access_token=secret"},
                "message": "failed for person@example.com",
                "extra": {
                    "windowTitle": "Private note",
                    "siteUrl": "https://example.com/private?apikey=secret",
                    "nested": {"domain": "example.com", "durationSeconds": 42},
                },
            }
        )

        rendered = repr(event)
        self.assertNotIn("user", event)
        self.assertNotIn("request", event)
        self.assertNotIn("person@example.com", rendered)
        self.assertNotIn("apikey=secret", rendered)
        self.assertEqual(event["extra"], {"windowTitle": "[Filtered]", "siteUrl": "[Filtered]", "nested": {"domain": "[Filtered]", "durationSeconds": 42}})

    def test_sanitize_value_filters_unexpected_objects(self) -> None:
        self.assertEqual(sentry_setup.sanitize_value(("unexpected", "tuple"), "safeField"), "[Filtered]")


if __name__ == "__main__":
    unittest.main()
