// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";

const pluginMocks = vi.hoisted(() => ({ invoke: vi.fn(), label: "main" }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: pluginMocks.label }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: pluginMocks.invoke }));

const {
  buildDayReviewNotification,
  sendDayReviewNotification,
} = await import("./dayReviewNotification");

const review: EndOfDayReviewEvent = {
  kind: "endOfDayReview",
  day: "2026-08-02",
  generatedAt: "2026-08-02T21:00:00",
  trackedLabel: "",
  focusLabel: "",
  driftLabel: "",
  totalSeconds: 23_640,
  focusSeconds: 15_120,
  driftSeconds: 3_480,
  neutralSeconds: 5_040,
  topSource: null,
  comparison: { focusDeltaSeconds: 2_280, driftDeltaSeconds: 0, otherDeltaSeconds: 0 },
  leaderboardCelebration: { period: "daily", rank: 2, participantCount: 14, focusSeconds: 15_120, windowEndDay: "2026-08-02" },
  dailySignals: {
    deepSessionCount: 2,
    longestFocusRunSeconds: 6_480,
    longestFocusRunStartedAt: "2026-08-02T10:20:00",
    peakHourLabel: "10:00",
    peakHourFocusSeconds: 3_000,
  },
};

describe("Day Review notification", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    pluginMocks.label = "main";
    pluginMocks.invoke.mockReset();
    pluginMocks.invoke.mockResolvedValue(undefined);
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("puts the day's focus in the title and the comparison, best run and rank in one plain line", () => {
    expect(buildDayReviewNotification(review, "en")).toEqual({
      title: "Focused for 4h 12m today.",
      body: "38m more than yesterday · best run 1h 48m from 10:20 AM · #2 of 14",
    });
    expect(buildDayReviewNotification(review, "ko")).toEqual({
      title: "오늘 4시간 12분 집중했어요.",
      body: "어제보다 38분 더 집중 · 오전 10:20부터 최장 1시간 48분 · 14명 중 2위",
    });
  });

  it("states the focus share when there is no change against yesterday to report", () => {
    const content = buildDayReviewNotification({
      ...review,
      comparison: { focusDeltaSeconds: 30, driftDeltaSeconds: 0, otherDeltaSeconds: 0 },
      leaderboardCelebration: undefined,
    }, "en");
    expect(content.body).toBe("64% of 6h 34m tracked · best run 1h 48m from 10:20 AM");
  });

  it("states only tracked time and the reason while AI has not rated the day", () => {
    const pending = buildDayReviewNotification({
      ...review,
      focusSeconds: 0,
      driftSeconds: 0,
      comparison: undefined,
      dailySignals: undefined,
      leaderboardCelebration: undefined,
      assessment: { state: "pending", route: "cloud", reason: "cloud_trial_expired", recoveryAction: "upgrade" },
    }, "en");
    expect(pending).toEqual({ title: "6h 34m tracked today.", body: "Your Pro trial ended" });
    expect(buildDayReviewNotification({
      ...review,
      leaderboardCelebration: undefined,
      assessment: { state: "pending", route: "cloud", reason: "cloud_trial_expired", recoveryAction: "upgrade" },
    }, "ko")).toEqual({ title: "오늘 6시간 34분 추적했어요.", body: "Pro 체험이 끝났습니다" });
  });

  it("posts through macOS's notification center and reports what macOS answered", async () => {
    pluginMocks.invoke.mockResolvedValue("sent");
    await expect(sendDayReviewNotification(review, "en")).resolves.toBe("sent");
    expect(pluginMocks.invoke).toHaveBeenCalledWith("native_notification_send", {
      identifier: "drifty.day-review.2026-08-02",
      title: "Focused for 4h 12m today.",
      body: expect.stringContaining("best run 1h 48m"),
    });
    expect(pluginMocks.invoke).not.toHaveBeenCalledWith("plugin:notification|notify", expect.anything());

    // Notifications are off for Drifty: the evening closes.
    pluginMocks.invoke.mockResolvedValueOnce("denied");
    await expect(sendDayReviewNotification(review, "en")).resolves.toBe("denied");
    // The permission request went unanswered, or macOS refused for another reason: try again.
    pluginMocks.invoke.mockResolvedValueOnce("notDetermined");
    await expect(sendDayReviewNotification(review, "en")).resolves.toBe("failed");
    pluginMocks.invoke.mockRejectedValueOnce(new Error("macOS did not confirm the notification"));
    await expect(sendDayReviewNotification(review, "en")).resolves.toBe("failed");
  });

  it("keeps the notification plugin where macOS's notification center is unavailable", async () => {
    pluginMocks.invoke.mockImplementation(async (command: string) => (command === "native_notification_send" ? "unavailable" : undefined));
    await expect(sendDayReviewNotification(review, "en")).resolves.toBe("sent");
    expect(pluginMocks.invoke).toHaveBeenCalledWith("plugin:notification|notify", {
      options: { title: "Focused for 4h 12m today.", body: expect.stringContaining("best run 1h 48m") },
    });

    // The plugin's notify command is awaited, so its rejection is not a send.
    pluginMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "native_notification_send") return "unavailable";
      throw new Error("notification.notify not allowed");
    });
    await expect(sendDayReviewNotification(review, "en")).resolves.toBe("failed");

    pluginMocks.label = "companion";
    await expect(sendDayReviewNotification(review, "en")).resolves.toBe("unavailable");
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    await expect(sendDayReviewNotification(review, "en")).resolves.toBe("unavailable");
  });
  it("cancels after module preparation without invoking the OS", async () => {
    const commit = vi.fn(() => false);
    await expect(sendDayReviewNotification(review, "en", commit)).resolves.toBe("cancelled");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(pluginMocks.invoke).not.toHaveBeenCalled();
  });

  it("rechecks before plugin fallback after an asynchronous unavailable reply", async () => {
    let eligible = true;
    let reply: ((value: string) => void) | undefined;
    pluginMocks.invoke.mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
    const pending = sendDayReviewNotification(review, "en", () => eligible);
    await vi.waitFor(() => expect(reply).toBeDefined());
    eligible = false;
    reply?.("unavailable");
    await expect(pending).resolves.toBe("cancelled");
    expect(pluginMocks.invoke).toHaveBeenCalledTimes(1);
    expect(pluginMocks.invoke).not.toHaveBeenCalledWith("plugin:notification|notify", expect.anything());
  });

});
