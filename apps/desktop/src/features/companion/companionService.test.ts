import { describe, expect, it } from "vitest";

import { parseCompanionSummaryCode } from "./companionService";

const SUMMARY_BODY = "iphone-1|Alex iPhone|ABCD-2345|45|3|active|2026-05-25T12:00:00.000Z";

describe("parseCompanionSummaryCode", () => {
  it("accepts the Drifty iOS summary prefix", () => {
    const summary = parseCompanionSummaryCode(`DRIFTY-IOS-V1|${SUMMARY_BODY}`);

    expect(summary).toMatchObject({
      deviceId: "iphone-1",
      deviceName: "Alex iPhone",
      pairingCode: "ABCD-2345",
      focusMinutesToday: 45,
      sessionsCompletedToday: 3,
      currentFocusMode: "active",
      lastFocusAt: "2026-05-25T12:00:00.000Z",
    });
  });

  it("keeps legacy dTime iOS summary codes compatible", () => {
    const summary = parseCompanionSummaryCode(`DTIME-IOS-V1|${SUMMARY_BODY}`);

    expect(summary?.pairingCode).toBe("ABCD-2345");
  });

  it("rejects unknown summary prefixes", () => {
    expect(parseCompanionSummaryCode(`UNKNOWN-IOS-V1|${SUMMARY_BODY}`)).toBeNull();
  });
});
