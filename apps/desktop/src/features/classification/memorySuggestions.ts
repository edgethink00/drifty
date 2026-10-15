import { activitySecondsWithinInterval, activityTimeBounds, aggregateDeviceElapsedTime, isExcludedSegment, isFailedForegroundCaptureSegment, type ActivitySegment, type ProductivityLabel } from "@drifty/domain";

/**
 * Suggested Memory: candidate patterns found in ordinary activity.
 *
 * Detection, evidence and validation are deterministic. A model only phrases one
 * sentence per candidate, and that sentence is rejected unless it passes the
 * checks below. Nothing here writes Soul.md; a suggestion becomes a learned
 * pattern only after the user confirms it.
 */

export type SuggestionKind = "work" | "drift" | "ambiguous";
export type SuggestionLanguage = "ko" | "en";

export type SuggestionEvidence = {
  readonly title: string;
  readonly minutes: number;
  readonly blocks: number;
  readonly days: number;
  readonly filedAs: ProductivityLabel | "unclassified";
  readonly reason: string;
};

export type SuggestionSurface = SuggestionEvidence & {
  readonly app: string;
  readonly domain: string;
  readonly productivityMinutes: Readonly<Record<ProductivityLabel, number>>;
  readonly modelFiledMinutes: number;
  readonly classifiedMinutes: number;
  /** Model confidence summed over model-filed seconds; divide by model-filed seconds for the mean. */
  readonly modelConfidenceSeconds?: number;
  /** Calendar days (UTC date) this surface was seen; a cluster counts the union. */
  readonly dayKeys: readonly string[];
};

export type SuggestionCluster = {
  readonly key: string;
  readonly app: string;
  readonly domain: string;
  readonly kind: SuggestionKind;
  readonly minutes: number;
  readonly days: number;
  readonly blocks: number;
  readonly productivityMinutes: Readonly<Record<ProductivityLabel, number>>;
  readonly modelFiledShare: number;
  readonly evidence: readonly SuggestionEvidence[];
  /**
   * Why this place is worth a memory: the classifier filed it both ways
   * (`mixed`), was unsure (`uncertain`), or is already consistent and
   * confident (`settled`, skipped unless explicitly requested).
   */
  readonly signal?: SuggestionSignal;
  /** Share of classified minutes under the dominant label. */
  readonly dominantShare?: number;
  /** Mean model confidence over model-filed minutes, or null when the registry filed everything. */
  readonly meanModelConfidence?: number | null;
};

export type SuggestionSignal = "mixed" | "uncertain" | "settled";

export type MemorySuggestion = {
  readonly id: string;
  readonly kind: SuggestionKind;
  readonly summary: string;
  readonly cluster: SuggestionCluster;
};

export type SuggestionRejection = {
  readonly key: string;
  readonly reason: SuggestionRejectReason;
};

export type SuggestionRejectReason =
  | "no_response"
  | "invalid_shape"
  | "length"
  | "style"
  | "language"
  | "contains_link"
  | "quotes_title"
  | "persona_claim"
  | "describes_user"
  | "no_criterion"
  | "sensitive_topic"
  | "duplicate"
  | "skipped"
  | "unverified";

export type SuggestionPrivacy = {
  readonly windowTitle: boolean;
  readonly contentContext: boolean;
};

export type SuggestionDetectionOptions = {
  readonly minMinutes: number;
  readonly minDays: number;
  readonly dominantShare: number;
  readonly minModelFiledShare: number;
  readonly maxClusters: number;
  readonly maxEvidence: number;
  /** Below this share of the dominant label the place counts as filed inconsistently. */
  readonly settledShare: number;
  /** Below this mean model confidence the place counts as uncertain. */
  readonly settledConfidence: number;
  /** Keep places the classifier already handles consistently and confidently. */
  readonly includeSettled: boolean;
};

export const DEFAULT_SUGGESTION_OPTIONS: SuggestionDetectionOptions = {
  minMinutes: 25,
  minDays: 2,
  dominantShare: 0.7,
  // Activity the registry already files by app or site has nothing new to remember.
  minModelFiledShare: 0.3,
  maxClusters: 8,
  maxEvidence: 6,
  settledShare: 0.9,
  settledConfidence: 0.8,
  includeSettled: false,
};

