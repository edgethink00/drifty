import type { ActivityClassificationRecord, ActivitySegment, LiveClassificationMemoryContext } from "@drifty/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: vi.fn(),
  session: vi.fn(),
  cloud: vi.fn(),
  unclassified: vi.fn(),
  reusable: vi.fn(),
  save: vi.fn(),
  metrics: vi.fn(),
  memory: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.native, isTauri: () => false }));
vi.mock("../../lib/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.session }, functions: { invoke: mocks.cloud } },
}));
vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: {
    getUnclassifiedSegments: mocks.unclassified,
    getReusableAiClassifications: mocks.reusable,
    saveClassifications: mocks.save,
    getClassificationMetrics: mocks.metrics,
  },
}));
vi.mock("./classificationMemoryContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("./classificationMemoryContext")>(),
  buildClassificationMemoryContext: mocks.memory,
}));

import {
  classifyLiveActivityWithAi,
  readActiveCategoryGuidance,
  runAiClassification,
  runAiClassificationForUnknownThreshold,
  toMinimizedPayload,
} from "./aiClassificationService";
import { memoryContextForItems } from "./classificationMemoryContext";
import { toLocalProviderRequest, type LocalAiProviderConfig } from "./localAiProviderRequest";
import { readAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";

const PROFILE = "I build a desktop activity tracker. My work includes coding, debugging, release planning, documentation, customer support, and product research. Personal shopping and entertainment are outside that work.";
const segment: ActivitySegment = {
  id: "profile-case", startedAt: "2026-10-26T09:00:00.000Z", endedAt: "2026-10-26T09:03:00.000Z",
  durationSeconds: 180, appName: "Research Browser", browserName: "Safari",
  siteDomain: "grid.example", siteUrl: "https://grid.example/document",
  windowTitle: "Review activity tracker design notes", siteTitle: "Review activity tracker design notes",
  platform: "macos", source: "accessibility",
};
const managed: LocalAiProviderConfig = {
  provider: "managed_local", modelId: "drifty-qwen3-5-4b-default",
  model: "drifty-qwen3.5-4b-local", baseUrl: "http://127.0.0.1:39217/v1",
};
const custom: LocalAiProviderConfig = { provider: "self_hosted", model: "private-model", baseUrl: "http://127.0.0.1:11434/v1" };
const pattern = (index: number) => ({
  summary: `Repeated project work includes reading design notes, fixing bugs and reviewing test results. ${index}`,
  confidence: "high" as const, evidenceCount: 6,
});
const memory: LiveClassificationMemoryContext = {
  soul: {
    revision: 2, declared: { workActivities: [], workDomain: null, workDescription: PROFILE, purpose: null },
    learnedWorkSupport: Array.from({ length: 6 }, (_, i) => pattern(i)),
    learnedDrift: Array.from({ length: 4 }, (_, i) => pattern(i)),
    ambiguities: Array.from({ length: 4 }, (_, i) => pattern(i)),
  },
  episodeByItemId: {
    [segment.id]: {
      windowMinutes: 30, observedMinutes: 27, dominantSurface: "history.example", currentSurfaceSeconds: 180,
      transitions: Array.from({ length: 8 }, (_, i) => ({
        appName: "Research Browser", domain: `history${i}.example`, title: "Review activity tracker design notes", durationSeconds: 180,
      })),
    },
  },
};
let activeMemory = memory;

function setProfile(profile: string) {
  localStorage.setItem("drifty:onboarding:v2:local", JSON.stringify({
    version: 2, completed: true, displayName: "Synthetic QA", workType: null, workTypeOther: "",
    workDomain: null, workDomainOther: "", jobType: null, jobTypeOther: "", workDescription: profile,
    focusGoalHours: null, driftThresholdMinutes: null, purpose: null, completedAt: "2026-10-20T00:00:00Z",
  }));
}

function sentPrompts(): string[] {
  return mocks.native.mock.calls.flatMap(([command, args]) => command === "ai_classification_openai_chat"
    ? [(args as { request: { messages: Array<{ content: string }> } }).request.messages.map(m => m.content).join("\n")]
    : []);
}

const modes = ["manual", "threshold", "live"] as const;
async function run(mode: typeof modes[number], provider = managed) {
  const options = { localProvider: provider, contextSegments: [segment], persistLiveResult: true };
  if (mode === "live") return classifyLiveActivityWithAi(segment, options);
  if (mode === "threshold") return runAiClassificationForUnknownThreshold({ day: "2026-10-26" }, 1, options);
  return runAiClassification({ day: "2026-10-26" }, 20, options);
}

function cached(inputFingerprint: string): ActivityClassificationRecord {
  return {
    segmentId: "old-source", inputFingerprint, category: "unknown", productivity: "neutral", source: "llm",
    aiResult: true, confidence: .5, reason: "old profileless cache", model: managed.model,
    promptVersion: "v8.3-browser-clues", taxonomyVersion: "v1", classifiedAt: "2026-10-20T00:00:00Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, String(v)), removeItem: (k: string) => values.delete(k), clear: () => values.clear() };
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("localStorage", storage);
  setProfile(PROFILE);
  localStorage.setItem("drifty.categoryCustomizations.v1", JSON.stringify({
    workspace: { name: "Workspace", description: "Building software, reviewing changes, testing releases and writing project plans." },
    learning: { name: "Learning", description: "Reading documentation, technical explanations and research to understand a topic." },
    utility: { name: "Utility", description: "Managing personal settings, bookings and accounts without direct project work." },
  }));
  localStorage.setItem("drifty.productivityCustomizations.v1", JSON.stringify({
    focus: { name: "Focus", description: "Direct project work or support with clear evidence that it relates to the current project." },
    neutral: { name: "Neutral", description: "Useful information or personal administration; also use when the purpose remains unclear." },
    drift: { name: "Drift", description: "Personal entertainment, casual browsing, games or shopping unrelated to the current task." },
  }));
  activeMemory = memory;
  mocks.memory.mockImplementation(async (input: { privacySettings: { optional: { workProfile: boolean } } }) => ({
    ...activeMemory, soul: input.privacySettings.optional.workProfile ? activeMemory.soul : null,
  }));
  mocks.session.mockResolvedValue({ data: { session: null } });
  mocks.unclassified.mockResolvedValue([segment]);mocks.reusable.mockResolvedValue({});
  mocks.save.mockResolvedValue({ saved: 1 });
  mocks.metrics.mockResolvedValue({ totalSegments: 1, classifiedSegments: 1, unclassifiedSegments: 0, aiClassifiedSegments: 1, staleClassifications: 0 });
  mocks.native.mockImplementation(async (command: string) => {
    if (command === "managed_ai_status") return { state: "running", selectedModelId: "drifty-qwen3-5-4b-default", baseUrl: managed.baseUrl, model: managed.model };
    if (command !== "ai_classification_openai_chat") throw new Error(`Unexpected command ${command}`);
    return { status: 200, latencyMs: 12, body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ results: [{ id: segment.id, category: "unknown", intent: "unknown", userProductivity: "neutral", confidence: .5, reason: "fresh reply" }] }) } }] }) };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("managed declared work profile through optional context shedding", () => {
  it.each(modes)("keeps the current profile after optional Soul is shed on the %s path", async mode => {
    await run(mode);
    const prompts = sentPrompts();expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("<living_soul>");
    expect(prompts[0]).toContain(`User work profile: ${PROFILE}`);
    expect(mocks.save).toHaveBeenCalledWith([expect.objectContaining({ segmentId: segment.id, reason: "fresh reply" })]);
  });

  it.each(modes)("does not reuse the previous Soul-only fingerprint on the %s path", async mode => {
    const old = await toMinimizedPayload(segment, null, readAiPrivacyRequestSettings(), memory, readActiveCategoryGuidance());
    mocks.reusable.mockImplementation(async (fps: string[]) => fps.includes(old.inputFingerprint) ? { [old.inputFingerprint]: cached(old.inputFingerprint) } : {});
    await run(mode);
    expect(mocks.reusable.mock.calls[0][0]).not.toContain(old.inputFingerprint);
    expect(sentPrompts()).toHaveLength(1);
    expect(mocks.save).toHaveBeenCalledWith([expect.objectContaining({ reason: "fresh reply" })]);
  });

  it.each(modes)("keeps profile OFF input and cache identity independent of the hidden profile on the %s path", async mode => {
    localStorage.setItem("drifty.aiPrivacyRequestSettings.v1", JSON.stringify({ version: 1, optional: { workProfile: false } }));
    await run(mode);const first = mocks.reusable.mock.calls[0][0];
    setProfile("HIDDEN PROFILE MUST NOT LEAVE THIS DEVICE");
    await run(mode);
    expect(mocks.reusable.mock.calls[1][0]).toEqual(first);
    expect(sentPrompts().join("\n")).not.toContain(PROFILE);
    expect(sentPrompts().join("\n")).not.toContain("HIDDEN PROFILE");
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("keeps the previous managed message bytes when Soul still contains the declaration", async () => {
    localStorage.removeItem("drifty.categoryCustomizations.v1");localStorage.removeItem("drifty.productivityCustomizations.v1");
    activeMemory = { ...memory, soul: { ...memory.soul!, learnedWorkSupport: [], learnedDrift: [], ambiguities: [] }, episodeByItemId: {} };
    const prior = await toMinimizedPayload(segment, null, readAiPrivacyRequestSettings(), activeMemory);
    const expected = toLocalProviderRequest(managed, [prior], null, memoryContextForItems(activeMemory, [segment.id]))!;
    await run("manual");
    expect(sentPrompts()).toEqual([(expected.request.messages as Array<{ content: string }>).map(m => m.content).join("\n")]);
    expect(sentPrompts()[0].split(PROFILE)).toHaveLength(2);
  });

  it("keeps the self-hosted cache identity and reuses its existing answer", async () => {
    const old = await toMinimizedPayload(segment, null, readAiPrivacyRequestSettings(), memory, readActiveCategoryGuidance());
    mocks.reusable.mockImplementation(async (fps: string[]) => fps.includes(old.inputFingerprint) ? { [old.inputFingerprint]: cached(old.inputFingerprint) } : {});
    await run("manual", custom);
    expect(mocks.reusable.mock.calls[0][0]).toEqual([old.inputFingerprint]);
    expect(sentPrompts()).toEqual([]);
  });

  it("keeps self-hosted message bytes when an uncached request is sent", async () => {
    const prior = await toMinimizedPayload(segment, null, readAiPrivacyRequestSettings(), memory, readActiveCategoryGuidance());
    const expected = toLocalProviderRequest(custom, [prior], null, memoryContextForItems(memory, [segment.id]))!;
    await run("manual", custom);
    expect(sentPrompts()).toEqual([(expected.request.messages as Array<{ content: string }>).map(m => m.content).join("\n")]);
  });

  it("keeps the existing managed cache when the profile was already explicit without Soul", async () => {
    activeMemory = { ...memory, soul: null };
    const old = await toMinimizedPayload(segment, PROFILE, readAiPrivacyRequestSettings(), activeMemory, readActiveCategoryGuidance());
    mocks.reusable.mockImplementation(async (fps: string[]) => fps.includes(old.inputFingerprint) ? { [old.inputFingerprint]: cached(old.inputFingerprint) } : {});
    await run("manual");
    expect(mocks.reusable.mock.calls[0][0]).toEqual([old.inputFingerprint]);
    expect(sentPrompts()).toEqual([]);
  });

  it("does not reconstruct a missing current declaration from an old Soul during shedding", async () => {
    setProfile("");
    await run("manual");
    expect(sentPrompts()).toHaveLength(1);
    expect(sentPrompts()[0]).not.toContain("<living_soul>");
    expect(sentPrompts()[0]).not.toContain(PROFILE);
    expect(sentPrompts()[0]).not.toContain("User work profile:");
  });
});
