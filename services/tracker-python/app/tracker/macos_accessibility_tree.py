"""Ask a Firefox-family browser for its accessibility tree without changing it.

Firefox-family browsers build no accessibility tree
for a user's own profile until an assistive client asks for one. Until then
System Events sees only the window's title-bar buttons, the address-bar read
fails, and capture falls back to the browser-history title. Measured on macOS
26.6.2 with Firefox 157, Developer Edition 158, Zen 1.23.2b and Floorp 12.20.1
(2026-10-11): reading the window's children or attribute names left the tree
asleep, while one read of the application's own `AXRole` built it at once and
System Events then found the address field. This reads that attribute only;
unlike Pet Mode's close adapter it never sets `AXEnhancedUserInterface`.
LibreWolf 157.0.1 and Waterfox 6.7.5 use the same read-only request (2026-10-13).
"""

from __future__ import annotations

import ctypes
import sys
from functools import lru_cache
from typing import Final

__all__ = ["FIREFOX_FAMILY_BUNDLES", "request_accessibility_tree"]

# Bundle identifiers are matched exactly; Floorp's carries a capital letter.
FIREFOX_FAMILY_BUNDLES: Final = frozenset({
    "org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition", "app.zen-browser.zen", "app.floorp.Floorp",
    "net.librewolf.librewolf", "net.waterfox.waterfox",
})
_K_CF_STRING_ENCODING_UTF8: Final = 0x08000100
_MAX_PID: Final = 0x7FFFFFFF  # Darwin pid_t is signed int32_t.


@lru_cache(maxsize=1)
def _frameworks() -> tuple[ctypes.CDLL, ctypes.CDLL]:
    ax = ctypes.CDLL("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")
    cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    ax.AXUIElementCreateApplication.restype = ctypes.c_void_p
    ax.AXUIElementCreateApplication.argtypes = [ctypes.c_int32]
    ax.AXUIElementSetMessagingTimeout.restype = ctypes.c_int32
    ax.AXUIElementSetMessagingTimeout.argtypes = [ctypes.c_void_p, ctypes.c_float]
    ax.AXUIElementCopyAttributeValue.restype = ctypes.c_int32
    ax.AXUIElementCopyAttributeValue.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    cf.CFStringCreateWithCString.restype = ctypes.c_void_p
    cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    cf.CFRelease.restype = None
    cf.CFRelease.argtypes = [ctypes.c_void_p]
    return ax, cf


def request_accessibility_tree(pid: object, timeout: float = 0.2) -> bool:
    """Read the application's role once; True when the browser answered."""
    if sys.platform != "darwin" or not isinstance(pid, int) or isinstance(pid, bool) or not 0 < pid <= _MAX_PID:
        return False
    try:
        ax, cf = _frameworks()
    except (OSError, AttributeError):
        return False
    application = ax.AXUIElementCreateApplication(pid)
    if not application:
        return False
    attribute = cf.CFStringCreateWithCString(None, b"AXRole", _K_CF_STRING_ENCODING_UTF8)
    value = ctypes.c_void_p()
    try:
        if not attribute:
            return False
        ax.AXUIElementSetMessagingTimeout(application, timeout)
        return ax.AXUIElementCopyAttributeValue(application, attribute, ctypes.byref(value)) == 0
    finally:
        if value.value:
            cf.CFRelease(value)
        if attribute:
            cf.CFRelease(attribute)
        cf.CFRelease(application)
