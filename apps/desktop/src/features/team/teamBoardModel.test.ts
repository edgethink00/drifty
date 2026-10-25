// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  TEAM_BOARD_GRIDS,
  TEAM_BOARD_WIDGETS,
  buildTeamBoardProjectMatrix,
  buildTeamBoardProjectTable,
  defaultTeamBoard,
  layoutTeamBoard,
  teamBoardOrderKeepingRow,
  moveTeamBoardItem,
  createTeamBoard,
  deleteTeamBoard,
  readTeamBoards,
  updateTeamBoard,
  writeTeamBoards,
  EMPTY_TEAM_BOARDS,
  resizeTeamBoardItem,
  setTeamBoardTileMetric,
  snapTeamBoardSize,
  teamBoardAddSize,
  stepTeamBoardSize,
  teamBoardMinWidth,
  teamBoardResizeRule,
  teamBoardRowCss,
  teamBoardSizeAllowed,
  teamBoardTemplate,
  teamBoardTileMetrics,
  teamBoardWidgetLock,
  teamBoardWidgetOffered,
  type TeamBoardAccess,
  type TeamBoardItem,
  type TeamBoardWidgetId,
} from "./teamBoardModel";
import { teamSharingVisibility, type TeamSharingPolicy } from "./teamSharingPolicy";
import { sortedPast } from "./useBoardSortable";

function access(policy: TeamSharingPolicy, overrides: Partial<TeamBoardAccess> = {}): TeamBoardAccess {
  return { visibility: teamSharingVisibility(policy), acrossTeams: false, summarySeat: false, hasTeams: false, ...overrides };
}

const HOURLY: TeamSharingPolicy = { projects: "hourly", tasks: "hourly", focus: "off", memberSummary: false };
const TEAM_ONLY: TeamSharingPolicy = { projects: "team", tasks: "off", focus: "off", memberSummary: true };
const GRID = TEAM_BOARD_GRIDS.calibrated;

function shown(policy: TeamSharingPolicy, overrides: Partial<TeamBoardAccess> = {}): TeamBoardWidgetId[] {
  return TEAM_BOARD_WIDGETS.filter((widget) => teamBoardWidgetLock(widget, access(policy, overrides)) === null);
}

describe("teamBoardWidgetLock", () => {
  it("never shows a widget more than the scope shares", () => {
    expect(shown(HOURLY)).toEqual(["numbers", "projectTrend", "projectRank", "peopleWeek", "projectTable", "projectDonut", "peopleBars", "peopleList", "peopleProjectTable"]);
    // Team totals only: nothing names a person.
    expect(shown(TEAM_ONLY)).toEqual(["numbers", "projectTrend", "projectRank", "projectTable", "projectDonut"]);
    expect(teamBoardWidgetLock("peopleWeek", access(TEAM_ONLY))).toBe("teamTotalsOnly");
    for (const widget of ["peopleBars", "peopleList", "peopleProjectTable"] as const) expect(teamBoardWidgetLock(widget, access(TEAM_ONLY))).toBe("teamTotalsOnly");
    expect(teamBoardWidgetLock("peopleWeek", access(HOURLY, { summarySeat: true }))).toBe("summarySeat");
  });

  it("adds teams together by project time only, and offers comparing teams only where there are some", () => {
    const across = access(TEAM_ONLY, { acrossTeams: true, hasTeams: true });
    expect(TEAM_BOARD_WIDGETS.filter((widget) => teamBoardWidgetLock(widget, across) === null)).toEqual(["numbers", "projectTrend", "projectRank", "teamCompare", "projectTable", "teamProjectTable", "projectDonut"]);
    expect(teamBoardWidgetLock("peopleWeek", across)).toBe("acrossTeams");
    expect(teamBoardWidgetOffered("teamCompare", access(HOURLY))).toBe(false);
    expect(teamBoardWidgetOffered("teamProjectTable", access(HOURLY))).toBe(false);
    expect(teamBoardWidgetOffered("peopleWeek", across)).toBe(true);
  });
});

