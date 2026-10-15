// @vitest-environment jsdom
import type { ActivitySegment } from "@drifty/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { adoptLivingSoulSuggestion, readLivingSoulForUser, reviewLivingSoulPattern, synchronizeLivingSoulDeclaredContextForUser } from "./livingSoul";
import {
  MEMORY_SUGGESTIONS_CHANGED_EVENT, blockedSuggestionPlaces, isMemorySuggestionJobRunning, runMemorySuggestionJobIfDue,
} from "./memorySuggestionJob";
import { readAiPrivacyRequestSettings, saveAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import { readSuggestionStore, writeSuggestionStore } from "./memorySuggestionStore";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));
vi.mock("./memorySuggestionProvider", () => ({ createLocalSuggestionCompleter: () => completeMock }));
const { dailyEventMock } = vi.hoisted(() => ({ dailyEventMock: vi.fn() }));
vi.mock("../../lib/analytics/posthogClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/analytics/posthogClient")>(),
  capturePostHogDailyEvent: dailyEventMock,
}));

const NOW = new Date("2026-10-04T09:00:00.000Z");
const provider = { kind: "local", provider: { provider: "self_hosted", baseUrl: "http://127.0.0.1:1", model: "m" } } as never;
const RULE = "Paper drafts count as work, while short clips count as distraction.";

/** 6 blocks of 4 hours (24 h) at one place over 3 days, half filed as work and half as distraction. */
function mixedSegments(domain = "overleaf.com", hours = 4): ActivitySegment[] {
  return Array.from({ length: 6 }, (_, index) => {
    const startedAt = new Date(NOW.getTime() - (index % 3) * 86_400_000 - 3_600_000 * (1 + index)).toISOString();
    const work = index % 2 === 0;
    return {
      id: domain + index, startedAt, endedAt: startedAt, durationSeconds: hours * 3600, appName: "Aside", siteDomain: domain,
      siteTitle: (work ? "Draft " : "Clip ") + index, platform: "macos", source: "nsworkspace",
      classification: { category: "workspace", productivity: work ? "focus" : "drift", source: "llm", confidence: 0.9, reason: "" },
    } as unknown as ActivitySegment;
  });
}

function answerRule() {
  completeMock.mockImplementation(async (request: { verify?: unknown; cluster: { evidence: readonly { title: string }[] } }) => request.verify
    ? JSON.stringify({ labels: request.cluster.evidence.map((row) => row.title.startsWith("Draft") ? "work" : "distraction") })
    : JSON.stringify({ summary: RULE }));
}

beforeEach(() => {
  window.localStorage.clear();
  completeMock.mockReset();
  dailyEventMock.mockReset();
});

