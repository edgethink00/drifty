import type { ChatConversation, ChatToolStep, ChatTurn } from "./chatTypes";

export type MemoryEvidence = {
  readonly id: string;
  readonly app: string;
  readonly observedAt: number;
  readonly expiresAt: number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isMemoryTool = (name: string) => /^(?:mcp__drifty__)?memory_(search|source|recent|wiki)$/.test(name);
export const isMemoryTurn = (turn: ChatTurn) => turn.memorySensitive === true || turn.tools.some((tool) => isMemoryTool(tool.name));

/** Temporary memory content never enters plaintext saved chats or analytics. */
export function withoutMemoryTurns(conversations: readonly ChatConversation[]): ChatConversation[] {
  return conversations.flatMap((conversation) => {
    const firstMemory = conversation.turns.findIndex(isMemoryTurn);
    // Later questions may paraphrase a memory answer even without a tool call.
    const turns = firstMemory < 0 ? conversation.turns : conversation.turns.slice(0, firstMemory);
    return turns.length ? [{ ...conversation, turns }] : [];
  });
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Evidence comes from bounded native tool output, never links invented in an answer. */
export function memoryEvidence(tools: readonly ChatToolStep[]): MemoryEvidence[] {
  const result = new Map<string, MemoryEvidence>();
  for (const tool of tools) {
    if (!isMemoryTool(tool.name) || tool.status !== "done" || !tool.result) continue;
    try {
      const payload: unknown = JSON.parse(tool.result);
      if (!object(payload) || payload.kind !== "observed_memory") continue;
      const candidates = Array.isArray(payload.data) ? payload.data.map((item: unknown) => object(item) ? item.source : null) : [payload.data];
      for (const source of candidates) {
        if (!object(source) || typeof source.source_id !== "string" || !UUID.test(source.source_id)
          || typeof source.app !== "string" || source.app.length > 256
          || typeof source.observed_at_ms !== "number" || !Number.isSafeInteger(source.observed_at_ms)
          || typeof source.expires_at_ms !== "number" || !Number.isSafeInteger(source.expires_at_ms)
          || source.observed_at_ms < 0 || source.expires_at_ms <= source.observed_at_ms) continue;
        result.set(source.source_id, { id: source.source_id, app: source.app, observedAt: source.observed_at_ms, expiresAt: source.expires_at_ms });
      }
    } catch { /* Unreadable output supplies no evidence. */ }
  }
  return [...result.values()].slice(0, 16);
}
