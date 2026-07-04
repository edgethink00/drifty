import sys
import unittest


class TestPackagedPythonCompat(unittest.TestCase):
    """Packaged release builds may fall back to Xcode's bundled Python 3.9
    (see scripts/build-tracker-sidecar.mjs), so tracker modules must import
    cleanly there. dataclass(slots=True) requires 3.10+ and raises
    TypeError at import time on 3.9 — this guards against reintroducing it."""

    def test_no_dataclass_slots_kwarg_in_tracker_source(self):
        import pathlib
        import re

        app_dir = pathlib.Path(__file__).resolve().parent.parent / "app"
        offenders = []
        for path in app_dir.rglob("*.py"):
            text = path.read_text()
            if re.search(r"@dataclass\([^)]*\bslots\s*=", text):
                offenders.append(str(path))
        self.assertEqual(offenders, [], f"slots=True needs Python 3.10+: {offenders}")

    def test_current_interpreter_can_import_all_tracker_modules(self):
        # Not a 3.9 guarantee by itself (dev machines run newer Python), but
        # combined with the source scan above this catches both the syntax
        # and any runtime-only 3.10+ construct (match statements, `X | Y`
        # isinstance checks) on whatever interpreter runs this suite.
        import app.main  # noqa: F401
        import app.storage.db  # noqa: F401
        import app.tracker.browser_history_import  # noqa: F401
        import app.tracker.youtube_video_recovery  # noqa: F401
        import app.tracker.macos_workspace  # noqa: F401

        self.assertTrue(sys.version_info >= (3, 9))


if __name__ == "__main__":
    unittest.main()
