/**
 * Dev-server design review only: ?driftyNote=1 shows the day note in one
 * candidate place, with fixture content. import.meta.env.DEV is false in
 * production builds, so this returns null there and every call site folds
 * away. Nothing here ships.
 *
 * Places on the day screen (above the timeline, the breakdown rail, on its
 * own day with a banner) and the sidebar foot card were reviewed and dropped
 * on 2026-10-11: the note does not live on Your Day.
 *
 * The note block is settled (2026-10-13): yesterday's highlights left and
 * today's right, a flame on today's lines for work that has run for days,
 * the thumbs and the copy pill under the cards at the right, lines changed or added
 * by hand. The page title stands alone (no line under
 * it). Above the note, the day's activity is Insights' Attention rhythm board
 * reused (settled 2026-10-13): productivity, category and, when the day has
 * project time, project rows, 30-minute cells over the app's 24-hour day, with
 * the app hover card on each cell. The board's panel is titled "시간대별 기록"
 * (section size, muted ink) with the less/more key at its right; the note has
 * no title, and yesterday's card carries its date beside its label (settled
 * 2026-10-13).
 */
export type DayNotePlace = "page" | "insights" | "moment";
export type DayNoteState = "ready" | "locked";
export type DayNotePreview = {
  readonly place: DayNotePlace;
  readonly state: DayNoteState;
};

export const DAY_NOTE_PLACES: readonly DayNotePlace[] = ["page", "insights", "moment"];

function pick<T extends string>(value: string | null, from: readonly T[], fallback: T): T {
  return (from as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

export function readDayNotePreview(): DayNotePreview | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("driftyNote") !== "1") return null;
  return {
    place: pick(params.get("notePlace"), DAY_NOTE_PLACES, "page"),
    state: params.get("noteState") === "locked" ? "locked" : "ready",
  };
}
