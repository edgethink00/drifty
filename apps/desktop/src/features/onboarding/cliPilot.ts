import { supabase } from "../../lib/supabase/client";
import { readProductAnalyticsEnabled } from "../../lib/analytics/productAnalyticsPreference";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import type { PostHogEventPropertiesByName } from "../../lib/analytics/eventTypes";

export const CLI_PILOT_KEY = "onboarding-cli-v1";
export type CliPilotVariant = "control" | "cli";
export type CliSetupChoice = "codex_cli" | "claude_cli";
export function isCliSetupChoice(value: unknown): value is CliSetupChoice { return value === "codex_cli" || value === "claude_cli"; }
export function cliProviderName(value: unknown): string { return value === "codex_cli" ? "Codex CLI" : "Claude Code"; }

export function cliPilotReviewVariant(): CliPilotVariant | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("cliPilot");
  return value === "control" || value === "cli" ? value : null;
}

export async function requestCliPilotAssignment(signal: AbortSignal, action: "assign" | "read" = "assign"): Promise<CliPilotVariant | null> {
  if ((action === "assign" && !readProductAnalyticsEnabled()) || !supabase) return null;
  const { data, error } = await supabase.functions.invoke("onboarding-cli-pilot", { body: { action }, signal });
  if (error || signal.aborted || (action === "assign" && !readProductAnalyticsEnabled())) return null;
  return data?.variant === "cli" || data?.variant === "control" ? data.variant : null;
}

export function readCliPilotAccess(userId: string): boolean {
  try { return localStorage.getItem(`drifty.cliPilot.v1:${userId}`) === "cli"; } catch { return false; }
}

export function rememberCliPilotAccess(userId: string, variant: CliPilotVariant | null): void {
  if (variant === null) return;
  try {
    if (variant === "cli") localStorage.setItem(`drifty.cliPilot.v1:${userId}`, "cli");
    else localStorage.removeItem(`drifty.cliPilot.v1:${userId}`);
  } catch { /* The server remains authoritative. */ }
}

export function recordCliPilot(
  variant: CliPilotVariant | null,
  action: PostHogEventPropertiesByName["onboarding_cli_pilot"]["action"],
  connector: PostHogEventPropertiesByName["onboarding_cli_pilot"]["connector"] = "none",
  failureReason?: PostHogEventPropertiesByName["onboarding_cli_pilot"]["failure_reason"],
): void {
  if (!variant || cliPilotReviewVariant() || !readProductAnalyticsEnabled()) return;
  capturePostHogEvent("onboarding_cli_pilot", { experiment: CLI_PILOT_KEY, variant, action, connector, ...(failureReason ? { failure_reason: failureReason } : {}) });
}
