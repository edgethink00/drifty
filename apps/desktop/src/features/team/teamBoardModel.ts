import { isoWeekday, membersInContainer, previousWindow, type TeamFocusDataset, type TeamMemberCardModel, type TeamProjectShare, type TeamWindow } from "./teamFocusModel";
import type { TeamSharingVisibility } from "./teamSharingPolicy";

/**
 * The Dashboard tab (owner decision 2026-10-20): a board of widgets the
 * leaders of one scope (the organization, or a division or team) arrange for
 * themselves. The Overview stays the fixed page everyone opens; the board is
 * other views of the same shared data, never more of it. A standard board is
 * the same for every leader; each leader may also keep boards of their own.
 * Widgets sit on a four-column grid in fixed sizes, and a widget the scope
 * does not share enough for is left off the board without a word, as Rize
 * shows each seat only what it may see (owner decision 2026-10-20).
 */

/**
 * The first five make the standard board; the rest are added from the
 * gallery (owner request 2026-10-20), each grounded in a Rize widget or saved
 * Tracked Time view and drawn from data the team already shares: the project
 * timetable (Project Timetable), teams by project (Tracked Time rows Teams ×
 * columns Projects), the project ring (Project Pie Chart), project time by
 * person (Member Hours Bar Chart), time by person (Member Breakdown) and people
 * by project (rows Members × columns Projects).
 */
export const TEAM_BOARD_WIDGETS = ["numbers", "projectTrend", "projectRank", "teamCompare", "peopleWeek", "projectTable", "teamProjectTable", "projectDonut", "peopleBars", "peopleList", "peopleProjectTable"] as const;
export type TeamBoardWidgetId = (typeof TEAM_BOARD_WIDGETS)[number];

/** A widget's size in its grid's units: columns across by rows down, written "WxH". */
export type TeamBoardSizeId = string;

export function boardSpan(size: TeamBoardSizeId): { readonly w: number; readonly h: number } {
  const [w, h] = size.split("x").map(Number);
  return { w: w !== undefined && w > 0 ? w : 1, h: h !== undefined && h > 0 ? h : 1 };
}

/**
 * What a key-numbers tile may show; on a leader's own board each tile picks
 * one (owner request 2026-10-20, as Rize's Tracked Time tiles each switch
 * their metric). Focus and unassigned time (focus outside the team's
 * projects) show only where the team shares focus.
 */
export const TEAM_BOARD_METRICS = ["projectTime", "people", "topProject", "focus", "dailyAverage", "unassigned"] as const;
export type TeamBoardMetricId = (typeof TEAM_BOARD_METRICS)[number];
export const DEFAULT_TEAM_BOARD_METRICS: readonly TeamBoardMetricId[] = ["projectTime", "people", "topProject", "focus"];

export type TeamBoardItemOptions = {
  /** Key numbers: the tiles in order. */
  readonly metrics?: readonly TeamBoardMetricId[];
};

export type TeamBoardItem = {
  readonly key: string;
  readonly widget: TeamBoardWidgetId;
  readonly size: TeamBoardSizeId;
  readonly options?: TeamBoardItemOptions;
};

/** What a widget reads: the scope's totals, one person's figures, or the teams below. */
type TeamBoardNeed = "teamProjects" | "people" | "teams";

const TEAM_BOARD_NEEDS: Readonly<Record<TeamBoardWidgetId, TeamBoardNeed>> = {
  numbers: "teamProjects",
  projectTrend: "teamProjects",
  projectRank: "teamProjects",
  teamCompare: "teams",
  peopleWeek: "people",
  projectTable: "teamProjects",
  teamProjectTable: "teams",
  projectDonut: "teamProjects",
  peopleBars: "people",
  peopleList: "people",
  peopleProjectTable: "people",
};

/**
 * How the board divides the screen (decision under review, 2026-10-20): how
 * many columns across, how tall one row is, and the sizes each widget may
 * take in those units. Rows are calibrated to what each widget holds, measured
 * on the 1280px window: a card's frame and title take 52px, key numbers 65px
 * more, the day chart about 130px, the project list up to 180px, the people
 * table 30px plus 33px a person and the team list about 35px a team.
 */
export const TEAM_BOARD_GRID_IDS = ["calibrated", "current", "thirds", "twelfths", "screen", "auto"] as const;
export type TeamBoardGridId = (typeof TEAM_BOARD_GRID_IDS)[number];

export type TeamBoardRow =
  | { readonly kind: "fixed"; readonly rem: number }
  /** The window's height below the board's top split into this many rows (as Rize's dashboards fill one screen), never shorter than minRem. */
  | { readonly kind: "screen"; readonly rows: number; readonly minRem: number }
  /** Rows as tall as what their widgets hold; sizes then choose only the width. */
  | { readonly kind: "auto" };

type StandardLayout = readonly (readonly [TeamBoardWidgetId, TeamBoardSizeId])[];

export type TeamBoardGrid = {
  readonly id: TeamBoardGridId;
  readonly columns: number;
  readonly row: TeamBoardRow;
  /** Each widget's sizes, the usual one first. */
  readonly sizes: Readonly<Record<TeamBoardWidgetId, readonly TeamBoardSizeId[]>>;
  /** The standard board: where there are teams below, and inside one team. */
  readonly standard: (counts: { readonly teams: number; readonly people: number }) => { readonly teams: StandardLayout; readonly team: StandardLayout };
};

