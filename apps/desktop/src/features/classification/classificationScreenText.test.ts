// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { ScreenContextClient, type ScreenContextInvoke } from "../screen-context/screenContextClient";
import { createActivityScreenTextReader, markScreenTextNoticed } from "../screen-context/screenTextUse";
import { DEFAULT_AI_PRIVACY_REQUEST_SETTINGS, updateAiPrivacyRequestOptionalSetting } from "../settings/aiPrivacyRequestSettings";
import { classificationSupportsImages, setClassificationScreenTextReader, setClassificationVisualReader, withScreenText } from "./classificationScreenText";
import { createActivityVisualReader, imageLimits } from "../screen-context/screenVisualUse";
import type { MinimizedActivityPayload } from "./localAiProviderRequest";

const LEASE = "a9db1b29-80fb-4104-9272-46e0845a4774";
const clients: ScreenContextClient[] = [];
const unregister: (() => void)[] = [];
beforeEach(() => window.localStorage.clear());
afterEach(() => { clients.splice(0).forEach((client) => client.dispose()); unregister.splice(0).forEach((done) => done()); });

const segment = (id: string, extra: Partial<ActivitySegment> = {}): ActivitySegment => ({
  id, startedAt: "2026-11-12T09:00:00+09:00", endedAt: "2026-11-12T09:20:00+09:00", durationSeconds: 1200,
  appName: "Slack", platform: "macos", source: "accessibility", ...extra,
} as ActivitySegment);
const payload = (segmentId: string): MinimizedActivityPayload => ({
  segmentId, inputFingerprint: "fp-" + segmentId, startedAt: "", endedAt: "", durationSeconds: 1200, appName: "Slack",
  bundleId: null, browserName: null, siteDomain: null, siteUrl: null, siteTitle: null, windowTitle: "general", youtubeTitle: null,
  youtubeChannelName: null, youtubeCategory: null, youtubeIsShorts: null,
});

async function connected(answer: (args: Record<string, unknown> | undefined) => unknown) {
  const invoke = vi.fn<ScreenContextInvoke>(async (command, args) => {
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") return { leaseId: LEASE, value: { mode: "local", expiresAtMs: Date.now() + 900_000 } };
    if (command === "screen_context_activity_text" || command === "screen_context_activity_input") return { leaseId: LEASE, value: answer(args) };
    throw new Error("Unexpected command " + command);
  });
  const client = new ScreenContextClient(invoke, true);
  client.setAccount(null);
  clients.push(client);
  await client.connect();
  unregister.push(setClassificationScreenTextReader(createActivityScreenTextReader(client)));
  return invoke;
}

