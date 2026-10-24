import { describe, expect, it } from "vitest";

import {
  CHAT_CONVERSATIONS_STORAGE_KEY,
  chatConversationTitle,
  readChatConversations,
  removeChatConversation,
  upsertChatConversation,
  writeChatConversations,
} from "./chatStore";
import type { ChatConversation } from "./chatTypes";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function conversation(id: string, updatedAt: string, status: "done" | "running" = "done"): ChatConversation {
  return {
    id, title: id, createdAt: updatedAt, updatedAt,
    turns: [{ id: id + "-turn", question: "q", connection: "codex", status, notes: [], answer: "a", tools: [], error: null, startedAt: updatedAt, finishedAt: null }],
  };
}

describe("chats saved on this computer", () => {
  it("leaves out a damaged record-lookup step instead of the whole chat", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    const saved = conversation("c1", "2026-10-24T00:00:00.000Z");
    const turn = { ...saved.turns[0], tools: [{ id: "t1", name: "summary", arguments: { day: "2026-10-23" }, status: "done" }, { id: "t2", name: "timeline", args: { day: "2026-10-23" }, status: "done" }] };
    storage.setItem(CHAT_CONVERSATIONS_STORAGE_KEY, JSON.stringify([{ ...saved, turns: [turn] }]));
    const [read] = readChatConversations(storage);
    expect(read.turns[0].tools.map((step) => step.id)).toEqual(["t2"]);
    expect(read.turns[0].answer).toBe("a");
  });

  it("round-trips newest first and keeps at most fifty", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    const many = Array.from({ length: 55 }, (_, index) => conversation("c" + index, new Date(2026, 9, 1, 0, index).toISOString()));
    writeChatConversations(many, storage);
    const read = readChatConversations(storage);
    expect(read).toHaveLength(50);
    expect(read[0].id).toBe("c54");
  });

  it("shows a turn that was running when the app closed as stopped", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    writeChatConversations([conversation("c", "2026-10-24T00:00:00.000Z", "running")], storage);
    expect(readChatConversations(storage)[0].turns[0].status).toBe("cancelled");
  });

  it("ignores damaged storage", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    storage.setItem(CHAT_CONVERSATIONS_STORAGE_KEY, "{not json");
    expect(readChatConversations(storage)).toEqual([]);
    storage.setItem(CHAT_CONVERSATIONS_STORAGE_KEY, JSON.stringify([{ id: 1 }, conversation("ok", "2026-10-24T00:00:00.000Z")]));
    expect(readChatConversations(storage).map((entry) => entry.id)).toEqual(["ok"]);
  });

  it("titles a chat from its first question and replaces or removes by id", () => {
    expect(chatConversationTitle("  어제   뭐 했어?\n")).toBe("어제 뭐 했어?");
    expect(chatConversationTitle("x".repeat(80))).toHaveLength(60);
    const list = [conversation("a", "1"), conversation("b", "2")];
    expect(upsertChatConversation(list, { ...list[1], title: "new" }).map((entry) => entry.title)).toEqual(["new", "a"]);
    expect(removeChatConversation(list, "a").map((entry) => entry.id)).toEqual(["b"]);
  });
});

