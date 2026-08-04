import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.tracker.macos_frontmost import frontmost_via_system_events


class MacosFrontmostScriptTests(unittest.TestCase):
    def test_frontmost_script_recovers_aside_main_title_from_exact_synthetic_window_shape(self) -> None:
        run_osascript = Mock(return_value="Aside\ncom.example.aside\nRecovered title")

        result = frontmost_via_system_events(run_osascript)

        self.assertEqual(result, ("Aside", "com.example.aside", "Recovered title"))
        script = run_osascript.call_args.args[0]
        self.assertIn('if appName is "Aside" and windowTitle is ""', script)
        self.assertIn('frontSubrole is "AXUnknown" and frontChildCount is 0', script)
        self.assertIn('first window whose value of attribute "AXMain" is true', script)
        self.assertIn('first window whose subrole is "AXStandardWindow"', script)
        self.assertLess(
            script.index('first window whose value of attribute "AXMain" is true'),
            script.index('first window whose subrole is "AXStandardWindow"'),
        )

    def test_frontmost_parser_still_preserves_empty_window_titles(self) -> None:
        run_osascript = Mock(return_value="Google Chrome\ncom.google.Chrome\n")

        result = frontmost_via_system_events(run_osascript)

        self.assertEqual(result, ("Google Chrome", "com.google.Chrome", None))


if __name__ == "__main__":
    unittest.main()
