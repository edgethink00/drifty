import { describe, expect, it } from "vitest";

import {
  parseTeamInviteDeepLink,
  readPendingTeamInviteFromEvent,
} from "./teamInviteDeepLinks";

describe("team invite desktop deep links", () => {
  it("normalizes drifty team invite links into service-safe drifty.so invite keys", () => {
    expect(parseTeamInviteDeepLink("drifty://team-invite?token=abcdefghijklmnopqrstuvwxyzABCDEFG_1234567890&code=drftabcd2345")).toEqual({
      inviteKey: "https://drifty.so/team-invite?token=abcdefghijklmnopqrstuvwxyzABCDEFG_1234567890&code=DRFT-ABCD-2345",
      inviteCode: "DRFT-ABCD-2345",
    });

    expect(parseTeamInviteDeepLink("drifty://team-invite?code=DRFT-ABCD-2345")).toEqual({
      inviteKey: "https://drifty.so/team-invite?code=DRFT-ABCD-2345",
      inviteCode: "DRFT-ABCD-2345",
    });
  });

  it("rejects malformed or non-team desktop links", () => {
    const rejectedLinks = [
      "https://drifty.so/team-invite?token=abcdefghijklmnopqrstuvwxyzABCDEFG_1234567890&code=DRFT-ABCD-2345",
      "drifty://team-invite.evil.example?code=DRFT-ABCD-2345",
      "drifty://auth/callback?code=DRFT-ABCD-2345",
      "drifty://team-invite?token=short&code=DRFT-ABCD-2345",
      "drifty://team-invite?token=abcdefghijklmnopqrstuvwxyzABCDEFG_1234567890&code=BAD",
      "drifty://team-invite",
    ] as const;

    for (const link of rejectedLinks) {
      expect(parseTeamInviteDeepLink(link)).toBeNull();
    }
  });

  it("narrows pending team invite events without trusting arbitrary event detail", () => {
    const event = new CustomEvent("drifty:team-invite", {
      detail: {
        inviteKey: "https://drifty.so/team-invite?code=DRFT-ABCD-2345",
        inviteCode: "DRFT-ABCD-2345",
      },
    });
    const malformed = new CustomEvent("drifty:team-invite", {
      detail: {
        inviteKey: "drifty://team-invite?code=DRFT-ABCD-2345",
        inviteCode: "DRFT-ABCD-2345",
      },
    });

    expect(readPendingTeamInviteFromEvent(event)).toEqual({
      inviteKey: "https://drifty.so/team-invite?code=DRFT-ABCD-2345",
      inviteCode: "DRFT-ABCD-2345",
    });
    expect(readPendingTeamInviteFromEvent(malformed)).toBeNull();
    expect(readPendingTeamInviteFromEvent(new Event("drifty:team-invite"))).toBeNull();
  });
});
