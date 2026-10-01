import { describe, expect, it } from "vitest";
import { keepGuidePhrasesTogether } from "./guideLineBreaks";

const NBSP = "\u00a0";

describe("keepGuidePhrasesTogether", () => {
  it("keeps Korean dependent-noun phrases and quoted labels whole", () => {
    expect(keepGuidePhrasesTogether("눌러서 기록을 잠시 멈추거나 대시보드를 다시 열 수 있어요.", "ko")).toContain("열" + NBSP + "수" + NBSP + "있어요.");
    expect(keepGuidePhrasesTogether("‘이번 주’에서는 여러 날을 비교할 수 있어요.", "ko")).toContain("‘이번" + NBSP + "주’");
    expect(keepGuidePhrasesTogether("앱과 웹사이트에 쓴 시간이 보여요.", "ko")).toContain("쓴" + NBSP + "시간이");
    expect(keepGuidePhrasesTogether("메뉴 막대의 작은 링으로 여러 날을 봐요.", "ko")).toContain("작은" + NBSP + "링으로 여러" + NBSP + "날을");
    expect(keepGuidePhrasesTogether("기록이 쌓이면 보여요.", "ko")).toContain("기록이 쌓이면");
    expect(keepGuidePhrasesTogether("비율을 보여줘요. 눌러서 기록을 잠시 멈춰요.", "ko")).toContain("눌러서" + NBSP + "기록을");
    // A tail that is already a kept phrase stays breakable from the word before it.
    expect(keepGuidePhrasesTogether("‘이번 주’에서는 여러 날을 비교할 수 있어요.", "ko")).toContain("날을 비교할");
  });

  it("keeps English UI names and the final pair of words together", () => {
    const out = keepGuidePhrasesTogether("Switch to Your Week to compare days.", "en");
    expect(out).toContain("Your" + NBSP + "Week");
    expect(out.endsWith("compare" + NBSP + "days.")).toBe(true);
  });

  it("lets a long title break only between meaningful units", () => {
    expect(keepGuidePhrasesTogether("창을 닫아도 메뉴 막대에 있어요", "ko")).toBe("창을 닫아도 메뉴" + NBSP + "막대에" + NBSP + "있어요");
    expect(keepGuidePhrasesTogether("Still here in the menu bar", "en")).toBe("Still here in the menu" + NBSP + "bar");
    expect(keepGuidePhrasesTogether("Drifty", "en")).toBe("Drifty");
  });
});
