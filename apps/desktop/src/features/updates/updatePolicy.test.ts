import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GENERAL_PROMPT_AFTER_MS,
  UPDATE_AUTO_INSTALL_STORAGE_KEY,
  UPDATE_BACKGROUND_APPLY_STORAGE_KEY,
  fallbackUpdatePolicy,
  fetchUpdatePolicy,
  markUpdateBackgroundPreparationAttempted,
  markUpdateBackgroundPreparationFailed,
  markUpdateInteracted,
  normalizeUpdatePolicyMetadata,
  parseUpdateInteractionMap,
  persistBackgroundUpdatesEnabled,
  resolveInitialBackgroundUpdatesEnabled,
  shouldPrepareUpdateInBackground,
  shouldShowAutomaticUpdateDialog,
  updatePolicyUrl,
  upsertUpdateSeen,
} from "./updatePolicy";

const VERSION = "1.0.12";
const NOW_MS = Date.UTC(2026, 5, 22, 0, 0, 0, 0);

function requireInteraction(map: ReturnType<typeof upsertUpdateSeen>) {
  const interaction = map[VERSION];
  if (!interaction) throw new Error("Expected interaction to be present");
  return interaction;
}

describe("updatePolicy", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  it("defaults missing policy metadata to the existing 72-hour manual prompt policy", () => {
    expect(fallbackUpdatePolicy(VERSION)).toEqual({
      version: VERSION,
      policyVersion: 1,
      urgency: "general",
      promptAfterMs: DEFAULT_GENERAL_PROMPT_AFTER_MS,
      backgroundDownloadEligible: false,
      installBehavior: "manual",
      message: null,
    });
  });

  it("normalizes policy-v2 next-launch preparation metadata", () => {
    expect(normalizeUpdatePolicyMetadata({
      version: VERSION,
      policyVersion: 2,
      urgency: "general",
      promptAfterHours: 72,
      backgroundDownload: true,
      installBehavior: "next-launch",
      message: "Stability fixes.",
    }, VERSION)).toEqual({
      version: VERSION,
      policyVersion: 2,
      urgency: "general",
      promptAfterMs: DEFAULT_GENERAL_PROMPT_AFTER_MS,
      backgroundDownloadEligible: true,
      installBehavior: "next-launch",
      message: "Stability fixes.",
    });
  });

  it("never converts legacy autoInstall metadata into background permission", () => {
    const policy = normalizeUpdatePolicyMetadata({
      version: VERSION,
      urgency: "general",
      promptAfterHours: 72,
      autoInstall: true,
    }, VERSION);

    expect(policy).toEqual(expect.objectContaining({
      policyVersion: 1,
      promptAfterMs: DEFAULT_GENERAL_PROMPT_AFTER_MS,
      backgroundDownloadEligible: false,
      installBehavior: "manual",
    }));
  });

  it("fetches policy metadata from the matching versioned release", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        version: VERSION,
        urgency: "general",
        autoInstall: false,
      }),
    });

    const policy = await fetchUpdatePolicy(VERSION, fetcher);

    expect(updatePolicyUrl(VERSION)).toBe(
      "https://github.com/edgethink00/drifty_releases/releases/download/1.0.12/update-policy.json",
    );
    expect(fetcher).toHaveBeenCalledWith(updatePolicyUrl(VERSION), expect.objectContaining({ cache: "no-store" }));
    expect(policy.version).toBe(VERSION);
  });

  it("opens the existing native dialog after 72 hours, unless the release was handled", () => {
    const policy = fallbackUpdatePolicy(VERSION);
    const seen = upsertUpdateSeen({}, VERSION, NOW_MS);
    const interaction = requireInteraction(seen);

    expect(shouldShowAutomaticUpdateDialog({
      policy,
      interaction,
      nowMs: NOW_MS + DEFAULT_GENERAL_PROMPT_AFTER_MS - 1,
    })).toBe(false);
    expect(shouldShowAutomaticUpdateDialog({
      policy,
      interaction,
      nowMs: NOW_MS + DEFAULT_GENERAL_PROMPT_AFTER_MS,
    })).toBe(true);

    const interacted = requireInteraction(markUpdateInteracted(seen, VERSION, NOW_MS + 1));
    expect(shouldShowAutomaticUpdateDialog({
      policy,
      interaction: interacted,
      nowMs: NOW_MS + DEFAULT_GENERAL_PROMPT_AFTER_MS,
    })).toBe(false);

    const urgent = normalizeUpdatePolicyMetadata({
      version: VERSION,
      urgency: "urgent",
      message: "Data loss fix.",
    }, VERSION);
    if (!urgent) throw new Error("Expected urgent policy");
    expect(shouldShowAutomaticUpdateDialog({ policy: urgent, interaction, nowMs: NOW_MS })).toBe(true);
  });

  it("prepares only opted-in v2 releases and stops after three failures", () => {
    const policy = normalizeUpdatePolicyMetadata({
      version: VERSION,
      policyVersion: 2,
      urgency: "general",
      backgroundDownload: true,
      installBehavior: "next-launch",
    }, VERSION);
    if (!policy) throw new Error("Expected metadata to normalize");

    const seen = upsertUpdateSeen({}, VERSION, NOW_MS);
    expect(shouldPrepareUpdateInBackground({
      backgroundPreparationSupported: true,
      backgroundUpdatesEnabled: true,
      policy,
      interaction: requireInteraction(seen),
    })).toBe(true);
    expect(shouldPrepareUpdateInBackground({
      backgroundPreparationSupported: true,
      backgroundUpdatesEnabled: false,
      policy,
      interaction: requireInteraction(seen),
    })).toBe(false);
    expect(shouldPrepareUpdateInBackground({
      backgroundPreparationSupported: false,
      backgroundUpdatesEnabled: true,
      policy,
      interaction: requireInteraction(seen),
    })).toBe(false);

    const attempted = markUpdateBackgroundPreparationAttempted(seen, VERSION, NOW_MS + 1);
    expect(shouldPrepareUpdateInBackground({
      backgroundPreparationSupported: true,
      backgroundUpdatesEnabled: true,
      policy,
      interaction: requireInteraction(attempted),
    })).toBe(false);

    const failedOnce = markUpdateBackgroundPreparationFailed(attempted, VERSION);
    const attemptedTwice = markUpdateBackgroundPreparationAttempted(failedOnce, VERSION, NOW_MS + 2);
    const failedTwice = markUpdateBackgroundPreparationFailed(attemptedTwice, VERSION);
    const attemptedThrice = markUpdateBackgroundPreparationAttempted(failedTwice, VERSION, NOW_MS + 3);
    const failedThrice = markUpdateBackgroundPreparationFailed(attemptedThrice, VERSION);
    expect(shouldPrepareUpdateInBackground({
      backgroundPreparationSupported: true,
      backgroundUpdatesEnabled: true,
      policy,
      interaction: requireInteraction(failedThrice),
    })).toBe(false);
  });

  it("migrates interaction and preference storage without reviving legacy restarts", () => {
    expect(parseUpdateInteractionMap(JSON.stringify({
      [VERSION]: { firstSeenAtMs: NOW_MS, interactedAtMs: null, autoInstallAttemptedAtMs: NOW_MS + 1 },
      malformed: { firstSeenAtMs: "nope" },
    }))).toEqual({
      [VERSION]: {
        firstSeenAtMs: NOW_MS,
        interactedAtMs: null,
        backgroundPreparationAttemptedAtMs: NOW_MS + 1,
        backgroundPreparationFailureCount: 0,
      },
    });

    expect(resolveInitialBackgroundUpdatesEnabled()).toBe(true);
    window.localStorage.setItem(UPDATE_AUTO_INSTALL_STORAGE_KEY, "0");
    expect(resolveInitialBackgroundUpdatesEnabled()).toBe(false);
    window.localStorage.setItem(UPDATE_AUTO_INSTALL_STORAGE_KEY, "1");
    expect(resolveInitialBackgroundUpdatesEnabled()).toBe(true);

    persistBackgroundUpdatesEnabled(true);
    expect(window.localStorage.getItem(UPDATE_BACKGROUND_APPLY_STORAGE_KEY)).toBe("1");
    expect(window.localStorage.getItem(UPDATE_AUTO_INSTALL_STORAGE_KEY)).toBe("0");
  });
});
