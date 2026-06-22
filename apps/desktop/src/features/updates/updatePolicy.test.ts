import { describe, expect, it } from "vitest";
import {
  DEFAULT_GENERAL_PROMPT_AFTER_MS,
  fallbackUpdatePolicy,
  markUpdateAutoInstallAttempted,
  markUpdateInteracted,
  normalizeUpdatePolicyMetadata,
  parseUpdateInteractionMap,
  shouldAutoInstallUpdate,
  shouldShowAutomaticUpdateDialog,
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
  it("defaults missing policy metadata to a general non-auto-install update", () => {
    const policy = fallbackUpdatePolicy(VERSION);

    expect(policy).toEqual({
      version: VERSION,
      urgency: "general",
      promptAfterMs: DEFAULT_GENERAL_PROMPT_AFTER_MS,
      autoInstallEligible: false,
      message: null,
    });
  });

  it("normalizes urgent metadata for immediate prompts and future auto-install", () => {
    const policy = normalizeUpdatePolicyMetadata({
      version: VERSION,
      urgency: "urgent",
      autoInstall: true,
      message: "Security fix.",
    }, VERSION);

    expect(policy).toEqual({
      version: VERSION,
      urgency: "urgent",
      promptAfterMs: 0,
      autoInstallEligible: true,
      message: "Security fix.",
    });
  });

  it("shows general automatic prompts only after three days without interaction", () => {
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
  });

  it("allows automatic install only for opted-in, eligible, not-yet-attempted releases", () => {
    const policy = normalizeUpdatePolicyMetadata({
      version: VERSION,
      urgency: "general",
      autoInstall: true,
    }, VERSION);
    if (!policy) throw new Error("Expected metadata to normalize");

    const seen = upsertUpdateSeen({}, VERSION, NOW_MS);
    const interaction = requireInteraction(seen);

    expect(shouldAutoInstallUpdate({
      autoInstallFutureUpdates: true,
      policy,
      interaction,
    })).toBe(true);

    const attempted = requireInteraction(markUpdateAutoInstallAttempted(seen, VERSION, NOW_MS + 1));
    expect(shouldAutoInstallUpdate({
      autoInstallFutureUpdates: true,
      policy,
      interaction: attempted,
    })).toBe(false);
  });

  it("ignores malformed persisted interaction state", () => {
    expect(parseUpdateInteractionMap("{bad json")).toEqual({});
    expect(parseUpdateInteractionMap(JSON.stringify({
      [VERSION]: { firstSeenAtMs: NOW_MS, interactedAtMs: null, autoInstallAttemptedAtMs: null },
      malformed: { firstSeenAtMs: "nope" },
    }))).toEqual({
      [VERSION]: { firstSeenAtMs: NOW_MS, interactedAtMs: null, autoInstallAttemptedAtMs: null },
    });
  });
});
