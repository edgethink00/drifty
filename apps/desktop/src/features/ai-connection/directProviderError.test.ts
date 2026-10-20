import { describe, expect, it } from "vitest";

import { aiConnectionIssueKindFromMessage } from "./aiConnectionHealth";
import { directProviderFailureMessage, directProviderIssueKindFromStatus } from "./directProviderError";

describe("direct provider errors", () => {
  it.each([
    [401, "authentication"],
    [402, "credits"],
    [403, "access"],
    [404, "model_unavailable"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [503, "unavailable"],
    [529, "unavailable"],
    [400, "provider"],
    [0, "provider"],
  ] as const)("maps HTTP %i to %s", (status, kind) => {
    expect(directProviderIssueKindFromStatus(status)).toBe(kind);
  });

  it("writes messages that the connection health classifier reads back as the same issue", () => {
    for (const status of [401, 402, 403, 404, 429, 503]) {
      for (const label of ["OpenAI", "Anthropic"] as const) {
        const kind = directProviderIssueKindFromStatus(status);
        expect(aiConnectionIssueKindFromMessage(directProviderFailureMessage(label, kind, status))).toBe(kind);
      }
    }
  });

  it("names the provider and keeps the HTTP status for unclassified failures", () => {
    expect(directProviderFailureMessage("Anthropic", "authentication", 401)).toBe("Anthropic rejected the API key.");
    expect(directProviderFailureMessage("OpenAI", "provider", 400)).toBe("Provider returned HTTP 400.");
  });
});
