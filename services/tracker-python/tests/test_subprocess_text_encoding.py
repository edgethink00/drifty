from __future__ import annotations

import ast
import unittest
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "app"
TEXT_MODE_KEYWORDS = {"text", "universal_newlines"}


class SubprocessTextEncodingTests(unittest.TestCase):
    """Text-mode child output must name its encoding.

    Without `encoding=`, Python decodes with the locale code page. Korean
    Windows uses cp949, so UTF-8 output from git or ssh failed in the pipe
    reader thread and the command's output was lost (DRIFTY-MAC-NATIVE-11).
    """

    def test_every_text_mode_call_sets_an_encoding(self) -> None:
        offenders: list[str] = []
        for path in sorted(APP_DIR.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                keywords = {keyword.arg: keyword.value for keyword in node.keywords if keyword.arg}
                text_mode = any(
                    isinstance(keywords.get(name), ast.Constant) and keywords[name].value is True
                    for name in TEXT_MODE_KEYWORDS
                )
                if text_mode and "encoding" not in keywords:
                    offenders.append(f"{path.relative_to(APP_DIR.parent)}:{node.lineno}")
        self.assertEqual(offenders, [], "text-mode subprocess calls need encoding=: " + ", ".join(offenders))


if __name__ == "__main__":
    unittest.main()
