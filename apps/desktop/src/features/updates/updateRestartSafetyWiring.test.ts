import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(fileURLToPath(new URL("../../App.tsx", import.meta.url)), "utf8");
const rustSource = readFileSync(fileURLToPath(new URL("../../../../../src-tauri/src/lib.rs", import.meta.url)), "utf8");

describe("idle update restart safety wiring", () => {
  it("blocks silent restart while onboarding, auth, upgrade, drift alarm, or break snooze is active", () => {
    expect(appSource).toContain("canSafelyRestartRef.current = () => (");
    expect(appSource).toContain("!onboardingOpen");
    expect(appSource).toContain("!authModalOpen");
    expect(appSource).toContain("!upgradePlanModalOpen");
    expect(appSource).toContain("driftAlarmEvent === null");
    expect(appSource).not.toContain("&& !petModeActive");
    expect(appSource).toContain("isNativePetCursorInside");
    expect(appSource).toContain("isNativePetQuickControlsCursorInside");
    expect(appSource).toContain("listenToNativePetQuickControlsMenuState");
    expect(appSource).toContain("if (occupancy.menuOpen) return 0;");
    expect(appSource).toContain("driftAlarmSnooze === null");
    expect(appSource).toContain("if (petCursorInside !== false || controlsCursorInside === true) return 0;");
  });

  it("keeps production Ready reveal, silent hide, and isolated reveal on one policy", () => {
    expect(rustSource).toContain("match ready_main_window_action(");
    expect(rustSource).toContain("ReadyMainWindowAction::RevealIsolatedWithoutActivation");
    expect(rustSource).toContain("ReadyMainWindowAction::KeepHidden");
    expect(rustSource).toContain("ReadyMainWindowAction::RevealAndFocus => request_main_window(handle)");
    const openRequest = rustSource.slice(
      rustSource.indexOf("pub(crate) fn request_main_window("),
      rustSource.indexOf("fn main_window_is_available<"),
    );
    expect(openRequest).toMatch(/#\[cfg\(target_os = "windows"\)\]\s+if !main_window_is_available\(app\) \{\s+main_window_recovery::recover_on_open\(app\);\s+return;\s+\}/);
    expect(rustSource).toContain("keep_hidden && !explicit_open");
    expect(openRequest.trim()).toMatch(/reveal_main_window\(app\);\s+\}$/);
  });
});
