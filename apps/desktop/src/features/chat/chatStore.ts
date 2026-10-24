import type { ChatConversation, ChatToolStep, ChatTurn } from "./chatTypes";

export const CHAT_CONVERSATIONS_STORAGE_KEY = "drifty.chat.conversations.v1";
const MAX_CONVERSATIONS = 50;
const MAX_TITLE_CHARS = 60;

function isTurn(value: unknown): value is ChatTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Record<string, unknown>;
  return typeof turn.id === "string" && typeof turn.question === "string" && typeof turn.answer === "string"
    && Array.isArray(turn.notes) && Array.isArray(turn.tools) && typeof turn.status === "string";
}

function isToolStep(value: unknown): value is ChatToolStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Record<string, unknown>;
  return typeof step.id === "string" && typeof step.name === "string" && typeof step.status === "string"
    && Boolean(step.args) && typeof step.args === "object" && !Array.isArray(step.args);
}

function isConversation(value: unknown): value is ChatConversation {
  if (!value || typeof value !== "object") return false;
  const conversation = value as Record<string, unknown>;
  return typeof conversation.id === "string" && typeof conversation.title === "string"
    && typeof conversation.updatedAt === "string" && Array.isArray(conversation.turns)
    && conversation.turns.every(isTurn);
}

/** Conversations saved on this computer only, newest first. */
export function readChatConversations(storage: Storage | undefined = globalThis.localStorage): ChatConversation[] {
  try {
    const raw = storage?.getItem(CHAT_CONVERSATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConversation).map(dropMalformedToolSteps).map(settleInterruptedTurns).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function writeChatConversations(conversations: readonly ChatConversation[], storage: Storage | undefined = globalThis.localStorage): void {
  try {
    const kept = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_CONVERSATIONS);
    storage?.setItem(CHAT_CONVERSATIONS_STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Storage full or unavailable: the conversation stays on screen for this session.
  }
}

/** A damaged record-lookup step is left out rather than breaking the whole saved chat. */
function dropMalformedToolSteps(conversation: ChatConversation): ChatConversation {
  if (conversation.turns.every((turn) => turn.tools.every(isToolStep))) return conversation;
  return { ...conversation, turns: conversation.turns.map((turn) => ({ ...turn, tools: turn.tools.filter(isToolStep) })) };
}

/** A turn still running when the app closed is shown as stopped, never as running forever. */
function settleInterruptedTurns(conversation: ChatConversation): ChatConversation {
  if (!conversation.turns.some((turn) => turn.status === "running")) return conversation;
  return {
    ...conversation,
    turns: conversation.turns.map((turn) => (turn.status === "running" ? { ...turn, status: "cancelled", finishedAt: turn.finishedAt ?? turn.startedAt } : turn)),
  };
}

export function chatConversationTitle(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  return oneLine.length <= MAX_TITLE_CHARS ? oneLine : oneLine.slice(0, MAX_TITLE_CHARS - 1) + "…";
}

export function upsertChatConversation(conversations: readonly ChatConversation[], next: ChatConversation): ChatConversation[] {
  return [next, ...conversations.filter((conversation) => conversation.id !== next.id)];
}

export function removeChatConversation(conversations: readonly ChatConversation[], id: string): ChatConversation[] {
  return conversations.filter((conversation) => conversation.id !== id);
}

