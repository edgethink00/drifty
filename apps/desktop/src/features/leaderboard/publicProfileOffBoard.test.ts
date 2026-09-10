import { describe, expect, it } from "vitest";

import { isPublicProfileLiveOffBoard } from "./publicProfileOffBoard";

const resolved = { isParticipationResolved: true, isProfileReady: true };

describe("isPublicProfileLiveOffBoard", () => {
  it("reports a live page for a public profile that is not on the board", () => {
    expect(isPublicProfileLiveOffBoard({ ...resolved, isOptedIn: false, isPublic: true })).toBe(true);
  });

  it("stays quiet for participants, who published on purpose", () => {
    expect(isPublicProfileLiveOffBoard({ ...resolved, isOptedIn: true, isPublic: true })).toBe(false);
  });

  it("stays quiet once the profile is private", () => {
    expect(isPublicProfileLiveOffBoard({ ...resolved, isOptedIn: false, isPublic: false })).toBe(false);
  });

  it("treats an unknown visibility as nothing to report", () => {
    expect(isPublicProfileLiveOffBoard({ ...resolved, isOptedIn: false, isPublic: null })).toBe(false);
    expect(isPublicProfileLiveOffBoard({ ...resolved, isOptedIn: false, isPublic: undefined })).toBe(false);
  });

  it("waits for participation and profile state instead of guessing during restore", () => {
    expect(isPublicProfileLiveOffBoard({ isParticipationResolved: false, isProfileReady: true, isOptedIn: false, isPublic: true })).toBe(false);
    expect(isPublicProfileLiveOffBoard({ isParticipationResolved: true, isProfileReady: false, isOptedIn: false, isPublic: true })).toBe(false);
  });
});