const FOUR_SIZES: TeamBoardGrid["sizes"] = {
  numbers: ["4x1", "2x2"],
  projectTrend: ["2x2", "4x2"],
  projectRank: ["2x2", "4x2"],
  teamCompare: ["4x2", "4x3"],
  peopleWeek: ["4x3", "4x2"],
  projectTable: ["4x3", "4x2"],
  teamProjectTable: ["4x3", "4x2"],
  projectDonut: ["2x2"],
  peopleBars: ["4x2", "2x2"],
  peopleList: ["2x3", "2x2"],
  peopleProjectTable: ["4x3", "4x2"],
};

/** Four columns: at 120px rows the list in a 4x2 holds five teams or five people, a 4x3 nine of either. */
function fourStandard(bigTeams: number, bigPeople: number): TeamBoardGrid["standard"] {
  return (counts) => ({
    teams: [["numbers", "4x1"], ["teamCompare", counts.teams > bigTeams ? "4x3" : "4x2"], ["projectTrend", "2x2"], ["projectRank", "2x2"]],
    team: [["numbers", "4x1"], ["projectTrend", "2x2"], ["projectRank", "2x2"], ["peopleWeek", counts.people > bigPeople ? "4x3" : "4x2"]],
  });
}

/**
 * Twelve columns of 32px rows: a list takes the fewest rows, in steps of two,
 * that hold its teams or people; how many 5, 7 and 9 rows hold.
 */
function twelfthsListSize(count: number, holds: readonly [number, number, number]): TeamBoardSizeId {
  if (count <= holds[0]) return "12x5";
  if (count <= holds[1]) return "12x7";
  if (count <= holds[2]) return "12x9";
  return "12x11";
}
const TWELFTHS_TEAMS = [4, 7, 9] as const;
const TWELFTHS_PEOPLE = [3, 6, 9] as const;

export const TEAM_BOARD_GRIDS: Readonly<Record<TeamBoardGridId, TeamBoardGrid>> = {
  // A: four columns, rows of 120px (7.5rem), the height key numbers need; a 2x2 holds the project list.
  calibrated: { id: "calibrated", columns: 4, row: { kind: "fixed", rem: 7.5 }, sizes: FOUR_SIZES, standard: fourStandard(5, 5) },
  // B: four columns, rows of 148px (9.25rem), as the draft was.
  current: { id: "current", columns: 4, row: { kind: "fixed", rem: 9.25 }, sizes: FOUR_SIZES, standard: fourStandard(7, 6) },
  // C: three columns, rows of 120px; the chart takes two thirds and the list one.
  thirds: {
    id: "thirds",
    columns: 3,
    row: { kind: "fixed", rem: 7.5 },
    sizes: {
      numbers: ["3x1", "1x2"],
      projectTrend: ["2x2", "3x2", "1x2"],
      projectRank: ["1x2", "2x2", "3x2"],
      teamCompare: ["3x2", "3x3"],
      peopleWeek: ["3x3", "3x2"],
      projectTable: ["3x3", "3x2"],
      teamProjectTable: ["3x3", "3x2"],
      projectDonut: ["1x2"],
      peopleBars: ["3x2", "2x2"],
      peopleList: ["1x3", "1x2"],
      peopleProjectTable: ["3x3", "3x2"],
    },
    standard: (counts) => ({
      teams: [["numbers", "3x1"], ["teamCompare", counts.teams > 5 ? "3x3" : "3x2"], ["projectTrend", "2x2"], ["projectRank", "1x2"]],
      team: [["numbers", "3x1"], ["projectTrend", "2x2"], ["projectRank", "1x2"], ["peopleWeek", counts.people > 5 ? "3x3" : "3x2"]],
    }),
  },
  // D: twelve columns of 32px rows (Datadog's dashboards use twelve columns; Grafana twenty-four of 30px rows):
  // halves, thirds and 7:5 splits, and lists as tall as their rows in 44px steps; three rows make A's 120px.
  twelfths: {
    id: "twelfths",
    columns: 12,
    row: { kind: "fixed", rem: 2 },
    sizes: {
      numbers: ["12x3", "6x6", "4x6"],
      projectTrend: ["7x6", "6x6", "8x6", "12x6"],
      projectRank: ["5x6", "4x6", "6x6", "12x6"],
      teamCompare: ["12x7", "12x5", "12x9", "12x11"],
      peopleWeek: ["12x9", "12x5", "12x7", "12x11"],
      projectTable: ["12x9", "12x7"],
      teamProjectTable: ["12x9", "12x7"],
      projectDonut: ["5x6", "6x6"],
      peopleBars: ["12x6", "6x6"],
      peopleList: ["5x9", "6x9"],
      peopleProjectTable: ["12x9", "12x7"],
    },
    standard: (counts) => ({
      teams: [["numbers", "12x3"], ["teamCompare", twelfthsListSize(counts.teams, TWELFTHS_TEAMS)], ["projectTrend", "7x6"], ["projectRank", "5x6"]],
      team: [["numbers", "12x3"], ["projectTrend", "7x6"], ["projectRank", "5x6"], ["peopleWeek", twelfthsListSize(counts.people, TWELFTHS_PEOPLE)]],
    }),
  },
  // E: four columns, the screen below the board's top split into five rows (124px at 1280×900, 153px at 1680×1050),
  // never under A's 120px; the standard board is those five rows, and its lists scroll inside.
  screen: {
    id: "screen",
    columns: 4,
    row: { kind: "screen", rows: 5, minRem: 7.5 },
    sizes: FOUR_SIZES,
    standard: () => ({
      teams: [["numbers", "4x1"], ["teamCompare", "4x2"], ["projectTrend", "2x2"], ["projectRank", "2x2"]],
      team: [["numbers", "4x1"], ["projectTrend", "2x2"], ["projectRank", "2x2"], ["peopleWeek", "4x2"]],
    }),
  },
  // F: four columns, rows as tall as their widgets up to a cap; a size is a width only.
  auto: {
    id: "auto",
    columns: 4,
    row: { kind: "auto" },
    sizes: {
      numbers: ["4x1", "2x1"],
      projectTrend: ["2x1", "4x1"],
      projectRank: ["2x1", "4x1"],
      teamCompare: ["4x1"],
      peopleWeek: ["4x1"],
      projectTable: ["4x1"],
      teamProjectTable: ["4x1"],
      projectDonut: ["2x1"],
      peopleBars: ["4x1", "2x1"],
      peopleList: ["2x1", "4x1"],
      peopleProjectTable: ["4x1"],
    },
    standard: () => ({
      teams: [["numbers", "4x1"], ["teamCompare", "4x1"], ["projectTrend", "2x1"], ["projectRank", "2x1"]],
      team: [["numbers", "4x1"], ["projectTrend", "2x1"], ["projectRank", "2x1"], ["peopleWeek", "4x1"]],
    }),
  },
};