describe("runMemorySuggestionJobIfDue", () => {
  it("stores verified suggestions, records the run and announces the change", async () => {
    await synchronizeLivingSoulDeclaredContextForUser("local");
    answerRule();
    const events: string[] = [];
    window.addEventListener(MEMORY_SUGGESTIONS_CHANGED_EVENT, (event) => events.push((event as CustomEvent<{ ownerId: string }>).detail.ownerId));
    const loadSegments = vi.fn(async () => mixedSegments());
    const pending = runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: NOW, loadSegments });
    expect(isMemorySuggestionJobRunning("local")).toBe(true);
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: NOW, loadSegments })).resolves.toBe("busy");
    await expect(pending).resolves.toBe("ran");
    expect(isMemorySuggestionJobRunning("local")).toBe(false);
    expect(loadSegments).toHaveBeenCalledWith({ start: "2026-09-27T09:00:00.000Z", end: "2026-10-04T09:00:00.000Z" });
    const store = readSuggestionStore("local");
    expect(store.suggestions.map((entry) => [entry.id, entry.summary])).toEqual([["ambiguous:Aside|overleaf.com", RULE]]);
    expect(store.lastRunAt).toBe(NOW.toISOString());
    expect(events).toEqual(["local", "local"]);
    // The run is counted once per day, without the sentence or the place.
    expect(dailyEventMock).toHaveBeenCalledWith("memory_suggestion_run", expect.any(String),
      { provider_kind: "custom", result: "success", candidate_count_bucket: "1", added_count_bucket: "1" });
    expect(JSON.stringify(dailyEventMock.mock.calls)).not.toMatch(/overleaf|Paper drafts/);
  });

  it("waits for enough newly tracked activity since the previous run", async () => {
    await synchronizeLivingSoulDeclaredContextForUser("local");
    answerRule();
    // 6 hours in the week: too little for a first run, and nothing is recorded.
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: NOW, loadSegments: async () => mixedSegments("overleaf.com", 1) }))
      .resolves.toBe("not_due");
    expect(readSuggestionStore("local").lastRunAt).toBeNull();
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: NOW, loadSegments: async () => mixedSegments() })).resolves.toBe("ran");
    expect(completeMock).toHaveBeenCalledTimes(2);

    // Two days later the same week holds no activity after the run: no new run.
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    const ranges: { start: string; end: string }[] = [];
    const sameWeek = async (range: { start: string; end: string }) => { ranges.push(range); return mixedSegments(); };
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: later, loadSegments: sameWeek })).resolves.toBe("not_due");
    expect(ranges).toEqual([{ start: NOW.toISOString(), end: later.toISOString() }]);
    expect(completeMock).toHaveBeenCalledTimes(2);

    // 21 new hours after the run: the full week is read again.
    const fresh = Array.from({ length: 3 }, (_, index) => ({ ...mixedSegments()[index], id: "new" + index,
      startedAt: new Date(NOW.getTime() + (index + 1) * 3_600_000).toISOString(),
      endedAt: new Date(NOW.getTime() + (index + 8) * 3_600_000).toISOString(), durationSeconds: 7 * 3600 }));
    ranges.length = 0;
    const withFresh = async (range: { start: string; end: string }) => { ranges.push(range); return [...mixedSegments(), ...fresh]; };
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: later, loadSegments: withFresh })).resolves.toBe("ran");
    expect(ranges).toEqual([
      { start: NOW.toISOString(), end: later.toISOString() },
      { start: new Date(later.getTime() - 7 * 86_400_000).toISOString(), end: later.toISOString() },
    ]);
  });

  it("does not run without a readable Soul and leaves the run unrecorded", async () => {
    const loadSegments = vi.fn(async () => mixedSegments());
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: NOW, loadSegments })).resolves.toBe("no_memory");
    expect(loadSegments).not.toHaveBeenCalled();
    expect(readSuggestionStore("local").lastRunAt).toBeNull();
  });

  it("never proposes a place the user dismissed or rejected after adopting", async () => {
    const initial = await synchronizeLivingSoulDeclaredContextForUser("local");
    answerRule();
    writeSuggestionStore("local", { version: 1, lastRunAt: null, retryAfter: null, suggestions: [], declined: ["work:Aside|declined.com"] });
    const adopted = await adoptLivingSoulSuggestion({ ownerId: "local", expectedRevision: initial.document.revision, kind: "ambiguities",
      summary: "Earlier rule that was later rejected by the user.", evidenceDays: 2, observedAt: NOW.toISOString(), activity: "Aside / rejected.com", productivity: "neutral" });
    await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: adopted.document.revision, kind: "ambiguities", summary: "Earlier rule that was later rejected by the user.", action: "reject" });
    const soul = await readLivingSoulForUser("local");
    const document = soul.state === "ready" ? soul.context.document : null;
    expect([...blockedSuggestionPlaces(document, readSuggestionStore("local").declined)].sort()).toEqual(["Aside|declined.com", "Aside|rejected.com"]);
    const loadSegments = async () => [...mixedSegments("declined.com"), ...mixedSegments("rejected.com")];
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: NOW, loadSegments })).resolves.toBe("ran");
    expect(completeMock).not.toHaveBeenCalled();
    expect(readSuggestionStore("local").suggestions).toEqual([]);
  });

  it("leaves a pending suggestion as written and does not re-draft an adopted place", async () => {
    const initial = await synchronizeLivingSoulDeclaredContextForUser("local");
    answerRule();
    const pending = { id: "ambiguous:Aside|pending.com", kind: "ambiguous" as const, summary: "Sentence the user is already reading.", app: "Aside", domain: "pending.com",
      minutes: 60, days: 3, blocks: 6, windowStart: NOW.toISOString(), windowEnd: NOW.toISOString(), createdAt: NOW.toISOString() };
    writeSuggestionStore("local", { version: 1, lastRunAt: null, retryAfter: null, suggestions: [pending], declined: [] });
    await adoptLivingSoulSuggestion({ ownerId: "local", expectedRevision: initial.document.revision, kind: "ambiguities",
      summary: "Rule the user kept for this place earlier on.", evidenceDays: 2, observedAt: NOW.toISOString(), activity: "Aside / adopted.com", productivity: "neutral" });
    const loadSegments = async () => [...mixedSegments("pending.com"), ...mixedSegments("adopted.com")];
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: NOW, loadSegments })).resolves.toBe("ran");
    expect(completeMock).not.toHaveBeenCalled();
    expect(readSuggestionStore("local").suggestions).toEqual([pending]);
  });

  it("retries sooner when the provider cannot be reached", async () => {
    await synchronizeLivingSoulDeclaredContextForUser("local");
    completeMock.mockResolvedValue(null);
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: NOW, loadSegments: async () => mixedSegments() }))
      .resolves.toBe("failed");
    expect(readSuggestionStore("local").lastRunAt).toBeNull();
    expect(dailyEventMock).toHaveBeenLastCalledWith("memory_suggestion_run", expect.any(String),
      { provider_kind: "custom", result: "error", candidate_count_bucket: "1", added_count_bucket: "none" });
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: new Date(NOW.getTime() + 59 * 60_000), loadSegments: async () => mixedSegments() }))
      .resolves.toBe("not_due");
    expect(completeMock).toHaveBeenCalledTimes(1);
    await expect(runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: new Date(NOW.getTime() + 61 * 60_000), loadSegments: async () => mixedSegments() }))
      .resolves.toBe("failed");
    expect(completeMock).toHaveBeenCalledTimes(2);
  });
});