const MIN_SEGMENT_SECONDS = 15;
const MAX_TITLE_CHARS = 70;
const MODEL_FILED_SOURCES: ReadonlySet<string> = new Set(["llm", "ai_review"]);
// Browser tab suffixes that carry no content: audio and memory-usage notes.
const NOISE_PATTERNS: readonly RegExp[] = [
  /\s*[-–—]\s*(?:오디오 재생|Audio playing)/g,
  /\s*[-–—]\s*메모리 사용량[^-–—]*(?:\s*[-–—]\s*[\d.,]+\s*[KMGT]B)?/g,
  /\s*🔊/g,
];

/** Recorded elapsed time after the watermark, including crossing captures. */
export function trackedSecondsSince(segments: readonly ActivitySegment[], since: string, until?: string): number {
  const start = Date.parse(since);
  const end = until ? Date.parse(until) : Infinity;
  return suggestionSegments(segments).reduce((total, segment) => total + activitySecondsWithinInterval(segment, start, end), 0);
}

function suggestionSegments(segments: readonly ActivitySegment[]): ActivitySegment[] {
  return aggregateDeviceElapsedTime(segments.filter(segment => !isExcludedSegment(segment) && !isFailedForegroundCaptureSegment(segment)));
}

export function normalizeSuggestionTitle(value: string | null | undefined): string {
  let title = (value ?? "").trim();
  for (const pattern of NOISE_PATTERNS) title = title.replace(pattern, "");
  return title.replace(/\s+/g, " ").slice(0, MAX_TITLE_CHARS);
}

function localDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** Group a window of segments into app + site + title surfaces with their stored labels. */
export function aggregateSuggestionSurfaces(
  segments: readonly ActivitySegment[],
  window: { readonly since: string; readonly until: string },
): SuggestionSurface[] {
  type Accumulator = {
    app: string;
    domain: string;
    title: string;
    seconds: number;
    blocks: number;
    days: Set<string>;
    byLabel: Record<ProductivityLabel, number>;
    modelFiledSeconds: number;
    modelConfidenceSeconds: number;
    classifiedSeconds: number;
    reasons: Map<string, number>;
  };
  const surfaces = new Map<string, Accumulator>();
  const start = Date.parse(window.since);
  const end = Date.parse(window.until);
  for (const segment of suggestionSegments(segments)) {
    const seconds = activitySecondsWithinInterval(segment, start, end);
    if (seconds < MIN_SEGMENT_SECONDS) continue;
    const domain = segment.siteDomain?.trim() ?? "";
    const title = normalizeSuggestionTitle(segment.siteTitle || segment.youtubeTitle || segment.windowTitle);
    const key = [segment.appName, domain, title].join("\u0000");
    let surface = surfaces.get(key);
    if (!surface) {
      surface = {
        app: segment.appName, domain, title, seconds: 0, blocks: 0, days: new Set(),
        byLabel: { focus: 0, neutral: 0, drift: 0 }, modelFiledSeconds: 0, modelConfidenceSeconds: 0, classifiedSeconds: 0, reasons: new Map(),
      };
      surfaces.set(key, surface);
    }
    surface.seconds += seconds;
    surface.blocks += 1;
    surface.days.add(localDay(new Date(Math.max(start, activityTimeBounds(segment).start)).toISOString()));
    const classification = segment.classification;
    if (classification) {
      surface.byLabel[classification.productivity] += seconds;
      surface.classifiedSeconds += seconds;
      if (MODEL_FILED_SOURCES.has(classification.source)) {
        surface.modelFiledSeconds += seconds;
        const confidence = Number.isFinite(classification.confidence) ? Math.min(1, Math.max(0, classification.confidence)) : 0.5;
        surface.modelConfidenceSeconds += confidence * seconds;
      }
      const reason = classification.reason?.trim();
      if (reason) surface.reasons.set(reason.slice(0, 80), (surface.reasons.get(reason.slice(0, 80)) ?? 0) + 1);
    }
  }
  return [...surfaces.values()].map((surface) => {
    const filedAs = dominantLabel(surface.byLabel);
    const reason = [...surface.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return {
      app: surface.app,
      domain: surface.domain,
      title: surface.title,
      minutes: roundMinutes(surface.seconds),
      blocks: surface.blocks,
      days: surface.days.size,
      filedAs,
      reason,
      productivityMinutes: {
        focus: roundMinutes(surface.byLabel.focus),
        neutral: roundMinutes(surface.byLabel.neutral),
        drift: roundMinutes(surface.byLabel.drift),
      },
      modelFiledMinutes: roundMinutes(surface.modelFiledSeconds),
      classifiedMinutes: roundMinutes(surface.classifiedSeconds),
      modelConfidenceSeconds: surface.modelConfidenceSeconds / 60,
      dayKeys: [...surface.days].sort(),
    };
  });
}

function dominantLabel(byLabel: Record<ProductivityLabel, number>): ProductivityLabel | "unclassified" {
  const entries = (Object.entries(byLabel) as [ProductivityLabel, number][]).sort((a, b) => b[1] - a[1]);
  return entries[0] && entries[0][1] > 0 ? entries[0][0] : "unclassified";
}

function roundMinutes(seconds: number): number {
  return Math.round(seconds / 6) / 10;
}

/** Find app + site groups that recur and are worth turning into a memory. */
export function detectSuggestionClusters(
  surfaces: readonly SuggestionSurface[],
  overrides: Partial<SuggestionDetectionOptions> = {},
): SuggestionCluster[] {
  const options = { ...DEFAULT_SUGGESTION_OPTIONS, ...overrides };
  const groups = new Map<string, SuggestionSurface[]>();
  for (const surface of surfaces) {
    const key = surface.app + "|" + surface.domain;
    groups.set(key, [...(groups.get(key) ?? []), surface]);
  }
  const clusters: SuggestionCluster[] = [];
  for (const [key, members] of groups) {
    const minutes = sum(members.map((member) => member.minutes));
    const days = new Set(members.flatMap((member) => member.dayKeys)).size;
    if (minutes < options.minMinutes || days < options.minDays) continue;
    const productivityMinutes = {
      focus: sum(members.map((member) => member.productivityMinutes.focus)),
      neutral: sum(members.map((member) => member.productivityMinutes.neutral)),
      drift: sum(members.map((member) => member.productivityMinutes.drift)),
    };
    const classified = productivityMinutes.focus + productivityMinutes.neutral + productivityMinutes.drift;
    if (classified <= 0) continue;
    const modelFiledShare = sum(members.map((member) => member.modelFiledMinutes)) / classified;
    const kind = clusterKind(productivityMinutes, classified, options.dominantShare);
    if (!kind) continue;
    if (kind !== "ambiguous" && modelFiledShare < options.minModelFiledShare) continue;
    const dominantShare = Math.max(productivityMinutes.focus, productivityMinutes.neutral, productivityMinutes.drift) / classified;
    const modelMinutes = sum(members.map((member) => member.modelFiledMinutes));
    const confidenceMinutes = members.reduce((total, member) => total + (member.modelConfidenceSeconds ?? member.modelFiledMinutes * 0.5), 0);
    const meanModelConfidence = modelMinutes > 0 ? Math.min(1, Math.round(confidenceMinutes / modelMinutes * 100) / 100) : null;
    // Mixed means work and distraction genuinely compete: the opposing side holds a
    // real share. A sliver of neutral next to a dominant label is not a conflict.
    const opposing = productivityMinutes.focus >= productivityMinutes.drift ? productivityMinutes.drift : productivityMinutes.focus;
    const contested = opposing >= 5 && opposing / classified >= 1 - options.settledShare;
    const signal: SuggestionSignal = kind === "ambiguous" || contested
      ? "mixed"
      : meanModelConfidence !== null && meanModelConfidence < options.settledConfidence ? "uncertain" : "settled";
    if (signal === "settled" && !options.includeSettled) continue;
    const evidence = pickEvidence(members, signal === "mixed", options.maxEvidence)
      .map(({ title, minutes: rowMinutes, blocks, days: rowDays, filedAs, reason }) => ({
        title, minutes: rowMinutes, blocks, days: rowDays, filedAs, reason,
      }));
    clusters.push({
      key, app: members[0].app, domain: members[0].domain, kind, minutes, days,
      blocks: sum(members.map((member) => member.blocks)), productivityMinutes, modelFiledShare, evidence,
      signal, dominantShare: Math.round(dominantShare * 100) / 100, meanModelConfidence,
    });
  }
  return clusters.sort((a, b) => b.minutes - a.minutes).slice(0, options.maxClusters);
}

/** For a place filed both ways, show the largest rows from each side so the contrast is visible. */
function pickEvidence(members: readonly SuggestionSurface[], contrast: boolean, limit: number): SuggestionSurface[] {
  const byMinutes = [...members].sort((a, b) => b.minutes - a.minutes);
  if (!contrast) return byMinutes.slice(0, limit);
  const sides = (["focus", "drift", "neutral"] as const).map((label) => byMinutes.filter((member) => member.filedAs === label));
  const picked: SuggestionSurface[] = [];
  for (let round = 0; picked.length < limit && round < limit; round += 1) {
    for (const side of sides) if (side[round] && picked.length < limit) picked.push(side[round]);
  }
  return picked.sort((a, b) => b.minutes - a.minutes);
}

function clusterKind(
  minutes: Readonly<Record<ProductivityLabel, number>>,
  classified: number,
  dominantShare: number,
): SuggestionKind | null {
  if (minutes.focus / classified >= dominantShare) return "work";
  if (minutes.drift / classified >= dominantShare) return "drift";
  if (minutes.neutral / classified >= dominantShare) return null;
  // Both sides carry real weight: the same place is filed as work and as drift.
  const bothSides = minutes.focus >= 10 && minutes.drift >= 10
    && minutes.focus / classified >= 0.15 && minutes.drift / classified >= 0.15;
  return bothSides ? "ambiguous" : null;
}

function sum(values: readonly number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 10) / 10;
}

