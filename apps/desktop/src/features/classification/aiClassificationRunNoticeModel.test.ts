import { describe, expect, it } from "vitest";
import { translateFor } from "../localization/translate";
import { NO_UNCLASSIFIED_SEGMENTS_MESSAGE, PROVIDER_PERSISTENCE_DEFERRED_MESSAGE } from "./aiClassificationService";
import { buildAiClassificationRunNotice } from "./aiClassificationRunNoticeModel";
import { LOCAL_AI_SINGLE_ITEM_CONTEXT_BUDGET_MESSAGE } from "./localAiClassificationFailure";

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

  it("translates the over-budget failure that tells the user what to change", () => {
    const outcome = { status: "error", selectedSegments: 1, savedRecords: 0, message: LOCAL_AI_SINGLE_ITEM_CONTEXT_BUDGET_MESSAGE } as const;
    expect(buildAiClassificationRunNotice(outcome, 8, "ko", ko)).toEqual({
      key: 8,
      role: "alert",
      title: "AI 분류 실패",
      detail: "카테고리 설명을 줄였지만 이 활동은 여전히 온디바이스 AI가 처리할 수 있는 길이를 넘습니다. 사용자 카테고리를 일부 지우거나 설명을 줄이거나, 개인정보 및 데이터에서 선택 AI 데이터 공유를 끈 뒤 다시 시도하세요.",
    });
    expect(buildAiClassificationRunNotice(outcome, 9, "en", en)?.detail).toMatch(/^Drifty shortened your category descriptions/);
  });

  it("explains a dropped command and a missing provider", () => {
    expect(buildAiClassificationRunNotice({ status: "busy" }, 5, "en", en)).toEqual({ key: 5, role: "status", title: "AI classification is already running", detail: "Try again after the current run finishes." });
    expect(buildAiClassificationRunNotice({ status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Configure or reconnect the selected AI provider to run classification." }, 6, "en", en)?.title).toBe("AI classification needs setup");
    expect(buildAiClassificationRunNotice({ status: "running", selectedSegments: 0, savedRecords: 0, message: "Running AI classification..." }, 7, "en", en)).toBeNull();
  });
});
