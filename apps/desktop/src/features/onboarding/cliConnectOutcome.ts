import type { ConnectionFailure } from "./onboardingFlow";
export type CliFailureKey = "onboarding.cli.failed" | "onboarding.cli.missing" | "onboarding.cli.failAuth" | "onboarding.cli.failRateLimited" | "onboarding.cli.failTimeout";

/** What to say, and which command fixes it, for each way a CLI test fails. */
export function cliFailure(failure: ConnectionFailure | null): { readonly key: CliFailureKey; readonly command?: "install" | "login" } {
  if (failure?.kind !== "remote") return { key: "onboarding.cli.failed" };
  if (failure.message === "cli_missing") return { key: "onboarding.cli.missing", command: "install" };
  switch (failure.cliFailureReason) {
    case "authentication": return { key: "onboarding.cli.failAuth", command: "login" };
    case "rate_limited": return { key: "onboarding.cli.failRateLimited" };
    case "timeout": return { key: "onboarding.cli.failTimeout" };
    default: return { key: "onboarding.cli.failed" };
  }
}