/** One row's CSS height on a grid; a screen grid reads the height the board measured, as --team-board-fit-row. */
export function teamBoardRowCss(grid: TeamBoardGrid): string {
  if (grid.row.kind === "fixed") return String(grid.row.rem) + "rem";
  if (grid.row.kind === "auto") return "auto";
  const min = String(grid.row.minRem) + "rem";
  return "max(" + min + ", var(--team-board-fit-row, " + min + "))";
}

/** The narrowest widget a gap must hold to offer one. */
export function teamBoardMinWidth(grid: TeamBoardGrid): number {
  return Math.min(...Object.values(grid.sizes).flat().map((size) => boardSpan(size).w));
}

/**
 * Resizing by dragging (owner decision 2026-10-21): on the four-column grids
 * a widget's height is dragged a row at a time between its limits, as Rize's
 * widgets are, and a widget that reads well both half and full width is
 * dragged between those two, nothing between. Each entry maps a width to the
 * rows it may take, the usual width first: a table needs the full width (at
 * half width seven day columns get about 30px for a 60px figure), as do the
 * people bars (eight people's figures run together at half width), the ring
 * stays half width, and key numbers are a row across or two by two.
 */
const FOUR_RESIZE: Readonly<Record<TeamBoardWidgetId, Readonly<Record<number, readonly [number, number]>>>> = {
  numbers: { 4: [1, 1], 2: [2, 2] },
  projectTrend: { 2: [2, 3], 4: [2, 3] },
  projectRank: { 2: [2, 4], 4: [2, 4] },
  teamCompare: { 4: [2, 6], 2: [2, 6] },
  peopleWeek: { 4: [2, 6] },
  projectTable: { 4: [2, 6] },
  teamProjectTable: { 4: [2, 6] },
  projectDonut: { 2: [2, 2] },
  peopleBars: { 4: [2, 3] },
  peopleList: { 2: [2, 6], 4: [2, 6] },
  peopleProjectTable: { 4: [2, 6] },
};

export type TeamBoardResizeRule = {
  /** Widths it may take, the usual one first. */
  readonly widths: readonly number[];
  /** The rows it may take at a width. */
  readonly rows: (width: number) => readonly [number, number];
};

/** How a widget may be dragged to size on this grid; null where sizes are picked from a menu (grids other than four columns of fixed rows). */
export function teamBoardResizeRule(widget: TeamBoardWidgetId, grid: TeamBoardGrid): TeamBoardResizeRule | null {
  if (grid.columns !== 4 || grid.row.kind === "auto") return null;
  const table = FOUR_RESIZE[widget];
  const widths = Object.keys(table).map(Number);
  const usual = boardSpan(grid.sizes[widget][0]!).w;
  return {
    widths: [usual, ...widths.filter((width) => width !== usual)],
    rows: (width) => table[width] ?? table[usual]!,
  };
}

/** Whether a saved or chosen size fits the widget on this grid. */
export function teamBoardSizeAllowed(widget: TeamBoardWidgetId, size: TeamBoardSizeId, grid: TeamBoardGrid): boolean {
  const rule = teamBoardResizeRule(widget, grid);
  if (!rule) return grid.sizes[widget].includes(size);
  const { w, h } = boardSpan(size);
  if (!rule.widths.includes(w) || size !== String(w) + "x" + String(h)) return false;
  const [min, max] = rule.rows(w);
  return h >= min && h <= max;
}

/**
 * The size a drag lands on: the allowed width nearest the pointer's and the
 * rows clamped to that width's limits. Widths and rows may be fractions of a
 * column or row, as the pointer is between them.
 */
export function snapTeamBoardSize(widget: TeamBoardWidgetId, width: number, height: number, grid: TeamBoardGrid): TeamBoardSizeId | null {
  const rule = teamBoardResizeRule(widget, grid);
  if (!rule) return null;
  const w = [...rule.widths].sort((left, right) => Math.abs(left - width) - Math.abs(right - width))[0]!;
  const [min, max] = rule.rows(w);
  const h = Math.min(max, Math.max(min, Math.round(height)));
  return String(w) + "x" + String(h);
}

/** A keyboard step: a row taller or shorter, or the other allowed width. */
export function stepTeamBoardSize(widget: TeamBoardWidgetId, size: TeamBoardSizeId, axis: "width" | "height", step: -1 | 1, grid: TeamBoardGrid): TeamBoardSizeId {
  const rule = teamBoardResizeRule(widget, grid);
  if (!rule) return size;
  const { w, h } = boardSpan(size);
  if (axis === "height") return snapTeamBoardSize(widget, w, h + step, grid) ?? size;
  const widths = [...rule.widths].sort((left, right) => left - right);
  const next = widths[widths.indexOf(w) + step];
  return next === undefined ? size : snapTeamBoardSize(widget, next, h, grid) ?? size;
}

