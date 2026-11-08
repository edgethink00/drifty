from __future__ import annotations

import http.client
import http.server
import os
import sqlite3
import sys
import tempfile
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
    def setUp(self) -> None:
        sentry_setup._repeat_limiter.reset()

    def tearDown(self) -> None:
        sentry_setup._capture_exception = None
        sentry_setup._flush = None
        sentry_setup._initialized = False
        sentry_setup._deferred_mode = None
        sentry_setup._deferred_database_path = None
        sentry_setup._repeat_limiter.reset()

    def test_init_without_dsn_is_noop(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(sentry_setup.init_tracker_sentry("request"))

    def test_deferred_init_does_not_import_the_sdk(self) -> None:
        with patch.dict(os.environ, {"DRIFTY_TRACKER_SENTRY_DSN": "https://key@example.invalid/1"}, clear=True), patch.dict(
            sys.modules, {"sentry_sdk": None}
        ):
            self.assertTrue(sentry_setup.init_tracker_sentry("request", defer_sdk_import=True))

        self.assertFalse(sentry_setup._initialized)
        self.assertIsNone(sentry_setup._capture_exception)
        self.assertEqual(sentry_setup._deferred_mode, "request")

    def test_deferred_init_imports_the_sdk_on_first_capture(self) -> None:
        fake_sdk = types.ModuleType("sentry_sdk")
        fake_sdk.init = MagicMock()
        fake_sdk.set_tag = MagicMock()
        fake_sdk.capture_exception = MagicMock()
        fake_sdk.flush = MagicMock()
        error = RuntimeError("request failed")
        # A different second failure: an identical repeat would be held back by
        # the repeated-report limit, which RepeatedReportTests covers.
        second_error = RuntimeError("second request failed")
        with patch.dict(os.environ, {"DRIFTY_TRACKER_SENTRY_DSN": "https://key@example.invalid/1"}, clear=True), patch.dict(
            sys.modules, {"sentry_sdk": fake_sdk}
        ):
            sentry_setup.init_tracker_sentry("request", defer_sdk_import=True)
            fake_sdk.init.assert_not_called()
            self.assertTrue(sentry_setup.capture_tracker_exception(error, {"phase": "request"}))
            self.assertTrue(sentry_setup.capture_tracker_exception(second_error, {"phase": "request"}))

        fake_sdk.init.assert_called_once()
        fake_sdk.set_tag.assert_any_call("tracker_mode", "request")
        self.assertEqual(fake_sdk.capture_exception.call_count, 2)
        fake_sdk.flush.assert_called_with(2.0)

    def test_deferred_capture_without_the_sdk_fails_quietly_once(self) -> None:
        with patch.dict(os.environ, {"DRIFTY_TRACKER_SENTRY_DSN": "https://key@example.invalid/1"}, clear=True), patch.dict(
            sys.modules, {"sentry_sdk": None}
        ):
            sentry_setup.init_tracker_sentry("request", defer_sdk_import=True)
            self.assertFalse(sentry_setup.capture_tracker_exception(RuntimeError("x")))

        self.assertIsNone(sentry_setup._deferred_mode)

    def test_libressl_warning_stays_out_of_tracker_stderr(self) -> None:
        import warnings

        message = "urllib3 v2 only supports OpenSSL 1.1.1+, currently the 'ssl' module is compiled with 'LibreSSL 2.8.3'."
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            sentry_setup.silence_urllib3_libressl_warning()
            warnings.warn(message, UserWarning)
            warnings.warn("an unrelated warning", UserWarning)

        self.assertEqual([str(item.message) for item in caught], ["an unrelated warning"])

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
            database = sqlite3.connect(":memory:")
            try:
                database.execute("CREATE TABLE sample(value INTEGER UNIQUE)")
                database.execute("INSERT INTO sample VALUES (1)")
                try:
                    database.execute("INSERT INTO sample VALUES (1)")
                except sqlite3.IntegrityError as error:
                    self.assertTrue(sentry_setup.capture_tracker_exception(error, {"phase": "serve"}))
            finally:
                database.close()

        self.assertEqual(len(sent), 2)
        event = sent[0]
        rendered = repr(event)
        frames = event["exception"]["values"][0]["stacktrace"]["frames"]  # type: ignore[index]
        self.assertIn("failing_save", [frame.get("function") for frame in frames])
        self.assertNotIn("server_name", event)
        self.assertNotIn("Morgan", rendered)
        self.assertNotIn(video_id, rendered)
        self.assertEqual(event["tags"]["os.name"], sentry_setup._platform_name())  # type: ignore[index]
        sqlite_extras = sent[1]["extra"]
        if sys.version_info >= (3, 11):
            self.assertEqual(sqlite_extras["sqlite_extended_result"], 2067)
            self.assertEqual(sqlite_extras["sqlite_primary_result"], 19)
        else:
            self.assertNotIn("sqlite_extended_result", sqlite_extras)
            self.assertNotIn("sqlite_primary_result", sqlite_extras)

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

    def test_sqlite_lock_reports_distinguish_writer_contention_from_stale_snapshot(self) -> None:
        capture = MagicMock()
        sentry_setup._capture_exception = capture
        sentry_setup._flush = MagicMock()
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "test.sqlite3")
            first = sqlite3.connect(path, timeout=0)
            second = sqlite3.connect(path, timeout=0)
            try:
                first.execute("PRAGMA journal_mode=WAL")
                first.execute("CREATE TABLE sample(value INTEGER)")
                with first:
                    first.execute("INSERT INTO sample VALUES (0)")
                first.execute("BEGIN IMMEDIATE")
                with self.assertRaises(sqlite3.OperationalError) as busy:
                    second.execute("UPDATE sample SET value=1")
                second.rollback()
                first.rollback()

                first.execute("BEGIN")
                first.execute("SELECT * FROM sample").fetchall()
                with second:
                    second.execute("UPDATE sample SET value=2")
                with self.assertRaises(sqlite3.OperationalError) as snapshot:
                    first.execute("UPDATE sample SET value=3")
                first.rollback()
                self.assertEqual(str(busy.exception), str(snapshot.exception))
                for error, code in ((busy.exception, 5), (snapshot.exception, 517)):
                    with self.subTest(code=code):
                        # Python 3.9 has no result code, so these two would be
                        # one repeated failure; this test checks the extras only.
                        sentry_setup._repeat_limiter.reset()
                        self.assertTrue(sentry_setup.capture_tracker_exception(error, {"phase": "serve"}))
                        self.assertIs(capture.call_args.args[0], error)
                        extras = capture.call_args.kwargs["extras"]
                        expected = {"phase": "serve"}
                        if sys.version_info >= (3, 11):
                            self.assertEqual(error.sqlite_errorcode, code)
                            expected.update(sqlite_extended_result=code, sqlite_primary_result=5)
                        self.assertEqual(extras, expected)
                        self.assertEqual(sentry_setup.scrub_sentry_event({"extra": extras})["extra"], expected)
                self.assertEqual(first.execute("SELECT value FROM sample").fetchone()[0], 2)
                self.assertEqual(first.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            finally:
                first.close()
                second.close()

    def test_sqlite_diagnostics_copy_only_numeric_result_codes(self) -> None:
        error = sqlite3.OperationalError("disk I/O error")
        error.sqlite_errorcode = 778  # SQLITE_IOERR_WRITE.
        error.sqlite_errorname = "private error-name marker"
        error.sql = "private query marker"
        capture = MagicMock()
        sentry_setup._capture_exception = capture
        sentry_setup._flush = MagicMock()
        self.assertTrue(sentry_setup.capture_tracker_exception(error, {"phase": "daemon_tick"}))
        self.assertEqual(capture.call_args.kwargs["extras"], {
            "phase": "daemon_tick", "sqlite_extended_result": 778, "sqlite_primary_result": 10,
        })

    def test_missing_or_invalid_sqlite_codes_do_not_change_error_capture(self) -> None:
        capture = MagicMock()
        sentry_setup._capture_exception = capture
        sentry_setup._flush = MagicMock()
        errors = [sqlite3.OperationalError("legacy Python error"), RuntimeError("unrelated error")]
        errors[-1].sqlite_errorcode = 517
        for value in (True, "517", 517.0, -1, 0, 1 << 32):
            error = sqlite3.OperationalError("invalid metadata")
            error.sqlite_errorcode = value
            errors.append(error)
        for error in errors:
            with self.subTest(error=error, code=getattr(error, "sqlite_errorcode", None)):
                sentry_setup._repeat_limiter.reset()  # Same message each time; extras are under test.
                self.assertTrue(sentry_setup.capture_tracker_exception(error, {"phase": "serve"}))
                self.assertIs(capture.call_args.args[0], error)
                self.assertEqual(capture.call_args.kwargs["extras"], {"phase": "serve"})

    def test_capture_requires_flush_to_be_available(self) -> None:
        sentry_setup._capture_exception = MagicMock()
        sentry_setup._flush = None
        self.assertFalse(sentry_setup.capture_tracker_exception(RuntimeError("safe error")))


class RepeatedReportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = 0.0
        self.original_limiter = sentry_setup._repeat_limiter
        sentry_setup._repeat_limiter = sentry_setup.RepeatedReportLimiter(clock=lambda: self.now)
        self.capture = MagicMock()
        self.flush = MagicMock(return_value=True)
        sentry_setup._capture_exception = self.capture
        sentry_setup._flush = self.flush

    def tearDown(self) -> None:
        sentry_setup._repeat_limiter = self.original_limiter
        sentry_setup._capture_exception = None
        sentry_setup._flush = None

    def tick_failure(self, context: dict | None = None) -> bool:
        return sentry_setup.capture_tracker_exception(
            sqlite3.OperationalError("database or disk is full"), context or {"phase": "daemon_tick"},
        )

    def test_a_status_write_does_not_hide_a_later_activity_write_failure(self) -> None:
        def failing_write() -> None:
            raise sqlite3.OperationalError("disk I/O error")

        def sampling_tick(fail_status: bool) -> None:
            if fail_status:
                failing_write()  # Status write.
            failing_write()  # Activity write.

        def report(fail_status: bool) -> bool:
            try:
                sampling_tick(fail_status)
            except sqlite3.Error as error:
                return sentry_setup.capture_tracker_exception(
                    error, {"phase": "daemon_tick"}, sqlite_repeat_frame=sampling_tick.__code__,
                )
            self.fail("Expected an error from the sampling tick")

        self.assertEqual([report(status) for status in (True, True, False, False)], [True, False, True, False])
        self.assertEqual([call.kwargs["extras"] for call in self.capture.call_args_list],
                         [{"phase": "daemon_tick"}] * 2)

        self.now = 3600.0
        self.assertTrue(report(False))
        self.assertTrue(report(True))
        self.assertEqual([call.kwargs["extras"] for call in self.capture.call_args_list[-2:]], [
            {"phase": "daemon_tick", "suppressed_repeats": 1, "repeat_window_seconds": 3600},
        ] * 2)

    def test_a_lasting_tick_failure_reports_once_per_window_with_the_held_back_count(self) -> None:
        # DRIFTY-MAC-NATIVE-81: a 1.14.0 daemon sent this every 5-second tick.
        results = []
        for tick in range(720):  # one hour of 5-second ticks
            self.now = tick * 5.0
            results.append(self.tick_failure())

        self.assertEqual(results.count(True), 1)
        self.assertTrue(results[0])
        self.capture.assert_called_once()
        self.flush.assert_called_once_with(2.0)
        self.assertNotIn("suppressed_repeats", self.capture.call_args.kwargs["extras"])

        self.now = 3600.0
        self.assertTrue(self.tick_failure())
        self.assertEqual(self.capture.call_count, 2)
        extras = self.capture.call_args.kwargs["extras"]
        self.assertEqual(extras["suppressed_repeats"], 719)
        self.assertEqual(extras["repeat_window_seconds"], 3600)
        self.assertEqual(extras["phase"], "daemon_tick")

        self.now = 3605.0
        self.assertFalse(self.tick_failure())
        self.assertEqual(self.capture.call_count, 2)

        # Still failing through that hour, so the next window is two hours.
        self.now = 3600.0 + 7195.0
        self.assertFalse(self.tick_failure())
        self.now = 3600.0 + 7200.0
        self.assertTrue(self.tick_failure())
        extras = self.capture.call_args.kwargs["extras"]
        self.assertEqual(extras["suppressed_repeats"], 2)
        self.assertEqual(extras["repeat_window_seconds"], 7200)

    def test_a_failure_lasting_for_days_settles_to_one_report_a_day(self) -> None:
        day = 24 * 60 * 60
        reported = []
        for tick in range(0, 4 * day, 5):  # four days of 5-second ticks
            self.now = float(tick)
            if self.tick_failure():
                reported.append(tick)

        per_day = [sum(1 for tick in reported if index * day <= tick < (index + 1) * day) for index in range(4)]
        # 0, 1h, 3h, 7h and 15h on the first day, then the window stays at a day.
        self.assertEqual(per_day, [5, 1, 1, 1])
        last = self.capture.call_args.kwargs["extras"]
        self.assertEqual(last["repeat_window_seconds"], day)
        self.assertEqual(last["suppressed_repeats"], day // 5 - 1)

    def test_a_failure_that_went_quiet_starts_over_at_the_first_window(self) -> None:
        self.assertTrue(self.tick_failure())
        self.now = 7200.0  # nothing in between: a new episode
        self.assertTrue(self.tick_failure())
        self.assertNotIn("suppressed_repeats", self.capture.call_args.kwargs["extras"])
        self.now = 7210.0
        self.assertFalse(self.tick_failure())
        self.now = 7200.0 + 3600.0
        self.assertTrue(self.tick_failure())
        self.assertEqual(self.capture.call_args.kwargs["extras"]["repeat_window_seconds"], 3600)

    def test_a_process_failing_everywhere_stays_inside_its_daily_budget(self) -> None:
        budget = sentry_setup.REPORT_BUDGET_PER_PERIOD
        commands = [f"command_{index}" for index in range(budget + 5)]
        for minute in range(0, 24 * 60, 10):
            self.now = minute * 60.0
            for command in commands:
                self.tick_failure({"phase": "serve", "command": command})
        self.assertEqual(self.capture.call_count, budget)

        # The failures held back by the budget go first once it frees.
        self.now = 24 * 60 * 60.0
        self.assertTrue(self.tick_failure({"phase": "serve", "command": commands[budget]}))
        extras = self.capture.call_args.kwargs["extras"]
        self.assertEqual(extras["command"], commands[budget])
        self.assertEqual(extras["suppressed_repeats"], 24 * 6)

    def test_different_places_and_failures_are_reported_separately(self) -> None:
        self.assertTrue(self.tick_failure({"phase": "daemon_tick"}))
        self.assertTrue(self.tick_failure({"phase": "serve", "command": "save_classifications"}))
        self.assertTrue(self.tick_failure({"phase": "serve", "command": "record_project_pass"}))
        self.assertTrue(sentry_setup.capture_tracker_exception(
            sqlite3.OperationalError("database is locked"), {"phase": "daemon_tick"},
        ))
        self.assertTrue(sentry_setup.capture_tracker_exception(
            PermissionError("database or disk is full"), {"phase": "daemon_tick"},
        ))
        self.assertEqual(self.capture.call_count, 5)

        self.assertFalse(self.tick_failure({"phase": "serve", "command": "save_classifications"}))
        self.assertEqual(self.capture.call_count, 5)

    def test_random_temp_names_do_not_defeat_the_limit(self) -> None:
        for name in ("tmpd8t2br5m", "tmp_zywzcgn", "tmpab12cd34"):
            sentry_setup.capture_tracker_exception(
                OSError(f"[WinError 145] The directory is not empty: 'C:\\\\Temp\\\\{name}'"),
                {"phase": "daemon_tick"},
            )
        self.capture.assert_called_once()

    def test_explicit_smoke_reports_are_never_held_back(self) -> None:
        for _ in range(2):
            self.assertTrue(sentry_setup.capture_tracker_exception(
                RuntimeError("drifty-sentry-smoke-abcdef"),
                {"phase": "sentry-smoke-test", "smokeId": "drifty-sentry-smoke-abcdef"},
                limit_repeats=False,
            ))
        self.assertEqual(self.capture.call_count, 2)

    def test_remembered_failures_stay_bounded(self) -> None:
        limiter = sentry_setup.RepeatedReportLimiter(max_keys=3, clock=lambda: self.now)
        for key in ("a", "b", "c", "d"):
            self.assertEqual(limiter.admit((key,))[:2], (True, 0))
        self.assertEqual(len(limiter._entries), 3)
        # The oldest key was forgotten, so it reports again; a remembered one waits.
        self.assertEqual(limiter.admit(("a",))[:2], (True, 0))
        self.assertEqual(limiter.admit(("d",))[:2], (False, 1))


class TempNameGroupingTests(unittest.TestCase):
    def test_temp_directory_names_do_not_split_issues(self) -> None:
        first = sentry_setup.redact_text(
            "[WinError 145] The directory is not empty: 'C:\\\\Users\\\\USER~1\\\\AppData\\\\Local\\\\Temp\\\\tmpd8t2br5m'"
        )
        second = sentry_setup.redact_text(
            "[WinError 145] The directory is not empty: 'C:\\\\Users\\\\USER~1\\\\AppData\\\\Local\\\\Temp\\\\tmp_zywzcgn'"
        )
        self.assertEqual(first, second)
        self.assertIn("tmp[random]", first)
        self.assertNotIn("USER~1", first)
        self.assertEqual(sentry_setup.redact_text("/var/folders/x/T/tmpab12cd34/History"), "/var/folders/x/T/tmp[random]/History")
        self.assertEqual(sentry_setup.redact_text("C:\\\\data\\\\tmpfile_backup.db"), "C:\\\\data\\\\tmpfile_backup.db")


if __name__ == "__main__":
    unittest.main()
