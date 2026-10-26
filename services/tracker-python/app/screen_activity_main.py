"""Small dedicated onedir activity helper. No tracker, capture or telemetry.

Native resource resolution supplies both the existing tracker DB and the
producer executable. The WebView cannot select these paths. Keeping this
runtime in a stable directory avoids a new onefile extraction per preparation.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main(arguments: list[str]) -> int:
    if not arguments:
        return 2
    if arguments[0] == "screen-context-activity-reader-v2":
        from app.storage.screen_activity_reader import main as read
        return read(arguments[1:])
    if (arguments[0] == "screen-context-activity-prepare-v1"
            and len(arguments) == 5 and arguments[1] == "--db"
            and arguments[3] == "--producer-runtime"):
        from app.storage.screen_activity_prepare import main as prepare
        return prepare(arguments[1:3], producer_runtime=Path(arguments[4]))
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
