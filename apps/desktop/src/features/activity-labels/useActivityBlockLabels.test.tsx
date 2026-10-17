// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActivityBlockLabelRecord,
  ActivityBlockLabelSaveInput,
  ActivityBlockUserLabelInput,
  ActivitySegment,
  ActivityTimelineCardModelItem,
  TrackerApi,
} from "@drifty/domain";
import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, DEFAULT_AI_PRIVACY_REQUEST_SETTINGS } from "../settings/aiPrivacyRequestSettings";
import { ACTIVITY_LABEL_REQUEST_BUDGET_STORAGE_KEY } from "./activityLabelBudget";
import { useActivityBlockLabels, type UseActivityBlockLabelsArgs } from "./useActivityBlockLabels";

type PromptRecord = [string, string, string, number, string, string | null, string | null];
const inferenceCalls: string[] = [];
const answerFor = vi.fn<(records: PromptRecord[]) => ActivityTimelineCardModelItem[]>();

vi.mock("./activityLabelInference", () => ({
  createActivityLabelInference: () => async (prompt: string) => {
    inferenceCalls.push(prompt);
    const lines = prompt.slice(prompt.indexOf("# Records") + "# Records".length).trim().split("\n");
    const records = lines.filter((line) => line.startsWith("[")).map((line) => JSON.parse(line) as PromptRecord);
    return { output: answerFor(records), usage: { provider: "openai", model: "test-model" } };
  },
}));

const DAY = "2026-10-14";

function segment(id: string, start: string, end: string, fields: Partial<ActivitySegment>): ActivitySegment {
  const startedAt = new Date(DAY + "T" + start + ":00");
  const endedAt = new Date(DAY + "T" + end + ":00");
  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: (endedAt.getTime() - startedAt.getTime()) / 1000,
    appName: "Code",
    platform: "macos",
    source: "nsworkspace",
    ...fields,
  };
}

const focus = { category: "workspace", productivity: "focus", source: "manual", confidence: 1 } as const;
const drift = { category: "entertainment", productivity: "drift", source: "manual", confidence: 1 } as const;
// Three activity windows: 09:00 work, 10:00 video with a short detour, 13:00 an untitled chat.
const FULL_SEGMENTS: ActivitySegment[] = [
  segment("11", "09:00", "09:40", { windowTitle: "checkout-retry.ts — drifty", classification: focus }),
  segment("21", "10:00", "10:25", { appName: "Google Chrome", siteDomain: "youtube.com", siteTitle: "Long systems lecture - YouTube", classification: drift }),
  segment("22", "10:25", "10:28", { appName: "Google Chrome", siteDomain: "drifty.so", siteTitle: "Drifty pricing page", classification: drift }),
  segment("31", "13:00", "13:40", { appName: "ChatGPT", windowTitle: "ChatGPT", classification: { ...focus, category: "learning" } }),
];
// The Week view's compact payload drops window titles.
const SEGMENTS: ActivitySegment[] = FULL_SEGMENTS.map((item) => ({ ...item, windowTitle: null }));

function fakeTracker() {
  const store = new Map<string, ActivityBlockLabelRecord>();
  let clock = 0;
  const tracker = {
    getTimeline: vi.fn(async () => FULL_SEGMENTS),
    getActivityBlockLabels: vi.fn(async () => [...store.values()]),
    saveActivityBlockLabels: vi.fn(async (labels: ActivityBlockLabelSaveInput[]) => {
      for (const label of labels) store.set("ai|" + label.blockKey, { ...label, source: "ai", updatedAt: new Date(Date.UTC(2026, 9, 14, 0, 0, clock++)).toISOString() });
      return { saved: labels.length, skipped: 0 };
    }),
    saveActivityBlockUserLabel: vi.fn(async (label: ActivityBlockUserLabelInput, previous?: string | null) => {
      if (previous) store.delete("user|" + previous);
      const saved: ActivityBlockLabelRecord = { ...label, source: "user", status: label.title ? "user" : "hidden" };
      store.set("user|" + label.blockKey, saved);
      return saved;
    }),
    deleteActivityBlockUserLabel: vi.fn(async (blockKey: string) => ({ deleted: store.delete("user|" + blockKey) ? 1 : 0 })),
  };
  return { tracker, store };
}

