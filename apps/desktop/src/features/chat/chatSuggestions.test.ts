import { describe, expect, it } from "vitest";

import { chatTasks, filterChatTasks, splitAnswerSuggestions, visibleAnswerText } from "./chatSuggestions";

const FENCE = "\u0060\u0060\u0060";

describe("suggested tasks", () => {
  it("offers ready-made tasks with a short title and a fuller request", () => {
    const tasks = chatTasks("ko");
    expect(tasks.slice(0, 6).map((task) => task.id)).toEqual(["standup", "today", "week-review", "week-compare", "focus-peak", "project"]);
    const standup = tasks[0];
    expect(standup.title).toBe("어제 스탠드업");
    expect(standup.prompt).toContain("어제 한 일 / 오늘 이어갈 일 / 막힌 점");
    expect(tasks.find((task) => task.id === "project")?.title).toBe("프로젝트별 시간");
  });

  it("words the project task with the first active project on this computer", () => {
    const project = chatTasks("en", { projectNames: ["  Northstar  ", "Drifty"] }).find((task) => task.id === "project");
    expect(project?.title).toBe("Time on Northstar");
    expect(project?.prompt).toContain("the Northstar project");
  });

  it("filters the / menu by every typed word", () => {
    const tasks = chatTasks("en");
    expect(filterChatTasks(tasks, "").length).toBe(tasks.length);
    expect(filterChatTasks(tasks, "week").map((task) => task.id)).toEqual(["week-review", "week-compare", "focus-peak", "project"]);
    expect(filterChatTasks(tasks, "STAND up").map((task) => task.id)).toEqual(["standup"]);
    expect(filterChatTasks(tasks, "nothing like this")).toEqual([]);
  });
});

describe("follow-up suggestions in an answer", () => {
  it("splits the trailing suggestions block from the answer", () => {
    const text = "어제는 **7시간** 기록됐어요.\n\n" + FENCE + "suggestions\n[\"오후엔 뭐 했어?\", \"지난주 같은 요일은?\", \"가장 긴 집중은?\", \"네 번째\"]\n" + FENCE + "\n";
    expect(splitAnswerSuggestions(text)).toEqual({
      answer: "어제는 **7시간** 기록됐어요.",
      suggestions: ["오후엔 뭐 했어?", "지난주 같은 요일은?", "가장 긴 집중은?"],
    });
  });

  it("keeps the answer and drops a malformed block", () => {
    const text = "Answer.\n" + FENCE + "suggestions\nnot json\n" + FENCE;
    expect(splitAnswerSuggestions(text)).toEqual({ answer: "Answer.", suggestions: [] });
    expect(splitAnswerSuggestions("Plain answer")).toEqual({ answer: "Plain answer", suggestions: [] });
  });

  it("hides a block that is still being written", () => {
    expect(visibleAnswerText("Answer so far\n" + FENCE + "suggest")).toBe("Answer so far");
    expect(visibleAnswerText("Use \u0060code\u0060 here")).toBe("Use \u0060code\u0060 here");
    expect(visibleAnswerText("Answer so far\n" + FENCE + "suggestions\n[\"a\"")).toBe("Answer so far");
  });
});

