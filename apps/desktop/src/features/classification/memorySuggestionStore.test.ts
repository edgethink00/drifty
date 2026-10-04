// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  declineSuggestion, readSuggestionStore, recordSuggestionRun, removeSuggestion, shouldRunSuggestions,
  suggestionStoreKey, writeSuggestionStore, recordFailedSuggestionRun, SUGGESTION_RETRY_AFTER_FAILURE_MS, MAX_PENDING_SUGGESTIONS,
  pickSuggestionExamples, toStoredSuggestion,
  type StoredSuggestion, type SuggestionStoreState,
} from "./memorySuggestionStore";

const NOW = new Date("2026-10-04T09:00:00.000Z");
function stored(id: string, summary = "Sentence for " + id + " goes here."): StoredSuggestion {
  return { id, kind: "work", summary, app: "Aside", domain: id + ".com", minutes: 40, days: 3, blocks: 5,
    windowStart: "2026-09-27T09:00:00.000Z", windowEnd: "2026-10-04T09:00:00.000Z", createdAt: NOW.toISOString() };
}
const empty: SuggestionStoreState = { version: 1, lastRunAt: null, retryAfter: null, suggestions: [], declined: [] };

beforeEach(() => window.localStorage.clear());

describe("suggestion store", () => {
  it("round-trips per owner and ignores corrupt or foreign data", () => {
    const state = recordSuggestionRun(empty, [stored("work:a")], [], NOW);
    writeSuggestionStore("local", state);
    expect(readSuggestionStore("local")).toEqual(state);
    expect(readSuggestionStore("someone-else")).toEqual(empty);
    window.localStorage.setItem(suggestionStoreKey("local"), "{broken");
    expect(readSuggestionStore("local")).toEqual(empty);
    window.localStorage.setItem(suggestionStoreKey("local"), JSON.stringify({ version: 2 }));
    expect(readSuggestionStore("local")).toEqual(empty);
  });

  it("drops malformed entries while keeping valid ones", () => {
    window.localStorage.setItem(suggestionStoreKey("local"), JSON.stringify({
      version: 1, lastRunAt: NOW.toISOString(), declined: ["work:x", 5],
      suggestions: [stored("work:ok"), { ...stored("work:bad"), kind: "other" }, { ...stored("work:neg"), minutes: -1 }, "text"],
    }));
    const state = readSuggestionStore("local");
    expect(state.suggestions.map((suggestion) => suggestion.id)).toEqual(["work:ok"]);
    expect(state.declined).toEqual(["work:x"]);
  });

  it("only waits after a failed run", () => {
    expect(shouldRunSuggestions(empty, NOW)).toBe(true);
    expect(shouldRunSuggestions({ ...empty, lastRunAt: NOW.toISOString() }, NOW)).toBe(true);
    expect(shouldRunSuggestions({ ...empty, retryAfter: "garbage" }, NOW)).toBe(true);
  });

  it("keeps pending items across runs, skips known sentences and declined places, and caps the list", () => {
    let state = recordSuggestionRun(empty, [stored("work:a")], [], NOW);
    state = declineSuggestion(state, "work:a");
    expect(state.suggestions).toEqual([]);
    state = recordSuggestionRun(state, [stored("work:a"), stored("work:b", "Already remembered sentence here."), stored("work:c")], ["already remembered sentence here"], NOW);
    expect(state.suggestions.map((suggestion) => suggestion.id)).toEqual(["work:c"]);
    const many = Array.from({ length: 12 }, (_, index) => stored("drift:" + index));
    expect(recordSuggestionRun(state, many, [], NOW).suggestions).toHaveLength(MAX_PENDING_SUGGESTIONS);
  });

  it("retries a run where every call failed in about an hour and keeps the unused activity counted", () => {
    const failed = recordFailedSuggestionRun({ ...empty, lastRunAt: "2026-10-01T00:00:00.000Z", suggestions: [stored("work:a")] }, NOW);
    expect(failed.suggestions).toHaveLength(1);
    expect(failed.lastRunAt).toBe("2026-10-01T00:00:00.000Z");
    expect(recordSuggestionRun(failed, [], [], NOW).retryAfter).toBeNull();
    expect(shouldRunSuggestions(failed, new Date(NOW.getTime() + SUGGESTION_RETRY_AFTER_FAILURE_MS - 1000))).toBe(false);
    expect(shouldRunSuggestions(failed, new Date(NOW.getTime() + SUGGESTION_RETRY_AFTER_FAILURE_MS))).toBe(true);
  });

  it("removes without declining and bounds the declined list", () => {
    const state = recordSuggestionRun(empty, [stored("work:a")], [], NOW);
    expect(removeSuggestion(state, "work:a").declined).toEqual([]);
    let declined = state;
    for (let index = 0; index < 70; index += 1) declined = declineSuggestion(declined, "work:" + index);
    expect(declined.declined).toHaveLength(64);
    expect(declined.declined[declined.declined.length - 1]).toBe("work:69");
  });

  it("keeps the largest record from each side as examples, only when titles are allowed", () => {
    const row = (title: string, filedAs: "focus" | "drift" | "neutral", minutes: number) => ({ title, filedAs, minutes, blocks: 1, days: 1, reason: "" });
    const evidence = [row("Product page", "focus", 27), row("Profile", "focus", 4), row("Launch dashboard", "focus", 3), row("Notifications", "drift", 11), row("Makers list", "drift", 1)];
    expect(pickSuggestionExamples(evidence)).toEqual([
      { title: "Product page", filedAs: "focus", minutes: 27 },
      { title: "Notifications", filedAs: "drift", minutes: 11 },
      { title: "Profile", filedAs: "focus", minutes: 4 },
    ]);
    const suggestion = { id: "ambiguous:Aside|p.com", kind: "ambiguous", summary: "Product pages are work; notifications are a distraction.",
      cluster: { app: "Aside", domain: "p.com", minutes: 46, days: 3, blocks: 5, evidence } } as unknown as Parameters<typeof toStoredSuggestion>[0];
    const window = { since: "2026-09-27T09:00:00.000Z", until: NOW.toISOString() };
    expect(toStoredSuggestion(suggestion, window, NOW.toISOString()).examples).toBeUndefined();
    const withTitles = toStoredSuggestion(suggestion, window, NOW.toISOString(), { includeTitles: true });
    writeSuggestionStore("local", recordSuggestionRun(empty, [withTitles], [], NOW));
    expect(readSuggestionStore("local").suggestions[0].examples).toHaveLength(3);
  });
});
