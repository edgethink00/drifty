import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import { PanelResizeEdge } from "../../components/PanelResizeEdge";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { ScreenReplayViewer } from "../screen-context/ScreenReplayViewer";
import {
  decodeMemoryForgotten, decodeMemoryStatus, decodeNoteSaved, decodeWiki, decodeWikiDeleted,
  type MemoryStatus, type MemoryWiki, type MemoryWikiLine, type MemoryWikiPage,
} from "../screen-context/memoryWire";
import { MEMORY_COPY, type MemoryCopy } from "./memoryCopy";
import { filterFlow, flowDays, type FlowDay } from "./memoryFlowModel";
import { changedToday, pageEntries, pageMatches, WIKI_KIND_ORDER, wikiLinks } from "./memoryWikiModel";
import { Highlight, Icon, TodayLabel, TodayMark, useTimeFormat, type IconName, type MemoryViewShared, type PageActions } from "./MemoryParts";
import { PageDetail } from "./MemoryPageDetail";
import { SessionBody, SessionHead, sessionRange } from "./MemorySessionDetail";
import { NOW_ID, NowDetail, nowLead } from "./MemoryNowDetail";
import { ME_ID, MeDetail } from "./MemoryMeDetail";
import { requestMarkdownExport } from "./memoryExport";
import { appName } from "./memoryCopy";
import { MemoryListView, type ListFilter } from "./MemoryListView";
import { MemoryGraphView } from "./MemoryGraphView";
import { MemoryStart } from "./MemoryStart";
import type { MemoryInstaller } from "./memoryInstaller";
import "./work-memory-page.css";

const VIEW_KEY = "drifty.memory.view";
const RAIL_WIDTH_KEY = "drifty.memory.railWidth";
/**
 * The rail's width in rem, kept per computer. It never folds away: the rail
 * holds the view switch, the search and Manage. The minimum is the narrowest
 * rail whose switch keeps its icons and labels whole in Korean and English
 * (244px and 256px measured). The CSS (--memory-rail-size) holds the same
 * limits, so a narrower window narrows a wide rail without forgetting it.
 */
const RAIL_MIN_REM = 16;
const RAIL_MAX_REM = 32.5;
const MAIN_MIN_REM = 26;
const POLL_MS = 10_000;
const VIEWS = ["flow", "pages", "graph"] as const;
type View = typeof VIEWS[number];
const VIEW_ICONS: Record<View, IconName> = { flow: "flow", pages: "book", graph: "graph" };
type Bound<T> = { readonly value: T; readonly generation: number };

function readView(): View {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY);
    return VIEWS.includes(saved as View) ? saved as View : "flow";
  } catch { return "flow"; }
}

function readRailWidth(): number | null {
  try {
    const saved = Number.parseFloat(window.localStorage.getItem(RAIL_WIDTH_KEY) ?? "");
    return Number.isFinite(saved) && saved >= RAIL_MIN_REM && saved <= RAIL_MAX_REM ? saved : null;
  } catch { return null; }
}

/** The rail's width, remembered like the view; null keeps the default for the window. */
function useRailWidth() {
  const [width, setWidth] = useState<number | null>(readRailWidth);
  useEffect(() => {
    try {
      if (width === null) window.localStorage.removeItem(RAIL_WIDTH_KEY);
      else window.localStorage.setItem(RAIL_WIDTH_KEY, width.toFixed(3));
    } catch { /* The width is a convenience only. */ }
  }, [width]);
  return [width, setWidth] as const;
}

function railWidthStyle(rem: number | null): CSSProperties | undefined {
  return rem === null ? undefined : { "--memory-rail-user": rem + "rem" } as CSSProperties;
}

