import { localeForDisplayLanguage } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languagePreference";
import type { DeviceSyncStatus } from "./deviceSyncTypes";

/**
 * One reading of this device's sync state, shared by the Devices block's sync
 * row and this device's row in the device list so the two never disagree.
 */
export type DeviceSyncSummaryKind =
  | "off"
  | "limit"
  | "paused"
  | "running"
  | "error"
  | "uploading"
  | "synced"
  | "waiting";

export type DeviceSyncSummaryTone = "ok" | "neutral" | "attention" | "error";

export type DeviceSyncSummary = {
  readonly kind: DeviceSyncSummaryKind;
  readonly tone: DeviceSyncSummaryTone;
  /** Whole-number upload progress, present only for kind "uploading". */
  readonly percent: number | null;
  /** Most recent completed push or pull, when known. */
  readonly lastSyncedAt: string | null;
};

export type DeviceSyncSummaryInput = {
  readonly enabled: boolean;
  /** Entitlement, account and connectivity all allow sync to run now. */
  readonly gateActive: boolean;
  /** This device cannot use Drifty Cloud because the account's device limit is full. */
  readonly deviceLimitReached: boolean;
  /** A manual sync started from Settings has not settled yet. */
  readonly running: boolean;
  readonly status: DeviceSyncStatus | undefined;
};

const TONES: Record<DeviceSyncSummaryKind, DeviceSyncSummaryTone> = {
  off: "neutral",
  limit: "attention",
  paused: "attention",
  running: "ok",
  error: "error",
  uploading: "ok",
  synced: "ok",
  waiting: "ok",
};

export function resolveDeviceSyncSummary(input: DeviceSyncSummaryInput): DeviceSyncSummary {
  const lastSyncedAt = latestTimestamp(input.status?.lastPushedAt ?? null, input.status?.lastPulledAt ?? null);
  const summary = (kind: DeviceSyncSummaryKind, percent: number | null = null): DeviceSyncSummary => ({
    kind,
    tone: TONES[kind],
    percent,
    lastSyncedAt,
  });

  if (!input.enabled) return summary(input.deviceLimitReached ? "limit" : "off");
  if (!input.gateActive) return summary(input.deviceLimitReached ? "limit" : "paused");
  if (input.running) return summary("running");
  if (input.status?.lastError) return summary("error");
  const percent = uploadPercent(input.status);
  if (percent !== null) return summary("uploading", percent);
  return summary(lastSyncedAt ? "synced" : "waiting");
}

/**
 * Sequence gaps can come from received rows or already-covered history, so
 * history counts as uploading only while the outbox still holds work.
 */
function uploadPercent(status: DeviceSyncStatus | undefined): number | null {
  if (!status || status.pendingPushCount <= 0 || !status.backfill) return null;
  const { pushedSeq, totalSeq } = status.backfill;
  if (pushedSeq >= totalSeq) return null;
  if (totalSeq <= 0) return 0;
  return Math.max(0, Math.min(99, Math.floor((pushedSeq / totalSeq) * 100)));
}

function latestTimestamp(...values: readonly (string | null)[]): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || ms <= latestMs) continue;
    latest = value;
    latestMs = ms;
  }
  return latest;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "just now", "5 minutes ago", "yesterday", then a short date after a week.
 * Future timestamps from a skewed clock read as "just now" rather than "in 2 minutes".
 */
export function formatDeviceRelativeTime(value: string, now: number, language: DisplayLanguage): string | null {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  const locale = localeForDisplayLanguage(language);
  const elapsed = Math.max(0, now - at);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed < 45_000) return language === "ko" ? "방금" : language === "es" ? "ahora mismo" : "just now";
  if (elapsed < HOUR_MS) return relative.format(-Math.max(1, Math.floor(elapsed / MINUTE_MS)), "minute");
  if (elapsed < DAY_MS) return relative.format(-Math.floor(elapsed / HOUR_MS), "hour");
  if (elapsed < 7 * DAY_MS) return relative.format(-Math.floor(elapsed / DAY_MS), "day");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(at));
}
