import type { ConnectionFailure } from "./onboardingFlow";
import type { CliInstall } from "./cliInstall";
import type { PostHogEventPropertiesByName } from "../../lib/analytics/eventTypes";

type PilotEvent = PostHogEventPropertiesByName["onboarding_cli_pilot"];
type FailureReason = NonNullable<PilotEvent["failure_reason"]>;

/** Funnel events for what the entry check found: installed, then signed out if it is; or missing. */
export function cliDetectionEvents(install: CliInstall): ReadonlyArray<{ readonly action: PilotEvent["action"]; readonly failureReason?: FailureReason }> {
  if (install.state === "missing") return [{ action: "missing", failureReason: "not_installed" }];
  if (install.state !== "found") return [];
  return install.signedIn === false ? [{ action: "installed" }, { action: "signed_out" }] : [{ action: "installed" }];
}

/** The coarse reason a CLI connection test failed. */
export function cliTestFailureReason(failure: ConnectionFailure | null): FailureReason {
  if (failure?.kind !== "remote") return "unavailable";
  if (failure.message === "cli_missing") return "not_installed";
  return failure.cliFailureReason ?? "unavailable";
}

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
