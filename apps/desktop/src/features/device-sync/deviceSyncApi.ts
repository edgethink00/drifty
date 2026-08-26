import { invoke } from "@tauri-apps/api/core";
import type { SyncDeletionRecord, SyncedSegmentInput, SyncOutboxSegment } from "@drifty/domain";
import { supabase } from "../../lib/supabase/client";
import { readCloudDevicePayload } from "../cloud-devices/cloudDeviceIdentity";
import type { SyncDevicesResponse, SyncPurgeResponse, SyncPushResponse, SyncResumeResponse } from "./deviceSyncTypes";

const SYNC_EDGE_FUNCTION = "sync-activity";
// Initial-backfill batches can be a few hundred KB; native HTTP (not WebView
// fetch) with a generous timeout, same rationale as the cloud AI passes.
const SYNC_HTTP_TIMEOUT_MS = 120_000;

type CloudSyncHttpResponse = {
  status: number;
  body: string;
  latencyMs: number;
};

export class DeviceSyncHttpError extends Error {
  readonly status: number;
  readonly lockedReason: string | null;
  readonly code: string | null;
  readonly syncGeneration: number | null;

  constructor(
    status: number,
    message: string,
    lockedReason: string | null = null,
    code: string | null = null,
    syncGeneration: number | null = null,
  ) {
    super(message);
    this.name = "DeviceSyncHttpError";
    this.status = status;
    this.lockedReason = lockedReason;
    this.code = code;
    this.syncGeneration = syncGeneration;
  }
}

async function postSyncAction<TResponse>(
  action: "push" | "purge" | "devices" | "resume",
  expectedAccountId: string,
  extra: Record<string, unknown> = {},
): Promise<TResponse> {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const sessionAccountId = data.session?.user?.id;
  if (!accessToken) {
    throw new Error("Sign in to use device sync.");
  }
  if (!sessionAccountId || sessionAccountId !== expectedAccountId) {
    throw new DeviceSyncHttpError(409, "The signed-in account changed during device sync.", null, "sync_account_changed");
  }
  const cloudDevice = await readCloudDevicePayload();
  if (!cloudDevice) {
    throw new Error("Device identity is unavailable.");
  }

  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "");
  const response = await invoke<CloudSyncHttpResponse>("cloud_sync_http_post", {
    request: {
      url: `${supabaseUrl}/functions/v1/${SYNC_EDGE_FUNCTION}`,
      bearerToken: accessToken,
      apikey: anonKey,
      bodyJson: { ...extra, action, accountId: expectedAccountId, cloudDevice },
      timeoutMs: SYNC_HTTP_TIMEOUT_MS,
    },
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(response.body) as Record<string, unknown>;
  } catch (_error) {
    // Non-JSON bodies fall through to the status check below.
  }
  if (response.status >= 400) {
    const message = typeof parsed.error === "string" ? parsed.error : `Device sync failed (HTTP ${response.status})`;
    const lockedReason = typeof parsed.lockedReason === "string" ? parsed.lockedReason : null;
    const code = typeof parsed.code === "string" ? parsed.code : null;
    const syncGeneration = typeof parsed.syncGeneration === "number" && Number.isSafeInteger(parsed.syncGeneration)
      ? parsed.syncGeneration
      : null;
    throw new DeviceSyncHttpError(response.status, message, lockedReason, code, syncGeneration);
  }
  return parsed as TResponse;
}

export async function pushSyncBatch(
  segments: readonly SyncOutboxSegment[],
  deletions: readonly SyncDeletionRecord[],
  syncGeneration: number | null,
  expectedAccountId: string,
): Promise<SyncPushResponse> {
  return postSyncAction<SyncPushResponse>("push", expectedAccountId, {
    segments,
    deletions,
    ...(syncGeneration === null ? {} : { syncGeneration }),
  });
}

export async function purgeCloudSyncData(
  expectedAccountId: string,
  expectedSyncGeneration: number,
): Promise<SyncPurgeResponse> {
  return postSyncAction<SyncPurgeResponse>("purge", expectedAccountId, {
    expectedSyncGeneration,
  });
}

export async function resumeCloudSyncData(
  expectedAccountId: string,
  expectedSyncGeneration: number,
): Promise<SyncResumeResponse> {
  return postSyncAction<SyncResumeResponse>("resume", expectedAccountId, {
    expectedSyncGeneration,
  });
}

export async function fetchSyncDevices(expectedAccountId: string): Promise<SyncDevicesResponse> {
  return postSyncAction<SyncDevicesResponse>("devices", expectedAccountId);
}

