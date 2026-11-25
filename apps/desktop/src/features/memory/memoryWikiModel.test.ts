import { describe, expect, it } from "vitest";
import type { MemoryWikiDoc, MemoryWikiLine, MemoryWikiPage } from "../screen-context/memoryWire";
import { graphOverview, groupLinkTargets, layoutGraph } from "./memoryGraphLayout";
import { docEvidence, docMarkdown, docSegments, findEntry, lineState, linkedPages, pageBornAt, pageEntries, pageIdsByTitle, pageMatches, replayOrder, wikiLinks } from "./memoryWikiModel";

const NOW = new Date(2026, 10, 3, 12, 0);
const at = (hours: number, minutes = 0) => new Date(2026, 10, 3, hours, minutes).getTime();
let next = 0;
function line(text: string, extra: Partial<MemoryWikiLine> = {}): MemoryWikiLine {
  next += 1;
  return { id: next.toString(16).padStart(12, "0"), text, status: "current", app: "com.google.Chrome", observedAt: at(9), firstSeenAt: at(9), originalAvailable: false,
    originalIds: [], replaces: null, createdAt: at(9), replacedAt: null, ...extra };
}
function page(id: string, title: string, kind: MemoryWikiPage["kind"], lines: MemoryWikiLine[]): MemoryWikiPage {
  return { id, title, kind, updatedAt: Math.max(...lines.map((item) => item.replacedAt ?? item.createdAt ?? 0)), lines };
}

describe("work memory wiki model", () => {
  it("puts each current line before the chain it replaced and keeps unlinked history readable", () => {
    const oldest = line("Target date not agreed.", { status: "past", replacedAt: at(10) });
    const friday = line("Target date is Friday.", { status: "past", replaces: oldest.id, replacedAt: at(11) });
    const monday = line("Target date is Monday.", { replaces: friday.id, createdAt: at(11) });
    const orphan = line("Blocked on the webhook fix.", { status: "past", replacedAt: at(10) });
    const { current, orphans } = pageEntries(page("aaaaaaaaaaaa", "Juniper release", "project", [monday, friday, oldest, orphan]));
    expect(current.map((entry) => [entry.line.text, entry.history.map((item) => item.text)])).toEqual([
      ["Target date is Monday.", ["Target date is Friday.", "Target date not agreed."]],
    ]);
    expect(orphans.map((item) => item.text)).toEqual(["Blocked on the webhook fix."]);
  });

  it("searches titles and current lines, not replaced history", () => {
    const juniper = page("aaaaaaaaaaaa", "Juniper release", "project", [line("Mira signed off."), line("Friday deadline.", { status: "past" })]);
    expect(pageMatches(juniper, "juniper")).toBe(true);
    expect(pageMatches(juniper, "SIGNED")).toBe(true);
    expect(pageMatches(juniper, "friday")).toBe(false);
  });

  it("links pages whose current lines name each other, including a short project name and Korean particles", () => {
    const pages = [
      page("aaaaaaaaaaa1", "Juniper release", "project", [line("Mira signed off on Thursday."), line("Theo shipped the fix.")]),
      page("aaaaaaaaaaa2", "Mira", "person", [line("Signed off on the Juniper release."), line("Owns the Atlas review.")]),
      page("aaaaaaaaaaa3", "Theo", "person", [line("Works with Theodore on billing.", { status: "past" })]),
      page("aaaaaaaaaaa4", "Atlas CSV export", "project", [line("Mira가 최종 검토 담당이에요.")]),
      page("aaaaaaaaaaa5", "Miranda", "person", [line("Unrelated.")]),
    ];
    const links = wikiLinks(pages).map((link) => [link.source, link.target, link.weight]);
    expect(links).toEqual(expect.arrayContaining([
      ["aaaaaaaaaaa1", "aaaaaaaaaaa2", 2],
      ["aaaaaaaaaaa1", "aaaaaaaaaaa3", 1],
      // Mira's page names Atlas by its first word, and the Atlas page names Mira.
      ["aaaaaaaaaaa2", "aaaaaaaaaaa4", 2],
    ]));
    // "Miranda" is never matched by "Mira", and replaced lines do not link.
    expect(links).toHaveLength(3);
  });

  it("can skip a shared short name while keeping distinct aliases, full titles and wiki links", () => {
    const review = line("Juniper 상태와 Atlas 검토를 했어요. Juniper 릴리스가 늦어졌어요.");
    const pages = [
      page("aaaaaaaaaaa1", "Juniper 릴리스", "project", [line("출시 예정.")]),
      page("aaaaaaaaaaa2", "Juniper 설정", "project", [line("설정 메뉴 검토.")]),
      page("aaaaaaaaaaa3", "Atlas CSV", "project", [line("내보내기 테스트.")]),
      { ...page("aaaaaaaaaaa4", "Mira", "person", [review]), doc: {
        summary: [{ text: "[[Juniper 설정]]", lines: [review.id] }],
        sections: [], pendingLineIds: [], compiledAt: at(10),
      } },
      page("aaaaaaaaaaa5", "진행 상황", "topic", [line("Juniper 일정을 확인했어요.")]),
    ];
    expect(wikiLinks(pages, "all")).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "aaaaaaaaaaa2", target: "aaaaaaaaaaa5" }),
    ]));
    expect(wikiLinks(pages)).toEqual([
      { source: "aaaaaaaaaaa1", target: "aaaaaaaaaaa4", weight: 1 },
      { source: "aaaaaaaaaaa2", target: "aaaaaaaaaaa4", weight: 1 },
      { source: "aaaaaaaaaaa3", target: "aaaaaaaaaaa4", weight: 1 },
    ]);
  });

});

