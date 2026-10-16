import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "./activity";
import {
  ACTIVITY_BLOCK_LABEL_PROMPT_VERSION,
  activityBlockLabelFingerprint,
  activityBlockLabelKey,
  buildActivityBlockLabelInput,
  buildActivityBlockLabelPrompt,
  decideActivityBlockLabel,
  displayedActivityBlockLabel,
  parseActivityBlockLabelOutput,
  resolveActivityBlockLabel,
  type ActivityBlockLabelInput,
  type ActivityBlockLabelModelItem,
  type ActivityBlockLabelRecord,
} from "./activityBlockLabels";

const START = Date.parse("2026-10-14T01:00:00Z");
const ALL_TITLES = { windowTitle: true, contentContext: true };

function record(id: string, minute: number, minutes: number, fields: Partial<ActivitySegment>): ActivitySegment {
  const started = START + minute * 60_000;
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

function inputFor(segments: ActivitySegment[], policy = ALL_TITLES, minutes = 30): ActivityBlockLabelInput {
  return buildActivityBlockLabelInput(
    "block",
    { day: "2026-10-14", startMs: START, endMs: START + minutes * 60_000, segmentIds: segments.map((segment) => segment.id) },
    new Map(segments.map((segment) => [segment.id, segment])),
    policy,
  );
}

/** Evidence built directly, mirroring the shape the experiment replay used. */
function evidence(entries: readonly [string, number][], recordedSeconds = entries.reduce((sum, [, seconds]) => sum + seconds, 0)): ActivityBlockLabelInput {
  const titled = entries.reduce((sum, [, seconds]) => sum + seconds, 0);
  return {
    id: "block",
    recordedSeconds,
    titledSeconds: titled,
    titleCoverage: titled / recordedSeconds,
    untitledSeconds: recordedSeconds - titled,
    omittedTitledSeconds: 0,
    apps: [{ app: "Aside", seconds: recordedSeconds }],
    evidence: entries.map(([title, seconds], index) => ({ ref: "e" + (index + 1), app: "Aside", site: null, title, seconds })),
  };
}

function answer(fields: Partial<ActivityBlockLabelModelItem>): ActivityBlockLabelModelItem {
  return { id: "block", status: "ready", title: "", description: "", refs: [], ...fields };
}

describe("block label evidence", () => {
  it("keeps only provider-visible titles and counts withheld time as untitled", () => {
    const input = inputFor([
      record("1", 0, 12, { appName: "Google Chrome", siteDomain: "github.com", siteTitle: "Retry checkout payments · Pull Request #42 - Google Chrome" }),
      record("2", 12, 6, { appName: "Slack", windowTitle: "Jane Doe (DM) - Acme" }),
      record("3", 18, 4, { appName: "1Password", exclusionSource: "default", windowTitle: "Bank login" }),
      record("4", 22, 8, { appName: "Code", windowTitle: "checkout.ts — mail me at someone@example.com" }),
    ]);
    expect(input.recordedSeconds).toBe(30 * 60);
    expect(input.evidence.map((entry) => entry.title)).toEqual([
      "Retry checkout payments · Pull Request #42",
      "checkout.ts — mail me at [account]",
    ]);
    expect(input.untitledSeconds).toBe(10 * 60);
    expect(input.apps.map((app) => app.app)).not.toContain("1Password");
    expect(JSON.stringify(input)).not.toMatch(/Jane Doe|Bank login|someone@example/);
  });

  it("follows the AI privacy switches for window and page titles", () => {
    const segments = [
      record("1", 0, 15, { appName: "Google Chrome", siteDomain: "docs.example", siteTitle: "Pricing research" }),
      record("2", 15, 15, { appName: "Pages", windowTitle: "Proposal draft" }),
    ];
    expect(inputFor(segments, { windowTitle: false, contentContext: true }).evidence.map((entry) => entry.title)).toEqual(["Pricing research"]);
    expect(inputFor(segments, { windowTitle: true, contentContext: false }).evidence.map((entry) => entry.title)).toEqual(["Proposal draft"]);
    expect(inputFor(segments, { windowTitle: false, contentContext: false }).evidence).toEqual([]);
  });

  it("uses only the block's share of a record that crosses its edge", () => {
    const input = inputFor([record("1", -50, 60, { windowTitle: "Long design doc" })], ALL_TITLES, 30);
    expect(input.evidence[0].seconds).toBe(10 * 60);
  });

  it("is stable for the same records and changes when the evidence changes", () => {
    const segments = [record("1", 0, 30, { windowTitle: "Quarterly plan" })];
    expect(activityBlockLabelKey("2026-10-14", ["2", "1", "2"])).toBe(activityBlockLabelKey("2026-10-14", ["1", "2"]));
    const first = activityBlockLabelFingerprint(inputFor(segments), "ko");
    expect(activityBlockLabelFingerprint(inputFor(segments), "ko")).toBe(first);
    expect(activityBlockLabelFingerprint(inputFor(segments), "en")).not.toBe(first);
    expect(activityBlockLabelFingerprint(inputFor([record("1", 0, 30, { windowTitle: "Annual plan" })]), "ko")).not.toBe(first);
  });

  it("asks for the requested language and never sends record ids", () => {
    const input = inputFor([record("123456", 0, 30, { windowTitle: "Quarterly plan" })]);
    const prompt = buildActivityBlockLabelPrompt([input], "ko");
    expect(prompt).toContain("natural Korean");
    expect(prompt).not.toContain("123456");
  });
});

describe("block label acceptance", () => {
  const block = evidence([["Drifty · Week/Day calendar tuning", 219], ["Teams fix review", 108], ["Drifty · Week/Day calendar version compare", 102]], 1500);

  it("accepts a specific label grounded in most of the titled time, as a partial label", () => {
    const decision = decideActivityBlockLabel(block, answer({ title: "Drifty 주간·일간 캘린더 검토", description: "세부 조정안과 버전 비교 화면을 살펴봤다", refs: ["e1", "e3"] }), "ko");
    expect(decision).toMatchObject({ kind: "label", status: "limited", title: "Drifty 주간·일간 캘린더 검토", description: "세부 조정안과 버전 비교 화면을 살펴봤다." });
  });

  it("rejects a title that names a brief detour even when the big record is cited", () => {
    const mixed = evidence([["Status check without edits ⋅ Chats", 385], ["Agent safety proposal", 77], ["LinkedIn", 48], ["agent-cli dashboard", 42]], 1600);
    expect(decideActivityBlockLabel(mixed, answer({ status: "limited", title: "Agent safety proposal review", refs: ["e1", "e2"] }), "en"))
      .toEqual({ kind: "rejected", reason: "minor_topic" });
  });

  it("rejects a label whose cited evidence is a small share of the block", () => {
    const game = evidence([["Map Wars (trial)", 669], ["Don't go - YouTube", 252], ["Drifty · Week/Day calendar final review", 54]], 1800);
    expect(decideActivityBlockLabel(game, answer({ title: "Drifty calendar final review", refs: ["e3"] }), "en"))
      .toEqual({ kind: "rejected", reason: "minor_topic" });
  });

  it("requires every topic named in a combined title to matter", () => {
    const social = evidence([["Instagram", 900], ["Home • Threads", 60], ["Namecheap", 40]], 1100);
    expect(decideActivityBlockLabel(social, answer({ title: "Instagram and Threads browsing", refs: ["e1", "e2"] }), "en"))
      .toEqual({ kind: "rejected", reason: "minor_topic" });
    const versions = evidence([["Project plan v1.9.hwpx", 600], ["Project plan v1.10.hwpx", 120]], 900);
    expect(decideActivityBlockLabel(versions, answer({ title: "Project plan v1.9 · v1.10 review", refs: ["e1", "e2"] }), "en").kind).toBe("label");
  });

  it("credits a translated subject with one cited record, not every cited record", () => {
    const translated = evidence([["Plan a short-form content filter", 78], ["Harness system check", 55], ["Game strategy tips - YouTube", 54]], 300);
    expect(decideActivityBlockLabel(translated, answer({ status: "limited", title: "콘텐츠 필터와 하네스 점검", refs: ["e1", "e2"] }), "ko").kind).toBe("label");
  });

  it("rejects mixed scripts, identifiers, durations and app-name labels", () => {
    const plan = evidence([["Trial end and purchase window decision map", 900]], 1200);
    expect(decideActivityBlockLabel(plan, answer({ title: "체험 종료와 구매窗口 결정 지도", refs: ["e1"] }), "ko")).toEqual({ kind: "rejected", reason: "language" });
    expect(decideActivityBlockLabel(plan, answer({ title: "Plan at https://x.dev", refs: ["e1"] }), "en")).toEqual({ kind: "rejected", reason: "identifier" });
    expect(decideActivityBlockLabel(plan, answer({ title: "Decision map 20 min", refs: ["e1"] }), "en")).toEqual({ kind: "rejected", reason: "time_quantity" });
    expect(decideActivityBlockLabel(plan, answer({ title: "Aside", refs: ["e1"] }), "en")).toEqual({ kind: "rejected", reason: "generic" });
  });

  it("drops a description that narrates the evidence or repeats the title", () => {
    const videos = evidence([["Drama clip - YouTube", 600], ["Cooking - YouTube", 500]], 1300);
    const narrating = decideActivityBlockLabel(videos, answer({ status: "limited", title: "여러 유튜브 영상 시청", description: "다양한 영상 제목이 포함됐다.", refs: ["e1", "e2"] }), "ko");
    expect(narrating).toMatchObject({ kind: "label", description: "" });
  });

  it("downgrades ready when titles cover too little of the block", () => {
    const sparse = evidence([["Map Wars (trial)", 748]], 1634);
    expect(decideActivityBlockLabel(sparse, answer({ title: "Map Wars trial", refs: ["e1"] }), "en")).toMatchObject({ kind: "label", status: "limited" });
  });

  it("never asks the model about a block without enough titled time", () => {
    const untitled = evidence([["Short note", 60]], 1800);
    expect(decideActivityBlockLabel(untitled, answer({ title: "Short note", refs: ["e1"] }), "en")).toEqual({ kind: "abstain", reason: "insufficient_evidence" });
    expect(decideActivityBlockLabel(block, answer({ status: "abstain" }), "en")).toEqual({ kind: "abstain", reason: "model_abstained" });
    expect(decideActivityBlockLabel(block, answer({ title: "Calendar", refs: ["e9"] }), "en")).toEqual({ kind: "rejected", reason: "invalid_refs" });
  });

  it("parses fenced JSON and drops malformed items", () => {
    expect(parseActivityBlockLabelOutput("\x60\x60\x60json\n{\"items\":[{\"id\":\"b1\",\"status\":\"ready\",\"title\":\"A\",\"description\":\"\",\"refs\":[\"e1\"]},{\"id\":2}]}\n\x60\x60\x60"))
      .toEqual([{ id: "b1", status: "ready", title: "A", description: "", refs: ["e1"] }]);
    expect(parseActivityBlockLabelOutput("not json")).toBeNull();
  });
});

describe("block label resolution", () => {
  const seconds = new Map([["1", 600], ["2", 600], ["3", 600]]);
  const base = { logicalDay: "2026-10-14", blockStartedAt: "", blockEndedAt: "", description: "" };
  const ai: ActivityBlockLabelRecord = { ...base, blockKey: "k", source: "ai", segmentIds: ["1", "2", "3"], status: "ready", title: "AI name", evidenceFingerprint: "fp", language: "en", promptVersion: ACTIVITY_BLOCK_LABEL_PROMPT_VERSION };
  const user: ActivityBlockLabelRecord = { ...base, blockKey: "old", source: "user", segmentIds: ["1", "2", "3"], status: "user", title: "Client A checkout" };

  it("shows an AI label only for the exact records, language and prompt version it was made with", () => {
    expect(resolveActivityBlockLabel({ blockKey: "k", language: "en", segmentSeconds: seconds, labels: [ai] }).kind).toBe("ai");
    expect(resolveActivityBlockLabel({ blockKey: "other", language: "en", segmentSeconds: seconds, labels: [ai] })).toEqual({ kind: "none", needsGeneration: true });
    expect(resolveActivityBlockLabel({ blockKey: "k", language: "ko", segmentSeconds: seconds, labels: [ai] })).toEqual({ kind: "none", needsGeneration: true });
    expect(resolveActivityBlockLabel({ blockKey: "k", language: "en", promptVersion: "next", segmentSeconds: seconds, labels: [ai] }).kind).toBe("none");
  });

  it("keeps the user's name over AI and carries it across regrouping", () => {
    const resolved = resolveActivityBlockLabel({ blockKey: "k", language: "en", segmentSeconds: new Map([["1", 600], ["2", 600], ["4", 120]]), labels: [ai, user] });
    expect(resolved).toMatchObject({ kind: "user", carried: true });
    expect(displayedActivityBlockLabel(resolved)).toEqual({ title: "Client A checkout", description: "", origin: "user", status: "user" });
    expect(resolveActivityBlockLabel({ blockKey: "k", language: "en", segmentSeconds: new Map([["1", 600], ["5", 1800]]), labels: [ai, user] }).kind).toBe("ai");
  });

  it("treats a hidden user label as an explicit request for the existing display", () => {
    const hidden = { ...user, blockKey: "k", status: "hidden" as const, title: "" };
    const resolved = resolveActivityBlockLabel({ blockKey: "k", language: "en", segmentSeconds: seconds, labels: [ai, hidden] });
    expect(resolved.kind).toBe("user");
    expect(displayedActivityBlockLabel(resolved)).toBeNull();
  });

  it("does not display cached abstentions or rejections", () => {
    for (const status of ["abstain", "rejected"] as const) {
      expect(displayedActivityBlockLabel({ kind: "ai", record: { ...ai, status, title: "" } })).toBeNull();
    }
  });
});

