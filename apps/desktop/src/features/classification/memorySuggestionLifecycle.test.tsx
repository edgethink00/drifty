// @vitest-environment jsdom
import { FunctionsClient } from "@supabase/functions-js";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ActivitySegment } from "@drifty/domain";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readLivingSoulForUser, synchronizeLivingSoulDeclaredContextForUser, type LivingSoulDocument } from "./livingSoul";
import { runMemorySuggestionJobIfDue, isMemorySuggestionJobRunning } from "./memorySuggestionJob";
import { readSuggestionStore, writeSuggestionStore } from "./memorySuggestionStore";
import { CLOUD_MEMORY_SUGGESTION_TIMEOUT_MS } from "./memorySuggestionCloud";
import { useMemorySuggestionScheduler, SUGGESTION_SCHEDULER_FIRST_CHECK_MS } from "../settings/useMemorySuggestionScheduler";
import { useMemorySuggestions } from "../settings/useMemorySuggestions";

const mocks = vi.hoisted(() => ({invoke: vi.fn(), timeline: vi.fn(), session: vi.fn()}));
vi.mock("../../lib/supabase/client", () => ({supabase: {functions: {invoke: mocks.invoke}, auth: {getSession: mocks.session}}}));
vi.mock("../../lib/api/trackerClient", () => ({trackerClient: {getTimeline: mocks.timeline}}));
vi.mock("../cloud-devices/cloudDeviceIdentity", () => ({withCloudDevicePayload: async (body: unknown) => body}));
vi.mock("../../lib/analytics/posthogClient", async original => ({...await original<typeof import("../../lib/analytics/posthogClient")>(), capturePostHogDailyEvent: vi.fn()}));

