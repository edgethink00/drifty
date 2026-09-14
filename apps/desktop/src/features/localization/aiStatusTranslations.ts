import type { DisplayLanguage, LocalizationController } from "./LocalizationContext";
import type { TranslationKey } from "./translations";

const AI_STATUS_TRANSLATION_KEYS = {
  "Cloud off": "settings.ai.status.cloudOff",
  "Sign-in needed": "settings.ai.status.signInNeeded",
  "Checking cloud": "settings.ai.status.checkingCloud",
  "Drifty Cloud needs attention": "settings.ai.status.cloudNeedsAttention",
  "Drifty Cloud is connected": "settings.ai.status.cloudConnected",
  "Not configured": "settings.ai.status.notConfigured",
  Checking: "settings.ai.status.checking",
  "Needs attention": "settings.ai.status.needsAttention",
  Available: "settings.ai.status.available",
  "AI checking": "settings.ai.status.aiChecking",
  "AI not connected": "settings.ai.status.aiNotConnected",
  "Managed Local AI": "settings.ai.status.managedLocal",
  "Local AI": "settings.ai.status.local",
  Connected: "settings.ai.status.connected",
  "Connection issue": "settings.ai.status.connectionIssue",
  "Key issue": "settings.ai.status.keyIssue",
  "Credits needed": "settings.ai.status.creditsNeeded",
  "Access blocked": "settings.ai.status.accessBlocked",
  "Model unavailable": "settings.ai.status.modelUnavailable",
  "Rate limited": "settings.ai.status.rateLimited",
  "Provider unavailable": "settings.ai.status.providerUnavailable",
  Starting: "settings.ai.status.starting",
  Downloading: "settings.ai.status.downloading",
  "Download failed": "settings.ai.status.downloadFailed",
  "Model missing": "settings.ai.status.modelMissing",
  "Memory needed": "settings.ai.status.memoryNeeded",
  "Storage needed": "settings.ai.status.storageNeeded",
  "Runtime missing": "settings.ai.status.runtimeMissing",
  "Start failed": "settings.ai.status.startFailed",
  // Two independent producers reach this table. The managed runtime resolver
  // emits "Issue" for an unclassified managed-local runtime error, while
  // `labelForIssueKind` emits "Provider error" for a provider HTTP failure.
  // They are different conditions and must not share a key.
  Issue: "settings.ai.status.issue",
  "Provider error": "settings.ai.status.providerError",
  "Classifying…": "settings.ai.status.classifying",
  "AI setup needed": "settings.ai.status.setupNeeded",
  "Open settings": "settings.ai.status.openSettings",
} as const satisfies Readonly<Record<string, TranslationKey>>;

export function localizeAiStatusLabel(value: string, t: LocalizationController["t"]): string {
  const key = AI_STATUS_TRANSLATION_KEYS[value as keyof typeof AI_STATUS_TRANSLATION_KEYS];
  if (key) return t(key);

  const remainingMatch = /^(\d[\d,]*) left$/u.exec(value);
  return remainingMatch ? t("settings.ai.status.remaining", { count: remainingMatch[1] }) : value;
}

export function localizeAiConnectionTestMessage(
  value: string,
  kind: "success" | "error",
  language: DisplayLanguage,
  t: LocalizationController["t"],
): string {
  if (language === "en") return value;

  const connectedMatch = /^Connected in ([\d,.]+) ms\.$/u.exec(value);
  if (connectedMatch) return t("settings.ai.connection.connectedIn", { latency: connectedMatch[1] });

  const cloudConnectedMatch = /^Cloud AI connected via (.+) in ([\d,.]+) ms\.$/u.exec(value);
  if (cloudConnectedMatch) {
    return t("settings.ai.connection.cloudConnectedIn", {
      provider: cloudConnectedMatch[1],
      latency: cloudConnectedMatch[2],
    });
  }

  if (value === "Complete the selected provider settings before testing.") return t("settings.ai.connection.completeSettings");
  if (value === "Provider responded, but no assistant message was returned.") return t("settings.ai.connection.noAssistant");
  if (value === "Supabase is not configured.") return t("settings.ai.connection.supabaseMissing");
  if (value === "Drifty Cloud billing needs attention.") return t("settings.ai.connection.billingAttention");
  if (value === "Cloud AI connection test returned an invalid response.") return t("settings.ai.connection.invalidResponse");
  if (value === "Preview connection simulated.") return t("settings.ai.connection.previewSimulated");
  if (value === "OpenRouter rejected the API key.") return t("settings.ai.connection.openRouterKeyRejected");
  if (value === "OpenRouter credits are required.") return t("settings.ai.connection.openRouterCreditsRequired");
  if (value === "OpenRouter blocked this request.") return t("settings.ai.connection.openRouterAccessBlocked");
  if (value === "The selected OpenRouter model is unavailable.") return t("settings.ai.connection.openRouterModelUnavailable");
  if (value === "OpenRouter is rate limiting requests.") return t("settings.ai.connection.openRouterRateLimited");
  if (value === "OpenRouter has no available provider for this request.") return t("settings.ai.connection.openRouterUnavailable");

  const providerHttpMatch = /^Provider returned HTTP (.+)\.$/u.exec(value);
  if (providerHttpMatch) {
    const status = providerHttpMatch[1];
    return t(status === "401" || status === "403" ? "settings.ai.connection.authFailed" : "settings.ai.connection.providerHttp", { status });
  }

  return t(
    kind === "error" ? "settings.ai.connection.errorDetail" : "settings.ai.connection.successDetail",
    { detail: value },
  );
}
