import { describe, expect, it, vi } from "vitest";
import type { ActivitySegment, ProductivityLabel, StoredClassificationSource } from "@drifty/domain";

import {
  aggregateSuggestionSurfaces,
  buildSuggestionPrompt,
  detectSuggestionClusters,
  generateMemorySuggestions,
  normalizeSuggestionTitle,
  parseSuggestionResponse,
  scoreSuggestionVerification,
  SUGGESTION_SKIPPED,
  validateSuggestionSummary,
  type SuggestionCluster,
} from "./memorySuggestions";

const WINDOW = { since: "2026-07-13T00:00:00.000Z", until: "2026-07-20T00:00:00.000Z" };

function segment(overrides: {
  readonly day?: number;
  readonly seconds?: number;
  readonly app?: string;
  readonly domain?: string | null;
  readonly title?: string | null;
  readonly label?: ProductivityLabel;
  readonly source?: StoredClassificationSource;
  readonly reason?: string;
  readonly startedAt?: string;
  readonly excluded?: boolean;
  readonly confidence?: number;
} = {}): ActivitySegment {
  const startedAt = overrides.startedAt ?? "2026-07-" + String(13 + (overrides.day ?? 0)) + "T09:00:00.000Z";
  return {
    id: "segment-" + Math.random().toString(36).slice(2),
    startedAt,
    endedAt: startedAt,
    durationSeconds: overrides.seconds ?? 600,
    appName: overrides.app ?? "Aside",
    siteDomain: overrides.domain ?? null,
    siteTitle: overrides.title ?? null,
    platform: "macos",
    source: "nsworkspace",
    exclusionSource: overrides.excluded ? "user" : null,
    classification: overrides.label
      ? { category: "workspace", productivity: overrides.label, source: overrides.source ?? "llm", confidence: overrides.confidence ?? 0.9, reason: overrides.reason ?? null }
      : null,
  } as unknown as ActivitySegment;
}

function repeat(count: number, build: (index: number) => ActivitySegment): ActivitySegment[] {
  return Array.from({ length: count }, (_, index) => build(index));
}

describe("normalizeSuggestionTitle", () => {
  it("drops memory-usage and audio suffixes and caps the length", () => {
    expect(normalizeSuggestionTitle("영상 제목 🔊 - 오디오 재생 - 메모리 사용량 많음 - 1.2GB")).toBe("영상 제목");
    expect(normalizeSuggestionTitle("  a   b  ")).toBe("a b");
    expect(normalizeSuggestionTitle("x".repeat(200))).toHaveLength(70);
    expect(normalizeSuggestionTitle(null)).toBe("");
  });
});

describe("aggregateSuggestionSurfaces", () => {
  it("groups by app, site and title and keeps the stored labels", () => {
    const segments = [
      segment({ day: 0, seconds: 600, domain: "overleaf.com", title: "Paper - Overleaf", label: "focus", reason: "Editing a paper" }),
      segment({ day: 1, seconds: 300, domain: "overleaf.com", title: "Paper - Overleaf", label: "focus", source: "app-db" }),
      segment({ day: 1, seconds: 120, domain: "youtube.com", title: "Video", label: "drift" }),
    ];
    const surfaces = aggregateSuggestionSurfaces(segments, WINDOW);
    expect(surfaces).toHaveLength(2);
    const paper = surfaces.find((surface) => surface.domain === "overleaf.com");
    expect(paper).toMatchObject({ minutes: 15, blocks: 2, days: 2, filedAs: "focus", reason: "Editing a paper", classifiedMinutes: 15, modelFiledMinutes: 10 });
  });

  it("skips short, excluded and out of window segments", () => {
    const surfaces = aggregateSuggestionSurfaces([
      segment({ seconds: 10, label: "focus" }),
      segment({ excluded: true, label: "focus" }),
      segment({ startedAt: "2026-07-20T00:00:00.000Z", label: "focus" }),
      segment({ startedAt: "2026-07-12T23:59:00.000Z", label: "focus" }),
    ], WINDOW);
    expect(surfaces).toEqual([]);
  });

  it("marks unclassified activity", () => {
    const [surface] = aggregateSuggestionSurfaces([segment({ title: "Untouched" })], WINDOW);
    expect(surface.filedAs).toBe("unclassified");
    expect(surface.classifiedMinutes).toBe(0);
  });
});