describe("key-number tiles", () => {
  const numbers: TeamBoardItem = { key: "n", widget: "numbers", size: "4x1" };

  it("shows focus and unassigned time only where the team shares focus", () => {
    expect(teamBoardTileMetrics(numbers, true)).toEqual(["projectTime", "people", "topProject", "focus"]);
    expect(teamBoardTileMetrics(numbers, false)).toEqual(["projectTime", "people", "topProject"]);
    expect(teamBoardTileMetrics({ options: { metrics: ["unassigned", "dailyAverage"] } }, false)).toEqual(["dailyAverage"]);
  });

  it("puts a number in a tile, trading places with the tile that showed it", () => {
    const [changed] = setTeamBoardTileMetric([numbers], "n", 1, "dailyAverage", true);
    expect(changed!.options?.metrics).toEqual(["projectTime", "dailyAverage", "topProject", "focus"]);
    const [swapped] = setTeamBoardTileMetric([changed!], "n", 0, "topProject", true);
    expect(swapped!.options?.metrics).toEqual(["topProject", "dailyAverage", "projectTime", "focus"]);
  });
});

describe("sizing by dragging", () => {
  it("keeps tables full width and lets charts and lists be half or full, each a row at a time between its limits", () => {
    expect(teamBoardResizeRule("projectTable", GRID)?.widths).toEqual([4]);
    expect(teamBoardResizeRule("projectTable", GRID)?.rows(4)).toEqual([2, 6]);
    expect(teamBoardResizeRule("projectRank", GRID)?.widths).toEqual([2, 4]);
    // Eight people's bars and figures run together at half width.
    expect(teamBoardResizeRule("peopleBars", GRID)?.widths).toEqual([4]);
    // Grids other than four columns of fixed rows pick sizes from the menu.
    expect(teamBoardResizeRule("projectTable", TEAM_BOARD_GRIDS.twelfths)).toBeNull();
    expect(teamBoardResizeRule("projectTable", TEAM_BOARD_GRIDS.auto)).toBeNull();
  });

  it("lands a drag on the nearest allowed width and the rows within the limits", () => {
    expect(snapTeamBoardSize("projectRank", 3.4, 4.6, GRID)).toBe("4x4");
    expect(snapTeamBoardSize("projectRank", 2.9, 1.2, GRID)).toBe("2x2");
    expect(snapTeamBoardSize("projectTable", 2, 9, GRID)).toBe("4x6");
    // Key numbers are a row across, or two by two.
    expect(snapTeamBoardSize("numbers", 2.4, 1, GRID)).toBe("2x2");
    expect(snapTeamBoardSize("numbers", 3.6, 2, GRID)).toBe("4x1");
  });

  it("allows only those sizes, saved or chosen", () => {
    expect(teamBoardSizeAllowed("projectTable", "4x5", GRID)).toBe(true);
    expect(teamBoardSizeAllowed("projectTable", "2x3", GRID)).toBe(false);
    expect(teamBoardSizeAllowed("projectTable", "4x7", GRID)).toBe(false);
    expect(teamBoardSizeAllowed("numbers", "2x1", GRID)).toBe(false);
    expect(teamBoardSizeAllowed("projectTrend", "7x6", TEAM_BOARD_GRIDS.twelfths)).toBe(true);
    expect(resizeTeamBoardItem([{ key: "t", widget: "projectTable", size: "4x3" }], "t", "4x5", GRID)[0]!.size).toBe("4x5");
  });

  it("steps a row or the other width from the keyboard", () => {
    expect(stepTeamBoardSize("projectTable", "4x3", "height", 1, GRID)).toBe("4x4");
    expect(stepTeamBoardSize("projectTable", "4x2", "height", -1, GRID)).toBe("4x2");
    expect(stepTeamBoardSize("peopleList", "2x3", "width", 1, GRID)).toBe("4x3");
    expect(stepTeamBoardSize("peopleList", "2x3", "width", -1, GRID)).toBe("2x3");
    expect(stepTeamBoardSize("numbers", "4x1", "width", -1, GRID)).toBe("2x2");
  });
});

