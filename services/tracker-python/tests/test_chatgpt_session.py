import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.chatgpt_session import (
    apply_native_chatgpt_session_title,
    packaged_helper_path,
    parse_helper_output,
)


HELPER = chr(10).join(['ok=1', 'project=drifty_mac', 'thread=앱 버튼 UI 일관성 진단', ''])
HELPER_PATH = Path('/tmp/chatgpt-session-ax')


class ChatGPTSessionTests(unittest.TestCase):
    def test_parse_helper_output_reads_codex_header_slots(self) -> None:
        context = parse_helper_output(HELPER)
        self.assertIsNotNone(context)
        assert context is not None
        self.assertEqual(context.project, 'drifty_mac')
        self.assertEqual(context.thread, '앱 버튼 UI 일관성 진단')
        self.assertEqual(context.window_title, '앱 버튼 UI 일관성 진단 - drifty_mac')

    def test_parse_helper_output_rejects_missing_thread_and_tab_close_labels(self) -> None:
        self.assertIsNone(parse_helper_output(chr(10).join(['ok=1', 'project=drifty_mac', 'thread=', ''])))
        self.assertIsNone(parse_helper_output('ok=0'))
        leaked = parse_helper_output(chr(10).join(['ok=1', 'project=drifty_mac', 'thread=#private | workspace - Discord', '']))
        self.assertIsNone(leaked)
        tab = parse_helper_output(chr(10).join(['ok=1', 'thread=REAL-before-after.html REAL-before-after.html 탭 닫기', '']))
        self.assertIsNone(tab)

    def test_generic_native_title_is_replaced_and_specific_titles_are_kept(self) -> None:
        run_command = Mock(return_value=HELPER)
        replaced = apply_native_chatgpt_session_title('ChatGPT', 'com.openai.codex', 'ChatGPT', 97939, run_command, helper_path=HELPER_PATH)
        self.assertEqual(replaced, '앱 버튼 UI 일관성 진단 - drifty_mac')
        run_command.assert_called_once()
        kept = apply_native_chatgpt_session_title('ChatGPT', 'com.openai.codex', 'Computer Use Controls', 97939, run_command, helper_path=HELPER_PATH)
        self.assertEqual(kept, 'Computer Use Controls')

    def test_helper_failures_keep_the_generic_title(self) -> None:
        run_command = Mock(side_effect=RuntimeError('osascript timed out'))
        title = apply_native_chatgpt_session_title('ChatGPT', 'com.openai.codex', 'ChatGPT', 97939, run_command, helper_path=HELPER_PATH)
        self.assertEqual(title, 'ChatGPT')

    def test_non_chatgpt_apps_are_not_inspected(self) -> None:
        run_command = Mock()
        title = apply_native_chatgpt_session_title('Safari', 'com.apple.Safari', 'ChatGPT', 12, run_command)
        self.assertEqual(title, 'ChatGPT')
        run_command.assert_not_called()

    def test_injected_helper_replaces_generic_title_on_windows(self) -> None:
        run_command = Mock(return_value=HELPER)
        with patch('app.tracker.chatgpt_session.sys.platform', 'win32'):
            replaced = apply_native_chatgpt_session_title(
                'ChatGPT',
                'com.openai.codex',
                'ChatGPT',
                97939,
                run_command,
                helper_path=HELPER_PATH,
            )
        self.assertEqual(replaced, '앱 버튼 UI 일관성 진단 - drifty_mac')
        run_command.assert_called_once()

    def test_windows_production_capture_keeps_generic_title(self) -> None:
        run_command = Mock(return_value=HELPER)
        with patch('app.tracker.chatgpt_session.sys.platform', 'win32'):
            title = apply_native_chatgpt_session_title(
                'ChatGPT',
                'com.openai.codex',
                'ChatGPT',
                97939,
                run_command,
            )
        self.assertEqual(title, 'ChatGPT')
        run_command.assert_not_called()

    def test_packaged_helper_is_discovered_beside_the_frozen_tracker(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            executable = Path(temp_dir) / 'drifty-tracker'
            helper = Path(temp_dir) / 'chatgpt-session-ax'
            helper.write_bytes(b'packaged helper')
            with patch('app.tracker.chatgpt_session.sys.executable', str(executable)):
                self.assertEqual(packaged_helper_path(), helper.resolve())
