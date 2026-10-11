from __future__ import annotations

import re
from ipaddress import IPv6Address
from typing import Final
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse

NOISE_QUERY_KEY_PREFIXES: Final[tuple[str, ...]] = ("utm_",)
NOISE_QUERY_KEYS: Final[frozenset[str]] = frozenset(
    {
        "access_token",
        "auth",
        "auth_token",
        "fbclid",
        "feature",
        "gclid",
        "igshid",
        "mc_cid",
        "mc_eid",
        "msclkid",
        "password",
        "ref",
        "ref_src",
        "refresh_token",
        "session",
        "session_id",
        "sessionid",
        "si",
        "sid",
        "source",
        "t",
        "token",
        "yclid",
    }
)


def _candidate_url(value: str) -> str | None:
    trimmed = value.strip()
    if not trimmed or any(character.isspace() for character in trimmed):
        return None
    if re.match(r"^[a-z][a-z0-9+.-]*://", trimmed, flags=re.IGNORECASE):
        return trimmed
    return f"https://{trimmed}"


def _canonical_host(hostname: str) -> str:
    host = hostname.lower().rstrip(".")
    while host.startswith("www."):
        host = host[4:]
    if ":" in host:
        return f"[{IPv6Address(host).compressed}]"
    return host


def _is_noise_query_key(key: str) -> bool:
    normalized = key.lower()
    return (
        normalized in NOISE_QUERY_KEYS
        or any(normalized.startswith(prefix) for prefix in NOISE_QUERY_KEY_PREFIXES)
        or "token" in normalized
        or "secret" in normalized
        or "session" in normalized
        or "password" in normalized
    )


def _cleaned_query(query: str) -> str:
    kept = sorted((key, value) for key, value in parse_qsl(query, keep_blank_values=True) if not _is_noise_query_key(key))
    return urlencode(kept)


def _canonical_path(path: str) -> str:
    return "" if path == "/" else path


def _build_canonical_url(scheme: str, host: str, port: int | None, path: str, query: str) -> str:
    netloc = f"{host}:{port}" if port is not None else host
    return urlunparse((scheme.lower(), netloc, _canonical_path(path), "", query, ""))


def _url_port(value: str) -> int | None:
    parsed = urlparse(value)
    try:
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme == "http" and port == 80:
        return None
    if parsed.scheme == "https" and port == 443:
        return None
    return port


def _youtube_video_id_from_path(path: str) -> str | None:
    parts = [part for part in path.split("/") if part]
    return parts[0] if parts else None


def _canonicalize_youtube_url(scheme: str, host: str, path: str, query: str) -> str | None:
    path_parts = [part for part in path.split("/") if part]
    if host == "youtu.be":
        video_id = _youtube_video_id_from_path(path)
        return f"https://youtube.com/watch?v={quote(video_id, safe='')}" if video_id else None

    if host not in {"youtube.com", "m.youtube.com"}:
        return None

    first_path_part = path_parts[0] if path_parts else ""
    # Match URLSearchParams.get() used when the desktop creates this rule.
    # Collapsing with dict() picks the last duplicate instead of the first.
    query_values: dict[str, str] = {}
    for key, value in parse_qsl(query, keep_blank_values=True):
        query_values.setdefault(key, value)
    if first_path_part == "watch":
        video_id = query_values.get("v", "").strip()
        return f"https://youtube.com/watch?v={quote(video_id, safe='')}" if video_id else None
    if first_path_part == "shorts":
        video_id = path_parts[1].strip() if len(path_parts) > 1 else ""
        return f"https://youtube.com/shorts/{quote(video_id, safe='')}" if video_id else None
    if first_path_part == "playlist":
        playlist_id = query_values.get("list", "").strip()
        return f"https://youtube.com/playlist?list={quote(playlist_id, safe='')}" if playlist_id else None

    return _build_canonical_url(scheme, "youtube.com", None, path, _cleaned_query(query))


def canonicalize_classification_rule_site_url(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = _candidate_url(value)
    if candidate is None:
        return None

    try:
        # urlparse itself rejects malformed bracketed hosts and invalid
        # authorities. One invalid captured URL must not abort a rules batch.
        parsed = urlparse(candidate)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return None
        parsed.port
        if parsed.netloc.rsplit("@", 1)[-1].startswith("["):
            # Python 3.9 accepts some malformed bracketed IPv6 authorities
            # that URL() on the desktop rejects.
            IPv6Address(parsed.hostname)
    except ValueError:
        return None

    host = _canonical_host(parsed.hostname)
    youtube_url = _canonicalize_youtube_url(parsed.scheme, host, parsed.path, parsed.query)
    if youtube_url is not None:
        return youtube_url

    return _build_canonical_url(parsed.scheme, host, _url_port(candidate), parsed.path, _cleaned_query(parsed.query))


def site_target_from_canonical_url(value: str) -> str | None:
    parsed = urlparse(value)
    return _canonical_host(parsed.hostname) if parsed.hostname else None
