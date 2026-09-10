import { describe, expect, it } from "vitest";

import { openRouterConnectionFailureMessage } from "../../features/ai-connection/openRouterError";
import type { AiConnectionIssueKind } from "../../features/ai-connection/aiConnectionHealth";
import { toAnalyticsErrorKind } from "./eventHelpers";

/**
 * WARNING TO A FUTURE READER: this file pins a DEFECT, not a specification.
 *
 * `toAnalyticsErrorKind` recovers an analytics bucket by substring-matching a
 * human-readable message. The AI classification path already computed a precise
 * `AiConnectionIssueKind` from the HTTP status and the provider's structured
 * error body, then rendered it to prose, and this function re-derives a coarser
 * label from that prose. Four distinct causes collapse into `unknown`.
 *
 * If these assertions started failing because you carried `issueKind` into
 * telemetry or reordered the matching rules, that is the intended outcome.
 * Rewrite this file to describe the improved mapping. Do not restore the old
 * behaviour to make the file pass again.
 *
 * Plan: docs/plans/2026-09-10-ai-failure-vocabulary-alignment.md
 */
describe("toAnalyticsErrorKind: known loss when re-deriving AI failures from prose", () => {
  const cases: readonly (readonly [AiConnectionIssueKind, string])[] = [
    ["authentication", "unknown"],
    ["credits", "unknown"],
    ["access", "unknown"],
    ["network", "unknown"],
    ["model_unavailable", "provider_error"],
    ["unavailable", "provider_error"],
    ["provider", "provider_error"],
    ["rate_limited", "rate_limited"],
  ];

  for (const [issueKind, expected] of cases) {
    const verdict = issueKind === expected ? "survives as" : "degrades to";
    it(`${issueKind} ${verdict} ${expected}`, () => {
      const message = openRouterConnectionFailureMessage(issueKind, 500);
      expect(toAnalyticsErrorKind(message)).toBe(expected);
    });
  }

  it("collapses four distinct issue kinds into a single unknown bucket", () => {
    const collapsed = cases
      .filter(([, expected]) => expected === "unknown")
      .map(([issueKind]) => issueKind);
    expect(collapsed).toEqual(["authentication", "credits", "access", "network"]);
  });

  it("preserves only rate_limited faithfully", () => {
    const faithful = cases.filter(([issueKind, expected]) => issueKind === expected);
    expect(faithful).toHaveLength(1);
  });
});

describe("toAnalyticsErrorKind: rule ordering that causes the loss", () => {
  // "model" is tested before "unavailable", so a model-availability failure is
  // reported as a generic provider error. Pinned so the ordering cannot change
  // silently, not because this ordering is correct.
  it("lets the model rule shadow the unavailable rule", () => {
    expect(toAnalyticsErrorKind("The selected OpenRouter model is unavailable.")).toBe("provider_error");
  });

  it("has no bucket for provider credit exhaustion", () => {
    expect(toAnalyticsErrorKind("OpenRouter credits are required.")).toBe("unknown");
  });
});
