export type UpdateUrgency = "general" | "urgent";
export type UpdateInstallBehavior = "manual" | "next-launch";

export type UpdatePolicy = {
  readonly version: string;
  readonly policyVersion: 1 | 2;
  readonly urgency: UpdateUrgency;
  readonly promptAfterMs: number;
  readonly backgroundDownloadEligible: boolean;
  readonly installBehavior: UpdateInstallBehavior;
  readonly message: string | null;
};

export type UpdateInteraction = {
  readonly firstSeenAtMs: number;
  readonly interactedAtMs: number | null;
  readonly backgroundPreparationAttemptedAtMs: number | null;
  readonly backgroundPreparationFailureCount: number;
};

export type UpdateInteractionMap = Record<string, UpdateInteraction>;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const UPDATE_POLICY_RELEASES_URL = "https://github.com/edgethink00/drifty_releases/releases/download";
export const UPDATE_AUTO_INSTALL_STORAGE_KEY = "drifty.updates.autoInstallFuture";
export const UPDATE_BACKGROUND_APPLY_STORAGE_KEY = "drifty.updates.backgroundApply.v2";
export const UPDATE_INTERACTION_STORAGE_KEY = "drifty.updates.interactions.v1";
export const POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY = "drifty.updates.focusAfterRelaunch";
export const DEFAULT_GENERAL_PROMPT_AFTER_MS = 72 * 60 * 60 * 1000;
const UPDATE_POLICY_FETCH_TIMEOUT_MS = 4000;
const MAX_BACKGROUND_PREPARATION_FAILURES = 3;

export function fallbackUpdatePolicy(version: string): UpdatePolicy {
  return {
    version,
    policyVersion: 1,
    urgency: "general",
    promptAfterMs: DEFAULT_GENERAL_PROMPT_AFTER_MS,
    backgroundDownloadEligible: false,
    installBehavior: "manual",
    message: null,
  };
}

export function updatePolicyUrl(version: string): string {
  return `${UPDATE_POLICY_RELEASES_URL}/${encodeURIComponent(version)}/update-policy.json`;
}

export function updatePolicyUrls(
  version: string,
  hostPlatform: "macos" | "windows" | "other" = "other",
): string[] {
  const legacyUrl = updatePolicyUrl(version);
  return hostPlatform === "windows"
    ? [`${UPDATE_POLICY_RELEASES_URL}/${encodeURIComponent(`${version}-win`)}/update-policy.json`, legacyUrl]
    : [legacyUrl];
}

export function normalizeUpdatePolicyMetadata(metadata: unknown, expectedVersion: string): UpdatePolicy | null {
  if (!isRecord(metadata)) return null;

  const version = metadata.version;
  if (typeof version !== "string" || version !== expectedVersion) return null;

  const urgency = normalizeUrgency(metadata.urgency);
  if (!urgency) return null;

  const policyVersion = metadata.policyVersion === 2 ? 2 : 1;
  const promptAfterMs = normalizePromptAfterMs(metadata.promptAfterHours, urgency);
  const installBehavior = policyVersion === 2 && metadata.installBehavior === "next-launch"
    ? "next-launch"
    : "manual";
  // `autoInstall` deliberately stays a legacy-only release field. Older
  // clients interpret it as permission to restart immediately, so the new
  // background path is eligible only through policy-v2 fields they ignore.
  const backgroundDownloadEligible = policyVersion === 2
    && metadata.backgroundDownload === true
    && installBehavior === "next-launch";
  const message = typeof metadata.message === "string" && metadata.message.trim().length > 0
    ? metadata.message.trim()
    : null;

  return {
    version,
    policyVersion,
    urgency,
    promptAfterMs,
    backgroundDownloadEligible,
    installBehavior,
    message,
  };
}