export type SyncedSegmentsPage = {
  readonly segments: SyncedSegmentInput[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
};

export const SYNC_PULL_PAGE_LIMIT = 1000;

type SyncedSegmentRow = {
  readonly segment_uid: string;
  readonly device_id: string;
  readonly started_at: string;
  readonly ended_at: string;
  readonly duration_seconds: number;
  readonly app_name: string;
  readonly bundle_id: string | null;
  readonly window_title: string | null;
  readonly browser_name: string | null;
  readonly site_domain: string | null;
  readonly site_title: string | null;
  readonly site_url: string | null;
  readonly youtube_video_id: string | null;
  readonly youtube_playlist_id: string | null;
  readonly youtube_is_shorts: boolean | null;
  readonly site_source: string | null;
  readonly platform: string;
  readonly source: string;
  readonly confidence: number | null;
  readonly classification_category: string | null;
  readonly classification_productivity: string | null;
  readonly classification_source: string | null;
  readonly classification_confidence: number | null;
  readonly classification_reason: string | null;
  readonly classification_classified_at: string | null;
  readonly server_updated_at: string;
};

function toSyncedSegmentInput(row: SyncedSegmentRow): SyncedSegmentInput {
  return {
    segmentUid: row.segment_uid,
    originDeviceId: row.device_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    appName: row.app_name,
    bundleId: row.bundle_id,
    windowTitle: row.window_title,
    browserName: row.browser_name,
    siteDomain: row.site_domain,
    siteTitle: row.site_title,
    siteUrl: row.site_url,
    youtubeVideoId: row.youtube_video_id,
    youtubePlaylistId: row.youtube_playlist_id,
    youtubeIsShorts: row.youtube_is_shorts,
    siteSource: row.site_source,
    platform: row.platform,
    source: row.source,
    confidence: row.confidence,
    classification: row.classification_category
      ? {
          category: row.classification_category,
          productivity: row.classification_productivity ?? "neutral",
          source: row.classification_source ?? "llm",
          confidence: row.classification_confidence,
          reason: row.classification_reason,
          classifiedAt: row.classification_classified_at,
        }
      : null,
  };
}

// Cursor = `${server_updated_at}|${segment_uid}` — a stable compound order so
// re-pushed (updated) rows are re-pulled and pagination never skips ties.
export function encodeSyncPullCursor(serverUpdatedAt: string, segmentUid: string): string {
  return `${serverUpdatedAt}|${segmentUid}`;
}

function decodeSyncPullCursor(cursor: string | null): { serverUpdatedAt: string; segmentUid: string } | null {
  if (!cursor) return null;
  const separator = cursor.lastIndexOf("|");
  if (separator <= 0) return null;
  return { serverUpdatedAt: cursor.slice(0, separator), segmentUid: cursor.slice(separator + 1) };
}

export type SyncedDeletionsPage = {
  readonly deletions: SyncDeletionRecord[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
};

type SyncedDeletionRow = {
  readonly deletion_uid: string;
  readonly device_id: string;
  readonly kind: "range" | "uids";
  readonly range_start: string | null;
  readonly range_end: string | null;
  readonly segment_uids: string[] | null;
  readonly created_at: string;
  readonly server_updated_at: string;
};

/**
 * Pull other devices' deletion tombstones. Own-device tombstones are excluded:
 * they were already applied locally when the user deleted, and re-applying a
 * range tombstone later would wipe segments recorded after the deletion.
 */
export async function fetchSyncedDeletionsPage(
  cursor: string | null,
  excludeDeviceId: string | null,
  expectedAccountId: string,
  limit: number = SYNC_PULL_PAGE_LIMIT,
): Promise<SyncedDeletionsPage> {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
  let query = supabase
    .from("synced_deletions")
    .select("*")
    .eq("user_id", expectedAccountId)
    .order("server_updated_at", { ascending: true })
    .order("deletion_uid", { ascending: true })
    .limit(limit);
  if (excludeDeviceId) {
    query = query.neq("device_id", excludeDeviceId);
  }
  const decoded = decodeSyncPullCursor(cursor);
  if (decoded) {
    query = query.or(
      `server_updated_at.gt.${decoded.serverUpdatedAt},and(server_updated_at.eq.${decoded.serverUpdatedAt},deletion_uid.gt.${decoded.segmentUid})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Device sync deletions pull failed: ${error.message}`);
  }
  const rows = (data ?? []) as SyncedDeletionRow[];
  const last = rows[rows.length - 1];
  return {
    deletions: rows.map((row) => ({
      deletionUid: row.deletion_uid,
      kind: row.kind,
      rangeStart: row.range_start,
      rangeEnd: row.range_end,
      segmentUids: row.segment_uids,
      createdAt: row.created_at,
    })),
    nextCursor: last ? encodeSyncPullCursor(last.server_updated_at, last.deletion_uid) : cursor,
    hasMore: rows.length === limit,
  };
}

/**
 * Pull one page of other devices' segments via the RLS-scoped table select.
 * Short paged requests are fine on WebView fetch; only the push rides native
 * HTTP.
 */
export async function fetchSyncedSegmentsPage(
  cursor: string | null,
  excludeDeviceId: string | null,
  expectedAccountId: string,
  limit: number = SYNC_PULL_PAGE_LIMIT,
): Promise<SyncedSegmentsPage> {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
  let query = supabase
    .from("synced_activity_segments")
    .select("*")
    .eq("user_id", expectedAccountId)
    .order("server_updated_at", { ascending: true })
    .order("segment_uid", { ascending: true })
    .limit(limit);
  if (excludeDeviceId) {
    query = query.neq("device_id", excludeDeviceId);
  }
  const decoded = decodeSyncPullCursor(cursor);
  if (decoded) {
    query = query.or(
      `server_updated_at.gt.${decoded.serverUpdatedAt},and(server_updated_at.eq.${decoded.serverUpdatedAt},segment_uid.gt.${decoded.segmentUid})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Device sync pull failed: ${error.message}`);
  }
  const rows = (data ?? []) as SyncedSegmentRow[];
  const last = rows[rows.length - 1];
  return {
    segments: rows.map(toSyncedSegmentInput),
    nextCursor: last ? encodeSyncPullCursor(last.server_updated_at, last.segment_uid) : cursor,
    hasMore: rows.length === limit,
  };
}
