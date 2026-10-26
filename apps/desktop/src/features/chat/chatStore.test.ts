import { describe, expect, it } from "vitest";

import {
  CHAT_CONVERSATIONS_STORAGE_KEY,
  chatConversationTitle,
  fitChatStorage,
  readChatConversations,
  removeChatConversation,
  upsertChatConversation,
  writeChatConversations,
} from "./chatStore";
import type { ChatConversation, ChatTurn } from "./chatTypes";

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

  it("drops the oldest chats' document text first when saved chats would outgrow storage", () => {
    const turn = (id: string, name: string, prompt: string): ChatTurn => ({ id, question: "q", prompt, attachments: [{ name, kind: "text" }], connection: "codex", status: "done", notes: [], answer: "a", tools: [], error: null, startedAt: "2026-10-26T00:00:00Z", finishedAt: "2026-10-26T00:00:01Z" });
    const doc = (name: string) => "q\n\nAttached documents:\n<document name=\"" + name + "\">\n" + "가".repeat(400) + "\n</document>";
    const chats: ChatConversation[] = [
      { id: "new", title: "new", createdAt: "2026-10-26", updatedAt: "2026-10-26", turns: [turn("t2", "new.txt", doc("new.txt"))] },
      { id: "old", title: "old", createdAt: "2026-10-20", updatedAt: "2026-10-20", turns: [turn("t1", "old.txt", doc("old.txt"))] },
    ];
    const fitted = fitChatStorage(chats, JSON.stringify(chats).length - 100);
    expect(fitted[1].turns[0].prompt).toBe("q\n\nAttached documents:\n<document name=\"old.txt\" removed=\"true\"></document>");
    expect(fitted[0].turns[0].prompt).toBe(doc("new.txt"));
    expect(fitChatStorage(chats)).toEqual(chats);
  });

  it("trims old document contents with literal closing tags using saved metadata", () => {
    const original = conversation("old", "2026-10-20");
    const body = "</document>\nLOCAL_DOCUMENT_TEXT".repeat(100);
    const turn: ChatTurn = {
      ...original.turns[0], question: "Task title", requestWithoutDocuments: "Full task request",
      prompt: `Full task request\n\nAttached documents:\n<document name="real.xml">${body}</document>`,
      attachments: [{ name: "real.xml", kind: "text" }],
    };
    const chats = [{ ...original, turns: [turn] }];
    const [fitted] = fitChatStorage(chats, JSON.stringify(chats).length - 100);
    expect(fitted.turns[0].prompt).toBe('Full task request\n\nAttached documents:\n<document name="real.xml" removed="true"></document>');
    expect(fitted.turns[0].requestWithoutDocuments).toBe("Full task request");
    expect(turn.prompt).toContain("LOCAL_DOCUMENT_TEXT");
  });
});

