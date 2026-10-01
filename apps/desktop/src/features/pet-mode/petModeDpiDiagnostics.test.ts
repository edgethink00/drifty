import { describe, expect, it } from "vitest";
import { formatPetModeDpiEventReceipts } from "./petModeDpiDiagnostics";

describe("pet DPI event receipt formatting", () => {
  it("keeps a native-only return receipt distinct from the older Tauri scale receipt", () => {
    const rows = formatPetModeDpiEventReceipts({
      nativeMessageCount: 2,
      nativeLastDpiX: 144,
      nativeLastDpiY: 144,
      nativeLastAtMs: Date.parse("2026-09-30T13:04:14.567Z"),
      tauriScaleChangeCount: 1,
      tauriLastScaleFactor: 1.75,
      tauriLastAtMs: Date.parse("2026-09-30T13:02:18.123Z"),
    });
    expect(rows.slice(0, 2)).toEqual([
      { label: "WM DPI", text: "WM_DPICHANGED · count 2 · DPI 144×144 · last 13:04:14.567Z" },
      { label: "Tauri DPI", text: "ScaleFactorChanged · count 1 · scale 175% · last 13:02:18.123Z" },
    ]);
    expect(rows.map((row) => row.text).join(" ")).not.toMatch(/applied|success|resolved/);
  });

  it("shows no receipt for empty counters and survives an invalid diagnostic timestamp", () => {
    const events = { nativeMessageCount: 0, tauriScaleChangeCount: 0,
      settingChangeCount: 0, displayChangeCount: 0, policyFrameChangeCount: 0 };
    expect(formatPetModeDpiEventReceipts(events)).toEqual([
      { label: "WM DPI", text: "WM_DPICHANGED · count 0 · DPI none · last none" },
      { label: "Tauri DPI", text: "ScaleFactorChanged · count 0 · scale none · last none" },
      { label: "WM setting", text: "WM_SETTINGCHANGE · count 0 · wParam none · last none" },
      { label: "WM display", text: "WM_DISPLAYCHANGE · count 0 · last none" },
      { label: "Frame policy", text: "FRAMECHANGED policy call · attempts 0 · last none" },
    ]);
    expect(formatPetModeDpiEventReceipts({ ...events, nativeLastAtMs: 1e20 })[0].text).toContain("last unavailable");
    expect(formatPetModeDpiEventReceipts({ ...events, tauriLastAtMs: NaN })[1].text).toContain("last unavailable");
    expect(formatPetModeDpiEventReceipts({ ...events, settingChangeLastAtMs: 1e20 })[2].text).toContain("last unavailable");
    expect(formatPetModeDpiEventReceipts({ ...events, displayChangeLastAtMs: NaN })[3].text).toContain("last unavailable");
    expect(formatPetModeDpiEventReceipts({ ...events, policyFrameChangeLastAtMs: Infinity })[4].text).toContain("last unavailable");
  });

  it("distinguishes absent counters from observed zeroes in an older native build", () => {
    expect(formatPetModeDpiEventReceipts({ nativeMessageCount: 0, tauriScaleChangeCount: 0 }).slice(2)).toEqual([
      { label: "WM setting", text: "WM_SETTINGCHANGE · count unavailable · wParam unavailable · last unavailable" },
      { label: "WM display", text: "WM_DISPLAYCHANGE · count unavailable · last unavailable" },
      { label: "Frame policy", text: "FRAMECHANGED policy call · attempts unavailable · last unavailable" },
    ]);
  });

  it("shows numeric setting and policy receipts without inventing a DPI delivery or success", () => {
    const rows = formatPetModeDpiEventReceipts({
      nativeMessageCount: 1, nativeLastDpiX: 168, nativeLastDpiY: 168,
      nativeLastAtMs: Date.parse("2026-09-30T14:28:36.421Z"),
      tauriScaleChangeCount: 1, tauriLastScaleFactor: 1.75,
      tauriLastAtMs: Date.parse("2026-09-30T14:28:36.433Z"),
      settingChangeCount: 3, settingChangeLastWparam: 0,
      settingChangeLastAtMs: Date.parse("2026-09-30T14:29:10.123Z"),
      displayChangeCount: 0, policyFrameChangeCount: 2,
      policyFrameChangeLastAtMs: Date.parse("2026-09-30T14:28:36.450Z"),
    });
    expect(rows.slice(2)).toEqual([
      { label: "WM setting", text: "WM_SETTINGCHANGE · count 3 · wParam 0 · last 14:29:10.123Z" },
      { label: "WM display", text: "WM_DISPLAYCHANGE · count 0 · last none" },
      { label: "Frame policy", text: "FRAMECHANGED policy call · attempts 2 · last 14:28:36.450Z" },
    ]);
    expect(rows[0].text).toContain("DPI 168×168");
    expect(rows[1].text).toContain("scale 175%");
    expect(rows.map((row) => row.text).join(" ")).not.toMatch(/applied|success|resolved|144|150%/);
  });
});
