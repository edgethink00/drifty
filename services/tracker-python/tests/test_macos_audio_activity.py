from __future__ import annotations

import unittest
import threading
from unittest.mock import patch

from app.tracker import macos_audio_activity

from app.tracker.macos_audio_activity import (
    ForegroundAudioSample,
    FrontmostProcess,
    LSAPPINFO_PATH,
    PS_PATH,
    ProcessRow,
    current_frontmost_process,
    foreground_audio_sample,
    process_is_owned_by_frontmost,
)


FRONT_INFO = '''
"pid"=397
"CFBundleIdentifier"="com.google.Chrome"
"LSBundlePath"="/Applications/Google Chrome.app"
"LSApplicationCoalitionPIDsKey"=( 397, 9287 )
'''


class FakeReader:
    def __init__(self, pids: set[int]) -> None:
        self.pids = frozenset(pids)

    def running_output_process_ids(self) -> frozenset[int]:
        return self.pids


class FailingReader:
    def running_output_process_ids(self) -> frozenset[int]:
        raise OSError("CoreAudio reset")


class BlockingReader:
    def __init__(self, started: threading.Event, release: threading.Event) -> None:
        self.started = started
        self.release = release

    def running_output_process_ids(self) -> frozenset[int]:
        self.started.set()
        self.release.wait(1)
        return frozenset({397})


def runner_for(*, process_rows: str = ""):
    def run(command: list[str]) -> str:
        if command == [LSAPPINFO_PATH, "front"]:
            return "[ ASN:0x0-0x123 ]"
        if command[:2] == [LSAPPINFO_PATH, "info"]:
            return FRONT_INFO
        if command == [PS_PATH, "-axo", "pid=,ppid=,command="]:
            return process_rows
        raise AssertionError(command)

    return run