/** What the seat and the scope allow, from the same rules the Overview follows. */
export type TeamBoardAccess = {
  /** The policy on screen; across teams it is project totals only. */
  readonly visibility: TeamSharingVisibility;
  /** Several teams added together, each on its own sharing. */
  readonly acrossTeams: boolean;
  /** A manager given team totals only. */
  readonly summarySeat: boolean;
  /** Teams or divisions below this scope. */
  readonly hasTeams: boolean;
};

export type TeamBoardLock = "acrossTeams" | "summarySeat" | "teamTotalsOnly" | "projectsOff" | "noTeams";

/** Why a widget cannot show here, or null when it can. The first reason that applies is the one to fix. */
export function teamBoardWidgetLock(widget: TeamBoardWidgetId, access: TeamBoardAccess): TeamBoardLock | null {
  const { visibility } = access;
  switch (TEAM_BOARD_NEEDS[widget]) {
    case "teams":
      if (!access.hasTeams) return "noTeams";
      return visibility.teamProjects ? null : "projectsOff";
    case "teamProjects":
      return visibility.teamProjects ? null : "projectsOff";
    case "people":
      if (access.acrossTeams) return "acrossTeams";
      if (access.summarySeat) return "summarySeat";
      return visibility.memberProjects ? null : "teamTotalsOnly";
  }
}

/** How the widget window groups widgets (2026-10-25): what the team did, its people, the teams below. */
export type TeamBoardWidgetCategory = "projects" | "people" | "teams";
export function teamBoardWidgetCategory(widget: TeamBoardWidgetId): TeamBoardWidgetCategory {
  const need = TEAM_BOARD_NEEDS[widget];
  return need === "teamProjects" ? "projects" : need;
}

/** Whether the add list offers a widget here at all: comparing teams means nothing without teams below. */
export function teamBoardWidgetOffered(widget: TeamBoardWidgetId, access: TeamBoardAccess): boolean {
  return teamBoardWidgetLock(widget, access) !== "noTeams";
}

/**
 * The standard board, the same for every leader of a scope (as RescueTime's
 * team reports are): the teams below and the projects where there are teams,
 * the projects and the people inside one. A widget the scope does not share
 * enough for stays in the layout, off the board, and returns when the sharing
 * widens.
 */
export function defaultTeamBoard(access: TeamBoardAccess, counts: { readonly teams: number; readonly people: number }, grid: TeamBoardGrid): TeamBoardItem[] {
  const standard = grid.standard(counts);
  return (access.hasTeams ? standard.teams : standard.team)
    .filter(([widget]) => teamBoardWidgetOffered(widget, access))
    .map(([widget, size], index) => ({ key: widget + "-" + String(index), widget, size }));
}

/**
 * A leader's own board (owner decision 2026-10-20, as Rize keeps dashboards):
 * it starts private, and its owner may show it to the other leaders, who see
 * on it only what they may see themselves. A board is a layout, so it shows
 * whichever team or division is open.
 */
export type TeamBoardVisibility = "me" | "leaders";
export type TeamPersonalBoard = {
  readonly id: string;
  /** Numbered in creation order: "My board", "My board 2". */
  readonly seq: number;
  /** The name its owner gave it; null keeps "My board" with its number. */
  readonly name: string | null;
  readonly visibility: TeamBoardVisibility;
  readonly items: readonly TeamBoardItem[];
};
/** The leader's boards and the one open; null is the standard board everyone shares. */
export type TeamBoardsState = { readonly boards: readonly TeamPersonalBoard[]; readonly active: string | null };

export const EMPTY_TEAM_BOARDS: TeamBoardsState = { boards: [], active: null };

/** Boards are kept per grid in the preview, so each grid under review keeps its own layouts. */
export function teamBoardsStorageKey(organizationId: string, gridId: TeamBoardGridId): string {
  return "drifty.dev.teamBoards.v4:" + gridId + ":" + organizationId;
}

/** A saved widget, if its kind and size still exist on this grid; options it does not know are dropped. */
function readItem(value: unknown, grid: TeamBoardGrid): TeamBoardItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.key !== "string" || !(TEAM_BOARD_WIDGETS as readonly unknown[]).includes(item.widget)) return null;
  const widget = item.widget as TeamBoardWidgetId;
  if (typeof item.size !== "string" || !teamBoardSizeAllowed(widget, item.size, grid)) return null;
  const saved = item.options && typeof item.options === "object" ? (item.options as Record<string, unknown>).metrics : undefined;
  const metrics = Array.isArray(saved) ? saved.filter((metric): metric is TeamBoardMetricId => (TEAM_BOARD_METRICS as readonly unknown[]).includes(metric)) : [];
  const unique = [...new Set(metrics)];
  return { key: item.key, widget, size: item.size, ...(widget === "numbers" && unique.length > 0 ? { options: { metrics: unique } } : {}) };
}

function readBoard(value: unknown, grid: TeamBoardGrid): TeamPersonalBoard | null {
  if (!value || typeof value !== "object") return null;
  const board = value as Record<string, unknown>;
  if (typeof board.id !== "string" || typeof board.seq !== "number" || !Array.isArray(board.items)) return null;
  const name = typeof board.name === "string" && board.name.trim() !== "" ? board.name.trim().slice(0, 40) : null;
  return { id: board.id, seq: board.seq, name, visibility: board.visibility === "leaders" ? "leaders" : "me", items: board.items.map((item) => readItem(item, grid)).filter((item): item is TeamBoardItem => item !== null) };
}

