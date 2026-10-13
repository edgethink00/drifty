// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  SUPPORT_JOURNAL_MAX_ENTRIES,
  SUPPORT_JOURNAL_RETENTION_MS,
  SUPPORT_JOURNAL_STORAGE_KEY,
  readSupportJournal,
  recordSupportJournalEvent,
} from "./supportJournal";

const NOW = new Date("2026-10-13T12:00:00.000Z");

describe("support journal", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps outcome events and skips navigation and funnel events", () => {
    recordSupportJournalEvent("tracker_action", { action: "start", result: "error", error_kind: "tracker_unavailable" }, window.localStorage, NOW);
    recordSupportJournalEvent("app_surface_opened", { surface: "dashboard" }, window.localStorage, NOW);
    recordSupportJournalEvent("pro_funnel_step", { step: "pro_offer_viewed" }, window.localStorage, NOW);

    expect(readSupportJournal(window.localStorage, NOW.getTime())).toEqual([
      {
        event: "tracker_action",
        properties: { action: "start", result: "error", error_kind: "tracker_unavailable" },
        count: 1,
        firstAt: NOW.toISOString(),
        lastAt: NOW.toISOString(),
      },
    ]);
  });

  it("folds repeats into one entry so routine successes cannot evict an older failure", () => {
    const failure = { trigger: "background_threshold", provider_kind: "cloud", result: "error", ai_issue_kind: "rate_limited" } as const;
    const success = { trigger: "background_threshold", provider_kind: "cloud", result: "success" } as const;
    recordSupportJournalEvent("ai_classification_run", failure, window.localStorage, NOW);
    for (let index = 0; index < SUPPORT_JOURNAL_MAX_ENTRIES * 2; index += 1) {
      recordSupportJournalEvent("ai_classification_run", success, window.localStorage, new Date(NOW.getTime() + (index + 1) * 60_000));
    }

    const entries = readSupportJournal(window.localStorage, NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ properties: failure, count: 1 });
    expect(entries[1]).toMatchObject({ properties: success, count: SUPPORT_JOURNAL_MAX_ENTRIES * 2, firstAt: "2026-10-13T12:01:00.000Z" });
  });

  it("caps distinct entries and forgets entries past the retention window", () => {
    for (let index = 0; index < SUPPORT_JOURNAL_MAX_ENTRIES + 10; index += 1) {
      recordSupportJournalEvent("app_update", { update_step: "prepare_failed", update_source: index % 2 ? "manual" : "automatic", background_updates_enabled: index % 3 === 0, background_eligible: index % 5 === 0, error_kind: String(index) }, window.localStorage, NOW);
    }
    expect(JSON.parse(window.localStorage.getItem(SUPPORT_JOURNAL_STORAGE_KEY) ?? "[]")).toHaveLength(SUPPORT_JOURNAL_MAX_ENTRIES);
    expect(readSupportJournal(window.localStorage, NOW.getTime() + SUPPORT_JOURNAL_RETENTION_MS + 1)).toEqual([]);
  });

  it("ignores malformed stored entries and storage failures", () => {
    window.localStorage.setItem(SUPPORT_JOURNAL_STORAGE_KEY, JSON.stringify([
      { event: "tracker_action", properties: { action: { nested: true } }, count: 1, firstAt: NOW.toISOString(), lastAt: NOW.toISOString() },
      { event: "not_an_event", properties: {}, count: 1, firstAt: NOW.toISOString(), lastAt: NOW.toISOString() },
      "garbage",
    ]));
    expect(readSupportJournal(window.localStorage, NOW.getTime())).toEqual([]);

    const throwingStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("full"); },
    } as unknown as Storage;
    expect(() => recordSupportJournalEvent("app_opened", {}, throwingStorage, NOW)).not.toThrow();
    expect(readSupportJournal(throwingStorage, NOW.getTime())).toEqual([]);
  });
});