function args(tracker: ReturnType<typeof fakeTracker>["tracker"], overrides: Partial<UseActivityBlockLabelsArgs> = {}): UseActivityBlockLabelsArgs {
  return {
    tracker: tracker as unknown as TrackerApi,
    active: true,
    startDay: DAY,
    endDay: DAY,
    weekCalendarEvents: null,
    segments: SEGMENTS,
    classificationOptions: { includeAiClassifications: true },
    startOfDayMinutes: 0,
    language: "en",
    analysisConnected: true,
    analysisSetup: { ...DEFAULT_ANALYSIS_AI_SETUP, provider: "openai" },
    analysisOwnerId: null,
    analysisCloudRecovery: false,
    requestScopeKey: "scope",
    resolveOpenRouterKey: async () => null,
    now: () => new Date(DAY + "T18:00:00").getTime(),
    ...overrides,
  };
}

function blockFor(controller: ReturnType<typeof useActivityBlockLabels>, ids: string[]) {
  return controller?.index.forSegments(DAY, ids) ?? null;
}

const card = (startRef: string, endRef: string, title: string, refs: string[], description = ""): ActivityTimelineCardModelItem => ({
  startRef, endRef, status: "ready", title, description, refs,
});

beforeEach(() => {
  window.localStorage.clear();
  inferenceCalls.length = 0;
  answerFor.mockReset();
  answerFor.mockImplementation((records) => records[0][6]?.startsWith("checkout")
    // The description claims a fix the records cannot show.
    ? [card("r1", "r1", "Checkout retry review", ["r1"], "Fixed the retry handler.")]
    // Names the three-minute detour for the whole stretch: kept as a partial card.
    : [card("r1", "r2", "Drifty pricing review", ["r2"])]);
});

afterEach(cleanup);