describe("project tables", () => {
  const share = (projectId: string | null, seconds: number) => ({ projectId, name: projectId, color: projectId ? "#123456" : null, seconds });
  const days = ["2026-10-19", "2026-10-20", "2026-10-21"].map((day, index) => ({ day, isToday: index === 1, isFuture: index === 2 }));

  it("lays the projects down the side and the days across, the smallest folded into Other and unassigned last", () => {
    const table = buildTeamBoardProjectTable(days, [
      { day: "2026-10-19", shares: [share("a", 3600), share("b", 1800), share("c", 600), share("d", 300), share(null, 900)] },
      { day: "2026-10-20", shares: [share("a", 1200), share("b", 2400)] },
    ], 2);
    expect(table.rows.map((row) => row.key + " " + row.cells.join("/"))).toEqual(["a 3600/1200/0", "b 1800/2400/0", "other 900/0/0", "unassigned 900/0/0"]);
    expect(table.rows[2]!.count).toBe(2);
    expect(table.totals).toEqual([7200, 3600, 0]);
    expect(table.total).toBe(10800);
  });

  it("lays teams or people down the side by name and the scope's biggest projects across", () => {
    const matrix = buildTeamBoardProjectMatrix([
      { key: "s", name: "Sales", shares: [share("a", 3600), share("c", 600)] },
      { key: "l", name: "Legal", people: 2, shares: [share("a", 9999)] },
      { key: "e", name: "Engineering", shares: [share("b", 1800), share(null, 300)] },
    ], [share("a", 3600), share("b", 1800), share("c", 600), share(null, 300)], 1);
    expect(matrix.projects.map((project) => project.projectId)).toEqual(["a"]);
    expect(matrix.rows.map((row) => row.name + " " + row.cells.join("/") + " +" + String(row.other) + " ?" + String(row.unassigned))).toEqual(["Engineering 0 +1800 ?300", "Legal 9999 +0 ?0", "Sales 3600 +600 ?0"]);
    expect(matrix.hasOther && matrix.hasUnassigned).toBe(true);
    expect(matrix.total).toBe(16299);
  });
});

describe("defaultTeamBoard", () => {
  it("starts a team on its projects and people, and an organization on its teams", () => {
    expect(defaultTeamBoard(access(HOURLY), { teams: 0, people: 8 }, GRID).map((item) => item.widget + " " + item.size)).toEqual(["numbers 4x1", "projectTrend 2x2", "projectRank 2x2", "peopleWeek 4x3"]);
    expect(defaultTeamBoard(access(TEAM_ONLY, { acrossTeams: true, hasTeams: true }), { teams: 5, people: 0 }, GRID).map((item) => item.widget + " " + item.size)).toEqual(["numbers 4x1", "teamCompare 4x2", "projectTrend 2x2", "projectRank 2x2"]);
    expect(defaultTeamBoard(access(TEAM_ONLY, { acrossTeams: true, hasTeams: true }), { teams: 14, people: 0 }, GRID)[1]!.size).toBe("4x3");
  });

  it("sizes the lists for as many rows as a grid's row holds", () => {
    // 120px rows: a 4x2 holds five people, so a team of six gets the taller list; 148px rows held six.
    expect(defaultTeamBoard(access(HOURLY), { teams: 0, people: 6 }, GRID)[3]!.size).toBe("4x3");
    expect(defaultTeamBoard(access(HOURLY), { teams: 0, people: 6 }, TEAM_BOARD_GRIDS.current)[3]!.size).toBe("4x2");
    expect(defaultTeamBoard(access(HOURLY), { teams: 0, people: 8 }, TEAM_BOARD_GRIDS.thirds).map((item) => item.size)).toEqual(["3x1", "2x2", "1x2", "3x3"]);
    // Twelve columns: a list takes rows in steps of two, as many as it needs.
    expect(defaultTeamBoard(access(HOURLY), { teams: 0, people: 3 }, TEAM_BOARD_GRIDS.twelfths).map((item) => item.size)).toEqual(["12x3", "7x6", "5x6", "12x5"]);
    expect(defaultTeamBoard(access(HOURLY), { teams: 0, people: 8 }, TEAM_BOARD_GRIDS.twelfths)[3]!.size).toBe("12x9");
    expect(defaultTeamBoard(access(TEAM_ONLY, { acrossTeams: true, hasTeams: true }), { teams: 7, people: 0 }, TEAM_BOARD_GRIDS.twelfths)[1]!.size).toBe("12x7");
    expect(defaultTeamBoard(access(HOURLY), { teams: 0, people: 30 }, TEAM_BOARD_GRIDS.auto).map((item) => item.size)).toEqual(["4x1", "2x1", "2x1", "4x1"]);
  });

  it("gives each grid its row height", () => {
    expect(teamBoardRowCss(GRID)).toBe("7.5rem");
    expect(teamBoardRowCss(TEAM_BOARD_GRIDS.auto)).toBe("auto");
    expect(teamBoardRowCss(TEAM_BOARD_GRIDS.screen)).toBe("max(7.5rem, var(--team-board-fit-row, 7.5rem))");
    expect(teamBoardMinWidth(GRID)).toBe(2);
    expect(teamBoardMinWidth(TEAM_BOARD_GRIDS.thirds)).toBe(1);
    expect(teamBoardMinWidth(TEAM_BOARD_GRIDS.twelfths)).toBe(4);
  });

  it("keeps a widget the sharing does not reach in the layout, so it returns when the sharing widens", () => {
    expect(defaultTeamBoard(access(TEAM_ONLY), { teams: 0, people: 4 }, GRID).map((item) => item.widget)).toContain("peopleWeek");
  });
});

