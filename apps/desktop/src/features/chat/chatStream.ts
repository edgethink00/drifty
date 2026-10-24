import type { ChatProvider, ChatToolStep } from "./chatTypes";

/** What one running turn has produced so far, rebuilt from the CLI's JSON lines. */
export type ChatStreamState = {
  readonly texts: readonly string[];
  readonly live: string;
  readonly tools: readonly ChatToolStep[];
  readonly finalText: string | null;
  readonly error: string | null;
  readonly completed: boolean;
};

export const EMPTY_CHAT_STREAM: ChatStreamState = {
  texts: [],
  live: "",
  tools: [],
  finalText: null,
  error: null,
  completed: false,
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const MAX_TOOL_RESULT_CHARS = 20_000;

/** Text of a tool result from Codex (object with content blocks) or Claude (string or blocks). */
export function toolResultText(value: unknown): string | null {
  let text: string | null = null;
  if (typeof value === "string") text = value;
  else if (Array.isArray(value)) {
    text = value.map((block) => asString(asObject(block)?.text) ?? "").join("");
  } else {
    const object = asObject(value);
    if (object && Array.isArray(object.content)) text = toolResultText(object.content);
  }
  if (text === null || !text.trim()) return null;
  return text.length <= MAX_TOOL_RESULT_CHARS ? text : text.slice(0, MAX_TOOL_RESULT_CHARS);
}

function upsertTool(tools: readonly ChatToolStep[], step: ChatToolStep): ChatToolStep[] {
  const index = tools.findIndex((tool) => tool.id === step.id);
  if (index < 0) return [...tools, step];
  const next = [...tools];
  next[index] = { ...next[index], ...step, args: Object.keys(step.args).length > 0 ? step.args : next[index].args };
  return next;
}

/** Strip the host's MCP prefix: "mcp__drifty__summary" and "summary" are the same tool. */
export function chatToolName(name: string): string {
  return name.replace(/^mcp__drifty__/, "");
}

function reduceCodex(state: ChatStreamState, event: JsonObject): ChatStreamState {
  const type = asString(event.type);
  const item = asObject(event.item);
  if ((type === "item.started" || type === "item.updated" || type === "item.completed") && item) {
    const itemType = asString(item.type);
    const id = asString(item.id) ?? String(state.tools.length + state.texts.length);
    if (itemType === "agent_message" && type === "item.completed") {
      const text = asString(item.text)?.trim();
      return text ? { ...state, texts: [...state.texts, text] } : state;
    }
    if (itemType === "mcp_tool_call") {
      const itemStatus = asString(item.status);
      const failed = itemStatus === "failed" || item.error != null;
      const status = type === "item.completed" ? (failed ? "failed" : "done") : "running";
      const result = type === "item.completed" ? toolResultText(item.result) : null;
      return {
        ...state,
        tools: upsertTool(state.tools, {
          id,
          name: chatToolName(asString(item.tool) ?? "tool"),
          args: asObject(item.arguments) ?? {},
          status,
          ...(result ? { result } : {}),
        }),
      };
    }
    return state;
  }
  if (type === "turn.completed") return { ...state, completed: true };
  if (type === "turn.failed") {
    const message = asString(asObject(event.error)?.message) ?? "The agent could not finish this answer.";
    return { ...state, error: message, completed: true };
  }
  if (type === "error") {
    const message = asString(event.message);
    return message ? { ...state, error: message } : state;
  }
  return state;
}

function reduceClaude(state: ChatStreamState, event: JsonObject): ChatStreamState {
  const type = asString(event.type);
  if (type === "stream_event") {
    const inner = asObject(event.event);
    const delta = asObject(inner?.delta);
    if (asString(inner?.type) === "content_block_delta" && asString(delta?.type) === "text_delta") {
      return { ...state, live: state.live + (asString(delta?.text) ?? "") };
    }
    return state;
  }
  if (type === "assistant") {
    const content = asObject(event.message)?.content;
    if (!Array.isArray(content)) return state;
    let next: ChatStreamState = { ...state, live: "" };
    for (const block of content) {
      const entry = asObject(block);
      const blockType = asString(entry?.type);
      if (blockType === "text") {
        const text = asString(entry?.text)?.trim();
        if (text) next = { ...next, texts: [...next.texts, text] };
      } else if (blockType === "tool_use") {
        next = {
          ...next,
          tools: upsertTool(next.tools, {
            id: asString(entry?.id) ?? String(next.tools.length),
            name: chatToolName(asString(entry?.name) ?? "tool"),
            args: asObject(entry?.input) ?? {},
            status: "running",
          }),
        };
      }
    }
    return next;
  }
  if (type === "user") {
    const content = asObject(event.message)?.content;
    if (!Array.isArray(content)) return state;
    let tools = state.tools;
    for (const block of content) {
      const entry = asObject(block);
      if (asString(entry?.type) !== "tool_result") continue;
      const id = asString(entry?.tool_use_id);
      const existing = tools.find((tool) => tool.id === id);
      const result = toolResultText(entry?.content);
      if (existing) tools = upsertTool(tools, { ...existing, status: entry?.is_error === true ? "failed" : "done", ...(result ? { result } : {}) });
    }
    return { ...state, tools };
  }
  if (type === "result") {
    const result = asString(event.result)?.trim() ?? null;
    if (event.is_error === true || (asString(event.subtype) ?? "success") !== "success") {
      return { ...state, live: "", error: result || "The agent could not finish this answer.", completed: true };
    }
    return { ...state, live: "", finalText: result, completed: true };
  }
  return state;
}

/** Fold one stdout line from the agent CLI into the turn's progress. */
export function reduceChatStreamLine(state: ChatStreamState, provider: ChatProvider, line: string): ChatStreamState {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return state;
  }
  const object = asObject(event);
  if (!object) return state;
  return provider === "codex" ? reduceCodex(state, object) : reduceClaude(state, object);
}

/** Split what was written into notes before the answer and the answer itself. */
export function chatStreamAnswer(state: ChatStreamState): { readonly notes: readonly string[]; readonly answer: string } {
  const texts = state.live.trim() ? [...state.texts, state.live.trim()] : [...state.texts];
  if (state.finalText) {
    const notes = texts.filter((text) => text !== state.finalText);
    return { notes, answer: state.finalText };
  }
  if (texts.length === 0) return { notes: [], answer: "" };
  return { notes: texts.slice(0, -1), answer: texts[texts.length - 1] };
}

