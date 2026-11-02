import { describe, expect, it } from "vitest";

import { chatTasks, filterChatTasks, parseTaskAvailability, splitAnswerSuggestions, visibleAnswerText } from "./chatSuggestions";
import { calendarDay, calendarWeek, previousWeekAt, rangeLabel } from "./chatDates";

const FENCE = "\u0060\u0060\u0060";

describe("suggested tasks", () => {
  const monday = new Date(2026, 10, 2, 10, 15);
  it("offers ready-made tasks with a short title and a fuller request", () => {
    const tasks = chatTasks("ko");
    expect(tasks.slice(0, 6).map((task) => task.id)).toEqual(["standup", "today", "week-review", "week-compare", "focus-peak", "project"]);
    const standup = tasks[0];
    expect(standup.title).toBe("어제 작업 정리");
    expect(standup.prompt).toContain("Do not invent a plan");
    expect(tasks.find((task) => task.id === "project")?.title).toBe("프로젝트별 시간");
  });

  it("words the project task with the first active project on this computer", () => {
    const project = chatTasks("en", { projectNames: ["  Northstar  ", "Drifty"] }).find((task) => task.id === "project");
    expect(project?.title).toBe("Time on Northstar");
    expect(project?.prompt).toContain('exact full project name "Northstar"');
  });

  it("filters the / menu by every typed word", () => {
    const tasks = chatTasks("en");
    expect(filterChatTasks(tasks, "").length).toBe(tasks.length);
    expect(filterChatTasks(tasks, "week").map((task) => task.id)).toEqual(["week-review", "week-compare"]);
    expect(filterChatTasks(tasks, "STAND up").map((task) => task.id)).toEqual(["standup"]);
    expect(filterChatTasks(tasks, "nothing like this")).toEqual([]);
  });

  it("keeps Monday useful with a previous-week title, absolute range and two completed comparison weeks", () => {
    const tasks = chatTasks("ko", { now: monday });
    const review = tasks.find((task) => task.id === "week-review")!;
    expect(review.title).toBe("지난주 회고");
    expect(review.range?.from).toMatch(/^2026-10-26T00:00:00/);
    expect(review.range?.to).toMatch(/^2026-11-02T00:00:00/);
    expect(review.description).toBe("2026-10-26–2026-11-01");
    expect(review.prompt).toContain(JSON.stringify(review.range));
    const compare = tasks.find((task) => task.id === "week-compare")!;
    expect(compare.title).toBe("지난 두 주 비교");
    expect(compare.prompt).toContain("2026-10-19T00:00:00");
    expect(compare.prompt).toContain("2026-10-26T00:00:00");
    expect(compare.prompt).toContain("2026-11-02T00:00:00");
  });

  it("uses a progress review midweek and compares equal local clock cutoffs", () => {
    const tasks = chatTasks("ko", { now: new Date(2026, 10, 4, 10, 15) });
    expect(tasks.find((task) => task.id === "week-review")?.title).toBe("이번 주 지금까지");
    const compare = tasks.find((task) => task.id === "week-compare")!;
    expect(compare.prompt).toContain("2026-11-04T10:15:00");
    expect(compare.prompt).toContain("2026-10-28T10:15:00");
    expect(chatTasks("ko", { now: new Date(2026, 10, 7, 18) }).find((task) => task.id === "week-review")?.title).toBe("이번 주 회고");
  });

  it("recaps a recorded day once when the requested periods and projects have no records", () => {
    const tasks = chatTasks("ko", { now: monday, availability: {
      days: [{ day: "2026-11-02", recordedSeconds: 600, focusSeconds: 0, driftSeconds: 0 }], projects: [],
    } });
    expect(tasks.length).toBeGreaterThan(0);
    expect(new Set(tasks.map((task) => task.prompt)).size).toBe(tasks.length);
    expect(tasks.some((task) => task.title === "지난 두 주 비교" || task.title === "프로젝트별 시간")).toBe(false);
    expect(tasks.every((task) => task.range?.from.startsWith("2026-11-02"))).toBe(true);
  });

  it("keeps a sparse previous-week review and does not require enough days for a comparison", () => {
    const tasks = chatTasks("ko", { now: monday, availability: {
      days: [{ day: "2026-10-30", recordedSeconds: 600 }], projects: [],
    } });
    const review = tasks.find((task) => task.id === "week-review")!;
    expect(review.title).toBe("지난주 회고");
    expect(review.prompt).toContain("Compare days only when at least two days have records");
  });

  it("chooses a project with current-week assignments and sends its full name and exact id", () => {
    const fullName = "Northstar Global Customer Onboarding Redesign Phase Two";
    const tasks = chatTasks("ko", { now: monday,
      projects: [{ id: "unused", name: "Unused first project" }, { id: "real", name: fullName }],
      availability: { days: [{ day: "2026-11-02", recordedSeconds: 900, projects: [{ id: "real", seconds: 900 }] }],
        projects: [{ id: "real", name: fullName, seconds: 900 }] },
    });
    const project = tasks.find((task) => task.id === "project")!;
    expect(project.title).toContain("…");
    expect(project.prompt).toContain(JSON.stringify(fullName));
    expect(project.prompt).toContain('projectId "real"');
    expect(project.prompt).not.toContain("Redesign Re…");
  });

  it.each(["en", "ko", "es", "ja", "pt-BR", "zh-Hans", "fr", "de"] as const)("binds %s tasks to the same concrete periods", (language) => {
    const task = chatTasks(language, { now: monday }).find((entry) => entry.id === "week-review")!;
    expect(task.range?.from).toMatch(/^2026-10-26/);
    expect(task.range?.to).toMatch(/^2026-11-02/);
    expect(task.prompt).toContain(JSON.stringify(task.range));
  });

  it("uses an id from recorded assignments when the initial project list has no recorded match", () => {
    const task = chatTasks("ko", { now: monday, projects: [{ id: "unused", name: "Unused" }], availability: {
      days: [{ day: "2026-11-02", recordedSeconds: 600, projects: [{ id: "recorded", seconds: 600 }] }],
      projects: [{ id: "recorded", name: "Actual recorded project", seconds: 600 }],
    } }).find((entry) => entry.id === "project")!;
    expect(task.prompt).toContain('projectId "recorded"');
    expect(task.prompt).not.toContain('projectId "unused"');
  });

  it("rejects malformed local availability and strips malformed per-day project values", () => {
    expect(parseTaskAvailability("not json")).toBeNull();
    expect(parseTaskAvailability('{"data":{"days":null,"projects":[]}}')).toBeNull();
    expect(parseTaskAvailability('{"data":{"days":[{"day":"2026-11-02","recordedSeconds":10,"projects":{}}],"projects":[]}}')?.days[0].projects).toEqual([]);
  });

  it("uses calendar arithmetic at month, year and local DST boundaries", () => {
    expect(calendarWeek(new Date(2027, 0, 1)).getDate()).toBe(28);
    expect(calendarWeek(new Date(2027, 0, 1)).getFullYear()).toBe(2026);
    const prior = previousWeekAt(new Date(2026, 10, 2, 10, 15));
    expect(prior.getDate()).toBe(26);
    expect(prior.getHours()).toBe(10);
    expect(calendarDay(new Date(2026, 2, 1), -1).getDate()).toBe(28);
    expect(rangeLabel({ from: "2026-10-26T00:00:00+09:00", to: "2026-11-02T00:00:00+09:00" })).toContain("2026-10-26");
  });
});

describe("follow-up suggestions in an answer", () => {
  it("allows no follow-ups and filters previously offered or asked variants", () => {
    const text = "Answer.\n" + FENCE + "suggestions\n" + JSON.stringify(["어제 뭐 했어?", "어제 뭐 했어？", "오후엔 뭐 했어?", "x".repeat(41)]) + "\n" + FENCE;
    expect(splitAnswerSuggestions(text, ["어제 뭐 했어"])).toEqual({ answer: "Answer.", suggestions: ["오후엔 뭐 했어?"] });
    expect(splitAnswerSuggestions("Answer.\n" + FENCE + "suggestions\n[]\n" + FENCE)).toEqual({ answer: "Answer.", suggestions: [] });
  });
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