class MacosAudioActivityTests(unittest.TestCase):
    def test_parses_frontmost_pid_bundle_and_path(self) -> None:
        frontmost = current_frontmost_process(runner_for())

        self.assertEqual(
            frontmost,
            FrontmostProcess(
                pid=397,
                bundle_id="com.google.Chrome",
                bundle_path="/Applications/Google Chrome.app",
                coalition_pids=frozenset({397, 9287}),
            ),
        )

    def test_falls_back_when_filtered_lsappinfo_is_unsupported(self) -> None:
        commands: list[list[str]] = []

        def run(command: list[str]) -> str:
            commands.append(command)
            if command == [LSAPPINFO_PATH, "front"]:
                return "ASN:0x0-0x123:"
            if command == [LSAPPINFO_PATH, "info", "ASN:0x0-0x123:"]:
                return '''
"Google Chrome" ASN:0x0-0x123:
    bundleID="com.google.Chrome"
    bundle path="/Applications/Google Chrome.app"
    pid = 397 type="Foreground" flavor=3
'''
            if command[:3] == [LSAPPINFO_PATH, "info", "ASN:0x0-0x123:"]:
                raise RuntimeError("filtered keys unsupported")
            raise AssertionError(command)

        frontmost = current_frontmost_process(run)

        self.assertEqual(
            frontmost,
            FrontmostProcess(397, "com.google.Chrome", "/Applications/Google Chrome.app"),
        )
        self.assertEqual(len(commands), 3)

    def test_falls_back_when_filtered_lsappinfo_omits_pid(self) -> None:
        commands: list[list[str]] = []

        def run(command: list[str]) -> str:
            commands.append(command)
            if command == [LSAPPINFO_PATH, "front"]:
                return "ASN:0x0-0x123:"
            if command == [LSAPPINFO_PATH, "info", "ASN:0x0-0x123:"]:
                return FRONT_INFO
            if command[:3] == [LSAPPINFO_PATH, "info", "ASN:0x0-0x123:"]:
                return '"LSApplicationCoalitionPIDsKey"=( 397, 9287 )'
            raise AssertionError(command)

        frontmost = current_frontmost_process(run)

        self.assertEqual(
            frontmost,
            FrontmostProcess(
                397,
                "com.google.Chrome",
                "/Applications/Google Chrome.app",
                frozenset({397, 9287}),
            ),
        )
        self.assertEqual(len(commands), 3)

    def test_accepts_descendant_audio_process(self) -> None:
        frontmost = FrontmostProcess(397, "com.google.Chrome", "/Applications/Google Chrome.app")
        rows = (
            ProcessRow(9287, 397, "/Applications/Google Chrome.app/Contents/Helpers/Chrome Helper"),
        )

        self.assertTrue(process_is_owned_by_frontmost(9287, frontmost, rows))

    def test_accepts_launchd_owned_process_in_frontmost_coalition(self) -> None:
        frontmost = FrontmostProcess(
            723,
            "com.apple.Safari",
            "/System/Applications/Safari.app",
            frozenset({723, 901}),
        )
        rows = (
            ProcessRow(
                901,
                1,
                "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/"
                "com.apple.WebKit.GPU.xpc/Contents/MacOS/com.apple.WebKit.GPU",
            ),
        )

        self.assertTrue(process_is_owned_by_frontmost(901, frontmost, rows))

    def test_parent_cycle_fails_closed_without_looping(self) -> None:
        frontmost = FrontmostProcess(397, "com.google.Chrome", "/Applications/Google Chrome.app")
        rows = (
            ProcessRow(9287, 9288, "Chrome Helper"),
            ProcessRow(9288, 9287, "Chrome Helper"),
        )

        self.assertFalse(process_is_owned_by_frontmost(9287, frontmost, rows))

    def test_rejects_same_chrome_bundle_from_an_independent_process_tree(self) -> None:
        frontmost = FrontmostProcess(397, "com.google.Chrome", "/Applications/Google Chrome.app")
        rows = (
            ProcessRow(52688, 1, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            ProcessRow(52699, 52688, "/Applications/Google Chrome.app/Contents/Helpers/Chrome Helper"),
        )

        self.assertFalse(process_is_owned_by_frontmost(52699, frontmost, rows))

    def test_accepts_launchd_owned_safari_helper_inside_frontmost_bundle(self) -> None:
        frontmost = FrontmostProcess(723, "com.apple.Safari", "/System/Applications/Safari.app")
        rows = (
            ProcessRow(
                900,
                1,
                "/System/Applications/Safari.app/Contents/XPCServices/com.apple.WebKit.WebContent",
            ),
        )

        self.assertTrue(process_is_owned_by_frontmost(900, frontmost, rows))

    def test_rejects_system_webkit_helper_without_safari_specific_ownership(self) -> None:
        frontmost = FrontmostProcess(
            723,
            "com.apple.Safari",
            "/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app",
        )
        rows = (
            ProcessRow(
                901,
                1,
                "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/"
                "com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent",
            ),
        )

        self.assertFalse(process_is_owned_by_frontmost(901, frontmost, rows))

    @patch("app.tracker.macos_audio_activity.sys.platform", "darwin")
    def test_reports_frontmost_owned_output(self) -> None:
        sample = foreground_audio_sample(
            run_command=runner_for(
                process_rows="9287 397 /Applications/Google Chrome.app/Contents/Helpers/Chrome Helper"
            ),
            reader_factory=lambda: FakeReader({9287}),
        )

        self.assertEqual(
            sample,
            ForegroundAudioSample(True, True, "active_output_owned_by_frontmost"),
        )

    @patch("app.tracker.macos_audio_activity.sys.platform", "darwin")
    def test_exact_frontmost_output_does_not_need_process_table(self) -> None:
        commands: list[list[str]] = []

        def run(command: list[str]) -> str:
            commands.append(command)
            return runner_for()(command)

        sample = foreground_audio_sample(
            run_command=run,
            reader_factory=lambda: FakeReader({397}),
        )

        self.assertEqual(sample, ForegroundAudioSample(True, True, "active_output_owned_by_frontmost"))
        self.assertNotIn([PS_PATH, "-axo", "pid=,ppid=,command="], commands)

    @patch("app.tracker.macos_audio_activity.sys.platform", "darwin")
    def test_coalition_owned_output_does_not_need_process_table(self) -> None:
        commands: list[list[str]] = []

        def run(command: list[str]) -> str:
            commands.append(command)
            return runner_for()(command)

        sample = foreground_audio_sample(
            run_command=run,
            reader_factory=lambda: FakeReader({9287}),
        )

        self.assertEqual(sample, ForegroundAudioSample(True, True, "active_output_owned_by_frontmost"))
        self.assertNotIn([PS_PATH, "-axo", "pid=,ppid=,command="], commands)

    @patch("app.tracker.macos_audio_activity.sys.platform", "darwin")
    def test_process_table_failure_makes_child_ownership_unavailable(self) -> None:
        def run(command: list[str]) -> str:
            if command == [PS_PATH, "-axo", "pid=,ppid=,command="]:
                raise RuntimeError("ps unavailable")
            return runner_for()(command)

        sample = foreground_audio_sample(
            run_command=run,
            reader_factory=lambda: FakeReader({9999}),
        )

        self.assertEqual(sample, ForegroundAudioSample(False, False, "process_ownership_unavailable"))

    @patch("app.tracker.macos_audio_activity.sys.platform", "darwin")
    def test_fails_closed_when_coreaudio_reader_is_unavailable(self) -> None:
        sample = foreground_audio_sample(
            run_command=runner_for(),
            reader_factory=lambda: None,
        )

        self.assertEqual(sample, ForegroundAudioSample(False, False, "coreaudio_unavailable"))

    @patch("app.tracker.macos_audio_activity.sys.platform", "darwin")
    def test_fails_closed_when_coreaudio_resets_during_read(self) -> None:
        sample = foreground_audio_sample(
            run_command=runner_for(),
            reader_factory=FailingReader,
        )

        self.assertEqual(sample, ForegroundAudioSample(False, False, "coreaudio_unavailable"))

    @patch("app.tracker.macos_audio_activity.sys.platform", "darwin")
    def test_coreaudio_timeout_fails_closed_without_accumulating_workers(self) -> None:
        started = threading.Event()
        release = threading.Event()
        second_reader_calls = 0

        class CountingReader:
            def running_output_process_ids(self) -> frozenset[int]:
                nonlocal second_reader_calls
                second_reader_calls += 1
                return frozenset({397})

        with patch.object(macos_audio_activity, "_CORE_AUDIO_PROBE_LOCK", threading.Lock()):
            timed_out = foreground_audio_sample(
                run_command=runner_for(),
                reader_factory=lambda: BlockingReader(started, release),
                audio_probe_timeout_seconds=0.01,
            )
            self.assertTrue(started.wait(5))

            while_stuck = foreground_audio_sample(
                run_command=runner_for(),
                reader_factory=CountingReader,
                audio_probe_timeout_seconds=0.01,
            )
            release.set()

        self.assertEqual(timed_out, ForegroundAudioSample(False, False, "coreaudio_unavailable"))
        self.assertEqual(while_stuck, ForegroundAudioSample(False, False, "coreaudio_unavailable"))
        self.assertEqual(second_reader_calls, 0)

    @patch("app.tracker.macos_audio_activity.sys.platform", "darwin")
    def test_helper_commands_share_one_sample_deadline(self) -> None:
        clock = [0.0]
        commands: list[list[str]] = []

        def slow_command(command: list[str]) -> str:
            commands.append(command)
            clock[0] += 2.1
            if command == [LSAPPINFO_PATH, "front"]:
                return "[ ASN:0x0-0x123 ]"
            return FRONT_INFO

        with patch.object(
            macos_audio_activity.time,
            "monotonic",
            side_effect=lambda: clock[0],
        ):
            sample = foreground_audio_sample(
                run_command=slow_command,
                reader_factory=lambda: FakeReader({397}),
                sample_timeout_seconds=4.0,
            )

        self.assertEqual(sample, ForegroundAudioSample(False, False, "frontmost_process_unavailable"))
        self.assertEqual(len(commands), 2)

    @patch("app.tracker.macos_audio_activity.sys.platform", "darwin")
    def test_fails_closed_when_frontmost_lookup_fails(self) -> None:
        def failing_command(_: list[str]) -> str:
            raise RuntimeError("lsappinfo unavailable")

        sample = foreground_audio_sample(
            run_command=failing_command,
            reader_factory=lambda: FakeReader({397}),
        )

        self.assertEqual(sample, ForegroundAudioSample(False, False, "frontmost_process_unavailable"))

    @patch("app.tracker.macos_audio_activity.sys.platform", "linux")
    def test_non_macos_does_not_run_frontmost_commands(self) -> None:
        def unexpected(_: list[str]) -> str:
            raise AssertionError("frontmost command should not run")

        sample = foreground_audio_sample(run_command=unexpected)

        self.assertEqual(sample, ForegroundAudioSample(False, False, "coreaudio_unavailable"))


if __name__ == "__main__":
    unittest.main()
