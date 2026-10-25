import { describe, expect, it } from "vitest";

import { activeTeamPauseLock, teamPauseLockSpans, type TeamManagedHoursSource } from "./teamManagedHours";

const weekdays = { days: [1, 2, 3, 4, 5], start_minute: 9 * 60, end_minute: 18 * 60 };
const seoul: TeamManagedHoursSource = { teamName: "Sales", policy: "managed", seat: "member", schedule: { ...weekdays, timezone: "Asia/Seoul" } };
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

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

