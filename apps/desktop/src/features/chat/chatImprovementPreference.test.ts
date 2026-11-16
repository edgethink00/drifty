import { describe, expect, it } from "vitest";

import {
  CHAT_IMPROVEMENT_PREFERENCE_STORAGE_KEY,
  readChatImprovementEnabled,
  writeChatImprovementEnabled,
} from "./chatImprovementPreference";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("chat improvement preference", () => {
  it("is off until someone turns it on", () => {
    expect(readChatImprovementEnabled(memoryStorage())).toBe(false);
    expect(readChatImprovementEnabled(memoryStorage({ [CHAT_IMPROVEMENT_PREFERENCE_STORAGE_KEY]: "true" }))).toBe(false);
    expect(readChatImprovementEnabled(memoryStorage({ [CHAT_IMPROVEMENT_PREFERENCE_STORAGE_KEY]: "1" }))).toBe(true);
    expect(readChatImprovementEnabled(null)).toBe(false);
  });

  it("does not follow the usage statistics setting", () => {
    expect(readChatImprovementEnabled(memoryStorage({ "drifty.privacy.productAnalytics.v1": "1" }))).toBe(false);
  });

  it("saves the choice and stays off when it cannot be saved", () => {
    const storage = memoryStorage();
    expect(writeChatImprovementEnabled(true, storage)).toBe(true);
    expect(readChatImprovementEnabled(storage)).toBe(true);
    expect(writeChatImprovementEnabled(false, storage)).toBe(false);
    expect(readChatImprovementEnabled(storage)).toBe(false);
    const broken = { getItem: () => null, setItem: () => { throw new Error("full"); } };
    expect(writeChatImprovementEnabled(true, broken)).toBe(false);
  });
});

