import { invoke } from "@tauri-apps/api/core";

export type GoogleCalendarAuthPurpose = "signIn" | "connect";

export interface GoogleCalendarCapability {
  readonly configured: boolean;
}

export interface GoogleCalendarAuthorizationResult {
  readonly attemptId: string;
  readonly purpose: GoogleCalendarAuthPurpose;
  readonly calendarGranted: boolean;
  readonly calendarCredentialReady: boolean;
  readonly connectedEmail: string | null;
  readonly googleSubject: string | null;
  readonly idToken: string | null;
  readonly accessToken: string | null;
}

export interface GoogleCalendarStatus {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly connectedEmail: string | null;
  readonly grantedScopes: readonly string[];
}

export interface GoogleCalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
}

const TOKEN_MAX_LENGTH = 16_384;
const ID_MAX_LENGTH = 256;
const TEXT_MAX_LENGTH = 4_096;
const USER_ID_MAX_LENGTH = 128;

const GOOGLE_CALENDAR_CONNECTION_MARKER_STORAGE_PREFIX =
  "drifty.googleCalendar.connected.v1:";

export const GOOGLE_CALENDAR_CONNECTION_CHANGED_EVENT = "drifty:google-calendar-connection-changed";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function nullableBoundedString(value: unknown, maxLength: number): value is string | null {
  return value === null || isBoundedString(value, maxLength);
}

function normalizedUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= USER_ID_MAX_LENGTH ? trimmed : null;
}

function connectionMarkerStorageKey(userId: string): string | null {
  const normalized = normalizedUserId(userId);
  return normalized ? `${GOOGLE_CALENDAR_CONNECTION_MARKER_STORAGE_PREFIX}${normalized}` : null;
}

function persistConnectionMarker(userId: string, connected: boolean): boolean {
  if (typeof window === "undefined") return false;
  const storageKey = connectionMarkerStorageKey(userId);
  if (!storageKey) return false;
  try {
    if (connected) {
      window.localStorage.setItem(storageKey, "1");
    } else {
      window.localStorage.removeItem(storageKey);
    }
    return true;
  } catch {
    return false;
  }
}