describe("screen text in classification", () => {
  it("adds a redacted excerpt to the items that still need an answer, keeping fingerprints", async () => {
    const invoke = await connected(() => ["Juniper release checklist: move launch to Monday, api_key=sk-abcdefghijklmnopqrstuvwxyz", null]);
    markScreenTextNoticed();
    const items = await withScreenText([payload("1"), payload("2")], [segment("1"), segment("2"), segment("3")], DEFAULT_AI_PRIVACY_REQUEST_SETTINGS);
    expect(items[0].screenText).toBe("Juniper release checklist: move launch to Monday, api_key=[redacted]");
    expect(items[0].inputFingerprint).toBe("fp-1");
    expect(items[1].screenText).toBeUndefined();
    // Only the items about to be sent are read, as local record IDs with their own time window.
    const args = invoke.mock.calls.find(([command]) => command === "screen_context_activity_text")?.[1] as { activities: { recordIds: string[]; windows: number[][] }[] };
    expect(args.activities.map((activity) => activity.recordIds)).toEqual([["1"], ["2"]]);
    expect(args.activities[0].windows).toEqual([[Date.parse("2026-11-12T09:00:00+09:00"), Date.parse("2026-11-12T09:20:00+09:00")]]);
  });

  it("sends nothing before the notice, with the switch off, or for another device's records", async () => {
    const invoke = await connected((args) => (args?.activities as unknown[]).map(() => "A long enough screen text about the release plan"));
    const off = updateAiPrivacyRequestOptionalSetting(DEFAULT_AI_PRIVACY_REQUEST_SETTINGS, "screenText", false);
    expect((await withScreenText([payload("1")], [segment("1")], DEFAULT_AI_PRIVACY_REQUEST_SETTINGS))[0].screenText).toBeUndefined();
    markScreenTextNoticed();
    expect((await withScreenText([payload("1")], [segment("1")], off))[0].screenText).toBeUndefined();
    expect((await withScreenText([payload("sync:9")], [segment("sync:9", { deviceId: "other" } as Partial<ActivitySegment>)], DEFAULT_AI_PRIVACY_REQUEST_SETTINGS))[0].screenText).toBeUndefined();
    expect(invoke.mock.calls.filter(([command]) => command === "screen_context_activity_text")).toHaveLength(0);
  });

  it("goes on without screen text when the read fails or the answer is malformed", async () => {
    markScreenTextNoticed();
    await connected(() => ["only one answer for two"]);
    const items = await withScreenText([payload("1"), payload("2")], [segment("1"), segment("2")], DEFAULT_AI_PRIVACY_REQUEST_SETTINGS);
    expect(items.map((item) => item.screenText)).toEqual([undefined, undefined]);
  });

  it("uses bounded native images only when the Dev reader and a vision route are both active", async () => {
    const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=";
    markScreenTextNoticed();
    const invoke = await connected(() => [{ text: "A sufficiently long screen observation about a draft", images: [{ mediaType: "image/png", data, observedAtMs: Date.parse(segment("1").startedAt) + 100 }] }]);
    unregister.push(setClassificationVisualReader(createActivityVisualReader(clients[0])));
    const result = await withScreenText([payload("1")], [segment("1")], DEFAULT_AI_PRIVACY_REQUEST_SETTINGS, true);
    expect(result[0].screenImages).toEqual([{ mediaType: "image/png", data, offsetSeconds: 0.1 }]);
    expect(result[0].inputFingerprint).toBe("fp-1");
    expect(invoke.mock.calls.filter(([command]) => command === "screen_context_activity_input")).toHaveLength(1);
    expect(imageLimits(1)).toEqual([3]);
    expect(imageLimits(20).reduce((a, b) => a + b, 0)).toBe(3);
    expect(classificationSupportsImages(null)).toBe(true);
    expect(classificationSupportsImages({ provider: "anthropic", apiKey: "fake", model: "claude-haiku-5-5" })).toBe(true);
    expect(classificationSupportsImages({ provider: "managed_local", baseUrl: "http://localhost", model: "qwen", modelId: "qwen" })).toBe(false);
    expect(classificationSupportsImages({ provider: "openrouter_byok", apiKey: "fake", model: "anthropic/claude-haiku-5.5", fallbackModels: ["text-only/model"] })).toBe(false);
  });

  it("drops pixels if Dev mode was disabled while a read was pending", async () => {
    markScreenTextNoticed();
    await connected(() => []);
    let complete!: (value: Map<string, { images: [] }>) => void;
    const stop = setClassificationVisualReader(() => new Promise(resolve => { complete = resolve; }));
    const pending = withScreenText([payload("1")], [segment("1")], DEFAULT_AI_PRIVACY_REQUEST_SETTINGS, true);
    stop(); complete(new Map([["1", { images: [] }]]));
    expect(await pending).toEqual([payload("1")]);
  });

  it("retains the OCR fallback if the installed native command is older", async () => {
    markScreenTextNoticed();
    await connected(() => ["A sufficiently long existing OCR observation about the release"]);
    unregister.push(setClassificationVisualReader(async () => { throw new Error("unknown command"); }));
    const result = await withScreenText([payload("1")], [segment("1")], DEFAULT_AI_PRIVACY_REQUEST_SETTINGS, true);
    expect(result[0].screenText).toContain("existing OCR");
    expect(result[0].screenImages).toBeUndefined();
  });
});
