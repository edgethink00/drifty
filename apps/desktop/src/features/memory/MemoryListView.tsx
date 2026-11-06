import { useEffect, useMemo, useState } from "react";
import type { MemoryWikiPage } from "../screen-context/memoryWire";
import { appName } from "./memoryCopy";
import { allEntries, lineState, pageMatches, type PageEntry } from "./memoryWikiModel";
import { Icon, LineDetail, TodayLabel, TodayMark, type MemoryViewShared } from "./MemoryParts";

export type ListFilter = "all" | "today" | "earlier";
export const LIST_FILTERS: readonly ListFilter[] = ["all", "today", "earlier"];

function keep(item: PageEntry, filter: ListFilter, now: Date): boolean {
  if (filter === "all") return true;
  const state = lineState(item.entry, now);
  return filter === "today" ? state.today : state.replaced > 0;
}

/** The line or its page title; the page stands in with this one line and without its document. */
function lineMatches(item: PageEntry, query: string): boolean {
  return pageMatches({ ...item.page, lines: [item.entry.line], doc: null }, query);
}

/**
 * Manage: every current memory across the wiki, newest first, for checking
 * and clearing out what the wiki kept. The page's search narrows it; its own
 * row holds the filter, which a selection replaces with the delete actions.
 * The selected memory opens its details beside the table.
 */
export function MemoryListView({ pages, filter, onFilter, busy, shared }: {
  readonly pages: readonly MemoryWikiPage[]; readonly filter: ListFilter; readonly onFilter: (filter: ListFilter) => void;
  readonly busy: boolean; readonly shared: MemoryViewShared;
}) {
  const { copy, time, now, actions, query } = shared;
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const entries = useMemo(() => allEntries(pages), [pages]);
  const matched = useMemo(() => entries.filter((item) => lineMatches(item, query)), [entries, query]);
  const counts = useMemo(() => Object.fromEntries(LIST_FILTERS.map((option) => [option, matched.filter((item) => keep(item, option, now)).length])) as Record<ListFilter, number>, [matched, now]);
  const rows = useMemo(() => matched.filter((item) => keep(item, filter, now)), [matched, filter, now]);
  // Lines deleted elsewhere drop out of the selection and the open detail.
  useEffect(() => {
    const live = new Set(entries.map((item) => item.entry.line.id));
    setChecked((previous) => [...previous].every((id) => live.has(id)) ? previous : new Set([...previous].filter((id) => live.has(id))));
    setOpenId((previous) => previous && live.has(previous) ? previous : null);
  }, [entries]);
  useEffect(() => { if (checked.size === 0) setConfirming(false); }, [checked]);
  const open = entries.find((item) => item.entry.line.id === openId) ?? null;
  const visibleIds = rows.map((item) => item.entry.line.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));
  const toggle = (id: string) => setChecked((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setChecked((previous) => {
    const next = new Set(previous);
    if (allChecked) visibleIds.forEach((id) => next.delete(id)); else visibleIds.forEach((id) => next.add(id));
    return next;
  });
  const deleteChecked = () => {
    const items = entries.filter((item) => checked.has(item.entry.line.id)).map((item) => ({ page: item.page, line: item.entry.line }));
    setConfirming(false);
    setChecked(new Set());
    actions.onDeleteLines(items);
  };
  const filterLabel = (option: ListFilter) => option === "all" ? copy.filterAll : option === "today" ? copy.filterToday : copy.filterEarlier;
  return (
    <div className={"work-memory-list-view" + (open ? " has-side" : "")} aria-busy={busy}>
      <section className="work-memory-table-pane" aria-label={copy.manage}>
        <div className="work-memory-subbar">
          {checked.size > 0 ? (
            <div className={"work-memory-bulk" + (confirming ? " is-confirming" : "")} role={confirming ? "alert" : undefined}>
              <p>{confirming ? copy.confirmLines(checked.size) : copy.selected(checked.size)}</p>
              <div className="work-memory-bulk__actions">
                {confirming ? (
                  <>
                    <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => setConfirming(false)}>{copy.cancel}</button>
                    <button type="button" className="app-btn app-btn--danger app-btn--compact" disabled={busy} onClick={deleteChecked}>{copy.confirmDelete}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="app-btn app-btn--quiet app-btn--compact" onClick={() => setChecked(new Set())}>{copy.clearSelection}</button>
                    <button type="button" className="app-btn app-btn--secondary app-btn--compact work-memory-danger-text" disabled={busy} onClick={() => setConfirming(true)}><Icon name="trash" size={14} />{copy.deleteShort}</button>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Filter chips, shaped unlike the view switch above so the two never read as one control. */
            <div className="work-memory-chips" role="radiogroup" aria-label={copy.filters}>
              {LIST_FILTERS.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={filter === option}
                  className={"work-memory-chip" + (filter === option ? " is-active" : "")} onClick={() => onFilter(option)}>
                  {filterLabel(option)}<span className="work-memory-count">{counts[option]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {rows.length === 0 ? <p className="work-memory-quiet work-memory-table-empty">{copy.listEmpty}</p> : (
          <div className="work-memory-table-scroll">
            <table className="work-memory-table">
              <thead>
                <tr>
                  <th className="work-memory-table__check"><input type="checkbox" checked={allChecked} aria-label={copy.selectAll} onChange={toggleAll} /></th>
                  <th>{copy.colText}</th>
                  <th className="work-memory-table__page">{copy.colPage}</th>
                  <th className="work-memory-table__source">{copy.colSource}</th>
                  <th className="work-memory-table__time">{copy.colTime}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const { line, history } = item.entry;
                  const isOpen = line.id === openId;
                  const today = lineState(item.entry, now).today;
                  return (
                    <tr key={line.id} className={(isOpen ? "is-open" : "") + (checked.has(line.id) ? " is-checked" : "")}>
                      <td className="work-memory-table__check"><input type="checkbox" checked={checked.has(line.id)} aria-label={copy.selectLine(line.text)} onChange={() => toggle(line.id)} /></td>
                      <td>
                        <button type="button" className="work-memory-table__line" aria-pressed={isOpen} onClick={() => setOpenId(isOpen ? null : line.id)}>
                          <TodayMark today={today} copy={copy} />
                          <span className="work-memory-line__body">
                            <span className="work-memory-line__text">{line.text}</span>
                            {history.length > 0 ? <span className="work-memory-line__meta">{copy.earlier(history.length)}</span> : null}
                          </span>
                          <TodayLabel today={today} copy={copy} />
                        </button>
                      </td>
                      <td className="work-memory-table__page">
                        <button type="button" className="work-memory-page-link" onClick={() => actions.onSelectPage(item.page.id)}>{item.page.title}</button>
                      </td>
                      <td className="work-memory-table__source">{appName(line.app)}</td>
                      <td className="work-memory-table__time">{time(line.observedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open ? <LineDetail item={open} copy={copy} time={time} retentionHours={shared.retentionHours} actions={actions} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
