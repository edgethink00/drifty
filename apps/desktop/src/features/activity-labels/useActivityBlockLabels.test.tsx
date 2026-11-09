// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActivityBlockLabelRecord,
  ActivityBlockUserLabelInput,
  ActivitySegment,
  ActivityTimelineCardModelItem,
  ActivityTimelineWindowRecord,
  ActivityTimelineWindowSaveInput,
  TrackerApi,
} from "@drifty/domain";
import { ACTIVITY_TIMELINE_CARD_PROMPT_VERSION, activityBlockLabelKey, activityTimelineWindowSaveInput, buildActivityTimelineWindows } from "@drifty/domain";
import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, DEFAULT_AI_PRIVACY_REQUEST_SETTINGS } from "../settings/aiPrivacyRequestSettings";
import { ACTIVITY_LABEL_REQUEST_BUDGET_STORAGE_KEY } from "./activityLabelBudget";
import { useActivityBlockLabels, type UseActivityBlockLabelsArgs } from "./useActivityBlockLabels";
import { noteMergedBlockTitleRequests, readMergedBlockTitles } from "./mergedBlockTitleStore";

type PromptRecord = [string, string, string, number, string, string | null, string | null];
const inferenceCalls: string[] = [];
type ModelAnswer = ActivityTimelineCardModelItem[] | null;
const answerFor = vi.fn<(records: PromptRecord[]) => ModelAnswer | Promise<ModelAnswer>>();

vi.mock("./activityLabelInference", () => ({
  createActivityLabelInference: () => async (prompt: string) => {
    inferenceCalls.push(prompt);
    const lines = prompt.slice(prompt.indexOf("# Records") + "# Records".length).trim().split("\n");
    const records = lines.filter((line) => line.startsWith("[")).map((line) => JSON.parse(line) as PromptRecord);
    return { output: await answerFor(records), usage: { provider: "openai", model: "test-model" } };
  },
}));

