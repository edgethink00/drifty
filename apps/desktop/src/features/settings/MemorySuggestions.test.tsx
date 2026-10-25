// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ActivitySegment } from "@drifty/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readLivingSoulForUser, synchronizeLivingSoulDeclaredContextForUser } from "../classification/livingSoul";
import type { LocalAiProviderConfig } from "../classification/localAiProviderRequest";
import {
  readSuggestionStore, writeSuggestionStore, type StoredSuggestion,
} from "../classification/memorySuggestionStore";
import { isMemorySuggestionJobRunning } from "../classification/memorySuggestionJob";
import { readAiPrivacyRequestSettings, saveAiPrivacyRequestSettings } from "./aiPrivacyRequestSettings";
import { invokeMock, renderPanel, resetManagedStatusMock, showPanelSection } from "./AiSetupPanel.testHarness";

const { getTimelineMock, completeMock, cloudCompleteMock } = vi.hoisted(() => ({ getTimelineMock: vi.fn(), completeMock: vi.fn(), cloudCompleteMock: vi.fn() }));
const { captureMock } = vi.hoisted(() => ({ captureMock: vi.fn() }));
vi.mock("../../lib/analytics/posthogClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/analytics/posthogClient")>(),
  capturePostHogEvent: captureMock,
}));

vi.mock("../../lib/api/trackerClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api/trackerClient")>();
  return { ...original, trackerClient: { ...original.trackerClient, getTimeline: getTimelineMock } };
});
vi.mock("../classification/memorySuggestionProvider", () => ({ createLocalSuggestionCompleter: () => completeMock }));
vi.mock("../classification/memorySuggestionCloud", () => ({ createCloudSuggestionCompleter: () => cloudCompleteMock }));
vi.mock("./cloudAiConnectionTest", () => ({ testCloudAiConnection: vi.fn() }));

const provider = { kind: "local", provider: { provider: "self_hosted", baseUrl: "http://127.0.0.1:8080", model: "local-model" } as unknown as LocalAiProviderConfig } as const;
const NOW = new Date().toISOString();

function pending(overrides: Partial<StoredSuggestion> = {}): StoredSuggestion {
  return { id: "work:Aside|overleaf.com", kind: "work", summary: "논문 초안과 그림 작업은 업무로 분류합니다.", app: "Aside", domain: "overleaf.com",
    minutes: 120, days: 4, blocks: 12, windowStart: NOW, windowEnd: NOW, createdAt: NOW, ...overrides };
}

function seedPending(...suggestions: StoredSuggestion[]) {
  writeSuggestionStore("local", { version: 1, lastRunAt: NOW, retryAfter: null, suggestions, declined: [] });
}

/** One place the classifier filed both ways over 24 tracked hours: paper drafts as work, clips as distraction. */
function recentSegments(): ActivitySegment[] {
  const now = Date.now();
  return Array.from({ length: 6 }, (_, index) => {
    const startedAt = new Date(now - (index % 3) * 24 * 60 * 60 * 1000 - 3_600_000 * (1 + index)).toISOString();
    const work = index % 2 === 0;
    return {
      id: "segment-" + index, startedAt, endedAt: startedAt, durationSeconds: 4 * 3600, appName: "Aside", siteDomain: "overleaf.com",
      siteTitle: (work ? "Draft " : "Clip ") + index, platform: "macos", source: "nsworkspace",
      classification: { category: "workspace", productivity: work ? "focus" : "drift", source: "llm", confidence: 0.9, reason: "" },
    } as unknown as ActivitySegment;
  });
}

/** Answers the draft with `summary` and the verification by reading the record titles. */
function answering(summary: string) {
  return async (request: { verify?: { summary: string }; cluster: { evidence: readonly { title: string }[] } }) => request.verify
    ? JSON.stringify({ labels: request.cluster.evidence.map((row) => row.title.startsWith("Draft") ? "work" : "distraction") })
    : JSON.stringify({ summary });
}

async function openMemory() {
  showPanelSection("memory");
}

