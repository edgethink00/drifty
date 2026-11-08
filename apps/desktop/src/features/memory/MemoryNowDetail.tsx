import { useEffect, useMemo, useState } from "react";
import type { MemoryDocPoint, MemoryNow, MemoryWikiPage } from "../screen-context/memoryWire";
import type { FlowLine } from "./memoryFlowModel";
import { citationOrder, pageEntries, pageIdsByTitle } from "./memoryWikiModel";
import type { MemoryViewShared } from "./MemoryParts";
import { Sentence, type OpenCite } from "./MemoryPageDetail";
import { FlowRow } from "./MemorySessionDetail";

/** The flow's entry for the "now" page, beside the ids of sessions. */
export const NOW_ID = "now";
const SECTIONS = ["doing", "waiting", "done"] as const;

/** The memories a "now" page may cite, by id, with their pages. */
function nowLines(pages: readonly MemoryWikiPage[]): Map<string, FlowLine> {
  const lines = new Map<string, FlowLine>();
  for (const page of pages) {
    for (const entry of pageEntries(page).current) lines.set(entry.line.id, { page, line: entry.line, earlier: entry.history.length });
  }
  return lines;
}

/** One line of the rail's "지금" entry: the first thing in progress, without link marks. */
export function nowLead(page: MemoryNow): string {
  const first = page.doing[0] ?? page.waiting[0] ?? page.done[0];
  return first ? first.text.replace(/\[\[([^\]]+)\]\]/g, "$1") : "";
}

/**
 * The "now" page: what is in progress, what is waited on and what was just
 * finished, written from the newest memories of the last two days. Every
 * sentence carries the numbers of the memories it rests on; a number opens
 * that memory, and the memory opens its page in place.
 */
export function NowDetail({ page, pages, headingId, shared, onOpenPage, onLink }: {
  readonly page: MemoryNow; readonly pages: readonly MemoryWikiPage[]; readonly headingId: string; readonly shared: MemoryViewShared;
  readonly onOpenPage: (pageId: string, lineId: string) => void; readonly onLink: (pageId: string) => void;
}) {
  const { copy, now, query } = shared;
  const numbers = useMemo(() => citationOrder([...page.doing, ...page.waiting, ...page.done]), [page]);
  const titles = useMemo(() => pageIdsByTitle(pages), [pages]);
  const lines = useMemo(() => nowLines(pages), [pages]);
  const [open, setOpen] = useState<OpenCite | null>(null);
  // Every poll decodes a new object; close the open memory only when the page is rewritten.
  useEffect(() => setOpen(null), [page.compiledAt]);
  const sentence = (point: MemoryDocPoint, key: string) => (
    <Sentence point={point} pageId={null} numbers={numbers} titles={titles} openLineId={open?.key === key ? open.lineId : null} onLink={onLink} query={query} copy={copy}
      onCite={(lineId, number) => setOpen(open?.key === key && open.lineId === lineId ? null : { key, lineId, number })} />
  );
  const shown = (key: string) => {
    const item = open?.key === key ? lines.get(open.lineId) : undefined;
    return item ? <ul className="work-memory-rows is-numbered work-memory-evidence"><FlowRow item={item} number={open!.number} shared={shared} onOpenPage={onOpenPage} /></ul> : null;
  };
  const headings = { doing: copy.nowDoing, waiting: copy.nowWaiting, done: copy.nowDone };
  return (
    <div className="work-memory-doc">
      <h2 id={headingId} className="work-memory-title">{copy.nowTitle}</h2>
      <p className="work-memory-meta">{copy.nowUpdated(copy.dayShort(page.compiledAt, now) + " " + copy.clock(page.compiledAt))}</p>
      <div className="work-memory-prose">
        {SECTIONS.filter((key) => page[key].length > 0).map((key) => (
          <section key={key} className="work-memory-prose__section">
            <h3 className="work-memory-prose__heading">{headings[key]}</h3>
            <ul className="work-memory-prose__points">
              {page[key].map((point, index) => <li key={index}>{sentence(point, key + ":" + index)}{shown(key + ":" + index)}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