/** Titles reach a provider only when both title settings allow them, as in classification. */
export function suggestionShowsTitles(privacy: SuggestionPrivacy): boolean {
  return privacy.windowTitle && privacy.contentContext;
}

export function buildSuggestionPrompt(
  cluster: SuggestionCluster,
  language: SuggestionLanguage,
  privacy: SuggestionPrivacy,
): string {
  const showTitles = suggestionShowsTitles(privacy);
  const place = cluster.domain ? cluster.app + " / " + cluster.domain : cluster.app;
  const ko = language === "ko";
  const label = (filedAs: string) => ko
    ? ({ focus: "업무", neutral: "중립", drift: "방해", unclassified: "미분류" } as Record<string, string>)[filedAs] ?? filedAs
    : ({ focus: "work", neutral: "neutral", drift: "distraction", unclassified: "unclassified" } as Record<string, string>)[filedAs] ?? filedAs;
  const minutes = cluster.productivityMinutes;
  const split = ko
    ? "업무 " + Math.round(minutes.focus) + "분, 중립 " + Math.round(minutes.neutral) + "분, 방해 " + Math.round(minutes.drift) + "분"
    : Math.round(minutes.focus) + " min work, " + Math.round(minutes.neutral) + " min neutral, " + Math.round(minutes.drift) + " min distraction";
  const why = cluster.signal === "uncertain"
    ? (ko ? "분류기가 이곳을 확신하지 못했습니다" : "The classifier was unsure about this place")
      + (cluster.meanModelConfidence !== null && cluster.meanModelConfidence !== undefined ? " (" + (ko ? "평균 신뢰도 " : "mean confidence ") + cluster.meanModelConfidence + ")" : "") + "."
    : ko ? "분류기가 이곳을 서로 다르게 분류했습니다." : "The classifier filed this place in different ways.";
  const rows = showTitles
    ? cluster.evidence.map((row) => {
      const note = row.reason ? " · " + row.reason.slice(0, 40) : "";
      return '- [' + label(row.filedAs) + '] "' + row.title + '" (' + Math.round(row.minutes) + (ko ? "분)" : " min)") + note;
    })
    : [];
  if (ko) {
    return [
      "Drifty 분류기가 틀리거나 망설이는 곳에만 기억을 남깁니다.",
      '장소: "' + place + '" · 최근 한 주 ' + cluster.days + "일 · " + split + ".",
      why,
      ...(rows.length > 0 ? ["기록 (기존 분류, 제목, 시간):", ...rows] : ["제목은 개인정보 설정 때문에 볼 수 없습니다."]),
      "",
      "새로운 활동이 이 장소에서 나왔을 때 업무인지 방해인지 판단을 돕는 규칙 한 문장을 한국어로 쓰세요.",
      "- 60자 안팎의 짧은 해요체 한 문장으로 쓰세요. 형식 예: 'A는 업무, B는 방해예요.'",
      "- 어떤 내용이나 맥락이면 업무이고 어떤 것이면 방해인지, 기록에서 실제로 보이는 구분을 쓰세요.",
      "- 앱이나 사이트 이름만으로 알 수 있는 뻔한 말(예: '이 편집기는 업무용입니다')은 쓰지 마세요.",
      "- 기록에서 분명하고 구체적인 구분이 보이지 않으면 문장을 쓰지 말고 건너뛰세요.",
      "- 제목이나 고유 이름을 그대로 인용하지 말고 내용의 종류로 일반화하세요. 사용자를 주어로 쓰지 마세요.",
      "- 사용자의 직업이나 신분을 추측하지 말고, 정치·종교·건강·성적 지향 같은 민감한 주제를 언급하지 마세요.",
      'JSON만 출력: {"summary":"..."} 또는 {"skip":true}',
    ].join("\n");
  }
  return [
    "Drifty keeps a memory only where its classifier is wrong or hesitant.",
    'Place: "' + place + '" · ' + cluster.days + " days in the last week · " + split + ".",
    why,
    ...(rows.length > 0 ? ["Records (filed as, title, time):", ...rows] : ["Titles are hidden by the privacy settings."]),
    "",
    "Write one rule that helps decide whether new activity at this place is work or distraction.",
    "- Keep it to one short, plain sentence of about 60 characters, for example 'A counts as work; B is a distraction.'",
    "- State which content or context counts as work and which as distraction, as the records actually show.",
    "- Do not write what the app or site name already says (for example 'this editor is for work').",
    "- If the records show no clear, specific distinction, skip instead of writing a sentence.",
    "- Do not quote titles or names; generalize the kind of content. Do not make the user the subject.",
    "- Do not guess the user's job or status, and do not mention sensitive topics such as politics, religion, health or sexual orientation.",
    'Output JSON only: {"summary":"..."} or {"skip":true}',
  ].join("\n");
}

