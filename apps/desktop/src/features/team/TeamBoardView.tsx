import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { AnchoredPresence } from "../../components/AnchoredPresence";
import { MetricTile } from "../../components/MetricTile";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { ModalPresence } from "../../components/ModalPresence";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { ResetIcon } from "../categories/definitionIcons";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { ProjectsSharePanel } from "../projects/ProjectsSharePanel";
import {
  TEAM_BOARD_GRIDS,
  TEAM_BOARD_METRICS,
  TEAM_BOARD_TEMPLATES,
  TEAM_BOARD_WIDGETS,
  addTeamBoardItem,
  boardSpan,
  buildTeamBoardPeopleWeek,
  buildTeamBoardProjectMatrix,
  buildTeamBoardProjectTable,
  createTeamBoard,
  defaultTeamBoard,
  deleteTeamBoard,
  layoutTeamBoard,
  readTeamBoards,
  resizeTeamBoardItem,
  setTeamBoardTileMetric,
  snapTeamBoardSize,
  stepTeamBoardSize,
  teamBoardPreviousProjectSeconds,
  teamBoardAddSize,
  teamBoardMinWidth,
  teamBoardMetricNeedsFocus,
  teamBoardOrderKeepingRow,
  teamBoardResizeRule,
  teamBoardRowCss,
  teamBoardTemplate,
  teamBoardTileMetrics,
  teamBoardWidgetCategory,
  teamBoardWidgetLock,
  teamBoardWidgetOffered,
  teamBoardsStorageKey,
  updateTeamBoard,
  writeTeamBoards,
  type TeamBoardAccess,
  type TeamBoardGrid,
  type TeamBoardItem,
  type TeamBoardLock,
  type TeamBoardMetricId,
  type TeamBoardSizeId,
  type TeamBoardTemplateId,
  type TeamBoardWidgetCategory,
  type TeamBoardVisibility,
  type TeamPersonalBoard,
  type TeamBoardWidgetId,
  type TeamBoardsState,
} from "./teamBoardModel";
import type { TeamFocusDataset, TeamOverviewModel, TeamWindow } from "./teamFocusModel";
import { TEAM_UNASSIGNED_COLOR, TeamAvatar, TeamCard, TeamGroupMark, TeamTrendChart, dayNumberLabel, describeDelta, weekdayShortLabel } from "./TeamFocusParts";
import { LockIcon } from "./TeamSharingPolicyEditor";
import { TeamSubnavStrip } from "./TeamSubnav";
import { TEAM_BOARD_EDIT, TEAM_BOARD_FORK, TEAM_BOARD_GRID, TEAM_BOARD_NEW, TEAM_BOARD_RESIZE } from "./teamPreviewScenarios";
import type { TeamProject } from "./teamTypes";
import { useBoardResize, type BoardResizeAxis, type BoardResizeEdge } from "./useBoardResize";
import { liftedTransform, sortedPast, useBoardSortable } from "./useBoardSortable";

export const TEAM_BOARD_WIDGET_KEYS: Readonly<Record<TeamBoardWidgetId, { readonly title: TranslationKey; readonly body: TranslationKey }>> = {
  numbers: { title: "team.board.widget.numbers", body: "team.board.widget.numbersBody" },
  projectTrend: { title: "team.board.widget.projectTrend", body: "team.board.widget.projectTrendBody" },
  projectRank: { title: "team.board.widget.projectRank", body: "team.board.widget.projectRankBody" },
  teamCompare: { title: "team.board.widget.teamCompare", body: "team.board.widget.teamCompareBody" },
  peopleWeek: { title: "team.board.widget.peopleWeek", body: "team.board.widget.peopleWeekBody" },
  projectTable: { title: "team.board.widget.projectTable", body: "team.board.widget.projectTableBody" },
  teamProjectTable: { title: "team.board.widget.teamProjectTable", body: "team.board.widget.teamProjectTableBody" },
  projectDonut: { title: "team.board.widget.projectDonut", body: "team.board.widget.projectDonutBody" },
  peopleBars: { title: "team.board.widget.peopleBars", body: "team.board.widget.peopleBarsBody" },
  peopleList: { title: "team.board.widget.peopleList", body: "team.board.widget.peopleListBody" },
  peopleProjectTable: { title: "team.board.widget.peopleProjectTable", body: "team.board.widget.peopleProjectTableBody" },
};

const METRIC_KEYS: Readonly<Record<TeamBoardMetricId, TranslationKey>> = {
  projectTime: "team.board.numbers.projectTime",
  people: "team.board.numbers.people",
  topProject: "team.board.numbers.topProject",
  focus: "team.board.focus",
  dailyAverage: "team.board.numbers.dailyAverage",
  unassigned: "team.board.numbers.unassigned",
};

/** The folded "Other" projects, as the Projects page's ring draws them. */
const OTHER_PROJECTS_COLOR = "#b9b3a6";

const LOCK_KEYS: Readonly<Record<TeamBoardLock, TranslationKey>> = {
  acrossTeams: "team.board.lock.acrossTeams",
  summarySeat: "team.board.lock.summarySeat",
  teamTotalsOnly: "team.board.lock.teamTotalsOnly",
  projectsOff: "team.board.lock.projectsOff",
  noTeams: "team.board.lock.noTeams",
};

const VISIBILITY_KEYS: Readonly<Record<TeamBoardVisibility, TranslationKey>> = {
  me: "team.board.visibility.me",
  leaders: "team.board.visibility.leaders",
};

/** Named projects a list widget shows before "N more": the Overview's five. */
const LIST_ROWS = 5;
/** Thumbnail colors when the team has fewer projects than a thumbnail draws. */
const THUMB_FALLBACK = ["#5b7a3d", "#b8873b", "#a8573f", "#55679e"] as const;

const GRIP = <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.25" /><circle cx="10.5" cy="3.5" r="1.25" /><circle cx="5.5" cy="8" r="1.25" /><circle cx="10.5" cy="8" r="1.25" /><circle cx="5.5" cy="12.5" r="1.25" /><circle cx="10.5" cy="12.5" r="1.25" /></svg>;
const MORE = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.4" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.6" cy="12" r="1.7" /></svg>;
/** The standard board's tab, among the leader's boards in the row. */
const STANDARD_TAB = "standard";
const PLUS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
const PEOPLE = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="5.5" r="2.2" /><path d="M2 13c.4-2.2 2-3.4 4-3.4s3.6 1.2 4 3.4" /><path d="M10.6 3.6a2 2 0 0 1 0 3.8M12 9.9c1.1.4 1.8 1.5 2 3.1" /></svg>;
const PENCIL = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.5 2.8 13.2 5.5 5.6 13.1 2.5 13.5 2.9 10.4Z" /><path d="m9.2 4.1 2.7 2.7" /></svg>;
const COPY = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.6" /><path d="M11 5V3.6A1.1 1.1 0 0 0 9.9 2.5H3.6a1.1 1.1 0 0 0-1.1 1.1v6.3A1.1 1.1 0 0 0 3.6 11H5" /></svg>;

/** The templates a new board may start from, by name and what each answers. */
const TEMPLATE_KEYS: Readonly<Record<TeamBoardTemplateId, { readonly title: TranslationKey; readonly body: TranslationKey }>> = {
  projects: { title: "team.board.template.projects", body: "team.board.template.projectsBody" },
  people: { title: "team.board.template.people", body: "team.board.template.peopleBody" },
  teams: { title: "team.board.template.teams", body: "team.board.template.teamsBody" },
};
const CHEVRON = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></svg>;

export type TeamBoardViewProps = {
  /** A leader's boards are kept per organization and show whichever scope is open. */
  readonly organizationId: string;
  readonly model: TeamOverviewModel;
  readonly dataset: TeamFocusDataset;
  readonly groupId: string | null;
  readonly window: TeamWindow;
  readonly access: TeamBoardAccess;
  readonly projects: readonly TeamProject[];
  /** Where this board belongs, from the top the seat can open; the last entry is the board's own scope. */
  readonly path: readonly { readonly id: string | null; readonly name: string }[];
  readonly onOpenMember: (memberKey: string) => void;
  readonly onOpenGroup: (groupId: string | null) => void;
};

/**
 * The Dashboard tab (owner decision 2026-10-20): the standard board, the same
 * for every leader of a scope (as RescueTime's team reports are), and boards
 * of a leader's own (as Rize's dashboards are). On their own boards a leader
 * moves widgets by the grip before the title (drag, or the arrow keys),
 * resizes or removes them from a menu, and adds them from a gallery with a
 * preview of each. A widget the scope does not share enough for stays off
 * the board without a word, as Rize shows each seat only what it may see
 * (owner decision 2026-10-20); it keeps its place and returns when the sharing
 * widens. Only the gallery names why a widget cannot be added here.
 *
 * Under review (2026-10-25), each with candidates in Dev: arranging opens
 * with an Edit button and ends with Done (as Rize, Grafana and Metabase), a
 * first change to the standard board opens as the leader's own board with
 * Undo, and New board starts blank, from a template or as a copy.
 */
