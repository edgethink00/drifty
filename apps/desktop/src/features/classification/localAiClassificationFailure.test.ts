import { describe, expect, it } from "vitest";

import {
  describeLocalAiClassificationFailure,
  localAiInvalidResponseError,
  localAiProviderResponseError,
  localAiTransportError,
} from "./localAiClassificationFailure";

describe("local AI classification failure evidence", () => {
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