const PERSONA_PATTERNS: readonly RegExp[] = [
  /직장인|회사원|학생으로서|개발자로서|사용자는\s*(?:학생|직장인|개발자|연구원|디자이너)/,
  /\bas an?\s+(?:employee|student|developer|engineer|researcher|designer|professional)\b/i,
  /\bthe user is an?\s+(?:employee|student|developer|engineer|researcher|designer)\b/i,
];

// A memory classifies activity; a sentence about the user ("the user browsed…") is not one.
const USER_SUBJECT_PATTERNS: readonly RegExp[] = [
  /^\s*(?:사용자|유저|본인)(?:가|는|의|이)/,
  /^\s*(?:the\s+user|user|you)\b/i,
];

// An ambiguous memory must say what decides the side: either a conditional, or
// a two-sided rule that names both a work side and a distraction side.
const TWO_SIDED_PATTERNS: readonly (readonly [RegExp, RegExp])[] = [
  [/업무|일/, /방해|여가|오락|개인/],
  [/\bwork\b/i, /\b(?:distraction|drift|leisure|personal)\b/i],
];
const CRITERION_PATTERNS: readonly RegExp[] = [
  /경우|때|따라|라면|이면|반면|그 밖|그렇지 않|이외|구분/,
  /\b(?:when|if|depending|unless|whereas|while|otherwise|except|only)\b/i,
];

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /정치|정당|선거|대통령|시위|음모론/,
  /종교|교회|성당|불교|기독교|이슬람/,
  /질병|질환|진단|우울|불안 장애|임신|병원/,
  /성적\s*지향|동성|성인\s*콘텐츠|포르노/,
  /인종|민족|국적/,
  /\b(?:politic\w*|election|conspira\w*|religio\w*|church|mosque|diagnos\w*|depress\w*|pregnan\w*|sexual orientation|porn\w*|ethnic\w*)\b/i,
];

// The prompt asks for about 60 characters; the cap leaves room without letting two-line rules through.
const MAX_SUMMARY_CHARS: Record<SuggestionLanguage, number> = { ko: 90, en: 130 };
const MIN_SUMMARY_CHARS = 12;
const QUOTE_LEAK_CHARS = 10;

export type SuggestionValidation =
  | { readonly ok: true; readonly summary: string }
  | { readonly ok: false; readonly reason: SuggestionRejectReason };

