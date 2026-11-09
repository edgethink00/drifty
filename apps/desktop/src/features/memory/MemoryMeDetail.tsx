import { useEffect, useMemo, useState } from "react";
import type { MemoryDocPoint, MemoryMe, MemoryWikiPage } from "../screen-context/memoryWire";
import type { FlowLine } from "./memoryFlowModel";
import { citationOrder, pageEntries, pageIdsByTitle } from "./memoryWikiModel";
import type { MemoryViewShared } from "./MemoryParts";
import { Sentence, type OpenCite } from "./MemoryPageDetail";
import { FlowRow } from "./MemorySessionDetail";

/** The rail's entry for the "about me" page, beside the ids of pages. */
export const ME_ID = "me";
const SECTIONS = ["role", "owns", "people"] as const;

function citedLines(pages: readonly MemoryWikiPage[]): Map<string, FlowLine> {
  const lines = new Map<string, FlowLine>();
  for (const page of pages) {
    for (const entry of pageEntries(page).current) lines.set(entry.line.id, { page, line: entry.line, earlier: entry.history.length });
  }
  return lines;
}

/**
 * The "about me" page: what the person does, the work they lead and who they
 * work with, as their own screens show it. The engine rewrites it at most daily
 * from two weeks of memories; every sentence carries the numbers of the
 * memories it rests on, and a memory opens its page.
 */
export function MeDetail({ page, pages, headingId, shared, onOpenPage, onLink }: {
  readonly page: MemoryMe; readonly pages: readonly MemoryWikiPage[]; readonly headingId: string; readonly shared: MemoryViewShared;
  readonly onOpenPage: (pageId: string, lineId: string) => void; readonly onLink: (pageId: string) => void;
}) {
  const { copy, now, query } = shared;
  const numbers = useMemo(() => citationOrder([...page.role, ...page.owns, ...page.people]), [page]);
  const titles = useMemo(() => pageIdsByTitle(pages), [pages]);
  const lines = useMemo(() => citedLines(pages), [pages]);
  const [open, setOpen] = useState<OpenCite | null>(null);
  useEffect(() => setOpen(null), [page.compiledAt]);
  const sentence = (point: MemoryDocPoint, key: string) => (
    <Sentence point={point} pageId={null} numbers={numbers} titles={titles} openLineId={open?.key === key ? open.lineId : null} onLink={onLink} query={query} copy={copy}
      onCite={(lineId, number) => setOpen(open?.key === key && open.lineId === lineId ? null : { key, lineId, number })} />
  );
  const shown = (key: string) => {
    const item = open?.key === key ? lines.get(open.lineId) : undefined;
    return item ? <ul className="work-memory-rows is-numbered work-memory-evidence"><FlowRow item={item} number={open!.number} shared={shared} onOpenPage={onOpenPage} /></ul> : null;
  };
  const headings = { role: copy.meRole, owns: copy.meOwns, people: copy.mePeople };
  return (
    <div className="work-memory-doc">
      <h2 id={headingId} className="work-memory-title">{copy.meTitle}</h2>
      <p className="work-memory-meta">{copy.meUpdated(copy.dayShort(page.compiledAt, now) + " " + copy.clock(page.compiledAt))}</p>
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

