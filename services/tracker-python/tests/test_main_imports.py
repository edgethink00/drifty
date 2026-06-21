from __future__ import annotations

import json
import subprocess
import sys
import unittest


class AppMainImportIsolationTests(unittest.TestCase):
    def test_import_app_main_keeps_tracker_dependencies_unloaded(self) -> None:
        script = "\n".join(
            (
                "import json",
                "import sys",
                "",
                "modules = (",
                '    "app.storage.live_tail",',
                '    "ssl",',
                '    "app.tracker.youtube_metadata",',
                '    "app.tracker.macos_workspace",',
                ")",
                "",
                "import app.main",
                "",
                "print(json.dumps({module: module in sys.modules for module in modules}, sort_keys=True))",
            )
        )

        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            check=False,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        loaded_modules = json.loads(result.stdout)
        self.assertEqual(
            {
                "app.storage.live_tail": False,
                "app.tracker.macos_workspace": False,
                "app.tracker.youtube_metadata": False,
                "ssl": False,
            },
            loaded_modules,
        )


if __name__ == "__main__":
    unittest.main()
