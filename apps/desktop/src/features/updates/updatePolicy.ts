export type UpdateUrgency = "general" | "urgent";

export type UpdatePolicy = {
  readonly version: string;
  readonly urgency: UpdateUrgency;
  readonly promptAfterMs: number;
  readonly autoInstallEligible: boolean;
  readonly message: string | null;
};

export type UpdateInteraction = {
  readonly firstSeenAtMs: number;
  readonly interactedAtMs: number | null;
  readonly autoInstallAttemptedAtMs: number | null;
};

export type UpdateInteractionMap = Record<string, UpdateInteraction>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const UPDATE_POLICY_URL = "https://github.com/edgethink00/drifty_releases/releases/latest/download/update-policy.json";
export const UPDATE_AUTO_INSTALL_STORAGE_KEY = "drifty.updates.autoInstallFuture";
export const UPDATE_INTERACTION_STORAGE_KEY = "drifty.updates.interactions.v1";
export const POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY = "drifty.updates.focusAfterRelaunch";
export const DEFAULT_GENERAL_PROMPT_AFTER_MS = 72 * 60 * 60 * 1000;
const UPDATE_POLICY_FETCH_TIMEOUT_MS = 4000;

export function fallbackUpdatePolicy(version: string): UpdatePolicy {
  return {
    version,
    urgency: "general",
    promptAfterMs: DEFAULT_GENERAL_PROMPT_AFTER_MS,
    autoInstallEligible: false,
    message: null,
  };
}

export function normalizeUpdatePolicyMetadata(metadata: unknown, expectedVersion: string): UpdatePolicy | null {
  if (!isRecord(metadata)) return null;

  const version = metadata.version;
  if (typeof version !== "string" || version !== expectedVersion) return null;

  const urgency = normalizeUrgency(metadata.urgency);
  if (!urgency) return null;

  const promptAfterMs = normalizePromptAfterMs(metadata.promptAfterHours, urgency);
  const autoInstallEligible = metadata.autoInstall === true;
  const message = typeof metadata.message === "string" && metadata.message.trim().length > 0
    ? metadata.message.trim()
    : null;

  return {
    version,
    urgency,
    promptAfterMs,
    autoInstallEligible,
    message,
  };
}

export async function fetchUpdatePolicy(version: string, fetcher: FetchLike = globalThis.fetch): Promise<UpdatePolicy> {
  if (typeof fetcher !== "function") return fallbackUpdatePolicy(version);

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? globalThis.setTimeout(() => controller.abort(), UPDATE_POLICY_FETCH_TIMEOUT_MS)
    : null;

  try {
    const response = await fetcher(UPDATE_POLICY_URL, {
      cache: "no-store",
      signal: controller?.signal,
    });
    if (!response.ok) return fallbackUpdatePolicy(version);

    const metadata: unknown = await response.json();
    return normalizeUpdatePolicyMetadata(metadata, version) ?? fallbackUpdatePolicy(version);
  } catch {
    return fallbackUpdatePolicy(version);
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  }
}

export function parseUpdateInteractionMap(savedValue: string | null): UpdateInteractionMap {
  if (!savedValue) return {};

  try {
    const parsedValue: unknown = JSON.parse(savedValue);
    if (!isRecord(parsedValue)) return {};

    const next: UpdateInteractionMap = {};
    for (const [version, value] of Object.entries(parsedValue)) {
      if (!isValidVersionKey(version) || !isRecord(value)) continue;

      const firstSeenAtMs = value.firstSeenAtMs;
      if (!isFiniteTimestamp(firstSeenAtMs)) continue;

      const interactedAtMs = normalizeNullableTimestamp(value.interactedAtMs);
      const autoInstallAttemptedAtMs = normalizeNullableTimestamp(value.autoInstallAttemptedAtMs);
      if (interactedAtMs === undefined || autoInstallAttemptedAtMs === undefined) continue;

      next[version] = {
        firstSeenAtMs,
        interactedAtMs,
        autoInstallAttemptedAtMs,
      };
    }
    return next;
  } catch {
    return {};
  }
}

export function readUpdateInteractionMap(): UpdateInteractionMap {
  if (typeof window === "undefined") return {};
  return parseUpdateInteractionMap(window.localStorage.getItem(UPDATE_INTERACTION_STORAGE_KEY));
}

