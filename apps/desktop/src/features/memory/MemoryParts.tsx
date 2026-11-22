import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MemoryWikiLine, MemoryWikiPage } from "../screen-context/memoryWire";
import { appName, type MemoryCopy } from "./memoryCopy";
import { changedToday, lineState, startOfLocalDay, type PageEntry } from "./memoryWikiModel";

export type PageActions = {
  readonly busy: boolean;
  readonly onOpenOriginal: (recordId: string) => void;
  readonly onDeleteLine: (page: MemoryWikiPage, line: MemoryWikiLine) => void;
  readonly onDeleteLines: (items: readonly { readonly page: MemoryWikiPage; readonly line: MemoryWikiLine }[]) => void;
  readonly onDeletePage: (page: MemoryWikiPage) => void;
  /** Sets the person's own note on a page; blank text removes it. */
  readonly onSaveNote?: (page: MemoryWikiPage, text: string) => void;
  readonly onAsk?: (page: MemoryWikiPage) => void;
  readonly onSelectPage: (pageId: string) => void;
  /** A short message in the page's notice, such as a finished copy. */
  readonly announce: (message: string) => void;
};

export type TimeFormat = (ms: number) => string;

export type MemoryViewShared = {
  readonly copy: MemoryCopy; readonly time: TimeFormat; readonly now: Date; readonly actions: PageActions; readonly retentionHours: number;
  /** The page's one search, applied by each view to what it shows. */
  readonly query: string;
};

export function useTimeFormat(ko: boolean, now: Date): TimeFormat {
  return useCallback((ms: number) => {
    const locale = ko ? "ko-KR" : "en-US";
    const clock = new Date(ms).toLocaleTimeString(locale, ko ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : { hour: "numeric", minute: "2-digit" });
    const today = startOfLocalDay(now);
    if (ms >= today) return (ko ? "오늘 " : "Today ") + clock;
    if (ms >= today - 86_400_000) return (ko ? "어제 " : "Yesterday ") + clock;
    return new Date(ms).toLocaleDateString(locale, { month: "short", day: "numeric" });
  }, [ko, now]);
}

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export type IconName = "search" | "trash" | "close" | "chat" | "chevron" | "down" | "back" | "image" | "book" | "flow" | "manage" | "graph" | "sliders" | "plus" | "minus" | "fit" | "copy" | "more"
  | "replay" | "play" | "pause";

export function Icon({ name, size = 16 }: { readonly name: IconName; readonly size?: number }) {
  const paths: Record<IconName, string[]> = {
    search: ["M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z", "M20 20l-4-4"],
    trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12", "M9 7V4h6v3"],
    close: ["M6 6l12 12", "M18 6L6 18"],
    chat: ["M5 18.5V6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3Z"],
    chevron: ["M9 6l6 6-6 6"],
    down: ["M6 9l6 6 6-6"],
    back: ["M15 6l-6 6 6 6"],
    image: ["M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Z", "M4.5 16l4.5-4.5 4 4 2.5-2.5 4 4", "M15 9.5h.01"],
    book: ["M12 6.5C10.4 5.2 8.2 4.5 5.5 4.5H4v14h1.5c2.7 0 4.9.7 6.5 2 1.6-1.3 3.8-2 6.5-2H20v-14h-1.5c-2.7 0-4.9.7-6.5 2Z", "M12 6.5v14"],
    flow: ["M20 10.5V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h4.5", "M8 3v4", "M16 3v4", "M4 10h6", "M16.5 21a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z", "M16.5 14.8v1.9l1.2 1"],
    manage: ["M4 6.5l1.5 1.5L8 5.5", "M4 12.5l1.5 1.5L8 11.5", "M4 18.5l1.5 1.5L8 17.5", "M11.5 7h8.5", "M11.5 13h8.5", "M11.5 19h8.5"],
    graph: ["M6 9a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 6 9Z", "M18 8a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 18 8Z", "M12 20a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z", "M8.2 6.6l7.6-.7", "M7.1 8.9l3.8 6.8", "M16.9 7.9l-3.8 7.8"],
    sliders: ["M4 8h8", "M16 8h4", "M14 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z", "M4 16h3", "M11 16h9", "M9 14a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"],
    plus: ["M12 5v14", "M5 12h14"],
    minus: ["M5 12h14"],
    fit: ["M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9", "M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9", "M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15", "M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"],
    more: ["M5.75 12h.5", "M11.75 12h.5", "M17.75 12h.5"],
    replay: ["M5 12a7 7 0 1 0 2.05-4.95L5 9", "M5 5v4h4", "M10.75 9.6v4.8l3.9-2.4Z"],
    play: ["M8.5 6.6v10.8a.6.6 0 0 0 .92.5l8.5-5.4a.6.6 0 0 0 0-1l-8.5-5.4a.6.6 0 0 0-.92.5Z"],
    pause: ["M9 6.5v11", "M15 6.5v11"],
    copy: ["M9 10.5A1.5 1.5 0 0 1 10.5 9h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5Z", "M15 9V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H9"],
  };
  return <svg viewBox="0 0 24 24" width={size} height={size} {...STROKE} aria-hidden="true">{paths[name].map((d) => <path key={d} d={d} />)}</svg>;
}