describe("suggestion privacy and retry boundaries", () => {
  it.each(["windowTitle", "contentContext"] as const)("cancels later requests and storage after %s is withdrawn during drafting", async (key) => {
    await synchronizeLivingSoulDeclaredContextForUser("local");
    let finish!: (value: string) => void;
    completeMock.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const job = runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: NOW, loadSegments: async () => mixedSegments() });
    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    const settings = readAiPrivacyRequestSettings();
    saveAiPrivacyRequestSettings({ ...settings, optional: { ...settings.optional, [key]: false } });
    finish(JSON.stringify({ summary: RULE }));
    expect(await job).toBe("cancelled");
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(readSuggestionStore("local")).toMatchObject({ lastRunAt: null, retryAfter: null, suggestions: [] });
    expect(dailyEventMock).not.toHaveBeenCalled();
  });

  it("discards a completed verification when privacy changed while it was in flight", async () => {
    await synchronizeLivingSoulDeclaredContextForUser("local");
    let finish!: (value: string) => void;
    completeMock.mockResolvedValueOnce(JSON.stringify({ summary: RULE }))
      .mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const job = runMemorySuggestionJobIfDue({ ownerId: "local", provider, language: "en", now: NOW, loadSegments: async () => mixedSegments() });
    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(2));
    const settings = readAiPrivacyRequestSettings();
    saveAiPrivacyRequestSettings({ ...settings, optional: { ...settings.optional, contentContext: false } });
    finish(JSON.stringify({ labels: completeMock.mock.calls[1][0].cluster.evidence.map((row: { title: string }) => row.title.startsWith("Draft") ? "work" : "distraction") }));
    expect(await job).toBe("cancelled");
    expect(readSuggestionStore("local")).toMatchObject({ suggestions: [], lastRunAt: null });
  });

  it("retries an unreachable verification after one hour without requiring new tracked activity", async () => {
    await synchronizeLivingSoulDeclaredContextForUser("local");
    completeMock.mockImplementation(async (request: { verify?: unknown }) => request.verify ? null : JSON.stringify({ summary: RULE }));
    const input = { ownerId: "local", provider, language: "en" as const, now: NOW, loadSegments: async () => mixedSegments() };
    expect(await runMemorySuggestionJobIfDue(input)).toBe("failed");
    expect(readSuggestionStore("local")).toMatchObject({ suggestions: [], lastRunAt: null, retryAfter: new Date(NOW.getTime() + 3600000).toISOString() });
    expect(await runMemorySuggestionJobIfDue({ ...input, now: new Date(NOW.getTime() + 59 * 60000) })).toBe("not_due");
    answerRule();
    expect(await runMemorySuggestionJobIfDue({ ...input, now: new Date(NOW.getTime() + 61 * 60000) })).toBe("ran");
    expect(readSuggestionStore("local").suggestions).toHaveLength(1);
  });

  it("keeps a verified suggestion from a partial failure and retries only the unanswered place", async () => {
    await synchronizeLivingSoulDeclaredContextForUser("local");
    completeMock.mockImplementation(async (request: { verify?: unknown; cluster: { domain: string; evidence: readonly { title: string }[] } }) => request.verify
      ? request.cluster.domain === "down.com" ? null : JSON.stringify({ labels: request.cluster.evidence.map(row => row.title.startsWith("Draft") ? "work" : "distraction") })
      : JSON.stringify({ summary: RULE }));
    const input = { ownerId: "local", provider, language: "en" as const, now: NOW, loadSegments: async () => [...mixedSegments("good.com"), ...mixedSegments("down.com")] };
    expect(await runMemorySuggestionJobIfDue(input)).toBe("failed");
    expect(readSuggestionStore("local").suggestions.map(row => row.domain)).toEqual(["good.com"]);
    expect(readSuggestionStore("local").lastRunAt).toBeNull();
    completeMock.mockClear();
    answerRule();
    expect(await runMemorySuggestionJobIfDue({ ...input, now: new Date(NOW.getTime() + 61 * 60000) })).toBe("ran");
    expect(completeMock.mock.calls.map(([request]) => request.cluster.domain)).toEqual(["down.com", "down.com"]);
  });
});
