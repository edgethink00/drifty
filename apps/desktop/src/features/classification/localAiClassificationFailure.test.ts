import { describe, expect, it } from "vitest";

import { AI_ISSUE_KINDS } from "../../lib/analytics/eventTaxonomy";
import type { AiConnectionIssueKind } from "../ai-connection/aiConnectionHealth";
import {
  describeLocalAiClassificationFailure,
  localAiContextBudgetResponseError,
  localAiInvalidResponseError,
  localAiProviderResponseError,
  localAiTransportError,
  shouldRetryLocalAiWithSmallerBatch,
} from "./localAiClassificationFailure";

describe("local AI classification failure evidence", () => {
  it("treats a native context budget refusal as reachable and eligible for one smaller batch", () => {
    const error = localAiContextBudgetResponseError({ status: 400, body: JSON.stringify({ error: { code: "drifty_context_budget_exceeded" } }) });
    expect(describeLocalAiClassificationFailure(error)).toMatchObject({ failureKind: "content", usedAiProvider: true, connectionEvidence: "reachable" });
    expect(shouldRetryLocalAiWithSmallerBatch(error)).toBe(true);
    for (const response of [
      { status: 500, body: '{"error":{"code":"drifty_context_budget_exceeded"}}' },
      { status: 400, body: '{"error":{"code":"other_error"}}' },
      { status: 400, body: 'context limit exceeded' },
      { status: 400, body: 'null' },
    ]) expect(localAiContextBudgetResponseError(response)).toBeNull();
  });

  it("marks request failures as transport failures without provider contact", () => {
    expect(describeLocalAiClassificationFailure(localAiTransportError(new Error("Connection refused")))).toEqual({
      message: "Connection refused",
      failureKind: "transport",
      usedAiProvider: false,
      connectionEvidence: "failure",
    });
  });

  it("distinguishes rejected HTTP responses from reachable invalid content", () => {
    expect(describeLocalAiClassificationFailure(localAiProviderResponseError("Local AI classification failed with HTTP 500."))).toEqual({
      message: "Local AI classification failed with HTTP 500.",
      failureKind: "content",
      usedAiProvider: true,
      connectionEvidence: "failure",
    });
    expect(describeLocalAiClassificationFailure(localAiInvalidResponseError(new SyntaxError("Unexpected end of JSON input")))).toEqual({
      message: "Local AI returned an invalid or incomplete response. Unexpected end of JSON input",
      failureKind: "content",
      usedAiProvider: true,
      connectionEvidence: "reachable",
    });
  });

  it("does not invent disconnect evidence for unrelated application errors", () => {
    expect(describeLocalAiClassificationFailure(new Error("Tracker database is busy"))).toEqual({
      message: "Tracker database is busy",
      failureKind: "content",
      usedAiProvider: false,
      connectionEvidence: "none",
    });
  });
});

/**
 * The provider rejection path used to render its cause to prose and let
 * telemetry guess the cause back out of that prose. These assertions pin the
 * structured value travelling on the error instead.
 */
describe("local AI classification failure carries the structured cause", () => {
  it("keeps the issue kind from a provider rejection", () => {
    const failure = describeLocalAiClassificationFailure(
      localAiProviderResponseError("OpenRouter credits are required.", "credits"),
    );
    expect(failure.issueKind).toBe("credits");
    expect(failure.failureKind).toBe("content");
    expect(failure.connectionEvidence).toBe("failure");
  });

  it("omits the issue kind when the provider did not name one", () => {
    expect(describeLocalAiClassificationFailure(
      localAiProviderResponseError("Local AI classification failed with HTTP 500."),
    ).issueKind).toBeUndefined();
  });

  it("omits the issue kind for transport and malformed-response failures", () => {
    expect(describeLocalAiClassificationFailure(localAiTransportError(new Error("offline"))).issueKind).toBeUndefined();
    expect(describeLocalAiClassificationFailure(localAiInvalidResponseError(new Error("bad json"))).issueKind).toBeUndefined();
  });

  // App.tsx builds its error summary with `...failure`, so anything this
  // function returns reaches captureAiClassificationRun without a call-site
  // change. Spreading is the whole delivery mechanism; assert it survives.
  it("survives the spread into an analytics summary", () => {
    const failure = describeLocalAiClassificationFailure(
      localAiProviderResponseError("OpenRouter rejected the API key.", "authentication"),
    );
    const summary = { status: "error" as const, selectedSegments: 0, savedRecords: 0, ...failure };
    expect(summary.issueKind).toBe("authentication");
  });
});

describe("analytics AI_ISSUE_KINDS mirrors AiConnectionIssueKind", () => {
  // eventTaxonomy.ts keeps its own literal list to stay free of feature
  // imports. This is the assertion that keeps the two from drifting apart.
  it("lists exactly the connection issue kinds", () => {
    const connectionKinds: readonly AiConnectionIssueKind[] = [
      "network", "provider", "authentication", "credits",
      "access", "model_unavailable", "rate_limited", "unavailable", "entitlement",
    ];
    expect([...AI_ISSUE_KINDS].sort()).toEqual([...connectionKinds].sort());
  });
});