export function persistUpdateInteractionMap(interactions: UpdateInteractionMap): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(UPDATE_INTERACTION_STORAGE_KEY, JSON.stringify(interactions));
}

export function resolveInitialAutoInstallFutureUpdates(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(UPDATE_AUTO_INSTALL_STORAGE_KEY) === "1";
}

export function persistAutoInstallFutureUpdates(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(UPDATE_AUTO_INSTALL_STORAGE_KEY, enabled ? "1" : "0");
}

export function markPostUpdateRelaunchFocusPending(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY, "1");
}

export function clearPostUpdateRelaunchFocusPending(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY);
}

export function consumePostUpdateRelaunchFocusPending(): boolean {
  if (typeof window === "undefined") return false;
  if (window.localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY) !== "1") return false;
  clearPostUpdateRelaunchFocusPending();
  return true;
}

export function upsertUpdateSeen(interactions: UpdateInteractionMap, version: string, nowMs: number): UpdateInteractionMap {
  const current = interactions[version];
  if (current) return interactions;

  return {
    ...interactions,
    [version]: {
      firstSeenAtMs: nowMs,
      interactedAtMs: null,
      autoInstallAttemptedAtMs: null,
    },
  };
}

export function markUpdateInteracted(interactions: UpdateInteractionMap, version: string, nowMs: number): UpdateInteractionMap {
  const current = interactions[version];
  return {
    ...interactions,
    [version]: {
      firstSeenAtMs: current?.firstSeenAtMs ?? nowMs,
      interactedAtMs: nowMs,
      autoInstallAttemptedAtMs: current?.autoInstallAttemptedAtMs ?? null,
    },
  };
}

export function markUpdateAutoInstallAttempted(interactions: UpdateInteractionMap, version: string, nowMs: number): UpdateInteractionMap {
  const current = interactions[version];
  return {
    ...interactions,
    [version]: {
      firstSeenAtMs: current?.firstSeenAtMs ?? nowMs,
      interactedAtMs: current?.interactedAtMs ?? null,
      autoInstallAttemptedAtMs: nowMs,
    },
  };
}

export function shouldShowAutomaticUpdateDialog(input: {
  readonly policy: UpdatePolicy;
  readonly interaction: UpdateInteraction | null;
  readonly nowMs: number;
}): boolean {
  if (input.policy.urgency === "urgent") return true;
  if (input.interaction?.interactedAtMs !== null && input.interaction?.interactedAtMs !== undefined) return false;

  const firstSeenAtMs = input.interaction?.firstSeenAtMs ?? input.nowMs;
  return input.nowMs - firstSeenAtMs >= input.policy.promptAfterMs;
}

export function shouldAutoInstallUpdate(input: {
  readonly autoInstallFutureUpdates: boolean;
  readonly policy: UpdatePolicy;
  readonly interaction: UpdateInteraction | null;
}): boolean {
  if (!input.autoInstallFutureUpdates) return false;
  if (!input.policy.autoInstallEligible) return false;
  return input.interaction?.autoInstallAttemptedAtMs === null || input.interaction?.autoInstallAttemptedAtMs === undefined;
}

export function msUntilAutomaticDialog(input: {
  readonly policy: UpdatePolicy;
  readonly interaction: UpdateInteraction | null;
  readonly nowMs: number;
}): number | null {
  if (input.policy.urgency === "urgent") return 0;
  if (input.interaction?.interactedAtMs !== null && input.interaction?.interactedAtMs !== undefined) return null;

  const firstSeenAtMs = input.interaction?.firstSeenAtMs ?? input.nowMs;
  return Math.max(0, input.policy.promptAfterMs - (input.nowMs - firstSeenAtMs));
}

function normalizeUrgency(value: unknown): UpdateUrgency | null {
  if (value === "general" || value === "urgent") return value;
  return null;
}

function normalizePromptAfterMs(value: unknown, urgency: UpdateUrgency): number {
  if (urgency === "urgent") return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return DEFAULT_GENERAL_PROMPT_AFTER_MS;
  return Math.round(value * 60 * 60 * 1000);
}

function normalizeNullableTimestamp(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (isFiniteTimestamp(value)) return value;
  return undefined;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidVersionKey(value: string): boolean {
  return value.trim().length > 0 && value.length <= 80;
}
