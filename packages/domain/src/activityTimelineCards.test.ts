import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "./activity";
import { activityBlockLabelEvidenceTitle } from "./activityBlockLabels";
import {
  ACTIVITY_TIMELINE_CARD_PROMPT_VERSION,
  activityTimelineWindowAnswered,
  activityTimelineWindowSaveInput,
  buildActivityTimelineCardPrompt,
  buildActivityTimelineRecords,
  buildActivityTimelineWindows,
  decideActivityTimelineCards,
  listedActivityTimelineRecords,
  parseActivityTimelineCardOutput,
  storedActivityTimelineCards,
  type ActivityTimelineCardModelItem,
  type ActivityTimelineWindowRecord,
} from "./activityTimelineCards";

const DAY = "2026-10-14";
const DAY_START = Date.parse("2026-10-14T00:00:00Z");
const DAY_END = DAY_START + 24 * 3600_000;
const POLICY = { windowTitle: true, contentContext: true };

function record(id: string, minute: number, minutes: number, fields: Partial<ActivitySegment> = {}): ActivitySegment {
  const started = DAY_START + minute * 60_000;
  return {
    id,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(started + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
    appName: "Code",
    platform: "macos",
    source: "manual",
    ...fields,
  };
}

function prepare(segments: ActivitySegment[]) {
  const [window] = buildActivityTimelineWindows(DAY, segments, DAY_START, DAY_END);
  const records = buildActivityTimelineRecords(window, new Map(segments.map((segment) => [segment.id, segment])), POLICY);
  return { window, records, listed: listedActivityTimelineRecords(records) };
}

const item = (startRef: string, endRef: string, title: string, refs: string[], description = ""): ActivityTimelineCardModelItem => ({
  startRef, endRef, status: "ready", title, description, refs,
});

describe("activity timeline windows", () => {
  it("splits at 20-minute breaks, cuts long sessions at their largest gap, and knows which windows are settled", () => {
    const segments = [
      record("1", 60, 30), record("2", 110, 20), // 20-minute break before 2: new window
      // A four-hour session: 180-minute cap, cut at the 10-minute gap at 230.
      record("3", 130, 100), record("4", 240, 60), record("5", 300, 70),
    ];
    const windows = buildActivityTimelineWindows(DAY, segments, DAY_START, DAY_END);
    expect(windows.map((window) => window.segmentIds)).toEqual([["1"], ["2", "3"], ["4", "5"]]);
    expect(windows.map((window) => window.followed)).toEqual([true, true, false]);
    // Keys depend on the records only, so a compact payload finds the same windows.
    const compact = segments.map((segment) => ({ ...segment, windowTitle: null }));
    expect(buildActivityTimelineWindows(DAY, compact, DAY_START, DAY_END).map((window) => window.key)).toEqual(windows.map((window) => window.key));
  });

  it("keeps sensitive and person pages out of the prompt while their time still counts", () => {
    const segments = [
      record("1", 0, 20, { appName: "Chrome", siteDomain: "github.com", siteTitle: "drifty/checkout-retry.ts" }),
      record("2", 20, 5, { appName: "Chrome", siteDomain: "bank.example", siteTitle: "입출금 내역 | 전체" }),
      record("3", 25, 5, { appName: "Chrome", siteDomain: "threads.com", siteTitle: "민지님(@minji.example) • Threads" }),
      record("4", 30, 5, { appName: "Chrome", siteDomain: "www.linkedin.com", siteTitle: "Jane Doe | LinkedIn" }),
    ];
    const { records, listed } = prepare(segments);
    expect(records.map((entry) => [entry.site, entry.title])).toEqual([
      ["github.com", "drifty/checkout-retry.ts"], [null, null], ["threads.com", null], ["www.linkedin.com", null],
    ]);
    const prompt = buildActivityTimelineCardPrompt(listed, records, "ko");
    expect(prompt).toContain("checkout-retry.ts");
    expect(prompt).not.toMatch(/입출금|bank\.example|minji\.example|Jane Doe/);
    expect(activityBlockLabelEvidenceTitle({ appName: "Chrome", siteDomain: null, siteTitle: "「가지 마」 - YouTube", windowTitle: null }, POLICY)).toBe("「가지 마」 - YouTube");
  });
});

describe("activity timeline cards", () => {
  const segments = [
    record("1", 0, 40, { windowTitle: "checkout-retry.ts — drifty" }),
    record("2", 40, 25, { appName: "Chrome", siteDomain: "youtube.com", siteTitle: "Long systems lecture - YouTube" }),
    record("3", 65, 3, { appName: "Chrome", siteDomain: "drifty.so", siteTitle: "Drifty pricing page" }),
    record("4", 68, 12, { appName: "Slack" }),
  ];

  it("keeps representative cards strict, loose ones partial, untitled stretches as app cards, and drops action claims", () => {
    const { window, records, listed } = prepare(segments);
    const { cards, rejected } = decideActivityTimelineCards(window, records, listed, [
      item("r1", "r1", "Checkout retry review", ["r1"], "Fixed the retry handler."),
      item("r2", "r3", "Drifty pricing review", ["r3"]),
      item("r4", "r4", "Slack check", []),
    ], "en");
    expect(cards.map((card) => [card.title, card.variant, card.status, card.description])).toEqual([
      ["Checkout retry review", "strict", "ready", ""],
      ["Drifty pricing review", "partial", "limited", ""],
      ["Slack check", "apps", "limited", ""],
    ]);
    expect(rejected).toEqual({});
    expect(cards[1].segmentIds).toEqual(["2", "3"]);
  });

  it("rejects overlapping ranges and titles with nothing behind them", () => {
    const { window, records, listed } = prepare(segments);
    const { cards, rejected } = decideActivityTimelineCards(window, records, listed, [
      item("r1", "r1", "Checkout retry review", ["r1"]),
      item("r1", "r2", "Overlap", ["r1"]),
      item("r2", "r2", "Kubernetes migration", []),
      item("r3", "r3", "Drifty pricing page", ["r3"]),
      // Slack has no titles: naming the stretch after a page is not supported.
      item("r4", "r4", "Drifty pricing page", []),
    ], "en");
    expect(rejected).toEqual({ overlap: 1, unsupported_title: 2 });
    expect(cards.map((card) => card.title)).toEqual(["Checkout retry review", "Drifty pricing page"]);
    expect(cards[1].segmentIds).toEqual(["3"]);
  });

  it("rejects a duration the model adds but keeps words like 4분기 and quantities copied from a title", () => {
    const korean = [
      record("1", 0, 30, { appName: "Chrome", siteDomain: "notion.so", siteTitle: "4분기 로드맵 – 결제 개선" }),
      record("2", 30, 25, { appName: "Chrome", siteDomain: "youtube.com", siteTitle: "10분 만에 보는 요리 브이로그 - YouTube" }),
      record("3", 55, 25, { appName: "Pages", windowTitle: "결제 제안서 5초안" }),
    ];
    const { window, records, listed } = prepare(korean);
    const { cards, rejected } = decideActivityTimelineCards(window, records, listed, [
      item("r1", "r1", "4분기 결제 로드맵", ["r1"]),
      item("r2", "r2", "10분 요리 브이로그 영상", ["r2"]),
      item("r3", "r3", "결제 제안서 5초안", ["r3"], "제안서를 25분 동안 봤다."),
    ], "ko");
    expect(cards.map((card) => card.title)).toEqual(["4분기 결제 로드맵", "10분 요리 브이로그 영상", "결제 제안서 5초안"]);
    // The description's "25분" is the model's own duration: the description goes, the card stays.
    expect(rejected).toEqual({});
    expect(cards[2].description).toBe("");

    const { window: w2, records: r2, listed: l2 } = prepare([record("1", 0, 30, { appName: "Chrome", siteDomain: "notion.so", siteTitle: "4분기 로드맵 – 결제 개선" })]);
    expect(decideActivityTimelineCards(w2, r2, l2, [item("r1", "r1", "30분 로드맵 검토", ["r1"])], "ko").rejected).toEqual({ time_quantity: 1 });
  });

  it("merges adjacent cards the model split under the same name", () => {
    const split = [record("a", 0, 20, { windowTitle: "checkout-retry.ts" }), record("b", 22, 20, { windowTitle: "checkout-retry.ts" })];
    const { window, records, listed } = prepare(split);
    const { cards } = decideActivityTimelineCards(window, records, listed, [
      item("r1", "r1", "Checkout retry review", ["r1"]),
      item("r2", "r2", "Checkout retry review", ["r2"]),
    ], "en");
    expect(cards).toHaveLength(1);
    expect(cards[0].segmentIds).toEqual(["a", "b"]);
  });

  it("stores a window with its cards and reads its cards back in this language and prompt version", () => {
    const { window, records, listed } = prepare(segments);
    const { cards } = decideActivityTimelineCards(window, records, listed, [item("r1", "r1", "Checkout retry review", ["r1"])], "en");
    const input = activityTimelineWindowSaveInput(window, cards, "en", { model: "m" });
    expect(input).toMatchObject({ windowKey: window.key, language: "en", segmentIds: window.segmentIds, promptVersion: ACTIVITY_TIMELINE_CARD_PROMPT_VERSION, model: "m", provider: null });
    expect(input.cards.map((card) => [card.title, card.variant, card.status])).toEqual([["Checkout retry review", "strict", "ready"]]);
    // The tracker returns what was stored, with each card's position.
    const stored: ActivityTimelineWindowRecord = { ...input, createdAt: "2026-10-14T12:00:00Z", cards: input.cards.map((card, position) => ({ ...card, position })) };
    expect(activityTimelineWindowAnswered(window, [stored], "en")).toBe(true);
    expect(activityTimelineWindowAnswered(window, [stored], "ko")).toBe(false);
    const [read] = storedActivityTimelineCards([stored], "en");
    expect(read.record).toMatchObject({ blockKey: window.key + ":c1", source: "ai", title: "Checkout retry review", status: "ready", segmentIds: input.cards[0].segmentIds });
    expect(read.variant).toBe("strict");
    expect(storedActivityTimelineCards([stored], "ko")).toEqual([]);
    expect(storedActivityTimelineCards([{ ...stored, promptVersion: "old" }], "en")).toEqual([]);
    // A window answered with no cards is still answered.
    expect(activityTimelineWindowAnswered(window, [{ ...stored, cards: [] }], "en")).toBe(true);
    expect(activityTimelineWindowAnswered(window, [{ ...stored, cards: [], model: null, provider: "cloud" }], "en")).toBe(true);
    // No model answered these: title evidence may now be available or enabled.
    expect(activityTimelineWindowAnswered(window, [{ ...stored, cards: [], model: null, provider: null }], "en")).toBe(false);
    expect(activityTimelineWindowAnswered(window, [{ ...stored, cards: [], model: undefined, provider: undefined }], "en")).toBe(false);
  });

  it("parses fenced answers and drops malformed cards", () => {
    expect(parseActivityTimelineCardOutput("\x60\x60\x60json\n{\"cards\":[{\"start_ref\":\"r1\",\"end_ref\":\"r2\",\"title\":\"A\",\"refs\":[\"r1\",3]},{\"title\":\"B\"}]}\n\x60\x60\x60"))
      .toEqual([{ startRef: "r1", endRef: "r2", status: "limited", title: "A", description: "", refs: ["r1"] }]);
    expect(parseActivityTimelineCardOutput("not json")).toBeNull();
  });

  it("reads card refs, not the title evidence's, and recovers an answer that closes one level too often", () => {
    const card = "{\"start_ref\":\"r1\",\"end_ref\":\"r4\",\"title_evidence\":{\"activities\":[{\"activity\":\"Checkout retry\",\"refs\":[\"r1\",\"r3\"],\"minutes\":18},{\"activity\":\"Docs\",\"refs\":[\"r2\"],\"minutes\":3}],\"selected\":\"Checkout retry\"},\"status\":\"ready\",\"title\":\"Checkout retry handler\",\"description\":\"\",\"refs\":[\"r1\",\"r3\"]}";
    const expected = [{ startRef: "r1", endRef: "r4", status: "ready", title: "Checkout retry handler", description: "", refs: ["r1", "r3"] }];
    expect(parseActivityTimelineCardOutput("{\"cards\":[" + card + "]}")).toEqual(expected);
    expect(parseActivityTimelineCardOutput("{\"cards\":[" + card + "]}]}")).toEqual(expected);
    // A cut-off answer is not completed.
    expect(parseActivityTimelineCardOutput("{\"cards\":[" + card)).toBeNull();
  });
});