describe("work memory graph layout", () => {
  const ids = Array.from({ length: 12 }, (_, i) => "p" + i);
  const links = [
    { source: "p0", target: "p1", weight: 2 }, { source: "p0", target: "p2", weight: 1 }, { source: "p1", target: "p2", weight: 1 },
    { source: "p3", target: "p4", weight: 1 }, { source: "p5", target: "p6", weight: 1 }, { source: "p0", target: "p7", weight: 3 },
  ];
  const boxes = new Map(ids.map((id) => [id, { width: 110, height: 44 }]));

  it("is deterministic and keeps every node and its label inside the box without overlapping", () => {
    const first = layoutGraph(ids, links, 760, 520, 56, boxes);
    expect(layoutGraph(ids, links, 760, 520, 56, boxes)).toEqual(first);
    const points = ids.map((id) => first.get(id)!);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(55 - 1);
      expect(point.x).toBeLessThanOrEqual(760 - 55 + 1);
      expect(point.y).toBeGreaterThanOrEqual(22 - 1);
      expect(point.y).toBeLessThanOrEqual(520 - 22 + 1);
    }
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const apart = Math.abs(points[i].x - points[j].x) >= 110 || Math.abs(points[i].y - points[j].y) >= 44;
        expect(apart, ids[i] + " overlaps " + ids[j]).toBe(true);
      }
    }
  });

  it("keeps linked pages closer than unlinked ones", () => {
    const placed = layoutGraph(ids, links, 760, 520, 56, boxes);
    const distance = (a: string, b: string) => Math.hypot(placed.get(a)!.x - placed.get(b)!.x, placed.get(a)!.y - placed.get(b)!.y);
    expect(distance("p0", "p1")).toBeLessThan(distance("p0", "p11"));
    expect(distance("p3", "p4")).toBeLessThan(distance("p3", "p0"));
  });

  it("keeps clusters around a shared hub legible without treating detached pages as groups", () => {
    const groups = Array.from({ length: 5 }, (_, i) => ["left", "middle", "right"].map((part) => i + ":" + part));
    const ids = ["hub", ...groups.flat(), "detached"];
    const link = (source: string, target: string) => ({ source, target, weight: 1 });
    const links = groups.flatMap(([left, middle, right]) => [
      link("hub", left), link("hub", middle), link("hub", right), link(left, middle), link(middle, right),
    ]);
    const overview = graphOverview(ids, links);
    const { hubs, representatives } = overview;
    expect([...hubs]).toEqual(["hub"]);
    expect([...representatives]).toEqual(groups.map(([, middle]) => middle));
    const direct = new Set([groups[0][0], ...groups.slice(1).flat()]);
    expect([...groupLinkTargets(overview, direct)]).toEqual([...groups.slice(1).map(([, middle]) => middle), groups[0][0]]);

    const boxes = new Map(ids.map((id) => [id, { width: 28, height: 28 }]));
    const grouped = layoutGraph(ids, links, 920, 680, 48, boxes, hubs);
    const baseline = layoutGraph(ids, links, 920, 680, 48, boxes);
    const average = (placed: typeof grouped, pairs: typeof links) =>
      pairs.reduce((sum, { source, target }) => {
        const a = placed.get(source)!;
        const b = placed.get(target)!;
        return sum + Math.hypot(a.x - b.x, a.y - b.y);
      }, 0) / pairs.length;
    const bridgeEdges = links.filter(({ source }) => source === "hub");
    const localEdges = links.filter(({ source }) => source !== "hub");
    expect(average(grouped, bridgeEdges) / average(grouped, localEdges))
      .toBeGreaterThan(average(baseline, bridgeEdges) / average(baseline, localEdges));
  });
});


