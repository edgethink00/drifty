import type { PetModeWindowsDpiEvents } from "./petModeBridge";

function formatReceiptUtc(atMs: number | undefined): string {
  if (atMs === undefined) return "none";
  if (!Number.isFinite(atMs)) return "unavailable";
  const date = new Date(atMs);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(11, 23)}Z` : "unavailable";
}

function formatOptionalCount(count: number | undefined): string {
  return count === undefined ? "unavailable" : String(count);
}

/** Format allowlisted numbers only, keeping native ingress and Tauri delivery separate. */
export function formatPetModeDpiEventReceipts(events: PetModeWindowsDpiEvents): readonly {
  readonly label: string;
  readonly text: string;
}[] {
  const dpi = events.nativeLastDpiX !== undefined && events.nativeLastDpiY !== undefined
    ? `${events.nativeLastDpiX}×${events.nativeLastDpiY}`
    : "none";
  const scale = events.tauriLastScaleFactor !== undefined
    ? `${Math.round(events.tauriLastScaleFactor * 100)}%`
    : "none";
  return [
    {
      label: "WM DPI",
      text: `WM_DPICHANGED · count ${events.nativeMessageCount} · DPI ${dpi} · last ${formatReceiptUtc(events.nativeLastAtMs)}`,
    },
    {
      label: "Tauri DPI",
      text: `ScaleFactorChanged · count ${events.tauriScaleChangeCount} · scale ${scale} · last ${formatReceiptUtc(events.tauriLastAtMs)}`,
    },
    {
      label: "WM setting",
      text: `WM_SETTINGCHANGE · count ${formatOptionalCount(events.settingChangeCount)} · wParam ${events.settingChangeLastWparam ?? (events.settingChangeCount === undefined ? "unavailable" : "none")} · last ${events.settingChangeCount === undefined ? "unavailable" : formatReceiptUtc(events.settingChangeLastAtMs)}`,
    },
    {
      label: "WM display",
      text: `WM_DISPLAYCHANGE · count ${formatOptionalCount(events.displayChangeCount)} · last ${events.displayChangeCount === undefined ? "unavailable" : formatReceiptUtc(events.displayChangeLastAtMs)}`,
    },
    {
      label: "Frame policy",
      text: `FRAMECHANGED policy call · attempts ${formatOptionalCount(events.policyFrameChangeCount)} · last ${events.policyFrameChangeCount === undefined ? "unavailable" : formatReceiptUtc(events.policyFrameChangeLastAtMs)}`,
    },
  ];
}