describe("detectSuggestionClusters", () => {
  const work = repeat(6, (index) => segment({ day: index % 3, seconds: 600, domain: "overleaf.com", title: "Draft " + index, label: "focus", reason: "Editing a paper" }));

  it("skips a place the classifier already files consistently and confidently", () => {
    expect(detectSuggestionClusters(aggregateSuggestionSurfaces(work, WINDOW))).toEqual([]);
    const [settled] = detectSuggestionClusters(aggregateSuggestionSurfaces(work, WINDOW), { includeSettled: true });
    expect(settled).toMatchObject({ kind: "work", signal: "settled", app: "Aside", domain: "overleaf.com", minutes: 60, days: 3, modelFiledShare: 1, dominantShare: 1, meanModelConfidence: 0.9 });
  });

  it("proposes a place the classifier was unsure about", () => {
    const unsure = repeat(6, (index) => segment({ day: index % 3, domain: "notes.example.com", title: "Note " + index, label: "focus", confidence: 0.55 }));
    const [cluster] = detectSuggestionClusters(aggregateSuggestionSurfaces(unsure, WINDOW));
    expect(cluster).toMatchObject({ kind: "work", signal: "uncertain", meanModelConfidence: 0.55 });
  });

  it("treats a real opposing share as contested but a sliver of neutral as settled", () => {
    const contested = [
      ...repeat(5, (index) => segment({ day: index % 3, domain: "search.example.com", title: "Docs " + index, label: "focus" })),
      ...repeat(1, () => segment({ day: 1, seconds: 400, domain: "search.example.com", title: "Shopping", label: "drift" })),
    ];
    const [cluster] = detectSuggestionClusters(aggregateSuggestionSurfaces(contested, WINDOW));
    expect(cluster).toMatchObject({ kind: "work", signal: "mixed" });
    // Contrast evidence: the drift row is shown even though it is smaller than every work row.
    expect(cluster.evidence.map((row) => row.filedAs)).toContain("drift");
    const neutralSliver = [
      ...repeat(5, (index) => segment({ day: index % 3, domain: "video.example.com", title: "Movie " + index, label: "drift" })),
      segment({ day: 1, seconds: 300, domain: "video.example.com", title: "Trailer", label: "neutral" }),
    ];
    expect(detectSuggestionClusters(aggregateSuggestionSurfaces(neutralSliver, WINDOW))).toEqual([]);
  });

  it("ignores activity the registry already files, too little time and too few days", () => {
    const registry = repeat(6, (index) => segment({ day: index % 3, domain: "docs.example.com", title: "Doc " + index, label: "focus", source: "app-db" }));
    const brief = repeat(2, () => segment({ day: 0, seconds: 300, domain: "brief.example.com", label: "focus" }));
    const oneDay = repeat(6, (index) => segment({ day: 0, domain: "oneday.example.com", title: "Only " + index, label: "focus" }));
    expect(detectSuggestionClusters(aggregateSuggestionSurfaces([...registry, ...brief, ...oneDay], WINDOW))).toEqual([]);
  });

  it("flags a place filed both as work and as drift, even when the registry filed part of it", () => {
    const mixed = [
      ...repeat(3, (index) => segment({ day: index, domain: "video.example.com", title: "Lecture " + index, label: "focus", source: "app-db" })),
      ...repeat(3, (index) => segment({ day: index, domain: "video.example.com", title: "Clip " + index, label: "drift", source: "app-db" })),
    ];
    const [cluster] = detectSuggestionClusters(aggregateSuggestionSurfaces(mixed, WINDOW));
    expect(cluster).toMatchObject({ kind: "ambiguous", domain: "video.example.com" });
  });

  it("skips neutral places and caps the number of clusters by minutes", () => {
    const neutral = repeat(6, (index) => segment({ day: index % 3, domain: "mail.example.com", title: "Inbox " + index, label: "neutral" }));
    const many = Array.from({ length: 10 }, (_, site) => repeat(4, (index) => segment({ day: index % 2, seconds: 400 + site * 20, domain: "site" + site + ".example.com", title: "T" + index, label: "drift" }))).flat();
    const clusters = detectSuggestionClusters(aggregateSuggestionSurfaces([...neutral, ...many], WINDOW), { maxClusters: 3, includeSettled: true });
    expect(clusters).toHaveLength(3);
    expect(clusters.every((cluster) => cluster.kind === "drift")).toBe(true);
    expect(clusters[0].minutes).toBeGreaterThanOrEqual(clusters[1].minutes);
  });
});

