import { Fragment, useEffect, useMemo, useState } from "react";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { decodeScreenDetail } from "../screen-context/screenContextWire";
import type { MemoryDocPoint, MemorySessionNote, MemoryWikiPage } from "../screen-context/memoryWire";
import { appName, type MemoryCopy } from "./memoryCopy";
import type { FlowLine, FlowOriginal, FlowSession } from "./memoryFlowModel";
import { citationOrder, pageIdsByTitle } from "./memoryWikiModel";
import { Block, Highlight, Icon, type MemoryViewShared } from "./MemoryParts";
import { Sentence, type OpenCite } from "./MemoryPageDetail";

/** Screens shown as pictures in a session; the rest are listed by app and time. */
const PICTURED = 3;

/** "16:20–16:45", or one time for a moment. */
export function sessionRange(session: FlowSession, copy: MemoryCopy): string {
  const start = copy.clock(session.start); const end = copy.clock(session.end);
  return start === end ? start : start + "–" + end;
}

/** "Juniper release · Slack 16:20 · Changed": the page a memory went to, where it was seen, and what became of it. */
function flowLineMeta(item: FlowLine, copy: MemoryCopy): string {
  // When the line was first seen, the time its session is placed at.
  const parts = [item.page.title, appName(item.line.app) + " " + copy.clock(item.line.firstSeenAt)];
  if (item.line.status === "past") parts.push(copy.changedLater);
  else if (item.earlier > 0) parts.push(copy.changed, copy.earlier(item.earlier));
  return parts.join(" · ");
}

type Read = { readonly generation: number; readonly frame: string | null; readonly text: string };

/**
 * One kept screen as a small picture of the window, read when the session
 * opens. Without a kept frame it shows the screen's first lines of text; a
 * screen deleted meanwhile falls back to its app and time.
 */
