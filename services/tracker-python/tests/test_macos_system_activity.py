from __future__ import annotations

from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from app.tracker.macos_system_activity import onscreen_window_rows


class OnscreenWindowRowsTests(TestCase):
    def test_uses_the_packaged_native_helper_instead_of_swift(self) -> None:
        commands: list[list[str]] = []
        helper = Path("/Applications/drifty.app/Contents/MacOS/chatgpt-session-ax")

        def run_command(command: list[str]) -> str:
            commands.append(command)
            return '[{"owner_name":"Dock","layer":18,"name":"Mission Control"}]'

        rows = onscreen_window_rows(run_command, helper_path=helper)

        self.assertEqual(
            commands,
            [[str(helper), "--onscreen-windows"]],
        )
        self.assertEqual(rows, [{"owner_name": "Dock", "layer": 18, "name": "Mission Control"}])

    def test_returns_no_rows_without_a_native_helper(self) -> None:
        with patch("app.tracker.macos_system_activity.compiled_helper_path", return_value=None):
            rows = onscreen_window_rows(lambda _command: self.fail("must not invoke a runtime compiler"))

        self.assertEqual(rows, [])

    def test_uses_the_default_packaged_helper_resolver(self) -> None:
        commands: list[list[str]] = []
        helper = Path("/Applications/drifty.app/Contents/MacOS/chatgpt-session-ax")

        with patch("app.tracker.macos_system_activity.compiled_helper_path", return_value=helper):
            rows = onscreen_window_rows(lambda command: commands.append(command) or "[]")

        self.assertEqual(commands, [[str(helper), "--onscreen-windows"]])
        self.assertEqual(rows, [])

    def test_rejects_malformed_helper_output(self) -> None:
        rows = onscreen_window_rows(lambda _command: "not-json", helper_path=Path("/tmp/native-helper"))

        self.assertEqual(rows, [])

    def test_treats_a_failed_helper_as_no_transient_activity(self) -> None:
        def fail(_command: list[str]) -> str:
            raise RuntimeError("helper unavailable")

        self.assertEqual(onscreen_window_rows(fail, helper_path=Path("/tmp/native-helper")), [])