function cluster(overrides: Partial<SuggestionCluster> = {}): SuggestionCluster {
  return {
    key: "Aside|overleaf.com", app: "Aside", domain: "overleaf.com", kind: "work", minutes: 60, days: 3, blocks: 6,
    productivityMinutes: { focus: 60, neutral: 0, drift: 0 }, modelFiledShare: 1,
    evidence: [{ title: "Fast Diffusion Denoised Smoothing - Project search", minutes: 30, blocks: 3, days: 2, filedAs: "focus", reason: "Editing a paper" }],
    ...overrides,
  };
}

describe("buildSuggestionPrompt", () => {
  it("includes titles only when both title settings are on", () => {
    const both = buildSuggestionPrompt(cluster(), "ko", { windowTitle: true, contentContext: true });
    expect(both).toContain("Fast Diffusion Denoised Smoothing");
    expect(both).toContain("Aside / overleaf.com");
    for (const privacy of [{ windowTitle: false, contentContext: true }, { windowTitle: true, contentContext: false }]) {
      const prompt = buildSuggestionPrompt(cluster(), "ko", privacy);
      expect(prompt).not.toContain("Fast Diffusion");
      expect(prompt).toContain("Aside / overleaf.com");
    }
  });

  it("asks for generalization and forbids persona and sensitive inference in both languages", () => {
    const ko = buildSuggestionPrompt(cluster(), "ko", { windowTitle: true, contentContext: true });
    const en = buildSuggestionPrompt(cluster(), "en", { windowTitle: true, contentContext: true });
    expect(ko).toContain("민감한 주제");
    expect(ko).toContain("직업이나 신분을 추측하지");
    expect(en).toContain("sensitive topics");
    expect(en).toContain("guess the user's job");
    expect(en).toContain("Output JSON only");
  });
});

describe("validateSuggestionSummary", () => {
  const ok = "논문 초안과 그림 작업을 하는 연구용 편집 활동은 업무로 봐요.";

  it("accepts a short generalized sentence", () => {
    expect(validateSuggestionSummary(ok, cluster(), "ko")).toEqual({ ok: true, summary: ok });
    expect(validateSuggestionSummary("Editing research papers online counts as work.", cluster(), "en")).toMatchObject({ ok: true });
  });

  it.each([
    [42, "invalid_shape"],
    ["짧음", "length"],
    ["가".repeat(91), "length"],
    ["논문 초안을 쓰는 편집 활동은 업무로 분류합니다.", "style"],
    ["This is written in English only but asked in Korean.", "language"],
    ["논문 작성 도구 https://example.com 는 업무예요.", "contains_link"],
    ["직장인으로서 논문 초안을 쓰는 활동은 업무로 봐요.", "persona_claim"],
    ["선거 관련 콘텐츠를 보는 시청 활동은 방해로 봐요.", "sensitive_topic"],
  ] as const)("rejects %j as %s", (value, reason) => {
    expect(validateSuggestionSummary(value, cluster(), "ko")).toEqual({ ok: false, reason });
  });

  it("rejects sentences about the user and ambiguous sentences without a deciding criterion", () => {
    expect(validateSuggestionSummary("사용자가 소셜 미디어에서 콘텐츠를 확인하며 시간을 보냈습니다.", cluster(), "ko")).toEqual({ ok: false, reason: "describes_user" });
    expect(validateSuggestionSummary("The user browses social media pages during the week.", cluster(), "en")).toEqual({ ok: false, reason: "describes_user" });
    const mixed = cluster({ kind: "ambiguous" });
    expect(validateSuggestionSummary("소셜 미디어 활동이 여러 날에 걸쳐 나타났습니다 정말로요.", mixed, "ko")).toEqual({ ok: false, reason: "no_criterion" });
    expect(validateSuggestionSummary("소셜 미디어는 작업 자료를 찾는 경우 업무로, 그 밖에는 방해로 봐요.", mixed, "ko")).toMatchObject({ ok: true });
    expect(validateSuggestionSummary("Video pages count as work when they teach a tool and as distraction otherwise.", mixed, "en")).toMatchObject({ ok: true });
  });

  it("rejects English persona, sensitive and wrong language output", () => {
    expect(validateSuggestionSummary("As a developer the user edits papers online daily.", cluster(), "en")).toEqual({ ok: false, reason: "persona_claim" });
    expect(validateSuggestionSummary("Watching election videos online counts as distraction.", cluster(), "en")).toEqual({ ok: false, reason: "sensitive_topic" });
    expect(validateSuggestionSummary("논문 초안을 쓰는 활동은 업무로 봐요 정말로요.", cluster(), "en")).toEqual({ ok: false, reason: "language" });
  });

  it("rejects quoted title content but allows the app and site names", () => {
    expect(validateSuggestionSummary("Fast Diffusion Denoised Smoothing 작업은 업무로 봐요.", cluster(), "ko")).toEqual({ ok: false, reason: "quotes_title" });
    const titled = cluster({ evidence: [{ title: "Aside - overleaf.com project", minutes: 30, blocks: 3, days: 2, filedAs: "focus", reason: "" }] });
    expect(validateSuggestionSummary("Aside 에서 overleaf.com 으로 논문을 쓰는 활동은 업무로 봐요.", titled, "ko")).toMatchObject({ ok: true });
  });
});

