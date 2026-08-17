from __future__ import annotations

import unittest

from app.tracker.windows_idle import (
    idle_seconds_from_ticks,
    is_sleep_gap,
)

_UINT32 = 1 << 32


class IdleTickArithmeticTests(unittest.TestCase):
    def test_simple_elapsed(self) -> None:
        self.assertAlmostEqual(idle_seconds_from_ticks(1_000, 6_000), 5.0)

    def test_zero_when_input_just_happened(self) -> None:
        self.assertEqual(idle_seconds_from_ticks(500_000, 500_000), 0.0)

    def test_wraparound_is_handled(self) -> None:
        """W4-G4: last input just before the 32-bit rollover, now just after."""
        last_input = _UINT32 - 2_000  # 2s before rollover
        current = 3_000  # 3s after rollover
        self.assertAlmostEqual(idle_seconds_from_ticks(last_input, current), 5.0)

    def test_naive_subtraction_would_be_wrong(self) -> None:
        """Guards the reason the modulo exists at all."""
        last_input = _UINT32 - 2_000
        current = 3_000
        naive = (current - last_input) / 1000.0
        self.assertLess(naive, 0)
        self.assertGreater(idle_seconds_from_ticks(last_input, current), 0)

    def test_64bit_current_tick_uses_low_word(self) -> None:
        """GetTickCount64 keeps counting past 2^32; only the low word compares."""
        last_input = 10_000
        current = (5 * _UINT32) + 15_000
        self.assertAlmostEqual(idle_seconds_from_ticks(last_input, current), 5.0)


class SleepGapTests(unittest.TestCase):
    def test_normal_interval_is_not_a_gap(self) -> None:
        self.assertFalse(is_sleep_gap(elapsed_wall_seconds=5.4, expected_interval_seconds=5))

    def test_large_jump_is_a_gap(self) -> None:
        self.assertTrue(is_sleep_gap(elapsed_wall_seconds=1800, expected_interval_seconds=5))

    def test_boundary_is_exclusive(self) -> None:
        self.assertFalse(is_sleep_gap(elapsed_wall_seconds=10, expected_interval_seconds=5))
        self.assertTrue(is_sleep_gap(elapsed_wall_seconds=10.1, expected_interval_seconds=5))

    def test_zero_interval_never_reports_gap(self) -> None:
        self.assertFalse(is_sleep_gap(elapsed_wall_seconds=999, expected_interval_seconds=0))


if __name__ == "__main__":
    unittest.main()