/** The leader's boards in this organization. The preview keeps them on this device. */
export function readTeamBoards(storageKey: string, grid: TeamBoardGrid): TeamBoardsState {
  if (typeof window === "undefined") return EMPTY_TEAM_BOARDS;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return EMPTY_TEAM_BOARDS;
    const parsed = JSON.parse(raw) as { boards?: unknown; active?: unknown } | null;
    const boards = Array.isArray(parsed?.boards) ? parsed.boards.map((board) => readBoard(board, grid)).filter((board): board is TeamPersonalBoard => board !== null) : [];
    const active = typeof parsed?.active === "string" && boards.some((board) => board.id === parsed.active) ? parsed.active : null;
    return { boards, active };
  } catch {
    return EMPTY_TEAM_BOARDS;
  }
}

export function writeTeamBoards(storageKey: string, state: TeamBoardsState): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // The boards still apply for this session.
  }
}

/** A new board starts as the standard board's layout and opens. */
export function createTeamBoard(state: TeamBoardsState, layout: readonly TeamBoardItem[], now = Date.now()): TeamBoardsState {
  const seq = Math.max(0, ...state.boards.map((board) => board.seq)) + 1;
  const id = "board-" + String(now);
  const items = layout.map((item, index) => ({ ...item, key: item.widget + "-" + String(now) + "-" + String(index) }));
  return { boards: [...state.boards, { id, seq, name: null, visibility: "me", items }], active: id };
}

export function updateTeamBoard(state: TeamBoardsState, id: string, change: (board: TeamPersonalBoard) => TeamPersonalBoard): TeamBoardsState {
  return { ...state, boards: state.boards.map((board) => (board.id === id ? change(board) : board)) };
}

/** Deleting the open board returns to the standard one. */
export function deleteTeamBoard(state: TeamBoardsState, id: string): TeamBoardsState {
  return { boards: state.boards.filter((board) => board.id !== id), active: state.active === id ? null : state.active };
}

