from __future__ import annotations

import json
import subprocess
import sys
import unittest
from unittest.mock import patch

from app.browser_context_main import main
from app.tracker.browser_content import EXTENSION_ORIGIN


class BrowserContextEntryTests(unittest.TestCase):
    def test_only_the_exact_native_origin_reaches_the_host(self):
        for args in (["host"], ["host", "--help"], ["host", "chrome-extension://other/"], ["host", EXTENSION_ORIGIN, "extra"]):
            with self.subTest(args=args), patch("sys.argv", args), patch("app.tracker.browser_content_host.run_native_host") as host:
                self.assertEqual(main(), 1)
                host.assert_not_called()
        with patch("sys.argv", ["host", EXTENSION_ORIGIN]), patch("app.tracker.browser_content_host.run_native_host", return_value=7) as host:
            self.assertEqual(main(), 7)
            host.assert_called_once_with(EXTENSION_ORIGIN)

    def test_clean_entry_import_does_not_initialize_tracker_or_telemetry(self):
        script = "import json,sys; from app.browser_context_main import main; sys.argv=['host','invalid-origin']; status=main(); print(json.dumps({'status':status,'unexpected':[n for n in sys.modules if n in ('app.main','app.storage.db','app.sentry_setup','sentry_sdk')]}))"
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=True, timeout=10)
        self.assertEqual(json.loads(result.stdout), {"status": 1, "unexpected": []})
