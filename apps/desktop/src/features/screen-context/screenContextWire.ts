import type {
  ScreenCapturePreferences, ScreenContextFailure, ScreenContextStatus, ScreenEvidenceCursor,
  ScreenEvidencePage, ScreenEvidenceDetail, ScreenEvidenceDeletion, ScreenDeletionPreview, ScreenTextSource, ScreenTextState,
} from "@drifty/domain";
const INVALID = "screen_context_invalid_response";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID);
  return value as Record<string, unknown>;
}
function bool(value: unknown): boolean { if (typeof value !== "boolean") throw new Error(INVALID); return value; }
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(INVALID); return value;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || value.length > max) throw new Error(INVALID); return value;
}
function id(value: unknown): string { const v = text(value, 36); if (!UUID.test(v)) throw new Error(INVALID); return v; }
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (!options.includes(value as T)) throw new Error(INVALID); return value as T;
}
const SOURCES: readonly ScreenTextSource[] = ["none", "ocr", "accessibility"];
const STATES: readonly ScreenTextState[] = ["not_requested", "recognized", "no_text", "deadline", "unavailable"];
const FAILURES: readonly ScreenContextFailure[] = ["permission", "excluded", "visibility", "protected", "unsupported", "cancelled",
  "deadline", "unavailable", "invalidated", "storage", "no_text", "text_deadline", "text_unavailable",
  "accessibility_permission", "capture_retrying", "capture_stopped"];
export function decodeScreenPreferences(raw: unknown): ScreenCapturePreferences {
  const v = object(raw);
  if (!Array.isArray(v.allowedApps) || v.allowedApps.length > 12) throw new Error(INVALID);
  const interval = integer(v.intervalSeconds); if (interval !== 10 && interval !== 30) throw new Error(INVALID);
  const scope = v.scope === undefined ? undefined : choice(v.scope, ["selected_apps", "active_display_scene"] as const);
  if (scope === "active_display_scene" && (v.allowedApps.length !== 0 || v.visibleTextEnabled !== false)) throw new Error(INVALID);
  const retention = v.retention === undefined ? undefined : choice(v.retention, ["day", "week", "month", "unlimited"] as const);
  const maxStorageGb = v.maxStorageGb === undefined ? undefined : integer(v.maxStorageGb);
  if (maxStorageGb !== undefined && ![1, 5, 10, 20, 50].includes(maxStorageGb)) throw new Error(INVALID);
  return { ...(scope === undefined ? {} : { scope }),
    ...(v.generalNoticePending === undefined ? {} : { generalNoticePending: bool(v.generalNoticePending) }), enabled: bool(v.enabled), replayEnabled: bool(v.replayEnabled), visibleTextEnabled: bool(v.visibleTextEnabled),
    ocrEnabled: bool(v.ocrEnabled), allowedApps: v.allowedApps.map((a) => text(a, 32)), intervalSeconds: interval,
    ...(retention === undefined ? {} : { retention }),
    ...(maxStorageGb === undefined ? {} : { maxStorageGb: maxStorageGb as 1 | 5 | 10 | 20 | 50 }) };
}
export function decodeScreenStatus(raw: unknown): ScreenContextStatus {
  const v = object(raw);
  if (!Array.isArray(v.supportedApps) || v.supportedApps.length > 12) throw new Error(INVALID);
  return { activityCleanupPending: v.activityCleanupPending === undefined ? false : bool(v.activityCleanupPending),
    preferences: decodeScreenPreferences(v.preferences), preferencesInvalid: bool(v.preferencesInvalid), captureEnabled: bool(v.captureEnabled),
    ...(v.generalCaptureSupported === undefined ? {} : { generalCaptureSupported: bool(v.generalCaptureSupported) }),
    helperInstalled: bool(v.helperInstalled), globalPaused: bool(v.globalPaused), ocrSupported: bool(v.ocrSupported), supportedApps: v.supportedApps.map((a) => {
      const app = object(a); return { id: text(app.id, 32), name: text(app.name, 64) };
    }), paused: bool(v.paused), running: bool(v.running), preparing: bool(v.preparing), accepted: integer(v.accepted),
    dropped: integer(v.dropped), lastFailure: v.lastFailure === null ? null : choice(v.lastFailure, FAILURES),
    lastAcceptedAtMs: v.lastAcceptedAtMs === null ? null : integer(v.lastAcceptedAtMs),
    ...(v.storedBytes === undefined || v.storedBytes === null ? {} : { storedBytes: integer(v.storedBytes) }) };
}
function cursor(raw: unknown): ScreenEvidenceCursor {
  const v = object(raw); return { instance: id(v.instance), revision: integer(v.revision), observedAtMs: integer(v.observedAtMs), id: id(v.id),
    ...(v.order === undefined ? {} : { order: choice(v.order, ["oldest_first", "newest_first"] as const) }) };
}
export function decodeScreenPage(raw: unknown): ScreenEvidencePage {
  const v = object(raw);
  if (!Array.isArray(v.records) || v.records.length > 20) throw new Error(INVALID);
  return { records: v.records.map((raw) => { const row = object(raw); return { id: id(row.id), observedAtMs: integer(row.observedAtMs),
    expiresAtMs: integer(row.expiresAtMs), textSource: choice(row.textSource, SOURCES), textState: choice(row.textState, STATES),
    frameRetained: bool(row.frameRetained) }; }), nextCursor: v.nextCursor === null ? null : cursor(v.nextCursor) };
}
export function decodeScreenDetail(raw: unknown): ScreenEvidenceDetail | null {
  if (raw === null) return null;
  const v = object(raw); const evidence = object(v.textEvidence);
  const source = choice(evidence.source, SOURCES); const state = choice(evidence.state, STATES);
  const body = text(evidence.text, 3200); // Rust caps1600 Unicode scalars, JS uses UTF-16.
  if ([...body].length > 1600 || (state === "recognized" ? !body.trim() : body !== "")
    || (source === "none") !== (state === "not_requested")) throw new Error(INVALID);
  const expires = integer(v.expiresAtMs); if (expires <= Date.now()) throw new Error(INVALID);
  const frame = v.frameUrl === null ? null : text(v.frameUrl, 2_800_000);
  // Screens kept past a day are saved as WebP.
  if (frame !== null && !/^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(frame)) throw new Error(INVALID);
  return { id: id(v.id), observedAtMs: integer(v.observedAtMs), expiresAtMs: expires,
    textEvidence: { source, state, text: body }, frameUrl: frame };
}
export function decodeScreenDeletion(raw: unknown): ScreenEvidenceDeletion {
  const v = object(raw); return { removedCount: integer(v.removedCount), pendingFiles: integer(v.pendingFiles) };
}
export function decodeScreenDeletionPreview(raw: unknown): ScreenDeletionPreview {
  const v = object(raw);
  return { recordCount: integer(v.recordCount), imageBytes: integer(v.imageBytes) };
}
export function decodeSampleAccepted(raw: unknown): boolean { return bool(raw); }