/** The item taken out and put in at an index of the list as it was. */
export function moveTeamBoardItem(items: readonly TeamBoardItem[], key: string, to: number): TeamBoardItem[] {
  const from = items.findIndex((item) => item.key === key);
  if (from < 0 || to < 0 || to >= items.length || to === from) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function resizeTeamBoardItem(items: readonly TeamBoardItem[], key: string, size: TeamBoardSizeId, grid: TeamBoardGrid): TeamBoardItem[] {
  return items.map((item) => (item.key === key && teamBoardSizeAllowed(item.widget, size, grid) ? { ...item, size } : item));
}

/**
 * What each list widget lists and the height its lines take, measured in the
 * app (2026-10-21): a ranked row is about 36px with its gap; a table's head is
 * 24px and each line 33.4px with its spacing, plus a total line where it has one.
 */
const LIST_OF: Partial<Record<TeamBoardWidgetId, { readonly of: "teams" | "people" | "projects"; readonly fixed: number; readonly line: number; readonly extra: number }>> = {
  teamCompare: { of: "teams", fixed: 0, line: 36, extra: 0 },
  peopleList: { of: "people", fixed: 0, line: 36, extra: 0 },
  peopleWeek: { of: "people", fixed: 24, line: 33.4, extra: 0 },
  teamProjectTable: { of: "teams", fixed: 24, line: 33.4, extra: 1 },
  peopleProjectTable: { of: "people", fixed: 24, line: 33.4, extra: 1 },
  projectTable: { of: "projects", fixed: 24, line: 33.4, extra: 1 },
};

/** A widget's title and padding take 51px of its cell; cells are 12px apart. */
const CARD_CHROME_PX = 51;
const BOARD_GAP_PX = 12;

export type TeamBoardListCounts = { readonly teams: number; readonly people: number; readonly projects?: number };

/**
 * The size a widget is added at. On four columns of fixed rows a list starts
 * at the fewest rows that hold it, within its drag limits, so a short list
 * leaves no empty space below it.
 */
export function teamBoardAddSize(widget: TeamBoardWidgetId, grid: TeamBoardGrid, counts?: TeamBoardListCounts): TeamBoardSizeId {
  const usual = grid.sizes[widget][0]!;
  const list = LIST_OF[widget];
  const rule = teamBoardResizeRule(widget, grid);
  if (!counts || !list || !rule || grid.row.kind !== "fixed") return usual;
  const count = counts[list.of] ?? null;
  if (count === null) return usual;
  const rowPx = grid.row.rem * 16;
  const needed = list.fixed + (count + list.extra) * list.line;
  const body = (rows: number) => rows * rowPx + (rows - 1) * BOARD_GAP_PX - CARD_CHROME_PX;
  const width = boardSpan(usual).w;
  const [min, max] = rule.rows(width);
  let rows = min;
  while (rows < max && body(rows) < needed) rows += 1;
  const size = String(width) + "x" + String(rows) as TeamBoardSizeId;
  return teamBoardSizeAllowed(widget, size, grid) ? size : usual;
}

export function addTeamBoardItem(items: readonly TeamBoardItem[], widget: TeamBoardWidgetId, grid: TeamBoardGrid, now = Date.now(), counts?: TeamBoardListCounts): TeamBoardItem[] {
  return [...items, { key: widget + "-" + String(now), widget, size: teamBoardAddSize(widget, grid, counts) }];
}

/**
 * What a new board may start from (2026-10-25), as Rize's Create dashboard
 * offers a blank board or a template built around a question the team asks
 * every week: where the project time went, how it was spread over people, and
 * how the teams below compare. A template keeps only the widgets this scope
 * shares enough for; one with none of them is not offered.
 */
export const TEAM_BOARD_TEMPLATES = ["projects", "people", "teams"] as const;
export type TeamBoardTemplateId = (typeof TEAM_BOARD_TEMPLATES)[number];

const TEMPLATE_WIDGETS: Readonly<Record<TeamBoardTemplateId, readonly TeamBoardWidgetId[]>> = {
  projects: ["numbers", "projectTable", "projectTrend", "projectRank"],
  people: ["peopleBars", "peopleProjectTable", "peopleWeek"],
  teams: ["teamCompare", "teamProjectTable", "projectTrend", "projectRank"],
};

const PROJECT_TEMPLATE_METRICS: readonly TeamBoardMetricId[] = ["projectTime", "topProject", "dailyAverage", "unassigned"];

export function teamBoardTemplate(id: TeamBoardTemplateId, access: TeamBoardAccess, grid: TeamBoardGrid, counts: TeamBoardListCounts): TeamBoardItem[] {
  // A template is offered only where its first widget, the question it answers, can show.
  if (teamBoardWidgetLock(TEMPLATE_WIDGETS[id][0]!, access) !== null) return [];
  return TEMPLATE_WIDGETS[id]
    .filter((widget) => teamBoardWidgetLock(widget, access) === null)
    .map((widget, index) => ({
      key: widget + "-template-" + String(index),
      widget,
      size: teamBoardAddSize(widget, grid, counts),
      ...(widget === "numbers" && id === "projects" ? { options: { metrics: PROJECT_TEMPLATE_METRICS } } : {}),
    }));
}

/** Whether a tile's number comes from shared focus. */
export function teamBoardMetricNeedsFocus(metric: TeamBoardMetricId): boolean {
  return metric === "focus" || metric === "unassigned";
}

/** The key-numbers tiles on screen: the board's choice, or the default, without focus where the team keeps it. */
export function teamBoardTileMetrics(item: Pick<TeamBoardItem, "options">, focusVisible: boolean): TeamBoardMetricId[] {
  return (item.options?.metrics ?? DEFAULT_TEAM_BOARD_METRICS).filter((metric) => focusVisible || !teamBoardMetricNeedsFocus(metric));
}

/**
 * Puts a metric in a tile; a metric another tile already shows trades places
 * with it, so no number shows twice. The tiles on screen become the board's choice.
 */
export function setTeamBoardTileMetric(items: readonly TeamBoardItem[], key: string, index: number, metric: TeamBoardMetricId, focusVisible: boolean): TeamBoardItem[] {
  return items.map((item) => {
    if (item.key !== key || item.widget !== "numbers") return item;
    const tiles = teamBoardTileMetrics(item, focusVisible);
    if (index < 0 || index >= tiles.length || tiles[index] === metric) return item;
    const other = tiles.indexOf(metric);
    if (other >= 0) tiles[other] = tiles[index]!;
    tiles[index] = metric;
    return { ...item, options: { ...item.options, metrics: tiles } };
  });
}

export type TeamBoardPlacement = { readonly key: string; readonly col: number; readonly row: number };
export type TeamBoardGap = { readonly col: number; readonly row: number; readonly w: number; readonly h: number };

/**
 * Where each widget sits on the grid, in board order, as CSS grid places
 * items by default: each takes the first place where it fits after the one
 * before it, reading left to right and down, so a narrower widget sits beside
 * the one before it when there is room. A later widget never goes back into a
 * hole above (owner decision 2026-10-22): when it did, a half-width widget
 * could not be moved below a full-width one, since it slid back up beside its
 * neighbour. Places count from 1, as CSS grid lines do. The gaps are the holes
 * left beside widgets at least minWidth wide, which the board offers for a new
 * widget.
 */
export function layoutTeamBoard(items: readonly Pick<TeamBoardItem, "key" | "size">[], columns = 4, minWidth = 2): { readonly placements: readonly TeamBoardPlacement[]; readonly gaps: readonly TeamBoardGap[] } {
  const taken: boolean[][] = [];
  const free = (row: number, col: number) => !(taken[row]?.[col] ?? false);
  const fits = (row: number, col: number, w: number, h: number) => {
    for (let r = row; r < row + h; r += 1) for (let c = col; c < col + w; c += 1) if (!free(r, c)) return false;
    return true;
  };
  const take = (row: number, col: number, w: number, h: number) => {
    for (let r = row; r < row + h; r += 1) {
      taken[r] ??= Array<boolean>(columns).fill(false);
      for (let c = col; c < col + w; c += 1) taken[r]![c] = true;
    }
  };
  let cursorRow = 0;
  let cursorCol = 0;
  const placements = items.map((item) => {
    const { w, h } = boardSpan(item.size);
    const width = Math.min(w, columns);
    for (let row = cursorRow; ; row += 1) {
      for (let col = row === cursorRow ? cursorCol : 0; col + width <= columns; col += 1) {
        if (fits(row, col, width, h)) {
          take(row, col, width, h);
          cursorRow = row;
          cursorCol = col + width;
          return { key: item.key, col: col + 1, row: row + 1 };
        }
      }
    }
  });
  const gaps: TeamBoardGap[] = [];
  const used = new Set<string>();
  const open = (row: number, col: number) => free(row, col) && !used.has(String(row) + ":" + String(col));
  for (let row = 0; row < taken.length; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      if (!open(row, col)) continue;
      let w = 0;
      while (col + w < columns && open(row, col + w)) w += 1;
      let h = 0;
      while (row + h < taken.length && Array.from({ length: w }, (_, index) => open(row + h, col + index)).every(Boolean)) h += 1;
      for (let r = row; r < row + h; r += 1) for (let c = col; c < col + w; c += 1) used.add(String(r) + ":" + String(c));
      if (w >= minWidth) gaps.push({ col: col + 1, row: row + 1, w, h });
    }
  }
  return { placements, gaps };
}

