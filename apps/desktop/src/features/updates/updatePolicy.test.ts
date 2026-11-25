import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GENERAL_PROMPT_AFTER_MS,
  POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY,
  UPDATE_AUTO_INSTALL_STORAGE_KEY,
  UPDATE_BACKGROUND_APPLY_STORAGE_KEY,
  UPDATE_REPROMPT_AFTER_ANSWER_MS,
  compareReleaseVersions,
  fallbackUpdatePolicy,
  clearPostUpdateRelaunchFocusPending,
  consumePostUpdateRelaunchFocusPending,
  fetchUpdatePolicy,
  markUpdateBackgroundPreparationAttempted,
  markUpdateBackgroundPreparationFailed,
  markUpdateInteracted,
  markPostUpdateRelaunchFocusPending,
  msUntilAutomaticDialog,
  normalizeUpdatePolicyMetadata,
  parseUpdateInteractionMap,
  persistBackgroundUpdatesEnabled,
  resolveInitialBackgroundUpdatesEnabled,
  shouldPrepareUpdateInBackground,
  shouldShowAutomaticUpdateDialog,
  updatePolicyUrls,
  upsertUpdateSeen,
} from "./updatePolicy";

const VERSION = "1.0.12";
const RUNNING_VERSION = "1.0.11";
const DAY_MS = 24 * 60 * 60 * 1000;
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks and consumes the optional post-update focus hint once", () => {
    markPostUpdateRelaunchFocusPending();

    expect(window.localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY)).toBe("1");
    expect(consumePostUpdateRelaunchFocusPending()).toBe(true);
    expect(window.localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY)).toBeNull();
    expect(consumePostUpdateRelaunchFocusPending()).toBe(false);
  });

  it.each([
    ["mark", markPostUpdateRelaunchFocusPending],
    ["clear", clearPostUpdateRelaunchFocusPending],
    ["consume", consumePostUpdateRelaunchFocusPending],
  ])("tolerates unavailable localStorage during focus hint %s", (_operation, helper) => {
    Object.defineProperty(window, "localStorage", {
      get: () => { throw new Error("Storage access denied"); },
    });

    expect(() => helper()).not.toThrow();
  });

  it("returns no focus hint when reading storage fails", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("Storage read denied");
    });

    expect(consumePostUpdateRelaunchFocusPending()).toBe(false);
  });

  it("returns a readable focus hint even when its removal fails", () => {
    markPostUpdateRelaunchFocusPending();
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("Storage removal denied");
    });

    expect(consumePostUpdateRelaunchFocusPending()).toBe(true);
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

  it("recognizes the Windows idle-install policy without legacy autoInstall", () => {
    expect(normalizeUpdatePolicyMetadata({
      version: VERSION,
      policyVersion: 2,
      urgency: "general",
      promptAfterHours: 72,
      backgroundDownload: true,
      installBehavior: "idle",
      autoInstall: false,
    }, VERSION)).toEqual(expect.objectContaining({
      backgroundDownloadEligible: true,
      installBehavior: "idle",
    }));
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

    expect(updatePolicyUrls(VERSION)[0]).toBe(
      "https://github.com/edgethink00/drifty/releases/download/1.0.12/update-policy.json",
    );
    expect(fetcher).toHaveBeenCalledWith(updatePolicyUrls(VERSION)[0], expect.objectContaining({ cache: "no-store" }));
    expect(policy.version).toBe(VERSION);
  });

  it("uses the safe manual policy when the Windows release has no policy", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false });

    const policy = await fetchUpdatePolicy(VERSION, fetcher, "windows");

    expect(updatePolicyUrls(VERSION, "windows")).toEqual([
      "https://github.com/edgethink00/drifty/releases/download/1.0.12-win/update-policy.json",
      "https://github.com/edgethink00/drifty_releases/releases/download/1.0.12-win/update-policy.json",
    ]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(updatePolicyUrls(VERSION, "windows"));
    expect(policy).toEqual(fallbackUpdatePolicy(VERSION));
  });

  it("opens the existing native dialog after 72 hours, and not right after the release was handled", () => {
    const policy = fallbackUpdatePolicy(VERSION);
    const seen = upsertUpdateSeen({}, VERSION, NOW_MS, RUNNING_VERSION);
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

  it("asks again a week after the prompt was answered", () => {
    const policy = fallbackUpdatePolicy(VERSION);
    const answeredAtMs = NOW_MS + DEFAULT_GENERAL_PROMPT_AFTER_MS;
    const answered = requireInteraction(markUpdateInteracted(
      upsertUpdateSeen({}, VERSION, NOW_MS, RUNNING_VERSION),
      VERSION,
      answeredAtMs,
    ));

    expect(msUntilAutomaticDialog({ policy, interaction: answered, nowMs: answeredAtMs }))
      .toBe(UPDATE_REPROMPT_AFTER_ANSWER_MS);
    expect(shouldShowAutomaticUpdateDialog({
      policy,
      interaction: answered,
      nowMs: answeredAtMs + UPDATE_REPROMPT_AFTER_ANSWER_MS - 1,
    })).toBe(false);
    expect(shouldShowAutomaticUpdateDialog({
      policy,
      interaction: answered,
      nowMs: answeredAtMs + UPDATE_REPROMPT_AFTER_ANSWER_MS,
    })).toBe(true);
  });

  it("keeps the 72-hour clock and the last answer when a newer release supersedes a pending one", () => {
    const NEWER = "1.0.13";
    const policy = fallbackUpdatePolicy(NEWER);
    const pending = upsertUpdateSeen({}, VERSION, NOW_MS, RUNNING_VERSION);

    // Two days later a newer release appears before the first prompt was due.
    const superseded = upsertUpdateSeen(pending, NEWER, NOW_MS + 2 * DAY_MS, RUNNING_VERSION);
    expect(superseded[NEWER]?.firstSeenAtMs).toBe(NOW_MS);
    expect(shouldShowAutomaticUpdateDialog({
      policy,
      interaction: superseded[NEWER] ?? null,
      nowMs: NOW_MS + DEFAULT_GENERAL_PROMPT_AFTER_MS,
    })).toBe(true);

    // A "Later" on the superseded release still holds for the newer one.
    const answered = markUpdateInteracted(pending, VERSION, NOW_MS + 3 * DAY_MS);
    const afterAnswer = upsertUpdateSeen(answered, NEWER, NOW_MS + 4 * DAY_MS, RUNNING_VERSION);
    expect(afterAnswer[NEWER]?.interactedAtMs).toBe(NOW_MS + 3 * DAY_MS);
    expect(shouldShowAutomaticUpdateDialog({
      policy,
      interaction: afterAnswer[NEWER] ?? null,
      nowMs: NOW_MS + 4 * DAY_MS,
    })).toBe(false);

    // A release that is already installed is no longer pending.
    const installed = upsertUpdateSeen(pending, NEWER, NOW_MS + 2 * DAY_MS, VERSION);
    expect(installed[NEWER]?.firstSeenAtMs).toBe(NOW_MS + 2 * DAY_MS);
  });

  it("orders release versions numerically", () => {
    expect(compareReleaseVersions("1.12.2", "1.11.25")).toBe(1);
    expect(compareReleaseVersions("1.9.4", "1.10.0")).toBe(-1);
    expect(compareReleaseVersions("1.12.2", "1.12.2")).toBe(0);
    expect(compareReleaseVersions("1.12.2-win", "1.12.2")).toBe(0);
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

    const seen = upsertUpdateSeen({}, VERSION, NOW_MS, RUNNING_VERSION);
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
    expect(shouldPrepareUpdateInBackground({
      backgroundPreparationSupported: true,
      backgroundUpdatesEnabled: true,
      policy,
      interaction: requireInteraction(attempted),
      allowPreviouslyAttempted: true,
    })).toBe(true);

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
      allowPreviouslyAttempted: true,
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