describe("board items", () => {
  it("places each widget at the first place after the one before it, and finds the half-width gaps", () => {
    const layout = layoutTeamBoard([
      { key: "numbers", size: "4x1" },
      { key: "rank", size: "2x2" },
      { key: "trend", size: "4x2" },
      { key: "people", size: "4x3" },
    ]);
    expect(layout.placements).toEqual([
      { key: "numbers", col: 1, row: 1 },
      { key: "rank", col: 1, row: 2 },
      { key: "trend", col: 1, row: 4 },
      { key: "people", col: 1, row: 6 },
    ]);
    expect(layout.gaps).toEqual([{ col: 3, row: 2, w: 2, h: 2 }]);
    // A later widget never goes back into the hole beside an earlier one (2026-10-22), so a half-width widget can sit below a full-width one.
    const sparse = layoutTeamBoard([{ key: "a", size: "2x2" }, { key: "b", size: "4x1" }, { key: "c", size: "2x2" }]);
    expect(sparse.placements).toEqual([{ key: "a", col: 1, row: 1 }, { key: "b", col: 1, row: 3 }, { key: "c", col: 1, row: 4 }]);
    expect(sparse.gaps).toEqual([{ col: 3, row: 1, w: 2, h: 2 }, { col: 3, row: 4, w: 2, h: 2 }]);
    // Side by side when there is room after the one before.
    expect(layoutTeamBoard([{ key: "a", size: "2x2" }, { key: "c", size: "2x2" }, { key: "b", size: "4x1" }]).placements[1]).toEqual({ key: "c", col: 3, row: 1 });
  });

  it("places widgets the same way on three and twelve columns", () => {
    const thirds = layoutTeamBoard([{ key: "numbers", size: "3x1" }, { key: "trend", size: "2x2" }, { key: "rank", size: "1x2" }, { key: "people", size: "3x3" }], 3, 1);
    expect(thirds.placements).toEqual([
      { key: "numbers", col: 1, row: 1 },
      { key: "trend", col: 1, row: 2 },
      { key: "rank", col: 3, row: 2 },
      { key: "people", col: 1, row: 4 },
    ]);
    expect(thirds.gaps).toEqual([]);
    const twelfths = layoutTeamBoard([{ key: "numbers", size: "12x3" }, { key: "trend", size: "7x6" }, { key: "rank", size: "4x6" }], 12, 4);
    expect(twelfths.placements.slice(1)).toEqual([{ key: "trend", col: 1, row: 4 }, { key: "rank", col: 8, row: 4 }]);
    // One column left beside them is narrower than any widget, so it offers nothing.
    expect(twelfths.gaps).toEqual([]);
    expect(layoutTeamBoard([{ key: "trend", size: "6x6" }], 12, 4).gaps).toEqual([{ col: 7, row: 1, w: 6, h: 6 }]);
  });

  it("keeps a widget widened from its left edge in its row, ahead of the widget that sat beside it", () => {
    // The donut and the people list share a row; the list sits on the right.
    const before = [{ key: "numbers", size: "4x1" }, { key: "donut", size: "2x2" }, { key: "people", size: "2x2" }, { key: "bars", size: "4x2" }];
    expect(teamBoardOrderKeepingRow(before, "people").map((item) => item.key)).toEqual(["numbers", "people", "donut", "bars"]);
    // Widened to full width there, the list stays in row 2 and the donut moves below it.
    const after = teamBoardOrderKeepingRow(before, "people").map((item) => (item.key === "people" ? { ...item, size: "4x2" } : item));
    expect(layoutTeamBoard(after).placements.slice(1, 3)).toEqual([{ key: "people", col: 1, row: 2 }, { key: "donut", col: 1, row: 4 }]);
    // A widget on the left, or alone in its row, keeps its place.
    expect(teamBoardOrderKeepingRow(before, "donut").map((item) => item.key)).toEqual(["numbers", "donut", "people", "bars"]);
    expect(teamBoardOrderKeepingRow(before, "bars").map((item) => item.key)).toEqual(["numbers", "donut", "people", "bars"]);
  });

  const items: TeamBoardItem[] = [
    { key: "a", widget: "numbers", size: "4x1" },
    { key: "b", widget: "projectTrend", size: "2x2" },
    { key: "c", widget: "projectRank", size: "2x2" },
  ];

  it("moves a widget to another's place", () => {
    expect(moveTeamBoardItem(items, "c", 0).map((item) => item.key)).toEqual(["c", "a", "b"]);
    expect(moveTeamBoardItem(items, "a", 2).map((item) => item.key)).toEqual(["b", "c", "a"]);
  });

  it("only takes a size the widget has", () => {
    expect(resizeTeamBoardItem(items, "b", "4x2", GRID)[1]!.size).toBe("4x2");
    expect(resizeTeamBoardItem(items, "a", "4x3", GRID)[0]!.size).toBe("4x1");
    expect(resizeTeamBoardItem(items, "b", "7x6", GRID)[1]!.size).toBe("2x2");
    expect(resizeTeamBoardItem(items, "b", "7x6", TEAM_BOARD_GRIDS.twelfths)[1]!.size).toBe("7x6");
  });

  afterEach(() => window.localStorage.clear());

  it("keeps a leader's own boards, each starting from the standard layout, and drops saved widgets it cannot read", () => {
    let state = createTeamBoard(EMPTY_TEAM_BOARDS, items, 1);
    state = createTeamBoard(state, items, 2);
    expect(state.boards.map((board) => board.seq + " " + board.visibility)).toEqual(["1 me", "2 me"]);
    expect(state.active).toBe("board-2");
    expect(state.boards[0]!.items.map((item) => item.widget)).toEqual(["numbers", "projectTrend", "projectRank"]);
    state = updateTeamBoard(state, "board-1", (board) => ({ ...board, visibility: "leaders", items: [...board.items, { key: "d", widget: "numbers", size: "4x3" }, { key: "e", widget: "hours" as never, size: "2x2" }] }));
    writeTeamBoards("boards", state);
    const read = readTeamBoards("boards", GRID);
    expect(read.boards[0]!.visibility).toBe("leaders");
    expect(read.boards[0]!.items).toHaveLength(3);
    // A board saved on one grid keeps only the sizes another grid has.
    expect(readTeamBoards("boards", TEAM_BOARD_GRIDS.thirds).boards[0]!.items.map((item) => item.widget)).toEqual(["projectTrend", "projectRank"]);
    expect(deleteTeamBoard(read, "board-2").active).toBeNull();
  });

  it("keeps a board's name, and an empty or missing one falls back to its number", () => {
    // A key-numbers widget keeps its tiles; numbers it does not know are dropped.
    writeTeamBoards("boards", { boards: [{ id: "b", seq: 1, name: null, visibility: "me", items: [{ key: "n", widget: "numbers", size: "4x1", options: { metrics: ["unassigned", "steps" as never, "people"] } }] }], active: "b" });
    expect(readTeamBoards("boards", GRID).boards[0]!.items[0]!.options?.metrics).toEqual(["unassigned", "people"]);
    let state = createTeamBoard(EMPTY_TEAM_BOARDS, items, 1);
    state = updateTeamBoard(state, "board-1", (board) => ({ ...board, name: "  Weekly sync  " }));
    writeTeamBoards("boards", state);
    expect(readTeamBoards("boards", GRID).boards[0]!.name).toBe("Weekly sync");
    writeTeamBoards("boards", updateTeamBoard(state, "board-1", (board) => ({ ...board, name: "   " })));
    expect(readTeamBoards("boards", GRID).boards[0]!.name).toBeNull();
  });

  it("drops a dragged widget past the one it passes going down and before it going up", () => {
    expect(sortedPast(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(sortedPast(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });
});

describe("teamBoardAddSize", () => {
  const grid = TEAM_BOARD_GRIDS.calibrated;

  it("adds a list at the fewest rows that hold it, within its drag limits", () => {
    expect(teamBoardAddSize("peopleWeek", grid, { teams: 1, people: 3 })).toBe("4x2");
    expect(teamBoardAddSize("peopleWeek", grid, { teams: 1, people: 8 })).toBe("4x3");
    expect(teamBoardAddSize("teamProjectTable", grid, { teams: 7, people: 80 })).toBe("4x3");
    expect(teamBoardAddSize("teamCompare", grid, { teams: 40, people: 480 })).toBe("4x6");
  });

  it("keeps the usual size for widgets that are not lists and on grids sized from a menu", () => {
    expect(teamBoardAddSize("projectTrend", grid, { teams: 7, people: 80 })).toBe("2x2");
    expect(teamBoardAddSize("peopleWeek", TEAM_BOARD_GRIDS.auto, { teams: 1, people: 3 })).toBe("4x1");
    expect(teamBoardAddSize("peopleWeek", grid)).toBe("4x3");
  });
});

describe("teamBoardTemplate", () => {
  const counts = { teams: 0, people: 8, projects: 5 };
  it("offers a template only where the widget it is named for can show", () => {
    const team = access(HOURLY);
    expect(teamBoardTemplate("teams", team, GRID, counts)).toEqual([]);
    expect(teamBoardTemplate("people", team, GRID, counts).map((item) => item.widget)).toEqual(["peopleBars", "peopleProjectTable", "peopleWeek"]);
    const organization = access(HOURLY, { acrossTeams: true, hasTeams: true });
    expect(teamBoardTemplate("people", organization, GRID, { ...counts, teams: 4 })).toEqual([]);
    expect(teamBoardTemplate("teams", organization, GRID, { ...counts, teams: 4 }).map((item) => item.widget)).toEqual(["teamCompare", "teamProjectTable", "projectTrend", "projectRank"]);
  });

  it("never puts a widget the scope does not share enough for on a new board", () => {
    const totalsOnly = access(TEAM_ONLY);
    expect(teamBoardTemplate("people", totalsOnly, GRID, counts)).toEqual([]);
    for (const item of teamBoardTemplate("projects", totalsOnly, GRID, counts)) expect(teamBoardWidgetLock(item.widget, totalsOnly)).toBeNull();
    const projectsOff = access({ projects: "off", tasks: "off", focus: "off", memberSummary: false });
    expect(teamBoardTemplate("projects", projectsOff, GRID, counts)).toEqual([]);
  });
});
