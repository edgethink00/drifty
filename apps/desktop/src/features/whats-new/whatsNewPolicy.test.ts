import { describe, expect, it } from "vitest";
import {
  WHATS_NEW_AUTO_OPEN_INTERVAL_MS,
  WHATS_NEW_LAST_SEEN_STORAGE_KEY,
  entriesForBuild,
  markWhatsNewSeen,
  newestShownVersion,
  readWhatsNewLastSeenVersion,
  resolveWhatsNewLaunch,
} from "./whatsNewPolicy";
import type { WhatsNewEntry } from "./whatsNewChangelog";

const NOW = Date.parse("2026-10-13T00:00:00Z");
const LONG_AGO = "2026-01-01T00:00:00Z";
const JUST_NOW = "2026-10-12T23:00:00Z";

function entry(fromVersion: string, options: { toVersion?: string; platforms?: WhatsNewEntry["platforms"]; date?: string } = {}): WhatsNewEntry {
  const toVersion = options.toVersion ?? fromVersion;
  return {
    id: "v" + fromVersion,
    date: options.date ?? "2026-10-01",
    label: "v" + fromVersion,
    platforms: options.platforms ?? ["macos", "windows"],
    fromVersion,
    toVersion,
    summary: "Summary.",
    items: ["Item."],
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const entries = [entry("1.13.0"), entry("1.12.6"), entry("1.12.1", { toVersion: "1.12.5" })];
const launch = (lastSeenVersion: string | null, onboardingCompletedAt: string | null, options: { currentVersion?: string; lastAutoOpenAt?: string | null; list?: readonly WhatsNewEntry[] | null } = {}) =>
  resolveWhatsNewLaunch({
    entries: options.list === undefined ? entries : options.list,
    currentVersion: options.currentVersion ?? "1.13.0",
    lastSeenVersion,
    lastAutoOpenAt: options.lastAutoOpenAt ?? null,
    onboardingCompletedAt,
    nowMs: NOW,
  });

describe("What's new launch policy", () => {
  it("records a new install silently, even before the changelog loads", () => {
    expect(launch(null, null, { list: null })).toEqual({ unseen: [], autoOpen: false, recordSilently: true });
    expect(launch(null, JUST_NOW)).toEqual({ unseen: [], autoOpen: false, recordSilently: true });
  });

  it("judges an install without a record only by the running version's chapter", () => {
    const decision = launch(null, LONG_AGO);
    expect(decision.unseen.map((item) => item.toVersion)).toEqual(["1.13.0"]);
    expect(decision.autoOpen).toBe(true);
  });

  it("collects every chapter newer than the recorded version", () => {
    expect(launch("1.12.4", LONG_AGO).unseen.map((item) => item.toVersion)).toEqual(["1.13.0", "1.12.6", "1.12.5"]);
    expect(launch("1.13.0", LONG_AGO).unseen).toEqual([]);
  });

  it("opens by itself at most once a week and waits for the changelog", () => {
    const recent = new Date(NOW - WHATS_NEW_AUTO_OPEN_INTERVAL_MS + 60_000).toISOString();
    const old = new Date(NOW - WHATS_NEW_AUTO_OPEN_INTERVAL_MS).toISOString();
    expect(launch("1.12.4", LONG_AGO, { lastAutoOpenAt: recent })).toMatchObject({ autoOpen: false });
    expect(launch("1.12.4", LONG_AGO, { lastAutoOpenAt: recent }).unseen).toHaveLength(3);
    expect(launch("1.12.4", LONG_AGO, { lastAutoOpenAt: old }).autoOpen).toBe(true);
    expect(launch("1.12.4", LONG_AGO, { list: null })).toEqual({ unseen: [], autoOpen: false, recordSilently: false });
  });

  it("shows nothing for an unparseable build", () => {
    expect(launch("1.12.4", LONG_AGO, { currentVersion: "unknown" })).toEqual({ unseen: [], autoOpen: false, recordSilently: false });
  });
});

describe("changelog chapters for this build", () => {
  it("keeps this platform's chapters the build contains, newest first", () => {
    const list = [
      entry("1.11.17", { toVersion: "1.11.21" }),
      entry("1.13.1"),
      entry("1.13.0", { platforms: ["windows"] }),
      entry("1.12.9", { platforms: ["macos"] }),
    ];
    expect(entriesForBuild(list, "macos", "1.13.0").map((item) => item.label)).toEqual(["v1.12.9", "v1.11.17"]);
    expect(entriesForBuild(list, null, "1.13.0")).toEqual([]);
  });

  it("marks seen only up to the newest version actually shown", () => {
    expect(newestShownVersion([entry("1.12.6"), entry("1.12.1", { toVersion: "1.12.5" })], "1.13.0")).toBe("1.12.6");
    expect(newestShownVersion([entry("1.12.9", { toVersion: "1.13.2" })], "1.13.0")).toBe("1.13.0");
    expect(newestShownVersion([], "1.13.0")).toBeNull();
  });

  it("never moves the seen record backwards and ignores non-release versions", () => {
    const storage = memoryStorage({ [WHATS_NEW_LAST_SEEN_STORAGE_KEY]: "1.13.0" });
    markWhatsNewSeen("1.12.9", storage);
    markWhatsNewSeen("1.13.0-rc.1", storage);
    expect(readWhatsNewLastSeenVersion(storage)).toBe("1.13.0");
    markWhatsNewSeen("1.13.1", storage);
    expect(readWhatsNewLastSeenVersion(storage)).toBe("1.13.1");
  });
});
