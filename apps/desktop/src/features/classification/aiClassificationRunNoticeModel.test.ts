import { describe, expect, it } from "vitest";
import { translateFor } from "../localization/translate";
import { NO_UNCLASSIFIED_SEGMENTS_MESSAGE, PROVIDER_PERSISTENCE_DEFERRED_MESSAGE } from "./aiClassificationService";
import { buildAiClassificationRunNotice } from "./aiClassificationRunNoticeModel";

const en = translateFor("en");
const ko = translateFor("ko");

describe("manual AI classification run notice", () => {
  it("reports how many activities a run classified, in the display language", () => {
    expect(buildAiClassificationRunNotice({ status: "saved", selectedSegments: 1200, savedRecords: 1200, message: "Saved 1200 AI classifications." }, 1, "en", en))
      .toEqual({ key: 1, role: "status", title: "AI classification finished", detail: "Classified 1,200 activities." });
    expect(buildAiClassificationRunNotice({ status: "saved", selectedSegments: 1, savedRecords: 1, message: "Saved 1 local classification." }, 2, "en", en)?.detail).toBe("Classified 1 activity.");
    expect(buildAiClassificationRunNotice({ status: "saved", selectedSegments: 3, savedRecords: 3, message: "Saved 3 AI classifications." }, 3, "ko", ko))
      .toEqual({ key: 3, role: "status", title: "AI 분류 완료", detail: "활동 3개를 분류했습니다." });
  });

  it("separates an empty run from a run waiting for its provider", () => {
    expect(buildAiClassificationRunNotice({ status: "empty", selectedSegments: 0, savedRecords: 0, message: NO_UNCLASSIFIED_SEGMENTS_MESSAGE }, 1, "en", en)?.detail).toBe("There was no unclassified activity to classify.");
    expect(buildAiClassificationRunNotice({ status: "empty", selectedSegments: 0, savedRecords: 0, message: PROVIDER_PERSISTENCE_DEFERRED_MESSAGE }, 1, "en", en)?.detail).toBe("Waiting for the selected AI provider to become available.");
  });

  it("announces failures as alerts and keeps the technical cause", () => {
    expect(buildAiClassificationRunNotice({ status: "error", selectedSegments: 0, savedRecords: 0, message: "Local AI classification failed with HTTP 503." }, 4, "ko", ko))
      .toEqual({ key: 4, role: "alert", title: "AI 분류 실패", detail: "Local AI classification failed with HTTP 503." });
  });

  it("explains a dropped command and a missing provider", () => {
    expect(buildAiClassificationRunNotice({ status: "busy" }, 5, "en", en)).toEqual({ key: 5, role: "status", title: "AI classification is already running", detail: "Try again after the current run finishes." });
    expect(buildAiClassificationRunNotice({ status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Configure or reconnect the selected AI provider to run classification." }, 6, "en", en)?.title).toBe("AI classification needs setup");
    expect(buildAiClassificationRunNotice({ status: "running", selectedSegments: 0, savedRecords: 0, message: "Running AI classification..." }, 7, "en", en)).toBeNull();
  });
});