const mergedPrompts: string[] = [];
const mergedAnswer = vi.fn<() => Promise<string | null>>();
vi.mock("./mergedBlockTitleInference", () => ({
  createMergedBlockTitleInference: () => async (prompt: string) => {
    mergedPrompts.push(prompt);
    return { output: await mergedAnswer(), usage: { provider: "openai", model: "test-model" } };
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
  const windows = new Map<string, ActivityTimelineWindowRecord>();
  let clock = 0;
  const tracker = {
    getTimeline: vi.fn(async () => FULL_SEGMENTS),
    getActivityBlockLabels: vi.fn(async () => [...store.values()]),
    getActivityTimelineCards: vi.fn(async () => [...windows.values()]),
    saveActivityTimelineWindow: vi.fn(async (window: ActivityTimelineWindowSaveInput) => {
      windows.set(window.windowKey + "|" + window.language, {
        ...window,
        createdAt: new Date(Date.UTC(2026, 9, 14, 0, 0, clock++)).toISOString(),
        cards: window.cards.map((card, position) => ({ ...card, position })),
      });
      return { saved: 1, replaced: 0, cards: window.cards.length };
    }),
    saveActivityBlockUserLabel: vi.fn(async (label: ActivityBlockUserLabelInput, previous?: string | null) => {
      if (previous) store.delete("user|" + previous);
      const saved: ActivityBlockLabelRecord = { ...label, source: "user", status: label.title ? "user" : "hidden" };
      store.set("user|" + label.blockKey, saved);
      return saved;
    }),
    deleteActivityBlockUserLabel: vi.fn(async (blockKey: string) => ({ deleted: store.delete("user|" + blockKey) ? 1 : 0 })),
  };
  return { tracker, store, windows };
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
  mergedPrompts.length = 0;
  mergedAnswer.mockReset();
  mergedAnswer.mockResolvedValue(null);
  answerFor.mockReset();
  answerFor.mockImplementation((records) => records[0][6]?.startsWith("checkout")
    // The description claims a fix the records cannot show.
    ? [card("r1", "r1", "Checkout retry review", ["r1"], "Fixed the retry handler.")]
    // Names the three-minute detour for the whole stretch: kept as a partial card.
    : [card("r1", "r2", "Drifty pricing review", ["r2"])]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function flushGeneration() {
  for (let step = 0; step < 8; step += 1) {
    await act(async () => { for (let turn = 0; turn < 8; turn += 1) await Promise.resolve(); });
  }
}

async function advanceGeneration(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
  await flushGeneration();
}

describe("useActivityBlockLabels", () => {
  it.each([false, true])("retries the new model immediately after an old scoped request rejects (background=%s)", async background => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(DAY + "T18:00:00"));
    const { tracker } = fakeTracker();
    let rejectOld!: (reason: Error) => void;
    answerFor.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const initialProps = args(tracker, { active: !background, background });
    const hook = renderHook(props => useActivityBlockLabels(props), { initialProps });
    await flushGeneration();
    expect(inferenceCalls).toHaveLength(1);
    hook.rerender({ ...initialProps, requestScopeKey: "new-model" });
    await act(async () => { rejectOld(new Error("old model cancelled")); });
    await flushGeneration();
    expect(inferenceCalls.length).toBeGreaterThan(1);
  });

  it("retries a missing answer after backoff, then reuses the saved window across remounts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(DAY + "T18:00:00"));
    const { tracker } = fakeTracker();
    tracker.getTimeline.mockResolvedValue(FULL_SEGMENTS.slice(0, 1));
    answerFor.mockResolvedValueOnce(null);
    const input = args(tracker, { segments: SEGMENTS.slice(0, 1), now: Date.now });
    const first = renderHook(() => useActivityBlockLabels(input));
    await flushGeneration();
    expect(inferenceCalls).toHaveLength(1);
    expect(tracker.saveActivityTimelineWindow).not.toHaveBeenCalled();
    await advanceGeneration(14 * 60_000);
    expect(inferenceCalls).toHaveLength(1);
    await advanceGeneration(60_000);
    expect(inferenceCalls).toHaveLength(2);
    expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(1);
    expect(blockFor(first.result.current, ["11"])?.display?.title).toBe("Checkout retry review");
    first.unmount();
    renderHook(() => useActivityBlockLabels(input));
    await advanceGeneration(20 * 60_000);
    expect(inferenceCalls).toHaveLength(2);
    expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(1);
  });

  it.each(["throws", "declines"] as const)("retries when storing an answer %s, without settling the unsaved window", async (failure) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(DAY + "T18:00:00"));
    const { tracker } = fakeTracker();
    tracker.getTimeline.mockResolvedValue(FULL_SEGMENTS.slice(0, 1));
    if (failure === "throws") tracker.saveActivityTimelineWindow.mockRejectedValueOnce(new Error("Store temporarily unavailable"));
    else tracker.saveActivityTimelineWindow.mockResolvedValueOnce({ saved: 0, replaced: 0, cards: 0 });
    const input = args(tracker, { segments: SEGMENTS.slice(0, 1), now: Date.now });
    const { result } = renderHook(() => useActivityBlockLabels(input));
    await flushGeneration();
    expect(inferenceCalls).toHaveLength(1);
    expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(1);
    expect(blockFor(result.current, ["11"])?.display).toBeNull();
    await advanceGeneration(15 * 60_000);
    expect(inferenceCalls).toHaveLength(2);
    expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(2);
    expect(blockFor(result.current, ["11"])?.display?.title).toBe("Checkout retry review");
  });

  it("discards an answer after date navigation and describes the unfinished date on return", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(DAY + "T18:00:00"));
    const { tracker } = fakeTracker();
    tracker.getTimeline.mockResolvedValue(FULL_SEGMENTS.slice(0, 1));
    let finishFirst: (answer: ModelAnswer) => void = () => { throw new Error("No request started"); };
    answerFor.mockImplementationOnce(() => new Promise<ModelAnswer>((resolve) => { finishFirst = resolve; }));
    const input = args(tracker, { segments: SEGMENTS.slice(0, 1), now: Date.now });
    const { result, rerender } = renderHook((value) => useActivityBlockLabels(value), { initialProps: input });
    await flushGeneration();
    expect(inferenceCalls).toHaveLength(1);
    rerender({ ...input, startDay: "2026-10-15", endDay: "2026-10-15", segments: [] });
    await flushGeneration();
    await act(async () => { finishFirst([card("r1", "r1", "Checkout retry review", ["r1"])]); });
    await flushGeneration();
    expect(tracker.saveActivityTimelineWindow).not.toHaveBeenCalled();
    rerender(input);
    await flushGeneration();
    expect(inferenceCalls).toHaveLength(2);
    expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(1);
    expect(blockFor(result.current, ["11"])?.display?.title).toBe("Checkout retry review");
  });

  it.each([true, false])("resumes after titles are enabled with active=%s, including an older no-model empty window", async (active) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(DAY + "T18:00:00"));
    const { tracker } = fakeTracker();
    const records = FULL_SEGMENTS.slice(0, 1);
    tracker.getTimeline.mockResolvedValue(records);
    const [windowToRecover] = buildActivityTimelineWindows(DAY, records, new Date(DAY + "T00:00:00").getTime(), new Date(DAY + "T23:59:59").getTime());
    await tracker.saveActivityTimelineWindow(activityTimelineWindowSaveInput(windowToRecover, [], "en", {}));
    tracker.saveActivityTimelineWindow.mockClear();
    window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
      optional: { ...DEFAULT_AI_PRIVACY_REQUEST_SETTINGS.optional, windowTitle: false, contentContext: false },
    }));
    const input = args(tracker, { segments: SEGMENTS.slice(0, 1), active, background: true, now: Date.now });
    const { result } = renderHook(() => useActivityBlockLabels(input));
    await advanceGeneration(11 * 60_000);
    expect(inferenceCalls).toHaveLength(0);
    expect(tracker.getTimeline).not.toHaveBeenCalled();
    expect(tracker.saveActivityTimelineWindow).not.toHaveBeenCalled();
    await act(async () => {
      window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_AI_PRIVACY_REQUEST_SETTINGS));
      window.dispatchEvent(new Event(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT));
    });
    await flushGeneration();
    expect(inferenceCalls).toHaveLength(1);
    expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(1);
    expect(tracker.saveActivityTimelineWindow.mock.calls[0][0].cards[0].title).toBe("Checkout retry review");
    if (active) expect(blockFor(result.current, ["11"])?.display?.title).toBe("Checkout retry review");
    else expect(result.current).toBeNull();
    await advanceGeneration(11 * 60_000);
    expect(inferenceCalls).toHaveLength(1);
  });

  it("retries a failed background request on its next cadence after backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(DAY + "T18:00:00"));
    const { tracker } = fakeTracker();
    tracker.getTimeline.mockResolvedValue(FULL_SEGMENTS.slice(0, 1));
    answerFor.mockResolvedValueOnce(null);
    renderHook(() => useActivityBlockLabels(args(tracker, {
      segments: [], active: false, background: true, now: Date.now,
    })));
    await flushGeneration();
    expect(inferenceCalls).toHaveLength(1);
    expect(tracker.saveActivityTimelineWindow).not.toHaveBeenCalled();
    await advanceGeneration(10 * 60_000);
    expect(inferenceCalls).toHaveLength(1);
    await advanceGeneration(10 * 60_000);
    expect(inferenceCalls).toHaveLength(2);
    expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(1);
  });

  it("does not ask again for an empty answer from the model after remount", async () => {
    const { tracker } = fakeTracker();
    tracker.getTimeline.mockResolvedValue(FULL_SEGMENTS.slice(0, 1));
    answerFor.mockReturnValue([]);
    const input = args(tracker, { segments: SEGMENTS.slice(0, 1) });
    const first = renderHook(() => useActivityBlockLabels(input));
    await waitFor(() => expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(1));
    expect(inferenceCalls).toHaveLength(1);
    first.unmount();
    renderHook(() => useActivityBlockLabels(input));
    await flushGeneration();
    expect(inferenceCalls).toHaveLength(1);
    expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(1);
  });

  it("checks a genuinely untitled window once per mount without spending a model request", async () => {
    const { tracker } = fakeTracker();
    tracker.getTimeline.mockResolvedValue(FULL_SEGMENTS.slice(3));
    const input = args(tracker, { segments: SEGMENTS.slice(3) });
    const first = renderHook(() => useActivityBlockLabels(input));
    await waitFor(() => expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(1));
    first.rerender();
    await flushGeneration();
    expect(tracker.getTimeline).toHaveBeenCalledTimes(1);
    expect(inferenceCalls).toHaveLength(0);
    first.unmount();
    renderHook(() => useActivityBlockLabels(input));
    await waitFor(() => expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(2));
    expect(tracker.getTimeline).toHaveBeenCalledTimes(2);
    expect(inferenceCalls).toHaveLength(0);
  });

  it("describes finished activity windows from full records, keeps a loose card as partial, and skips untitled windows", async () => {
    const { tracker } = fakeTracker();
    const { result } = renderHook(() => useActivityBlockLabels(args(tracker)));

    // The window title exists only in the full records the hook loads itself.
    await waitFor(() => expect(blockFor(result.current, ["11"])?.display?.title).toBe("Checkout retry review"));
    expect(tracker.getTimeline).toHaveBeenCalledWith(expect.objectContaining({ start: expect.any(String), end: expect.any(String) }));
    expect(blockFor(result.current, ["11"])?.display).toMatchObject({ origin: "ai", status: "ready", description: "" });
    await waitFor(() => expect(blockFor(result.current, ["21", "22"])?.display).toMatchObject({ title: "Drifty pricing review", status: "limited" }));
    expect(blockFor(result.current, ["31"])?.display).toBeNull();
    const saved = tracker.saveActivityTimelineWindow.mock.calls.map(([window]) => window);
    expect(saved).toHaveLength(3);
    expect(saved.flatMap((window) => window.cards).find((card) => card.title === "Drifty pricing review")).toMatchObject({ variant: "partial" });
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
    await waitFor(() => expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(3));
    expect(blockFor(result.current, ["11"])?.display).toBeNull();
    // Each window is still stored, without cards, so it is not asked again.
    expect(tracker.saveActivityTimelineWindow.mock.calls.flatMap(([window]) => window.cards)).toEqual([]);
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

  it("restores one slice of a hidden legacy block without unhiding its sibling, and survives reload", async () => {
    const { tracker, store, windows } = fakeTracker();
    const records = [segment("a", "09:00", "09:30", {}), segment("b", "09:30", "10:00", {})];
    const at = (time: string) => new Date(DAY + "T" + time + ":00").toISOString();
    const oldKey = activityBlockLabelKey(DAY, ["a", "b"]);
    store.set("user|" + oldKey, {
      blockKey: oldKey, logicalDay: DAY, source: "user", status: "hidden", title: "", description: "",
      segmentIds: ["a", "b"], blockStartedAt: at("09:00"), blockEndedAt: at("10:00"),
    });
    windows.set("saved", {
      windowKey: "saved", logicalDay: DAY, language: "en", promptVersion: ACTIVITY_TIMELINE_CARD_PROMPT_VERSION,
      startedAt: at("09:00"), endedAt: at("10:00"), createdAt: at("18:00"),
      cards: ["Checkout review", "Figure review"].map((title, position) => ({
        position, title, description: "", status: "ready", variant: "strict", segmentIds: [position ? "b" : "a"],
        startedAt: at(position ? "09:30" : "09:00"), endedAt: at(position ? "10:00" : "09:30"),
      })),
    });
    const input = args(tracker, { segments: records, analysisConnected: false });
    const { result, unmount } = renderHook(() => useActivityBlockLabels(input));
    const first = () => result.current!.index.forRange(DAY, 540, 570, ["a"])!;
    const second = () => result.current!.index.forRange(DAY, 570, 600, ["b"])!;
    await waitFor(() => expect(result.current?.weekCalendarEvents?.get(DAY)).toHaveLength(2));
    expect(first().display).toBeNull();
    expect(second().display).toBeNull();
    await act(async () => { await result.current!.resetUserLabel(first()); });
    await waitFor(() => expect(first().display?.title).toBe("Checkout review"));
    expect(second().display).toBeNull();
    expect(store.has("user|" + oldKey)).toBe(false);
    unmount();
    const reloaded = renderHook(() => useActivityBlockLabels(input));
    await waitFor(() => expect(reloaded.result.current!.index.forRange(DAY, 540, 570, ["a"])?.display?.title).toBe("Checkout review"));
    expect(reloaded.result.current!.index.forRange(DAY, 570, 600, ["b"])?.display).toBeNull();
    expect(inferenceCalls).toHaveLength(0);
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
    // No title allowed: pause generation without writing completed empty windows.
    await waitFor(() => expect(untitled.tracker.getActivityTimelineCards).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(inferenceCalls).toHaveLength(0);
    expect(untitled.tracker.getTimeline).not.toHaveBeenCalled();
    expect(untitled.tracker.saveActivityTimelineWindow).not.toHaveBeenCalled();
    cleanup();

    window.localStorage.removeItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY);
    const today = new Date();
    const todayKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
    window.localStorage.setItem(ACTIVITY_LABEL_REQUEST_BUDGET_STORAGE_KEY, JSON.stringify({ day: todayKey, requests: 80 }));
    const spent = fakeTracker();
    renderHook(() => useActivityBlockLabels(args(spent.tracker)));
    // The untitled window is settled without the model; the rest wait for tomorrow's budget.
    await waitFor(() => expect(spent.tracker.saveActivityTimelineWindow).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spent.tracker.saveActivityTimelineWindow.mock.calls.map(([window]) => window.cards.length)).toEqual([0]);
    expect(inferenceCalls).toHaveLength(0);
  });

  it("names a stretch without a break an hour at a time, and leaves a day named under the earlier limits alone", async () => {
    // 13:00-15:10 with no 20-minute break; pauses at 13:40 (4 minutes) and 14:25 (3 minutes).
    const stretch = [
      segment("a", "13:00", "13:40", { windowTitle: "checkout-retry.ts — drifty", classification: focus }),
      segment("b", "13:44", "14:25", { windowTitle: "checkout-retry.test.ts — drifty", classification: focus }),
      segment("c", "14:28", "15:10", { windowTitle: "billing-entitlement.ts — drifty", classification: focus }),
    ];
    const live = fakeTracker();
    live.tracker.getTimeline.mockImplementation(async () => stretch);
    const hook = renderHook(() => useActivityBlockLabels(args(live.tracker, { segments: stretch, now: () => new Date(DAY + "T15:11:00").getTime() })));
    await waitFor(() => expect(inferenceCalls).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Windows of 30 to 60 minutes: 13:00-13:40 and 13:44-14:25 are followed by later records and named now.
    expect(inferenceCalls).toHaveLength(2);
    expect(inferenceCalls.some((prompt) => prompt.includes("checkout-retry.test.ts"))).toBe(true);
    // The window from 14:28 is still open: not asked about, and its name is on its way.
    expect(inferenceCalls.some((prompt) => prompt.includes("billing-entitlement.ts"))).toBe(false);
    expect(hook.result.current?.openWindows).toEqual([{ startMs: new Date(DAY + "T14:28:00").getTime(), endMs: new Date(DAY + "T15:10:00").getTime() }]);
    expect(hook.result.current?.namesExpected).toBe(true);
    cleanup();

    // The same day named under the earlier three-hour limit keeps its card and is not asked about again.
    inferenceCalls.length = 0;
    const named = fakeTracker();
    named.tracker.getTimeline.mockImplementation(async () => stretch);
    named.windows.set("old|en", {
      windowKey: "old", language: "en", logicalDay: DAY, promptVersion: ACTIVITY_TIMELINE_CARD_PROMPT_VERSION, provider: "openai", model: "test-model",
      startedAt: new Date(DAY + "T13:00:00").toISOString(), endedAt: new Date(DAY + "T15:10:00").toISOString(), createdAt: null,
      cards: [{ position: 0, startedAt: new Date(DAY + "T13:00:00").toISOString(), endedAt: new Date(DAY + "T15:10:00").toISOString(), segmentIds: ["a", "b", "c"], status: "ready", variant: "strict", title: "Checkout retry and billing", description: "", details: [] }],
    });
    renderHook(() => useActivityBlockLabels(args(named.tracker, { segments: stretch })));
    await waitFor(() => expect(named.tracker.getActivityTimelineCards).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(inferenceCalls).toHaveLength(0);
    expect(named.tracker.saveActivityTimelineWindow).not.toHaveBeenCalled();
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
    await waitFor(() => expect(tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(3));
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
    await waitFor(() => expect(open.tracker.saveActivityTimelineWindow).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const openWindowStart = new Date(DAY + "T13:00:00").getTime();
    const savedStarts = open.tracker.saveActivityTimelineWindow.mock.calls.map(([window]) => Date.parse(window.startedAt));
    expect(savedStarts.every((start) => start < openWindowStart)).toBe(true);
    cleanup();
    const idle = fakeTracker();
    renderHook(() => useActivityBlockLabels(args(idle.tracker, { active: false, background: true, analysisConnected: false })));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(idle.tracker.getTimeline).not.toHaveBeenCalled();
    expect(idle.tracker.saveActivityTimelineWindow).not.toHaveBeenCalled();
  });
});

describe("names for merged Your Day blocks", () => {
  const cards = [{ title: "Food and gaming Shorts", minutes: 56 }, { title: "Music and esports clips", minutes: 53 }];

  it("asks once cards are done, from the cards' titles and minutes only, and keeps the checked name", async () => {
    const { tracker } = fakeTracker();
    renderHook(() => useActivityBlockLabels(args(tracker)));
    await flushGeneration();
    const cardRequests = inferenceCalls.length;
    mergedAnswer.mockResolvedValueOnce('{"title": "Gaming Shorts and esports clips"}');
    act(() => noteMergedBlockTitleRequests(DAY, [{ key: "merged-block-title-v1:en:aaaa", cards, apps: ["youtube.com"] }]));
    await flushGeneration();
    expect(mergedPrompts).toHaveLength(1);
    expect(mergedPrompts[0]).toContain("1. Food and gaming Shorts (56 min)");
    expect(mergedPrompts[0]).not.toContain("youtube.com");
    expect(inferenceCalls).toHaveLength(cardRequests);
    expect(readMergedBlockTitles().get("merged-block-title-v1:en:aaaa")).toBe("Gaming Shorts and esports clips");
  });

  it("stores an unusable answer as no name, so the block keeps its card name and is not asked again", async () => {
    const { tracker } = fakeTracker();
    renderHook(() => useActivityBlockLabels(args(tracker)));
    await flushGeneration();
    mergedAnswer.mockResolvedValueOnce('{"title": "Relaxing with friends on Netflix"}');
    act(() => noteMergedBlockTitleRequests(DAY, [{ key: "merged-block-title-v1:en:bbbb", cards, apps: [] }]));
    await flushGeneration();
    expect(readMergedBlockTitles().has("merged-block-title-v1:en:bbbb")).toBe(false);
    act(() => noteMergedBlockTitleRequests(DAY, [{ key: "merged-block-title-v1:en:bbbb", cards, apps: [] }]));
    await flushGeneration();
    expect(mergedPrompts).toHaveLength(1);
  });

  it("sends nothing while the AI privacy title switches are both off", async () => {
    window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
      optional: { ...DEFAULT_AI_PRIVACY_REQUEST_SETTINGS.optional, windowTitle: false, contentContext: false },
    }));
    const { tracker } = fakeTracker();
    renderHook(() => useActivityBlockLabels(args(tracker)));
    act(() => noteMergedBlockTitleRequests(DAY, [{ key: "merged-block-title-v1:en:cccc", cards, apps: [] }]));
    await flushGeneration();
    expect(mergedPrompts).toHaveLength(0);
  });
});
