import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))


class TrackerServeModeTests(unittest.TestCase):
    def test_serve_mode_matches_one_shot_responses_for_multiple_requests(self) -> None:
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            script_path = SERVICE_ROOT / "app" / "main.py"
            requests = [
                {"command": "get_classification_rules", "payload": {}},
                {"command": "get_timeline", "payload": {"day": "2026-04-06"}},
            ]

            expected = [
                self._run_one_shot(script_path, db_path, request)
                for request in requests
            ]

            serve_input = "".join(f"{json.dumps(request)}\n" for request in requests)
            completed = subprocess.run(
                [
                    sys.executable,
                    str(script_path),
                    "serve",
                    "--db",
                    str(db_path),
                ],
                input=serve_input,
                capture_output=True,
                check=False,
                text=True,
                timeout=5,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            observed = [
                json.loads(line)
                for line in completed.stdout.splitlines()
                if line.strip()
            ]
            self.assertEqual(observed, expected)

    def test_serve_mode_reports_errors_and_continues(self) -> None:
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "tracker.sqlite3"
            script_path = SERVICE_ROOT / "app" / "main.py"
            valid_request = {"command": "get_timeline", "payload": {"day": "2026-04-06"}}
            serve_input = "\n".join(
                [
                    "{not json",
                    json.dumps({"command": "__unknown_test_command__", "payload": {}}),
                    json.dumps(valid_request),
                    "",
                ]
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(script_path),
                    "serve",
                    "--db",
                    str(db_path),
                ],
                input=serve_input,
                capture_output=True,
                check=False,
                text=True,
                timeout=5,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            observed = [
                json.loads(line)
                for line in completed.stdout.splitlines()
                if line.strip()
            ]
            self.assertEqual(len(observed), 3)
            self.assertFalse(observed[0]["ok"])
            self.assertIn("Expecting property name", observed[0]["error"])
            self.assertFalse(observed[1]["ok"])
            self.assertIn("__unknown_test_command__", observed[1]["error"])
            self.assertEqual(observed[2], self._run_one_shot(script_path, db_path, valid_request))

    def _run_one_shot(self, script_path: Path, db_path: Path, request: dict) -> dict:
        completed = subprocess.run(
            [
                sys.executable,
                str(script_path),
                "--db",
                str(db_path),
                "--request-json",
                json.dumps(request),
            ],
            capture_output=True,
            check=False,
            text=True,
            timeout=5,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)


if __name__ == "__main__":
    unittest.main()
