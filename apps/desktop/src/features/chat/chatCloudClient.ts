import { cloudApiClientMetadata } from "../../lib/cloudContract";
import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";
import type { ChatToolCall, ChatToolResult } from "./chatClient";
import { withoutDocumentText } from "./chatAttachments";
import type { ChatFeedback, ChatToolDetail, ChatToolStep, ChatTurn } from "./chatTypes";

/** Drifty Cloud chat models; the server owns the ids, prices and which plan may use each. */
export type ChatCloudModelKey = "sonnet" | "haiku" | "opus" | "fable";

export type ChatCloudCredits = {
  readonly remaining: number;
  readonly granted: number;
  readonly renewsAt: string | null;
};

export type ChatCloudModelOption = {
  readonly key: ChatCloudModelKey;
  readonly label: string;
  readonly allowed: boolean;
  readonly minimumCredits: number;
};

export type ChatCloudStatus =
  | {
    readonly kind: "ready";
    readonly available: boolean;
    readonly plan: string;
    readonly credits: ChatCloudCredits;
    readonly defaultModel: ChatCloudModelKey;
    readonly models: readonly ChatCloudModelOption[];
  }
  | { readonly kind: "sign_in_required" | "full_account_required" | "unconfigured" | "unavailable"; readonly message: string | null };

export type ChatCloudErrorCode =
  | "sign_in_required"
  | "full_account_required"
  | "plan_required"
  | "model_not_in_plan"
  | "credits_exhausted"
  | "credits_low_for_model"
  | "model_unavailable"
  | "too_many_steps"
  | "remote_error";

export class ChatCloudError extends Error {
  readonly code: ChatCloudErrorCode;
  readonly credits: ChatCloudCredits | null;
  constructor(code: ChatCloudErrorCode, message: string, credits: ChatCloudCredits | null = null) {
    super(message);
    this.code = code;
    this.credits = credits;
  }
}

const MODEL_KEYS: readonly ChatCloudModelKey[] = ["sonnet", "haiku", "opus", "fable"];
const MAX_STEPS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseCredits(value: unknown): ChatCloudCredits | null {
  if (!isRecord(value)) return null;
  return {
    remaining: typeof value.remaining === "number" ? value.remaining : 0,
    granted: typeof value.granted === "number" ? value.granted : 0,
    renewsAt: typeof value.renewsAt === "string" ? value.renewsAt : null,
  };
}

export function parseChatCloudStatus(value: unknown): ChatCloudStatus {
  if (!isRecord(value)) return { kind: "unavailable", message: null };
  const models = Array.isArray(value.models)
    ? value.models.flatMap((entry): ChatCloudModelOption[] => {
      if (!isRecord(entry) || !MODEL_KEYS.includes(entry.key as ChatCloudModelKey)) return [];
      return [{
        key: entry.key as ChatCloudModelKey,
        label: typeof entry.label === "string" ? entry.label : String(entry.key),
        allowed: entry.allowed === true,
        minimumCredits: typeof entry.minimumCredits === "number" ? entry.minimumCredits : 1,
      }];
    })
    : [];
  return {
    kind: "ready",
    available: value.available === true,
    plan: typeof value.plan === "string" ? value.plan : "locked",
    credits: parseCredits(value.credits) ?? { remaining: 0, granted: 0, renewsAt: null },
    defaultModel: MODEL_KEYS.includes(value.defaultModel as ChatCloudModelKey) ? value.defaultModel as ChatCloudModelKey : "sonnet",
    models,
  };
}

type Invoke = (body: Record<string, unknown>) => Promise<{ readonly data: unknown; readonly status: number }>;

/** Calls chat-cloud with the signed-in session; HTTP errors come back as their status and JSON body. */
async function defaultInvoke(body: Record<string, unknown>): Promise<{ readonly data: unknown; readonly status: number }> {
  if (!isSupabaseEnabled() || !supabase) return { data: { code: "unconfigured" }, status: 0 };
  const session = await supabase.auth.getSession();
  if (!session.data.session) return { data: { code: "sign_in_required" }, status: 401 };
  const { data, error } = await supabase.functions.invoke("chat-cloud", { body: { ...cloudApiClientMetadata, ...body } });
  if (!error) return { data, status: 200 };
  const context = isRecord(error) ? (error as Record<string, unknown>).context : null;
  if (context instanceof Response) {
    let parsed: unknown = null;
    try {
      parsed = await context.json();
    } catch {
      parsed = null;
    }
    return { data: parsed, status: context.status };
  }
  return { data: { error: error instanceof Error ? error.message : String(error) }, status: 0 };
}