export function TeamBoardView({ organizationId, model, dataset, groupId, window, access, projects, path, onOpenMember, onOpenGroup }: TeamBoardViewProps): JSX.Element {
  const { effectiveLanguage: language, t } = useLocalization();
  // How the board divides the screen is under review (2026-10-20); each grid keeps its own boards.
  const grid = TEAM_BOARD_GRIDS[TEAM_BOARD_GRID.read()];
  const storageKey = teamBoardsStorageKey(organizationId, grid.id);
  const [state, setState] = useState<TeamBoardsState>(() => readTeamBoards(storageKey, grid));
  useEffect(() => {
    setState(readTeamBoards(storageKey, TEAM_BOARD_GRIDS[TEAM_BOARD_GRID.read()]));
  }, [storageKey]);
  const save = (next: TeamBoardsState) => {
    setState(next);
    writeTeamBoards(storageKey, next);
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  /** The widget window (2026-10-25): search, a category, and the widget whose live preview shows. */
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerCategory, setPickerCategory] = useState<"all" | TeamBoardWidgetCategory>("all");
  const [pickerSelected, setPickerSelected] = useState<TeamBoardWidgetId | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Under review (2026-10-25): how a board is arranged, what changing the standard board does, what New board starts from, and the switch's look.
  const editRule = TEAM_BOARD_EDIT.read();
  const forkRule = TEAM_BOARD_FORK.read();
  const newRule = TEAM_BOARD_NEW.read();
  const [editing, setEditing] = useState(false);
  /** Changes to the standard board waiting to be saved as the leader's own (C). */
  const [draft, setDraft] = useState<TeamBoardItem[] | null>(null);
  /** The board a first change to the standard board just made, offered back with Undo (A). */
  const [forked, setForked] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  /** Boards whose tabs do not fit the row, folded into its "N more" menu; the open board is never among them. */
  const [folded, setFolded] = useState<readonly string[]>([]);
  const boardsRef = useRef<HTMLDivElement>(null);
  const tabWidths = useRef(new Map<string, number>());
  const counts = { teams: model.groupCards.length, people: model.memberCards.length };
  const standard = defaultTeamBoard(access, counts, grid);
  const board = state.boards.find((entry) => entry.id === state.active) ?? null;
  const own = board !== null;
  const items: readonly TeamBoardItem[] = board ? board.items : draft ?? standard;
  /** The standard board itself never changes; a change to it becomes the leader's own board (A) or waits to be saved as one (C). */
  const changeable = own || forkRule === "auto" || forkRule === "saveBar";
  /** An Edit button opens the arranging (A), or the moving while sizes drag at any time (C). */
  const editButton = editRule === "mode" || editRule === "hybrid";
  const canMove = changeable && (editButton ? editing : true);
  const canResize = changeable && (editRule === "mode" ? editing : true);
  const setItems = (next: TeamBoardItem[]) => {
    if (board) {
      save(updateTeamBoard(state, board.id, (entry) => ({ ...entry, items: next })));
      return;
    }
    if (forkRule === "saveBar") {
      setDraft(next);
      return;
    }
    if (forkRule !== "auto") return;
    // The change opens as a board of the leader's own, its widgets keeping their keys so focus and motion carry over.
    const created = createTeamBoard(state, next);
    const id = created.active!;
    save(updateTeamBoard(created, id, (entry) => ({ ...entry, items: next })));
    setForked(id);
  };
  /** Opens another board; editing, a waiting change and the offer to undo end with the board they belonged to. */
  const openBoard = (id: string | null) => {
    setEditing(false);
    setDraft(null);
    setForked(null);
    save({ ...state, active: id });
  };
  /** A new board from a layout: named after its template, or numbered and renamed in place. */
  const startBoard = (layout: readonly TeamBoardItem[], name: string | null, rename: boolean) => {
    const created = createTeamBoard(state, layout);
    const id = created.active!;
    setDraft(null);
    setForked(null);
    save(name ? updateTeamBoard(created, id, (entry) => ({ ...entry, name })) : created);
    if (rename) setRenaming(id);
    // A blank board has nothing to read until its first widget, so it opens arranging.
    setEditing(editButton && layout.length === 0);
  };
  useEffect(() => {
    if (!editing) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], .team-board-menu')) return;
      setEditing(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [editing]);
  // The row keeps every tab whole: tabs that do not fit go, last first, into the "N more" menu, and the open one stays.
  const tabOrder = [STANDARD_TAB, ...state.boards.map((entry) => entry.id)];
  const openTab = board ? board.id : STANDARD_TAB;
  const fit = useRef<() => void>(() => undefined);
  fit.current = () => {
    const node = boardsRef.current;
    if (!node) {
      if (folded.length > 0) setFolded([]);
      return;
    }
    node.querySelectorAll<HTMLElement>("[data-tab-id]").forEach((tab) => {
      if (!tab.hidden) tabWidths.current.set(tab.dataset.tabId!, tab.offsetWidth);
    });
    const strip = node.querySelector<HTMLElement>(".team-subnav");
    if (!strip) return;
    const style = getComputedStyle(strip);
    const gap = Number.parseFloat(style.columnGap) || 0;
    const chrome = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0) + (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.borderRightWidth) || 0);
    const rowGap = Number.parseFloat(getComputedStyle(node).columnGap) || 0;
    const plus = node.querySelector<HTMLElement>(".team-board-new")?.offsetWidth ?? 0;
    const width = (id: string) => tabWidths.current.get(id) ?? 0;
    const room = node.clientWidth - chrome - plus - rowGap;
    const all = tabOrder.reduce((sum, id) => sum + width(id), 0) + gap * (tabOrder.length - 1);
    let next: string[] = [];
    if (all > room) {
      const menu = 96;
      const shown: string[] = [];
      let used = width(openTab);
      for (const id of tabOrder) {
        if (id === openTab) continue;
        if (used + gap + width(id) > room - menu - rowGap) break;
        shown.push(id);
        used += gap + width(id);
      }
      next = tabOrder.filter((id) => id !== openTab && !shown.includes(id));
    }
    if (next.join("|") !== folded.join("|")) setFolded(next);
  };
  useLayoutEffect(() => fit.current());
  useEffect(() => {
    const node = boardsRef.current?.parentElement;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fit.current());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const nameOf = (entry: TeamPersonalBoard) => entry.name ?? (entry.seq === 1 ? t("team.board.myBoard") : t("team.board.myBoardN", { count: entry.seq }));
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  const titleOf = (widget: TeamBoardWidgetId) => t(TEAM_BOARD_WIDGET_KEYS[widget].title);
  const gridRef = useRef<HTMLDivElement>(null);
  // How a widget is sized on a leader's own board is under review (2026-10-21): dragged (B, A) or picked from the menu (C).
  const resizeMode = TEAM_BOARD_RESIZE.read();
  const ruleOf = (widget: TeamBoardWidgetId) => (resizeMode === "menu" ? null : teamBoardResizeRule(widget, grid));
  /** A size in words: half or full width and its rows, for the label while dragging and for screen readers. */
  const sizeWords = (size: TeamBoardSizeId) => {
    const span = boardSpan(size);
    const rows = t("team.board.resize.rows", { count: span.h });
    return resizeMode === "height" ? rows : (span.w >= grid.columns ? t("team.board.resize.full") : t("team.board.resize.half")) + " · " + rows;
  };
  const resize = useBoardResize({
    gridRef,
    columns: grid.columns,
    snap: (key, columns, rows, axis) => {
      const item = items.find((entry) => entry.key === key);
      if (!item) return null;
      const span = boardSpan(item.size);
      return snapTeamBoardSize(item.widget, axis === "height" ? span.w : columns, axis === "width" ? span.h : rows, grid);
    },
    beforeChange: () => sortable.animate(),
    onCommit: (key, size, edge) => {
      const item = items.find((entry) => entry.key === key);
      // Widened from its left edge, the widget keeps its row: the widgets on screen take the new order.
      let next = items;
      if (item && edge === "start" && boardSpan(size).w > boardSpan(item.size).w) {
        const onScreen = items.filter((entry) => teamBoardWidgetLock(entry.widget, access) === null);
        const queue = teamBoardOrderKeepingRow(onScreen, key, grid.columns, teamBoardMinWidth(grid));
        next = items.map((entry) => (teamBoardWidgetLock(entry.widget, access) === null ? queue.shift() ?? entry : entry));
      }
      setItems(resizeTeamBoardItem(next, key, size, grid));
      if (item) setAnnouncement(t("team.board.resized", { name: titleOf(item.widget), size: sizeWords(size) }));
    },
  });
  const sizing = resize.resizing;
  // A widget the scope does not share enough for stays in the layout, off the board.
  const visible = items
    .filter((item) => teamBoardWidgetLock(item.widget, access) === null)
    .map((item) => (sizing?.key === item.key ? { ...item, size: sizing.size } : item));
  const visibleByKey = new Map(visible.map((item) => [item.key, item] as const));
  /** The board with the widgets on screen in a new order and the held-back ones where they were. */
  const withVisibleOrder = (order: readonly string[]): TeamBoardItem[] => {
    const queue = order.map((key) => visibleByKey.get(key)).filter((item): item is TeamBoardItem => item !== undefined);
    return items.map((item) => (visibleByKey.has(item.key) ? queue.shift() ?? item : item));
  };
  const sortable = useBoardSortable({ gridRef, items: visible, onCommit: (order) => setItems(withVisibleOrder(order)) });
  const ordered = sortable.order.map((key) => visibleByKey.get(key)).filter((item): item is TeamBoardItem => item !== undefined);
  // While a widget is widened from its left edge it keeps its row, as it will once let go.
  const widenedFromStart = sizing !== null && sizing.edge === "start" && boardSpan(sizing.size).w > boardSpan(sizing.startSize).w;
  const shown = widenedFromStart
    ? teamBoardOrderKeepingRow(ordered.map((item) => (item.key === sizing.key ? { ...item, size: sizing.startSize } : item)), sizing.key, grid.columns, teamBoardMinWidth(grid))
      .map((item) => visibleByKey.get(item.key))
      .filter((item): item is TeamBoardItem => item !== undefined)
    : ordered;
  const layout = layoutTeamBoard(shown, grid.columns, teamBoardMinWidth(grid));
  const placeOf = new Map(layout.placements.map((place) => [place.key, place] as const));
  // A gap beside a half-width widget offers the widgets that would show and are not on the board yet.
  const addable = canResize && sortable.drag === null && TEAM_BOARD_WIDGETS.some((widget) => teamBoardWidgetLock(widget, access) === null && !items.some((item) => item.widget === widget));
  const [announcement, setAnnouncement] = useState("");
  /** The widget just taken off the board, kept where it was so it can be put back (as the category editor keeps a deleted item). */
  const [removed, setRemoved] = useState<{ readonly boardId: string; readonly item: TeamBoardItem; readonly index: number } | null>(null);
  useEffect(() => setRemoved(null), [board?.id]);
  const [refocus, setRefocus] = useState<string | null>(null);
  /** Any change of place slides the widgets from where they were. */
  const change = (next: TeamBoardItem[]) => {
    sortable.animate();
    setItems(next);
  };
  const removeItem = (item: TeamBoardItem) => {
    if (board) setRemoved({ boardId: board.id, item, index: items.findIndex((entry) => entry.key === item.key) });
    change(items.filter((entry) => entry.key !== item.key));
  };
  /** Puts the widget back where it was; changes made since are kept. */
  const undoRemove = () => {
    if (!removed) return;
    setRemoved(null);
    if (items.some((entry) => entry.widget === removed.item.widget)) return;
    const next = [...items];
    next.splice(Math.min(removed.index, next.length), 0, removed.item);
    change(next);
    setRefocus(removed.item.key);
  };
  const moveBy = (key: string, step: -1 | 1) => {
    const order = visible.map((item) => item.key);
    const index = order.indexOf(key);
    const target = order[index + step];
    const item = visibleByKey.get(key);
    if (!target || !item) return;
    change(withVisibleOrder(sortedPast(order, key, target)));
    setAnnouncement(t("team.board.moved", { name: titleOf(item.widget), position: index + step + 1, count: order.length }));
    setRefocus(key);
  };
  // Moving a widget re-inserts its cell; the grip that moved it keeps focus.
  useLayoutEffect(() => {
    if (!refocus) return;
    gridRef.current?.querySelector<HTMLElement>('[data-board-grip="' + refocus + '"]')?.focus();
    setRefocus(null);
  }, [refocus, items]);
  const pickerDismiss = useOverlayDismiss(() => setPickerOpen(false));
  const openPicker = () => {
    setPickerQuery("");
    setPickerCategory("all");
    setPickerSelected(null);
    setPickerOpen(true);
  };
  const newDismiss = useOverlayDismiss(() => setNewOpen(false));
  // Grid E splits the window below the board's top into its rows; the height follows the window.
  const [fitRow, setFitRow] = useState<number | null>(null);
  const fitRows = grid.row.kind === "screen" ? grid.row.rows : 0;
  useLayoutEffect(() => {
    const node = gridRef.current;
    if (fitRows === 0 || !node) return;
    const scroller = scrollingAncestor(node);
    if (!scroller) return;
    const measure = () => {
      // The window prop is the board's period; the browser's is globalThis.
      const gap = Number.parseFloat(globalThis.getComputedStyle(node).rowGap) || 0;
      const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const bottom = Number.parseFloat(globalThis.getComputedStyle(scroller).paddingBottom) || 0;
      setFitRow(Math.floor((scroller.clientHeight - top - bottom - gap * (fitRows - 1)) / fitRows));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [fitRows]);
  const colors = useMemo(() => teamBoardThumbColors(projects), [projects]);

  const widgetBody = (item: TeamBoardItem): { readonly total?: string | null; readonly body: ReactNode } => {
    switch (item.widget) {
      case "numbers":
        return {
          body: (
            <BoardNumbers
              model={model}
              previousProjectSeconds={teamBoardPreviousProjectSeconds(dataset, groupId, window)}
              duration={duration}
              square={boardSpan(item.size).w < grid.columns}
              metrics={teamBoardTileMetrics(item, model.teamFocusVisible)}
              onPick={own ? (index, metric) => setItems(setTeamBoardTileMetric(items, item.key, index, metric, model.teamFocusVisible)) : undefined}
            />
          ),
        };
      case "projectTrend": {
        const days = model.focusByDayProject.filter((entry) => !model.focusByDay.find((point) => point.day === entry.day)?.isFuture);
        return {
          body: days.some((entry) => entry.shares.some((share) => share.seconds > 0))
            ? <TeamTrendChart days={days} order={model.focusByProject} language={language} ariaLabel={t("team.focus.byDayAria")} unassignedLabel={t("team.focus.unassigned")} />
            : <div className="team-empty">{t("team.focus.noProjectTime")}</div>,
        };
      }
      case "projectRank": {
        // Project time is time on projects; unassigned time follows as its own row, as in Key numbers.
        const total = model.focusByProject.reduce((sum, share) => sum + (share.projectId === null ? 0 : share.seconds), 0);
        return { total: total > 0 ? duration(total) : null, body: <BoardProjectRows model={model} duration={duration} /> };
      }
      case "teamCompare":
        return { body: <BoardTeamRows model={model} duration={duration} onOpenGroup={onOpenGroup} /> };
      case "peopleWeek":
        return { body: <BoardPeopleWeek model={model} duration={duration} onOpenMember={onOpenMember} /> };
      case "projectTable":
        return { body: <BoardProjectTable model={model} duration={duration} /> };
      case "teamProjectTable":
        return { body: <BoardProjectMatrix kind="team" model={model} duration={duration} onOpen={onOpenGroup} /> };
      case "projectDonut": {
        const total = model.focusByProject.reduce((sum, share) => sum + share.seconds, 0);
        return { total: total > 0 ? duration(total) : null, body: <BoardProjectDonut model={model} /> };
      }
      case "peopleBars":
        return { body: <BoardPeopleBars model={model} onOpenMember={onOpenMember} /> };
      case "peopleList":
        return { body: <BoardPeopleList model={model} duration={duration} onOpenMember={onOpenMember} /> };
      case "peopleProjectTable":
        return { body: <BoardProjectMatrix kind="person" model={model} duration={duration} onOpen={onOpenMember} /> };
    }
  };

  /** A widget's card; lifted, it is the copy that follows the pointer. */
  const renderCard = (item: TeamBoardItem, lifted: boolean) => {
    const content = widgetBody(item);
    const title = titleOf(item.widget);
    const grip = canMove ? (
      <button
        type="button"
        className="team-board__tool team-board__grip"
        data-board-grip={lifted ? undefined : item.key}
        tabIndex={lifted ? -1 : undefined}
        aria-label={t("team.board.grip", { name: title })}
        title={ruleOf(item.widget) ? t("team.board.gripHintResize") : t("team.board.gripHint")}
        onKeyDown={(event) => {
          const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0;
          if (step === 0) return;
          event.preventDefault();
          // Shift and an arrow resize: up and down a row, left and right between half and full width.
          if (event.shiftKey) {
            if (!ruleOf(item.widget)) return;
            const axis = event.key === "ArrowUp" || event.key === "ArrowDown" ? "height" : "width";
            if (axis === "width" && resizeMode !== "both") return;
            const next = stepTeamBoardSize(item.widget, item.size, axis, step, grid);
            if (next === item.size) return;
            change(resizeTeamBoardItem(items, item.key, next, grid));
            setAnnouncement(t("team.board.resized", { name: title, size: sizeWords(next) }));
            setRefocus(item.key);
            return;
          }
          moveBy(item.key, step);
        }}
      >
        {GRIP}
      </button>
    ) : undefined;
    // While its size is dragged, the head's right side says the size it will take, in place of the total and menu.
    const aside = sizing?.key === item.key && !lifted ? (
      <div className="team-board__head-actions">
        <span className="team-board__size-chip" aria-hidden="true">{sizeWords(item.size)}</span>
      </div>
    ) : canResize || content.total ? (
      <div className="team-board__head-actions">
        {content.total ? <strong className="projects-share__total">{content.total}</strong> : null}
        {canResize ? (
          <BoardMenu
            ariaLabel={t("team.board.menu", { name: title })}
            triggerClassName="team-board__tool team-board__menu-trigger"
            trigger={MORE}
            entries={[
              // Dragged sizes need no menu; the menu keeps the sizes only where they are picked (C and the other grids).
              ...(ruleOf(item.widget) ? [] : [
                { kind: "label" as const, text: t("team.board.size") },
                ...grid.sizes[item.widget].map((option) => ({
                  kind: "radio" as const,
                  key: option,
                  label: sizeLabel(option, grid),
                  ariaLabel: sizeAria(option, grid, t),
                  checked: option === item.size,
                  icon: <SizeGlyph size={option} grid={grid} />,
                  onSelect: () => change(resizeTeamBoardItem(items, item.key, option, grid)),
                })),
                { kind: "separator" as const },
              ]),
              { kind: "item", key: "remove", label: t("team.board.remove"), onSelect: () => removeItem(item) },
            ]}
          />
        ) : null}
      </div>
    ) : undefined;
    return (
      <TeamCard
        id={"team-board-" + item.key + (lifted ? "-lifted" : "")}
        title={title}
        className={"team-board__card team-board__card--" + item.widget}
        lead={grip}
        onHandlePointerDown={canMove && !lifted ? (event) => sortable.beginDrag(event, item.key) : undefined}
        aside={aside}
      >
        <BoardBody>{content.body}</BoardBody>
      </TeamCard>
    );
  };
  const lifted = sortable.drag ? visibleByKey.get(sortable.drag.key) ?? null : null;
  /** A widget as it reads on the board, for the previews: its title, its total and its figures, with nothing to press. */
  const renderMiniCard = (item: TeamBoardItem, prefix: string) => {
    const content = widgetBody(item);
    return (
      <TeamCard id={"team-board-" + prefix + "-" + item.key} title={titleOf(item.widget)} className={"team-board__card team-board__card--" + item.widget} aside={content.total ? <div className="team-board__head-actions"><strong className="projects-share__total">{content.total}</strong></div> : undefined}>
        <BoardBody>{content.body}</BoardBody>
      </TeamCard>
    );
  };
  // Previews draw a board at the board's own width, then shrink it to fit.
  const boardWidth = gridRef.current?.clientWidth || 920;

  // The tabs under the page tabs (decided 2026-10-25): text tabs, the open one's fill sliding to the next.
  const tabClass = (active: boolean) => "team-subnav__tab" + (active ? " on" : "");
  const newLabel = t("team.board.newBoard");
  const listCounts = { ...counts, projects: model.focusByProject.length };
  const openName = board ? nameOf(board) : t("team.board.standardName");
  const newChoices = [
    { key: "blank", label: t("team.board.new.blank"), detail: t("team.board.new.blankBody"), layout: [] as readonly TeamBoardItem[], name: null as string | null, rename: true },
    ...TEAM_BOARD_TEMPLATES.map((id) => ({ key: id, label: t(TEMPLATE_KEYS[id].title), detail: t(TEMPLATE_KEYS[id].body), layout: teamBoardTemplate(id, access, grid, listCounts) as readonly TeamBoardItem[], name: t(TEMPLATE_KEYS[id].title) as string | null, rename: false }))
      .filter((choice) => choice.layout.length > 0),
    { key: "copy", label: t("team.board.new.copy", { name: openName }), detail: t("team.board.new.copyBody"), layout: items, name: null as string | null, rename: true },
  ];
  const templateCount = newChoices.length - 2;
  const plusClass = "team-board-new";
  const plusContent = PLUS;
  const newTrigger = newRule === "popover" ? (
    <BoardMenu
      ariaLabel={newLabel}
      triggerClassName={plusClass}
      trigger={plusContent}
      align="start"
      menuClassName="team-board-menu--new"
      // Each choice's board in miniature, drawn with this team's figures, beside the menu (2026-10-25).
      preview={(key) => {
        const choice = newChoices.find((entry) => entry.key === key) ?? newChoices[1] ?? newChoices[0]!;
        return (
          <div className="content--team team-board-new-preview">
            {choice.layout.length === 0 ? (
              <div className="team-board-new-preview__blank">{PLUS}<span>{t("team.board.new.blankBody")}</span></div>
            ) : (
              <BoardMiniature prefix={"new-" + choice.key} items={choice.layout} grid={grid} boardWidth={boardWidth} maxWidth={360} maxHeight={300} render={renderMiniCard} />
            )}
            <p className="team-board-new-preview__caption">{choice.layout.length === 0 ? choice.label : choice.layout.map((item) => titleOf(item.widget)).join(" · ")}</p>
          </div>
        );
      }}
      entries={newChoices.flatMap((choice, index) => [
        ...(index === 1 && templateCount > 0 ? [{ kind: "separator" as const }, { kind: "label" as const, text: t("team.board.new.templates") }] : []),
        ...(choice.key === "copy" ? [{ kind: "separator" as const }] : []),
        { kind: "item" as const, key: choice.key, label: choice.label, detail: choice.detail, icon: <BoardLayoutPreview items={choice.layout} grid={grid} colors={colors} />, onSelect: () => startBoard(choice.layout, choice.name, choice.rename) },
      ])}
    />
  ) : (
    <button
      type="button"
      className={plusClass}
      aria-label={newLabel}
      title={newLabel}
      aria-haspopup={newRule === "dialog" ? "dialog" : undefined}
      onClick={() => {
        if (newRule === "dialog") setNewOpen(true);
        else if (newRule === "blank") startBoard([], null, true);
        else startBoard(items, null, true);
      }}
    >
      {plusContent}
    </button>
  );

  return (
    <div className={"team-board" + (editing ? " is-editing" : "")} data-grid={grid.id} data-edit={editRule} style={{ "--board-columns": grid.columns, "--team-board-row": teamBoardRowCss(grid), "--team-board-fit-row": fitRow !== null && fitRows > 0 ? String(fitRow) + "px" : undefined } as CSSProperties}>
      {path.length > 1 || (path.length === 1 && path[0]!.id !== null) ? (
        <nav className="team-crumbs team-board__crumbs" aria-label={t("team.focus.crumbsAria")}>
          {path.map((entry, index) => (
            <span key={entry.id ?? "organization"} className="team-crumbs__item">
              {index > 0 ? <span className="team-crumbs__sep" aria-hidden="true">/</span> : null}
              {index === path.length - 1
                ? <strong className="team-board__scope" aria-current="page">{entry.name}</strong>
                : <button type="button" className="team-crumbs__link" onClick={() => onOpenGroup(entry.id)}>{entry.name}</button>}
            </span>
          ))}
        </nav>
      ) : null}

      <div className="team-board-bar">
        <div ref={boardsRef} className="team-board-bar__boards">
          <TeamSubnavStrip className="team-subnav" role="group" ariaLabel={t("team.board.boards")}>
            <button type="button" data-tab-id={STANDARD_TAB} hidden={folded.includes(STANDARD_TAB)} className={tabClass(!own)} aria-pressed={!own} onClick={() => openBoard(null)}>
              <span data-text={t("team.board.standardName")}>{t("team.board.standardName")}</span>
            </button>
            {state.boards.map((entry) => (entry.id === renaming ? (
              <span key={entry.id} data-tab-id={entry.id} className={tabClass(true) + " is-active is-editing"}>
                <BoardNameInput
                  label={t("team.board.nameAria")}
                  initial={nameOf(entry)}
                  onDone={(name) => {
                    setRenaming(null);
                    save(updateTeamBoard(state, entry.id, (current) => ({ ...current, name: name === "" ? null : name })));
                  }}
                  onCancel={() => setRenaming(null)}
                />
              </span>
            ) : (
              <button
                key={entry.id}
                type="button"
                data-tab-id={entry.id}
                hidden={folded.includes(entry.id)}
                className={tabClass(entry.id === board?.id)}
                aria-pressed={entry.id === board?.id}
                title={t("team.board.renameHint")}
                onClick={() => openBoard(entry.id)}
                onDoubleClick={() => setRenaming(entry.id)}
              >
                <span className="team-board-tab__name" data-text={nameOf(entry)}>{nameOf(entry)}</span>
                {entry.visibility === "leaders" ? <span className="team-board-tab__shared" title={t("team.board.visibility.leaders")}>{PEOPLE}</span> : null}
              </button>
            )))}
          </TeamSubnavStrip>
          {folded.length > 0 ? (
            // Boards past the row's width fold into one menu, as Notion's and Linear's views do; the open board always keeps its tab.
            <BoardMenu
              ariaLabel={t("team.board.moreAria")}
              triggerClassName="team-board-more"
              align="start"
              trigger={<><span>{t("team.board.moreBoards", { count: folded.length })}</span>{CHEVRON}</>}
              entries={folded.map((id) => (id === STANDARD_TAB
                ? { kind: "item" as const, key: id, label: t("team.board.standardName"), onSelect: () => openBoard(null) }
                : { kind: "item" as const, key: id, label: nameOf(state.boards.find((entry) => entry.id === id)!), onSelect: () => openBoard(id) }))}
            />
          ) : null}
          {newTrigger}
        </div>
        <div className="team-board-bar__actions">
          {board && !editing ? (
            <BoardMenu
              ariaLabel={t("team.board.visibility.title")}
              triggerClassName="team-board-bar__visibility"
              trigger={<>{board.visibility === "leaders" ? PEOPLE : <LockIcon />}<span>{t(VISIBILITY_KEYS[board.visibility])}</span>{CHEVRON}</>}
              entries={[
                { kind: "label", text: t("team.board.visibility.title") },
                ...(["me", "leaders"] as const).map((visibility) => ({
                  kind: "radio" as const,
                  key: visibility,
                  label: t(VISIBILITY_KEYS[visibility]),
                  checked: board.visibility === visibility,
                  icon: visibility === "leaders" ? PEOPLE : <LockIcon />,
                  onSelect: () => save(updateTeamBoard(state, board.id, (entry) => ({ ...entry, visibility }))),
                })),
              ]}
            />
          ) : null}
          {editing && !own && forkRule === "auto" ? <span className="team-board-bar__hint">{t("team.board.editHint")}</span> : null}
          {changeable && (!editButton || editing) ? (
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => openPicker()}>{PLUS}{t("team.board.add")}</button>
          ) : null}
          {changeable && editButton ? (editing ? (
            <button type="button" className="app-btn app-btn--primary app-btn--compact team-board-bar__done" onClick={() => setEditing(false)}>{t("team.board.done")}</button>
          ) : (
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => setEditing(true)}>{PENCIL}{t("team.board.edit")}</button>
          )) : null}
          {!own && forkRule === "duplicate" ? (
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => { startBoard(standard, null, false); setEditing(editButton); }}>{COPY}{t("team.board.duplicateToEdit")}</button>
          ) : null}
          {/* Export lives in Settings (2026-10-25); a board's menu holds only what changes the board. */}
          {editing || !board ? null : (
            <BoardMenu
              ariaLabel={t("team.board.boardMenu")}
              triggerClassName="team-board__tool team-board-bar__more"
              trigger={MORE}
              entries={[
                { kind: "item", key: "rename", label: t("team.board.rename"), onSelect: () => setRenaming(board.id) },
                { kind: "item", key: "reset", label: t("team.board.reset"), onSelect: () => change(standard.map((item, index) => ({ ...item, key: item.widget + "-" + String(Date.now()) + "-" + String(index) }))) },
                { kind: "separator" },
                { kind: "item", key: "delete", label: t("team.board.deleteBoard"), danger: true, onSelect: () => { setEditing(false); save(deleteTeamBoard(state, board.id)); } },
              ]}
            />
          )}
        </div>
      </div>

      <div className="team-board__stage">
      {forked && board && board.id === forked ? (
        <div className="team-board__removed" role="status">
          <span>{t("team.board.forked", { name: nameOf(board) })}</span>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => { setForked(null); save(deleteTeamBoard(state, forked)); }}><ResetIcon />{t("team.board.undo")}</button>
        </div>
      ) : null}
      {draft && !own ? (
        <div className="team-board__removed team-board__draft" role="status">
          <span>{t("team.board.draftChanged")}</span>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => setDraft(null)}><ResetIcon />{t("team.board.discard")}</button>
          <button type="button" className="app-btn app-btn--primary app-btn--compact" onClick={() => startBoard(draft, null, true)}>{t("team.board.saveAsMine")}</button>
        </div>
      ) : null}

      {removed && board && removed.boardId === board.id ? (
        <div className="team-board__removed" role="status">
          <span>{t("team.board.removed", { name: titleOf(removed.item.widget) })}</span>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={undoRemove}><ResetIcon />{t("team.board.undo")}</button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="team-empty team-board__empty">
          <p>{items.length === 0 ? t("team.board.empty") : t("team.board.nothingHere")}</p>
          {changeable && items.length === 0 ? <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => openPicker()}>{t("team.board.add")}</button> : null}
        </div>
      ) : null}
      <div ref={gridRef} className={"team-board__grid" + (sortable.drag ? " is-arranging" : "")}>
        {shown.map((item) => {
          const size = boardSpan(item.size);
          const place = placeOf.get(item.key);
          const rule = canResize && !sortable.drag ? ruleOf(item.widget) : null;
          const [minRows, maxRows] = rule ? rule.rows(size.w) : [0, 0];
          const tall = rule !== null && minRows < maxRows;
          const wide = rule !== null && resizeMode === "both" && rule.widths.length > 1;
          // The side with room to grow: a half-width widget in the right column widens from its left edge.
          const edge: BoardResizeEdge = place !== undefined && place.col > 1 ? "start" : "end";
          const handle = (axis: BoardResizeAxis, hint: string) => (
            <span
              className={"team-board__resize team-board__resize--" + axis + (axis !== "height" && edge === "start" ? " is-start" : "")}
              aria-hidden="true"
              title={hint}
              onPointerDown={(event) => resize.beginResize(event, item.key, axis, item.size, edge)}
            >
              <span />
            </span>
          );
          return (
            <div
              key={item.key}
              data-board-key={item.key}
              className={"team-board__cell" + (sortable.drag?.key === item.key ? " is-placeholder" : "") + (sortable.settling === item.key ? " is-settling" : "") + (sizing?.key === item.key ? " is-resizing" : "")}
              style={{ "--board-w": size.w, "--board-h": size.h, "--board-col": place?.col ?? "auto", "--board-row": place?.row ?? "auto" } as CSSProperties}
            >
              {renderCard(item, false)}
              {tall ? handle("height", t("team.board.resize.heightHint")) : null}
              {wide ? handle("width", t("team.board.resize.widthHint")) : null}
              {wide && tall ? handle("both", t("team.board.resize.widthHint")) : null}
            </div>
          );
        })}
        {addable ? layout.gaps.map((gap) => (
          <div key={"gap-" + String(gap.row) + "-" + String(gap.col)} className="team-board__cell team-board__cell--slot" style={{ "--board-w": gap.w, "--board-h": gap.h, "--board-col": gap.col, "--board-row": gap.row } as CSSProperties}>
            <button type="button" className="team-board__slot" onClick={() => openPicker()}>
              {PLUS}
              {t("team.board.add")}
            </button>
          </div>
        )) : null}
      </div>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {sortable.drag && lifted && typeof document !== "undefined" ? createPortal(
        <div className="content--team team-board-drag-layer" aria-hidden="true">
          <div ref={sortable.liftedRef} className="team-board-lifted" style={{ width: sortable.drag.width, height: sortable.drag.height, transform: liftedTransform(sortable.drag.left, sortable.drag.top) }}>
            {renderCard(lifted, true)}
          </div>
        </div>,
        document.body,
      ) : null}

      <ModalPresence onDismiss={() => setPickerOpen(false)}>
        {pickerOpen && changeable ? (() => {
          // Rize's Add a Widget (2026-10-25): a list to choose from beside a live preview of the choice, drawn from this team's figures.
          const needle = pickerQuery.trim().toLocaleLowerCase();
          const offered = TEAM_BOARD_WIDGETS.filter((widget) => teamBoardWidgetOffered(widget, access));
          const matches = offered.filter((widget) => (pickerCategory === "all" || teamBoardWidgetCategory(widget) === pickerCategory)
            && (needle === "" || (titleOf(widget) + " " + t(TEAM_BOARD_WIDGET_KEYS[widget].body)).toLocaleLowerCase().includes(needle)));
          const firstFree = matches.find((widget) => teamBoardWidgetLock(widget, access) === null && !items.some((item) => item.widget === widget));
          const chosen = pickerSelected && matches.includes(pickerSelected) ? pickerSelected : firstFree ?? matches[0] ?? null;
          const lock = chosen ? teamBoardWidgetLock(chosen, access) : null;
          const added = chosen ? items.some((item) => item.widget === chosen) : false;
          const addCounts = { ...counts, projects: model.focusByProject.length };
          const chosenItem: TeamBoardItem | null = chosen ? { key: "picker-" + chosen, widget: chosen, size: teamBoardAddSize(chosen, grid, addCounts) } : null;
          const add = (widget: TeamBoardWidgetId) => {
            if (teamBoardWidgetLock(widget, access) !== null || items.some((item) => item.widget === widget)) return;
            change(addTeamBoardItem(items, widget, grid, Date.now(), addCounts));
            setPickerOpen(false);
          };
          const categories = (["projects", "people", "teams"] as const).filter((category) => offered.some((widget) => teamBoardWidgetCategory(widget) === category));
          return (
            <div className="auth-modal__overlay" {...pickerDismiss}>
              <section className="auth-modal modal-shell profile-modal team-modal team-board-picker" data-modal-variant="standard" role="dialog" aria-modal="true" aria-labelledby="team-board-picker-title" onClick={(event) => event.stopPropagation()}>
                <ModalCloseButton label={t("team.board.close")} onClick={() => setPickerOpen(false)} />
                <div className="team-board-picker__layout">
                  <div className="team-board-picker__side">
                    <div className="modal-head">
                      <div className="modal-head__copy">
                        <h2 id="team-board-picker-title">{t("team.board.add")}</h2>
                      </div>
                    </div>
                    <span className="projects-search team-board-picker__search">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                      <input className="settings-input" type="text" autoFocus placeholder={t("team.board.picker.search")} aria-label={t("team.board.picker.search")} value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} />
                    </span>
                    {categories.length > 1 ? (
                      <div className="team-board-picker__chips" role="group" aria-label={t("team.board.picker.categories")}>
                        {(["all", ...categories] as const).map((category) => (
                          <button key={category} type="button" className={"team-board-picker__chip" + (pickerCategory === category ? " on" : "")} aria-pressed={pickerCategory === category} onClick={() => setPickerCategory(category)}>
                            {t(category === "all" ? "team.board.picker.all" : CATEGORY_KEYS[category])}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="team-board-picker__list" role="listbox" aria-label={t("team.board.add")}>
                      {matches.length === 0 ? <p className="team-board-picker__empty">{t("team.board.picker.none")}</p> : null}
                      {(pickerCategory === "all" ? categories : [pickerCategory]).map((category) => {
                        const inCategory = matches.filter((widget) => teamBoardWidgetCategory(widget) === category);
                        if (inCategory.length === 0) return null;
                        return (
                          <div key={category} className="team-board-picker__group" role="group" aria-label={t(CATEGORY_KEYS[category])}>
                            {pickerCategory === "all" && categories.length > 1 ? <span className="label-mono team-board-picker__heading">{t(CATEGORY_KEYS[category])}</span> : null}
                            {inCategory.map((widget) => {
                              const widgetLock = teamBoardWidgetLock(widget, access);
                              const onBoard = items.some((item) => item.widget === widget);
                              return (
                                <button
                                  key={widget}
                                  type="button"
                                  role="option"
                                  aria-selected={chosen === widget}
                                  className={"team-board-picker__row" + (chosen === widget ? " is-selected" : "") + (widgetLock || onBoard ? " is-muted" : "")}
                                  onClick={() => setPickerSelected(widget)}
                                  onDoubleClick={() => add(widget)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      add(widget);
                                      return;
                                    }
                                    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
                                    if (step === 0) return;
                                    event.preventDefault();
                                    const next = matches[matches.indexOf(widget) + step];
                                    if (!next) return;
                                    setPickerSelected(next);
                                    (event.currentTarget.closest(".team-board-picker__list")?.querySelector<HTMLElement>('[data-widget="' + next + '"]'))?.focus();
                                  }}
                                  data-widget={widget}
                                >
                                  <span className="team-board-picker__thumb" aria-hidden="true"><TeamBoardThumb widget={widget} colors={colors} /></span>
                                  <span className="team-board-picker__name">{titleOf(widget)}</span>
                                  {widgetLock ? <span className="team-board-picker__state" title={t(LOCK_KEYS[widgetLock])}><LockIcon /></span>
                                    : onBoard ? <span className="team-board-picker__state" title={t("team.board.added")}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg></span>
                                      : null}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="team-board-picker__main">
                    {chosen && chosenItem ? (
                      <>
                        <div className="team-board-picker__about">
                          <h3>{titleOf(chosen)}</h3>
                          <p>{t(TEAM_BOARD_WIDGET_KEYS[chosen].body)}</p>
                        </div>
                        <div className="team-board-picker__stage">
                          {lock ? (
                            <div className="team-board-picker__locked"><LockIcon /><span>{t(LOCK_KEYS[lock])}</span></div>
                          ) : (
                            <BoardMiniature prefix="picker" items={[chosenItem]} grid={grid} boardWidth={boardWidth} maxWidth={520} maxHeight={300} render={renderMiniCard} />
                          )}
                        </div>
                        <div className="team-board-picker__foot">
                          <span className="team-board-picker__size">
                            {added ? t("team.board.added") : lock ? null : <><SizeGlyph size={chosenItem.size} grid={grid} />{sizeWords(chosenItem.size)}</>}
                          </span>
                          <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setPickerOpen(false)}>{t("common.cancel")}</button>
                          <button type="button" className="modal-btn modal-btn--primary" disabled={added || lock !== null} onClick={() => add(chosen)}>{t("team.board.picker.addToBoard")}</button>
                        </div>
                      </>
                    ) : <div className="team-board-picker__stage" aria-hidden="true" />}
                  </div>
                </div>
              </section>
            </div>
          );
        })() : null}
      </ModalPresence>

      <ModalPresence onDismiss={() => setNewOpen(false)}>
        {newOpen ? (
          <div className="auth-modal__overlay" {...newDismiss}>
            <section className="auth-modal modal-shell profile-modal team-modal team-board-new-dialog" data-modal-variant="standard" role="dialog" aria-modal="true" aria-labelledby="team-board-new-title" onClick={(event) => event.stopPropagation()}>
              <ModalCloseButton label={t("team.board.close")} onClick={() => setNewOpen(false)} />
              <div className="modal-head">
                <div className="modal-head__copy">
                  <h2 id="team-board-new-title">{newLabel}</h2>
                </div>
              </div>
              <div className="team-modal__body">
                <ul className="team-board-starts">
                  {newChoices.map((choice) => (
                    <li key={choice.key}>
                      <button type="button" className="team-board-start" onClick={() => { setNewOpen(false); startBoard(choice.layout, choice.name, choice.rename); }}>
                        <BoardLayoutPreview items={choice.layout} grid={grid} colors={colors} />
                        <span className="team-board-start__copy">
                          <strong>{choice.label}</strong>
                          <span>{choice.detail}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        ) : null}
      </ModalPresence>
    </div>
  );
}

/**
 * A board's layout drawn small: each widget as its picture, where it sits on
 * the grid. A blank board is an empty frame with a plus.
 */
function BoardLayoutPreview({ items, grid, colors }: { readonly items: readonly TeamBoardItem[]; readonly grid: TeamBoardGrid; readonly colors: readonly string[] }): JSX.Element {
  if (items.length === 0) return <span className="team-board-layout-preview is-blank" aria-hidden="true">{PLUS}</span>;
  const layout = layoutTeamBoard(items, grid.columns, teamBoardMinWidth(grid));
  const byKey = new Map(items.map((item) => [item.key, item] as const));
  const rows = Math.max(1, ...layout.placements.map((place) => place.row - 1 + boardSpan(byKey.get(place.key)!.size).h));
  return (
    <span className="team-board-layout-preview" aria-hidden="true" style={{ gridTemplateColumns: "repeat(" + String(grid.columns) + ", minmax(0, 1fr))", gridTemplateRows: "repeat(" + String(rows) + ", minmax(0, 1fr))" }}>
      {layout.placements.map((place) => {
        const item = byKey.get(place.key)!;
        const span = boardSpan(item.size);
        return (
          <span key={place.key} className="team-board-layout-preview__cell" style={{ gridColumn: String(place.col) + " / span " + String(span.w), gridRow: String(place.row) + " / span " + String(span.h) }}>
            <TeamBoardThumb widget={item.widget} colors={colors} />
          </span>
        );
      })}
    </span>
  );
}

/**
 * A board drawn small with its real widgets (2026-10-25): laid out at the board's own width,
 * then scaled to fit, inert so nothing in it can be pressed or focused.
 */
function BoardMiniature({ prefix, items, grid, boardWidth, maxWidth, maxHeight, render }: {
  readonly prefix: string;
  readonly items: readonly TeamBoardItem[];
  readonly grid: TeamBoardGrid;
  readonly boardWidth: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly render: (item: TeamBoardItem, prefix: string) => ReactNode;
}): JSX.Element {
  const gap = 12;
  const rowPx = grid.row.kind === "fixed" ? grid.row.rem * 16 : 120;
  const layout = layoutTeamBoard(items, grid.columns, teamBoardMinWidth(grid));
  const byKey = new Map(items.map((item) => [item.key, item] as const));
  const rows = Math.max(1, ...layout.placements.map((place) => place.row - 1 + boardSpan(byKey.get(place.key)!.size).h));
  // A single half-width widget keeps its own width rather than the whole board's.
  const columnsUsed = Math.max(1, ...layout.placements.map((place) => place.col - 1 + boardSpan(byKey.get(place.key)!.size).w));
  const column = (boardWidth - gap * (grid.columns - 1)) / grid.columns;
  const width = column * columnsUsed + gap * (columnsUsed - 1);
  const height = rows * rowPx + gap * (rows - 1);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return (
    <div className="team-board-mini" style={{ width: Math.round(width * scale), height: Math.round(height * scale) }} aria-hidden="true" ref={(node) => node?.setAttribute("inert", "")}>
      <div className="team-board-mini__canvas" style={{ width, height, transform: "scale(" + String(scale) + ")", gridTemplateColumns: "repeat(" + String(columnsUsed) + ", " + String(column) + "px)", gridAutoRows: String(rowPx) + "px", gap }}>
        {layout.placements.map((place) => {
          const item = byKey.get(place.key)!;
          const span = boardSpan(item.size);
          return (
            <div key={place.key} className="team-board-mini__cell" style={{ gridColumn: String(place.col) + " / span " + String(span.w), gridRow: String(place.row) + " / span " + String(span.h) }}>
              {render(item, prefix)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CATEGORY_KEYS: Readonly<Record<TeamBoardWidgetCategory, TranslationKey>> = {
  projects: "team.board.picker.projects",
  people: "team.board.picker.people",
  teams: "team.board.picker.teams",
};

type Translate = ReturnType<typeof useLocalization>["t"];

/**
 * A widget's content area. When a widget is sized shorter than its content,
 * it marks where more lies, above or below, so a cut edge fades instead of ending mid-row.
 * It scrolls only when its content is really taller (by more than rounding), never sideways.
 */
function BoardBody({ children }: { readonly children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const scrolls = node.scrollHeight - node.clientHeight > 2;
      node.toggleAttribute("data-scroll", scrolls);
      node.toggleAttribute("data-more", scrolls && node.scrollHeight - node.scrollTop - node.clientHeight > 2);
      node.toggleAttribute("data-scrolled", scrolls && node.scrollTop > 1);
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    if (typeof ResizeObserver === "undefined") return () => node.removeEventListener("scroll", update);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [children]);
  return <div ref={ref} className="team-board__body">{children}</div>;
}

/** The element the page scrolls in, whose visible height a screen grid divides. */
function scrollingAncestor(node: HTMLElement): HTMLElement | null {
  for (let element = node.parentElement; element; element = element.parentElement) {
    const { overflowY } = window.getComputedStyle(element);
    if (overflowY === "auto" || overflowY === "scroll") return element;
  }
  return null;
}

/** A size as its cells, or on a grid whose rows follow their widgets, as its share of the width. */
function sizeLabel(size: TeamBoardSizeId, grid: TeamBoardGrid): string {
  const { w, h } = boardSpan(size);
  if (grid.row.kind === "auto") return String(w) + "/" + String(grid.columns);
  return String(w) + "×" + String(h);
}

function sizeAria(size: TeamBoardSizeId, grid: TeamBoardGrid, t: Translate): string {
  const { w, h } = boardSpan(size);
  if (grid.row.kind === "auto") return t("team.board.sizeAriaWidth", { w, columns: grid.columns });
  return t("team.board.sizeAria", { w, h });
}

/**
 * A size as the cells it takes: the grid's columns, as many rows as its
 * tallest size, cell by cell on a coarse grid and as one shape on a fine one.
 */
function SizeGlyph({ size, grid }: { readonly size: TeamBoardSizeId; readonly grid: TeamBoardGrid }): JSX.Element {
  const { w, h } = boardSpan(size);
  const rows = Math.max(...Object.values(grid.sizes).flat().map((option) => boardSpan(option).h));
  if (grid.columns > 4 || rows > 4) {
    return (
      <svg className="team-board-size-glyph" viewBox="0 0 22 16" aria-hidden="true">
        <rect x="1" y="1" width="20" height="14" rx="1.6" />
        <rect x="1" y="1" width={(20 * w) / grid.columns} height={(14 * h) / rows} rx="1.6" className="is-on" />
      </svg>
    );
  }
  const across = 20 / grid.columns;
  // A width-only size draws as one strip across the middle.
  const down = rows === 1 ? 6 : 15 / Math.max(rows, 3);
  const top = rows === 1 ? 5 : 1;
  return (
    <svg className="team-board-size-glyph" viewBox="0 0 22 16" aria-hidden="true">
      {Array.from({ length: grid.columns * rows }, (_, index) => {
        const column = index % grid.columns;
        const row = Math.floor(index / grid.columns);
        return <rect key={index} x={1 + column * across} y={top + row * down} width={across - 1} height={down - 1} rx="0.9" className={column < w && row < h ? "is-on" : undefined} />;
      })}
    </svg>
  );
}

/**
 * A widget the scope does not share enough for: its picture, faint, the
 * reason, and for sharing an organization admin can widen, the way there.
 */
/**
 * A board's name typed in place in its tab, as Notion and Linear rename a
 * view: Enter or leaving the field keeps it, Escape puts it back. The field
 * grows with its text.
 */
function BoardNameInput({ label, initial, onDone, onCancel }: {
  readonly label: string;
  readonly initial: string;
  readonly onDone: (name: string) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const finish = (keep: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (keep) onDone(value.trim());
    else onCancel();
  };
  return (
    <span className="team-board-tab__sizer" data-value={value || initial}>
      <input
        ref={inputRef}
        className="team-board-tab__input"
        aria-label={label}
        value={value}
        maxLength={40}
        size={1}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
    </span>
  );
}

type BoardMenuEntry =
  | { readonly kind: "label"; readonly text: string }
  | { readonly kind: "separator" }
  | { readonly kind: "radio"; readonly key: string; readonly label: string; readonly ariaLabel?: string; readonly checked: boolean; readonly icon?: ReactNode; readonly onSelect: () => void }
  | { readonly kind: "item"; readonly key: string; readonly label: string; readonly detail?: string; readonly icon?: ReactNode; readonly danger?: boolean; readonly onSelect: () => void };

/**
 * A board's menus (a widget's sizes and removal, a board's visibility and
 * deletion), drawn as History's row menu. Placed on the document so a card
 * does not clip it, upward when the window has no room below.
 */
function BoardMenu({ ariaLabel, trigger, triggerClassName, entries, align = "end", menuClassName, preview }: {
  readonly ariaLabel: string;
  readonly trigger: ReactNode;
  readonly triggerClassName: string;
  readonly entries: readonly BoardMenuEntry[];
  /** Which edge of the trigger the menu lines up with: its right (the default) or its left, for a trigger at the start of a row. */
  readonly align?: "start" | "end";
  readonly menuClassName?: string;
  /** Drawn beside the items for the one under the pointer or focus, as a preview of what it makes. */
  readonly preview?: (key: string | null) => ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [position, setPosition] = useState<{ readonly top: number; readonly right: number; readonly left: number; readonly above: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const height = menuRef.current?.offsetHeight ?? 0;
    const above = rect.bottom + 4 + height > window.innerHeight - 8 && rect.top - 4 - height >= 8;
    setPosition({ top: above ? rect.top - 4 - height : rect.bottom + 4, right: document.documentElement.clientWidth - rect.right, left: rect.left, above });
  }, [open]);

  useEffect(() => {
    if (!open || !position || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const items = menuItems();
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus({ preventScroll: true });
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const down = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const key = (event: KeyboardEvent) => {
      const items = menuItems();
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next: HTMLElement | undefined;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Tab") {
        close();
        return;
      }
      if (event.key === "ArrowDown") next = items[index < 0 ? 0 : (index + 1) % items.length];
      else if (event.key === "ArrowUp") next = items[index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length];
      else if (event.key === "Home") next = items[0];
      else if (event.key === "End") next = items[items.length - 1];
      else return;
      event.preventDefault();
      next?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  const choose = (action: () => void) => {
    triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
    action();
  };
  const follow = (event: { readonly currentTarget: HTMLElement }) => event.currentTarget.focus({ preventScroll: true });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          if (open) {
            setOpen(false);
            return;
          }
          focusOnOpen.current = event.detail === 0;
          setActiveKey(null);
          setMounted(true);
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      {!mounted || typeof document === "undefined" ? null : createPortal(
        <AnchoredPresence>{open ? (
          <div ref={menuRef} className={"team-board-menu" + (menuClassName ? " " + menuClassName : "") + (preview ? " team-board-menu--with-preview" : "")} role="menu" aria-label={ariaLabel} data-placement={position?.above ? "above" : "below"} style={{ top: position?.top ?? 0, ...(align === "start" ? { left: position?.left ?? 0 } : { right: position?.right ?? 0 }), visibility: position ? undefined : "hidden" }}>
            <div className="team-board-menu__items">
            {entries.map((entry, index) => {
              if (entry.kind === "label") return <span key={"label-" + String(index)} className="label-mono team-board-menu__label" role="presentation">{entry.text}</span>;
              if (entry.kind === "separator") return <div key={"separator-" + String(index)} className="team-board-menu__separator" role="separator" />;
              if (entry.kind === "radio") {
                return (
                  <button key={entry.key} type="button" role="menuitemradio" aria-checked={entry.checked} aria-label={entry.ariaLabel} tabIndex={-1} onPointerMove={follow} onClick={() => choose(entry.onSelect)}>
                    {entry.icon}
                    <span>{entry.label}</span>
                    {entry.checked ? <svg className="team-board-menu__check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg> : null}
                  </button>
                );
              }
              return (
                <button key={entry.key} type="button" role="menuitem" tabIndex={-1} className={(entry.danger ? "danger" : "") + (preview && activeKey === entry.key ? " is-previewed" : "") || undefined} onPointerMove={follow} onFocus={() => setActiveKey(entry.key)} onClick={() => choose(entry.onSelect)}>
                  {entry.icon}
                  {entry.detail ? (
                    <span className="team-board-menu__copy">
                      <span>{entry.label}</span>
                      <small>{entry.detail}</small>
                    </span>
                  ) : entry.label}
                </button>
              );
            })}
            </div>
            {preview ? <div className="team-board-menu__preview" aria-hidden="true">{preview(activeKey)}</div> : null}
          </div>
        ) : null}</AnchoredPresence>,
        document.body,
      )}
    </>
  );
}

/** Each widget as a small picture of itself, in the team's project colors; it draws no one's figures. */
/** The four colors a widget drawing uses: the team's active projects, then the app's own. */
export function teamBoardThumbColors(projects: readonly TeamProject[]): readonly string[] {
  const active = projects.filter((project) => project.status === "active").map((project) => project.color);
  return active.length >= 4 ? active.slice(0, 4) : [...active, ...THUMB_FALLBACK].slice(0, 4);
}

export function TeamBoardThumb({ widget, colors }: { readonly widget: TeamBoardWidgetId; readonly colors: readonly string[] }): JSX.Element {
  const color = (index: number) => colors[index % colors.length]!;
  const line = (x: number, y: number, width: number, height = 3, strong = false) => <rect x={x} y={y} width={width} height={height} rx={height / 2} className={strong ? "is-strong" : "is-soft"} />;
  switch (widget) {
    case "numbers":
      return (
        <svg viewBox="0 0 160 90">
          {[0, 1, 2].map((index) => (
            <g key={index}>
              {index > 0 ? <rect x={10 + index * 48 - 6} y="26" width="1" height="38" className="is-rule" /> : null}
              {line(10 + index * 48, 30, 22)}
              {line(10 + index * 48, 40, index === 2 ? 34 : 28, 9, true)}
              {line(10 + index * 48, 56, 16)}
            </g>
          ))}
        </svg>
      );
    case "projectTrend": {
      const heights = [0.72, 0.92, 0.6, 0.06, 0, 0.84, 0.5];
      const split = [0.34, 0.26, 0.24, 0.16];
      return (
        <svg viewBox="0 0 160 90">
          {line(10, 78, 140, 1)}
          {heights.map((height, column) => {
            let top = 76;
            return split.map((part, index) => {
              const segment = height * 58 * part;
              top -= segment;
              return segment > 0 ? <rect key={column + "-" + index} x={16 + column * 19} y={top} width="11" height={segment} style={{ fill: color(index) }} /> : null;
            });
          })}
        </svg>
      );
    }
    case "projectRank":
      return (
        <svg viewBox="0 0 160 90">
          {[1, 0.86, 0.7, 0.52, 0.34].map((share, index) => (
            <g key={index}>
              <circle cx="14" cy={16 + index * 15} r="3" style={{ fill: color(index), opacity: 0.35 }} />
              {line(22, 14.5 + index * 15, 34)}
              <rect x="64" y={14 + index * 15} width="62" height="4" rx="2" className="is-track" />
              <rect x="64" y={14 + index * 15} width={62 * share} height="4" rx="2" style={{ fill: color(index) }} />
              {line(132, 14.5 + index * 15, 18, 3, true)}
            </g>
          ))}
        </svg>
      );
    case "teamCompare":
      return (
        <svg viewBox="0 0 160 90">
          {[[0.4, 0.3, 0.2], [0.25, 0.35, 0.25], [0.5, 0.2, 0.2], [0.3, 0.3, 0.3]].map((parts, row) => {
            // The ranked rows' bar: a track filled to the row's time against the largest, split by project.
            const fill = [1, 0.72, 0.55, 0.8][row]! * 76;
            let x = 52;
            return (
              <g key={row}>
                <rect x="10" y={13 + row * 18} width="8" height="8" rx="2" className="is-track" />
                {line(22, 15.5 + row * 18, 22)}
                <rect x="52" y={15 + row * 18} width="76" height="4" rx="2" className="is-track" />
                {[...parts, 1 - parts.reduce((sum, part) => sum + part, 0)].map((part, index) => {
                  const width = part * fill;
                  const segment = <rect key={index} x={x} y={15 + row * 18} width={width} height="4" style={{ fill: color(index + row) }} />;
                  x += width;
                  return segment;
                })}
                {line(134, 15.5 + row * 18, 16, 3, true)}
              </g>
            );
          })}
        </svg>
      );
    case "projectTable":
      return (
        <svg viewBox="0 0 160 90">
          {[0, 1, 2, 3, 4].map((row) => (
            <g key={row}>
              <rect x="10" y={12 + row * 15} width="5" height="5" rx="1.5" style={{ fill: row === 4 ? "var(--text-muted)" : color(row) }} />
              {line(18, 13 + row * 15, 18)}
              {[0, 1, 2, 3, 4, 5, 6].map((column) => (column === 4 || column === 5 ? (
                <rect key={column} x={42 + column * 14} y={9 + row * 15} width="11" height="10" rx="2.5" className="is-empty" />
              ) : (
                <rect key={column} x={42 + column * 14} y={9 + row * 15} width="11" height="10" rx="2.5" style={{ fill: row === 4 ? "var(--text-muted)" : color(row), opacity: row === 4 ? 0.18 : 0.18 + ((row * 5 + column * 3) % 5) * 0.1 }} />
              )))}
              {line(140, 13 + row * 15, 10, 3, true)}
            </g>
          ))}
        </svg>
      );
    case "teamProjectTable":
    case "peopleProjectTable":
      return (
        <svg viewBox="0 0 160 90">
          {[0, 1, 2, 3].map((column) => <rect key={column} x={56 + column * 22} y="8" width="14" height="3" rx="1.5" style={{ fill: color(column) }} />)}
          {[0, 1, 2, 3, 4].map((row) => (
            <g key={row}>
              {widget === "teamProjectTable" ? <rect x="10" y={18 + row * 14} width="7" height="7" rx="2" className="is-track" /> : <circle cx="13.5" cy={21.5 + row * 14} r="3.4" className="is-track" />}
              {line(21, 20 + row * 14, 22)}
              {[0, 1, 2, 3].map((column) => <rect key={column} x={54 + column * 22} y={17 + row * 14} width="18" height="10" rx="2.5" style={{ fill: color(column), opacity: 0.14 + ((row * 3 + column * 7) % 6) * 0.08 }} />)}
              {line(144, 20 + row * 14, 8, 3, true)}
            </g>
          ))}
        </svg>
      );
    case "projectDonut": {
      const parts = [0.34, 0.26, 0.2, 0.12, 0.08];
      let start = 0;
      return (
        <svg viewBox="0 0 160 90">
          {parts.map((part, index) => {
            const from = start * Math.PI * 2 - Math.PI / 2;
            start += part;
            const to = start * Math.PI * 2 - Math.PI / 2 - 0.06;
            const large = to - from > Math.PI ? 1 : 0;
            const d = "M " + String(48 + 28 * Math.cos(from)) + " " + String(45 + 28 * Math.sin(from)) + " A 28 28 0 " + String(large) + " 1 " + String(48 + 28 * Math.cos(to)) + " " + String(45 + 28 * Math.sin(to));
            return <path key={index} d={d} fill="none" strokeWidth="9" style={{ stroke: index === 4 ? "var(--text-muted)" : color(index) }} />;
          })}
          {[0, 1, 2, 3, 4].map((row) => (
            <g key={row}>
              <rect x="92" y={21 + row * 11} width="5" height="5" rx="1.5" style={{ fill: row === 4 ? "var(--text-muted)" : color(row) }} />
              {line(101, 22 + row * 11, 26)}
              {line(134, 22 + row * 11, 14, 3, true)}
            </g>
          ))}
        </svg>
      );
    }
    case "peopleBars": {
      const totals = [0.82, 0.95, 0.7, 0.88, 0.6, 0.76, 0.5];
      return (
        <svg viewBox="0 0 160 90">
          {line(10, 74, 140, 1)}
          {totals.map((total, column) => {
            let top = 72;
            return (
              <g key={column}>
                {[0.4, 0.3, 0.2, 0.1].map((part, index) => {
                  const height = total * 54 * part;
                  top -= height;
                  return <rect key={index} x={17 + column * 19} y={top} width="10" height={height} style={{ fill: color(index) }} />;
                })}
                <circle cx={22 + column * 19} cy="82" r="2.6" className="is-track" />
              </g>
            );
          })}
        </svg>
      );
    }
    case "peopleList":
      return (
        <svg viewBox="0 0 160 90">
          {[[0.4, 0.3, 0.2], [0.5, 0.2, 0.2], [0.3, 0.3, 0.3], [0.45, 0.35, 0.1], [0.25, 0.4, 0.25]].map((parts, row) => {
            const fill = [0.75, 1, 0.85, 0.6, 0.9][row]! * 70;
            let x = 56;
            return (
              <g key={row}>
                <circle cx="14" cy={15 + row * 15} r="3.4" className="is-track" />
                {line(21, 13.5 + row * 15, 24)}
                <rect x="56" y={13 + row * 15} width="70" height="4" rx="2" className="is-track" />
                {[...parts, 1 - parts.reduce((sum, part) => sum + part, 0)].map((part, index) => {
                  const width = part * fill;
                  const segment = <rect key={index} x={x} y={13 + row * 15} width={width} height="4" style={{ fill: color(index) }} />;
                  x += width;
                  return segment;
                })}
                {line(134, 13.5 + row * 15, 16, 3, true)}
              </g>
            );
          })}
        </svg>
      );
    case "peopleWeek":
      return (
        <svg viewBox="0 0 160 90">
          {[0, 1, 2, 3, 4].map((row) => (
            <g key={row}>
              <circle cx="13" cy={14 + row * 15} r="3.2" className="is-track" />
              {line(19, 12.5 + row * 15, 16)}
              {[0, 1, 2, 3, 4, 5, 6].map((column) => (column === 3 || column === 4 ? (
                <rect key={column} x={42 + column * 16} y={8 + row * 15} width="13" height="11" rx="2.5" className="is-empty" />
              ) : (
                <rect key={column} x={42 + column * 16} y={8 + row * 15} width="13" height="11" rx="2.5" style={{ fill: color((row + column) % 4), opacity: 0.22 + ((row * 3 + column * 5) % 5) * 0.09 }} />
              )))}
            </g>
          ))}
        </svg>
      );
  }
}

type Duration = (seconds: number) => string;

/** "9/21", as the day chart's axis writes dates. */
function shortDate(day: string): string {
  const [, month, date] = day.split("-");
  return String(Number(month)) + "/" + String(Number(date));
}

function deltaPercent(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}

function boardTiles(model: TeamOverviewModel, previousProjectSeconds: number, duration: Duration, t: Translate): (metric: TeamBoardMetricId) => { readonly value: string; readonly detail?: string; readonly valueTitle?: boolean } {
  const named = model.focusByProject.filter((share) => share.projectId !== null && share.seconds > 0);
  const projectSeconds = named.reduce((sum, share) => sum + share.seconds, 0);
  const unassignedSeconds = model.focusByProject.find((share) => share.projectId === null)?.seconds ?? 0;
  const top = named[0] ?? null;
  const projectDelta = describeDelta(deltaPercent(projectSeconds, previousProjectSeconds), t);
  const focusDelta = describeDelta(model.deltaPct, t);
  return (metric: TeamBoardMetricId) => {
    switch (metric) {
      case "projectTime":
        return { value: duration(projectSeconds), detail: projectDelta ?? t("team.board.numbers.projectCount", { count: named.length }) };
      case "people":
        return { value: t("team.board.peopleCount", { count: model.sharingMemberCount }), detail: t("team.board.numbers.ofMembers", { count: model.memberCount }) };
      case "topProject":
        return { value: top?.name ?? "—", valueTitle: true, detail: top ? t("team.board.numbers.topProjectDetail", { duration: duration(top.seconds), pct: projectSeconds > 0 ? Math.round((top.seconds / projectSeconds) * 100) : 0 }) : undefined };
      case "focus":
        return { value: duration(model.teamFocusSeconds), detail: focusDelta ?? undefined };
      case "dailyAverage":
        // Shared focus where the team shares it, else project time, as the Overview's average.
        return { value: model.elapsedExpectedDays > 0 ? duration(model.avgPerMemberPerDaySeconds) : "—", detail: t("team.board.numbers.dailyAverageDetail", { count: model.elapsedExpectedDays }) };
      case "unassigned": {
        const recorded = projectSeconds + unassignedSeconds;
        return { value: duration(unassignedSeconds), detail: t("team.board.numbers.unassignedDetail", { pct: recorded > 0 ? Math.round((unassignedSeconds / recorded) * 100) : 0 }) };
      }
    }
  };
}

/** The app's metric tiles: each a label, a figure and one line under it, so every tile is the same height. */
function BoardNumbers({ model, previousProjectSeconds, duration, square, metrics, onPick }: {
  readonly model: TeamOverviewModel;
  readonly previousProjectSeconds: number;
  readonly duration: Duration;
  readonly square: boolean;
  /** The tiles in order. */
  readonly metrics: readonly TeamBoardMetricId[];
  /** On a leader's own board each tile's number can be changed from a menu in the tile. */
  readonly onPick?: (index: number, metric: TeamBoardMetricId) => void;
}): JSX.Element {
  const { t } = useLocalization();
  const tile = boardTiles(model, previousProjectSeconds, duration, t);
  const choices = TEAM_BOARD_METRICS.filter((metric) => model.teamFocusVisible || !teamBoardMetricNeedsFocus(metric));
  return (
    <div className={"team-board__numbers" + (square ? " is-square" : "")}>
      {metrics.map((metric, index) => {
        const content = tile(metric);
        const label = t(METRIC_KEYS[metric]);
        return (
          <MetricTile
            key={metric}
            label={label}
            value={content.value}
            detail={content.detail}
            valueTitle={content.valueTitle}
            action={onPick ? (
              <BoardMenu
                ariaLabel={t("team.board.numbers.pick", { name: label })}
                triggerClassName="team-board__tool team-board__tile-pick"
                trigger={CHEVRON}
                entries={[
                  { kind: "label", text: t("team.board.numbers.pickTitle") },
                  ...choices.map((choice) => ({ kind: "radio" as const, key: choice, label: t(METRIC_KEYS[choice]), checked: choice === metric, onSelect: () => onPick(index, choice) })),
                ]}
              />
            ) : undefined}
          />
        );
      })}
    </div>
  );
}

function BoardProjectRows({ model, duration }: { readonly model: TeamOverviewModel; readonly duration: Duration }): JSX.Element {
  const { t } = useLocalization();
  const named = model.focusByProject.filter((share) => share.projectId !== null && share.seconds > 0);
  const unassigned = model.focusByProject.find((share) => share.projectId === null && share.seconds > 0) ?? null;
  const total = named.reduce((sum, share) => sum + share.seconds, 0);
  const max = Math.max(1, ...named.map((share) => share.seconds), unassigned?.seconds ?? 0);
  if (total <= 0) return <div className="team-empty">{t("team.focus.noProjectTime")}</div>;
  const visible = [...named.slice(0, LIST_ROWS), ...(unassigned ? [unassigned] : [])];
  return (
    <div className="drift-time-trend__sources-items team-sources">
      {visible.map((share, index) => (
        <div key={share.projectId ?? "unassigned"} className={"drift-time-trend__sources-item team-sources__item" + (share.projectId === null ? " is-unassigned" : "")} style={{ "--trend-tone": share.color ?? TEAM_UNASSIGNED_COLOR } as CSSProperties}>
          <span className="drift-time-trend__sources-rank" aria-hidden="true">{share.projectId === null ? "–" : index + 1}</span>
          <span className="drift-time-trend__sources-name">{share.name ?? t("team.focus.unassigned")}</span>
          <strong className="drift-time-trend__sources-value">{duration(share.seconds)}{share.projectId === null ? null : <span className="team-sources__pct">{Math.round((share.seconds / total) * 100)}%</span>}</strong>
          <span className="drift-source-bar" aria-hidden="true"><span className="drift-source-bar__fill" style={{ width: Math.max(3, (share.seconds / max) * 100) + "%" }} /></span>
        </div>
      ))}
      {named.length > LIST_ROWS ? <p className="team-board__more">{t("team.board.more", { count: named.length - LIST_ROWS })}</p> : null}
    </div>
  );
}

/** Teams below, by name, with their project time. */
function BoardTeamRows({ model, duration, onOpenGroup }: { readonly model: TeamOverviewModel; readonly duration: Duration; readonly onOpenGroup: (groupId: string) => void }): JSX.Element {
  const { t } = useLocalization();
  const cards = [...model.groupCards].sort((left, right) => left.group.name.localeCompare(right.group.name));
  const max = Math.max(0, ...cards.map((card) => card.projectSeconds));
  return (
    <ul className="team-board__rows team-board__rows--teams">
      {cards.map((card) => (
        <li key={card.group.id}>
          <button type="button" className="team-board__row" onClick={() => onOpenGroup(card.group.id)}>
            <span className="team-board__who">
              <TeamGroupMark name={card.group.name} size="sm" />
              <span className="team-board__name">{card.group.name}</span>
              <span className="team-board__sub">{t("team.board.peopleCount", { count: card.memberCount })}</span>
            </span>
            <BoardShareBar shares={card.projectShares} seconds={card.projectSeconds} max={max} />
            <strong className="team-board__figure">{duration(card.projectSeconds)}</strong>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The ranked project rows' bar (Today's sources) for a team or a person: a thin
 * track filled to this row's time against the largest row, the fill split by project.
 */
function BoardShareBar({ shares, seconds, max }: { readonly shares: readonly { readonly projectId: string | null; readonly color: string | null; readonly seconds: number }[]; readonly seconds: number; readonly max: number }): JSX.Element {
  return (
    <span className="drift-source-bar team-board__bar" aria-hidden="true">
      <span className="drift-source-bar__fill team-board__bar-fill" style={{ width: String(Math.max(3, (seconds / Math.max(1, max)) * 100)) + "%" }}>
        {shares.filter((share) => share.seconds > 0).map((share) => <span key={share.projectId ?? "unassigned"} style={{ flexGrow: share.seconds, background: share.color ?? TEAM_UNASSIGNED_COLOR }} />)}
      </span>
    </span>
  );
}

function BoardPeopleWeek({ model, duration, onOpenMember }: { readonly model: TeamOverviewModel; readonly duration: Duration; readonly onOpenMember: (memberKey: string) => void }): JSX.Element {
  const { effectiveLanguage: language, t } = useLocalization();
  const view = useMemo(() => buildTeamBoardPeopleWeek([...model.memberCards].sort((left, right) => left.member.display_name.localeCompare(right.member.display_name))), [model.memberCards]);
  if (view.rows.length === 0) return <div className="team-empty">{t("team.focus.noProjectTime")}</div>;
  const weekly = view.columns.some((column) => column.days.length > 1);
  return (
    <table className="team-board__table">
      <thead>
        <tr>
          <th scope="col" className="team-board__corner"><span className="sr-only">{t("team.board.person")}</span></th>
          {view.columns.map((column) => (
            <th key={column.key} scope="col" className={column.isToday ? "is-today" : undefined}>
              {weekly ? t("team.board.weekOf", { date: shortDate(column.key) }) : weekdayShortLabel(column.key, language) + " " + dayNumberLabel(column.key, language)}
            </th>
          ))}
          <th scope="col" className="team-board__total-col">{t("team.board.total")}</th>
        </tr>
      </thead>
      <tbody>
        {view.rows.map((row) => (
          <tr key={row.memberKey}>
            <th scope="row">
              <button type="button" className="team-board__person" onClick={() => onOpenMember(row.memberKey)}>
                <TeamAvatar name={row.name} size="sm" />
                <span className="team-board__name">{row.name}</span>
              </button>
            </th>
            {row.cells.map((cell, index) => {
              const column = view.columns[index]!;
              const strength = view.maxCellSeconds > 0 ? cell.seconds / view.maxCellSeconds : 0;
              return (
                <td
                  key={column.key}
                  className={(column.isFuture ? "is-future" : "") + (cell.seconds > 0 ? " has-time" : "")}
                  style={{ "--cell-tone": cell.top?.color ?? TEAM_UNASSIGNED_COLOR, "--cell-strength": String(Math.round(10 + strength * 30)) + "%" } as CSSProperties}
                  title={cell.top ? (cell.top.name ?? t("team.focus.unassigned")) + " · " + duration(cell.seconds) : undefined}
                >
                  {cell.seconds > 0 ? duration(cell.seconds) : column.isFuture ? "" : "—"}
                </td>
              );
            })}
            <td className="team-board__total-col">{row.totalSeconds > 0 ? duration(row.totalSeconds) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}


/** A project's swatch and name, as a table row or column head. */
function ProjectLabel({ tone, name }: { readonly tone: string; readonly name: string }): JSX.Element {
  return (
    <span className="team-board__label" title={name}>
      <span className="team-board__swatch" style={{ background: tone }} aria-hidden="true" />
      <span className="team-board__name">{name}</span>
    </span>
  );
}

/** A cell's tint: the row or column's color, stronger with more time, as People by day draws it. */
function cellTint(tone: string, seconds: number, max: number): CSSProperties {
  return { "--cell-tone": tone, "--cell-strength": String(Math.round(10 + (max > 0 ? seconds / max : 0) * 30)) + "%" } as CSSProperties;
}

/**
 * Project timetable (Rize's Project Timetable): the scope's projects down the
 * side, the days across (weeks in a month), each cell that project's time
 * that day; no person is named.
 */
function BoardProjectTable({ model, duration }: { readonly model: TeamOverviewModel; readonly duration: Duration }): JSX.Element {
  const { effectiveLanguage: language, t } = useLocalization();
  const table = useMemo(() => buildTeamBoardProjectTable(model.focusByDay, model.focusByDayProject), [model.focusByDay, model.focusByDayProject]);
  if (table.total <= 0) return <div className="team-empty">{t("team.focus.noProjectTime")}</div>;
  const weekly = table.columns.some((column) => column.days.length > 1);
  return (
    <table className="team-board__table team-board__table--projects">
      <thead>
        <tr>
          <th scope="col" className="team-board__corner"><span className="sr-only">{t("team.board.project")}</span></th>
          {table.columns.map((column) => (
            <th key={column.key} scope="col" className={column.isToday ? "is-today" : undefined}>
              {weekly ? t("team.board.weekOf", { date: shortDate(column.key) }) : weekdayShortLabel(column.key, language) + " " + dayNumberLabel(column.key, language)}
            </th>
          ))}
          <th scope="col" className="team-board__total-col">{t("team.board.total")}</th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => {
          const tone = row.kind === "project" ? row.share?.color ?? TEAM_UNASSIGNED_COLOR : row.kind === "other" ? OTHER_PROJECTS_COLOR : TEAM_UNASSIGNED_COLOR;
          const name = row.kind === "project" ? row.share?.name ?? "" : row.kind === "other" ? t("projects.metric.otherProjects", { count: row.count }) : t("team.focus.unassigned");
          return (
            <tr key={row.key} className={row.kind !== "project" ? "is-quiet" : undefined}>
              <th scope="row"><ProjectLabel tone={tone} name={name} /></th>
              {row.cells.map((seconds, index) => {
                const column = table.columns[index]!;
                return (
                  <td key={column.key} className={(column.isFuture ? "is-future" : "") + (seconds > 0 ? " has-time" : "")} style={cellTint(tone, seconds, table.max)}>
                    {seconds > 0 ? duration(seconds) : column.isFuture ? "" : "—"}
                  </td>
                );
              })}
              <td className="team-board__total-col">{duration(row.total)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{t("team.board.total")}</th>
          {table.totals.map((seconds, index) => <td key={table.columns[index]!.key}>{seconds > 0 ? duration(seconds) : table.columns[index]!.isFuture ? "" : "—"}</td>)}
          <td className="team-board__total-col">{duration(table.total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * Teams or people down the side and the scope's projects across (Rize's
 * saved Tracked Time view, rows by Teams or Members, columns by Projects),
 * by name. A team too small for totals keeps its name and size with empty cells.
 */
function BoardProjectMatrix({ kind, model, duration, onOpen }: {
  readonly kind: "team" | "person";
  readonly model: TeamOverviewModel;
  readonly duration: Duration;
  readonly onOpen: (key: string) => void;
}): JSX.Element {
  const { t } = useLocalization();
  const matrix = useMemo(() => buildTeamBoardProjectMatrix(
    kind === "team"
      ? model.groupCards.map((card) => ({ key: card.group.id, name: card.group.name, people: card.memberCount, shares: card.projectShares }))
      : model.memberCards.map((card) => ({ key: card.member.member_key, name: card.member.display_name, shares: card.projects })),
    model.focusByProject,
  ), [kind, model.groupCards, model.memberCards, model.focusByProject]);
  if (matrix.total <= 0) return <div className="team-empty">{t("team.focus.noProjectTime")}</div>;
  const columns = [
    ...matrix.projects.map((share) => ({ key: share.projectId ?? "", name: share.name ?? "", tone: share.color ?? TEAM_UNASSIGNED_COLOR })),
    ...(matrix.hasOther ? [{ key: "other", name: t("team.board.other"), tone: OTHER_PROJECTS_COLOR }] : []),
    ...(matrix.hasUnassigned ? [{ key: "unassigned", name: t("team.focus.unassigned"), tone: TEAM_UNASSIGNED_COLOR }] : []),
  ];
  const valuesOf = (cells: readonly number[], other: number, unassigned: number) => [...cells, ...(matrix.hasOther ? [other] : []), ...(matrix.hasUnassigned ? [unassigned] : [])];
  return (
    <table className="team-board__table team-board__table--matrix">
      <thead>
        <tr>
          <th scope="col" className="team-board__corner"><span className="sr-only">{kind === "team" ? t("team.board.team") : t("team.board.person")}</span></th>
          {columns.map((column) => <th key={column.key} scope="col"><ProjectLabel tone={column.tone} name={column.name} /></th>)}
          <th scope="col" className="team-board__total-col">{t("team.board.total")}</th>
        </tr>
      </thead>
      <tbody>
        {matrix.rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">
              <button type="button" className="team-board__person" onClick={() => onOpen(row.key)}>
                {kind === "team" ? <TeamGroupMark name={row.name} size="sm" /> : <TeamAvatar name={row.name} size="sm" />}
                <span className="team-board__name">{row.name}</span>
                {kind === "team" && row.people !== null ? <span className="team-board__sub">{t("team.board.peopleCount", { count: row.people })}</span> : null}
              </button>
            </th>
            {valuesOf(row.cells, row.other, row.unassigned).map((seconds, index) => {
              const column = columns[index]!;
              return (
                <td key={column.key} className={seconds > 0 ? "has-time" : undefined} style={cellTint(column.tone, seconds, matrix.max)}>
                  {seconds > 0 ? duration(seconds) : "—"}
                </td>
              );
            })}
            <td className="team-board__total-col">{row.total > 0 ? duration(row.total) : "—"}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{t("team.board.total")}</th>
          {valuesOf(matrix.totals, matrix.other, matrix.unassigned).map((seconds, index) => <td key={columns[index]!.key}>{seconds > 0 ? duration(seconds) : "—"}</td>)}
          <td className="team-board__total-col">{duration(matrix.total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** Project share (Rize's Project Pie Chart): the Projects page's ring, five projects named, the rest folded, unassigned last. */
function BoardProjectDonut({ model }: { readonly model: TeamOverviewModel }): JSX.Element {
  const { t } = useLocalization();
  const named = model.focusByProject.filter((share) => share.projectId !== null && share.seconds > 0);
  const unassigned = model.focusByProject.find((share) => share.projectId === null && share.seconds > 0) ?? null;
  if (named.length === 0 && !unassigned) return <div className="team-empty">{t("team.focus.noProjectTime")}</div>;
  return (
    <ProjectsSharePanel
      bare
      projects={named.map((share) => ({ id: share.projectId!, name: share.name ?? "", color: share.color ?? TEAM_UNASSIGNED_COLOR, total: share.seconds }))}
      trailing={unassigned ? { id: "unassigned", name: t("team.focus.unassigned"), color: TEAM_UNASSIGNED_COLOR, total: unassigned.seconds } : null}
      namedCount={5}
      days={0}
      caption={t("team.board.widget.projectDonut")}
    />
  );
}

/** The scope's people by name, with their project shares, for the people widgets. */
function usePeopleShares(model: TeamOverviewModel) {
  return useMemo(() => [...model.memberCards]
    .sort((left, right) => left.member.display_name.localeCompare(right.member.display_name))
    .map((card) => {
      const shares = card.projects.filter((share) => share.seconds > 0);
      return { key: card.member.member_key, name: card.member.display_name, shares, total: shares.reduce((sum, share) => sum + share.seconds, 0) };
    }), [model.memberCards]);
}

/**
 * Project time by person (Rize's Member Hours Bar Chart, grouped by member
 * and stacked by project): a column for each person by name, its height
 * their time, its parts their projects. It is the app's stacked-column chart
 * (Projects, Project time by day), with people for days, so its frame, bars,
 * hour scale and hover card match the other charts.
 */
function BoardPeopleBars({ model, onOpenMember }: { readonly model: TeamOverviewModel; readonly onOpenMember: (memberKey: string) => void }): JSX.Element {
  const { effectiveLanguage: language, t } = useLocalization();
  const people = usePeopleShares(model);
  const columns = useMemo(() => people.map((person) => ({ day: person.key, shares: person.shares })), [people]);
  const names = useMemo(() => new Map(people.map((person) => [person.key, person.name])), [people]);
  if (!people.some((person) => person.total > 0)) return <div className="team-empty">{t("team.focus.noProjectTime")}</div>;
  // A person's column opens their page, as their name does in the lists and tables.
  return <TeamTrendChart days={columns} order={model.focusByProject} language={language} ariaLabel={t("team.board.widget.peopleBarsBody")} unassignedLabel={t("team.focus.unassigned")} columnLabels={names} onSelectColumn={onOpenMember} />;
}

/** Time by person (Rize's Member Breakdown), by name rather than by time, so it does not read as a ranking. */
function BoardPeopleList({ model, duration, onOpenMember }: { readonly model: TeamOverviewModel; readonly duration: Duration; readonly onOpenMember: (memberKey: string) => void }): JSX.Element {
  const { t } = useLocalization();
  const people = usePeopleShares(model);
  const total = people.reduce((sum, person) => sum + person.total, 0);
  const max = Math.max(0, ...people.map((person) => person.total));
  if (total <= 0) return <div className="team-empty">{t("team.focus.noProjectTime")}</div>;
  return (
    <ul className="team-board__rows team-board__rows--people">
      {people.map((person) => (
        <li key={person.key}>
          <button type="button" className="team-board__row" onClick={() => onOpenMember(person.key)}>
            <span className="team-board__who">
              <TeamAvatar name={person.name} size="sm" />
              <span className="team-board__name">{person.name}</span>
            </span>
            <BoardShareBar shares={person.shares} seconds={person.total} max={max} />
            <strong className="team-board__figure">{person.total > 0 ? duration(person.total) : "—"}<span className="team-sources__pct">{Math.round((person.total / total) * 100)}%</span></strong>
          </button>
        </li>
      ))}
    </ul>
  );
}

