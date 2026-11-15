import { describe, expect, it } from "vitest";
import { cliDetectionEvents, cliFailure, cliTestFailureReason } from "./cliConnectOutcome";

describe("CLI connect outcomes", () => {
  it("counts a signed-out CLI as installed and as a sign-in barrier", () => {
    expect(cliDetectionEvents({ state: "found", version: "1.0.0", signedIn: false }).map(event => event.action)).toEqual(["installed", "signed_out"]);
    expect(cliDetectionEvents({ state: "found", version: null }).map(event => event.action)).toEqual(["installed"]);
    expect(cliDetectionEvents({ state: "missing" })).toEqual([{ action: "missing", failureReason: "not_installed" }]);
    expect(cliDetectionEvents({ state: "unavailable" })).toEqual([]);
  });

  it("gives a signed-out test the sign-in command and a usage limit none", () => {
    expect(cliFailure({ kind: "remote", message: "x", cliFailureReason: "authentication" })).toEqual({ key: "onboarding.cli.failAuth", command: "login" });
    expect(cliFailure({ kind: "remote", message: "cli_missing" })).toEqual({ key: "onboarding.cli.missing", command: "install" });
    expect(cliFailure({ kind: "remote", message: "x", cliFailureReason: "rate_limited" }).command).toBeUndefined();
    expect(cliTestFailureReason({ kind: "remote", message: "x", cliFailureReason: "timeout" })).toBe("timeout");
    expect(cliTestFailureReason(null)).toBe("unavailable");
  });
});
