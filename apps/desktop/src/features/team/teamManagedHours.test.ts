import { describe, expect, it } from "vitest";

import { activeTeamPauseLock, isWithinTeamRecordingHours, teamPauseLockSpans, type TeamManagedHoursSource } from "./teamManagedHours";

const weekdays = { days: [1, 2, 3, 4, 5], start_minute: 9 * 60, end_minute: 18 * 60 };
const seoul: TeamManagedHoursSource = { teamName: "Sales", policy: "managed", seat: "member", schedule: { ...weekdays, timezone: "Asia/Seoul" } };
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

describe("isWithinTeamRecordingHours", () => {
  it("uses the team's weekday as well as its time across a UTC date boundary", () => {
    const schedule = { days: [1], start_minute: 6 * 60 + 16, end_minute: 6 * 60 + 46, timezone: "Asia/Seoul" };
    expect(isWithinTeamRecordingHours(schedule, Date.parse("2026-10-25T21:15:59Z"))).toBe(false);
    expect(isWithinTeamRecordingHours(schedule, Date.parse("2026-10-25T21:16:00Z"))).toBe(true);
    expect(isWithinTeamRecordingHours(schedule, Date.parse("2026-10-25T21:46:00Z"))).toBe(false);
    expect(isWithinTeamRecordingHours(schedule, Date.parse("2026-10-26T21:20:00Z"))).toBe(false);
  });

  it("agrees with the native spans through daylight saving and local-clock schedules", () => {
    for (const timezone of ["America/New_York", "local"]) {
      const schedule = { ...weekdays, timezone };
      for (const date of ["2026-10-30T13:00:00Z", "2026-11-02T13:59:00Z", "2026-11-02T14:00:00Z", "2026-11-02T23:00:00Z"]) {
        const now = Date.parse(date);
        expect(isWithinTeamRecordingHours(schedule, now)).toBe(Boolean(activeTeamPauseLock(teamPauseLockSpans([{ ...seoul, schedule }], now), now)));
      }
    }
  });
});

describe("teamPauseLockSpans", () => {
  it("holds a member of a managed team inside its hours, on the team's clock", () => {
    const now = Date.parse("2026-10-26T01:00:00Z"); // Monday 10:00 in Seoul
    const spans = teamPauseLockSpans([seoul], now, 7);
    expect(iso(spans[0]!.startsAt)).toBe("2026-10-26T00:00:00.000Z");
    expect(iso(spans[0]!.endsAt)).toBe("2026-10-26T09:00:00.000Z");
    expect(spans).toHaveLength(6); // this week's five days and next Monday
    expect(activeTeamPauseLock(spans, now)?.teamName).toBe("Sales");
    expect(activeTeamPauseLock(spans, Date.parse("2026-10-26T09:00:00Z"))).toBeNull();
    expect(activeTeamPauseLock(spans, Date.parse("2026-10-31T03:00:00Z"))).toBeNull(); // Saturday noon
  });

  it("leaves leaders, free teams and teams without hours alone", () => {
    const now = Date.parse("2026-10-26T01:00:00Z");
    expect(teamPauseLockSpans([{ ...seoul, seat: "manager" }, { ...seoul, seat: "admin" }, { ...seoul, policy: "free" }, { ...seoul, schedule: null }], now)).toEqual([]);
  });

  it("follows daylight saving in the team's time zone", () => {
    const newYork: TeamManagedHoursSource = { ...seoul, teamName: "NY", schedule: { ...weekdays, timezone: "America/New_York" } };
    const spans = teamPauseLockSpans([newYork], Date.parse("2026-10-29T12:00:00Z"), 7);
    const starts = spans.map((span) => iso(span.startsAt));
    expect(starts).toContain("2026-10-30T13:00:00.000Z"); // Friday 09:00 EDT
    expect(starts).toContain("2026-11-02T14:00:00.000Z"); // Monday 09:00 EST
  });

  it("keeps a span already under way and drops ones that ended", () => {
    const spans = teamPauseLockSpans([seoul], Date.parse("2026-10-26T08:59:00Z"), 1);
    expect(iso(spans[0]!.startsAt)).toBe("2026-10-26T00:00:00.000Z");
    expect(teamPauseLockSpans([seoul], Date.parse("2026-10-26T09:00:00Z"), 0)).toEqual([]);
  });
});