describe("work memory reading aids", () => {
  it("lists the pages linked either way once each, in the wiki's order, ignoring replaced lines", () => {
    const juniper = page("aaaaaaaaaaa1", "Juniper release", "project", [line("Juniper release target is Monday.")]);
    const mira = page("aaaaaaaaaaa2", "Mira", "person", [line("Signed off on Juniper on Thursday."), line("Juniper is waiting on Mira."), line("Reviews the Atlas export.")]);
    const atlas = page("aaaaaaaaaaa3", "Atlas export", "project", [line("Final review is with Mira.")]);
    const nora = page("aaaaaaaaaaa4", "Nora", "person", [line("Juniper was blocked.", { status: "past" })]);
    const pages = [juniper, mira, atlas, nora];
    const links = wikiLinks(pages);
    expect(linkedPages(juniper.id, pages, links).map((item) => item.title)).toEqual(["Mira"]);
    expect(linkedPages(mira.id, pages, links).map((item) => item.title)).toEqual(["Juniper release", "Atlas export"]);
  });

  it("counts a line's earlier versions and marks it as today's when the wiki wrote it today", () => {
    const friday = line("Target date is Friday.", { status: "past", replacedAt: at(11) });
    const monday = line("Target date is Monday.", { replaces: friday.id, createdAt: at(11) });
    const yesterday = line("Smoke test passed.", { createdAt: at(9) - 86_400_000, observedAt: at(9) - 86_400_000 });
    const [changed, older] = pageEntries(page("aaaaaaaaaaa1", "Juniper release", "project", [monday, friday, yesterday])).current;
    expect(lineState(changed, NOW)).toEqual({ replaced: 1, today: true });
    expect(lineState(older, NOW)).toEqual({ replaced: 0, today: false });
  });

  it("orders pages for the replay by the first line written on each, replaced lines included, keeping the wiki's order for ties", () => {
    const juniper = page("aaaaaaaaaaa1", "Juniper release", "project", [line("Target date is Monday.", { createdAt: at(11) }),
      line("Target date is Friday.", { status: "past", createdAt: at(8), replacedAt: at(11) })]);
    const mira = page("aaaaaaaaaaa2", "Mira", "person", [line("Signed off.", { createdAt: at(10) })]);
    // An older wiki only knows when the screen was seen.
    const theo = page("aaaaaaaaaaa3", "Theo", "person", [line("Shipped the fix.", { createdAt: null, observedAt: at(10) })]);
    expect(pageBornAt(juniper)).toBe(at(8));
    expect(pageBornAt(theo)).toBe(at(10));
    expect(replayOrder([mira, theo, juniper]).map((item) => item.title)).toEqual(["Juniper release", "Mira", "Theo"]);
  });
});


