// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { isTeamExclusionOffered, isTeamRangeExcluded, readTeamExcludedRanges, recordTeamExclusionAllowed, setTeamBlocksExcluded, subtractTeamExcludedRanges } from "./teamBlockExclusions";

const HOUR = 3_600_000;
afterEach(() => window.localStorage.clear());

describe("blocks kept from the team", () => {
  it("cuts kept blocks out of the team's hours", () => {
    const hours = [{ start: 9 * HOUR, end: 18 * HOUR }];
    expect(subtractTeamExcludedRanges(hours, [{ start: 10 * HOUR, end: 11 * HOUR }, { start: 17 * HOUR, end: 19 * HOUR }])).toEqual([
      { start: 9 * HOUR, end: 10 * HOUR },
      { start: 11 * HOUR, end: 17 * HOUR },
    ]);
    expect(subtractTeamExcludedRanges(hours, [{ start: 8 * HOUR, end: 20 * HOUR }])).toEqual([]);
  });

  it("remembers a choice on this computer and takes it back", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    const block = { start: now - 2 * HOUR, end: now - HOUR };
    setTeamBlocksExcluded([block], true, now);
    expect(readTeamExcludedRanges()).toEqual([block]);
    expect(isTeamRangeExcluded(readTeamExcludedRanges(), block.start, block.end)).toBe(true);
    // A block that grew past the choice still counts as kept while the choice covers half of it.
    expect(isTeamRangeExcluded(readTeamExcludedRanges(), block.start, block.end + HOUR / 2)).toBe(true);
    expect(isTeamRangeExcluded(readTeamExcludedRanges(), block.start, block.end + 2 * HOUR)).toBe(false);
    setTeamBlocksExcluded([block], false, now);
    expect(readTeamExcludedRanges()).toEqual([]);
  });

  it("is offered while one of the person's teams allows it, or before any team was read", () => {
    expect(isTeamExclusionOffered("u1")).toBe(true);
    recordTeamExclusionAllowed("u1", { a: false, b: true });
    expect(isTeamExclusionOffered("u1")).toBe(true);
    recordTeamExclusionAllowed("u1", { a: false, b: false });
    expect(isTeamExclusionOffered("u1")).toBe(false);
    expect(isTeamExclusionOffered("u2")).toBe(true);
  });

  it("drops choices older than automatic sharing reaches", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    setTeamBlocksExcluded([{ start: now - 90 * 24 * HOUR, end: now - 90 * 24 * HOUR + HOUR }], true, now);
    expect(readTeamExcludedRanges()).toEqual([]);
  });
});
