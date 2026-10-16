from __future__ import annotations

from typing import Any

from app.storage.db import BROWSER_HISTORY_IMPORT_SOURCE, TrackerDatabase

DEFAULT_LIVE_TAIL_LIMIT = 8
MAX_LIVE_TAIL_LIMIT = 50


def fetch_live_tail(
    database: TrackerDatabase,
    start: str | None,
    end: str | None,
    after_segment_id: str | None,
    after_ended_at: str | None,
    limit: int | str | None = DEFAULT_LIVE_TAIL_LIMIT,
) -> list[dict[str, Any]]:
    resolved_limit = normalize_limit(limit)
    query = f"""
        SELECT
            activity_segments.*,
            youtube_video_metadata.category AS youtube_category,
            youtube_video_metadata.channel_id AS youtube_channel_id,
            youtube_video_metadata.channel_name AS youtube_channel_name,
            youtube_video_metadata.title AS youtube_title,
            youtube_video_metadata.description AS youtube_description,
            youtube_video_metadata.keywords_json AS youtube_keywords_json,
            youtube_video_metadata.duration_seconds AS youtube_duration_seconds,
            youtube_video_metadata.view_count AS youtube_view_count,
            youtube_video_metadata.is_live AS youtube_is_live,
            youtube_video_metadata.is_unlisted AS youtube_is_unlisted,
            youtube_video_metadata.publish_date AS youtube_publish_date,
            youtube_video_metadata.upload_date AS youtube_upload_date,
            activity_classifications.category AS classification_category,
            activity_classifications.productivity AS classification_productivity,
            activity_classifications.source AS classification_source,
            activity_classifications.confidence AS classification_confidence,
            activity_classifications.reason AS classification_reason,
            activity_classifications.model AS classification_model,
            activity_classifications.prompt_version AS classification_prompt_version,
            activity_classifications.taxonomy_version AS classification_taxonomy_version,
            activity_classifications.input_fingerprint AS classification_input_fingerprint,
            activity_classifications.classified_at AS classification_classified_at,
            activity_classifications.ai_result AS classification_ai_result,
            activity_classifications.stale AS classification_stale,
            activity_classifications.request_id AS classification_request_id,
            activity_classifications.latency_ms AS classification_latency_ms,
            activity_classifications.classification_rule_id AS classification_rule_id,
            sync_classification_provenance.rule_snapshot_kind AS classification_rule_snapshot_kind
        FROM activity_segments
        LEFT JOIN youtube_video_metadata
          ON youtube_video_metadata.video_id = activity_segments.youtube_video_id
        LEFT JOIN activity_classifications
          ON activity_classifications.segment_id = activity_segments.id
        LEFT JOIN {database._classification_provenance_source()} AS sync_classification_provenance
          ON sync_classification_provenance.segment_id = activity_classifications.segment_id
        WHERE 1=1
    """
    params: list[Any] = []
    query = database._append_timeline_overlap_filters(query, params, start, end, "activity_segments")

    tail_filters: list[str] = []
    if after_ended_at:
        tail_filters.append("datetime(activity_segments.ended_at) > datetime(?)")
        params.append(TrackerDatabase._normalize_range_bound(after_ended_at))

    after_id = parse_segment_id(after_segment_id)
    if after_id is not None:
        tail_filters.append("activity_segments.id > ?")
        params.append(after_id)

    if after_id is not None and after_ended_at:
        # A clock correction can leave the latest local capture below the
        # timestamp high-water mark. Replay that one live row so its continued
        # duration reaches the renderer. Imported/other-device rows do not
        # represent the capture loop's mutable tail.
        tail_filters.append("""
            (activity_segments.id = (
                SELECT id FROM activity_segments
                WHERE origin_device_id IS NULL AND source != ?
                ORDER BY id DESC LIMIT 1
            ) AND datetime(activity_segments.ended_at) < datetime(?))
        """)
        params.extend((BROWSER_HISTORY_IMPORT_SOURCE, TrackerDatabase._normalize_range_bound(after_ended_at)))

    if tail_filters:
        query += f" AND ({' OR '.join(tail_filters)})"
        if after_id is not None:
            # Consume new ids in insertion order before replaying older rows.
            # Timestamp order can jump past unseen ids in a bounded page.
            query += """
                ORDER BY
                    CASE WHEN activity_segments.id > ? THEN 0 ELSE 1 END ASC,
                    CASE WHEN activity_segments.id > ? THEN activity_segments.id END ASC,
                    activity_segments.id DESC LIMIT ?
            """
            params.extend((after_id, after_id))
        else:
            query += " ORDER BY datetime(activity_segments.ended_at) ASC, activity_segments.id ASC LIMIT ?"
    else:
        query += " ORDER BY datetime(activity_segments.ended_at) DESC, activity_segments.id DESC LIMIT ?"
    params.append(resolved_limit)

    with database.connect() as conn:
        rows = [dict(row) for row in conn.execute(query, tuple(params)).fetchall()]

    if not tail_filters:
        rows.reverse()

    return [database._serialize_row(row) for row in rows]


def normalize_limit(limit: int | str | None) -> int:
    try:
        parsed = int(limit) if limit is not None else DEFAULT_LIVE_TAIL_LIMIT
    except (TypeError, ValueError):
        parsed = DEFAULT_LIVE_TAIL_LIMIT
    return min(MAX_LIVE_TAIL_LIMIT, max(1, parsed))


def parse_segment_id(segment_id: str | None) -> int | None:
    if not segment_id:
        return None
    try:
        return int(segment_id)
    except ValueError:
        return None
