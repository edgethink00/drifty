"""Keep text that the OS handed back as UTF-16 storable as UTF-8.

Win32 APIs return UTF-16. A fixed-size buffer (`GetWindowTextW` with a length
cap, for example) can cut an emoji between its two surrogate halves, and Python
keeps the lone half as an unpaired surrogate code point. SQLite then refuses the
whole row with "surrogates not allowed", so one truncated title loses the
activity sample. Replacing only the unpaired half keeps the rest of the text.
"""

from __future__ import annotations

import re
from dataclasses import fields, is_dataclass, replace
from typing import TypeVar

_SURROGATE = re.compile("[\ud800-\udfff]")

T = TypeVar("T")


def replace_lone_surrogates(value: str) -> str:
    """Replace unpaired UTF-16 surrogates with U+FFFD; valid pairs become characters."""
    if _SURROGATE.search(value) is None:
        return value
    return value.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "replace")


def without_lone_surrogates(value: T) -> T:
    """Return a dataclass copy whose top-level string fields are storable."""
    if not is_dataclass(value) or isinstance(value, type):
        return value
    changes = {}
    for field in fields(value):
        if not field.init:
            continue
        current = getattr(value, field.name)
        if isinstance(current, str) and _SURROGATE.search(current) is not None:
            changes[field.name] = replace_lone_surrogates(current)
    return replace(value, **changes) if changes else value