export function validateSuggestionSummary(
  value: unknown,
  cluster: SuggestionCluster,
  language: SuggestionLanguage,
): SuggestionValidation {
  if (typeof value !== "string") return { ok: false, reason: "invalid_shape" };
  const summary = value.replace(/\s+/g, " ").trim();
  if (summary.length < MIN_SUMMARY_CHARS || summary.length > MAX_SUMMARY_CHARS[language]) return { ok: false, reason: "length" };
  const hasHangul = /[가-힣]/.test(summary);
  if (language === "ko" ? !hasHangul : hasHangul) return { ok: false, reason: "language" };
  if (/https?:\/\/|www\.|\S+@\S+\.\S+/i.test(summary)) return { ok: false, reason: "contains_link" };
  if (USER_SUBJECT_PATTERNS.some((pattern) => pattern.test(summary))) return { ok: false, reason: "describes_user" };
  if (PERSONA_PATTERNS.some((pattern) => pattern.test(summary))) return { ok: false, reason: "persona_claim" };
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(summary))) return { ok: false, reason: "sensitive_topic" };
  if (quotesEvidenceTitle(summary, cluster)) return { ok: false, reason: "quotes_title" };
  const twoSided = TWO_SIDED_PATTERNS.some(([work, other]) => work.test(summary) && other.test(summary));
  if (cluster.kind === "ambiguous" && !twoSided && !CRITERION_PATTERNS.some((pattern) => pattern.test(summary))) {
    return { ok: false, reason: "no_criterion" };
  }
  // Korean memories read in the same polite voice as the rest of Memory ("…업무예요").
  if (language === "ko" && !/요[.!]?$/.test(summary)) return { ok: false, reason: "style" };
  return { ok: true, summary };
}

function quotesEvidenceTitle(summary: string, cluster: SuggestionCluster): boolean {
  const lowered = summary.toLocaleLowerCase();
  const names = [cluster.app, cluster.domain].filter(Boolean).map((name) => name.toLocaleLowerCase());
  for (const row of cluster.evidence) {
    let title = row.title.toLocaleLowerCase();
    // The app and site name may appear in the sentence; only the content may not.
    for (const name of names) title = title.split(name).join(" ");
    if (longestCommonSubstring(lowered, title) >= QUOTE_LEAK_CHARS) return true;
  }
  return false;
}

