import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalSuggestionCompleter } from "./memorySuggestionProvider";
import type { LocalAiProviderConfig } from "./localAiProviderRequest";
import type { SuggestionCluster } from "./memorySuggestions";

const cluster = { key: "a", app: "A", domain: "", kind: "work", minutes: 30, days: 2, blocks: 3, modelFiledShare: 1,
  productivityMinutes: { focus: 30, neutral: 0, drift: 0 }, evidence: [] } as SuggestionCluster;
const request = (prompt: string) => ({ prompt, cluster, language: "ko" as const, showTitles: true });

const invoke = vi.hoisted(() => vi.fn());
vi.mock("./managedLocalAiChat", () => ({ invokeOpenAiChatWithManagedLocalRetry: invoke }));

const selfHosted = { provider: "self_hosted", baseUrl: "http://127.0.0.1:8080", model: "local-model" } as unknown as LocalAiProviderConfig;

describe("createLocalSuggestionCompleter", () => {
  beforeEach(() => { invoke.mockReset(); });

  it("returns the message text and sends the prompt as the only user message", async () => {
    invoke.mockResolvedValue({ status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"summary":"x"}' } }] }) });
    const complete = createLocalSuggestionCompleter(selfHosted);
    await expect(complete(request("hello"))).resolves.toBe('{"summary":"x"}');
    expect(invoke.mock.calls[0][0].messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("joins content parts", async () => {
    invoke.mockResolvedValue({ status: 200, body: JSON.stringify({ choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }] }) });
    await expect(createLocalSuggestionCompleter(selfHosted)(request("p"))).resolves.toBe("a\nb");
  });

  it.each([
    ["an HTTP error", { status: 500, body: "{}" }],
    ["a missing body", { status: 200 }],
    ["invalid JSON", { status: 200, body: "nope" }],
    ["no choices", { status: 200, body: "{}" }],
  ])("returns null for %s", async (_name, response) => {
    invoke.mockResolvedValue(response);
    await expect(createLocalSuggestionCompleter(selfHosted)(request("p"))).resolves.toBeNull();
  });

  it("returns null when the provider throws", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("offline")));
    const result = await createLocalSuggestionCompleter(selfHosted)(request("p"));
    expect(result).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("returns null without calling the provider when no request can be built", async () => {
    const incomplete = { provider: "self_hosted", baseUrl: "", model: "" } as unknown as LocalAiProviderConfig;
    const result = await createLocalSuggestionCompleter(incomplete)(request("p"));
    expect(result).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

