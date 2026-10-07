"""One anonymous HTTPS head lookup, inside the owning native sample's process group.

No cookies, authentication, proxy, browser storage or source cache. DNS addresses
are checked and pinned while TLS validates the original hostname. The owner kills
this disposable process on cancellation/deadline, including a blocked resolver.
"""
from __future__ import annotations

import codecs
import http.client
import ipaddress
import json
import math
import re
import socket
import ssl
import sys
import time
import zlib
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app.tracker.browser_description import FIELDS, HeadMetadata, MAX_SOURCE_BYTES


def target(url: str):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or len(url) > 4096):
        raise ValueError("Unsupported public URL")
    host = parsed.hostname.encode("idna").decode("ascii")
    return parsed, host


def public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    # is_global differs for multicast and IPv4-mapped IPv6 across Python versions.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        return public_address(str(ip.ipv4_mapped))
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.sixtofour and not public_address(str(ip.sixtofour)):
            return False
        if ip.teredo and not all(public_address(str(part)) for part in ip.teredo):
            return False
        if ip in ipaddress.ip_network("64:ff9b::/96"):
            return public_address(str(ipaddress.IPv4Address(int(ip) & 0xffffffff)))
        if ip in ipaddress.ip_network("64:ff9b:1::/48"):
            return False
    return ip.is_global and not ip.is_multicast and not ip.is_unspecified and not ip.is_loopback and not ip.is_reserved


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, address, timeout, context):
        super().__init__(host, timeout=timeout, context=context)
        self.address = address

    def connect(self):
        # Literal IP prevents a second hostname resolution; SNI/cert check keep host.
        sock = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def fetch_description(url: str, seconds: float, *, resolver=socket.getaddrinfo,
                      connection=PinnedHTTPSConnection, context=None, address_check=public_address):
    """Return one bounded D or None. Test transport injection is not a CLI option."""
    if not math.isfinite(seconds) or seconds <= 0:
        return None
    deadline = time.monotonic() + min(seconds, 0.62)
    try:
        parsed, original_host = target(url)
        tls = context or ssl.create_default_context()
        for _ in range(3):
            parsed, host = target(url)
            if host != original_host:
                return None
            addresses = resolver(host, 443, type=socket.SOCK_STREAM)
            if not addresses or not all(address_check(item[4][0]) for item in addresses):
                return None
            remaining = deadline-time.monotonic()
            if remaining <= 0:
                return None
            client = connection(host, addresses[0][4][0], remaining, tls)
            try:
                request_path = urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
                client.request("GET", request_path, headers={"User-Agent": "Drifty-Page-Context/1.0", "Accept": "text/html", "Accept-Encoding": "identity", "Connection": "close"})
                response = client.getresponse()
                if response.status in (301, 302, 303, 307, 308):
                    location = response.getheader("Location")
                    if not location:
                        return None
                    url = urljoin(url, location)
                    continue
                if response.status != 200 or not re.match(r"^text/html(?:;|$)", response.getheader("Content-Type", ""), re.I):
                    return None
                encoding = response.getheader("Content-Encoding", "identity").lower().strip()
                if encoding not in ("identity", "gzip"):
                    return None
                unzip = zlib.decompressobj(16+zlib.MAX_WBITS) if encoding == "gzip" else None
                charset = re.search(r'charset\s*=\s*["\']?([^;\s"\']+)', response.getheader("Content-Type", ""), re.I)
                decode = codecs.getincrementaldecoder(charset.group(1) if charset else "utf-8")(errors="strict")
                parser = HeadMetadata()
                received = decoded = 0
                while not parser.finished:
                    remaining = deadline-time.monotonic()
                    if remaining <= 0:
                        return None
                    if client.sock is not None:
                        client.sock.settimeout(remaining)
                    # read1 returns available head bytes without waiting for a full body.
                    part = response.read1(8192)
                    if not part:
                        return None  # Require a complete supported head, not partial metadata.
                    received += len(part)
                    if received > MAX_SOURCE_BYTES:
                        return None
                    plain = unzip.decompress(part, MAX_SOURCE_BYTES-decoded+1) if unzip else part
                    decoded += len(plain)
                    if decoded > MAX_SOURCE_BYTES:
                        return None
                    parser.feed(decode.decode(plain))
                if parser.unsupported or parser.in_head or parser.raw_tag or parser.template_depth or not parser.seen_head:
                    return None
                if time.monotonic() >= deadline:
                    return None
                return next((parser.values[field] for field in FIELDS if field in parser.values), None)
            finally:
                client.close()
    except (OSError, ValueError, UnicodeError, LookupError, http.client.HTTPException, zlib.error):
        return None
    return None


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    if len(arguments) != 2:
        print("null")
        return 0
    try:
        description = fetch_description(arguments[0], float(arguments[1])/1000)
    except (ValueError, OverflowError):
        description = None
    print(json.dumps({"description": description} if description else None, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