export type ChatCloudAccountWatch = (onChange: () => void) => () => void;

/**
 * Calls onChange when someone signs in or out (or the account changes), so a
 * Chat page that is already open re-reads its Cloud status. The initial session
 * and token refreshes are not changes.
 */
export const watchChatCloudAccount: ChatCloudAccountWatch = (onChange) => {
  if (!isSupabaseEnabled() || !supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") onChange();
  });
  return () => data.subscription.unsubscribe();
};

export async function readChatCloudStatus(invoke: Invoke = defaultInvoke): Promise<ChatCloudStatus> {
  try {
    const { data, status } = await invoke({ action: "status" });
    if (status === 200) return parseChatCloudStatus(data);
    const code = isRecord(data) && typeof data.code === "string" ? data.code : null;
    const message = isRecord(data) && typeof data.error === "string" ? data.error : null;
    if (code === "unconfigured") return { kind: "unconfigured", message };
    if (code === "full_account_required") return { kind: "full_account_required", message };
    if (status === 401 || code === "sign_in_required") return { kind: "sign_in_required", message };
    return { kind: "unavailable", message };
  } catch (error) {
    return { kind: "unavailable", message: error instanceof Error ? error.message : null };
  }
}

type ContentBlock = Record<string, unknown>;
type CloudMessage = { readonly role: "user" | "assistant"; readonly content: string | ContentBlock[] };

export type ChatCloudProgress = {
  readonly notes: readonly string[];
  readonly tools: readonly ChatToolStep[];
  readonly charged: number;
  readonly credits: ChatCloudCredits | null;
};

export type ChatCloudTurnResult = ChatCloudProgress & { readonly answer: string; readonly cancelled: boolean };

/** An earlier question with documents keeps at most this much, as in the CLI prompt. */
const HISTORY_QUESTION_CHARS = 20_000;

/** Earlier finished turns as plain user/assistant text, the way the CLI prompt carries them. */
export function chatCloudHistory(history: readonly ChatTurn[]): CloudMessage[] {
  return history
    .filter((turn) => turn.status === "done" && turn.answer.trim())
    .slice(-6)
    .flatMap((turn): CloudMessage[] => [
      { role: "user", content: (turn.prompt ?? turn.question).trim().slice(0, HISTORY_QUESTION_CHARS) },
      { role: "assistant", content: turn.answer.trim() },
    ]);
}

function errorFrom(data: unknown, status: number): ChatCloudError {
  const code = isRecord(data) && typeof data.code === "string" ? data.code : null;
  const message = isRecord(data) && typeof data.error === "string" ? data.error : "Drifty Cloud did not answer.";
  const credits = isRecord(data) ? parseCredits(data.credits) : null;
  const known: readonly ChatCloudErrorCode[] = ["sign_in_required", "full_account_required", "plan_required", "model_not_in_plan", "credits_exhausted", "credits_low_for_model", "model_unavailable"];
  if (code && known.includes(code as ChatCloudErrorCode)) return new ChatCloudError(code as ChatCloudErrorCode, message, credits);
  if (status === 401) return new ChatCloudError("sign_in_required", message, credits);
  return new ChatCloudError("remote_error", message, credits);
}

/**
 * Runs one Drifty Cloud answer: each step asks the model, then runs the record
 * lookups it requested on this computer and sends their results back, until
 * the model answers without asking for more.
 */
