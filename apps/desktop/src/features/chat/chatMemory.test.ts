import { describe, expect, it } from "vitest";
import { memoryEvidence, withoutMemoryTurns } from "./chatMemory";
import { readChatConversations, writeChatConversations } from "./chatStore";
import type { ChatConversation, ChatTurn, ChatToolStep } from "./chatTypes";
const turn: ChatTurn = { id: "t", question: "q", connection: "claude", status: "done", notes: [], answer: "ordinary", tools: [], error: null, startedAt: "2026-10-28", finishedAt: "2026-10-28" };
const chat: ChatConversation = { id: "c", title: "q", createdAt: "2026-10-28", updatedAt: "2026-10-28", turns: [turn] };
const tool: ChatToolStep = { id: "s", name: "memory_search", args: { query: "Atlas" }, status: "done", result: JSON.stringify({ kind: "observed_memory", data: [{ source: { source_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", app: "com.hnc.Discord", observed_at_ms: 1000, expires_at_ms: 2000 } }] }) };

describe("temporary memory conversations", () => {
  it("removes derived follow-ups as well as the memory turn before storage", () => {
    const sensitive = { ...turn, id: "s", memorySensitive: true, answer: "PRIVATE_OBSERVATION" };
    const values = [{ ...chat, turns: [turn, sensitive, { ...turn, id: "followup", question: "PRIVATE_PARAPHRASE" }] }];
    expect(withoutMemoryTurns(values)[0].turns).toEqual([turn]);
    let saved = "";
    const storage: Storage = { length: 0, clear: () => {}, key: () => null, removeItem: () => {}, setItem: (_: string, value: string) => { saved = value; }, getItem: () => saved };
    writeChatConversations(values, storage);
    expect(saved).not.toContain("PRIVATE_");
    expect(readChatConversations(storage)[0].turns).toHaveLength(1);
  });
  it("drops the title and metadata of a conversation starting with memory", () => {
    expect(withoutMemoryTurns([{ ...chat, title: "PRIVATE_TITLE", turns: [{ ...turn, tools: [tool] }] }])).toEqual([]);
  });
  it("accepts sources only from memory tool output with a native source id", () => {
    expect(memoryEvidence([tool])).toEqual([{ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", app: "com.hnc.Discord", observedAt: 1000, expiresAt: 2000 }]);
    expect(memoryEvidence([{ ...tool, name: "search" }])).toEqual([]);
    expect(memoryEvidence([{ ...tool, result: tool.result?.replace("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "https://invented.example") }])).toEqual([]);
    expect(memoryEvidence([{ ...tool, status: "failed" }])).toEqual([]);
  });
});
