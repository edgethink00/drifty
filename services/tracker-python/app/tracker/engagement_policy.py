from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


FOREGROUND_AUDIO_EVIDENCE = "foreground-audio"
EngagementDecisionKind = Literal[
    "capture_interactive",
    "capture_passive",
    "stop_and_trim_to_input",
    "stop_and_keep_recorded",
]


@dataclass(frozen=True)
class EngagementDecision:
    kind: EngagementDecisionKind

    @property
    def should_capture(self) -> bool:
        return self.kind in {"capture_interactive", "capture_passive"}

    @property
    def is_passive(self) -> bool:
        return self.kind == "capture_passive"


def decide_engagement(
    *,
    idle_seconds: float | None,
    audio_supported: bool,
    audio_grace_active: bool,
    latest_engagement_evidence: str | None,
    interactive_threshold_seconds: int,
    passive_lease_seconds: int,
) -> EngagementDecision:
    """Return the capture action without mutating time or tracker state.

    Direct input is the only lease anchor. Foreground audio can support capture
    inside that fixed lease, but it can never renew the lease. Once a passive
    segment has been recorded, later uncertainty stops at the latest recorded
    sample rather than erasing the supported time back to the last input.
    """

    if idle_seconds is None or idle_seconds < interactive_threshold_seconds:
        return EngagementDecision("capture_interactive")

    latest_is_passive = latest_engagement_evidence == FOREGROUND_AUDIO_EVIDENCE
    if idle_seconds >= passive_lease_seconds:
        return EngagementDecision(
            "stop_and_keep_recorded" if latest_is_passive else "stop_and_trim_to_input"
        )

    if audio_supported or (audio_grace_active and latest_is_passive):
        return EngagementDecision("capture_passive")

    return EngagementDecision(
        "stop_and_keep_recorded" if latest_is_passive else "stop_and_trim_to_input"
    )
