import { Fragment, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { MAX_MY_NOTE, type MemoryDocPoint, type MemoryWikiDoc, type MemoryWikiPage } from "../screen-context/memoryWire";
import type { MemoryCopy } from "./memoryCopy";
import { pageMarkdown } from "./memoryExport";
import { citationNumbers, docEvidence, docPoints, docSegments, findEntry, linkedPages, pageEntries, pageIdsByTitle, type WikiLink } from "./memoryWikiModel";
import { Block, ConfirmPageDelete, Highlight, Icon, LineItem, MoreMenu, PageChip, type MemoryViewShared, type MenuItem } from "./MemoryParts";

/** The footnote open in a document: which sentence it sits in and which memory it shows. */
export type OpenCite = { readonly key: string; readonly lineId: string; readonly number: number };

/**
 * One sentence: its words, [[links]] to other pages, then the numbers of the
 * memories it rests on. Used by page documents and by the flow's notes.
 */
export function Sentence({ point, pageId, numbers, titles, openLineId, onLink, onCite, query, copy }: {
  readonly point: MemoryDocPoint;
  /** The page the sentence is on; a link to it reads as plain text. */
  readonly pageId: string | null;
  readonly numbers: ReadonlyMap<string, number>; readonly titles: ReadonlyMap<string, string>;
  /** The memory this sentence shows open under it, if any. */
  readonly openLineId: string | null;
  readonly onLink: (pageId: string) => void; readonly onCite: (lineId: string, number: number) => void;
  readonly query: string; readonly copy: MemoryCopy;
}) {
  const cites = [...new Map(point.lines.flatMap((id) => { const number = numbers.get(id); return number === undefined ? [] : [[number, id] as const]; })).entries()]
    .sort(([a], [b]) => a - b);
  const segments = docSegments(point.text, titles);
  // The sentence's last word and its numbers wrap together, so a number never starts a line.
  const last = segments[segments.length - 1];
  const tail = cites.length > 0 && last?.kind === "text" ? /\S+$/.exec(last.text)?.[0] ?? "" : "";
  if (tail) segments[segments.length - 1] = { kind: "text", text: last!.text.slice(0, -tail.length) };
  const numbered = cites.length > 0 ? (
    <span className="work-memory-cites-tail">
      <Highlight text={tail} query={query} />
      <sup className="work-memory-cites">
        {cites.map(([number, id], index) => (
          <Fragment key={number}>
            {index > 0 ? <span className="work-memory-cites__sep" aria-hidden="true">,</span> : null}
            <button type="button" className={"work-memory-cite" + (id === openLineId ? " is-open" : "")} aria-label={copy.cite(number)}
              aria-expanded={id === openLineId} onClick={() => onCite(id, number)}>{number}</button>
          </Fragment>
        ))}
      </sup>
    </span>
  ) : null;
  return (
    <>
      {segments.map((segment, index) => segment.kind === "text" || segment.pageId === pageId
        ? <Highlight key={index} text={segment.text} query={query} />
        : segment.pageId
          ? <button key={index} type="button" className="work-memory-wikilink" onClick={() => onLink(segment.pageId!)}><Highlight text={segment.text} query={query} /></button>
          : <span key={index} className="work-memory-wikilink is-gone" title={copy.goneLink(segment.text)}>{segment.text}</span>)}
      {numbered}
    </>
  );
}

/**
 * The page's document, written by the model from its memories only: a short
 * summary, then a few headed lists. Every sentence carries the numbers of the
 * memories it rests on; a number opens that memory right under its sentence,
 * and names in double brackets open those pages.
 */
function PageDocument({ page, doc, titles, open, onLink, onCite, evidence, query, copy }: {
  readonly page: MemoryWikiPage; readonly doc: MemoryWikiDoc; readonly titles: ReadonlyMap<string, string>; readonly open: OpenCite | null;
  readonly onLink: (pageId: string) => void; readonly onCite: (cite: OpenCite | null) => void;
  /** The opened memory, shown under the sentence that cites it. */
  readonly evidence: (cite: OpenCite) => ReactNode; readonly query: string; readonly copy: MemoryCopy;
}) {
  const numbers = useMemo(() => citationNumbers(doc), [doc]);
  const sentence = (point: MemoryDocPoint, key: string) => (
    <Sentence point={point} pageId={page.id} numbers={numbers} titles={titles} openLineId={open?.key === key ? open.lineId : null} onLink={onLink} query={query} copy={copy}
      onCite={(lineId, number) => onCite(open?.key === key && open.lineId === lineId ? null : { key, lineId, number })} />
  );
  const shown = (key: string) => open?.key === key ? evidence(open) : null;
  return (
    <div className="work-memory-prose">
      {doc.summary.length > 0 ? (
        <>
          <p className="work-memory-prose__lead">
            {doc.summary.map((point, index) => <Fragment key={index}>{index > 0 ? " " : null}{sentence(point, "summary")}</Fragment>)}
          </p>
          {shown("summary")}
        </>
      ) : null}
      {doc.sections.map((section, index) => (
        <section key={index} className="work-memory-prose__section">
          <h3 className="work-memory-prose__heading">{section.heading}</h3>
          <ul className="work-memory-prose__points">
            {section.points.map((point, at) => <li key={at}>{sentence(point, index + ":" + at)}{shown(index + ":" + at)}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Copies a page as Markdown (its document with evidence as footnotes, and the person's note) and says how it went. */
export async function copyPageMarkdown(page: MemoryWikiPage, pages: readonly MemoryWikiPage[], shared: MemoryViewShared): Promise<void> {
  const { copy, actions } = shared;
  const text = pageMarkdown(page, pages, copy);
  try {
    await navigator.clipboard.writeText(text);
    actions.announce(copy.copied);
  } catch {
    actions.announce(copy.copyFailed);
  }
}

/**
 * The person's own note on a page, under what memory wrote. No rewrite
 * changes it and no model reads it. Without one, a quiet button offers it.
 */
function MyNote({ page, editing, onEditing, shared }: {
  readonly page: MemoryWikiPage; readonly editing: boolean; readonly onEditing: (editing: boolean) => void; readonly shared: MemoryViewShared;
}) {
  const { copy, time, actions } = shared;
  const note = page.myNote ?? null;
  const [draft, setDraft] = useState(note?.text ?? "");
  useEffect(() => { if (editing) setDraft(note?.text ?? ""); }, [editing, note?.text]);
  if (!actions.onSaveNote) return null;
  const save = () => { actions.onSaveNote?.(page, draft); onEditing(false); };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onEditing(false); }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
  };
  if (editing) {
    const left = MAX_MY_NOTE - draft.length;
    return (
      <section className="work-memory-mynote is-editing" aria-label={copy.myNote}>
        <h3 className="work-memory-mynote__label">{copy.myNote}</h3>
        <textarea className="work-memory-mynote__input" value={draft} maxLength={MAX_MY_NOTE} rows={4} autoFocus
          placeholder={copy.myNotePlaceholder} aria-label={copy.myNote} onChange={(event) => setDraft(event.target.value)} onKeyDown={keys} />
        <div className="work-memory-mynote__foot">
          <span className="work-memory-mynote__left" aria-live="polite">{left <= 200 ? copy.myNoteLimit(left) : ""}</span>
          <button type="button" className="app-btn app-btn--quiet app-btn--compact" onClick={() => onEditing(false)}>{copy.cancel}</button>
          <button type="button" className="app-btn app-btn--primary app-btn--compact" disabled={actions.busy || draft.trim() === (note?.text ?? "")} onClick={save}>{copy.myNoteSave}</button>
        </div>
      </section>
    );
  }
  if (!note) {
    return <button type="button" className="work-memory-mynote-add" disabled={actions.busy} onClick={() => onEditing(true)}><Icon name="plus" size={12} />{copy.myNoteAdd}</button>;
  }
  return (
    <section className="work-memory-mynote" aria-label={copy.myNote}>
      <div className="work-memory-mynote__head">
        <h3 className="work-memory-mynote__label">{copy.myNote}</h3>
        <span className="work-memory-mynote__meta">{copy.myNoteUpdated(time(note.updatedAt))}</span>
        <button type="button" className="work-memory-mynote__edit" disabled={actions.busy} onClick={() => onEditing(true)}>{copy.myNoteEdit}</button>
      </div>
      <p className="work-memory-mynote__text">{note.text}</p>
    </section>
  );
}

/**
 * A page, read the same wherever it opens (the page list, beside the graph,
 * or from the flow): its title with one menu for its actions and when it
 * changed; its document; any memories newer than the document; the memories
 * it was written from, folded away as numbered evidence; and the linked pages
 * its document does not already name. A page of a line or two has no
 * document and reads as its memories, set as its text. Nothing above the
 * document competes with it: asking Chat sits in the menu, since the
 * document already answers the questions a button could ask.
 */
export function PageDetail({ page, pages, links, headingId, openLineId, onToggleLine, onOpenPage, onShowInGraph, shared }: {
  readonly page: MemoryWikiPage; readonly pages: readonly MemoryWikiPage[]; readonly links: readonly WikiLink[]; readonly headingId: string;
  readonly openLineId: string | null; readonly onToggleLine: (lineId: string | null) => void;
  /** Where a link to another page goes; by default the page list. */
  readonly onOpenPage?: (pageId: string) => void;
  /** Offered in the menu when the page is not already beside the graph. */
  readonly onShowInGraph?: () => void;
  readonly shared: MemoryViewShared;
}) {
  const { copy, time, now, actions, query } = shared;
  const openPage = onOpenPage ?? actions.onSelectPage;
  const [confirming, setConfirming] = useState(false);
  const [showOrphans, setShowOrphans] = useState(false);
  const [cite, setCite] = useState<OpenCite | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [noting, setNoting] = useState(false);
  useEffect(() => { setConfirming(false); setShowOrphans(false); setCite(null); setShowEvidence(false); setNoting(false); }, [page.id]);
  const { orphans } = pageEntries(page);
  const { written, pending } = docEvidence(page, pages);
  const titles = useMemo(() => pageIdsByTitle(pages), [pages]);
  const doc = page.doc ?? null;
  // Pages the document already names in its text are not listed again at its end.
  const named = useMemo(() => new Set(doc ? docPoints(doc).flatMap((point) => docSegments(point.text, titles)
    .flatMap((segment) => segment.kind === "link" && segment.pageId ? [segment.pageId] : [])) : []), [doc, titles]);
  const linked = linkedPages(page.id, pages, links).filter((item) => !named.has(item.id));
  // A memory opened from elsewhere, such as the flow, unfolds the evidence it sits in.
  const evidenceOpen = showEvidence || written.some(({ entry }) => entry.line.id === openLineId);
  const source = (owner: MemoryWikiPage) => owner.id === page.id ? null : owner.title;
  const evidence = (open: OpenCite) => {
    const found = findEntry([page, ...pages], open.lineId);
    return found ? (
      <ul className="work-memory-rows is-numbered work-memory-evidence">
        <LineItem item={found} number={open.number} open shared={shared} source={source(found.page)} onToggle={() => setCite(null)} />
      </ul>
    ) : null;
  };
  const row = (item: { readonly entry: (typeof written)[number]["entry"]; readonly page: MemoryWikiPage }, number?: number | null) => (
    <LineItem key={item.entry.line.id} item={{ page: item.page, entry: item.entry }} number={number} open={item.entry.line.id === openLineId} shared={shared}
      source={source(item.page)} onToggle={() => onToggleLine(item.entry.line.id === openLineId ? null : item.entry.line.id)} />
  );
  const menu: MenuItem[] = [
    ...(actions.onAsk ? [{ label: copy.ask, icon: "chat" as const, onSelect: () => actions.onAsk?.(page) }] : []),
    ...(onShowInGraph ? [{ label: copy.showInGraph, icon: "graph" as const, onSelect: onShowInGraph }] : []),
    ...(actions.onSaveNote ? [{ label: page.myNote ? copy.myNoteEdit : copy.myNoteAdd, icon: "plus" as const, onSelect: () => setNoting(true) }] : []),
    { label: copy.copyMarkdown, icon: "copy" as const, onSelect: () => void copyPageMarkdown(page, pages, shared) },
    { label: copy.deletePage, icon: "trash", danger: true, disabled: actions.busy, onSelect: () => setConfirming(true) },
  ];
  return (
    <div className="work-memory-doc">
      <div className="work-memory-titlebar">
        <h2 id={headingId} className="work-memory-title">{page.title}</h2>
        <MoreMenu label={copy.more} items={menu} />
      </div>
      <p className="work-memory-meta">{copy.kinds[page.kind] + " · " + copy.updated(time(page.updatedAt))}</p>
      {confirming ? <ConfirmPageDelete page={page} shared={shared} onCancel={() => setConfirming(false)} /> : null}
      {doc ? <PageDocument page={page} doc={doc} titles={titles} open={cite} onLink={openPage} onCite={setCite} evidence={evidence} query={query} copy={copy} /> : null}
      <MyNote page={page} editing={noting} onEditing={setNoting} shared={shared} />
      {pending.length > 0 ? (
        <Block title={copy.pending}>
          <ul className="work-memory-rows">{pending.map((entry) => row({ entry, page }))}</ul>
        </Block>
      ) : null}
      {doc ? (
        <div className="work-memory-fold">
          <button type="button" className="work-memory-fold__toggle" aria-expanded={evidenceOpen} onClick={() => setShowEvidence(!evidenceOpen)}>
            <Icon name="chevron" size={12} />{copy.evidence}<span className="work-memory-block__count">{" " + written.length}</span>
          </button>
        </div>
      ) : null}
      {!doc || evidenceOpen ? (
      <Block title={doc ? copy.evidence : copy.content} bare>
        <ul className={"work-memory-rows" + (doc ? " is-numbered" : " is-body")}>{written.map((item) => row(item, doc ? item.number : undefined))}</ul>
        {orphans.length > 0 ? (
          <div className="work-memory-orphans">
            <button type="button" className="work-memory-disclosure" aria-expanded={showOrphans} onClick={() => setShowOrphans((value) => !value)}>
              <Icon name="chevron" size={12} />{copy.orphans + " " + orphans.length}
            </button>
            {showOrphans ? (
              <ol className="work-memory-history">
                {orphans.map((past) => <li key={past.id}><span className="work-memory-history__text">{past.text}</span><span className="work-memory-history__meta">{time(past.replacedAt ?? past.observedAt)}</span></li>)}
              </ol>
            ) : null}
          </div>
        ) : null}
      </Block>
      ) : null}
      {linked.length > 0 ? (
        <Block title={copy.linked}>
          <ul className="work-memory-chips-row">
            {linked.map((item) => <PageChip key={item.id} page={item} now={now} copy={copy} onOpen={() => openPage(item.id)} />)}
          </ul>
        </Block>
      ) : null}
    </div>
  );
}
