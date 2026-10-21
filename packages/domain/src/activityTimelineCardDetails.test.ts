import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "./activity";
import { activityCardDetailIdentities, activityCardDetailLog, activityCardDetailRuns, activityCardDetailView } from "./activityTimelineCardDetails";

const START = Date.parse("2026-10-14T15:00:00Z");
function record(id: string, minute: number, minutes: number, appName = "Chrome", siteDomain?: string): ActivitySegment {
  const started = START + minute * 60_000;
  return {
    id,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(started + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
    appName,
    ...(siteDomain ? { siteDomain } : {}),
    platform: "macos",
    source: "manual",
  };
}

const segments = [
  record("a", 0, 20), record("b", 25, 10), // the game
  record("c", 40, 4), // a feed between games
  record("d", 45, 0.5), // a short chat
  record("e", 50, 7), // videos long enough to be a task of their own
  record("f", 60, 2, "Gmail"), // untitled use no detail cites
];
const byId = new Map(segments.map((segment) => [segment.id, segment]));
const card = {
  title: "Map Wars play",
  segmentIds: ["a", "b", "c", "d", "e", "f"],
  details: [
    { activity: "Map Wars play", segmentIds: ["a", "b"], named: true },
    { activity: "Instagram feed", segmentIds: ["c"], named: false },
    { activity: "Drifty chat", segmentIds: ["d"], named: false },
    { activity: "YouTube shorts", segmentIds: ["e"], named: false },
    // The model cited the game's record again for another activity: it counts once.
    { activity: "Game lobby", segmentIds: ["a"], named: false },
  ],
};
const lines = (view: ReturnType<typeof activityCardDetailView>, key: "named" | "alongside" | "separate") => view[key].map((line) => [line.activity, line.seconds / 60]);

describe("activity card detail view", () => {
  it("keeps what the title names apart from what only shared its stretch, and its parts add up", () => {
    const view = activityCardDetailView(card, byId, START, START + 90 * 60_000);
    expect(view.recordedSeconds / 60).toBe(43.5);
    expect(lines(view, "named")).toEqual([["Map Wars play", 30]]);
    // The title already says it: no line repeats it.
    expect(view.namedListed).toBe(false);
    expect(lines(view, "alongside")).toEqual([["Instagram feed", 4]]);
    expect(lines(view, "separate")).toEqual([["YouTube shorts", 7]]);
    // The short chat and the untitled use are the rest, told by app.
    expect(view.restSeconds / 60).toBe(2.5);
    expect(view.restApps).toEqual([{ name: "Gmail", seconds: 120 }]);
    const parts = [...view.named, ...view.alongside, ...view.separate].reduce((total, line) => total + line.seconds, 0) + view.restSeconds;
    expect(parts).toBe(view.recordedSeconds);
  });

  it("counts only the block's part of the card", () => {
    const view = activityCardDetailView(card, byId, START + 30 * 60_000, START + 60 * 60_000);
    expect(view.recordedSeconds / 60).toBe(16.5);
    expect(lines(view, "named")).toEqual([["Map Wars play", 5]]);
    expect(view.separate[0]).toMatchObject({ activity: "YouTube shorts", startMs: START + 50 * 60_000, endMs: START + 57 * 60_000 });
    expect(view.restSeconds / 60).toBe(0.5);
  });

  it("lists every activity a grouping title names, largest first", () => {
    const grouped = { ...card, details: card.details.map((detail) => detail.activity === "Instagram feed" ? { ...detail, named: true } : detail) };
    const view = activityCardDetailView(grouped, byId, START, START + 90 * 60_000);
    expect(lines(view, "named")).toEqual([["Map Wars play", 30], ["Instagram feed", 4]]);
    expect(view.namedListed).toBe(true);
    // A title naming two things, one of which has no titled line, still shows the other.
    const twoThings = activityCardDetailView({ ...card, title: "Gmail and category copy" , details: [{ activity: "Category copy wording", segmentIds: ["a"], named: true }] }, byId, START, START + 90 * 60_000);
    expect(twoThings.namedListed).toBe(true);
    // Gmail's untitled use is what the title names, so it is not left in the rest.
    expect(lines(twoThings, "named")).toEqual([["Category copy wording", 20], ["Gmail", 2]]);
    expect(twoThings.restApps.map((app) => app.name)).not.toContain("Gmail");
  });

  it("lists a single named activity only when something sits beside it, so it never just restates the title", () => {
    const alone = activityCardDetailView({ title: "Research plan check", segmentIds: ["a"], details: [{ activity: "Hancom Web research plan check", segmentIds: ["a"], named: true }] }, byId, START, START + 90 * 60_000);
    expect(lines(alone, "named")).toEqual([["Hancom Web research plan check", 20]]);
    expect(alone.namedListed).toBe(false);
    const beside = activityCardDetailView({ ...card, title: "Research plan check", segmentIds: ["a", "c"], details: [{ activity: "Hancom Web research plan check", segmentIds: ["a"], named: true }, { activity: "Instagram feed", segmentIds: ["c"], named: false }] }, byId, START, START + 90 * 60_000);
    expect(beside.namedListed).toBe(true);
  });

  it("treats a line the title says word for word as named even without the stored mark", () => {
    const unmarked = activityCardDetailView({ ...card, details: card.details.map((detail) => ({ ...detail, named: false })) }, byId, START, START + 90 * 60_000);
    expect(lines(unmarked, "named")).toEqual([["Map Wars play", 30]]);
    expect(lines(unmarked, "separate")).toEqual([["YouTube shorts", 7]]);
  });

  it("finds a site the title names by its name or service, never by an address, and drops leftover lines", () => {
    const mixed = [
      record("m", 0, 19, "Google Chrome", "mail.google.com"),
      record("n", 20, 12, "Google Chrome", "docs.google.com"),
      record("o", 33, 3, "Google Chrome", "100.64.12.34"),
      record("u", 37, 2, "Google Chrome", "youtube.com"),
      record("w", 40, 2, "Google Chrome", "newtab"),
    ];
    const view = activityCardDetailView({
      title: "Gmail과 카테고리 설명 방식",
      segmentIds: ["m", "n", "o", "u", "w"],
      details: [
        { activity: "카테고리 설명 방식 구체화", segmentIds: ["n"], named: true },
        // Stored before leftover lines were dropped at parsing: told by app instead.
        { activity: "기타 Drifty 대화 및 무제목 앱 사용", segmentIds: ["u"], named: false },
      ],
    }, new Map(mixed.map((segment) => [segment.id, segment])), START, START + 60 * 60_000);
    expect(lines(view, "named")).toEqual([["mail.google.com", 19], ["카테고리 설명 방식 구체화", 12]]);
    expect(view.alongside).toEqual([]);
    // An address or a browser's own page still counts in the rest's time, but is not named in it.
    expect(view.restSeconds).toBe(420);
    expect(view.restApps).toEqual([{ name: "youtube.com", seconds: 120 }]);
    // A title that is only the site's name says its one line already.
    const feed = activityCardDetailView({ title: "YouTube 영상 모음", segmentIds: ["u"], details: [] }, new Map(mixed.map((segment) => [segment.id, segment])), START, START + 60 * 60_000);
    expect(lines(feed, "named")).toEqual([["youtube.com", 2]]);
    expect(feed.namedListed).toBe(false);
    expect(feed.restSeconds).toBe(0);
  });

  it("shows at most three side activities and folds the others into the rest", () => {
    const many = [record("p", 0, 2), record("q", 3, 1.5), record("r", 5, 1.2), record("s", 7, 1.1), record("t", 9, 10)];
    const view = activityCardDetailView({
      title: "Main work",
      segmentIds: ["p", "q", "r", "s", "t"],
      details: [
        { activity: "Main work", segmentIds: ["t"], named: true },
        ...["p", "q", "r", "s"].map((id) => ({ activity: "Side " + id, segmentIds: [id], named: false })),
      ],
    }, new Map(many.map((segment) => [segment.id, segment])), START, START + 30 * 60_000);
    expect(view.alongside.map((line) => line.activity)).toEqual(["Side p", "Side q", "Side r"]);
    expect(view.restSeconds / 60).toBeCloseTo(1.1);
    expect(view.restApps).toEqual([{ name: "Chrome", seconds: 66 }]);
  });
});

describe("activity card detail runs", () => {
  // Each line: its name, kind and the whole stretch's minutes.
  const runs = (list: ReturnType<typeof activityCardDetailRuns>) => list.map((run) => [run.label, run.kind, run.totalSeconds / 60]);

  it("lists the block's records in time order by activity, the rest by app, and the stretches add up", () => {
    const list = activityCardDetailRuns([card], byId, START, START + 90 * 60_000);
    expect(runs(list)).toEqual([
      // A five-minute break between the two game records keeps them apart.
      ["Map Wars play", "activity", 20],
      ["Map Wars play", "activity", 10],
      // The 30-second chat right after the feed is in its stretch; the feed still holds most of it.
      ["Instagram feed", "activity", 4.5],
      ["YouTube shorts", "activity", 7],
      // Untitled use is named by its app, where it happened.
      ["Gmail", "app", 2],
    ]);
    expect(list.reduce((total, run) => total + run.totalSeconds, 0) / 60).toBe(43.5);
    expect(list[2]).toMatchObject({ seconds: 240, startMs: START + 40 * 60_000, endMs: START + 45.5 * 60_000, segmentIds: ["c", "d"] });
    expect(list[2].also).toBeUndefined();
  });

  it("keeps one activity whole across a brief detour, names an address by its browser and adds records outside every card", () => {
    const records = [
      record("g1", 0, 10), record("x", 10, 0.5), record("g2", 10.5, 9.5),
      record("ip", 21, 3, "Google Chrome", "100.64.12.34"),
      record("out", 25, 2, "Slack"),
      // The lock screen and a lone 40-second blip are not lines.
      record("lock", 28, 1.5, "loginwindow"),
      record("blip", 40, 40 / 60, "Notes"),
    ];
    const game = { title: "Game", segmentIds: ["g1", "x", "g2", "ip"], details: [{ activity: "Game", segmentIds: ["g1", "g2"], named: true }, { activity: "Chat", segmentIds: ["x"], named: false }] };
    const list = activityCardDetailRuns([game], new Map(records.map((segment) => [segment.id, segment])), START, START + 60 * 60_000, ["out", "lock", "blip"]);
    expect(runs(list)).toEqual([["Game", "activity", 20], ["Google Chrome", "app", 3], ["Slack", "app", 2]]);
    expect(list[0]).toMatchObject({ seconds: 19.5 * 60, startMs: START, endMs: START + 20 * 60_000 });
  });

  it("joins one activity across a detour under two minutes, and a longer detour is a line of its own", () => {
    const records = [record("p1", 0, 6), record("q", 6, 1.5, "Discord"), record("p2", 7.5, 6), record("r", 13.5, 2.5, "Discord")];
    const play = { title: "Play", segmentIds: ["p1", "q", "p2", "r"], details: [{ activity: "Play", segmentIds: ["p1", "p2"], named: true }] };
    const list = activityCardDetailRuns([play], new Map(records.map((segment) => [segment.id, segment])), START, START + 30 * 60_000);
    // 1.5 minutes of Discord stays inside the play; 2.5 minutes is a line of its own.
    expect(runs(list)).toEqual([["Play", "activity", 13.5], ["Discord", "app", 2.5]]);
    expect(list[0].seconds / 60).toBe(12);
  });

  it("never lets a line's name hold less than half of it, and names a second activity holding a quarter", () => {
    // Video and chat take turns in pieces under two minutes.
    const turns = [record("v1", 0, 1.8, "Chrome", "youtube.com"), record("c1", 1.8, 1.5, "ChatGPT"), record("v2", 3.3, 1.8, "Chrome", "youtube.com"), record("c2", 5.1, 1.5, "ChatGPT"), record("v3", 6.6, 1.8, "Chrome", "youtube.com")];
    const list = activityCardDetailRuns([], new Map(turns.map((segment) => [segment.id, segment])), START, START + 30 * 60_000, turns.map((segment) => segment.id));
    for (const run of list) expect(run.seconds / run.totalSeconds).toBeGreaterThanOrEqual(0.5);
    expect(list.map((run) => [run.label, run.also?.label])).toEqual([["youtube.com", "ChatGPT"]]);
    expect(list[0]).toMatchObject({ seconds: 5.4 * 60, totalSeconds: 8.4 * 60 });
  });

  it("counts only the block's part", () => {
    const list = activityCardDetailRuns([card], byId, START + 30 * 60_000, START + 52 * 60_000);
    expect(runs(list)).toEqual([["Map Wars play", "activity", 5], ["Instagram feed", "activity", 4.5], ["YouTube shorts", "activity", 2]]);
  });

  it("can instead give each activity one line in the order it first happened", () => {
    const log = activityCardDetailLog([card], byId, START, START + 90 * 60_000);
    expect(log.map((entry) => [entry.label, entry.kind, entry.seconds / 60, entry.times])).toEqual([
      ["Map Wars play", "activity", 30, 2],
      ["Instagram feed", "activity", 4, 1],
      ["YouTube shorts", "activity", 7, 1],
      ["Gmail", "app", 2, 1],
    ]);
  });
});

describe("activity card detail identities", () => {
  it("ranks the stretch's own apps and sites by their time in it, as its log counts them", () => {
    const records = [
      record("feed", 0, 3, "Aside", "instagram.com"), // before the block starts
      record("m1", 5, 8, "Aside", "mail.google.com"), record("chat", 13, 6, "ChatGPT"),
      record("m2", 19, 9, "Aside", "mail.google.com"), record("local", 28, 7, "Aside", "localhost:5173"),
      record("lock", 35, 20, "loginwindow"),
    ];
    const list = activityCardDetailIdentities(new Map(records.map((segment) => [segment.id, segment])), START + 5 * 60_000, START + 60 * 60_000, records.map((segment) => segment.id));
    expect(list.map((identity) => [identity.id, identity.seconds / 60])).toEqual([
      ["site:mail.google.com", 17],
      ["app:Aside", 7], // an address is its browser
      ["app:ChatGPT", 6],
    ]);
  });
});
