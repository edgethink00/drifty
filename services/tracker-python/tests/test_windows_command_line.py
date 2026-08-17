"""Tests for Windows command-line splitting in daemon ownership checks.

Ownership is decided by comparing a running process's command line against the
tracker's own runtime path and ``--db`` value. Splitting that line with POSIX
rules destroys it: a backslash reads as an escape, so
``C:\\Users\\alex\\python.exe`` collapses to ``C:Usersalexpython.exe``, the
comparison fails, and the tracker refuses to stop a daemon it actually owns.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.main import _windows_command_arguments  # noqa: E402


class WindowsCommandLineSplitTests(unittest.TestCase):
    def test_unquoted_backslash_paths_survive(self) -> None:
        """The failure that made the tracker disown its own daemon."""
        command = "C:\\Users\\alex\\python.exe daemon --db C:\\data\\tracker.sqlite3"
        self.assertEqual(
            _windows_command_arguments(command),
            [
                "C:\\Users\\alex\\python.exe",
                "daemon",
                "--db",
                "C:\\data\\tracker.sqlite3",
            ],
        )

    def test_quoted_paths_with_spaces(self) -> None:
        command = '"C:\\Program Files\\App\\x.exe" daemon --db "C:\\a b\\t.sqlite3"'
        self.assertEqual(
            _windows_command_arguments(command),
            ["C:\\Program Files\\App\\x.exe", "daemon", "--db", "C:\\a b\\t.sqlite3"],
        )

    def test_embedded_quotes_use_backslash_escaping(self) -> None:
        command = 'a.exe --flag "value with \\"quote\\" inside"'
        self.assertEqual(
            _windows_command_arguments(command),
            ["a.exe", "--flag", 'value with "quote" inside'],
        )

    def test_trailing_backslashes_are_preserved(self) -> None:
        # A directory argument may legitimately end in a separator.
        self.assertEqual(
            _windows_command_arguments("a.exe C:\\dir\\"),
            ["a.exe", "C:\\dir\\"],
        )

    def test_doubled_backslashes_before_a_quote_are_halved(self) -> None:
        command = 'a.exe "C:\\dir\\\\" next'
        self.assertEqual(_windows_command_arguments(command), ["a.exe", "C:\\dir\\", "next"])

    def test_multiline_argument_from_an_inline_script(self) -> None:
        # Observed on the test host: a -c argument spanning a newline.
        command = 'python.exe -c "import time\nwhile True: pass" daemon'
        self.assertEqual(
            _windows_command_arguments(command),
            ["python.exe", "-c", "import time\nwhile True: pass", "daemon"],
        )

    def test_empty_command_is_empty(self) -> None:
        self.assertEqual(_windows_command_arguments(""), [])
        self.assertEqual(_windows_command_arguments("   "), [])

    def test_explicit_empty_quoted_argument_is_kept(self) -> None:
        self.assertEqual(_windows_command_arguments('a.exe "" b'), ["a.exe", "", "b"])


if __name__ == "__main__":
    unittest.main()

