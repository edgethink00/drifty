import type { DailyProductivityPoint } from "../share/dailyProductivity";
import type { LeaderboardPeriod, LeaderboardRow, OwnLeaderboardEntry } from "./leaderboardService";

/**
 * Synthetic review fixture for the browser preview (`?lbFixture=review`).
 *
 * It exists so design reviews compare layouts on the same believable board:
 * 71 participants, the previewing member at #12 today, #29 over 7 days and #31
 * over 30 days, and a 30-day series whose totals match those rows. Optional
 * overrides cover edge states: `lbRank` (one rank for every period),
 * `lbCount` (participants), `lbJoined=0`, `lbName`.
 * Every name and number here is invented; nothing reads tracker data.
 *
 * '?lbFixture=live' instead replays a local snapshot of the public board
 * (public/.qa-captures/leaderboard-live.json, git-ignored, dev only) so a
 * review sees real names, photos and focus totals. 'lbMe' picks which 7-day
 * rank plays the member.
 */
export type LeaderboardPreviewScenario = {
  readonly participantCount: number;
  /** The 7-day rank; null when the member has not joined or has no rank yet. */
  readonly ownRank: number | null;
  /** Rank per period window; null when `ownRank` is null. */
  readonly ranks: Readonly<Record<LeaderboardPeriod, number>> | null;
  /** A joined member whose rank is not published for this window yet (`lbRank=none`). */
  readonly unranked: boolean;
  readonly displayName: string;
  /** Public profile fields the preview fills in; `lbBio=0` previews an empty profile. */
  readonly profile: { readonly bio: string; readonly websiteUrl: string; readonly githubUrl: string; readonly linkedinUrl: string; readonly avatarUrl?: string };
  /** Present only for '?lbFixture=live'. */
  readonly live?: LiveBoard;
  /** The live participant playing the member. */
  readonly livePublicId?: string;
};

type LiveRow = Omit<LeaderboardRow, "focus_seconds_7d" | "avatar_url"> & { readonly avatar_url: string | null };
type LiveBoard = {
  readonly fetchedAt: string;
  readonly periods: Readonly<Record<LeaderboardPeriod, readonly LiveRow[]>>;
  readonly profiles: Readonly<Record<string, { readonly bio: string; readonly website_url: string; readonly github_url: string; readonly linkedin_url: string }>>;
};

let liveBoardCache: LiveBoard | null | undefined;

/**
 * Dev preview only: leaving or rejoining in the preview flips this instead of
 * calling the server, so the whole flow can be clicked through. Null follows
 * the URL ('lbJoined').
 */
let previewJoinedOverride: boolean | null = null;
export function setLeaderboardPreviewParticipation(joined: boolean | null): void {
  previewJoinedOverride = joined;
}
/** Synchronous on purpose: every preview reader is synchronous, and this only runs in a dev preview. */
function readLiveBoard(): LiveBoard | null {
  if (liveBoardCache !== undefined) return liveBoardCache;
  liveBoardCache = null;
  if (typeof XMLHttpRequest === "undefined") return null;
  try {
    const request = new XMLHttpRequest();
    request.open("GET", "/.qa-captures/leaderboard-live.json", false);
    request.send();
    if (request.status === 200) liveBoardCache = JSON.parse(request.responseText) as LiveBoard;
  } catch {
    liveBoardCache = null;
  }
  return liveBoardCache;
}

const REVIEW_NAMES = [
  "haneul.dev", "mira_k", "Otter", "noel.park", "seojun92", "ashgrove", "lumen_07", "yuna.moon",
  "longhandle_overflow_example", "kai.t", "eunbi", "rowan", "jiho_lee", "sable", "minseo.k", "teo",
  "dahye", "felix_w", "suah", "ivo", "nari", "theo.kim", "haeun", "joon", "pia", "marlo", "seri.b",
  "dawon", "quill", "bram", "sohee", "juno", "lark", "yeji", "orin", "hyuk", "may.c", "ondine",
];
const REVIEW_NAME_SEEDS = ["fern", "jae", "solace", "rio", "hana", "ezra", "moss", "yoon"];

// Oldest first, ending today: the last seven days total 10h 28m (-33% vs the
// week before), and the trailing streak is four days.
const REVIEW_SERIES_MINUTES = [
  62, 0, 95, 120, 88, 74, 0, 110, 135, 96, 70, 82, 0, 90, 100, 64,
  105, 150, 128, 140, 160, 115, 142,
  130, 40, 0, 150, 165, 85, 58,
];

