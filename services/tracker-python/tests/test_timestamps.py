from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.storage.timestamps import history_ends_after, parse_iso_datetime


UTC = timezone.utc


class ParseIsoDatetimeTests(unittest.TestCase):
    def test_accepts_postgres_trimmed_fractional_seconds(self) -> None:
        # PostgreSQL drops trailing zeros: 36.654940 is returned as 36.65494.
        self.assertEqual(
            parse_iso_datetime("2026-10-07T14:02:36.65494+00:00"),
            datetime(2026, 10, 7, 14, 2, 36, 654940, tzinfo=UTC),
        )

    def test_accepts_every_fraction_length(self) -> None:
        cases = {
            "2026-10-07T14:02:36.6+00:00": 600000,
            "2026-10-07T14:02:36.65+00:00": 650000,
            "2026-10-07T14:02:36.654+00:00": 654000,
            "2026-10-07T14:02:36.6549+00:00": 654900,
            "2026-10-07T14:02:36.654941+00:00": 654941,
            "2026-10-07T14:02:36.6549412+00:00": 654941,
        }
        for value, microsecond in cases.items():
            with self.subTest(value=value):
                self.assertEqual(parse_iso_datetime(value).microsecond, microsecond)

    def test_trimmed_fraction_with_z_suffix_and_offset_free_values(self) -> None:
        self.assertEqual(
            parse_iso_datetime("2026-10-07T14:02:36.65494Z"),
            datetime(2026, 10, 7, 14, 2, 36, 654940, tzinfo=UTC),
        )
        self.assertEqual(
            parse_iso_datetime("2026-10-07 14:02:36.5"),
            datetime(2026, 10, 7, 14, 2, 36, 500000),
        )

    def test_values_without_fraction_are_unchanged(self) -> None:
        self.assertEqual(
            parse_iso_datetime("2026-10-07T14:02:36+09:00"),
            datetime(2026, 10, 7, 14, 2, 36, tzinfo=timezone(timedelta(hours=9))),
        )

    def test_does_not_pad_a_fraction_with_an_invalid_suffix_into_a_parseable_value(self) -> None:
        for value in ("2026-07-29T10:59:59.65junkZ", "2026-07-29T10:59:59.65494junk+09:00"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_iso_datetime(value)

    def test_history_bound_compares_trimmed_fractions(self) -> None:
        self.assertTrue(history_ends_after("2026-10-07T14:02:36.65494+00:00", "2026-10-07T14:02:36.6+00:00"))
        self.assertFalse(history_ends_after("2026-10-07T14:02:36.5+00:00", "2026-10-07T14:02:36.65494+00:00"))


if __name__ == "__main__":
    unittest.main()
