from __future__ import annotations

import platform
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass(frozen=True)
class PowerStateSample:
    observed_at: datetime
    should_capture: bool
    reason: str
    metadata: dict[str, str] = field(default_factory=dict)


NON_USER_VISIBLE_WAKE_TYPES = {
    "dark",
    "darkwake",
    "maintenance",
    "maintenancewake",
    "sleepservice",
    "sleepservicewake",
}


def current_power_state() -> PowerStateSample:
    observed_at = datetime.now(timezone.utc)
    if platform.system() != "Darwin":
        return PowerStateSample(
            observed_at=observed_at,
            should_capture=True,
            reason="non_darwin_power_state_unavailable",
        )

    try:
        result = subprocess.run(
            ["ioreg", "-r", "-n", "IOPMrootDomain", "-d", "1"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return PowerStateSample(
            observed_at=observed_at,
            should_capture=True,
            reason="power_state_probe_failed",
            metadata={"error": type(exc).__name__},
        )

    if result.returncode != 0:
        return PowerStateSample(
            observed_at=observed_at,
            should_capture=True,
            reason="power_state_probe_unavailable",
            metadata={"returncode": str(result.returncode)},
        )

    return evaluate_ioreg_power_state(result.stdout, observed_at=observed_at)


def evaluate_ioreg_power_state(output: str, observed_at: datetime | None = None) -> PowerStateSample:
    metadata = parse_ioreg_root_domain(output)
    sample_time = observed_at or datetime.now(timezone.utc)
    if not metadata:
        return PowerStateSample(
            observed_at=sample_time,
            should_capture=True,
            reason="power_state_unknown",
        )

    wake_type = _normalized(
        metadata.get("Wake Type")
        or metadata.get("WakeType")
        or metadata.get("IOPMRootDomainWakeType")
    )
    if wake_type in NON_USER_VISIBLE_WAKE_TYPES:
        return PowerStateSample(
            observed_at=sample_time,
            should_capture=False,
            reason=f"non_user_visible_wake_type:{wake_type}",
            metadata=metadata,
        )

    # A visible user session can remain active with the lid closed in external-display mode.
    user_is_active = _normalized(metadata.get("IOPMUserIsActive")) == "yes"
    if user_is_active:
        return PowerStateSample(
            observed_at=sample_time,
            should_capture=True,
            reason="active_power_state",
            metadata=metadata,
        )

    clamshell_closed = _normalized(metadata.get("AppleClamshellState")) == "yes"
    clamshell_causes_sleep = _normalized(metadata.get("AppleClamshellCausesSleep")) == "yes"
    if clamshell_closed and clamshell_causes_sleep:
        return PowerStateSample(
            observed_at=sample_time,
            should_capture=False,
            reason="clamshell_sleep_state",
            metadata=metadata,
        )

    return PowerStateSample(
        observed_at=sample_time,
        should_capture=True,
        reason="active_power_state",
        metadata=metadata,
    )


def parse_ioreg_root_domain(output: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in output.splitlines():
        line = raw_line.strip()
        quote_index = line.find('"')
        if quote_index == -1:
            continue
        line = line[quote_index:]
        if not line.startswith('"') or '" =' not in line:
            continue
        key, raw_value = line.split("=", 1)
        values[key.strip().strip('"')] = raw_value.strip().strip('"')
    return values


def _normalized(value: str | None) -> str:
    return "" if value is None else value.replace(" ", "").lower()