/**
 * Widened from its left edge, a widget keeps its row (owner decision
 * 2026-10-22): it moves ahead of the widgets that sat beside it on its left,
 * and they follow it, instead of it dropping below them. The items carry the
 * widget's size from before it was widened.
 */
export function teamBoardOrderKeepingRow<T extends Pick<TeamBoardItem, "key" | "size">>(items: readonly T[], key: string, columns = 4, minWidth = 2): T[] {
  const { placements } = layoutTeamBoard(items, columns, minWidth);
  const mine = placements.find((place) => place.key === key);
  const item = items.find((entry) => entry.key === key);
  if (!mine || !item) return [...items];
  const rows = boardSpan(item.size).h;
  const sizeOf = new Map(items.map((entry) => [entry.key, entry.size] as const));
  const beside = placements.find((place) => place.key !== key && place.col < mine.col && place.row < mine.row + rows && place.row + boardSpan(sizeOf.get(place.key)!).h > mine.row);
  if (!beside) return [...items];
  const rest = items.filter((entry) => entry.key !== key);
  rest.splice(rest.findIndex((entry) => entry.key === beside.key), 0, item);
  return rest;
}

/** Time on the scope's projects in the window before, for "compared with last time" on the numbers. */
export function teamBoardPreviousProjectSeconds(dataset: TeamFocusDataset, groupId: string | null, window: TeamWindow): number {
  const keys = new Set(membersInContainer(dataset.members, dataset.groups, groupId).map((member) => member.member_key));
  // Any length, so an export of months compares with the months before it.
  const previous = previousWindow(window, Number.MAX_SAFE_INTEGER);
  return dataset.projectDays
    .filter((row) => row.organization_project_id !== null && keys.has(row.member_key) && row.activity_date >= previous.start_date && row.activity_date <= previous.end_date)
    .reduce((sum, row) => sum + row.seconds, 0);
}

/** Project time per person per column: days for a week, weeks for a longer window. */
export type TeamBoardPeopleWeek = {
  readonly columns: readonly { readonly key: string; readonly days: readonly string[]; readonly isToday: boolean; readonly isFuture: boolean }[];
  readonly rows: readonly {
    readonly memberKey: string;
    readonly name: string;
    readonly totalSeconds: number;
    readonly cells: readonly { readonly seconds: number; readonly top: TeamProjectShare | null }[];
  }[];
  readonly maxCellSeconds: number;
};

function mergeShares(shares: readonly TeamProjectShare[]): TeamProjectShare[] {
  const byKey = new Map<string, TeamProjectShare>();
  for (const share of shares) {
    const key = share.projectId ?? "";
    const current = byKey.get(key);
    byKey.set(key, current ? { ...current, seconds: current.seconds + share.seconds } : share);
  }
  return [...byKey.values()].sort((left, right) => right.seconds - left.seconds);
}

export type TeamBoardColumn = { readonly key: string; readonly days: readonly string[]; readonly isToday: boolean; readonly isFuture: boolean };

/** A table's date columns: each day in a week, each week (from Monday) in a longer window. */
export function boardDateColumns(days: readonly { readonly day: string; readonly isToday: boolean; readonly isFuture: boolean }[]): TeamBoardColumn[] {
  const weekly = days.length > 7;
  const groups: { key: string; days: string[]; isToday: boolean; isFuture: boolean }[] = [];
  for (const cell of days) {
    const startsGroup = !weekly || groups.length === 0 || isoWeekday(cell.day) === 1;
    if (startsGroup) groups.push({ key: cell.day, days: [], isToday: false, isFuture: true });
    const group = groups[groups.length - 1]!;
    group.days.push(cell.day);
    group.isToday = group.isToday || cell.isToday;
    group.isFuture = group.isFuture && cell.isFuture;
  }
  return groups;
}

export function buildTeamBoardPeopleWeek(cards: readonly TeamMemberCardModel[]): TeamBoardPeopleWeek {
  const groups = boardDateColumns(cards[0]?.days ?? []);
  let maxCellSeconds = 0;
  const rows = cards.map((card) => {
    const cells = groups.map((group) => {
      const shares = mergeShares(card.days.filter((cell) => group.days.includes(cell.day)).flatMap((cell) => cell.shares));
      const seconds = shares.reduce((sum, share) => sum + share.seconds, 0);
      maxCellSeconds = Math.max(maxCellSeconds, seconds);
      return { seconds, top: shares.find((share) => share.projectId !== null) ?? shares[0] ?? null };
    });
    return { memberKey: card.member.member_key, name: card.member.display_name, totalSeconds: cells.reduce((sum, cell) => sum + cell.seconds, 0), cells };
  });
  return { columns: groups, rows, maxCellSeconds };
}

/** Named projects a table lists before folding the rest into "Other". */
export const TEAM_BOARD_TABLE_PROJECTS = 6;

export type TeamBoardProjectTableRow = {
  readonly key: string;
  /** A project, the projects folded together, or time on no project. */
  readonly kind: "project" | "other" | "unassigned";
  readonly share: TeamProjectShare | null;
  /** How many projects an "Other" row holds. */
  readonly count: number;
  readonly cells: readonly number[];
  readonly total: number;
};

