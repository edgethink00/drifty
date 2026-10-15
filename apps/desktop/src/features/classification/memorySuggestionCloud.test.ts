import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCloudSuggestionCompleter } from "./memorySuggestionCloud";
import type { SuggestionCluster } from "./memorySuggestions";

const { invoke, withDevice } = vi.hoisted(() => ({ invoke: vi.fn(), withDevice: vi.fn() }));
vi.mock("../../lib/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("../cloud-devices/cloudDeviceIdentity", () => ({ withCloudDevicePayload: withDevice }));

const cluster = {
  key: "Aside|overleaf.com", app: "Aside", domain: "overleaf.com", kind: "work", minutes: 61.6, days: 3, blocks: 9, modelFiledShare: 1,
  productivityMinutes: { focus: 40.4, neutral: 0, drift: 21.2 }, signal: "mixed", dominantShare: 0.66, meanModelConfidence: 0.87,
  evidence: Array.from({ length: 8 }, (_, index) => ({ title: "Title " + index, minutes: 7.4, blocks: 1, days: 1, filedAs: "focus" as const, reason: "Editing" })),
} as SuggestionCluster;

describe("createCloudSuggestionCompleter", () => {
  beforeEach(() => { invoke.mockReset(); withDevice.mockReset().mockImplementation(async (body: Record<string, unknown>) => ({ ...body, device: "test" })); });

  it("sends structured evidence with titles only when allowed and returns the sentence as JSON", async () => {
    invoke.mockResolvedValue({ data: { summary: "문장입니다 문장입니다." }, error: null });
    const complete = createCloudSuggestionCompleter();
    await expect(complete({ prompt: "ignored", cluster, language: "ko", showTitles: true })).resolves.toBe('{"summary":"문장입니다 문장입니다."}');
    const body = invoke.mock.calls[0][1].body;
    expect(invoke.mock.calls[0][0]).toBe("classify-activity");
    expect(body).toMatchObject({ mode: "suggest_memory", stage: "draft", language: "ko", showTitles: true, device: "test",
      cluster: { app: "Aside", domain: "overleaf.com", kind: "work", signal: "mixed", minutes: 62, days: 3,
        productivityMinutes: { focus: 40, neutral: 0, drift: 21 }, meanModelConfidence: 0.87 } });
    expect(body).not.toHaveProperty("summary");
    expect(body.cluster.evidence).toHaveLength(6);
    expect(body.cluster.evidence[0]).toEqual({ title: "Title 0", minutes: 7, filedAs: "focus", reason: "Editing" });
    expect(JSON.stringify(body)).not.toContain("ignored");

    await complete({ prompt: "ignored", cluster, language: "en", showTitles: false });
    const hidden = invoke.mock.calls[1][1].body;
    expect(hidden.cluster.evidence.every((row: { title: string; reason: string }) => row.title === "" && row.reason === "")).toBe(true);
  });

  it("passes a skip through and sends the drafted rule for verification", async () => {
    invoke.mockResolvedValueOnce({ data: { skip: true }, error: null });
    const complete = createCloudSuggestionCompleter();
    await expect(complete({ prompt: "p", cluster, language: "en", showTitles: true })).resolves.toBe('{"skip":true}');
    invoke.mockResolvedValueOnce({ data: { labels: ["work", "distraction"] }, error: null });
    await expect(complete({ prompt: "p", cluster, language: "en", showTitles: true, verify: { summary: "Rule here." } }))
      .resolves.toBe('{"labels":["work","distraction"]}');
    expect(invoke.mock.calls[1][1].body).toMatchObject({ stage: "verify", summary: "Rule here." });
  });

  it("never sends a settled place", async () => {
    await expect(createCloudSuggestionCompleter()({ prompt: "p", cluster: { ...cluster, signal: "settled" }, language: "en", showTitles: true })).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["an invoke error", { data: null, error: new Error("boom") }],
    ["a missing summary", { data: {}, error: null }],
    ["a non-string summary", { data: { summary: 5 }, error: null }],
  ])("returns null for %s", async (_name, response) => {
    invoke.mockResolvedValue(response);
    await expect(createCloudSuggestionCompleter()({ prompt: "p", cluster, language: "ko", showTitles: true })).resolves.toBeNull();
  });

  it("returns null when the call throws", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("offline")));
    await expect(createCloudSuggestionCompleter()({ prompt: "p", cluster, language: "ko", showTitles: true })).resolves.toBeNull();
  });
});


it("rechecks consent after native device identity preparation", async () => {
  invoke.mockReset();
  let allowed = true;
  let finish!: (body: unknown) => void;
  withDevice.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const result = createCloudSuggestionCompleter(() => allowed)({ prompt: "p", cluster, language: "en", showTitles: true });
  allowed = false;
  finish({ cloudDevice: "synthetic" });
  await expect(result).resolves.toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});
