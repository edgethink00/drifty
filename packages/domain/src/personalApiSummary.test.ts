import { describe, expect, it } from "vitest";
import {
  canonicalPersonalApiTimeZone,
  isPersonalApiDate,
  isPersonalApiTimeZone,
  personalApiDateInZone,
  personalApiDayBounds,
  summarizePersonalApiDays,
  type PersonalApiRecord,
} from "./personalApiSummary";

function record(id: string, startedAt: string, minutes: number, overrides: Partial<PersonalApiRecord> = {}): PersonalApiRecord {
  const start = Date.parse(startedAt);
  return {
    id,
    deviceId: "mac",
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
    appName: "Code",
    category: "workspace",
    productivity: "focus",
    platform: "macos",
    source: "accessibility",
    ...overrides,
  };
}

describe("personal API days", () => {
  it("runs a day from local midnight to local midnight", () => {
    expect(personalApiDayBounds("2026-10-26", "Asia/Seoul")).toEqual({
      start: Date.parse("2026-10-25T15:00:00Z"),
      end: Date.parse("2026-10-26T15:00:00Z"),
    });
    // New York leaves daylight time on 1 November 2026: that day has 25 hours.
    const fallBack = personalApiDayBounds("2026-11-01", "America/New_York");
    expect(new Date(fallBack.start).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(new Date(fallBack.end).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(personalApiDateInZone(Date.parse("2026-10-25T15:30:00Z"), "Asia/Seoul")).toBe("2026-10-26");
  });

  it("starts a day whose midnight a DST change skips at that change", () => {
    // Santiago moves 00:00 -04 to 01:00 -03 on 6 September 2026.
    const santiago = personalApiDayBounds("2026-09-06", "America/Santiago");
    expect(new Date(santiago.start).toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(new Date(santiago.end).toISOString()).toBe("2026-09-07T03:00:00.000Z");
    expect(personalApiDayBounds("2026-09-05", "America/Santiago").end).toBe(santiago.start);
  });

  it("accepts only real dates and time zones", () => {
    expect(isPersonalApiDate("2026-02-29")).toBe(false);
    expect(isPersonalApiDate("2028-02-29")).toBe(true);
    expect(isPersonalApiDate("2026-1-5")).toBe(false);
    expect(isPersonalApiDate("1999-12-31")).toBe(false);
    expect(isPersonalApiDate("9999-12-31")).toBe(false);
    expect(canonicalPersonalApiTimeZone("asia/seoul")).toBe("Asia/Seoul");
    expect(isPersonalApiTimeZone("Europe/Berlin")).toBe(true);
    expect(isPersonalApiTimeZone("Mars/Olympus")).toBe(false);
    expect(isPersonalApiTimeZone("")).toBe(false);
  });

  it("splits time that crosses local midnight between the two days", () => {
    const records = [record("late", "2026-10-26T14:30:00Z", 60)];
    const [first, second] = summarizePersonalApiDays(records, { dates: ["2026-10-26", "2026-10-27"], timeZone: "Asia/Seoul" });
    expect(first.focusSeconds).toBe(1800);
    expect(second.focusSeconds).toBe(1800);
    expect(first.lastActivityAt).toBe("2026-10-26T15:00:00.000Z");
  });

  it("counts simultaneous time on two computers once, as the app does", () => {
    const records = [
      record("mac", "2026-10-26T01:00:00Z", 60),
      record("pc", "2026-10-26T01:00:00Z", 60, { deviceId: "pc", platform: "windows", appName: "Slack", category: "communication", productivity: "neutral" }),
    ];
    const [day] = summarizePersonalApiDays(records, { dates: ["2026-10-26"], timeZone: "UTC" });
    expect(day.trackedSeconds).toBe(3600);
    expect(day.focusSeconds + day.neutralSeconds).toBe(3600);
    expect(day.devices).toBe(2);
  });

  it("leaves excluded and failed Windows captures out, as the app does", () => {
    const records = [
      record("work", "2026-10-26T01:00:00Z", 30),
      record("failed", "2026-10-26T02:00:00Z", 60, { appName: "Unavailable", bundleId: null, platform: "windows", source: "unknown", category: null, productivity: null }),
      record("hidden", "2026-10-26T03:00:00Z", 60, { appName: "[Redacted]" }),
    ];
    const [day] = summarizePersonalApiDays(records, { dates: ["2026-10-26"], timeZone: "UTC" });
    expect(day.trackedSeconds).toBe(1800);
    expect(day.apps).toEqual([{ name: "Code", seconds: 1800 }]);
  });

  it("keeps a first point sample's recorded seconds", () => {
    const point = { ...record("point", "2026-10-26T09:00:00Z", 0), durationSeconds: 5 };
    const [day] = summarizePersonalApiDays([point], { dates: ["2026-10-26"], timeZone: "UTC" });
    expect(day.focusSeconds).toBe(5);
  });

  it("names user categories custom and unlabelled time unclassified", () => {
    const records = [
      record("custom", "2026-10-26T01:00:00Z", 30, { category: "custom:reading", productivity: "focus" }),
      record("bare", "2026-10-26T02:00:00Z", 10, { category: null, productivity: null }),
    ];
    const [day] = summarizePersonalApiDays(records, { dates: ["2026-10-26"], timeZone: "UTC" });
    expect(day.categories).toEqual([{ category: "custom", seconds: 1800 }, { category: "unknown", seconds: 600 }]);
    expect(day.unclassifiedSeconds).toBe(600);
    expect(day.focusShare).toBe(0.75);
  });

  it("ranks apps and sites by time and keeps only the top ones", () => {
    const records = [
      record("a", "2026-10-26T01:00:00Z", 30, { appName: "Safari", siteDomain: "github.com" }),
      record("b", "2026-10-26T02:00:00Z", 20, { appName: "Safari", siteDomain: "youtube.com", productivity: "drift" }),
      record("c", "2026-10-26T03:00:00Z", 40, { appName: "Code" }),
      record("d", "2026-10-26T04:00:00Z", 5, { appName: "Notes" }),
    ];
    const [day] = summarizePersonalApiDays(records, { dates: ["2026-10-26"], timeZone: "UTC", topLimit: 2 });
    expect(day.apps).toEqual([{ name: "Safari", seconds: 3000 }, { name: "Code", seconds: 2400 }]);
    expect(day.sites).toEqual([{ domain: "github.com", seconds: 1800 }, { domain: "youtube.com", seconds: 1200 }]);
    expect(day.driftSeconds).toBe(1200);
  });

  it("reports an empty day as zeros without a share", () => {
    const [day] = summarizePersonalApiDays([], { dates: ["2026-10-26"], timeZone: "UTC" });
    expect(day).toMatchObject({ trackedSeconds: 0, focusShare: null, devices: 0, lastActivityAt: null, apps: [] });
  });
});