export async function fetchUpdatePolicy(
  version: string,
  fetcher: FetchLike = globalThis.fetch,
  hostPlatform: "macos" | "windows" | "other" = "other",
): Promise<UpdatePolicy> {
  if (typeof fetcher !== "function") return fallbackUpdatePolicy(version);

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? globalThis.setTimeout(() => controller.abort(), UPDATE_POLICY_FETCH_TIMEOUT_MS)
    : null;

  try {
    for (const url of updatePolicyUrls(version, hostPlatform)) {
      try {
        const response = await fetcher(url, {
          cache: "no-store",
          signal: controller?.signal,
        });
        if (!response.ok) continue;

        const metadata: unknown = await response.json();
        const policy = normalizeUpdatePolicyMetadata(metadata, version);
        if (policy) return policy;
      } catch {
        // A platform pointer may be absent during the bridge. Try the legacy
        // immutable release tag before falling back to the safe manual policy.
      }
    }
    return fallbackUpdatePolicy(version);
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
      const backgroundPreparationAttemptedAtMs = normalizeNullableTimestamp(
        value.backgroundPreparationAttemptedAtMs ?? value.autoInstallAttemptedAtMs,
      );
      const backgroundPreparationFailureCount = normalizeFailureCount(value.backgroundPreparationFailureCount);
      if (interactedAtMs === undefined || backgroundPreparationAttemptedAtMs === undefined) continue;

      next[version] = {
        firstSeenAtMs,
        interactedAtMs,
        backgroundPreparationAttemptedAtMs,
        backgroundPreparationFailureCount,
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

export function resolveInitialBackgroundUpdatesEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const savedValue = window.localStorage.getItem(UPDATE_BACKGROUND_APPLY_STORAGE_KEY);
  if (savedValue === "1" || savedValue === "0") return savedValue === "1";

  const legacyValue = window.localStorage.getItem(UPDATE_AUTO_INSTALL_STORAGE_KEY);
  if (legacyValue === "1" || legacyValue === "0") return legacyValue === "1";

  // Existing clients have already persisted the legacy default (`0`). A
  // missing legacy key therefore identifies a new install and opts it into the
  // gentler next-launch behavior, not the retired immediate-restart behavior.
  return true;
}

export function persistBackgroundUpdatesEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(UPDATE_BACKGROUND_APPLY_STORAGE_KEY, enabled ? "1" : "0");
  // Keep downgraded/older clients fail-safe even after a user opts into the v2
  // behavior. Policy-v2 is the only path that may prepare updates silently.
  window.localStorage.setItem(UPDATE_AUTO_INSTALL_STORAGE_KEY, "0");
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
      backgroundPreparationAttemptedAtMs: null,
      backgroundPreparationFailureCount: 0,
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
      backgroundPreparationAttemptedAtMs: current?.backgroundPreparationAttemptedAtMs ?? null,
      backgroundPreparationFailureCount: current?.backgroundPreparationFailureCount ?? 0,
    },
  };
}

export function markUpdateBackgroundPreparationAttempted(
  interactions: UpdateInteractionMap,
  version: string,
  nowMs: number,
): UpdateInteractionMap {
  const current = interactions[version];
  return {
    ...interactions,
    [version]: {
      firstSeenAtMs: current?.firstSeenAtMs ?? nowMs,
      interactedAtMs: current?.interactedAtMs ?? null,
      backgroundPreparationAttemptedAtMs: nowMs,
      backgroundPreparationFailureCount: current?.backgroundPreparationFailureCount ?? 0,
    },
  };
}

export function markUpdateBackgroundPreparationFailed(
  interactions: UpdateInteractionMap,
  version: string,
): UpdateInteractionMap {
  const current = interactions[version];
  if (!current) return interactions;
  return {
    ...interactions,
    [version]: {
      ...current,
      backgroundPreparationAttemptedAtMs: null,
      backgroundPreparationFailureCount: Math.min(
        MAX_BACKGROUND_PREPARATION_FAILURES,
        current.backgroundPreparationFailureCount + 1,
      ),
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

export function shouldPrepareUpdateInBackground(input: {
  readonly backgroundPreparationSupported: boolean;
  readonly backgroundUpdatesEnabled: boolean;
  readonly policy: UpdatePolicy;
  readonly interaction: UpdateInteraction | null;
}): boolean {
  if (!input.backgroundPreparationSupported) return false;
  if (!input.backgroundUpdatesEnabled) return false;
  if (!input.policy.backgroundDownloadEligible) return false;
  if ((input.interaction?.backgroundPreparationFailureCount ?? 0) >= MAX_BACKGROUND_PREPARATION_FAILURES) return false;
  return input.interaction?.backgroundPreparationAttemptedAtMs === null
    || input.interaction?.backgroundPreparationAttemptedAtMs === undefined;
}

export function msUntilAutomaticDialog(input: {
  readonly policy: UpdatePolicy;
  readonly interaction: UpdateInteraction | null;
  readonly nowMs: number;
}): number | null {
  if (input.policy.urgency === "urgent") return null;
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

function normalizeFailureCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return 0;
  return Math.min(MAX_BACKGROUND_PREPARATION_FAILURES, value);
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
