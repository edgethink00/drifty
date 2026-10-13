import { invoke } from "@tauri-apps/api/core";

export const feedbackDiagnosticsInvokeCommands = {
  getNative: "feedback_diagnostics_get_native",
} as const;

/** One recent crash of a Drifty process, read from the OS crash report store. */
export type NativeCrashSummary = {
  readonly incidentId: string;
  readonly kind: string;
  readonly appVersion: string | null;
  readonly occurredAtMs: number;
};

/** System facts the WebView cannot read itself; the macOS user agent reports a frozen OS version. */
export type NativeFeedbackDiagnostics = {
  readonly osName: string;
  readonly osVersion: string | null;
  readonly arch: string;
  readonly recentCrashes: readonly NativeCrashSummary[];
  readonly lastWindowingError: string | null;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Null outside the desktop app or when the native read fails; feedback still sends without it. */
export async function getNativeFeedbackDiagnostics(): Promise<NativeFeedbackDiagnostics | null> {
  if (!isTauriRuntime()) return null;
  try {
    return parseNativeFeedbackDiagnostics(await invoke<unknown>(feedbackDiagnosticsInvokeCommands.getNative));
  } catch {
    return null;
  }
}

export function parseNativeFeedbackDiagnostics(value: unknown): NativeFeedbackDiagnostics | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.osName !== "string" || typeof record.arch !== "string") return null;
  const crashes = Array.isArray(record.recentCrashes) ? record.recentCrashes : [];
  return {
    osName: record.osName,
    osVersion: typeof record.osVersion === "string" ? record.osVersion : null,
    arch: record.arch,
    lastWindowingError: typeof record.lastWindowingError === "string" ? record.lastWindowingError : null,
    recentCrashes: crashes.flatMap((crash): NativeCrashSummary[] => {
      if (!crash || typeof crash !== "object") return [];
      const item = crash as Record<string, unknown>;
      if (typeof item.incidentId !== "string" || typeof item.kind !== "string" || typeof item.occurredAtMs !== "number") return [];
      return [{
        incidentId: item.incidentId,
        kind: item.kind,
        appVersion: typeof item.appVersion === "string" ? item.appVersion : null,
        occurredAtMs: item.occurredAtMs,
      }];
    }),
  };
}
