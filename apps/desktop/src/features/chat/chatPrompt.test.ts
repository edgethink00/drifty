import { describe, expect, it } from "vitest";

import { buildChatInstructions, buildChatPrompt } from "./chatPrompt";
import type { ChatTurn } from "./chatTypes";

function turn(question: string, answer: string, status: ChatTurn["status"] = "done"): ChatTurn {
  return { id: question, question, connection: "codex", status, notes: [], answer, tools: [], error: null, startedAt: "", finishedAt: null };
}

describe("Chat instructions and prompt", () => {
  it("anchors relative dates, the evidence rules and the reply language", () => {
    const instructions = buildChatInstructions({ now: new Date(2026, 9, 24, 9, 5), timeZone: "Asia/Seoul", language: "ko" });
    expect(instructions).toContain("Current local time: 2026-10-24 09:05 (Saturday, Asia/Seoul)");
    expect(instructions).toContain("An empty result is not proof that nothing happened");
    expect(instructions).toContain("Reply in Korean");
    expect(buildChatInstructions({ now: new Date(2026, 9, 24), timeZone: "UTC", language: "en" })).toContain("Reply in English");
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
    expect(prompt).toContain("User: 어제 뭐 했어?");
    expect(prompt).not.toContain("멈춘 질문");
    expect(prompt).not.toContain("에러 질문");
    expect(prompt).toContain("…");
    expect(prompt.endsWith("New question from the user:\n그 전날은?")).toBe(true);
  });
});