describe("parseSuggestionResponse", () => {
  it("reads the summary from plain or fenced JSON and rejects anything else", () => {
    expect(parseSuggestionResponse('{"summary":"문장"}')).toBe("문장");
    expect(parseSuggestionResponse('```json\n{"summary":"문장"}\n```')).toBe("문장");
    expect(parseSuggestionResponse("not json")).toBeUndefined();
    expect(parseSuggestionResponse('{"summary":')).toBeUndefined();
    expect(parseSuggestionResponse(null)).toBeUndefined();
  });
});

describe("generateMemorySuggestions", () => {
  const privacy = { windowTitle: true, contentContext: true };
  const first = cluster({ key: "A|a.com", domain: "a.com" });
  const second = cluster({ key: "A|b.com", domain: "b.com", kind: "drift" });
  const third = cluster({ key: "A|c.com", domain: "c.com", kind: "ambiguous" });

  it("keeps valid sentences, records why others were dropped and never aborts the batch", async () => {
    const answers: (string | Error | null)[] = [
      '{"summary":"논문 초안과 그림 작업을 하는 연구용 편집 활동은 업무로 봐요."}',
      new Error("provider down"),
      '{"summary":"선거 관련 콘텐츠를 보는 시청 활동은 방해로 봐요."}',
    ];
    const complete = vi.fn(async () => {
      const answer = answers.shift() ?? null;
      if (answer instanceof Error) throw answer;
      return answer;
    });
    const result = await generateMemorySuggestions({ clusters: [first, second, third], language: "ko", privacy, complete, verify: false });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(result.suggestions.map((suggestion) => [suggestion.id, suggestion.kind])).toEqual([["work:A|a.com", "work"]]);
    expect(result.rejected).toEqual([
      { key: "A|b.com", reason: "no_response" },
      { key: "A|c.com", reason: "sensitive_topic" },
    ]);
  });

  it("drops a sentence that repeats an existing memory or an earlier suggestion", async () => {
    const sentence = "논문 초안과 그림 작업을 하는 연구용 편집 활동은 업무로 봐요.";
    const complete = vi.fn(async () => JSON.stringify({ summary: sentence }));
    const existing = await generateMemorySuggestions({ clusters: [first], language: "ko", privacy, existingSummaries: ["논문 초안과 그림 작업을 하는 연구용 편집 활동은 업무로 봐요"], complete, verify: false });
    expect(existing.suggestions).toEqual([]);
    expect(existing.rejected).toEqual([{ key: "A|a.com", reason: "duplicate" }]);
    const repeated = await generateMemorySuggestions({ clusters: [first, second], language: "ko", privacy, complete, verify: false });
    expect(repeated.suggestions).toHaveLength(1);
    expect(repeated.rejected).toEqual([{ key: "A|b.com", reason: "duplicate" }]);
  });

  it("passes the structured cluster and title permission to the provider", async () => {
    const seen: { key: string; language: string; showTitles: boolean }[] = [];
    await generateMemorySuggestions({
      clusters: [first], language: "en", privacy: { windowTitle: true, contentContext: false },
      complete: async (request) => { seen.push({ key: request.cluster.key, language: request.language, showTitles: request.showTitles }); return null; },
    });
    expect(seen).toEqual([{ key: "A|a.com", language: "en", showTitles: false }]);
  });

  it("sends no title when the privacy settings forbid it", async () => {
    const prompts: string[] = [];
    await generateMemorySuggestions({
      clusters: [first], language: "ko", privacy: { windowTitle: false, contentContext: true },
      complete: async (request) => { prompts.push(request.prompt); return null; },
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("Fast Diffusion");
  });
});


describe("skipping and verification", () => {
  const privacy = { windowTitle: true, contentContext: true };
  const mixed = cluster({
    key: "A|v.com", domain: "v.com", kind: "ambiguous", signal: "mixed",
    productivityMinutes: { focus: 30, neutral: 0, drift: 30 },
    evidence: [
      { title: "Lecture on profiling tools", minutes: 20, blocks: 2, days: 2, filedAs: "focus", reason: "" },
      { title: "Cooking show", minutes: 20, blocks: 2, days: 2, filedAs: "drift", reason: "" },
      { title: "Debugging walkthrough", minutes: 10, blocks: 1, days: 1, filedAs: "focus", reason: "" },
      { title: "Music video", minutes: 10, blocks: 1, days: 1, filedAs: "drift", reason: "" },
    ],
  });
  const rule = "Videos that teach a tool count as work, entertainment videos count as distraction.";

  it("reads a deliberate skip", () => {
    expect(parseSuggestionResponse('{"skip":true}')).toBe(SUGGESTION_SKIPPED);
    expect(parseSuggestionResponse('{"summary":"","skip":true}')).toBe(SUGGESTION_SKIPPED);
    expect(parseSuggestionResponse('{"summary":"text","skip":true}')).toBe("text");
  });

  it("scores a verification by minutes and requires both sides for a mixed place", () => {
    expect(scoreSuggestionVerification(mixed, '{"labels":["work","distraction","work","distraction"]}')).toBe(1);
    expect(scoreSuggestionVerification(mixed, '{"labels":["work","distraction","unsure","work"]}')).toBe(0.67);
    expect(scoreSuggestionVerification(mixed, '{"labels":["work","work","work","work"]}')).toBe(0);
    expect(scoreSuggestionVerification(mixed, '{"labels":["work"]}')).toBeNull();
    expect(scoreSuggestionVerification(mixed, "nope")).toBeNull();
  });

  it("keeps a rule only when applying it back reproduces the records", async () => {
    const calls: { verify: boolean; prompt: string }[] = [];
    const answer = (labels: string[]) => async (request: { verify?: { summary: string }; prompt: string }) => {
      calls.push({ verify: Boolean(request.verify), prompt: request.prompt });
      return request.verify ? JSON.stringify({ labels }) : JSON.stringify({ summary: rule });
    };
    const kept = await generateMemorySuggestions({ clusters: [mixed], language: "en", privacy, complete: answer(["work", "distraction", "work", "distraction"]) });
    expect(kept.suggestions.map((suggestion) => suggestion.summary)).toEqual([rule]);
    expect(calls.map((entry) => entry.verify)).toEqual([false, true]);
    expect(calls[1].prompt).toContain(JSON.stringify(rule));
    expect(calls[1].prompt).not.toContain("[work]");
    const dropped = await generateMemorySuggestions({ clusters: [mixed], language: "en", privacy, complete: answer(["work", "work", "distraction", "work"]) });
    expect(dropped.suggestions).toEqual([]);
    expect(dropped.rejected).toEqual([{ key: "A|v.com", reason: "unverified" }]);
  });

  it("records a skip without calling verification and drops rules it cannot check without titles", async () => {
    const skip = vi.fn(async () => '{"skip":true}');
    const skipped = await generateMemorySuggestions({ clusters: [mixed], language: "en", privacy, complete: skip });
    expect(skipped.rejected).toEqual([{ key: "A|v.com", reason: "skipped" }]);
    expect(skip).toHaveBeenCalledTimes(1);
    const hidden = vi.fn(async () => JSON.stringify({ summary: rule }));
    const unchecked = await generateMemorySuggestions({ clusters: [mixed], language: "en", privacy: { windowTitle: false, contentContext: true }, complete: hidden });
    expect(unchecked.rejected).toEqual([{ key: "A|v.com", reason: "unverified" }]);
    expect(hidden).toHaveBeenCalledTimes(1);
  });

  it("stops after two unreachable calls in a row", async () => {
    const down = vi.fn(async () => null);
    const clusters = ["a", "b", "c", "d"].map((name) => cluster({ key: "A|" + name, domain: name }));
    const result = await generateMemorySuggestions({ clusters, language: "en", privacy, complete: down });
    expect(down).toHaveBeenCalledTimes(2);
    expect(result.rejected.map((entry) => entry.reason)).toEqual(["no_response", "no_response"]);
  });
});
