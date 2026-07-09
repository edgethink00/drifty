from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict


class AdaptiveContextItemPayload(TypedDict):
    id: str
    depth: int
    kind: str
    sourceFamily: str
    values: list[str]
    extractionConfidence: str
    localStorage: str
    providerPolicy: str
    sensitivity: list[str]


class AdaptiveContentContextPayload(TypedDict):
    version: int
    segmentId: str
    collectedAt: str
    items: list[AdaptiveContextItemPayload]
    localStorage: str


class AdaptiveStructuredFields(TypedDict, total=False):
    workspace: list[str]
    breadcrumb: list[str]
    parent_page: list[str]
    database: list[str]
    tags: list[str]
    status: list[str]
    headings: list[str]
    issue_type: list[str]
    labels: list[str]
    milestone: list[str]
    visible_sections: list[str]
    page_type: list[str]
    layer_type: list[str]
    meeting_type: list[str]
    attendee_count_range: list[str]
    channel: list[str]
    thread: list[str]
    body: list[str]
    document_body: list[str]
    message_body: list[str]
    raw_body: list[str]
    raw_full_page_text: list[str]


@dataclass(frozen=True)  # noqa: SLOTS_OK - packaged sidecar still supports Python 3.9.
class AdaptiveContextCaptureInput:
    observed_at: str
    app_name: str
    bundle_id: str | None
    window_title: str | None
    browser_name: str | None = None
    site_domain: str | None = None
    site_title: str | None = None
    site_url: str | None = None
    active_file_path: str | None = None
    structured_fields: AdaptiveStructuredFields | None = None
