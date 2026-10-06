import { describe, expect, it } from "vitest";

import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS } from "../localization/translations";
import type { AiConnectionIssueKind } from "./aiConnectionHealth";
import {
  AI_FAILURE_TRACKING_CONTINUES_KEY,
  aiFailureGuidance,
  aiFailureGuidanceKeys,
  aiFailureResolvesWithoutUser,
} from "./aiFailureGuidance";

// Listing the kinds explicitly makes a new issue kind fail this file rather
// than silently ship without guidance copy.
const ALL_ISSUE_KINDS = [
  "network",
  "provider",
  "entitlement",
  "authentication",
  "credits",
  "access",
  "model_unavailable",
  "rate_limited",
  "unavailable",
] as const satisfies readonly AiConnectionIssueKind[];

// Mirrors the sidebar recovery card: only rate limiting and provider capacity
// clear up without the user. Changing this list changes whether the sidebar
// offers a recovery card, so it is not a copy-only decision.
const ACTIONABLE_KINDS: readonly AiConnectionIssueKind[] = [
  "authentication",
  "credits",
  "access",
  "model_unavailable",
  "network",
  "provider",
  "entitlement",
];

describe("aiFailureGuidance", () => {
  it("covers every AI connection issue kind", () => {
    for (const kind of ALL_ISSUE_KINDS) {
      expect(aiFailureGuidance(kind).kind).toBe(kind);
    }
  });

  it("marks only the failures the user can resolve as needing action", () => {
    for (const kind of ALL_ISSUE_KINDS) {
      expect(aiFailureGuidance(kind).needsUserAction).toBe(ACTIONABLE_KINDS.includes(kind));
    }
  });

  it("gives every actionable failure a concrete next step", () => {
    for (const kind of ACTIONABLE_KINDS) {
      expect(aiFailureGuidance(kind).nextStepKey).not.toBeNull();
    }
  });

  it("does not ask the user to act on failures that retry on their own", () => {
    for (const kind of ALL_ISSUE_KINDS.filter((kind) => !ACTIONABLE_KINDS.includes(kind))) {
      expect(aiFailureGuidance(kind).nextStepKey).toBeNull();
    }
  });

  it("always closes with the tracking-continues reassurance", () => {
    for (const kind of ALL_ISSUE_KINDS) {
      const keys = aiFailureGuidanceKeys(kind);
      expect(keys[keys.length - 1]).toBe(AI_FAILURE_TRACKING_CONTINUES_KEY);
      expect(keys[0]).toBe(aiFailureGuidance(kind).headlineKey);
    }
  });

  // The AI status pill localizes by looking up English source text, so a
  // missing translation degrades to English instead of throwing. These
  // assertions are the only thing that catches that.
  it("resolves every guidance key in both shipped languages", () => {
    for (const kind of ALL_ISSUE_KINDS) {
      for (const key of aiFailureGuidanceKeys(kind)) {
        expect(ENGLISH_TRANSLATIONS[key], `missing en copy for ${key}`).toBeTruthy();
        expect(KOREAN_TRANSLATIONS[key], `missing ko copy for ${key}`).toBeTruthy();
        expect(KOREAN_TRANSLATIONS[key]).not.toBe(ENGLISH_TRANSLATIONS[key]);
      }
    }
  });

  // SidebarCtaSlot.isSidebarRecoveryIssue delegates here. Before that, it
  // carried its own list and the two surfaces disagreed about network and
  // provider: the card told users to check something while the tooltip told
  // them to wait. This pins the shared answer.
  it("treats only rate limiting and provider capacity as self-resolving", () => {
    const selfResolving = ALL_ISSUE_KINDS.filter((kind) => aiFailureResolvesWithoutUser(kind));
    expect([...selfResolving].sort()).toEqual(["rate_limited", "unavailable"]);
  });
});