const NOW = new Date("2026-10-15T09:00:00Z");
const RULE = "Paper drafts count as work, while short clips count as distraction.";
function mixedSegments(): ActivitySegment[] {
  return Array.from({length: 6}, (_, i) => {
    const start = NOW.getTime() - (i * 8 + 4) * 3600000;
    return {id: String(i), startedAt: new Date(start).toISOString(), endedAt: new Date(start + 4 * 3600000).toISOString(), durationSeconds: 4 * 3600,
      appName: "Aside", siteDomain: "overleaf.com", siteTitle: (i % 2 ? "Clip " : "Draft ") + i, source: "nsworkspace", platform: "macos",
      classification: {category: "workspace", productivity: i % 2 ? "drift" : "focus", source: "llm", confidence: 0.9}} as ActivitySegment;
  });
}
let owner = "owner-a";
beforeEach(() => {
  localStorage.clear();
  owner = "owner-a";
  mocks.invoke.mockReset();
  mocks.timeline.mockReset().mockResolvedValue(mixedSegments());
  mocks.session.mockReset().mockImplementation(async () => ({data: {session: {user: {id: owner}, access_token: "synthetic-" + owner}}, error: null}));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each(["scheduler", "memory"])("cancels %s's old-owner work before another request or store write", async entry => {
  await synchronizeLivingSoulDeclaredContextForUser(owner);
  const loaded = await readLivingSoulForUser(owner);
  const document: LivingSoulDocument | null = loaded.state === "ready" ? loaded.context.document : null;
  let finish!: (body: unknown) => void;
  const transport = vi.fn(async () => ({ok: true, headers: new Headers({"Content-Type": "application/json"}), json: () => new Promise(resolve => {finish = resolve;})} as Response));
  const sdk = new FunctionsClient("https://synthetic.invalid/functions/v1", {customFetch: transport});
  mocks.invoke.mockImplementation((name, options) => sdk.invoke(name, options));
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const hook = renderHook(({id, enabled}) => {
    // Both real production entry points share the same job and egress guards.
    useMemorySuggestionScheduler({ownerId: id, provider: entry === "scheduler" && enabled ? {kind: "cloud"} : null, language: "en", enabled});
    useMemorySuggestions({ownerId: id, provider: entry === "memory" && enabled ? {kind: "cloud"} : null, language: "en", document});
  }, {initialProps: {id: owner, enabled: true}});
  await act(async () => { await vi.advanceTimersByTimeAsync(entry === "scheduler" ? SUGGESTION_SCHEDULER_FIRST_CHECK_MS : 0); });
  expect(transport).toHaveBeenCalledTimes(1);
  owner = "owner-b"; sdk.setAuth("synthetic-owner-b");
  hook.rerender({id: owner, enabled: false});
  await act(async () => {finish({summary: RULE}); await vi.advanceTimersByTimeAsync(0);});
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(isMemorySuggestionJobRunning("owner-a")).toBe(false);
  expect(readSuggestionStore("owner-a")).toMatchObject({lastRunAt: null, retryAfter: null, suggestions: []});
  expect(readSuggestionStore("owner-b").suggestions).toEqual([]);
});

it("releases a stalled real-SDK body at the deadline and uses the hourly retry, ignoring its late success", async () => {
  await synchronizeLivingSoulDeclaredContextForUser(owner);
  let finish!: (body: unknown) => void;
  let decoding = false;
  const transport = vi.fn(async () => ({ok: true, headers: new Headers({"Content-Type": "application/json"}), json: () => {decoding = true; return new Promise(resolve => {finish = resolve;});}} as Response));
  const sdk = new FunctionsClient("https://synthetic.invalid/functions/v1", {customFetch: transport});
  mocks.invoke.mockImplementation((name, options) => sdk.invoke(name, options));
  const input = {ownerId: owner, provider: {kind: "cloud" as const}, language: "en" as const, now: NOW};
  vi.useFakeTimers();
  const job = runMemorySuggestionJobIfDue(input);
  await vi.waitFor(() => expect(decoding).toBe(true));
  await vi.advanceTimersByTimeAsync(CLOUD_MEMORY_SUGGESTION_TIMEOUT_MS);
  expect(await job).toBe("failed");
  expect(isMemorySuggestionJobRunning(owner)).toBe(false);
  expect(readSuggestionStore(owner)).toMatchObject({lastRunAt: null, retryAfter: new Date(NOW.getTime() + 3600000).toISOString()});
  finish({summary: RULE}); await vi.advanceTimersByTimeAsync(0);
  expect(readSuggestionStore(owner).suggestions).toEqual([]);
  expect(await runMemorySuggestionJobIfDue({...input, now: new Date(NOW.getTime() + 59 * 60000)})).toBe("not_due");
  mocks.invoke.mockImplementation(async (_name, {body}) => ({data: body.stage === "draft" ? {summary: RULE} : {labels: body.cluster.evidence.map((row: {title: string}) => row.title.startsWith("Draft") ? "work" : "distraction")}, error: null}));
  expect(await runMemorySuggestionJobIfDue({...input, now: new Date(NOW.getTime() + 61 * 60000)})).toBe("ran");
  expect(readSuggestionStore(owner).suggestions).toHaveLength(1);
});

it("lets new time in a crossing record satisfy the unchanged twenty-hour gate", async () => {
  await synchronizeLivingSoulDeclaredContextForUser(owner);
  const last = new Date(NOW.getTime() - 48 * 3600000);
  writeSuggestionStore(owner, {version: 1, lastRunAt: last.toISOString(), retryAfter: null, declined: [], suggestions: []});
  const crossing = {...mixedSegments()[0]!, startedAt: new Date(last.getTime() - 3600000).toISOString(), endedAt: new Date(last.getTime() + 3 * 3600000).toISOString(), durationSeconds: 14400};
  const later = {...crossing, id: "later", startedAt: new Date(last.getTime() + 4 * 3600000).toISOString(), endedAt: new Date(last.getTime() + 22 * 3600000).toISOString(), durationSeconds: 18 * 3600};
  mocks.invoke.mockResolvedValue({data: {skip: true}, error: null});
  expect(await runMemorySuggestionJobIfDue({ownerId: owner, provider: {kind: "cloud"}, language: "en", now: NOW, loadSegments: async () => [crossing, later]})).toBe("ran");
  expect(readSuggestionStore(owner).lastRunAt).toBe(NOW.toISOString());
});

it("cancels a session mismatch before React observes the new owner without consuming retry allowance", async () => {
  await synchronizeLivingSoulDeclaredContextForUser(owner);
  mocks.session.mockResolvedValue({data: {session: {user: {id: "owner-b"}, access_token: "synthetic-owner-b"}}, error: null});
  expect(await runMemorySuggestionJobIfDue({ownerId: owner, provider: {kind: "cloud"}, language: "en", now: NOW, isCurrent: () => true})).toBe("cancelled");
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(readSuggestionStore(owner)).toMatchObject({lastRunAt: null, retryAfter: null, suggestions: []});
});