const TOP_RATIOS = [1, 0.917, 0.75, 0.706, 0.5, 0.476, 0.456, 0.433, 0.421, 0.42];
const PERIOD_TOP_MINUTES: Record<LeaderboardPeriod, number> = { daily: 252, weekly: 1_700, monthly: 7_200 };
const PERIOD_FLOOR_MINUTES: Record<LeaderboardPeriod, number> = { daily: 3, weekly: 15, monthly: 50 };
const PERIOD_RIVAL_GAP_MINUTES: Record<LeaderboardPeriod, number> = { daily: 4, weekly: 12, monthly: 40 };
const DEFAULT_RANKS: Record<LeaderboardPeriod, number> = { daily: 12, weekly: 29, monthly: 31 };

export function readLeaderboardPreviewScenario(search?: string): LeaderboardPreviewScenario | null {
  if (typeof window === "undefined" && search === undefined) return null;
  const params = new URLSearchParams(search ?? window.location.search);
  const fixture = params.get("lbFixture");
  if (fixture === "live") {
    const live = readLiveBoard();
    if (live) return readLiveScenario(live, params);
  }
  if (fixture !== "review" && fixture !== "live") return null;
  const participantCount = clampInteger(params.get("lbCount"), 1, 400, 71);
  const joined = previewJoinedOverride ?? params.get("lbJoined") !== "0";
  const unranked = joined && params.get("lbRank") === "none";
  const ranked = joined && !unranked;
  const explicitRank = params.get("lbRank");
  const ranks = !ranked
    ? null
    : explicitRank !== null
      ? sameRank(clampInteger(explicitRank, 1, participantCount, Math.min(29, participantCount)))
      : {
          daily: Math.min(DEFAULT_RANKS.daily, participantCount),
          weekly: Math.min(DEFAULT_RANKS.weekly, participantCount),
          monthly: Math.min(DEFAULT_RANKS.monthly, participantCount),
        };
  const ownRank = ranks ? ranks.weekly : null;
  const displayName = params.get("lbName")?.trim() || "Ari";
  const emptyProfile = params.get("lbBio") === "0";
  const profile = emptyProfile
    ? { bio: "", websiteUrl: "", githubUrl: "", linkedinUrl: "" }
    : { bio: "Designing calm tools. Deep work before noon.", websiteUrl: "ari.example", githubUrl: "github.com/ari-example", linkedinUrl: "" };
  return { participantCount, ownRank, ranks, unranked, displayName, profile };
}

function readLiveScenario(live: LiveBoard, params: URLSearchParams): LeaderboardPreviewScenario {
  const weekly = live.periods.weekly;
  const participantCount = weekly[0]?.participant_count ?? weekly.length;
  const joined = previewJoinedOverride ?? params.get("lbJoined") !== "0";
  // By default the member is the first participant below the podium with a photo and a bio, so the card shows a filled profile.
  const filled = weekly.find((row) => row.rank > 3 && row.avatar_url && row.public_id && live.profiles[row.public_id]?.bio);
  const meRank = clampInteger(params.get("lbMe"), 1, Math.max(1, weekly.length), filled?.rank ?? Math.min(28, weekly.length));
  const me = weekly[meRank - 1];
  const rankIn = (period: LeaderboardPeriod) => live.periods[period].find((row) => row.public_id === me?.public_id)?.rank ?? 0;
  const ranks = joined && me ? { daily: rankIn("daily"), weekly: rankIn("weekly"), monthly: rankIn("monthly") } : null;
  const extra = me?.public_id ? live.profiles[me.public_id] : undefined;
  const emptyProfile = params.get("lbBio") === "0";
  return {
    participantCount,
    ownRank: ranks ? ranks.weekly : null,
    ranks,
    unranked: false,
    displayName: me?.display_name ?? "Ari",
    profile: {
      bio: emptyProfile ? "" : extra?.bio ?? "",
      websiteUrl: emptyProfile ? "" : extra?.website_url ?? "",
      githubUrl: emptyProfile ? "" : extra?.github_url ?? "",
      linkedinUrl: emptyProfile ? "" : extra?.linkedin_url ?? "",
      avatarUrl: me?.avatar_url ?? "",
    },
    live,
    livePublicId: me?.public_id ?? undefined,
  };
}

/** Participants on the window's board; the live board reports it per window. */
export function previewScenarioParticipantCount(scenario: LeaderboardPreviewScenario, period: LeaderboardPeriod): number {
  const count = scenario.live?.periods[period][0]?.participant_count ?? scenario.participantCount;
  return liveMemberRemoved(scenario, period) ? Math.max(0, count - 1) : count;
}

