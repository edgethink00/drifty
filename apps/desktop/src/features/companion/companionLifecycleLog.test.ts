import { describe, expect, it } from "vitest";
import { recordCompanionLifecycle } from "./companionLifecycleLog";
import { readRecentDriftAlarmDebugEvents } from "./driftAlarmDebugLog";
import { vi } from "vitest";

describe("Companion lifecycle diagnostics", () => {
  it("correlates lifecycle stages without storing activity-bearing IDs", () => {
    const data = new Map<string, string>();
    const storage: Storage = {
      get length() { return data.size; },
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      removeItem: (key: string) => { data.delete(key); },
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    };
    vi.stubGlobal("window", { localStorage: storage });
    try {
      const privateKey = "driftAlarm:private-window-title:youtube.com";
      recordCompanionLifecycle("accepted", privateKey);
      recordCompanionLifecycle("presented", privateKey);
      const events = readRecentDriftAlarmDebugEvents(storage);
      expect(events.map((event) => event.kind)).toEqual(["companion_lifecycle", "companion_lifecycle"]);
      expect(events[0]?.alertKey).toMatch(/^moment-[0-9a-f]+$/);
      expect(events[0]?.alertKey).toBe(events[1]?.alertKey);
      expect(JSON.stringify(events)).not.toContain("private-window-title");
      expect(JSON.stringify(events)).not.toContain("youtube.com");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
