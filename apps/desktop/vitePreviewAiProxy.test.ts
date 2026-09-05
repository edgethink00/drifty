import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import { PREVIEW_AI_MOCK_BASE_URL, PREVIEW_AI_PROXY_PATH } from "./src/features/settings/previewAiContract";
import { previewAiProxyPlugin } from "./vitePreviewAiProxy";

type PreviewMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void;

const openServers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("previewAiProxyPlugin", () => {
  it("serves the built-in model mock only to same-origin POST requests", async () => {
    const origin = await startPreviewServer();

    const response = await fetch(`${origin}${PREVIEW_AI_PROXY_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify({
        command: "ai_list_openai_models",
        request: { baseUrl: PREVIEW_AI_MOCK_BASE_URL, apiKey: null },
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { readonly status: number; readonly body: string };
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      data: [{ id: "drifty-preview-fast" }, { id: "drifty-preview-reasoning" }],
    });
  });

  it("rejects cross-origin requests before reading proxy commands", async () => {
    const origin = await startPreviewServer();

    const response = await fetch(`${origin}${PREVIEW_AI_PROXY_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.example",
      },
      body: JSON.stringify({ command: "ai_list_openai_models", request: {} }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Cross-origin preview AI proxy requests are not allowed.",
    });
  });
});

async function startPreviewServer(): Promise<string> {
  let middleware: PreviewMiddleware | null = null;
  const configureServer = previewAiProxyPlugin(true).configureServer;
  if (typeof configureServer !== "function") throw new Error("Preview proxy did not expose a Vite server hook.");
  configureServer({
    middlewares: {
      use: (...args: unknown[]) => {
        const candidate = args.at(-1);
        if (typeof candidate === "function") middleware = candidate as PreviewMiddleware;
      },
    },
  } as unknown as ViteDevServer);
  if (!middleware) throw new Error("Preview proxy middleware was not registered.");

  const activeMiddleware = middleware;
  const server = createServer((request, response) => {
    activeMiddleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