/** A live member who is not joined is taken off the replayed board, as leaving does in production. */
function liveMemberRemoved(scenario: LeaderboardPreviewScenario, period: LeaderboardPeriod): boolean {
  return Boolean(scenario.live && scenario.ranks === null && scenario.livePublicId && scenario.live.periods[period].some((row) => row.public_id === scenario.livePublicId));
}

function liveOwnRow(scenario: LeaderboardPreviewScenario, period: LeaderboardPeriod): LiveRow | undefined {
  return scenario.live?.periods[period].find((row) => row.public_id === scenario.livePublicId);
}

function sameRank(rank: number): Record<LeaderboardPeriod, number> {
  return { daily: rank, weekly: rank, monthly: rank };
}

export function previewScenarioOwnRank(scenario: LeaderboardPreviewScenario, period: LeaderboardPeriod): number | null {
  // 0 marks a live member who is not on that window's board.
  return scenario.ranks && scenario.ranks[period] > 0 ? scenario.ranks[period] : null;
}

export function previewScenarioSeries(windowEndDay: string, scenario?: LeaderboardPreviewScenario | null): DailyProductivityPoint[] {
  const points: DailyProductivityPoint[] = [];
  const minutes = scenario?.live ? liveSeriesMinutes(scenario) : REVIEW_SERIES_MINUTES;
  const count = minutes.length;
  for (let index = 0; index < count; index += 1) {
    const date = new Date(`${windowEndDay}T12:00:00`);
    date.setDate(date.getDate() - (count - 1 - index));
    const focus = (minutes[index] ?? 0) * 60;
    points.push({ day: toDayKey(date), focus, drift: Math.round(focus * 0.18), neutral: 0 });
  }
  return points;
}

export function previewScenarioWeekFocusSeconds(scenario?: LeaderboardPreviewScenario | null): number {
  const minutes = scenario?.live ? liveSeriesMinutes(scenario) : REVIEW_SERIES_MINUTES;
  return minutes.slice(-7).reduce((sum, value) => sum + value * 60, 0);
}

/**
 * A believable 30-day series for the live member whose windows add up to the
 * board: today is the daily total, the last 7 days the weekly total and the
 * last 30 days the monthly total. The day-to-day shape is invented.
 */
function liveSeriesMinutes(scenario: LeaderboardPreviewScenario): number[] {
  const today = Math.round((liveOwnRow(scenario, "daily")?.focus_seconds ?? 0) / 60);
  const week = Math.max(today, Math.round((liveOwnRow(scenario, "weekly")?.focus_seconds ?? 0) / 60));
  const month = Math.max(week, Math.round((liveOwnRow(scenario, "monthly")?.focus_seconds ?? 0) / 60));
  const spread = (total: number, weights: readonly number[]) => {
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const values = weights.map((weight) => Math.floor((total * weight) / sum));
    values[values.length - 1] += total - values.reduce((a, b) => a + b, 0);
    return values;
  };
  const earlier = spread(month - week, [3, 0, 4, 5, 3, 4, 0, 5, 6, 4, 3, 4, 0, 4, 5, 3, 5, 6, 5, 6, 0, 5, 6]);
  const lastWeek = spread(week - today, [5, 0, 6, 7, 4, 6]);
  return [...earlier, ...lastWeek, today];
}

function ownSeriesMinutes(period: LeaderboardPeriod): number {
  const days = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
  return REVIEW_SERIES_MINUTES.slice(-days).reduce((sum, minutes) => sum + minutes, 0);
}

/** Focus minutes for every rank 1..participantCount, strictly decreasing. */
function scenarioCurve(scenario: LeaderboardPreviewScenario, period: LeaderboardPeriod): number[] {
  const count = scenario.participantCount;
  const top = PERIOD_TOP_MINUTES[period];
  const floor = PERIOD_FLOOR_MINUTES[period];
  const values: number[] = [];
  for (let rank = 1; rank <= Math.min(count, TOP_RATIOS.length); rank += 1) values.push(top * (TOP_RATIOS[rank - 1] ?? 0.42));
  const ownRank = previewScenarioOwnRank(scenario, period);
  const anchorRank = ownRank !== null && ownRank > TOP_RATIOS.length + 1 ? ownRank : null;
  const anchorValue = anchorRank === null ? null : Math.min(ownSeriesMinutes(period), (values[values.length - 1] ?? top) * 0.97);
  const geometric = (fromRank: number, fromValue: number, toRank: number, toValue: number) => {
    const steps = Math.max(1, toRank - fromRank);
    const ratio = Math.pow(Math.max(toValue, 1) / Math.max(fromValue, 1), 1 / steps);
    for (let rank = fromRank + 1; rank <= toRank; rank += 1) values.push(fromValue * Math.pow(ratio, rank - fromRank));
  };
  const lastTopRank = values.length;
  const lastTopValue = values[lastTopRank - 1] ?? top;
  if (count <= lastTopRank) return values.slice(0, count);
  if (anchorRank !== null && anchorValue !== null) {
    const rivalValue = Math.min(anchorValue + PERIOD_RIVAL_GAP_MINUTES[period], lastTopValue * 0.99);
    geometric(lastTopRank, lastTopValue, anchorRank - 1, rivalValue);
    values.push(anchorValue);
    if (count > anchorRank) geometric(anchorRank, anchorValue, count, Math.min(floor, anchorValue * 0.5));
  } else {
    geometric(lastTopRank, lastTopValue, count, floor);
  }
  return values.slice(0, count);
}