function orderPages(pages: readonly MemoryWikiPage[]): MemoryWikiPage[] {
  return [...pages].sort((a, b) => WIKI_KIND_ORDER.indexOf(a.kind) - WIKI_KIND_ORDER.indexOf(b.kind) || b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}

/**
 * Flow, pages and graph as one segmented control at the top of the rail, in
 * the same place in every view, state and window width. While Manage is open
 * none of the three is selected.
 */
function ViewSwitch({ view, active, onChange, disabled, copy }: {
  readonly view: View; readonly active: boolean; readonly onChange: (view: View) => void; readonly disabled: boolean; readonly copy: MemoryCopy;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = VIEWS.indexOf(view);
    const next = event.key === "Home" ? 0 : event.key === "End" ? VIEWS.length - 1
      : event.key === "ArrowRight" ? (current + 1) % VIEWS.length : event.key === "ArrowLeft" ? (current - 1 + VIEWS.length) % VIEWS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(VIEWS[next]);
    document.getElementById("memory-view-tab-" + VIEWS[next])?.focus();
  };
  return (
    <div className="work-memory-switch" role="tablist" aria-label={copy.views} onKeyDown={onKeyDown}>
      {VIEWS.map((option) => {
        const selected = active && option === view;
        return (
          <button key={option} id={"memory-view-tab-" + option} type="button" role="tab" aria-selected={selected} aria-controls="memory-view-panel"
            tabIndex={option === view ? 0 : -1} disabled={disabled} className={"work-memory-switch__option" + (selected ? " is-active" : "")} onClick={() => onChange(option)}>
            <Icon name={VIEW_ICONS[option]} size={15} /><span className="work-memory-switch__label">{copy[option]}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The flow in the rail: days, newest first, and the sessions of each. A
 * written session shows what happened and where; one not written yet shows
 * the pages it was about and its newest memory.
 */
function SessionList({ days, nowEntry, selectedId, onSelect, copy, now, query }: {
  readonly days: readonly FlowDay[]; readonly nowEntry: string | null; readonly selectedId: string | null; readonly onSelect: (id: string) => void;
  readonly copy: MemoryCopy; readonly now: Date; readonly query: string;
}) {
  if (days.length === 0 && nowEntry === null) return <p className="work-memory-quiet work-memory-rail__empty">{copy.noSession}</p>;
  return (
    <>
      {nowEntry !== null ? (
        <section className="work-memory-rail__group" aria-label={copy.nowTitle}>
          <ul>
            <li>
              <button type="button" className="work-memory-session is-now" aria-current={selectedId === NOW_ID ? "true" : undefined} onClick={() => onSelect(NOW_ID)}>
                <span className="work-memory-session__time">{copy.nowTitle}</span>
                <span className="work-memory-session__body"><span className="work-memory-session__title is-written">{nowEntry}</span></span>
              </button>
            </li>
          </ul>
        </section>
      ) : null}
      {days.map((day) => (
        <section key={day.day} className="work-memory-rail__group" aria-label={copy.day(day.day, now)}>
          <h2 className="work-memory-rail__label"><span>{copy.day(day.day, now)}</span></h2>
          <ul>
            {day.sessions.map((session) => (
              <li key={session.id}>
                <button type="button" className="work-memory-session" aria-current={session.id === selectedId ? "true" : undefined} onClick={() => onSelect(session.id)}>
                  <span className="work-memory-session__time">{copy.clock(session.start)}</span>
                  <span className="work-memory-session__body">
                    <span className={"work-memory-session__title" + (session.note ? " is-written" : "")}><Highlight text={session.title} query={query} /></span>
                    {session.note
                      ? <span className="work-memory-session__where">{session.apps.map(appName).join(" · ")}</span>
                      : <span className="work-memory-session__lead"><Highlight text={session.lead} query={query} /></span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Pages in the rail by kind; a dot marks the ones changed today. "About me", when written, leads them. */
function PageList({ pages, meEntry, selectedId, onSelect, copy, now, query }: {
  readonly pages: readonly MemoryWikiPage[]; readonly meEntry: boolean; readonly selectedId: string | null; readonly onSelect: (id: string) => void;
  readonly copy: MemoryCopy; readonly now: Date; readonly query: string;
}) {
  if (pages.length === 0) return <p className="work-memory-quiet work-memory-rail__empty">{copy.noMatch}</p>;
  return (
    <>
      {meEntry ? (
        <section className="work-memory-rail__group" aria-label={copy.meTitle}>
          <ul>
            <li>
              <button type="button" className="work-memory-rail-page is-me" aria-current={selectedId === ME_ID ? "page" : undefined} onClick={() => onSelect(ME_ID)}>
                <span className="work-memory-rail-page__name">{copy.meTitle}</span>
              </button>
            </li>
          </ul>
        </section>
      ) : null}
      {WIKI_KIND_ORDER.map((kind) => {
        const group = pages.filter((item) => item.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind} className="work-memory-rail__group" aria-label={copy.groups[kind]}>
            <h2 className="work-memory-rail__label"><span>{copy.groups[kind]}</span></h2>
            <ul>
              {group.map((item) => {
                const today = changedToday(item, now);
                return (
                  <li key={item.id}>
                    <button type="button" className="work-memory-rail-page" aria-current={item.id === selectedId ? "page" : undefined} onClick={() => onSelect(item.id)}>
                      <TodayMark today={today} copy={copy} />
                      <span className="work-memory-rail-page__name"><Highlight text={item.title} query={query} /></span>
                      <TodayLabel today={today} copy={copy} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

export function MemoryNavItem({ active, collapsed, onOpen }: { readonly active: boolean; readonly collapsed: boolean; readonly onOpen: () => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const label = MEMORY_COPY[effectiveLanguage.startsWith("ko") ? "ko" : "en"].nav;
  return (
    <button type="button" className={"nav-item" + (active ? " active" : "")} aria-current={active ? "page" : undefined} aria-description={t("common.beta")} onClick={onOpen}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
        <path d="M12 6.5C10.4 5.2 8.2 4.5 5.5 4.5H4v14h1.5c2.7 0 4.9.7 6.5 2 1.6-1.3 3.8-2 6.5-2H20v-14h-1.5c-2.7 0-4.9.7-6.5 2Z" />
        <path d="M12 6.5v14" />
      </svg>
      <span>{label}</span>
      <span className="status-badge status-badge--beta nav-item__badge" aria-hidden="true">{t("common.beta")}</span>
      {collapsed ? <span className="nav-item__hover-label" aria-hidden="true">{label}</span> : null}
    </button>
  );
}

/**
 * The Memory page, laid out around a date rail. The rail holds the view
 * switch and the one search at its top, then what to open: the work flow by
 * day, or the pages by kind. The rest of the window shows the opened session,
 * the page, or the graph of how pages link. Manage (every memory in a table,
 * for clearing out) and settings sit at the foot of the rail. Settings keeps
 * the policy; this page holds the content and its corrections. Originals open
 * in the same revalidating screen viewer Chat uses.
 */
export function MemoryPage({ client, installer, onOpenSettings, onOpenAiSettings, onOpenScreenRecording, onAskChat, graphPreview, now: nowSource = () => new Date() }: {
  readonly client: ScreenContextClient;
  /** What the start downloads; the app's own unless the browser preview passes a stand-in. */
  readonly installer?: MemoryInstaller;
  readonly onOpenSettings: () => void;
  readonly onOpenAiSettings?: () => void;
  /** Memory reads what screen recording saved; this opens recording's switch when it is off or paused. */
  readonly onOpenScreenRecording?: () => void;
  readonly onAskChat?: (prompt: string) => void;
  readonly now?: () => Date;
  /** Browser comparison only. Opens the graph on entry. */
  readonly graphPreview?: "before" | "overview" | "grouped";
}) {
  const { effectiveLanguage } = useLocalization();
  const ko = effectiveLanguage.startsWith("ko");
  const copy = MEMORY_COPY[ko ? "ko" : "en"];
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const nowRef = useRef(nowSource);
  nowRef.current = nowSource;
  const [now, setNow] = useState(() => nowRef.current());
  const time = useTimeFormat(ko, now);
  const [status, setStatus] = useState<Bound<MemoryStatus> | null>(null);
  const [wiki, setWiki] = useState<Bound<MemoryWiki> | null>(null);
  const [held, setHeld] = useState<MemoryWikiPage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [recordingStopped, setRecordingStopped] = useState(false);
  const [view, setView] = useState<View>(() => graphPreview ? "graph" : readView());
  const [managing, setManaging] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Pages opened from a session, in place of it: back returns to the session. It belongs to the session it started from.
  const [trail, setTrail] = useState<{ readonly session: string | null; readonly ids: readonly string[]; readonly at: number; readonly lineId: string | null }>(
    { session: null, ids: [], at: -1, lineId: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const mutating = useRef(false);
  const alive = useRef(true);
  const rail = useRef<HTMLDivElement | null>(null);
  const railTop = useRef<HTMLDivElement | null>(null);
  const railFoot = useRef<HTMLDivElement | null>(null);
  // The rail's own edge sizes it: a drag paints the width straight onto the page and keeps it on release.
  const [railWidth, setRailWidth] = useRailWidth();
  const pageElement = useRef<HTMLDivElement | null>(null);
  const railPanel = useRef<HTMLElement | null>(null);
  const railId = useId();
  const railPanelElement = useCallback(() => railPanel.current, []);
  const previewRail = useCallback((rem: number) => { pageElement.current?.style.setProperty("--memory-rail-user", rem + "rem"); }, []);
  // The graph runs under the rail's controls; it keeps pages out from under them.
  const [reserve, setReserve] = useState({ top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const top = railTop.current; const foot = railFoot.current;
    if (!top || !foot) return;
    const measure = () => setReserve((previous) => {
      const next = { top: Math.round(top.offsetHeight), bottom: Math.round(foot.offsetHeight) };
      return previous.top === next.top && previous.bottom === next.bottom ? previous : next;
    });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(top); observer.observe(foot);
    return () => observer.disconnect();
  }, []);
  const headingId = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const load = useCallback(async () => {
    try {
      await client.consume("memory_get_status", { includeCredentials: true }, decodeMemoryStatus, (value, generation) => { if (alive.current) setStatus({ value, generation }); });
      await client.consume("memory_wiki_pages", {}, decodeWiki, (value, generation) => { if (alive.current) setWiki({ value, generation }); });
      if (alive.current) { setFailed(false); setRecordingStopped(false); setNow(nowRef.current()); }
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : null;
      if (alive.current && code !== "screen_context_account_changed") {
        setFailed(true);
        setRecordingStopped(code === "memory_recording_required");
      }
    }
  }, [client]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!mutating.current) void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);
  // Every memory change starts a new generation and hides the old read; once
  // the new lease is ready, read again so the open page never goes blank.
  const stale = snapshot.connection === "ready" && wiki !== null && wiki.generation !== snapshot.generation;
  useEffect(() => { if (stale && !mutating.current) void load(); }, [stale, load]);

  const shownWiki = wiki && client.canDisplay(wiki.generation) ? wiki.value : null;
  const visiblePages = held ?? shownWiki?.pages ?? null;
  const notes = useMemo(() => shownWiki?.notes ?? [], [shownWiki]);
  const currentStatus = status && client.canDisplay(status.generation) ? status.value : null;
  const ordered = useMemo(() => orderPages(visiblePages ?? []), [visiblePages]);
  const legacyGraph = graphPreview === "before";
  const links = useMemo(() => wikiLinks(ordered, legacyGraph ? "all" : "unique"), [ordered, legacyGraph]);
  const filtered = useMemo(() => ordered.filter((page) => pageMatches(page, query)), [ordered, query]);
  const days = useMemo(() => flowDays(ordered, notes), [ordered, notes]);
  const shownDays = useMemo(() => filterFlow(days, query), [days, query]);
  const sessions = useMemo(() => shownDays.flatMap((day) => day.sessions), [shownDays]);
  // The flow opens on "now" when there is one; a search shows only the sessions it matches.
  const nowDoc = shownWiki?.now ?? null;
  const nowShown = nowDoc !== null && query === "";
  const nowSelected = nowShown && (sessionId === NOW_ID || sessionId === null);
  const session = nowSelected ? null : sessions.find((item) => item.id === sessionId) ?? sessions[0] ?? null;
  const flowKey = nowSelected ? NOW_ID : session?.id ?? null;
  const flowTrail = flowKey && trail.session === flowKey ? trail : null;
  const flowPage = flowTrail && flowTrail.at >= 0 ? ordered.find((item) => item.id === flowTrail.ids[flowTrail.at]) ?? null : null;
  // Pages open on "about me" when there is one, as the flow opens on "now"; a search shows only pages.
  const meDoc = shownWiki?.me ?? null;
  const meShown = meDoc !== null && query === "";
  const meSelected = meShown && (selectedId === ME_ID || selectedId === null);
  // The page opened stays open while a search narrows the list, unless the search leaves it out.
  const page = meSelected ? null : filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;
  // Beside the graph a page is open only when chosen; closing it leaves the graph alone.
  const graphPage = ordered.find((item) => item.id === selectedId) ?? null;

  const chooseView = (next: View) => {
    setView(next); setManaging(false);
    try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* The choice is a convenience only. */ }
  };
  const selectPage = useCallback((pageId: string | null) => { setSelectedId(pageId); setOpenLineId(null); }, []);
  // A memory opens on its page as the memory it is now; one replaced since opens the memory that replaced it, with its history.
  const currentLine = (pageId: string, lineId: string | null) => {
    const owner = ordered.find((item) => item.id === pageId);
    return (owner && lineId ? pageEntries(owner).current.find((entry) => entry.line.id === lineId || entry.history.some((past) => past.id === lineId)) : undefined)?.line.id ?? null;
  };
  const openPage = (pageId: string, lineId: string | null = null) => {
    selectPage(pageId); setOpenLineId(currentLine(pageId, lineId)); setQuery(""); chooseView("pages");
  };
  // In the flow a page opens in place of the session, on the same screen; back returns to the session.
  const openInFlow = (pageId: string, lineId: string | null = null) => {
    setTrail((current) => {
      const kept = current.session === flowKey ? current.ids.slice(0, current.at + 1) : [];
      const ids = [...kept, pageId].slice(-50);
      return { session: flowKey, ids, at: ids.length - 1, lineId: currentLine(pageId, lineId) };
    });
  };
  const walkFlow = (direction: -1 | 1) => setTrail((current) => {
    const at = Math.max(-1, Math.min(current.ids.length - 1, current.at + direction));
    return { ...current, at, lineId: null };
  });
  const announce = (message: string) => setNotice(message);
  const mutate = async (operation: () => Promise<void>, next: MemoryWikiPage[] | null, success: string) => {
    if (mutating.current) return;
    mutating.current = true; setBusy(true); setNotice(null);
    // Keep the page in place while the change and the fresh read complete.
    if (next) setHeld(next);
    try {
      await operation();
      await load();
      if (alive.current) announce(success);
      requestMarkdownExport();
    } catch (reason) {
      if (alive.current && !(reason instanceof Error && reason.message === "screen_context_account_changed")) announce(copy.changeFailed);
    } finally {
      mutating.current = false;
      if (alive.current) { setHeld(null); setBusy(false); }
    }
  };
  const withoutLines = (ids: ReadonlySet<string>) => ordered.map((item) => ({ ...item, lines: item.lines.filter((entry) => !ids.has(entry.id)) })).filter((item) => item.lines.length > 0);
  const deleteLines = (items: readonly { readonly page: MemoryWikiPage; readonly line: MemoryWikiLine }[], success: string) => {
    if (items.length === 0) return;
    const ids = new Set(items.map((item) => item.line.id));
    if (openLineId && ids.has(openLineId)) setOpenLineId(null);
    void mutate(async () => {
      for (const { page: owner, line } of items) await client.mutate("memory_wiki_delete", { pageId: owner.id, lineId: line.id }, decodeWikiDeleted, () => {});
    }, withoutLines(ids), success);
  };
  const actions: PageActions = {
    busy,
    announce,
    onOpenOriginal: (recordId) => setOriginal(recordId),
    onSelectPage: (pageId) => openPage(pageId),
    onAsk: onAskChat ? (item) => onAskChat(copy.askPrompt(item)) : undefined,
    onDeleteLine: (owner, line) => deleteLines([{ page: owner, line }], copy.lineDeleted),
    onDeleteLines: (items) => deleteLines(items, copy.linesDeleted(items.length)),
    onSaveNote: (owner, text) => {
      const trimmed = text.trim();
      const next = ordered.map((item) => item.id === owner.id ? { ...item, myNote: trimmed ? { text: trimmed, updatedAt: Date.now() } : null } : item);
      void mutate(() => client.mutate("memory_wiki_note", { pageId: owner.id, text: trimmed }, decodeNoteSaved, () => {}), next,
        trimmed ? copy.myNoteSaved : copy.myNoteCleared);
    },
    onDeletePage: (owner) => {
      setOpenLineId(null);
      void mutate(() => client.mutate("memory_wiki_delete", { pageId: owner.id }, decodeWikiDeleted, () => {}), ordered.filter((item) => item.id !== owner.id), copy.pageDeleted);
    },
  };
  const forgetSource = async (recordId: string) => {
    await mutate(() => client.mutate("memory_forget_source", { recordId }, decodeMemoryForgotten, () => {}), null, copy.forgotten);
  };

  const enabled = currentStatus?.preferences.enabled === true;
  const retentionHours = currentStatus?.preferences.retentionHours ?? 24;
  const hasPages = ordered.length > 0;
  // Running normally says nothing (Settings shows when memory last ran); only a stopped memory explains itself,
  // and only beside pages: an empty memory's own message already says so and offers the switch.
  const statusLine = !currentStatus || enabled || !hasPages ? null : currentStatus.supported ? copy.off : copy.unsupported;
  const shared: MemoryViewShared = { copy, time, now, actions, retentionHours, query };
  const railSelection = view === "flow" ? flowKey : view === "pages" ? (meSelected ? ME_ID : page?.id) : null;
  // Keep what is open visible in the rail when it was opened from elsewhere.
  useLayoutEffect(() => {
    rail.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView?.({ block: "nearest" });
  }, [view, railSelection]);

  // The start's own changes (recording on, memory on) each begin a new generation that hides
  // the last read until it is read again. Keep the start on screen meanwhile, so its steps
  // stay put and it is not mounted a second time halfway through.
  const startShown = useRef<{ status: MemoryStatus | null } | null>(null);
  if (visiblePages) startShown.current = hasPages ? null : { status: currentStatus ?? startShown.current?.status ?? null };
  const keepStart = !visiblePages && !failed && startShown.current !== null;
  let body;
  if (keepStart || (visiblePages && !hasPages)) {
    body = <MemoryStart client={client} installer={installer} status={currentStatus ?? startShown.current?.status ?? null} copy={copy} onOpenAiSettings={onOpenAiSettings} onChanged={load} />;
  } else if (!visiblePages) {
    body = failed && recordingStopped
      ? <div className="work-memory-state" role="alert"><p>{copy.recordingStopped}</p>
        <div className="work-memory-state__actions">
          {onOpenScreenRecording ? <button type="button" className="app-btn app-btn--primary" onClick={onOpenScreenRecording}>{copy.openRecording}</button> : null}
          <button type="button" className="app-btn app-btn--secondary" onClick={() => void load()}>{copy.retry}</button>
        </div></div>
      : failed
      ? <div className="work-memory-state" role="alert"><p>{copy.failed}</p><button type="button" className="app-btn app-btn--secondary" onClick={() => void load()}>{copy.retry}</button></div>
      : <div className="work-memory-state" role="status"><p>{copy.loading}</p></div>;
  } else if (managing) {
    body = <MemoryListView pages={ordered} filter={listFilter} onFilter={setListFilter} busy={busy} shared={shared} />;
  } else if (view === "graph") {
    body = <MemoryGraphView legacy={legacyGraph} grouped={graphPreview !== "overview"} pages={ordered} links={links} selectedId={graphPage?.id ?? null} onSelect={selectPage} reserve={reserve} headingId={headingId} shared={shared} />;
  } else if (view === "pages" && meSelected && meDoc) {
    body = <article key={ME_ID} className="work-memory-main__scroll" aria-labelledby={headingId} aria-busy={busy}>
      <MeDetail page={meDoc} pages={ordered} headingId={headingId} shared={shared}
        onOpenPage={(pageId, lineId) => openPage(pageId, lineId)} onLink={(pageId) => openPage(pageId)} />
    </article>;
  } else if (view === "pages") {
    body = page
      ? <article key={page.id} className="work-memory-main__scroll" aria-labelledby={headingId} aria-busy={busy}>
        <PageDetail page={page} pages={ordered} links={links} headingId={headingId} openLineId={openLineId} onToggleLine={setOpenLineId}
          onShowInGraph={() => { selectPage(page.id); chooseView("graph"); }} shared={shared} />
      </article>
      : <p className="work-memory-quiet work-memory-main__empty">{copy.noMatch}</p>;
  } else {
    body = flowKey
      ? <article key={flowKey + ":" + (flowPage?.id ?? "")} className="work-memory-main__scroll" aria-labelledby={headingId} aria-busy={busy}>
        {flowTrail && flowTrail.ids.length > 0 ? (
          <div className="work-memory-trail">
            <button type="button" className="work-memory-icon-btn" aria-label={copy.back} title={copy.back} disabled={flowTrail.at < 0} onClick={() => walkFlow(-1)}><Icon name="back" size={16} /></button>
            <button type="button" className="work-memory-icon-btn" aria-label={copy.forward} title={copy.forward} disabled={flowTrail.at >= flowTrail.ids.length - 1} onClick={() => walkFlow(1)}><Icon name="chevron" size={16} /></button>
            {flowPage ? <button type="button" className="work-memory-trail__session" onClick={() => setTrail((current) => ({ ...current, at: -1, lineId: null }))}>
              {session ? copy.dayShort(session.start, now) + " " + sessionRange(session, copy) + " · " + session.title : copy.nowTitle}</button> : null}
          </div>
        ) : null}
        {flowPage ? (
          <PageDetail page={flowPage} pages={ordered} links={links} headingId={headingId} openLineId={flowTrail?.lineId ?? null}
            onToggleLine={(lineId) => setTrail((current) => ({ ...current, lineId }))} onOpenPage={(pageId) => openInFlow(pageId)}
            onShowInGraph={() => { selectPage(flowPage.id); chooseView("graph"); }} shared={shared} />
        ) : session ? (
          <div className="work-memory-doc">
            <SessionHead session={session} headingId={headingId} shared={shared} />
            <SessionBody session={session} pages={ordered} client={client} shared={shared} onOpenPage={(pageId, lineId) => openInFlow(pageId, lineId)} onLink={(pageId) => openInFlow(pageId)} />
          </div>
        ) : nowDoc ? (
          <NowDetail page={nowDoc} pages={ordered} headingId={headingId} shared={shared}
            onOpenPage={(pageId, lineId) => openInFlow(pageId, lineId)} onLink={(pageId) => openInFlow(pageId)} />
        ) : null}
      </article>
      : <p className="work-memory-quiet work-memory-main__empty">{copy.noSession}</p>;
  }

  // Nothing to switch between or search until memory holds a page; while it loads the controls stay as they are.
  const idle = visiblePages !== null && !hasPages;
  // The graph is the list of pages there: the rail gives it the room and leaves its controls where they are.
  const graphing = view === "graph" && !managing && hasPages;
  return (
    <div ref={pageElement} className="page work-memory-page ph-no-capture" style={railWidthStyle(railWidth)} data-sentry-block data-clock={ko ? "24h" : "12h"}>
      {/* Like Chat, the page title is for screen readers; the rail is the page's head. */}
      <h1 className="sr-only">{copy.title}</h1>
      <div className={"work-memory-layout" + (graphing ? " is-graph" : "")}>
      <aside ref={railPanel} id={railId} className="work-memory-rail">
        <div ref={railTop} className="work-memory-rail__top">
          <ViewSwitch view={view} active={!managing} onChange={chooseView} disabled={idle} copy={copy} />
          <label className="work-memory-search">
            <Icon name="search" size={15} />
            <input type="search" value={query} placeholder={copy.search} aria-label={copy.search} disabled={idle} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        {graphing ? null : (
          <nav ref={rail} className="work-memory-rail__list" aria-label={view === "flow" ? copy.sessionList : copy.pageList}>
            {!hasPages ? null : view === "flow"
              ? <SessionList days={shownDays} nowEntry={nowShown && nowDoc ? nowLead(nowDoc) : null} selectedId={managing ? null : flowKey} copy={copy} now={now} query={query}
                onSelect={(id) => { setSessionId(id); setManaging(false); if (id === flowKey) setTrail((current) => ({ ...current, at: -1, lineId: null })); }} />
              : <PageList pages={filtered} meEntry={view === "pages" && meShown}
                selectedId={managing ? null : view === "pages" ? (meSelected ? ME_ID : page?.id ?? null) : graphPage?.id ?? null}
                onSelect={(id) => { selectPage(id); setManaging(false); }} copy={copy} now={now} query={query} />}
          </nav>
        )}
        <div ref={railFoot} className="work-memory-rail__foot">
          {statusLine ? (
            <p className="work-memory-rail__status">
              <span>{statusLine}</span>
              {currentStatus?.supported ? <button type="button" className="work-memory-link" onClick={onOpenSettings}>{copy.turnOn}</button> : null}
            </p>
          ) : null}
          <button type="button" className="work-memory-rail__foot-item" aria-pressed={managing} disabled={idle} onClick={() => setManaging((value) => !value)}><Icon name="manage" size={16} />{copy.manage}</button>
          <button type="button" className="work-memory-rail__foot-item" onClick={onOpenSettings}><Icon name="sliders" size={16} />{copy.settings}</button>
        </div>
      </aside>
      {/* Over the graph the rail is only its floating controls, with no edge to size. */}
      {graphing ? null : (
        <PanelResizeEdge
          className="work-memory-rail-edge"
          controls={railId}
          label={copy.railEdge}
          panel={railPanelElement}
          mode={{ kind: "resize", minRem: RAIL_MIN_REM, maxRem: RAIL_MAX_REM, reserveRem: MAIN_MIN_REM, onPreview: previewRail, onCommit: setRailWidth }}
        />
      )}
      <main id="memory-view-panel" className="work-memory-main" role="tabpanel" aria-labelledby={managing ? undefined : "memory-view-tab-" + view} aria-label={managing ? copy.manage : undefined}>{body}</main>
      </div>
      <p className="work-memory-page__notice" role="status" aria-live="polite">{notice}</p>
      {original ? (
        <ScreenReplayViewer client={client} source={{ kind: "evidence", recordId: original }} title={copy.viewerTitle} initialRecordId={original}
          onForgetMemory={async (recordId) => { setOriginal(null); await forgetSource(recordId); }}
          onClose={() => setOriginal(null)} onInvalidated={() => setOriginal(null)} />
      ) : null}
    </div>
  );
}