/**
 * The one colour on this page: a green dot for a page or memory the wiki
 * updated today. The slot is kept when empty so names and lines stay aligned.
 * The dot is decoration; callers say it in words with TodayLabel.
 */
export function TodayMark({ today, copy }: { readonly today: boolean; readonly copy: MemoryCopy }) {
  return <span className={"work-memory-mark" + (today ? " is-today" : "")} aria-hidden="true" title={today ? copy.updatedToday : undefined} />;
}

export function TodayLabel({ today, copy }: { readonly today: boolean; readonly copy: MemoryCopy }) {
  return today ? <span className="sr-only">{" · " + copy.updatedToday}</span> : null;
}

/**
 * Text with the search's matches marked, so a result shows why it matched.
 * Matching ignores case like the search itself; without a search it is the text.
 */
export function Highlight({ text, query }: { readonly text: string; readonly query: string }) {
  const wanted = query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const lower = text.toLocaleLowerCase();
  // A case change that alters the length would misplace the marks; such text is shown as it is.
  if (!wanted || lower.length !== text.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (let found = lower.indexOf(wanted); found >= 0; found = lower.indexOf(wanted, at)) {
    if (found > at) parts.push(text.slice(at, found));
    parts.push(<mark key={found} className="work-memory-hit">{text.slice(found, found + wanted.length)}</mark>);
    at = found + wanted.length;
  }
  if (at === 0) return <>{text}</>;
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** "Chrome · Today 15:39 · 2 earlier versions", after the page it is on when that is another page. */
export function lineMeta(item: PageEntry, time: TimeFormat, copy: MemoryCopy, source: string | null = null): string {
  const parts = [...(source ? [source] : []), appName(item.entry.line.app), time(item.entry.line.observedAt)];
  if (item.entry.history.length > 0) parts.push(copy.earlier(item.entry.history.length));
  return parts.join(" · ");
}

/**
 * A titled block of a page or session. A bare block keeps its name for
 * assistive technology but shows no head, when a toggle above it already says
 * what it is or its content speaks for itself.
 */
export function Block({ title, bare = false, children }: {
  readonly title: string; readonly bare?: boolean; readonly children: ReactNode;
}) {
  return (
    <section className={"work-memory-block" + (bare ? " is-bare" : "")} aria-label={title}>
      {bare ? null : (
        <div className="work-memory-block__head">
          <h3 className="work-memory-block__title">{title}</h3>
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A page's memory. Pressing it opens its original and earlier versions right
 * under it, so a page reads top to bottom without a third column. Under a
 * document it carries the footnote number the document cites it by, and the
 * page it is on when a person's or topic's document cites another page.
 */
export function LineItem({ item, open, onToggle, shared, number, source = null }: {
  readonly item: PageEntry; readonly open: boolean; readonly onToggle: () => void; readonly shared: MemoryViewShared;
  readonly number?: number | null;
  readonly source?: string | null;
}) {
  const { copy, time, now, actions, query } = shared;
  const detailId = useId();
  const { page, entry } = item;
  const { line, history } = entry;
  const today = lineState(entry, now).today;
  const original = line.originalIds[0];
  return (
    <li className={"work-memory-item" + (open ? " is-open" : "")}>
      <button type="button" className="work-memory-row" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={onToggle}>
        {number ? <span className="work-memory-row__num" aria-hidden="true">{number}</span> : <TodayMark today={today} copy={copy} />}
        <span className="work-memory-row__body">
          <span className="work-memory-row__text"><Highlight text={line.text} query={query} /></span>
          <span className="work-memory-row__meta">{lineMeta(item, time, copy, source)}</span>
        </span>
        <TodayLabel today={today} copy={copy} />
        <span className="work-memory-row__end"><Icon name="down" size={14} /></span>
      </button>
      {open ? (
        <div id={detailId} className="work-memory-item__detail" role="region" aria-label={copy.lineDetail}>
          <div className="work-memory-actions">
            {original ? <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => actions.onOpenOriginal(original)}><Icon name="image" size={14} />{copy.original}</button> : null}
            <button type="button" className="app-btn app-btn--quiet app-btn--compact work-memory-danger-text" disabled={actions.busy} onClick={() => actions.onDeleteLine(page, line)}>
              <Icon name="trash" size={14} />{copy.deleteLine}
            </button>
          </div>
          {original ? null : <p className="work-memory-quiet">{copy.originalGone}</p>}
          {history.length > 0 ? (
            <ol className="work-memory-history" aria-label={copy.history}>
              {history.map((past) => (
                <li key={past.id}><span className="work-memory-history__text">{past.text}</span><span className="work-memory-history__meta">{past.replacedAt ? copy.replacedAt(time(past.replacedAt)) : time(past.observedAt)}</span></li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export type MenuItem = { readonly label: string; readonly icon: IconName; readonly danger?: boolean; readonly disabled?: boolean; readonly onSelect: () => void };

/**
 * A "more" button with a short menu under it, for actions that need not sit
 * on the screen at all times. Escape or a click elsewhere closes it; the
 * arrow keys move between items.
 */
export function MoreMenu({ label, items }: { readonly label: string; readonly items: readonly MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("[role='menuitem']:not(:disabled)")?.focus();
    const onDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === "Escape") {
      // Closing the menu is all Escape does here; the panel behind it stays open.
      event.preventDefault(); event.stopPropagation();
      setOpen(false); root.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const entries = [...(root.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)") ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    entries[(at + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length]?.focus();
  };
  return (
    <div ref={root} className="work-memory-menu" onKeyDown={onKeyDown}>
      <button type="button" className="work-memory-icon-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon name="more" size={17} />
      </button>
      {open ? (
        <div className="work-memory-menu__list" role="menu" aria-label={label}>
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" className={"work-memory-menu__item" + (item.danger ? " is-danger" : "")} disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}>
              <Icon name={item.icon} size={15} />{item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Asking before a page goes: the page's memories go with it, its original screens and activity stay. */
export function ConfirmPageDelete({ page, shared, onCancel }: { readonly page: MemoryWikiPage; readonly shared: MemoryViewShared; readonly onCancel: () => void }) {
  const { copy, actions } = shared;
  return (
    <div className="work-memory-confirm" role="alert">
      <p>{copy.confirmPage(page.title)}</p>
      <div className="work-memory-confirm__actions">
        <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onCancel}>{copy.cancel}</button>
        <button type="button" className="app-btn app-btn--danger app-btn--compact" disabled={actions.busy} onClick={() => { onCancel(); actions.onDeletePage(page); }}>{copy.confirmDelete}</button>
      </div>
    </div>
  );
}

/** Another page by name and kind; it opens that page. */
export function PageChip({ page, now, copy, onOpen }: { readonly page: MemoryWikiPage; readonly now: Date; readonly copy: MemoryCopy; readonly onOpen: () => void }) {
  const today = changedToday(page, now);
  return (
    <li>
      <button type="button" className="work-memory-chip-link" onClick={onOpen}>
        <TodayMark today={today} copy={copy} />
        <span className="work-memory-chip-link__name">{page.title}</span>
        <span className="work-memory-chip-link__kind">{copy.kinds[page.kind]}</span>
        <TodayLabel today={today} copy={copy} />
      </button>
    </li>
  );
}

/** The top row of the side panel: where the memory lives on the left, close on the right. */
export function PanelHead({ start, end }: { readonly start: ReactNode; readonly end: ReactNode }) {
  return <div className="work-memory-head">{start}<div className="work-memory-head__end">{end}</div></div>;
}

/**
 * One memory with where it came from and what it replaced, beside the Manage
 * table: its page, the sentence, its source, actions, then earlier versions.
 */
export function LineDetail({ item, copy, time, retentionHours, actions, onClose }: {
  readonly item: PageEntry; readonly copy: MemoryCopy; readonly time: TimeFormat; readonly retentionHours: number;
  readonly actions: PageActions; readonly onClose: () => void;
}) {
  const { page, entry } = item;
  const { line, history } = entry;
  const original = line.originalIds[0];
  return (
    <aside className="work-memory-side" aria-label={copy.lineDetail}>
      <PanelHead
        start={<button type="button" className="work-memory-page-link" onClick={() => actions.onSelectPage(page.id)}>{page.title}</button>}
        end={<button type="button" className="work-memory-icon-btn" aria-label={copy.closeDetail} title={copy.closeDetail} onClick={onClose}><Icon name="close" size={15} /></button>} />
      <p className="work-memory-side__text">{line.text}</p>
      <p className="work-memory-meta">{appName(line.app) + " · " + time(line.observedAt)}</p>
      <div className="work-memory-actions">
        {original ? <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => actions.onOpenOriginal(original)}><Icon name="image" size={14} />{copy.original}</button> : null}
        <button type="button" className="app-btn app-btn--quiet app-btn--compact work-memory-danger-text" disabled={actions.busy} onClick={() => actions.onDeleteLine(page, line)}>
          <Icon name="trash" size={14} />{copy.deleteLine}
        </button>
      </div>
      <p className="work-memory-quiet work-memory-note">{original ? copy.originalKept(retentionHours) : copy.originalGone}</p>
      {history.length > 0 ? (
        <Block title={copy.history}>
          <ol className="work-memory-history">
            {history.map((past) => (
              <li key={past.id}><span className="work-memory-history__text">{past.text}</span><span className="work-memory-history__meta">{past.replacedAt ? copy.replacedAt(time(past.replacedAt)) : time(past.observedAt)}</span></li>
            ))}
          </ol>
        </Block>
      ) : null}
    </aside>
  );
}
