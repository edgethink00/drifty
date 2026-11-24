import { describe, expect, it } from "vitest";
import { cliFailure } from "./cliConnectOutcome";

describe("CLI connect outcomes", () => {
  it("gives a signed-out test the sign-in command and a usage limit none", () => {
    expect(cliFailure({ kind: "remote", message: "x", cliFailureReason: "authentication" })).toEqual({ key: "onboarding.cli.failAuth", command: "login" });
    expect(cliFailure({ kind: "remote", message: "cli_missing" })).toEqual({ key: "onboarding.cli.missing", command: "install" });
    expect(cliFailure({ kind: "remote", message: "x", cliFailureReason: "rate_limited" }).command).toBeUndefined();
  });
});
