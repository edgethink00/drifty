from contextlib import contextmanager
import unittest
from unittest.mock import patch

from app import macos_process_liveness, process_liveness, windows_process_liveness


class PlatformOwnerTests(unittest.TestCase):
    def test_native_platform_owner_is_retained_and_closed_on_capture_failure(self):
        for platform, native, unused in (
            ("darwin", macos_process_liveness, windows_process_liveness),
            ("win32", windows_process_liveness, macos_process_liveness),
        ):
            closed = []
            token = object()

            @contextmanager
            def native_owner():
                try:
                    yield token
                finally:
                    closed.append(token)

            with self.subTest(platform=platform), patch.object(process_liveness.sys, "platform", platform), \
                    patch.object(native, "tracker_app_owner", native_owner), \
                    patch.object(unused, "tracker_app_owner") as other, \
                    self.assertRaisesRegex(RuntimeError, "capture failed"):
                with process_liveness.tracker_app_owner() as owner:
                    self.assertIs(owner, token)
                    raise RuntimeError("capture failed")
            other.assert_not_called()
            self.assertEqual(closed, [token])

    def test_native_admission_error_is_not_treated_as_standalone_cli(self):
        for platform, native in (("darwin", macos_process_liveness), ("win32", windows_process_liveness)):
            with self.subTest(platform=platform), patch.object(process_liveness.sys, "platform", platform), \
                    patch.object(native, "tracker_app_owner", side_effect=RuntimeError("owner gone")), \
                    self.assertRaisesRegex(RuntimeError, "owner gone"):
                with process_liveness.tracker_app_owner():
                    self.fail("invalid owner admitted")