export function hasLocalGoogleCalendarConnectionMarker(userId: string): boolean {
  if (typeof window === "undefined") return false;
  const storageKey = connectionMarkerStorageKey(userId);
  if (!storageKey) return false;
  try {
    return window.localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}

export function isGoogleCalendarOnboardingEnabled(): boolean {
  return isTauriRuntime() && import.meta.env.VITE_GOOGLE_CALENDAR_ONBOARDING_ENABLED === "1";
}

export async function getGoogleCalendarCapability(): Promise<GoogleCalendarCapability> {
  if (!isTauriRuntime()) return { configured: false };
  const value: unknown = await invoke("google_calendar_capability");
  if (!isRecord(value) || typeof value.configured !== "boolean") {
    throw new Error("Google Calendar capability response was invalid.");
  }
  return { configured: value.configured };
}

export async function authorizeGoogleCalendar(
  purpose: GoogleCalendarAuthPurpose,
): Promise<GoogleCalendarAuthorizationResult> {
  const value: unknown = await invoke("google_calendar_authorize", { purpose });
  if (
    !isRecord(value)
    || !isBoundedString(value.attemptId, ID_MAX_LENGTH)
    || value.purpose !== purpose
    || typeof value.calendarGranted !== "boolean"
    || typeof value.calendarCredentialReady !== "boolean"
    || !nullableBoundedString(value.connectedEmail, TEXT_MAX_LENGTH)
    || !nullableBoundedString(value.googleSubject, ID_MAX_LENGTH)
    || !nullableBoundedString(value.idToken, TOKEN_MAX_LENGTH)
    || !nullableBoundedString(value.accessToken, TOKEN_MAX_LENGTH)
  ) {
    throw new Error("Google Calendar authorization response was invalid.");
  }

  if (purpose === "signIn" && (!value.idToken || !value.accessToken)) {
    throw new Error("Google sign-in did not return the required identity tokens.");
  }
  if (purpose === "connect" && (value.idToken !== null || value.accessToken !== null)) {
    throw new Error("Google Calendar connect exposed unexpected identity tokens.");
  }

  return {
    attemptId: value.attemptId,
    purpose,
    calendarGranted: value.calendarGranted,
    calendarCredentialReady: value.calendarCredentialReady,
    connectedEmail: value.connectedEmail,
    googleSubject: value.googleSubject,
    idToken: value.idToken,
    accessToken: value.accessToken,
  };
}

function parseGoogleCalendarStatus(value: unknown): GoogleCalendarStatus {
  if (
    !isRecord(value)
    || typeof value.configured !== "boolean"
    || typeof value.connected !== "boolean"
    || !nullableBoundedString(value.connectedEmail, TEXT_MAX_LENGTH)
    || !Array.isArray(value.grantedScopes)
    || value.grantedScopes.some((scope) => !isBoundedString(scope, TEXT_MAX_LENGTH))
  ) {
    throw new Error("Google Calendar status response was invalid.");
  }
  return {
    configured: value.configured,
    connected: value.connected,
    connectedEmail: value.connectedEmail,
    grantedScopes: value.grantedScopes,
  };
}

export async function finalizeGoogleCalendarConnection(
  userId: string,
  attemptId: string,
  purpose: GoogleCalendarAuthPurpose,
): Promise<GoogleCalendarStatus> {
  const status = parseGoogleCalendarStatus(
    await invoke("google_calendar_finalize", { userId, attemptId, purpose }),
  );
  if (persistConnectionMarker(userId, status.connected)) return status;

  if (status.connected) {
    try {
      await invoke("google_calendar_disconnect", { userId });
    } catch {
      throw new Error(
        "Google Calendar was connected but its local cleanup marker could not be saved or rolled back.",
      );
    }
    throw new Error("Google Calendar connection was rolled back because local storage is unavailable.");
  }
  return status;
}

export async function discardPendingGoogleCalendarConnection(attemptId: string): Promise<void> {
  await invoke("google_calendar_discard_pending", { attemptId });
}

export async function getGoogleCalendarStatus(userId: string): Promise<GoogleCalendarStatus> {
  const status = parseGoogleCalendarStatus(await invoke("google_calendar_status", { userId }));
  persistConnectionMarker(userId, status.connected);
  return status;
}

export async function disconnectGoogleCalendar(userId: string): Promise<GoogleCalendarStatus> {
  const status = parseGoogleCalendarStatus(await invoke("google_calendar_disconnect", { userId }));
  persistConnectionMarker(userId, false);
  return status;
}

function parseCalendarEvent(value: unknown): GoogleCalendarEvent {
  if (
    !isRecord(value)
    || !isBoundedString(value.id, ID_MAX_LENGTH)
    || !isBoundedString(value.title, TEXT_MAX_LENGTH)
    || !isBoundedString(value.start, TEXT_MAX_LENGTH)
    || !isBoundedString(value.end, TEXT_MAX_LENGTH)
    || typeof value.allDay !== "boolean"
  ) {
    throw new Error("Google Calendar event response was invalid.");
  }
  return {
    id: value.id,
    title: value.title,
    start: value.start,
    end: value.end,
    allDay: value.allDay,
  };
}

export async function getGoogleCalendarEvents(
  userId: string,
  start: string,
  end: string,
): Promise<readonly GoogleCalendarEvent[]> {
  const value: unknown = await invoke("google_calendar_events", { userId, start, end });
  if (!Array.isArray(value) || value.length > 500) {
    throw new Error("Google Calendar events response was invalid.");
  }
  return value.map(parseCalendarEvent);
}

export function isGoogleCalendarAuthorizationCancelled(error: unknown): boolean {
  return String(error ?? "").includes("GOOGLE_CALENDAR_AUTHORIZATION_CANCELLED");
}

export function notifyGoogleCalendarConnectionChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GOOGLE_CALENDAR_CONNECTION_CHANGED_EVENT));
  }
}
