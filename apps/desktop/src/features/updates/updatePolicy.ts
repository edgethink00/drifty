export type UpdateUrgency = "general" | "urgent";
export type UpdateInstallBehavior = "manual" | "next-launch" | "idle";

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
/**
 * After "Later" (or any other answer to the prompt), wait this long before the
 * automatic prompt may ask again about a still-pending update.
 */
export const UPDATE_REPROMPT_AFTER_ANSWER_MS = 7 * 24 * 60 * 60 * 1000;
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
  // A missing Windows policy must use the safe manual default. The same-number
  // Mac release can carry a different urgency and a Mac-only message.
  return hostPlatform === "windows"
    ? [`${UPDATE_POLICY_RELEASES_URL}/${encodeURIComponent(`${version}-win`)}/update-policy.json`]
    : [updatePolicyUrl(version)];
}

export function normalizeUpdatePolicyMetadata(metadata: unknown, expectedVersion: string): UpdatePolicy | null {
  if (!isRecord(metadata)) return null;

  const version = metadata.version;
  if (typeof version !== "string" || version !== expectedVersion) return null;

  const urgency = normalizeUrgency(metadata.urgency);
  if (!urgency) return null;

  const policyVersion = metadata.policyVersion === 2 ? 2 : 1;
  const promptAfterMs = normalizePromptAfterMs(metadata.promptAfterHours, urgency);
  const installBehavior = policyVersion === 2
    && (metadata.installBehavior === "next-launch" || metadata.installBehavior === "idle")
    ? metadata.installBehavior
    : "manual";
  // `autoInstall` deliberately stays a legacy-only release field. Older
  // clients interpret it as permission to restart immediately, so the new
  // background path is eligible only through policy-v2 fields they ignore.
  const backgroundDownloadEligible = policyVersion === 2
    && metadata.backgroundDownload === true
    && (installBehavior === "next-launch" || installBehavior === "idle");
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
        // A missing or unreachable policy uses the safe manual fallback.
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
  try {
    window.localStorage.setItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY, "1");
  } catch {
    // The optional focus hint must never prevent an installed update's restart.
  }
}

export function clearPostUpdateRelaunchFocusPending(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY);
  } catch {
    // Best-effort cleanup must preserve the original native restart error.
  }
}

export function consumePostUpdateRelaunchFocusPending(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY) !== "1") return false;
    clearPostUpdateRelaunchFocusPending();
    return true;
  } catch {
    return false;
  }
}

/**
 * Orders numeric release versions such as `1.12.2`. A suffix after a hyphen is
 * ignored, and a missing or non-numeric part counts as 0.
 */
export function compareReleaseVersions(left: string, right: string): number {
  const parts = (value: string) => value.split("-")[0].split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Records the first time this install saw `version`.
 *
 * A release that supersedes a still-pending one (newer than `runningVersion`)
 * inherits the earliest pending first-seen time and the latest answer to the
 * prompt. Otherwise every new release would restart the 72-hour wait, and with
 * releases a few days apart the prompt would rarely appear for anyone whose
 * background update is off or failing.
 */
export function upsertUpdateSeen(
  interactions: UpdateInteractionMap,
  version: string,
  nowMs: number,
  runningVersion: string,
): UpdateInteractionMap {
  const current = interactions[version];
  if (current) return interactions;

  const pending = Object.entries(interactions)
    .filter(([pendingVersion]) => compareReleaseVersions(pendingVersion, runningVersion) > 0
      && compareReleaseVersions(pendingVersion, version) < 0)
    .map(([, interaction]) => interaction);
  const firstSeenAtMs = Math.min(nowMs, ...pending.map((interaction) => interaction.firstSeenAtMs));
  const answeredAt = pending
    .map((interaction) => interaction.interactedAtMs)
    .filter((value): value is number => value !== null);

  return {
    ...interactions,
    [version]: {
      firstSeenAtMs,
      interactedAtMs: answeredAt.length > 0 ? Math.max(...answeredAt) : null,
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

function automaticDialogDueAtMs(input: {
  readonly policy: UpdatePolicy;
  readonly interaction: UpdateInteraction | null;
  readonly nowMs: number;
}): number {
  const firstSeenAtMs = input.interaction?.firstSeenAtMs ?? input.nowMs;
  const answeredAtMs = input.interaction?.interactedAtMs;
  const promptDueAtMs = firstSeenAtMs + input.policy.promptAfterMs;
  return answeredAtMs === null || answeredAtMs === undefined
    ? promptDueAtMs
    : Math.max(promptDueAtMs, answeredAtMs + UPDATE_REPROMPT_AFTER_ANSWER_MS);
}

export function shouldShowAutomaticUpdateDialog(input: {
  readonly policy: UpdatePolicy;
  readonly interaction: UpdateInteraction | null;
  readonly nowMs: number;
}): boolean {
  if (input.policy.urgency === "urgent") return true;
  return input.nowMs >= automaticDialogDueAtMs(input);
}

export function shouldPrepareUpdateInBackground(input: {
  readonly backgroundPreparationSupported: boolean;
  readonly backgroundUpdatesEnabled: boolean;
  readonly policy: UpdatePolicy;
  readonly interaction: UpdateInteraction | null;
  readonly allowPreviouslyAttempted?: boolean;
}): boolean {
  if (!input.backgroundPreparationSupported) return false;
  if (!input.backgroundUpdatesEnabled) return false;
  if (!input.policy.backgroundDownloadEligible) return false;
  if ((input.interaction?.backgroundPreparationFailureCount ?? 0) >= MAX_BACKGROUND_PREPARATION_FAILURES) return false;
  if (input.allowPreviouslyAttempted) return true;
  return input.interaction?.backgroundPreparationAttemptedAtMs === null
    || input.interaction?.backgroundPreparationAttemptedAtMs === undefined;
}

export function msUntilAutomaticDialog(input: {
  readonly policy: UpdatePolicy;
  readonly interaction: UpdateInteraction | null;
  readonly nowMs: number;
}): number | null {
  if (input.policy.urgency === "urgent") return null;
  return Math.max(0, automaticDialogDueAtMs(input) - input.nowMs);
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