describe("work memory page documents", () => {
  const doc = (summary: MemoryWikiDoc["summary"], sections: MemoryWikiDoc["sections"] = [], pendingLineIds: string[] = []): MemoryWikiDoc =>
    ({ summary, sections, compiledAt: at(11, 30), pendingLineIds });

  it("splits a sentence into text and links, resolving each link to a page that still exists", () => {
    const pages = [page("aaaaaaaaaaa1", "Juniper release", "project", [line("x")]), page("aaaaaaaaaaa2", "Mira", "person", [line("y")])];
    expect(docSegments("[[mira]] signed off on [[Juniper release]] and [[Hana]].", pageIdsByTitle(pages))).toEqual([
      { kind: "link", text: "mira", pageId: "aaaaaaaaaaa2" }, { kind: "text", text: " signed off on " },
      { kind: "link", text: "Juniper release", pageId: "aaaaaaaaaaa1" }, { kind: "text", text: " and " },
      { kind: "link", text: "Hana", pageId: null }, { kind: "text", text: "." },
    ]);
  });

  it("numbers evidence in citation order, keeps a replaced version's number and sets apart memories newer than the document", () => {
    const friday = line("Target date is Friday.", { status: "past", replacedAt: at(11) });
    const monday = line("Target date is Monday.", { replaces: friday.id, createdAt: at(11) });
    const smoke = line("Smoke test passed.");
    const quiet = line("Release notes drafted.");
    const fresh = line("Support staffed Monday.", { createdAt: at(11, 40) });
    const juniper = { ...page("aaaaaaaaaaa1", "Juniper release", "project", [fresh, monday, friday, smoke, quiet]),
      doc: doc([{ text: "Smoke passed.", lines: [smoke.id] }], [{ heading: "Dates", points: [{ text: "Target is Friday.", lines: [friday.id] }] }], [fresh.id]) };
    const { written, pending } = docEvidence(juniper);
    expect(written.map((item) => [item.entry.line.text, item.number])).toEqual([["Smoke test passed.", 1], ["Target date is Monday.", 2], ["Release notes drafted.", null]]);
    expect(pending.map((entry) => entry.line.text)).toEqual(["Support staffed Monday."]);
    expect(pageMatches(juniper, "smoke passed")).toBe(true);
  });

  it("copies a document as Markdown with its evidence as footnotes", () => {
    const monday = line("Target date is Monday.");
    const smoke = line("Smoke test passed.");
    const juniper = page("aaaaaaaaaaa1", "Juniper release", "project", [monday, smoke]);
    const written = doc([{ text: "Moved to Monday; [[Mira]] signed off.", lines: [monday.id] }], [{ heading: "Status", points: [{ text: "Smoke passed.", lines: [smoke.id, monday.id] }] }]);
    expect(docMarkdown(juniper, written, (item) => item.text)).toBe([
      "# Juniper release", "", "Moved to Monday; [[Mira]] signed off.[^1]", "", "## Status", "- Smoke passed.[^2][^1]", "",
      "[^1]: Target date is Monday.", "[^2]: Smoke test passed.", "",
    ].join("\n"));
  });

  it("lists what other pages say about a person among its evidence, with the page each is on", () => {
    const own = line("Owns the Atlas export review.");
    const said = line("Mira signed off on Thursday.");
    const replaced = line("Mira will sign off.", { status: "past", replacedAt: at(10) });
    const current = line("Mira signed off; target moved to Monday.", { replaces: replaced.id });
    const juniper = page("aaaaaaaaaaa1", "Juniper release", "project", [said, current, replaced]);
    const doc: MemoryWikiDoc = { summary: [{ text: "Signed off on the [[Juniper release]].", lines: [said.id, replaced.id] }],
      sections: [{ heading: "Work", points: [{ text: "Owns the Atlas export review.", lines: [own.id] }] }], compiledAt: at(11), pendingLineIds: [] };
    const mira = { ...page("aaaaaaaaaaa2", "Mira", "person", [own]), doc };
    const { written } = docEvidence(mira, [juniper, mira]);
    // A cited version replaced since is shown as the memory that replaced it, on its own page.
    expect(written.map((item) => [item.number, item.entry.line.text, item.page.title])).toEqual([
      [1, "Mira signed off on Thursday.", "Juniper release"], [2, "Mira signed off; target moved to Monday.", "Juniper release"], [3, "Owns the Atlas export review.", "Mira"],
    ]);
    expect(findEntry([juniper, mira], replaced.id)?.entry.line.id).toBe(current.id);
    expect(docMarkdown(mira, doc, (item) => item.text, [juniper, mira])).toContain("[^1]: Mira signed off on Thursday.");
  });

  it("links pages a document names in double brackets even when no line names them", () => {
    const juniper = { ...page("aaaaaaaaaaa1", "Juniper release", "project", [line("Target date is Monday.")]),
      doc: doc([{ text: "Waiting on [[Hana]].", lines: ["000000000001"] }]) };
    const hana = page("aaaaaaaaaaa2", "Hana", "person", [line("Approves the cutover.")]);
    expect(wikiLinks([juniper, hana])).toEqual([{ source: "aaaaaaaaaaa1", target: "aaaaaaaaaaa2", weight: 1 }]);
  });
});
