/**
 * Whether finished Chat turns are kept with the signed-in account for product
 * improvement (`chat_turn_records`). It is separate from usage statistics and
 * off by default (owner decision 2026-11-16): only an explicit "1" turns it on,
 * and an unreadable store reads as off.
 */
export const CHAT_IMPROVEMENT_PREFERENCE_STORAGE_KEY = "drifty.privacy.chatImprovement.v1";
export const CHAT_IMPROVEMENT_PREFERENCE_CHANGED_EVENT = "drifty:chat-improvement-preference-changed";

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readChatImprovementEnabled(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(CHAT_IMPROVEMENT_PREFERENCE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Saves the choice and returns the state now in effect; a failed save leaves it off. */
export function writeChatImprovementEnabled(
  enabled: boolean,
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
): boolean {
  let effective = false;
  try {
    if (storage) {
      const value = enabled ? "1" : "0";
      storage.setItem(CHAT_IMPROVEMENT_PREFERENCE_STORAGE_KEY, value);
      effective = enabled && storage.getItem(CHAT_IMPROVEMENT_PREFERENCE_STORAGE_KEY) === value;
    }
  } catch {
    effective = false;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHAT_IMPROVEMENT_PREFERENCE_CHANGED_EVENT, { detail: { enabled: effective } }));
  }
  return effective;
}