function longestCommonSubstring(a: string, b: string): number {
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

export const SUGGESTION_SKIPPED = Symbol("suggestion-skipped");

/** The summary text, SUGGESTION_SKIPPED when the model chose not to write one, or undefined. */
export function parseSuggestionResponse(response: string | null | undefined): unknown {
  if (!response) return undefined;
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed: unknown = JSON.parse(response.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as { summary?: unknown; skip?: unknown };
    if (record.skip === true && (record.summary === undefined || record.summary === null || record.summary === "")) return SUGGESTION_SKIPPED;
    return record.summary;
  } catch {
    return undefined;
  }
}

/**
 * Asks the model to apply a drafted rule to each record without seeing the
 * labels. Only used when titles are visible; a rule cannot be checked otherwise.
 */
export function buildSuggestionVerifyPrompt(cluster: SuggestionCluster, summary: string, language: SuggestionLanguage): string {
  const rows = cluster.evidence.map((row, index) => (index + 1) + '. "' + row.title + '"');
  if (language === "ko") {
    return [
      "아래 규칙만 보고 각 기록이 업무인지 방해인지 판단하세요. 규칙으로 판단할 수 없으면 unsure로 답하세요.",
      "규칙: " + JSON.stringify(summary),
      "기록:",
      ...rows,
      'JSON만 출력: {"labels":["work"|"distraction"|"unsure", ...]} (기록 순서대로 ' + rows.length + "개)",
    ].join("\n");
  }
  return [
    "Using only the rule below, decide whether each record is work or distraction. Answer unsure when the rule does not decide it.",
    "Rule: " + JSON.stringify(summary),
    "Records:",
    ...rows,
    'Output JSON only: {"labels":["work"|"distraction"|"unsure", ...]} (' + rows.length + " labels in record order)",
  ].join("\n");
}

export const MIN_VERIFIED_AGREEMENT = 0.75;

/**
 * Minutes-weighted share of work/distraction records the rule labels the way the
 * classifier did. For a mixed place the rule must also name both sides, or it is
 * only restating the dominant label.
 */
export function scoreSuggestionVerification(cluster: SuggestionCluster, response: string | null): number | null {
  if (!response) return null;
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let labels: unknown;
  try {
    labels = (JSON.parse(response.slice(start, end + 1)) as { labels?: unknown }).labels;
  } catch {
    return null;
  }
  if (!Array.isArray(labels) || labels.length !== cluster.evidence.length) return null;
  let decided = 0;
  let matched = 0;
  const predicted = new Set<string>();
  cluster.evidence.forEach((row, index) => {
    const label = labels[index];
    if (label === "work" || label === "distraction") predicted.add(label);
    if (row.filedAs !== "focus" && row.filedAs !== "drift") return;
    decided += row.minutes;
    if ((row.filedAs === "focus" && label === "work") || (row.filedAs === "drift" && label === "distraction")) matched += row.minutes;
  });
  if (decided <= 0) return null;
  if (cluster.signal === "mixed" && !(predicted.has("work") && predicted.has("distraction"))) return 0;
  return Math.round(matched / decided * 100) / 100;
}

export type GenerateSuggestionsInput = {
  readonly clusters: readonly SuggestionCluster[];
  readonly language: SuggestionLanguage;
  readonly privacy: SuggestionPrivacy;
  /** Existing memory sentences; a suggestion that repeats one is dropped. */
  readonly existingSummaries?: readonly string[];
  /** Apply each drafted rule back to its records and keep it only if it matches. Defaults to on. */
  readonly verify?: boolean;
  /** Local providers send `prompt`; Drifty Cloud sends the structured fields and builds its own prompt. */
  readonly complete: (request: SuggestionCompletionRequest) => Promise<string | null>;
};

export type SuggestionCompletionRequest = {
  readonly prompt: string;
  readonly cluster: SuggestionCluster;
  readonly language: SuggestionLanguage;
  readonly showTitles: boolean;
  /** Present on the second call, which applies a drafted rule back to the records. */
  readonly verify?: { readonly summary: string };
};

export type GenerateSuggestionsResult = {
  readonly suggestions: readonly MemorySuggestion[];
  readonly rejected: readonly SuggestionRejection[];
};

/** One model call per cluster, in order. A failed call rejects only that cluster. */
export async function generateMemorySuggestions(input: GenerateSuggestionsInput): Promise<GenerateSuggestionsResult> {
  const suggestions: MemorySuggestion[] = [];
  const rejected: SuggestionRejection[] = [];
  const seen = new Set((input.existingSummaries ?? []).map(normalizeForDuplicate));
  let consecutiveFailures = 0;
  for (const cluster of input.clusters) {
    let response: string | null = null;
    try {
      response = await input.complete({
        prompt: buildSuggestionPrompt(cluster, input.language, input.privacy),
        cluster, language: input.language, showTitles: suggestionShowsTitles(input.privacy),
      });
    } catch {
      response = null;
    }
    if (response === null) {
      rejected.push({ key: cluster.key, reason: "no_response" });
      // Two unreachable calls in a row: the provider is down, so stop spending calls.
      consecutiveFailures += 1;
      if (consecutiveFailures >= 2) break;
      continue;
    }
    consecutiveFailures = 0;
    const summary: unknown = parseSuggestionResponse(response);
    if (summary === SUGGESTION_SKIPPED) {
      rejected.push({ key: cluster.key, reason: "skipped" });
      continue;
    }
    const validation = validateSuggestionSummary(summary, cluster, input.language);
    if (!validation.ok) {
      rejected.push({ key: cluster.key, reason: validation.reason });
      continue;
    }
    if (input.verify !== false) {
      // Without titles there is nothing to check a content rule against.
      if (!suggestionShowsTitles(input.privacy)) {
        rejected.push({ key: cluster.key, reason: "unverified" });
        continue;
      }
      let check: string | null = null;
      try {
        check = await input.complete({
          prompt: buildSuggestionVerifyPrompt(cluster, validation.summary, input.language),
          cluster, language: input.language, showTitles: true, verify: { summary: validation.summary },
        });
      } catch {
        check = null;
      }
      if (check === null) {
        rejected.push({ key: cluster.key, reason: "no_response" });
        continue;
      }
      const agreement = scoreSuggestionVerification(cluster, check);
      if (agreement === null || agreement < MIN_VERIFIED_AGREEMENT) {
        rejected.push({ key: cluster.key, reason: "unverified" });
        continue;
      }
    }
    const normalized = normalizeForDuplicate(validation.summary);
    if (seen.has(normalized)) {
      rejected.push({ key: cluster.key, reason: "duplicate" });
      continue;
    }
    seen.add(normalized);
    suggestions.push({ id: cluster.kind + ":" + cluster.key, kind: cluster.kind, summary: validation.summary, cluster });
  }
  return { suggestions, rejected };
}

function normalizeForDuplicate(summary: string): string {
  return summary.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
