"""Recovering a page title from a Windows browser window title.

macOS hands the tracker a window title shaped like ``"<page> - <browser>"``,
so ``browser_history`` matches a stored page title by exact-or-prefix compare.
Windows browsers do not honour that shape, and the differences are not
cosmetic:

* Edge appends the *profile* and inserts a localized "and N more pages"
  fragment between the page title and the suffixes. Measured on a Korean
  Windows 11 install::

      Rust Programming Language 외 페이지 1개 - 프로필 1 - Microsoft\u200b Edge

  Both inserted fragments are translated, so no fixed English suffix list can
  strip them, and "Microsoft Edge" itself contains a zero-width space.
* Chrome is closer to the macOS shape but abbreviates to ``" - Chrome"``.
* Firefox uses an em dash: ``"<page> — Mozilla Firefox"``.

Left unhandled, the history fallback silently degrades: the window title never
matches a stored page title, every lookup returns ``no_match``, and the result
is indistinguishable from a user who has no browsing history. That is the
quiet failure this module exists to prevent.

The strategy is deliberately conservative. Only structure that is certain is
removed — a trailing browser-name segment, and any trailing segments that
follow it backwards — and the *leading* segment is preserved untouched, since
a page title may legitimately contain " - ". When nothing can be stripped with
confidence the original string is returned unchanged, so a bad guess never
replaces a usable title.
"""

from __future__ import annotations

import re
from typing import Final

__all__ = ["strip_browser_window_decoration", "windows_page_title_candidates"]

# Zero-width characters Edge embeds in its own product name.
_ZERO_WIDTH: Final = re.compile(r"[\u200b\u200c\u200d\ufeff]")

# Browser identifiers as they appear in a window title, lowercased after
# zero-width removal. Matching is on the trailing segment only.
_BROWSER_SUFFIXES: Final[tuple[str, ...]] = (
    "microsoft edge",
    "google chrome",
    "chrome",
    "mozilla firefox",
    "firefox",
    "brave",
    "vivaldi",
    "opera",
    "chromium",
    "whale",
    "zen browser",
    "floorp",
)

# Segment separators used by the browsers above. Firefox uses an em dash,
# Chromium a hyphen; both may be surrounded by spaces.
_SEPARATOR: Final = re.compile(r"\s+[-\u2013\u2014]\s+")



def _clean(value: str) -> str:
    return _ZERO_WIDTH.sub("", value).strip()


def strip_browser_window_decoration(window_title: str | None) -> str:
    """Return the page-title portion of a browser window title.

    Returns the input unchanged (whitespace-trimmed) when no trailing browser
    name is recognised, because guessing would be worse than not stripping.
    """
    cleaned = _clean(window_title or "")
    if not cleaned:
        return ""

    # Split positions are tracked instead of the pieces themselves so the
    # surviving text keeps its original separators. Rejoining with a chosen
    # separator would rewrite an em dash inside a real page title.
    boundaries = [(m.start(), m.end()) for m in _SEPARATOR.finditer(cleaned)]
    if not boundaries:
        return cleaned

    last_start, _ = boundaries[-1]
    if cleaned[last_start:].strip(" -\u2013\u2014").lower() not in _BROWSER_SUFFIXES:
        return cleaned

    cut = last_start
    index = len(boundaries) - 2
    # Drop any profile segment Edge appended before the browser name. The
    # first segment is never dropped: it is the page title, and a title may
    # itself contain a separator.
    while index >= 0:
        start, end = boundaries[index]
        if not _is_chrome_profile_segment(cleaned[end:cut]):
            break
        cut = start
        index -= 1
    return cleaned[:cut].strip() or cleaned


def _is_chrome_profile_segment(segment: str) -> bool:
    """Whether a segment looks like a Chromium profile label.

    The word is localized ("프로필 1", "Profile 1", "Perfil 1"), so the test is
    structural: a short segment ending in a number, or a bare email address,
    which is how a signed-in profile is labelled.
    """
    candidate = segment.strip()
    if not candidate or len(candidate) > 40:
        return False
    if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", candidate):
        return True
    return bool(re.search(r"\d+$", candidate)) and len(candidate.split()) <= 3


def windows_page_title_candidates(window_title: str | None) -> list[str]:
    """Progressively stripped titles to try against stored history titles.

    Ordered most-specific first. The caller tries each in turn, so a lookup
    that would have failed on Edge's decorated title can still match on the
    bare page title without loosening the matcher itself.
    """
    cleaned = _clean(window_title or "")
    if not cleaned:
        return []

    candidates = [cleaned]
    stripped = strip_browser_window_decoration(cleaned)
    if stripped and stripped not in candidates:
        candidates.append(stripped)

    # Edge inserts a localized "and N more pages" fragment after the page
    # title when several tabs are open. The fragment is translated, so it is
    # identified by the digit it always carries rather than by its words: keep
    # the text before the last run that contains a number.
    trimmed = _strip_trailing_counted_fragment(stripped)
    if trimmed and trimmed not in candidates:
        candidates.append(trimmed)
    return candidates


def _strip_trailing_counted_fragment(title: str) -> str:
    """Remove a trailing "and N more pages"-style fragment, if present.

    Edge adds this when several tabs share a window, and the wording is
    translated, so it cannot be matched by keyword.

    Recovering the bare page title from a translated fragment is deliberately
    *not* attempted. It requires telling a function word apart from a real
    title word, and no generic rule can: "Language" in "Rust Programming
    Language 외 페이지 1개" reads exactly like the count phrase beside it. A
    wrong strip hands the matcher a truncated title, which can match a
    different history row with full confidence. Reporting no match is the
    safer failure.

    So only the English phrasing is stripped, where the boundary word makes
    the shape unambiguous. Other locales keep the decorated title and report
    an honest miss.
    """
    if not title:
        return ""
    tokens = title.split()
    if len(tokens) < 5:
        return title

    numbered = [index for index, token in enumerate(tokens) if re.search(r"\d", token)]
    if len(numbered) != 1:
        return title
    anchor = numbered[0]
    # A version-like number belongs to the title ("Python 3.14.7"), not a count.
    if re.search(r"\d[.\-/]\d", tokens[anchor]):
        return title
    if anchor != len(tokens) - 3:
        return title

    tail = [token.lower() for token in tokens[-4:]]
    if tail[0] == "and" and tail[2] == "more" and tail[3].startswith("page"):
        head = " ".join(tokens[:-4])
        if len(head) >= 8:
            return head.strip()
    return title
