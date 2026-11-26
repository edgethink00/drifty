import { describe, expect, it } from "vitest";
import { buildHomeModel } from "./homeModel";
import { feedCards, formatDuration, headlineSentence, threadCards, topCard } from "./homeCards";
import { at, homeFixture, homeSegment, TODAY } from "./homeFixture.testUtils";

const model = (clock: string) => buildHomeModel({ segments: homeFixture(), today: TODAY, asOfMs: at(TODAY, clock), startOfDayMinutes: 0, goalHours: 4 });

describe("what Home says", () => {
  it("opens the morning with yesterday's work and where to pick up", () => {
    const card = topCard(model("09:10"), "ko");
    expect(card.kind).toBe("recap");
    expect(card.title).toBe("어제는 ‘billing.ts’에서 가장 오래 집중했어요.");
    expect(card.body).toContain("마지막엔 ‘Pricing empty states’에 오래 머물렀어요.");
  });

  it("gives the pace against a usual weekday by midday", () => {
    const card = topCard(model("12:00"), "ko");
    expect(card.kind).toBe("pace");
    expect(card.title).toBe("평소 목요일보다 35분 앞서 있어요.");
    expect(card.body).toContain("목표까지 1시간 25분 남았어요.");
    expect(topCard(model("12:00"), "en").title).toBe("35m ahead of a usual Thursday.");
  });

  it("uses 과 after a weekday when the pace is even", () => {
    expect(topCard(model("09:30"), "ko").kind).toBe("recap");
    const even = buildHomeModel({ segments: homeFixture(), today: TODAY, asOfMs: at(TODAY, "10:30"), startOfDayMinutes: 0, goalHours: 4 });
    expect(topCard({ ...even, phase: "midday" }, "ko").title).toBe("평소 목요일과 비슷한 페이스예요.");
  });

  it("wraps up the evening with the goal and where drift went", () => {
    const card = topCard(model("19:30"), "ko");
    expect(card.kind).toBe("wrap");
    expect(card.title).toBe("목표 4시간을 채웠어요. 최근 7일 중 1번째예요.");
    expect(card.body).toContain("딴짓은 대부분 youtube.com에서 했어요.");
  });

  it("says plainly how much focus there is when there is no usual day to compare", () => {
    const fresh = buildHomeModel({ segments: [homeSegment(TODAY, "09:00", "11:00", "focus")], today: TODAY, asOfMs: at(TODAY, "14:00"), startOfDayMinutes: 0, goalHours: null });
    expect(topCard(fresh, "ko").title).toBe("오늘 지금까지 2시간 집중했어요.");
    expect(feedCards(fresh, "ko").map((card) => card.kind)).toEqual(["ask"]);
  });

  it("feeds the week's pattern and drift, and hands questions to Chat", () => {
    const feed = feedCards(model("12:00"), "ko");
    expect(feed.map((card) => card.kind)).toEqual(["record", "discovery", "drift", "ask"]);
    expect(feed[0].body).toBe("09:00부터 2시간 35분 동안 이어졌어요.");
    expect(feed[1].title).toBe("최근 7일 가장 긴 집중 4번 중 4번이 오전 9시대에 시작했어요.");
    expect(feed[3].actions[0]).toMatchObject({ kind: "ask", question: "이번 주 뭐에 시간을 제일 많이 썼어?" });
  });

  it("says all of the drift went to one place instead of 100%", () => {
    const card = feedCards(model("12:00"), "ko").find((entry) => entry.kind === "drift");
    expect(card?.title).toBe("오늘 딴짓 20분은 모두 youtube.com에서 했어요.");
  });

  it("orders the conversation by when each thing would have been said", () => {
    const thread = threadCards(model("12:00"), "ko");
    expect(thread.map((card) => card.kind)).toEqual(["recap", "discovery", "record", "drift", "pace"]);
    expect(thread.find((card) => card.kind === "drift")?.atMs).toBe(at(TODAY, "12:00"));
  });

  it("writes the numbers as one sentence that leaves their meaning to the card", () => {
    expect(headlineSentence(model("12:00"), "ko")).toBe("지금까지 집중 2시간 35분, 딴짓 20분이에요. 목표까지 1시간 25분 남았어요.");
    expect(headlineSentence(model("12:00"), "ko")).not.toContain(topCard(model("12:00"), "ko").title.replace(/\.$/u, ""));
    expect(headlineSentence(model("08:30"), "ko")).toBe("오늘 기록은 아직 없어요. 목표는 4시간이에요.");
  });

  it("formats durations the way the app does", () => {
    expect(formatDuration(130 * 60, "ko")).toBe("2시간 10분");
    expect(formatDuration(120 * 60, "en")).toBe("2h");
    expect(formatDuration(25 * 60, "en")).toBe("25m");
  });
});

