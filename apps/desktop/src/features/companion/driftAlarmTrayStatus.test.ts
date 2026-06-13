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
      statusLabel: "Drift alerts: Off",
      lastCheckedAt: null,
      lastCheckedLabel: "Off",
      resultLabel: "Alerts disabled",
      detailLabel: null,
    });
  });

  it("reports monitoring instead of a generic on state while alerts are enabled", () => {
    const status = buildDriftAlarmTrayStatus({
      enabled: true,
      checkedAt: new Date(2026, 5, 12, 9, 8, 7),
      result: { kind: "no_candidate" },
    });

    expect(status.statusLabel).toBe("Drift alerts: Monitoring");
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
      statusLabel: "Drift alerts: Suppressed",
      lastCheckedAt: checkedAt.toISOString(),
      lastCheckedLabel: formatDriftAlarmTrayCheckTime(checkedAt),
      resultLabel: "Suppressed: AI low confidence",
      detailLabel: "youtube.com - 2m",
    });
  });

  it("shows AI unavailable as the top tray status when the AI gate suppresses an alarm", () => {
    const status = buildDriftAlarmTrayStatus({
      enabled: true,
      checkedAt: new Date(2026, 5, 12, 9, 8, 7),
      result: {
        kind: "suppressed",
        reason: "ai-unavailable:Local AI classification failed with HTTP 503.",
        candidateDetail: buildDriftAlarmTrayCandidateDetail("youtube.com", 90),
      },
    });

    expect(status.statusLabel).toBe("Drift alerts: AI unavailable");
    expect(status.resultLabel).toBe("Suppressed: AI unavailable");
  });
});