function OriginalShot({ client, original, copy, onOpen }: {
  readonly client: ScreenContextClient; readonly original: FlowOriginal; readonly copy: MemoryCopy; readonly onOpen: () => void;
}) {
  const [read, setRead] = useState<Read | null>(null);
  useEffect(() => {
    setRead(null);
    let alive = true;
    void client.consume("screen_context_read_evidence", { recordId: original.id, includeFrame: true }, decodeScreenDetail, (value, generation) => {
      if (alive) setRead({ generation, frame: value?.frameUrl ?? null, text: value?.textEvidence.text ?? "" });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [client, original.id]);
  const shown = read && client.canDisplay(read.generation) ? read : null;
  const excerpt = shown?.text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3).join("\n") ?? "";
  return (
    <li>
      <button type="button" className="work-memory-shot" onClick={onOpen} aria-label={copy.original + " · " + appName(original.app) + " " + copy.clock(original.observedAt)}>
        <span className="work-memory-shot__frame" aria-hidden="true">
          {shown?.frame ? <img src={shown.frame} alt="" /> : excerpt ? <span className="work-memory-shot__text">{excerpt}</span> : <Icon name="image" size={18} />}
        </span>
        <span className="work-memory-shot__caption"><span>{appName(original.app)}</span><span className="work-memory-shot__time">{copy.clock(original.observedAt)}</span></span>
      </button>
    </li>
  );
}

/**
 * A session's head, set like a page's: what happened, then when and where.
 * Without a note the title is the pages it was mostly about. A session has no
 * actions of its own; its note already says what a question about it would ask.
 */
export function SessionHead({ session, headingId, shared }: {
  readonly session: FlowSession; readonly headingId: string; readonly shared: MemoryViewShared;
}) {
  const { copy, now } = shared;
  const when = copy.dayShort(session.start, now) + " " + sessionRange(session, copy);
  return (
    <>
      <h2 id={headingId} className="work-memory-title">{session.title}</h2>
      <p className="work-memory-meta">{[when, ...session.apps.map(appName)].join(" · ")}</p>
    </>
  );
}

/** One remembered line of a session; pressing it opens its page in place, at that line. */
export function FlowRow({ item, number, shared, onOpenPage }: {
  readonly item: FlowLine; readonly number?: number | null; readonly shared: MemoryViewShared; readonly onOpenPage: (pageId: string, lineId: string) => void;
}) {
  const { copy, query } = shared;
  return (
    <li className="work-memory-item">
      <button type="button" className={"work-memory-row" + (item.line.status === "past" ? " is-past" : "")} onClick={() => onOpenPage(item.page.id, item.line.id)}>
        {number ? <span className="work-memory-row__num" aria-hidden="true">{number}</span> : null}
        <span className="work-memory-row__body">
          <span className="work-memory-row__text"><Highlight text={item.line.text} query={query} /></span>
          <span className="work-memory-row__meta">{flowLineMeta(item, copy)}</span>
        </span>
        <span className="work-memory-row__end"><Icon name="chevron" size={14} /></span>
      </button>
    </li>
  );
}

/**
 * The session's note, written once the session closed: a summary, then what
 * happened, each sentence carrying the numbers of the memories it rests on.
 * One event filed on several pages is one sentence with several numbers.
 */
function SessionNote({ note, lines, pages, shared, onOpenPage, onLink }: {
  readonly note: MemorySessionNote; readonly lines: ReadonlyMap<string, FlowLine>; readonly pages: readonly MemoryWikiPage[];
  readonly shared: MemoryViewShared; readonly onOpenPage: (pageId: string, lineId: string) => void; readonly onLink: (pageId: string) => void;
}) {
  const { copy, query } = shared;
  const numbers = useMemo(() => citationOrder([...note.summary, ...note.points]), [note]);
  const titles = useMemo(() => pageIdsByTitle(pages), [pages]);
  const [open, setOpen] = useState<OpenCite | null>(null);
  // Every poll decodes a new object; close the open memory only when another note or a rewrite replaces it.
  useEffect(() => setOpen(null), [note.key, note.compiledAt]);
  const sentence = (point: MemoryDocPoint, key: string) => (
    <Sentence point={point} pageId={null} numbers={numbers} titles={titles} openLineId={open?.key === key ? open.lineId : null} onLink={onLink} query={query} copy={copy}
      onCite={(lineId, number) => setOpen(open?.key === key && open.lineId === lineId ? null : { key, lineId, number })} />
  );
  const shown = (key: string) => {
    const item = open?.key === key ? lines.get(open.lineId) : undefined;
    return item ? <ul className="work-memory-rows is-numbered work-memory-evidence"><FlowRow item={item} number={open!.number} shared={shared} onOpenPage={onOpenPage} /></ul> : null;
  };
  return (
    <div className="work-memory-prose">
      <p className="work-memory-prose__lead">
        {note.summary.map((point, index) => <Fragment key={index}>{index > 0 ? " " : null}{sentence(point, "summary")}</Fragment>)}
      </p>
      {shown("summary")}
      {note.points.length > 0 ? (
        <ul className="work-memory-prose__points">
          {note.points.map((point, index) => <li key={index}>{sentence(point, "point:" + index)}{shown("point:" + index)}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * What a session left behind. With a note: the note, then the memories it
 * was written from, folded away as numbered evidence. Without one yet: the
 * memories themselves. Each memory opens its page in place. Then the screens
 * it was read from while they are kept.
 */
export function SessionBody({ session, pages, client, shared, onOpenPage, onLink }: {
  readonly session: FlowSession; readonly pages: readonly MemoryWikiPage[]; readonly client: ScreenContextClient; readonly shared: MemoryViewShared;
  readonly onOpenPage: (pageId: string, lineId: string) => void; readonly onLink: (pageId: string) => void;
}) {
  const { copy, actions } = shared;
  const [showEvidence, setShowEvidence] = useState(false);
  useEffect(() => setShowEvidence(false), [session.id]);
  const note = session.note;
  const byId = useMemo(() => new Map(session.lines.map((item) => [item.line.id, item])), [session.lines]);
  const numbers = useMemo(() => note ? citationOrder([...note.summary, ...note.points]) : new Map<string, number>(), [note]);
  // Cited memories first in footnote order, then any the note left out.
  const ordered = useMemo(() => [...session.lines].sort((a, b) => (numbers.get(a.line.id) ?? Number.MAX_SAFE_INTEGER) - (numbers.get(b.line.id) ?? Number.MAX_SAFE_INTEGER)),
    [session.lines, numbers]);
  const pictured = session.originals.slice(0, PICTURED);
  const listed = session.originals.slice(PICTURED);
  return (
    <>
      {note ? (
        <>
          <SessionNote note={note} lines={byId} pages={pages} shared={shared} onOpenPage={onOpenPage} onLink={onLink} />
          <div className="work-memory-fold">
            <button type="button" className="work-memory-fold__toggle" aria-expanded={showEvidence} onClick={() => setShowEvidence(!showEvidence)}>
              <Icon name="chevron" size={12} />{copy.evidence}<span className="work-memory-block__count">{" " + session.lines.length}</span>
            </button>
          </div>
          {showEvidence ? (
            <Block title={copy.evidence} bare>
              <ul className="work-memory-rows is-numbered">
                {ordered.map((item) => <FlowRow key={item.page.id + item.line.id} item={item} number={numbers.get(item.line.id) ?? null} shared={shared} onOpenPage={onOpenPage} />)}
              </ul>
            </Block>
          ) : null}
        </>
      ) : (
        <Block title={copy.remembered}>
          <ul className="work-memory-rows">
            {session.lines.map((item) => <FlowRow key={item.page.id + item.line.id} item={item} shared={shared} onOpenPage={onOpenPage} />)}
          </ul>
        </Block>
      )}
      {session.originals.length > 0 ? (
        <Block title={copy.originals}>
          <ul className="work-memory-shots">
            {pictured.map((original) => <OriginalShot key={original.id} client={client} original={original} copy={copy} onOpen={() => actions.onOpenOriginal(original.id)} />)}
          </ul>
          {listed.length > 0 ? (
            <ul className="work-memory-originals">
              {listed.map((original) => (
                <li key={original.id}>
                  <button type="button" className="work-memory-original" onClick={() => actions.onOpenOriginal(original.id)}>
                    <Icon name="image" size={15} /><span>{appName(original.app)}</span><span className="work-memory-original__time">{copy.clock(original.observedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Block>
      ) : null}
    </>
  );
}
