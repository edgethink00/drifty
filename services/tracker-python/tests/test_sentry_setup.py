from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from app import sentry_setup


class TrackerSentrySetupTests(unittest.TestCase):
    def tearDown(self) -> None:
        sentry_setup._capture_exception = None
        sentry_setup._flush = None
        sentry_setup._initialized = False

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

    def test_capture_reports_only_that_capture_and_flush_were_requested(self) -> None:
        capture = MagicMock()
        flush = MagicMock(return_value=True)
        sentry_setup._capture_exception = capture
        sentry_setup._flush = flush

        requested = sentry_setup.capture_tracker_exception(
            RuntimeError("drifty-sentry-smoke-abcdef"),
            {"phase": "sentry-smoke-test", "smokeId": "drifty-sentry-smoke-abcdef"},
        )

        self.assertTrue(requested)
        capture.assert_called_once()
        flush.assert_called_once_with(2.0)

    def test_capture_failure_is_reported_without_raising(self) -> None:
        sentry_setup._capture_exception = MagicMock(side_effect=RuntimeError("SDK failed"))
        self.assertFalse(sentry_setup.capture_tracker_exception(RuntimeError("safe error")))

    def test_capture_requires_flush_to_be_available(self) -> None:
        sentry_setup._capture_exception = MagicMock()
        sentry_setup._flush = None
        self.assertFalse(sentry_setup.capture_tracker_exception(RuntimeError("safe error")))


if __name__ == "__main__":
    unittest.main()
