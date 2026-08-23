from __future__ import annotations

import unittest

from app.tracker.engagement_policy import decide_engagement


def decide(
    idle_seconds: float | None,
    *,
    audio: bool = False,
    grace: bool = False,
    latest: str | None = None,
):
    return decide_engagement(
        idle_seconds=idle_seconds,
        audio_supported=audio,
        audio_grace_active=grace,
        latest_engagement_evidence=latest,
        interactive_threshold_seconds=180,
        passive_lease_seconds=1800,
    )


class EngagementPolicyTests(unittest.TestCase):
    def test_direct_input_is_interactive(self) -> None:
        self.assertEqual(decide(179.999).kind, "capture_interactive")

    def test_foreground_audio_supports_idle_work_inside_fixed_lease(self) -> None:
        self.assertEqual(decide(180, audio=True).kind, "capture_passive")
        self.assertEqual(decide(1799.999, audio=True).kind, "capture_passive")

    def test_audio_cannot_renew_expired_lease(self) -> None:
        self.assertEqual(
            decide(1800, audio=True, latest="foreground-audio").kind,
            "stop_and_keep_recorded",
        )

    def test_uncertain_idle_trims_only_when_no_passive_time_was_recorded(self) -> None:
        self.assertEqual(decide(180).kind, "stop_and_trim_to_input")
        self.assertEqual(
            decide(600, latest="foreground-audio").kind,
            "stop_and_keep_recorded",
        )

    def test_audio_gap_grace_requires_an_existing_passive_segment(self) -> None:
        self.assertEqual(decide(600, grace=True).kind, "stop_and_trim_to_input")
        self.assertEqual(
            decide(600, grace=True, latest="foreground-audio").kind,
            "capture_passive",
        )

    def test_missing_idle_signal_preserves_existing_capture_behavior(self) -> None:
        self.assertEqual(decide(None).kind, "capture_interactive")


if __name__ == "__main__":
    unittest.main()
