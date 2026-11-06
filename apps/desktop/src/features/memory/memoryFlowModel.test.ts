import { describe, expect, it } from "vitest";
import type { MemoryWikiLine, MemoryWikiPage } from "../screen-context/memoryWire";
import { filterFlow, flowDays } from "./memoryFlowModel";

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
let next = 0;
function line(observedAt: number, text: string, extra: Partial<MemoryWikiLine> = {}): MemoryWikiLine {
  next += 1;
  return { id: "l" + next, text, status: "current", app: "com.google.Chrome", observedAt, originalAvailable: false, originalIds: [], replaces: null, createdAt: observedAt, replacedAt: null, ...extra };
}
function page(id: string, title: string, kind: MemoryWikiPage["kind"], lines: MemoryWikiLine[]): MemoryWikiPage {
  return { id, title, kind, updatedAt: Math.max(...lines.map((item) => item.observedAt)), lines };
}

describe("memory flow", () => {
  it("groups lines seen close together into sessions by day, newest first, titled by the pages they are mostly about", () => {
    const juniper = page("p1", "Juniper", "project", [line(at(3, 9, 0), "a"), line(at(3, 9, 10), "b", { originalIds: ["s1"] }), line(at(3, 11, 0), "c")]);
    const mira = page("p2", "Mira", "person", [line(at(3, 9, 12), "d", { originalIds: ["s1"] }), line(at(2, 16, 0), "e")]);
    const days = flowDays([juniper, mira]);
    expect(days.map((day) => day.sessions.map((session) => session.title))).toEqual([["Juniper", "Juniper · Mira"], ["Mira"]]);
    const morning = days[0].sessions[1];
    expect(morning.lines.map((item) => item.line.text)).toEqual(["d", "b", "a"]);
    expect(morning.originals.map((item) => item.id)).toEqual(["s1"]);
    expect(days[0].lines).toBe(4);
  });

  it("breaks a long run of close screens into sessions of at most 45 minutes", () => {
    const steady = page("p1", "Steady", "project", Array.from({ length: 7 }, (_, index) => line(at(3, 9, index * 15), "x" + index)));
    expect(flowDays([steady])[0].sessions.map((session) => session.lines.length)).toEqual([3, 4]);
  });

  it("keeps a replaced line in the session it was seen, after what still holds, and counts what a line replaced", () => {
    const past = line(at(3, 9, 5), "old", { status: "past", replacedAt: at(3, 9, 6) });
    const now = line(at(3, 9, 0), "new", { replaces: past.id });
    const [day] = flowDays([page("p1", "Juniper", "project", [now, past])]);
    expect(day.sessions[0].lines.map((item) => [item.line.text, item.earlier])).toEqual([["new", 1], ["old", 0]]);
  });

  it("filters sessions by their lines or pages and drops days left empty", () => {
    const days = flowDays([page("p1", "Juniper", "project", [line(at(3, 9), "ship it")]), page("p2", "Mira", "person", [line(at(2, 9), "review")])]);
    expect(filterFlow(days, "mira").map((day) => day.sessions[0].title)).toEqual(["Mira"]);
    expect(filterFlow(days, "SHIP")).toHaveLength(1);
    expect(filterFlow(days, "nothing")).toEqual([]);
  });

  it("shows a note only beside exactly the lines it was written from, and finds sessions by it", () => {
    const a = line(at(4, 9, 0), "target moved"); const b = line(at(4, 9, 5), "signed off");
    const juniper = page("p1", "Juniper", "project", [a, b]);
    const note = (ids: string[], title: string) => ({ key: ids[0].padEnd(12, "0"), lineIds: ids, title, compiledAt: at(4, 10),
      summary: [{ text: "The [[Juniper]] launch moved.", lines: [ids[0]] }], points: [] });
    const [day] = flowDays([juniper], [note([b.id, a.id], "Launch moved to Monday")]);
    expect(day.sessions[0]).toMatchObject({ title: "Launch moved to Monday", note: { title: "Launch moved to Monday" } });
    expect(filterFlow([day], "moved to monday")).toHaveLength(1);
    expect(filterFlow([day], "launch moved")).toHaveLength(1);
    // A note written before a line joined the session reads as the session's lines until written again.
    const [later] = flowDays([juniper], [note([a.id], "Old note")]);
    expect(later.sessions[0]).toMatchObject({ title: "Juniper", note: null });
  });
});