function scenarioName(rank: number, scenario: LeaderboardPreviewScenario, period: LeaderboardPeriod): string {
  if (previewScenarioOwnRank(scenario, period) === rank) return scenario.displayName;
  const named = REVIEW_NAMES[rank - 1];
  if (named) return named;
  return `${REVIEW_NAME_SEEDS[rank % REVIEW_NAME_SEEDS.length]}_${rank}`;
}

export function previewScenarioRows(scenario: LeaderboardPreviewScenario, period: LeaderboardPeriod, limit: number, windowEndDay: string): LeaderboardRow[] {
  if (scenario.live) {
    const removed = liveMemberRemoved(scenario, period);
    const rows = removed ? scenario.live.periods[period].filter((row) => row.public_id !== scenario.livePublicId) : scenario.live.periods[period];
    return rows.slice(0, limit).map((row, index) => ({
      ...row,
      rank: removed ? index + 1 : row.rank,
      participant_count: removed && typeof row.participant_count === "number" ? Math.max(0, row.participant_count - 1) : row.participant_count,
      avatar_url: row.avatar_url ?? "",
      focus_seconds_7d: row.focus_seconds,
    }));
  }
  const curve = scenarioCurve(scenario, period);
  const windowStart = new Date(`${windowEndDay}T12:00:00`);
  windowStart.setDate(windowStart.getDate() - (period === "daily" ? 0 : period === "weekly" ? 6 : 29));
  const rows: LeaderboardRow[] = [];
  for (let rank = 1; rank <= Math.min(limit, 100, scenario.participantCount); rank += 1) {
    const focus = Math.round((curve[rank - 1] ?? 1) * 60);
    rows.push({
      rank,
      participant_count: scenario.participantCount,
      public_id: `preview-${rank}`,
      display_name: scenarioName(rank, scenario, period),
      avatar_url: "",
      period,
      focus_seconds: focus,
      focus_seconds_7d: focus,
      window_start_date: toDayKey(windowStart),
      window_end_date: windowEndDay,
      updated_at: `${windowEndDay}T09:00:00`,
    });
  }
  return rows;
}

export function previewScenarioOwnFocusSeconds(scenario: LeaderboardPreviewScenario, period: LeaderboardPeriod): number | null {
  const ownRank = previewScenarioOwnRank(scenario, period);
  if (ownRank === null) return null;
  if (scenario.live) return liveOwnRow(scenario, period)?.focus_seconds ?? null;
  const curve = scenarioCurve(scenario, period);
  return Math.round((curve[ownRank - 1] ?? 0) * 60);
}

/** The own-entry RPC's answer for the preview, so every period's rank can be read like production. */
export function previewScenarioOwnEntry(scenario: LeaderboardPreviewScenario, period: LeaderboardPeriod, windowEndDay: string): OwnLeaderboardEntry | null {
  if (scenario.ranks === null && !scenario.unranked) return null;
  const focus = previewScenarioOwnFocusSeconds(scenario, period) ?? 0;
  const windowStart = new Date(`${windowEndDay}T12:00:00`);
  windowStart.setDate(windowStart.getDate() - (period === "daily" ? 0 : period === "weekly" ? 6 : 29));
  return {
    rank: previewScenarioOwnRank(scenario, period),
    participant_count: previewScenarioParticipantCount(scenario, period),
    display_name: scenario.displayName,
    period,
    focus_seconds: focus,
    focus_seconds_7d: focus,
    window_start_date: toDayKey(windowStart),
    window_end_date: windowEndDay,
    timezone: "UTC",
    opted_in: true,
    updated_at: `${windowEndDay}T09:00:00`,
    publicly_valid: true,
  };
}

function clampInteger(raw: string | null, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function toDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
