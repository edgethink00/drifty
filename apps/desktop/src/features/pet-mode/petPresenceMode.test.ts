// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PET_PRESENCE_MODE_STORAGE_KEY,
  hasSeenPetTurnOffSuggestion,
  markPetTurnOffSuggestionSeen,
  persistPetPresenceMode,
  resolveInitialPetPresenceMode,
  subscribePetPresenceMode,
} from "./petPresenceMode";

describe("petPresenceMode", () => {
  afterEach(() => window.localStorage.clear());

  it("defaults to the resident cat and only honours the known quiet mode", () => {
    expect(resolveInitialPetPresenceMode()).toBe("always");
    window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "garbage");
    expect(resolveInitialPetPresenceMode()).toBe("always");
    window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "drift_only");
    expect(resolveInitialPetPresenceMode()).toBe("drift_only");
  });

  it("notifies this document and other webviews through the same subscription", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePetPresenceMode(listener);

    persistPetPresenceMode("drift_only");
    expect(window.localStorage.getItem(PET_PRESENCE_MODE_STORAGE_KEY)).toBe("drift_only");
    expect(listener).toHaveBeenLastCalledWith("drift_only");

    window.dispatchEvent(new StorageEvent("storage", { key: PET_PRESENCE_MODE_STORAGE_KEY, newValue: "always" }));
    expect(listener).toHaveBeenLastCalledWith("always");

    unsubscribe();
    persistPetPresenceMode("drift_only");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("remembers that the turn-off suggestion has been shown", () => {
    expect(hasSeenPetTurnOffSuggestion()).toBe(false);
    markPetTurnOffSuggestionSeen();
    expect(hasSeenPetTurnOffSuggestion()).toBe(true);
  });
});
