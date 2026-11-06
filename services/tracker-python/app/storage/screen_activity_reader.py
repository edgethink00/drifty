"""Isolated native-only read-only activity reference pipe, no tracker/telemetry.

The native parent owns a fixed runtime and absolute DB path. Requests cannot
select another path or return raw activity fields. Equality digests grant no
capture/account authority; those checks remain in the parent. Parent deadlines
and process ownership bound blocking pipe reads/writes, including on Windows.
"""
from __future__ import annotations

import json
import os
import struct
import sys
import uuid
from pathlib import Path
from typing import BinaryIO

from app.storage.screen_activity_binding import (
    CapturedWindowHint, LocalActivityRecord, _bounded_string, _record_id,
    read_local_record_refs, resolve_capture_record,
)

MAX_REQUEST_BYTES = 2048
MAX_RESPONSE_BYTES = 16 * 1024
MAX_JOBS = 64
READY = b"SBR2"
END = b"SBE2"


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("reader_request")
        result[key] = value
    return result


def _invalid_constant(_):
    raise ValueError("reader_request")


def _record_wire(value: LocalActivityRecord) -> dict:
    if value.proof_version != 1:
        raise ValueError("reader_request")
    result = {"recordId": value.record_id, "segmentUid": value.segment_uid,
            "identityDigest": value.identity_digest, "startedAtMs": value.started_at_ms,
            "endedAtMs": value.ended_at_ms}
    if value.revoked_ranges:
        result["revokedRanges"] = value.revoked_ranges
    return result


def dispatch(path: Path, raw: bytes) -> tuple[str, list[dict]]:
    """Strict private wire; malformed input terminates rather than echoing it."""
    request = json.loads(raw.decode("utf-8"), object_pairs_hook=_object, parse_constant=_invalid_constant)
    if (not isinstance(request, dict)
            or set(request) != {"protocolVersion", "requestId", "operation"}
            or type(request["protocolVersion"]) is not int or request["protocolVersion"] != 2):
        raise ValueError("reader_request")
    request_id = request["requestId"]
    if not isinstance(request_id, str) or len(request_id) != 36:
        raise ValueError("reader_request")
    parsed_id = uuid.UUID(request_id)
    if parsed_id.int == 0 or str(parsed_id) != request_id:
        raise ValueError("reader_request")
    operation = request["operation"]
    if not isinstance(operation, dict):
        raise ValueError("reader_request")
    if operation.get("kind") == "resolve":
        if (set(operation) != {"kind", "appKey", "titleDigest", "observedAtMs"}
                or not _bounded_string(operation["appKey"], 256)
                or type(operation["observedAtMs"]) is not int
                or not isinstance(operation["titleDigest"], str)
                or len(operation["titleDigest"]) != 64
                or any(c not in "0123456789abcdef" for c in operation["titleDigest"])):
            raise ValueError("reader_request")
        record = resolve_capture_record(path, CapturedWindowHint(
            operation["appKey"], operation["titleDigest"], operation["observedAtMs"]), require_fence=True)
        return request_id, [] if record is None else [_record_wire(record)]
    if operation.get("kind") in {"read", "read_replay"}:
        ids = operation.get("recordIds")
        if (set(operation) != {"kind", "recordIds"} or not isinstance(ids, list)
                or not 1 <= len(ids) <= 64 or any(not _record_id(v) for v in ids)
                or len(set(ids)) != len(ids)):
            raise ValueError("reader_request")
        return request_id, [_record_wire(v) for v in read_local_record_refs(path, ids, require_fence=True, replay=operation["kind"] == "read_replay")]
    raise ValueError("reader_request")


def _exact(stream: BinaryIO, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        part = stream.read(size - len(data))
        if not part:
            raise EOFError()
        data.extend(part)
    return bytes(data)


def run(path: Path, incoming: BinaryIO, write) -> int:
    try:
        write(READY)
        for _ in range(MAX_JOBS):
            size = struct.unpack(">I", _exact(incoming, 4))[0]
            if not 0 < size <= MAX_REQUEST_BYTES:
                return 2
            request_id, records = dispatch(path, _exact(incoming, size))
            encoded = json.dumps({"protocolVersion": 2, "proofVersion": 1, "requestId": request_id,
                                  "records": records}, ensure_ascii=False,
                                 separators=(",", ":")).encode("utf-8")
            if len(encoded) > MAX_RESPONSE_BYTES:
                return 2
            write(struct.pack(">I", len(encoded)) + encoded + END + request_id.encode("ascii"))
        return 0
    except EOFError:
        return 0
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError, OverflowError):
        # No exception text, path, request locals or generic tracker reporter.
        return 2


def main(arguments: list[str]) -> int:
    if len(arguments) != 2 or arguments[0] != "--db":
        return 2
    path = Path(arguments[1])
    if not path.is_absolute():
        return 2
    if sys.platform == "win32":
        import msvcrt
        msvcrt.setmode(0, os.O_BINARY)
        msvcrt.setmode(1, os.O_BINARY)

    def write(data):
        # Raw writes have no interpreter exit-time text/buffer flush that can
        # echo an exception when the owning parent closes its response pipe.
        while data:
            used = os.write(1, data)
            if used <= 0:
                raise BrokenPipeError()
            data = data[used:]

    return run(path, sys.stdin.buffer, write)