describe("useActivityBlockLabels", () => {
  it("describes finished activity windows from full records, keeps a loose card as partial, and skips untitled windows", async () => {
    const { tracker } = fakeTracker();
    const { result } = renderHook(() => useActivityBlockLabels(args(tracker)));

    // The window title exists only in the full records the hook loads itself.
    await waitFor(() => expect(blockFor(result.current, ["11"])?.display?.title).toBe("Checkout retry review"));
    expect(tracker.getTimeline).toHaveBeenCalledWith(expect.objectContaining({ start: expect.any(String), end: expect.any(String) }));
    expect(blockFor(result.current, ["11"])?.display).toMatchObject({ origin: "ai", status: "ready", description: "" });
    await waitFor(() => expect(blockFor(result.current, ["21", "22"])?.display).toMatchObject({ title: "Drifty pricing review", status: "limited" }));
    expect(blockFor(result.current, ["31"])?.display).toBeNull();
    const saved = tracker.saveActivityBlockLabels.mock.calls.flatMap(([labels]) => labels);
    expect(saved.find((label) => label.title === "Drifty pricing review")).toMatchObject({ reason: "card:partial" });
    expect(saved.filter((label) => label.reason === "window")).toHaveLength(3);
    // The untitled chat window is settled without a request.
    expect(inferenceCalls).toHaveLength(2);
    expect(inferenceCalls.some((prompt) => prompt.includes("checkout-retry.ts"))).toBe(true);
    expect(inferenceCalls.join("\n")).not.toMatch(/"11"|"21"|"22"/);
  });

  it("drops a card whose title points at nothing in the records", async () => {
    answerFor.mockImplementation(() => [card("r1", "r1", "Kubernetes migration", [])]);
    const { tracker } = fakeTracker();
    const { result } = renderHook(() => useActivityBlockLabels(args(tracker)));
    await waitFor(() => expect(inferenceCalls).toHaveLength(2));
    await waitFor(() => expect(tracker.saveActivityBlockLabels.mock.calls.flatMap(([labels]) => labels).filter((label) => label.reason === "window")).toHaveLength(3));
    expect(blockFor(result.current, ["11"])?.display).toBeNull();
    expect(tracker.saveActivityBlockLabels.mock.calls.flatMap(([labels]) => labels).filter((label) => label.reason?.startsWith("card:"))).toEqual([]);
  });

  it("lets the user's choice for a block win over the card and return to it", async () => {
    const { tracker } = fakeTracker();
    const { result } = renderHook(() => useActivityBlockLabels(args(tracker)));
    await waitFor(() => expect(blockFor(result.current, ["11"])?.display?.origin).toBe("ai"));

    await act(async () => {
      await result.current!.saveUserLabel(blockFor(result.current, ["11"])!, "", "");
    });
    await waitFor(() => expect(blockFor(result.current, ["11"])?.display).toBeNull());
    expect(blockFor(result.current, ["11"])?.resolution.kind).toBe("user");

    await act(async () => {
      await result.current!.resetUserLabel(blockFor(result.current, ["11"])!);
    });
    await waitFor(() => expect(blockFor(result.current, ["11"])?.display?.title).toBe("Checkout retry review"));
  });

  it("does not call the model for an open window, with both title switches off, or past the daily budget", async () => {
    const live = fakeTracker();
    const earlier = SEGMENTS.filter((item) => item.id !== "31");
    renderHook(() => useActivityBlockLabels(args(live.tracker, { segments: earlier, now: () => new Date(DAY + "T10:30:00").getTime() })));
    await waitFor(() => expect(inferenceCalls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The 10:00 window ended two minutes earlier and may still grow.
    expect(inferenceCalls).toHaveLength(1);
    expect(inferenceCalls[0]).toContain("checkout-retry.ts");
    cleanup();

    inferenceCalls.length = 0;
    window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
      optional: { ...DEFAULT_AI_PRIVACY_REQUEST_SETTINGS.optional, windowTitle: false, contentContext: false },
    }));
    const untitled = fakeTracker();
    renderHook(() => useActivityBlockLabels(args(untitled.tracker)));
    // Cards have no switch of their own; with no title allowed, every window is settled on the device.
    await waitFor(() => expect(untitled.tracker.saveActivityBlockLabels).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(inferenceCalls).toHaveLength(0);
    cleanup();

    window.localStorage.removeItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY);
    const today = new Date();
    const todayKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
    window.localStorage.setItem(ACTIVITY_LABEL_REQUEST_BUDGET_STORAGE_KEY, JSON.stringify({ day: todayKey, requests: 80 }));
    const spent = fakeTracker();
    renderHook(() => useActivityBlockLabels(args(spent.tracker)));
    // The untitled window is settled without the model; the rest wait for tomorrow's budget.
    await waitFor(() => expect(spent.tracker.saveActivityBlockLabels).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spent.tracker.saveActivityBlockLabels.mock.calls.flatMap(([labels]) => labels).map((label) => label.reason)).toEqual(["window"]);
    expect(inferenceCalls).toHaveLength(0);
  });

  it("stays out of replays and keeps the existing display when the tracker cannot store labels", () => {
    const { tracker } = fakeTracker();
    expect(renderHook(() => useActivityBlockLabels(args(tracker, { active: false }))).result.current).toBeNull();
    expect(renderHook(() => useActivityBlockLabels(args({} as ReturnType<typeof fakeTracker>["tracker"]))).result.current).toBeNull();
    expect(tracker.getTimeline).not.toHaveBeenCalled();
  });

  it("describes today's and yesterday's finished windows in the background while Day and Week are closed", async () => {
    const { tracker } = fakeTracker();
    const { result } = renderHook(() => useActivityBlockLabels(args(tracker, { active: false, background: true })));
    // Two titled windows go to the model, the untitled one is settled on the device.
    await waitFor(() => expect(tracker.saveActivityBlockLabels).toHaveBeenCalledTimes(3));
    expect(inferenceCalls).toHaveLength(2);
    expect(tracker.getTimeline).toHaveBeenCalledTimes(1);
    expect(tracker.getTimeline).toHaveBeenCalledWith({ start: "2026-10-13T00:00:00", end: "2026-10-14T23:59:59" });
    // Nothing is shown while the dashboard is closed.
    expect(result.current).toBeNull();
    cleanup();

    // A window still open (no later record, no long break) waits, and no model means no reads.
    inferenceCalls.length = 0;
    const open = fakeTracker();
    renderHook(() => useActivityBlockLabels(args(open.tracker, { active: false, background: true, now: () => new Date(DAY + "T13:45:00").getTime() })));
    await waitFor(() => expect(open.tracker.saveActivityBlockLabels).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const openWindowStart = new Date(DAY + "T13:00:00").getTime();
    const savedStarts = open.tracker.saveActivityBlockLabels.mock.calls.flatMap(([labels]) => labels).map((label) => Date.parse(label.blockStartedAt));
    expect(savedStarts.every((start) => start < openWindowStart)).toBe(true);
    cleanup();
    const idle = fakeTracker();
    renderHook(() => useActivityBlockLabels(args(idle.tracker, { active: false, background: true, analysisConnected: false })));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(idle.tracker.getTimeline).not.toHaveBeenCalled();
    expect(idle.tracker.saveActivityBlockLabels).not.toHaveBeenCalled();
  });
});
