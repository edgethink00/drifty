import { afterEach, describe, expect, it, vi } from "vitest";
import {
  automaticClosePausedConfirmationLabel,
  automaticClosePausedStateLabel,
  copyFor,
  isAutomaticClosePauseAction,
} from "./petModeQuickControlsCopy";

describe("petModeQuickControlsCopy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats a timed pause as an absolute resume time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T15:27:00+09:00"));
    const endsAtMs = Date.now() + 15 * 60_000;
    const override = { enabled: false, kind: "15" as const, endsAtMs };
    expect(automaticClosePausedStateLabel("ko", override)).toBe("3:42까지 멈춤");
    expect(automaticClosePausedConfirmationLabel("ko", override)).toBe("3:42까지 멈췄어요");
    expect(automaticClosePausedStateLabel("en", override)).toBe("Paused until 3:42pm");
    expect(automaticClosePausedConfirmationLabel("en", override)).toBe("Paused until 3:42pm");
  });

  it("keeps a forever pause explicit", () => {
    const override = { enabled: false, kind: "forever" as const, endsAtMs: null };
    expect(automaticClosePausedStateLabel("ko", override)).toBe("다시 켤 때까지 멈춤");
    expect(automaticClosePausedConfirmationLabel("ko", override)).toBe("계속 멈췄어요");
    expect(automaticClosePausedStateLabel("en", override)).toBe("Paused until resumed");
    expect(automaticClosePausedConfirmationLabel("en", override)).toBe("Paused until resumed");
  });

  it("recognizes pause actions that should acknowledge then dismiss", () => {
    expect(isAutomaticClosePauseAction("automaticClosePause15")).toBe(true);
    expect(isAutomaticClosePauseAction("automaticCloseRestore")).toBe(false);
  });

  it("keeps the one-hour hide acknowledgement concise in both languages", () => {
    expect(copyFor("ko", "pet.quickControls.hideOneHourConfirmed")).toBe("펫 1시간 숨김 · 자동 닫기 일시정지");
    expect(copyFor("en", "pet.quickControls.hideOneHourConfirmed")).toBe("Pet hidden for 1h · Auto-close paused");
  });
});
