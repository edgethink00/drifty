import { describe, expect, it } from "vitest";
import { CLI_FAILURE_MESSAGES, CLI_INVALID_PROBE_MESSAGE, cliFailureReasonFromMessage } from "./cliFailure";

describe("cliFailureReasonFromMessage", () => {
  it("reads every CLI failure back from its one message", () => {
    for (const reason of ["not_installed", "authentication", "rate_limited", "timeout", "invalid_response", "unavailable"] as const) {
      expect(cliFailureReasonFromMessage(CLI_FAILURE_MESSAGES[reason])).toBe(reason);
    }
    expect(cliFailureReasonFromMessage(CLI_INVALID_PROBE_MESSAGE)).toBe("invalid_response");
  });

  it("recognizes the native runner's missing-executable error", () => {
    expect(cliFailureReasonFromMessage("claude is not installed or not on this computer's PATH.")).toBe("not_installed");
  });

  it("leaves other providers' messages and the shared cancellation wording alone", () => {
    expect(cliFailureReasonFromMessage("OpenRouter rejected the API key.")).toBeNull();
    expect(cliFailureReasonFromMessage("Connection refused")).toBeNull();
    expect(cliFailureReasonFromMessage(CLI_FAILURE_MESSAGES.cancelled)).toBeNull();
    expect(cliFailureReasonFromMessage("")).toBeNull();
  });
});

