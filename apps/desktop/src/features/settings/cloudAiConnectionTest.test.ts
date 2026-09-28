import { describe, expect, it, vi } from "vitest";

import { testCloudAiConnection } from "./cloudAiConnectionTest";

type CloudTestClient = NonNullable<Parameters<typeof testCloudAiConnection>[0]>;

describe("testCloudAiConnection", () => {
  it("formats a successful Cloud AI provider probe", async () => {
    const { client, invoke } = createClient({
      data: { ok: true, provider: "openrouter", model: "deepseek/deepseek-v4-flash", latencyMs: 88 },
      error: null,
    });

    const result = await testCloudAiConnection(client);

    expect(result).toEqual({ kind: "success", message: "Cloud AI connected in 88 ms." });
    expect(invoke).toHaveBeenCalledWith("test-ai-connection", {
      body: { clientVersion: "0.9.0", contractVersion: "cloud-api-v1", trialActivation: "explicit-v1" },
    });
  });

  it("surfaces Cloud AI function error messages", async () => {
    const { client } = createClient({
      data: null,
      error: { context: new Response(JSON.stringify({ error: "Drifty Cloud billing needs attention." }), { status: 402 }) },
    });

    const result = await testCloudAiConnection(client);

    expect(result).toEqual({ kind: "error", issueKind: "provider", message: "Drifty Cloud billing needs attention." });
  });

  it("hides the internal Cloud route from both fallback providers", async () => {
    const google = createClient({
      data: { ok: true, provider: "google", model: "gemini-3.1-flash-lite", latencyMs: 42 },
      error: null,
    });

    const result = await testCloudAiConnection(google.client);

    expect(result).toEqual({ kind: "success", message: "Cloud AI connected in 42 ms." });
    expect(result.kind === "success" ? result.message : "").not.toMatch(/Google|OpenRouter|gemini|deepseek/u);
  });

  it("reports missing Supabase configuration", async () => {
    await expect(testCloudAiConnection(null)).resolves.toEqual({ kind: "error", issueKind: "provider", message: "Supabase is not configured." });
  });
});

function createClient(result: unknown): { readonly client: CloudTestClient; readonly invoke: ReturnType<typeof vi.fn> } {
  const invoke = vi.fn().mockResolvedValue(result);
  return {
    client: { functions: { invoke } },
    invoke,
  };
}