/**
 * The project timetable (Rize's Project Timetable): projects down the side,
 * the window's days (or weeks) across, each cell the scope's time on that
 * project then; the biggest projects by name, the rest as "Other", time on no
 * project last, and a total for each column.
 */
export function buildTeamBoardProjectTable(
  days: readonly { readonly day: string; readonly isToday: boolean; readonly isFuture: boolean }[],
  byDay: readonly { readonly day: string; readonly shares: readonly TeamProjectShare[] }[],
  limit = TEAM_BOARD_TABLE_PROJECTS,
): { readonly columns: readonly TeamBoardColumn[]; readonly rows: readonly TeamBoardProjectTableRow[]; readonly totals: readonly number[]; readonly total: number; readonly max: number } {
  const columns = boardDateColumns(days);
  const sharesOn = new Map(byDay.map((entry) => [entry.day, entry.shares] as const));
  const projects = new Map<string, { projectId: string | null; name: string | null; color: string | null; seconds: number; cells: number[] }>();
  for (const [index, column] of columns.entries()) {
    for (const day of column.days) {
      for (const share of sharesOn.get(day) ?? []) {
        if (share.seconds <= 0) continue;
        const key = share.projectId ?? "";
        const entry = projects.get(key) ?? { projectId: share.projectId, name: share.name, color: share.color, seconds: 0, cells: columns.map(() => 0) };
        entry.seconds += share.seconds;
        entry.cells[index]! += share.seconds;
        projects.set(key, entry);
      }
    }
  }
  const named = [...projects.values()].filter((entry) => entry.projectId !== null).sort((left, right) => right.seconds - left.seconds);
  const unassigned = projects.get("") ?? null;
  const shown = named.length > limit + 1 ? named.slice(0, limit) : named;
  const folded = named.slice(shown.length);
  const rows: TeamBoardProjectTableRow[] = shown.map((entry) => ({ key: entry.projectId!, kind: "project", share: { projectId: entry.projectId, name: entry.name, color: entry.color, seconds: entry.seconds }, count: 1, cells: entry.cells, total: entry.seconds }));
  if (folded.length > 0) {
    const cells = columns.map((_, index) => folded.reduce((sum, entry) => sum + entry.cells[index]!, 0));
    rows.push({ key: "other", kind: "other", share: null, count: folded.length, cells, total: cells.reduce((sum, value) => sum + value, 0) });
  }
  if (unassigned) rows.push({ key: "unassigned", kind: "unassigned", share: { projectId: null, name: null, color: null, seconds: unassigned.seconds }, count: 0, cells: unassigned.cells, total: unassigned.seconds });
  const totals = columns.map((_, index) => rows.reduce((sum, row) => sum + row.cells[index]!, 0));
  return { columns, rows, totals, total: totals.reduce((sum, value) => sum + value, 0), max: Math.max(0, ...rows.flatMap((row) => row.cells)) };
}

export type TeamBoardMatrixRow = {
  readonly key: string;
  readonly name: string;
  readonly people: number | null;
  /** Seconds on each column project, then the other projects, then no project. */
  readonly cells: readonly number[];
  readonly other: number;
  readonly unassigned: number;
  readonly total: number;
};

/**
 * Rows by teams or people, columns by project (Rize's saved Tracked Time view
 * with rows by Teams or Members and columns by Projects): the scope's biggest
 * projects as columns, the rest as "Other", time on no project after them
 * when the rows carry it, and a total; rows by name.
 */
export function buildTeamBoardProjectMatrix(
  rows: readonly { readonly key: string; readonly name: string; readonly people?: number; readonly shares: readonly TeamProjectShare[] }[],
  scope: readonly TeamProjectShare[],
  limit = TEAM_BOARD_TABLE_PROJECTS - 1,
): { readonly projects: readonly TeamProjectShare[]; readonly hasOther: boolean; readonly hasUnassigned: boolean; readonly rows: readonly TeamBoardMatrixRow[]; readonly totals: readonly number[]; readonly other: number; readonly unassigned: number; readonly total: number; readonly max: number } {
  const named = scope.filter((share) => share.projectId !== null && share.seconds > 0).sort((left, right) => right.seconds - left.seconds);
  const projects = named.length > limit + 1 ? named.slice(0, limit) : named;
  const columnOf = new Map(projects.map((share, index) => [share.projectId!, index] as const));
  const built = [...rows].sort((left, right) => left.name.localeCompare(right.name)).map((row) => {
    const cells = projects.map(() => 0);
    let other = 0;
    let unassigned = 0;
    for (const share of row.shares) {
      if (share.projectId === null) unassigned += share.seconds;
      else if (columnOf.has(share.projectId)) cells[columnOf.get(share.projectId)!]! += share.seconds;
      else other += share.seconds;
    }
    return { key: row.key, name: row.name, people: row.people ?? null, cells, other, unassigned, total: cells.reduce((sum, value) => sum + value, 0) + other + unassigned };
  });
  const totals = projects.map((_, index) => built.reduce((sum, row) => sum + row.cells[index]!, 0));
  const other = built.reduce((sum, row) => sum + row.other, 0);
  const unassigned = built.reduce((sum, row) => sum + row.unassigned, 0);
  return {
    projects,
    hasOther: other > 0,
    hasUnassigned: unassigned > 0,
    rows: built,
    totals,
    other,
    unassigned,
    total: totals.reduce((sum, value) => sum + value, 0) + other + unassigned,
    max: Math.max(0, ...built.flatMap((row) => [...row.cells, row.other, row.unassigned])),
  };
}
