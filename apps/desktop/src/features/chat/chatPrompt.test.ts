import { describe, expect, it } from "vitest";

import { buildChatInstructions, buildChatPrompt } from "./chatPrompt";
import type { ChatTurn } from "./chatTypes";

function turn(question: string, answer: string, status: ChatTurn["status"] = "done"): ChatTurn {
  return { id: question, question, connection: "codex", status, notes: [], answer, tools: [], error: null, startedAt: "", finishedAt: null };
}

describe("Chat instructions and prompt", () => {
  it("keeps the original local question clock even if the machine later changes zone", () => {
    const instructions = buildChatInstructions({ now: new Date("2026-11-03T08:00:00Z"), timeZone: "America/Los_Angeles", language: "ko", referenceTime: "2026-11-02T23:50:00+09:00" });
    expect(instructions).toContain("2026-11-02 23:50:00+09:00 (Monday, UTC+09:00)");
    expect(instructions).toContain("original question's time, including on retry");
    expect(instructions).toContain("never change a typed 'this week' to last week");
    expect(instructions).toContain("matchedSeconds is only the returned page");
    expect(instructions).toContain("zero to three");
  });

  it("carries the original date beside earlier relative-date questions", () => {
    const history = [{ ...turn("어제 뭐 했어?", "작업했어요."), startedAt: "2026-11-02T14:50:00Z", referenceTime: "2026-11-02T23:50:00+09:00" }];
    expect(buildChatPrompt(history, "그날 오후는?")).toContain("question time 2026-11-02T23:50:00+09:00");
  });
  it("anchors relative dates, the evidence rules and the reply language", () => {
    const instructions = buildChatInstructions({ now: new Date(2026, 9, 24, 9, 5), timeZone: "Asia/Seoul", language: "ko" });
    expect(instructions).toContain("Current local time: 2026-10-24 09:05 (Saturday, Asia/Seoul)");
    expect(instructions).toContain("An empty result is not proof that nothing happened");
    expect(instructions).toContain("Reply in Korean");
    expect(buildChatInstructions({ now: new Date(2026, 9, 24), timeZone: "UTC", language: "en" })).toContain("Reply in English");
  });

  it("keeps the agent on the drifty tools and asks for follow-ups it has not offered yet", () => {
    const first = buildChatInstructions({ now: new Date(2026, 9, 24), timeZone: "UTC", language: "ko" });
    expect(first).toContain("Never use any other tool, file, image or web page");
    expect(first).toContain("\u0060\u0060\u0060suggestions");
    expect(first).not.toContain("Do not repeat these earlier follow-ups");
    const later = buildChatInstructions({ now: new Date(2026, 9, 24), timeZone: "UTC", language: "ko", recentSuggestions: ["어제와 비교하면?"] });
    expect(later).toContain("Do not repeat these earlier follow-ups or close variants: \"어제와 비교하면?\".");
  });

  it("separates evidence timestamps from weekday-only work deadlines", () => {
    const instructions = buildChatInstructions({ now: new Date(2026, 9, 29), timeZone: "UTC", language: "ko", memory: true });
    expect(instructions).toContain("observed_at_utc (an exact UTC timestamp)");
    expect(instructions).toContain("do not estimate a date from epoch milliseconds");
    expect(instructions).toContain("Do not turn a weekday-only deadline into a calendar date without explicit evidence");
  });

  it("replays a suggested task by its full request, not its short title", () => {
    const history: ChatTurn[] = [{ ...turn("어제 스탠드업", "어제는 Figma…"), prompt: "어제 기록으로 스탠드업 노트를 써줘." }];
    const prompt = buildChatPrompt(history, "막힌 점만 더 자세히");
    expect(prompt).toContain(": 어제 기록으로 스탠드업 노트를 써줘.");
    expect(prompt).not.toContain("User: 어제 스탠드업");
  });

  it("sends a first question as is", () => {
    expect(buildChatPrompt([], "  어제 뭐 했어?  ")).toBe("어제 뭐 했어?");
  });

  it("carries recent finished turns only, with long answers clipped", () => {
    const history = [
      turn("어제 뭐 했어?", "Figma " + "x".repeat(2000)),
      turn("멈춘 질문", "", "cancelled"),
      turn("에러 질문", "", "error"),
    ];
    const prompt = buildChatPrompt(history, "그 전날은?");
    expect(prompt).toContain(": 어제 뭐 했어?");
    expect(prompt).not.toContain("멈춘 질문");
    expect(prompt).not.toContain("에러 질문");
    expect(prompt).toContain("…");
    expect(prompt.endsWith("New question from the user:\n그 전날은?")).toBe(true);
  });
});