describe("suggested Memory", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    invokeMock.mockClear();
    resetManagedStatusMock();
    getTimelineMock.mockReset();
    completeMock.mockReset();
    cloudCompleteMock.mockReset();
    captureMock.mockReset();
    await synchronizeLivingSoulDeclaredContextForUser("local");
  });

  it("removes an already-open example after title sharing is disabled, preserving the suggestion", async () => {
    const suggestion = pending({examples: [{title: "Synthetic private title", filedAs: "focus", minutes: 5}]});
    seedPending(suggestion);
    renderPanel(); await openMemory();
    const row = await screen.findByRole("article", {name: suggestion.summary});
    fireEvent.click(within(row).getByRole("button", {name: "Details"}));
    expect(within(row).getByText("Synthetic private title")).toBeTruthy();
    const settings = readAiPrivacyRequestSettings();
    saveAiPrivacyRequestSettings({...settings, optional: {...settings.optional, windowTitle: false}});
    await waitFor(() => expect(screen.queryByText("Synthetic private title")).toBeNull());
    expect(screen.getByRole("article", {name: suggestion.summary})).toBeTruthy();
    expect(readSuggestionStore("local").suggestions[0]!.examples).toBeUndefined();
  });

  it("adds an accepted suggestion as a confirmed memory and clears it from the suggestions", async () => {
    seedPending(pending());
    renderPanel();
    await openMemory();
    const row = await screen.findByRole("article", { name: pending().summary });
    expect(screen.getByRole("heading", { name: "Suggested" })).toBeTruthy();
    expect(within(row).getByText("Aside / overleaf.com")).toBeTruthy();
    expect(within(row).getByText("120 min · 4 days")).toBeTruthy();
    await waitFor(() => expect(within(row).getByRole("button", { name: "Add to Memory" })).not.toHaveProperty("disabled", true));
    fireEvent.click(within(row).getByRole("button", { name: "Add to Memory" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Suggested" })).toBeNull());
    const learned = await screen.findByRole("article", { name: pending().summary });
    expect(within(learned).getByText("Suggested from activity")).toBeTruthy();
    expect(within(learned).getByRole("button", { name: "Confirmed" }).getAttribute("aria-pressed")).toBe("true");
    expect(readSuggestionStore("local").suggestions).toEqual([]);
    const saved = await readLivingSoulForUser("local");
    expect(saved.state === "ready" && saved.context.document.learned.workSupport.map((entry) => entry.summary)).toEqual([pending().summary]);
  });

  it("shows the records behind a suggestion, and adds a mixed place without a single filed-as label", async () => {
    const summary = "Product pages are work; notifications are a distraction.";
    seedPending(pending({ id: "ambiguous:Aside|producthunt.com", kind: "ambiguous", summary, domain: "producthunt.com", examples: [
      { title: "Drifty launch page", filedAs: "focus", minutes: 27 }, { title: "Notifications", filedAs: "drift", minutes: 11 },
    ] }));
    renderPanel();
    await openMemory();
    const row = await screen.findByRole("article", { name: summary });
    expect(screen.queryByText("What was this based on?")).toBeNull();
    // How a suggestion is made is told in its Details, not in a line under the list.
    const madeFrom = /^Your selected AI drafted this from app, site and window titles/;
    expect(screen.queryByText(madeFrom)).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Details" }));
    expect(within(row).getByText("What was this based on?")).toBeTruthy();
    expect(within(row).getByText(madeFrom)).toBeTruthy();
    expect(within(row).getByText("Drifty launch page")).toBeTruthy();
    expect(within(row).getByText("Notifications")).toBeTruthy();
    expect(within(row).getByText("11 min")).toBeTruthy();
    await waitFor(() => expect(within(row).getByRole("button", { name: "Add to Memory" })).not.toHaveProperty("disabled", true));
    fireEvent.click(within(row).getByRole("button", { name: "Add to Memory" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Suggested" })).toBeNull());
    const learned = await screen.findByRole("article", { name: summary });
    expect(within(learned).getByText("Suggested from activity")).toBeTruthy();
    fireEvent.click(within(learned).getByRole("button", { name: "Details" }));
    expect(within(learned).getByText("Aside / producthunt.com")).toBeTruthy();
    expect(within(learned).queryByText("Filed as")).toBeNull();
    // Counted without the sentence, place or example titles.
    expect(captureMock.mock.calls.filter(([event]) => event === "memory_suggestion_action").map(([, properties]) => properties)).toEqual([
      { action: "details_opened", kind: "ambiguous", result: "success", has_examples: true },
      { action: "accepted", kind: "ambiguous", result: "success", has_examples: true },
    ]);
    expect(JSON.stringify(captureMock.mock.calls)).not.toMatch(/Product pages|producthunt|Notifications|launch page/);
    fireEvent.click(within(learned).getByRole("button", { name: "Not right" }));
    await waitFor(() => expect(captureMock).toHaveBeenCalledWith("memory_pattern_feedback",
      { action: "reject", kind: "ambiguities", origin: "suggestion", result: "success" }));
  });

  it("dismisses a suggestion for good with Not right", async () => {
    seedPending(pending(), pending({ id: "drift:Aside|youtube.com", kind: "drift", summary: "영상 시청은 방해로 분류합니다.", domain: "youtube.com" }));
    renderPanel();
    await openMemory();
    const row = await screen.findByRole("article", { name: pending().summary });
    fireEvent.click(within(row).getByRole("button", { name: "Not right" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: pending().summary })).toBeNull());
    expect(screen.getByRole("article", { name: "영상 시청은 방해로 분류합니다." })).toBeTruthy();
    expect(readSuggestionStore("local").declined).toEqual([pending().id]);
    expect(captureMock).toHaveBeenCalledWith("memory_suggestion_action", { action: "dismissed", kind: "work", result: "success", has_examples: false });
    const saved = await readLivingSoulForUser("local");
    expect(saved.state === "ready" && saved.context.document.learned.workSupport).toEqual([]);
  });

  it("explains a failed add and leaves the suggestion available", async () => {
    seedPending(pending({ kind: "drift", id: "drift:x", summary: "다섯 번째 방해 문장은 방해로 분류합니다." }));
    const { adoptLivingSoulSuggestion } = await import("../classification/livingSoul");
    let revision = (await synchronizeLivingSoulDeclaredContextForUser("local")).document.revision;
    for (let index = 0; index < 4; index += 1) {
      revision = (await adoptLivingSoulSuggestion({ ownerId: "local", expectedRevision: revision, kind: "drift", summary: "방해 문장 " + index + " 은 방해로 분류합니다.",
        evidenceDays: 2, observedAt: NOW, activity: "Aside", productivity: "drift" })).document.revision;
    }
    renderPanel();
    await openMemory();
    const row = await screen.findByRole("article", { name: "다섯 번째 방해 문장은 방해로 분류합니다." });
    await waitFor(() => expect(within(row).getByRole("button", { name: "Add to Memory" })).not.toHaveProperty("disabled", true));
    fireEvent.click(within(row).getByRole("button", { name: "Add to Memory" }));
    expect(await screen.findByText(/This group is full/)).toBeTruthy();
    expect(readSuggestionStore("local").suggestions).toHaveLength(1);
  });

  it("looks through recent activity and does not reread it until new activity is tracked", async () => {
    getTimelineMock.mockResolvedValue(recentSegments());
    completeMock.mockImplementation(answering("Paper drafts count as work, while short clips count as distraction."));
    const first = renderPanel({ memorySuggestionProvider: provider });
    await openMemory();
    expect(await screen.findByRole("article", { name: "Paper drafts count as work, while short clips count as distraction." })).toBeTruthy();
    expect(getTimelineMock).toHaveBeenCalledTimes(1);
    expect(completeMock).toHaveBeenCalledTimes(2);
    expect(completeMock.mock.calls[0][0].prompt).toContain("Aside / overleaf.com");
    expect(completeMock.mock.calls[1][0].verify).toEqual({ summary: "Paper drafts count as work, while short clips count as distraction." });
    expect(readSuggestionStore("local").lastRunAt).not.toBeNull();
    first.unmount();
    renderPanel({ memorySuggestionProvider: provider });
    await openMemory();
    expect(await screen.findByRole("article", { name: "Paper drafts count as work, while short clips count as distraction." })).toBeTruthy();
    // The reopen only counts activity tracked after the first run, finds none, and makes no model call.
    const lastRunAt = readSuggestionStore("local").lastRunAt;
    await waitFor(() => expect(getTimelineMock).toHaveBeenCalledTimes(2));
    expect(getTimelineMock.mock.calls[1][0].start).toBe(lastRunAt);
    await waitFor(() => expect(isMemorySuggestionJobRunning("local")).toBe(false));
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a local or bring-your-own provider", async () => {
    getTimelineMock.mockResolvedValue(recentSegments());
    renderPanel();
    await openMemory();
    await screen.findByRole("heading", { name: "Work profile" });
    expect(getTimelineMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Suggested" })).toBeNull();
  });

  it("shows nothing when the provider's sentence fails validation (sensitive topic)", async () => {
    getTimelineMock.mockResolvedValue(recentSegments());
    completeMock.mockResolvedValue(JSON.stringify({ summary: "Watching election videos counts as distraction." }));
    renderPanel({ memorySuggestionProvider: provider });
    await openMemory();
    await waitFor(() => expect(readSuggestionStore("local").lastRunAt).not.toBeNull());
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Suggested" })).toBeNull();
  });

  it("uses Drifty Cloud when it is the selected route", async () => {
    getTimelineMock.mockResolvedValue(recentSegments());
    cloudCompleteMock.mockImplementation(answering("Drafting papers counts as work, while clips count as distraction."));
    renderPanel({ memorySuggestionProvider: { kind: "cloud" } });
    await openMemory();
    expect(await screen.findByRole("article", { name: "Drafting papers counts as work, while clips count as distraction." })).toBeTruthy();
    expect(cloudCompleteMock).toHaveBeenCalledTimes(2);
    expect(cloudCompleteMock.mock.calls[0][0]).toMatchObject({ language: "en", showTitles: true, cluster: { app: "Aside", domain: "overleaf.com", signal: "mixed" } });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("retries within the hour when the provider could not be reached at all", async () => {
    getTimelineMock.mockResolvedValue(recentSegments());
    completeMock.mockResolvedValue(null);
    renderPanel({ memorySuggestionProvider: provider });
    await openMemory();
    await waitFor(() => expect(readSuggestionStore("local").retryAfter).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Suggested" })).toBeNull();
    expect(readSuggestionStore("local").lastRunAt).toBeNull();
    const hoursUntil = (Date.parse(readSuggestionStore("local").retryAfter ?? "") - Date.now()) / 3_600_000;
    expect(hoursUntil).toBeGreaterThan(0.9);
    expect(hoursUntil).toBeLessThan(1.1);
  });
});
