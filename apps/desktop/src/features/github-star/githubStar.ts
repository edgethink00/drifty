import { invoke, isTauri } from "@tauri-apps/api/core";
import type { HourBucket } from "@drifty/domain";

/**
 * "Star Drifty on GitHub". Nothing shows until GitHub reports the repository
 * as public, so the ask turns itself on when the repository opens, with no app
 * release. Two places, as Dayflow does it plus a standing link:
 * - a card in the main window's corner, once, for someone who came back to
 *   Drifty after the first day, on a day nothing went wrong, never on an
 *   organization's seat;
 * - a GitHub row under Community in the Settings sidebar, for anyone on a
 *   personal plan, starred or not.
 */
export const GITHUB_REPOSITORY = "edgethink00/drifty";
export const GITHUB_REPOSITORY_URL = `https://github.com/${GITHUB_REPOSITORY}`;

export type GitHubStarPlacement = "corner" | "settings";
export type GitHubStarState = "starred" | "not_starred" | "unavailable";

export type GitHubStarAvailability = {
  readonly public: boolean;
  readonly stars: number | null;
  /** "unavailable" means no usable gh: the button opens GitHub in the browser. */
  readonly star: GitHubStarState;
};

/** Local history only; never leaves the computer. */
export type GitHubStarUsage = {
  readonly trackedSeconds: number;
};

/** Dayflow asks once the first timeline exists. Drifty shows a day from its first run,
    so the card waits for the person to come back on a later day... */
export const MIN_DAYS_SINCE_FIRST_RUN = 1;
/** ...with at least an hour on record, so the title has hours to name. */
export const MIN_TRACKED_SECONDS = 3_600;

const DONE_KEY = "drifty.githubStar.done";
const PROBLEM_DAY_KEY = "drifty.githubStar.problemDay";
const FIRST_RUN_KEY = "drifty.githubStar.firstRun";
const DAY_MS = 86_400_000;

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* session only */ }
}

export function isGitHubStarDone(): boolean {
  return readStorage(DONE_KEY) === "1";
}
export function markGitHubStarDone(): void {
  writeStorage(DONE_KEY, "1");
}

/** Whole days since this build first checked, starting the clock on the first call. */
export function daysSinceFirstRun(now: Date): number {
  const stored = Date.parse(readStorage(FIRST_RUN_KEY) ?? "");
  if (Number.isNaN(stored)) {
    writeStorage(FIRST_RUN_KEY, now.toISOString());
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - stored) / DAY_MS));
}

export function localDayKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
/** A day that had a recording or AI problem is not a day to ask. */
export function markGitHubStarProblemDay(now: Date): void {
  writeStorage(PROBLEM_DAY_KEY, localDayKey(now));
}
export function hadProblemToday(now: Date): boolean {
  return readStorage(PROBLEM_DAY_KEY) === localDayKey(now);
}

/** Total recorded time, from the tracker's hourly buckets. */
export function summarizeTrackedHistory(buckets: readonly Pick<HourBucket, "hour" | "totalSeconds">[]): GitHubStarUsage {
  let trackedSeconds = 0;
  for (const bucket of buckets) {
    if (!Number.isFinite(bucket.totalSeconds) || bucket.totalSeconds <= 0) continue;
    trackedSeconds += bucket.totalSeconds;
  }
  return { trackedSeconds };
}

export type StarCardInput = {
  readonly availability: GitHubStarAvailability | null;
  readonly usage: GitHubStarUsage | null;
  readonly daysSinceFirstRun: number;
  readonly done: boolean;
  readonly organizationSeat: boolean;
  readonly healthy: boolean;
  readonly problemToday: boolean;
};

/** Whether the corner card may ask. The app still holds it while another dialog is open. */
export function starCardDue(input: StarCardInput): boolean {
  const { availability, usage } = input;
  if (!availability?.public || availability.star === "starred") return false;
  if (input.done || input.organizationSeat || !input.healthy || input.problemToday) return false;
  if (input.daysSinceFirstRun < MIN_DAYS_SINCE_FIRST_RUN) return false;
  return usage !== null && usage.trackedSeconds >= MIN_TRACKED_SECONDS;
}

/** The Settings sidebar row: a standing link, so it stays after a star. */
export function settingsGitHubLinkShown(availability: GitHubStarAvailability | null, organizationSeat: boolean): boolean {
  return availability?.public === true && !organizationSeat;
}

export type GitHubStarPreview = {
  readonly availability: GitHubStarAvailability;
  readonly usage: GitHubStarUsage;
  readonly daysSinceFirstRun: number;
  readonly organizationSeat: boolean;
  readonly healthy: boolean;
};

/**
 * Browser review: ?githubStarPreview=gh|browser|starred|private, plus
 * githubStarDays=<days since first run>, githubStarSeat=org and githubStarHealthy=0 to check the gates.
 */
export function readGitHubStarPreview(): GitHubStarPreview | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("githubStarPreview");
  if (!mode) return null;
  const star: GitHubStarState = mode === "gh" ? "not_starred" : mode === "starred" ? "starred" : "unavailable";
  const days = Number(params.get("githubStarDays") ?? "12");
  return {
    availability: { public: mode !== "private", stars: 1284, star },
    usage: { trackedSeconds: 186 * 3600 },
    daysSinceFirstRun: Number.isFinite(days) ? days : 12,
    organizationSeat: params.get("githubStarSeat") === "org",
    healthy: params.get("githubStarHealthy") !== "0",
  };
}

export async function loadGitHubStarAvailability(): Promise<GitHubStarAvailability | null> {
  if (!isTauri()) return null;
  const repository = await invoke<{ public: boolean; stars: number | null }>("github_repository_status");
  if (!repository.public) return { public: false, stars: null, star: "unavailable" };
  const star = await invoke<GitHubStarState>("github_star_status").catch(() => "unavailable" as const);
  return { public: true, stars: repository.stars, star };
}

async function openRepositoryPage(): Promise<void> {
  if (!isTauri()) {
    window.open(GITHUB_REPOSITORY_URL, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(GITHUB_REPOSITORY_URL);
}

/** Stars through gh when it can; otherwise opens GitHub. Returns true when gh starred it. */
export async function starDriftyOnGitHub(useGh: boolean): Promise<boolean> {
  markGitHubStarDone();
  if (useGh && isTauri()) {
    const starred = await invoke<boolean>("github_star_repository").catch(() => false);
    if (starred) return true;
  }
  await openRepositoryPage();
  return false;
}

/** The Settings row: opens the repository page, like Community opens Discord. */
export async function openDriftyOnGitHub(): Promise<void> {
  await openRepositoryPage();
}

