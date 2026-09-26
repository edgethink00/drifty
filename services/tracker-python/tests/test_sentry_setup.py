from __future__ import annotations

import http.client
import http.server
import os
import sys
import threading
import types
import unittest
from unittest.mock import MagicMock, patch

from app import sentry_setup

try:
    import sentry_sdk
except ImportError:  # The SDK ships only in packaged builds.
    sentry_sdk = None


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

    def test_scrubber_keeps_exception_stack_frames_and_mechanism(self) -> None:
        event = sentry_setup.scrub_sentry_event(
            {
                "exception": {
                    "values": [
                        {
                            "type": "IntegrityError",
                            "value": "FOREIGN KEY constraint failed",
                            "module": "sqlite3",
                            "mechanism": {"type": "generic", "handled": True},
                            "stacktrace": {
                                "frames": [
                                    {
                                        "filename": "app/storage/db.py",
                                        "abs_path": "C:\\Users\\Morgan\\AppData\\Local\\Temp\\_MEI1\\app\\storage\\db.py",
                                        "function": "save_classifications",
                                        "lineno": 3796,
                                        "pre_context": ["with self.connect() as conn:"],
                                        "in_app": True,
                                        "vars": {"segment": "Private window title"},
                                    },
                                    {
                                        "filename": "app/main.py",
                                        "abs_path": "/Users/jane/drifty/services/tracker-python/app/main.py",
                                        "function": "serve",
                                        "lineno": 2220,
                                    },
                                ]
                            },
                        }
                    ]
                }
            }
        )

        exception = event["exception"]["values"][0]
        self.assertEqual(exception["mechanism"], {"type": "generic", "handled": True})
        frames = exception["stacktrace"]["frames"]
        self.assertEqual([frame["function"] for frame in frames], ["save_classifications", "serve"])
        self.assertEqual(frames[0]["lineno"], 3796)
        self.assertEqual(frames[0]["pre_context"], ["with self.connect() as conn:"])
        self.assertNotIn("vars", frames[0])
        self.assertNotIn("Private window title", repr(event))
        self.assertEqual(frames[0]["abs_path"], "C:\\Users\\[user]\\AppData\\Local\\Temp\\_MEI1\\app\\storage\\db.py")
        self.assertEqual(frames[1]["abs_path"], "/Users/[user]/drifty/services/tracker-python/app/main.py")

    def test_scrubber_keeps_http_breadcrumb_urls_filtered(self) -> None:
        # Only exception frames bypass the depth bound; breadcrumb data (HTTP
        # request URLs from YouTube metadata fetches) must stay filtered.
        event = sentry_setup.scrub_sentry_event(
            {
                "breadcrumbs": {
                    "values": [
                        {
                            "category": "httplib",
                            "type": "http",
                            "data": {"url": "https://www.youtube.com/shorts/abc123XYZ", "http.method": "GET"},
                        }
                    ]
                }
            }
        )

        self.assertNotIn("youtube", repr(event))
        self.assertEqual(event["breadcrumbs"]["values"][0]["category"], "httplib")

    def test_scrubber_removes_hostname_and_windows_account_names(self) -> None:
        event = sentry_setup.scrub_sentry_event(
            {
                "server_name": "Morgan2024",
                "extra": {
                    "sys.argv": [
                        "\\\\?\\C:\\Users\\Morgan\\AppData\\Local\\drifty\\drifty-tracker\\drifty-tracker.exe",
                        "serve",
                        "--db",
                        "c:/users/rileyk/AppData/Local/so.drifty.windows/tracker.sqlite3",
                    ],
                },
            }
        )

        rendered = repr(event)
        self.assertNotIn("server_name", event)
        self.assertNotIn("Morgan", rendered)
        self.assertNotIn("rileyk", rendered)
        self.assertEqual(
            event["extra"]["sys.argv"],
            [
                "\\\\?\\C:\\Users\\[user]\\AppData\\Local\\drifty\\drifty-tracker\\drifty-tracker.exe",
                "serve",
                "--db",
                "c:/users/[user]/AppData/Local/so.drifty.windows/tracker.sqlite3",
            ],
        )

    def test_scrubber_still_bounds_unexpectedly_deep_values(self) -> None:
        nested: dict[str, object] = {"leaf": "kept"}
        for _ in range(12):
            nested = {"level": nested}

        event = sentry_setup.scrub_sentry_event({"extra": {"deep": nested}})

        self.assertNotIn("kept", repr(event))
        self.assertIn("[Filtered]", repr(event))

    def test_init_tags_the_platform_because_contexts_are_scrubbed(self) -> None:
        fake_sdk = types.ModuleType("sentry_sdk")
        fake_sdk.capture_exception = MagicMock()
        fake_sdk.flush = MagicMock()
        fake_sdk.init = MagicMock()
        fake_sdk.set_tag = MagicMock()

        with patch.dict(sys.modules, {"sentry_sdk": fake_sdk}), patch.dict(
            os.environ, {"DRIFTY_TRACKER_SENTRY_DSN": "https://public@example.invalid/1"}, clear=True
        ), patch.object(sentry_setup.platform, "system", return_value="Windows"):
            self.assertTrue(sentry_setup.init_tracker_sentry("serve"))

        fake_sdk.set_tag.assert_any_call("os.name", "Windows")
        self.assertIs(fake_sdk.init.call_args.kwargs["before_send"], sentry_setup.scrub_sentry_event)

    @unittest.skipIf(sentry_sdk is None, "sentry-sdk is installed only for packaged builds")
    def test_real_sdk_event_keeps_frames_and_drops_identity(self) -> None:
        sent: list[dict[str, object]] = []
        # Built at runtime: the SDK attaches this file's source lines as frame
        # context, so a literal marker would appear in the event regardless.
        video_id = "abc" + "123XYZ"

        class CapturingTransport(sentry_sdk.transport.Transport):
            def capture_envelope(self, envelope):  # type: ignore[no-untyped-def]
                for item in envelope.items:
                    if item.headers.get("type") == "event":
                        sent.append(item.payload.json)

        class QuietHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - http.server API
                self.send_response(204)
                self.end_headers()

            def log_message(self, *_args: object) -> None:
                return None

        server = http.server.HTTPServer(("127.0.0.1", 0), QuietHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        real_init = sentry_sdk.init

        def init_with_capture(*args, **kwargs):  # type: ignore[no-untyped-def]
            return real_init(*args, transport=CapturingTransport, **kwargs)

        def failing_save() -> None:
            raise RuntimeError("could not open C:\\Users\\Morgan\\AppData\\Local\\so.drifty.windows\\tracker.sqlite3")

        argv = ["C:\\Users\\Morgan\\AppData\\Local\\drifty\\drifty-tracker.exe", "serve"]
        with patch.object(sentry_sdk, "init", init_with_capture), patch.object(sys, "argv", argv), patch.dict(
            os.environ, {"DRIFTY_TRACKER_SENTRY_DSN": "https://public@example.invalid/1"}, clear=True
        ):
            self.assertTrue(sentry_setup.init_tracker_sentry("serve"))
            self.addCleanup(lambda: sentry_sdk.get_client().close())
            connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1])
            connection.request("GET", "/shorts/" + video_id)
            connection.getresponse().read()
            connection.close()
            try:
                failing_save()
            except RuntimeError as error:
                self.assertTrue(sentry_setup.capture_tracker_exception(error, {"phase": "serve"}))

        self.assertEqual(len(sent), 1)
        event = sent[0]
        rendered = repr(event)
        frames = event["exception"]["values"][0]["stacktrace"]["frames"]  # type: ignore[index]
        self.assertIn("failing_save", [frame.get("function") for frame in frames])
        self.assertNotIn("server_name", event)
        self.assertNotIn("Morgan", rendered)
        self.assertNotIn(video_id, rendered)
        self.assertEqual(event["tags"]["os.name"], sentry_setup._platform_name())  # type: ignore[index]

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
