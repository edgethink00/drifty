import { Channel, invoke } from "@tauri-apps/api/core";

import { PREVIEW_CHAT_BRIDGE_PATH } from "./previewChatContract";
import type { ChatProvider, ChatProviderAvailability, ChatRunExit, ChatRuntimeStatus, ChatToolDetail } from "./chatTypes";

export const chatInvokeCommands = {
  status: "chat_cli_status",
  send: "chat_cli_send",
  cancel: "chat_cli_cancel",
  tool: "chat_tool_call",
} as const;

export { PREVIEW_CHAT_BRIDGE_PATH } from "./previewChatContract";

export type ChatSendRequest = {
  readonly requestId: string;
  readonly provider: ChatProvider;
  readonly detail: ChatToolDetail;
  readonly instructions: string;
  readonly prompt: string;
};

/** One record lookup a Drifty Cloud model asked for, run on this computer. */
export type ChatToolCall = {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly detail: ChatToolDetail;
};

export type ChatToolResult = { readonly text: string; readonly isError: boolean };

export type ChatClient = {
  readonly kind: "native" | "preview" | "unavailable";
  readonly getStatus: () => Promise<ChatRuntimeStatus>;
  readonly send: (request: ChatSendRequest, onLine: (line: string) => void) => Promise<ChatRunExit>;
  readonly cancel: (requestId: string) => Promise<void>;
  readonly runTool: (call: ChatToolCall) => Promise<ChatToolResult>;
};

type ChatEventPayload =
  | { readonly kind: "line"; readonly line: string }
  | { readonly kind: "exit"; readonly code: number | null; readonly cancelled: boolean; readonly stderrTail: string };

const UNAVAILABLE_STATUS: ChatRuntimeStatus = {
  providers: [
    { provider: "codex", installed: false, version: null },
    { provider: "claude", installed: false, version: null },
  ],
  toolsAvailable: false,
  toolsMessage: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function parseChatRuntimeStatus(value: unknown): ChatRuntimeStatus {
  if (!isRecord(value) || !Array.isArray(value.providers)) throw new Error("Chat returned an invalid status.");
  const providers: ChatProviderAvailability[] = [];
  for (const entry of value.providers) {
    if (!isRecord(entry)) continue;
    const provider = entry.provider;
    if (provider !== "codex" && provider !== "claude") continue;
    providers.push({
      provider,
      installed: entry.installed === true,
      version: typeof entry.version === "string" ? entry.version : null,
    });
  }
  return {
    providers,
    toolsAvailable: value.toolsAvailable === true,
    toolsMessage: typeof value.toolsMessage === "string" ? value.toolsMessage : null,
  };
}

function parseEventPayload(value: unknown): ChatEventPayload | null {
  if (!isRecord(value)) return null;
  if (value.kind === "line" && typeof value.line === "string") return { kind: "line", line: value.line };
  if (value.kind === "exit") {
    return {
      kind: "exit",
      code: typeof value.code === "number" ? value.code : null,
      cancelled: value.cancelled === true,
      stderrTail: typeof value.stderrTail === "string" ? value.stderrTail : "",
    };
  }
  return null;
}

/** The MCP-style result printed by `drifty-tracker mcp --call`. */
export function parseChatToolResult(raw: string): ChatToolResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { text: "The record tool returned an unreadable result.", isError: true };
  }
  if (!isRecord(value) || !Array.isArray(value.content)) return { text: "The record tool returned an unreadable result.", isError: true };
  const text = value.content
    .map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
    .join("");
  return { text, isError: value.isError === true };
}

function nativeClient(): ChatClient {
  return {
    kind: "native",
    getStatus: async () => parseChatRuntimeStatus(await invoke(chatInvokeCommands.status)),
    send: (request, onLine) => new Promise<ChatRunExit>((resolve, reject) => {
      const channel = new Channel<unknown>();
      channel.onmessage = (message) => {
        const payload = parseEventPayload(message);
        if (!payload) return;
        if (payload.kind === "line") onLine(payload.line);
        else resolve({ code: payload.code, cancelled: payload.cancelled, stderrTail: payload.stderrTail });
      };
      invoke(chatInvokeCommands.send, { request, onEvent: channel }).catch((error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    }),
    cancel: async (requestId) => {
      await invoke(chatInvokeCommands.cancel, { requestId });
    },
    runTool: async (call) => {
      try {
        return parseChatToolResult(await invoke<string>(chatInvokeCommands.tool, { request: call }));
      } catch (error) {
        return { text: error instanceof Error ? error.message : String(error), isError: true };
      }
    },
  };
}

function previewClient(fetcher: typeof fetch = fetch): ChatClient {
  const controllers = new Map<string, AbortController>();
  return {
    kind: "preview",
    getStatus: async () => {
      const response = await fetcher(PREVIEW_CHAT_BRIDGE_PATH + "/status");
      if (!response.ok) throw new Error("The preview Chat bridge is unavailable.");
      return parseChatRuntimeStatus(await response.json());
    },
    send: async (request, onLine) => {
      const controller = new AbortController();
      controllers.set(request.requestId, controller);
      try {
        const response = await fetcher(PREVIEW_CHAT_BRIDGE_PATH + "/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = await response.text().catch(() => "");
          throw new Error(body || "The preview Chat bridge could not start the agent.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          let newline = buffered.indexOf("\n");
          while (newline >= 0) {
            const raw = buffered.slice(0, newline).trim();
            buffered = buffered.slice(newline + 1);
            newline = buffered.indexOf("\n");
            if (!raw) continue;
            let payload: ChatEventPayload | null = null;
            try {
              payload = parseEventPayload(JSON.parse(raw));
            } catch {
              payload = null;
            }
            if (!payload) continue;
            if (payload.kind === "line") onLine(payload.line);
            else return { code: payload.code, cancelled: payload.cancelled, stderrTail: payload.stderrTail };
          }
        }
        return { code: null, cancelled: controller.signal.aborted, stderrTail: "" };
      } catch (error) {
        if (controller.signal.aborted) return { code: null, cancelled: true, stderrTail: "" };
        throw error;
      } finally {
        controllers.delete(request.requestId);
      }
    },
    cancel: async (requestId) => {
      controllers.get(requestId)?.abort();
    },
    runTool: async (call) => {
      const response = await fetcher(PREVIEW_CHAT_BRIDGE_PATH + "/tool", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(call),
      });
      if (!response.ok) return { text: (await response.text().catch(() => "")) || "The preview record tool failed.", isError: true };
      return parseChatToolResult(await response.text());
    },
  };
}

function unavailableClient(): ChatClient {
  return {
    kind: "unavailable",
    getStatus: async () => UNAVAILABLE_STATUS,
    send: async () => {
      throw new Error("Chat needs the Drifty app.");
    },
    cancel: async () => undefined,
    runTool: async () => ({ text: "Chat needs the Drifty app.", isError: true }),
  };
}

export function createChatClient(
  isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window,
  previewFlag: string | undefined = import.meta.env.VITE_DRIFTY_PREVIEW,
  isDev: boolean = import.meta.env.DEV,
): ChatClient {
  if (isTauri) return nativeClient();
  if (isDev && previewFlag === "1") return previewClient();
  return unavailableClient();
}

export const __testing = { previewClient, parseEventPayload };

