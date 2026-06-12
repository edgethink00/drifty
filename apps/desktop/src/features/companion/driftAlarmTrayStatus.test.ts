import { describe, expect, it } from "vitest";
import {
  buildDriftAlarmTrayCandidateDetail,
  buildDriftAlarmTrayStatus,
  formatDriftAlarmTrayCheckTime,
} from "./driftAlarmTrayStatus";

describe("drift alarm tray status", () => {
  it("marks disabled alerts without a live check timestamp", () => {
    const status = buildDriftAlarmTrayStatus({
      enabled: false,
      checkedAt: null,
      result: { kind: "disabled" },
    });

    expect(status).toEqual({
      enabled: false,
      lastCheckedAt: null,
      lastCheckedLabel: "Off",
      resultLabel: "Alerts disabled",
      detailLabel: null,
    });
  });

  it("keeps suppressed reasons and candidate details privacy safe", () => {
    const checkedAt = new Date(2026, 5, 12, 9, 8, 7);
    const status = buildDriftAlarmTrayStatus({
      enabled: true,
      checkedAt,
      result: {
        kind: "suppressed",
        reason: "ai-low-confidence",
        candidateDetail: buildDriftAlarmTrayCandidateDetail("youtube.com", 90),
      },
    });

    expect(status).toEqual({
      enabled: true,
      lastCheckedAt: checkedAt.toISOString(),
      lastCheckedLabel: formatDriftAlarmTrayCheckTime(checkedAt),
      resultLabel: "Suppressed: AI low confidence",
      detailLabel: "youtube.com - 2m",
    });
  });
});
