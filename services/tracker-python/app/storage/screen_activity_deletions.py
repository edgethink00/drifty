"""Transient native deletion receipts; no schema, screen content or telemetry.

The native caller invalidates screen reads/capture before requesting a receipt.
Only the existing activity deletion transaction selects its actual targets.
Normal requests install no collector and perform no additional SQL. An overflow
is explicit and must never be interpreted as a complete partial ID list.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Iterable

MAX_DELETED_RECORD_IDS = 262_144


@dataclass
class DeletionEffects:
    record_ids: set[str] = field(default_factory=set)
    overflow: bool = False

    def candidates(self, values: Iterable[int | str]) -> set[str] | None:
        result = set()
        for value in values:
            value = str(value)
            if (not value.isascii() or not value.isdecimal()
                    or value.startswith("0") or len(value) > 19
                    or int(value) > 9223372036854775807):
                continue  # Such IDs could never authorize a screen binding.
            result.add(value)
            if len(result) > MAX_DELETED_RECORD_IDS:
                self.overflow = True
                return None
        return result

    def deleted(self, candidates: set[str] | None, remaining: Iterable[int | str]) -> None:
        if candidates is None or self.overflow:
            self.overflow = True
            return
        for value in remaining:
            candidates.discard(str(value))
        if len(self.record_ids) + len(candidates - self.record_ids) > MAX_DELETED_RECORD_IDS:
            self.overflow = True
            self.record_ids.clear()
            return
        self.record_ids.update(candidates)

    def wire(self) -> dict:
        return {"version": 1, "recordIds": [] if self.overflow else sorted(self.record_ids, key=int),
                "overflow": self.overflow}


_CURRENT: ContextVar[DeletionEffects | None] = ContextVar("screen_activity_deletions", default=None)


def current_deletion_effects() -> DeletionEffects | None:
    return _CURRENT.get()


@contextmanager
def collect_deletion_effects():
    effects = DeletionEffects()
    token = _CURRENT.set(effects)
    try:
        yield effects
    finally:
        _CURRENT.reset(token)