export async function runChatCloudTurn(options: {
  readonly turnId: string;
  readonly model: ChatCloudModelKey;
  readonly instructions: string;
  readonly history: readonly ChatTurn[];
  readonly request: string;
  readonly detail: ChatToolDetail;
  readonly runTool: (call: ChatToolCall) => Promise<ChatToolResult>;
  readonly onProgress: (progress: ChatCloudProgress) => void;
  readonly isCancelled: () => boolean;
  readonly invoke?: Invoke;
}): Promise<ChatCloudTurnResult> {
  const invoke = options.invoke ?? defaultInvoke;
  const messages: CloudMessage[] = [...chatCloudHistory(options.history), { role: "user", content: options.request }];
  const notes: string[] = [];
  let tools: ChatToolStep[] = [];
  let charged = 0;
  let credits: ChatCloudCredits | null = null;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (options.isCancelled()) return { notes, tools, charged, credits, answer: "", cancelled: true };
    const { data, status } = await invoke({ action: "step", model: options.model, turnId: options.turnId, step, instructions: options.instructions, messages });
    if (status !== 200 || !isRecord(data)) throw errorFrom(data, status);
    charged = Math.round((charged + (typeof data.charged === "number" ? data.charged : 0)) * 10) / 10;
    credits = parseCredits(data.credits) ?? credits;
    const content = Array.isArray(data.content) ? data.content.filter(isRecord) : [];
    const texts = content.flatMap((block) => (block.type === "text" && typeof block.text === "string" && block.text.trim() ? [block.text.trim()] : []));
    // Short updates the model writes between tool calls arrive as thinking blocks.
    const updates = content.flatMap((block) => (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim() ? [block.thinking.trim()] : []));
    notes.push(...updates);
    const toolUses = content.filter((block) => block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string");
    if (toolUses.length === 0 || data.stopReason !== "tool_use") {
      options.onProgress({ notes, tools, charged, credits });
      return { notes, tools, charged, credits, answer: texts.join("\n\n"), cancelled: false };
    }
    notes.push(...texts);
    tools = [...tools, ...toolUses.map((block): ChatToolStep => ({
      id: String(block.id), name: String(block.name), args: isRecord(block.input) ? block.input : {}, status: "running",
    }))];
    options.onProgress({ notes, tools, charged, credits });
    messages.push({ role: "assistant", content });
    const results: ContentBlock[] = [];
    for (const block of toolUses) {
      const args = isRecord(block.input) ? block.input : {};
      const result = await options.runTool({ name: String(block.name), arguments: args, detail: options.detail });
      tools = tools.map((tool) => (tool.id === block.id
        ? { ...tool, status: result.isError ? "failed" : "done", result: result.text.slice(0, 20_000) }
        : tool));
      results.push({ type: "tool_result", tool_use_id: block.id, content: result.text || "(no result)", ...(result.isError ? { is_error: true } : {}) });
      options.onProgress({ notes, tools, charged, credits });
    }
    messages.push({ role: "user", content: results });
  }
  throw new ChatCloudError("too_many_steps", "This answer took too many steps.", credits);
}

/**
 * Rates a saved turn (or withdraws the rating with null). Like the turn itself
 * it is sent only while product analytics is on; a turn that was never saved
 * stays unrated on the server, and failures are silent.
 */
export async function sendChatTurnFeedback(turnId: string, rating: ChatFeedback | null, invoke: Invoke = defaultInvoke): Promise<boolean> {
  try {
    const { status } = await invoke({ action: "feedback", turnId, rating });
    return status === 200;
  } catch {
    return false;
  }
}

export type ChatTurnRecordInput = {
  readonly conversationId: string;
  readonly turn: ChatTurn;
  readonly language: string;
  readonly appVersion: string | null;
};

/**
 * Keeps a finished turn for product improvement. Callers send it only while
 * the product analytics setting is on and someone is signed in; failures are
 * silent because the chat itself is already saved on this computer.
 */
export async function recordChatTurn(input: ChatTurnRecordInput, invoke: Invoke = defaultInvoke): Promise<boolean> {
  const { turn } = input;
  if (turn.status === "running") return false;
  try {
    const { status } = await invoke({
      action: "record",
      record: {
        conversationId: input.conversationId,
        turnId: turn.id,
        connection: turn.connection,
        model: turn.model ?? null,
        language: input.language,
        question: turn.question,
        // Attached documents stay on this computer: the saved request keeps only their names.
        request: turn.prompt ? withoutDocumentText(turn.prompt) : null,
        answer: turn.answer,
        status: turn.status,
        toolCalls: turn.tools.map((tool) => ({ name: tool.name, arguments: tool.args, status: tool.status, result: tool.result ?? null })),
        suggestions: turn.suggestions ?? [],
        startedAt: turn.startedAt,
        finishedAt: turn.finishedAt,
        appVersion: input.appVersion,
      },
    });
    return status === 200;
  } catch {
    return false;
  }
}

