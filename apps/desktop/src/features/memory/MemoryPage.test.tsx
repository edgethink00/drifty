// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ScreenContextClient } from "../screen-context/screenContextClient";
import { decodeWiki, decodeWikiMe, decodeWikiNotes, decodeWikiNow, decodeWikiPages } from "../screen-context/memoryWire";
import { MEMORY_COPY } from "./memoryCopy";
import { fileName, wikiMarkdownFiles } from "./memoryExport";
import { MemoryPage } from "./MemoryPage";

const lease = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const SOURCE = "6f1c2a3b-4d5e-4f60-8a7b-1c2d3e4f5a63";
const NOW = new Date(2026, 10, 3, 12, 0);
const at = (hours: number, minutes = 0) => new Date(2026, 10, 3, hours, minutes).getTime();
type Line = { id: string; text: string; status: "current" | "past"; replaces?: string; replaced_at_ms?: number; original_source_ids?: string[]; observed_at_ms?: number };
function wire(id: string, title: string, kind: string, lines: Line[], doc?: unknown) {
  return { id, title, kind, updated_at_ms: at(11, 30), updated_at_utc: "x", ...(doc ? { doc } : {}), lines: lines.map((line) => ({
    app: "com.google.Chrome", observed_at_ms: at(11, 30), observed_at_utc: "x", created_at_ms: at(11, 30),
    original_available: Boolean(line.original_source_ids?.length), original_source_ids: [], ...line })) };
}
function pages() {
  return [
    wire("aaaaaaaaaaa1", "Juniper release", "project", [
      { id: "bbbbbbbbbbb1", text: "Target date is Monday; Mira signed off.", status: "current", replaces: "bbbbbbbbbbb2", original_source_ids: [SOURCE] },
      // Seen in an earlier session the same morning, then replaced.
      { id: "bbbbbbbbbbb2", text: "Target date is Friday.", status: "past", replaced_at_ms: at(11, 30), observed_at_ms: at(9, 0) },
      { id: "bbbbbbbbbbb3", text: "Smoke test passed 18/18.", status: "current" },
    ], {
      // Written before the smoke test was remembered.
      summary: [{ text: "Moved to Monday; [[Mira]] signed off.", lines: ["bbbbbbbbbbb1"] }], sections: [],
      compiled_at_ms: at(11, 20), compiled_at_utc: "x", pending_line_ids: ["bbbbbbbbbbb3"],
    }),
    wire("aaaaaaaaaaa2", "Mira", "person", [{ id: "ccccccccccc1", text: "Signed off on the Juniper release.", status: "current", observed_at_ms: at(11, 35) }]),
  ];
}
const NOW_PAGE = {
  doing: [{ text: "The [[Juniper release]] moves to Monday; [[Mira]] signed off.", lines: ["bbbbbbbbbbb1", "ccccccccccc1"] }],
  waiting: [], done: [{ text: "Smoke test passed 18/18.", lines: ["bbbbbbbbbbb3"] }],
  line_ids: ["bbbbbbbbbbb1", "bbbbbbbbbbb3", "ccccccccccc1"], compiled_at_ms: at(11, 50), compiled_at_utc: "x",
};
const ME_PAGE = {
  role: [{ text: "Runs the [[Juniper release]] and its checks.", lines: ["bbbbbbbbbbb1", "bbbbbbbbbbb3"] }],
  owns: [], people: [{ text: "[[Mira]] signs off releases.", lines: ["ccccccccccc1"] }],
  line_ids: ["bbbbbbbbbbb1", "bbbbbbbbbbb3", "ccccccccccc1"], compiled_at_ms: at(8, 0), compiled_at_utc: "x",
};
function setup(enabled = true, notes: unknown[] = [], now: unknown = undefined, me: unknown = undefined) {
  let current: ReturnType<typeof pages> = pages();
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    let value: unknown;
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") value = { mode: "local", expiresAtMs: Date.now() + 900000 };
    else if (command === "memory_get_status") value = { supported: true, preferences: { enabled, retentionHours: 24 }, status: enabled ? { active: true, wiki: { pages: current.length } } : null };
    else if (command === "memory_wiki_pages") value = { pages: current, notes, ...(now === undefined ? {} : { now }), ...(me === undefined ? {} : { me }) };
    else if (command === "memory_wiki_note") {
      const text = String(args?.text ?? "");
      current = current.map((page) => page.id !== args?.pageId ? page : { ...page, my_note: text ? { text, updated_at_ms: at(11, 58), updated_at_utc: "x" } : undefined });
      value = { saved: true };
    }
    else if (command === "memory_wiki_delete") {
      current = current.flatMap((page) => page.id !== args?.pageId ? [page] : args?.lineId
        ? [{ ...page, lines: page.lines.filter((line) => line.id !== args.lineId) }] : []);
      value = { deleted: true };
    } else if (command === "screen_context_read_evidence") value = null;
    else if (command === "screen_context_get_status") throw "screen_context_unavailable";
    else throw new Error(command);
    return { leaseId: lease, value };
  });
  const client = new ScreenContextClient(invoke, true);
  client.setAccount(null);
  const onOpenSettings = vi.fn();
  const onAskChat = vi.fn();
  render(<LocalizationTestProvider language="en"><MemoryPage client={client} onOpenSettings={onOpenSettings} onAskChat={onAskChat} now={() => NOW} /></LocalizationTestProvider>);
  return { invoke, onOpenSettings, onAskChat };
}
const openPages = () => fireEvent.click(screen.getByRole("tab", { name: "Pages" }));
beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("work memory page", () => {
  it("opens on the flow with the newest session and opens each memory's page in its place", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Juniper release · Mira" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Flow" }).getAttribute("aria-selected")).toBe("true");
    const sessions = within(screen.getByRole("navigation", { name: "Work flow" })).getAllByRole("button");
    expect(sessions.map((item) => item.textContent)).toEqual([expect.stringContaining("Juniper release · Mira"), expect.stringContaining("Target date is Friday.")]);
    const remembered = screen.getByRole("region", { name: "Remembered here" });
    expect(within(remembered).getByText("Juniper release · Chrome 11:30 AM · Changed · 1 earlier version")).toBeTruthy();
    fireEvent.click(within(remembered).getByRole("button", { name: /^Target date is Monday/ }));
    expect(await screen.findByRole("heading", { name: "Juniper release" })).toBeTruthy();
    // Still the flow: the page opens where the session was, and back returns to it.
    expect(screen.getByRole("tab", { name: "Flow" }).getAttribute("aria-selected")).toBe("true");
    // The memory opens in place with its earlier version.
    expect(within(screen.getByRole("region", { name: "Memory details" })).getByText("Target date is Friday.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Juniper release · Mira" })).toBeTruthy();
  });

  it("reads a written session as its note, opens a footnote's memory and opens a linked page in place", async () => {
    const note = { key: "bbbbbbbbbbb1", line_ids: ["bbbbbbbbbbb1", "bbbbbbbbbbb3", "ccccccccccc1"], title: "Juniper moved to Monday",
      summary: [{ text: "The [[Juniper release]] moved to Monday; [[Mira]] signed off.", lines: ["bbbbbbbbbbb1", "ccccccccccc1"] }],
      points: [{ text: "Smoke test passed 18/18.", lines: ["bbbbbbbbbbb3"] }], compiled_at_ms: at(11, 40), compiled_at_utc: "x" };
    // A note written from other lines than the session now holds is not shown.
    const stale = { ...note, key: "bbbbbbbbbbb2", line_ids: ["bbbbbbbbbbb2", "ccccccccccc1"], title: "Stale note" };
    setup(true, [note, stale]);
    expect(await screen.findByRole("heading", { name: "Juniper moved to Monday" })).toBeTruthy();
    // The note already says what a question about the session would ask.
    expect(screen.queryByRole("button", { name: "Ask in Chat" })).toBeNull();
    const sessions = within(screen.getByRole("navigation", { name: "Work flow" })).getAllByRole("button");
    expect(sessions.map((item) => item.textContent)).toEqual([expect.stringContaining("Juniper moved to MondayChrome"), expect.stringContaining("Target date is Friday.")]);
    expect(screen.queryByText("Stale note")).toBeNull();
    // The memories it was written from stay folded until asked for; a footnote opens one under its sentence.
    expect(screen.queryByRole("region", { name: "Evidence" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show evidence 2" }));
    expect(screen.getByRole("button", { name: /^Signed off on the Juniper release\./ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Evidence 3" }));
    expect(within(screen.getByRole("region", { name: "Evidence" })).getAllByRole("button")).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: "Mira" })[0]);
    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Flow" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Juniper moved to Monday$/ }));
    expect(await screen.findByRole("heading", { name: "Juniper moved to Monday" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
  });

  it("opens a memory replaced since on the memory that replaced it", async () => {
    setup();
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Work flow" })).getByRole("button", { name: /Target date is Friday/ }));
    const remembered = screen.getByRole("region", { name: "Remembered here" });
    expect(within(remembered).getByText("Juniper release · Chrome 9:00 AM · Changed since")).toBeTruthy();
    fireEvent.click(within(remembered).getByRole("button", { name: /^Target date is Friday/ }));
    expect(await screen.findByRole("heading", { name: "Juniper release" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Target date is Monday/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("deletes a memory from its page and keeps the page open", async () => {
    const { invoke } = setup();
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    openPages();
    fireEvent.click(await screen.findByRole("button", { name: /^Smoke test passed 18\/18\./ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this memory" }));
    await waitFor(() => expect(screen.queryByText("Smoke test passed 18/18.")).toBeNull());
    expect(invoke.mock.calls.find(([name]) => name === "memory_wiki_delete")?.[1]).toMatchObject({ pageId: "aaaaaaaaaaa1", lineId: "bbbbbbbbbbb3" });
    expect(screen.getByRole("heading", { name: "Juniper release" })).toBeTruthy();
    expect(await screen.findByText("Memory deleted. The original screen stays.")).toBeTruthy();
  });

  it("asks before deleting a page", async () => {
    const { invoke } = setup();
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    openPages();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: "Show in graph" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete page" }));
    expect(invoke.mock.calls.some(([name]) => name === "memory_wiki_delete")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Juniper release" })).toBeNull());
    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
  });

  it("switches to the graph and opens a page's document beside it, follows its links and walks back", async () => {
    const { onAskChat } = setup();
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    fireEvent.click(screen.getByRole("tab", { name: "Graph" }));
    expect(window.localStorage.getItem("drifty.memory.view")).toBe("graph");
    expect(screen.getByRole("group", { name: "Memory graph of 2 pages and 1 links" })).toBeTruthy();
    // The graph is the list of pages here; the switch and search stay.
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search memory" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Juniper release · Project/ }));
    const juniper = await screen.findByRole("complementary", { name: "Juniper release" });
    // The page reads as it does everywhere: its actions in one menu beside its title.
    fireEvent.click(within(juniper).getByRole("button", { name: "More" }));
    expect(within(juniper).queryByRole("menuitem", { name: "Show in graph" })).toBeNull();
    expect(within(juniper).getByRole("menuitem", { name: "Copy as Markdown" })).toBeTruthy();
    fireEvent.click(within(juniper).getByRole("menuitem", { name: "Ask in Chat" }));
    expect(onAskChat).toHaveBeenCalledWith("What is the current status of Juniper release?");
    expect(within(juniper).queryByRole("menu")).toBeNull();
    fireEvent.click(within(juniper).getByRole("button", { name: "Mira" }));
    expect(await screen.findByRole("complementary", { name: "Mira" })).toBeTruthy();
    // Still the graph: the document opens beside it.
    expect(screen.getByRole("tab", { name: "Graph" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("complementary", { name: "Juniper release" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Juniper release" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Mira · Person/ }), { key: "Enter" });
    expect(await screen.findByRole("complementary", { name: "Mira" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Mira" })).toBeNull());
  });

  it("replays the graph from its first page and hands the whole graph back at the end or when stopped", async () => {
    // With reduced motion pages appear in place one step apart, so the run has a fixed length.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
    try {
      setup();
      await screen.findByRole("heading", { name: "Juniper release · Mira" });
      fireEvent.click(screen.getByRole("tab", { name: "Graph" }));
      const juniper = () => screen.queryByRole("button", { name: /^Juniper release · Project/ });
      const mira = () => screen.queryByRole("button", { name: /^Mira · Person/ });
      const edges = () => document.querySelectorAll(".work-memory-graph__edge").length;
      const shown = () => [Boolean(juniper()), Boolean(mira()), edges()];
      const replay = () => screen.getByRole("button", { name: "Replay" });
      // The replay button heads the zoom buttons.
      expect(within(screen.getByRole("group", { name: "View" })).getAllByRole("button")[0]).toBe(replay());
      expect(shown()).toEqual([true, true, 1]);
      fireEvent.click(replay());
      expect(replay().getAttribute("aria-pressed")).toBe("true");
      // From an empty canvas, pages arrive in the order they began, and a link once both its pages are there.
      expect(shown()).toEqual([false, false, 0]);
      await waitFor(() => expect(shown()).toEqual([true, false, 0]));
      await waitFor(() => expect(shown()).toEqual([true, true, 1]));
      // Then it gives the graph back by itself.
      await waitFor(() => expect(replay().getAttribute("aria-pressed")).toBe("false"), { timeout: 3000 });
      // Stopped midway, every page is back at once.
      fireEvent.click(replay());
      expect(shown()).toEqual([false, false, 0]);
      fireEvent.click(replay());
      expect(replay().getAttribute("aria-pressed")).toBe("false");
      expect(shown()).toEqual([true, true, 1]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads a page as its document, opens a footnote's memory under it and folds the rest of the evidence", async () => {
    setup();
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    openPages();
    expect(await screen.findByText(/^Moved to Monday;/)).toBeTruthy();
    // The evidence the document was written from stays folded until asked for.
    expect(screen.queryByRole("region", { name: "Evidence" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show evidence 1" }));
    expect(screen.getByRole("button", { name: "Show evidence 1" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /^Target date is Monday/ }).getAttribute("aria-expanded")).toBe("true");
    expect(within(screen.getByRole("region", { name: "Newly remembered" })).getByText("Smoke test passed 18/18.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Evidence 1" }));
    expect(within(screen.getByRole("region", { name: "Evidence" })).queryByText("Smoke test passed 18/18.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mira" }));
    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
    // A page of a line or two has no document: its memories as they are, without explaining why.
    expect(screen.queryByText(/written up/)).toBeNull();
    expect(within(screen.getByRole("region", { name: "Memories" })).getByText("Signed off on the Juniper release.")).toBeTruthy();
  });

  it("ends a page with the linked pages its document does not already name, and hands a question to Chat", async () => {
    const { onAskChat } = setup();
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    openPages();
    // Juniper's document already links Mira in its text, so nothing is listed again.
    expect(await screen.findByText(/^Moved to Monday;/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Linked pages" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mira" }));
    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("region", { name: "Linked pages" })).getByRole("button", { name: /^Juniper release/ }));
    expect(await screen.findByRole("heading", { name: "Juniper release" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask in Chat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ask in Chat" }));
    expect(onAskChat).toHaveBeenCalledWith("What is the current status of Juniper release?");
  });

  it("opens only a live original in the screen viewer and says when it is gone", async () => {
    const { invoke } = setup();
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    openPages();
    fireEvent.click(await screen.findByRole("button", { name: /^Smoke test passed/ }));
    expect(screen.queryByRole("button", { name: "View original" })).toBeNull();
    expect(screen.getByText(/deleted after its retention period/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show evidence 1" }));
    fireEvent.click(screen.getByRole("button", { name: "View original" }));
    expect(await screen.findByRole("dialog", { name: "Memory source" })).toBeTruthy();
    await waitFor(() => expect(invoke.mock.calls.some(([name, args]) => name === "screen_context_read_evidence" && (args as { recordId?: string })?.recordId === SOURCE)).toBe(true));
  });

  it("manages every memory in a table, filters it and deletes a checked set after confirming", async () => {
    const { invoke } = setup();
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("tab", { name: "Flow" }).getAttribute("aria-selected")).toBe("false");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    fireEvent.click(screen.getByRole("radio", { name: /^Has earlier versions/ }));
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: /^All/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select: Smoke test passed 18/18." }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select: Signed off on the Juniper release." }));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(invoke.mock.calls.some(([name]) => name === "memory_wiki_delete")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(invoke.mock.calls.filter(([name]) => name === "memory_wiki_delete")).toHaveLength(2));
    expect(await screen.findByText("2 memories deleted. Original screens stay.")).toBeTruthy();
    expect(screen.queryByText("Smoke test passed 18/18.")).toBeNull();
    // Choosing a view leaves Manage.
    fireEvent.click(screen.getByRole("tab", { name: "Pages" }));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps one search for the flow, the pages and Manage", async () => {
    setup();
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    const search = screen.getByRole("searchbox", { name: "Search memory" });
    fireEvent.change(search, { target: { value: "friday" } });
    expect(within(screen.getByRole("navigation", { name: "Work flow" })).getAllByRole("button")).toHaveLength(1);
    // What matched is marked where it reads.
    expect([...document.querySelectorAll("mark.work-memory-hit")].map((mark) => mark.textContent)).toContain("Friday");
    expect(await screen.findByRole("heading", { name: "Juniper release" })).toBeTruthy();
    fireEvent.change(search, { target: { value: "signed off" } });
    openPages();
    const pageList = screen.getByRole("navigation", { name: "Pages" });
    expect(within(pageList).getAllByRole("button").map((item) => item.textContent)).toEqual([expect.stringContaining("Juniper release"), expect.stringContaining("Mira")]);
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect((screen.getByRole("searchbox", { name: "Search memory" }) as HTMLInputElement).value).toBe("signed off");
    // The header row and the two memories that say "signed off".
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);
  });

  it("opens on the \"now\" page, opens a cited memory under its sentence and its page in place", async () => {
    setup(true, [], NOW_PAGE);
    expect(await screen.findByRole("heading", { name: "Now" })).toBeTruthy();
    const sessions = within(screen.getByRole("navigation", { name: "Work flow" })).getAllByRole("button");
    // First in the flow, led by its first sentence without link marks.
    expect(sessions[0].textContent).toBe("NowThe Juniper release moves to Monday; Mira signed off.");
    expect(sessions[0].getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("heading", { name: "In progress" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recently done" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Waiting on" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show evidence 2" }));
    fireEvent.click(screen.getByRole("button", { name: /^Signed off on the Juniper release\./ }));
    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Flow" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Now" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Juniper release" }));
    expect(await screen.findByRole("heading", { name: "Juniper release" })).toBeTruthy();
    // The sessions are still a press away.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Work flow" })).getAllByRole("button")[1]);
    expect(await screen.findByRole("heading", { name: "Juniper release · Mira" })).toBeTruthy();
  });

  it("leaves the \"now\" page out of a search and opens on the newest session without one", async () => {
    setup(true, [], NOW_PAGE);
    await screen.findByRole("heading", { name: "Now" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search memory" }), { target: { value: "friday" } });
    const sessions = within(screen.getByRole("navigation", { name: "Work flow" })).getAllByRole("button");
    expect(sessions.map((item) => item.textContent)).toEqual([expect.stringContaining("Target date is Friday.")]);
    expect(screen.queryByRole("heading", { name: "Now" })).toBeNull();
    cleanup();
    // An engine without the page, or with none written yet, opens on the newest session as before.
    setup(true, [], null);
    expect(await screen.findByRole("heading", { name: "Juniper release · Mira" })).toBeTruthy();
    expect(screen.queryByText("Now")).toBeNull();
  });

  it("keeps an opened memory open across the refresh of the \"now\" page and of a session note", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const note = { key: "bbbbbbbbbbb1", line_ids: ["bbbbbbbbbbb1", "bbbbbbbbbbb3", "ccccccccccc1"], title: "Juniper moved to Monday",
        summary: [{ text: "The [[Juniper release]] moved to Monday; [[Mira]] signed off.", lines: ["bbbbbbbbbbb1", "ccccccccccc1"] }],
        points: [], compiled_at_ms: at(11, 40), compiled_at_utc: "x" };
      const { invoke } = setup(true, [note], NOW_PAGE);
      await screen.findByRole("heading", { name: "Now" });
      const reads = () => invoke.mock.calls.filter(([command]) => command === "memory_wiki_pages").length;
      // Each refresh decodes new objects with the same content; what is open stays open.
      const refresh = async () => {
        const before = reads();
        await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });
        await waitFor(() => expect(reads()).toBeGreaterThan(before));
      };
      fireEvent.click(screen.getByRole("button", { name: "Show evidence 2" }));
      await refresh();
      expect(screen.getByRole("button", { name: "Show evidence 2" }).getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(within(screen.getByRole("navigation", { name: "Work flow" })).getAllByRole("button")[1]);
      expect(await screen.findByRole("heading", { name: "Juniper moved to Monday" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Show evidence 2" }));
      await refresh();
      expect(screen.getByRole("button", { name: "Show evidence 2" }).getAttribute("aria-expanded")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });


  it("opens the pages on \"About me\", then the pages it names", async () => {
    setup(true, [], undefined, ME_PAGE);
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    openPages();
    expect(await screen.findByRole("heading", { name: "About me" })).toBeTruthy();
    const rail = within(screen.getByRole("navigation", { name: "Pages" }));
    expect(rail.getAllByRole("button")[0].textContent).toBe("About me");
    expect(rail.getAllByRole("button")[0].getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { name: "What I do" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "What I lead" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mira" }));
    expect(await screen.findByRole("heading", { name: "Mira" })).toBeTruthy();
    // A search shows only pages.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Juniper" } });
    expect(rail.queryByText("About me")).toBeNull();
  });

  it("keeps the person's own note on a page and saves it without touching the document", async () => {
    const { invoke } = setup();
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    openPages();
    expect(await screen.findByText(/^Moved to Monday;/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add my note" }));
    const box = screen.getByRole("textbox", { name: "My note" });
    fireEvent.change(box, { target: { value: "Ask Theo about alerts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("memory_wiki_note", expect.objectContaining({ pageId: "aaaaaaaaaaa1", text: "Ask Theo about alerts" })));
    const note = await screen.findByRole("region", { name: "My note" });
    expect(within(note).getByText("Ask Theo about alerts")).toBeTruthy();
    expect(screen.getByText(/^Moved to Monday;/)).toBeTruthy();
    // Clearing it removes the note.
    fireEvent.click(within(note).getByRole("button", { name: "Edit note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "My note" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("memory_wiki_note", expect.objectContaining({ text: "" })));
    expect(await screen.findByRole("button", { name: "Add my note" })).toBeTruthy();
  });

  it("decodes the \"About me\" page and refuses one that is malformed", () => {
    expect(decodeWikiMe({ pages: [] })).toBeNull();
    expect(decodeWikiMe({ me: ME_PAGE })).toMatchObject({ role: [{ lines: ["bbbbbbbbbbb1", "bbbbbbbbbbb3"] }], owns: [], compiledAt: at(8, 0) });
    for (const bad of [{ ...ME_PAGE, role: [], people: [] }, { ...ME_PAGE, owns: "x" }, { ...ME_PAGE, role: Array(4).fill(ME_PAGE.role[0]) }]) {
      expect(() => decodeWikiMe({ me: bad })).toThrow("memory_unavailable");
    }
  });

  it("writes one Markdown file per page with its footnotes and note, and plain unique names", () => {
    const withNote = pages().map((page) => page.id === "aaaaaaaaaaa1" ? { ...page, my_note: { text: "Ask Theo", updated_at_ms: at(11), updated_at_utc: "x" } } : page);
    const files = wikiMarkdownFiles(decodeWiki({ pages: withNote, notes: [], now: NOW_PAGE, me: ME_PAGE }), MEMORY_COPY.en);
    expect(files.map((file) => file.name)).toEqual(["About me.md", "Now.md", "Juniper release.md", "Mira.md"]);
    const juniper = files[2].text;
    expect(juniper).toContain("# Juniper release");
    expect(juniper).toContain("Moved to Monday; [[Mira]] signed off.[^1]");
    expect(juniper).toMatch(/\[\^1\]: Target date is Monday; Mira signed off\. \(Chrome, /);
    expect(juniper.trimEnd().endsWith("## My note\n\nAsk Theo")).toBe(true);
    // A page without a document lists its memories.
    expect(files[3].text).toMatch(/^# Mira\n\n- Signed off on the Juniper release\./);
    const taken = new Set<string>();
    expect([fileName("a/b: c", taken), fileName("A/B: C", taken), fileName("..hidden", taken), fileName("\u0007", taken)])
      .toEqual(["a-b- c.md", "A-B- C (2).md", "hidden.md", "page.md"]);
  });

  it("decodes the \"now\" page and refuses one that is malformed", () => {
    expect(decodeWikiNow({ pages: [] })).toBeNull();
    expect(decodeWikiNow({ now: null })).toBeNull();
    expect(decodeWikiNow({ now: NOW_PAGE })).toMatchObject({ doing: [{ lines: ["bbbbbbbbbbb1", "ccccccccccc1"] }], waiting: [], lineIds: NOW_PAGE.line_ids, compiledAt: at(11, 50) });
    for (const bad of [{ ...NOW_PAGE, doing: [], done: [] }, { ...NOW_PAGE, line_ids: "x" }, { ...NOW_PAGE, done: [{ text: "x", lines: ["nope"] }] }]) {
      expect(() => decodeWikiNow({ now: bad })).toThrow("memory_unavailable");
    }
  });

  it("offers the one start action when memory is off and nothing is kept", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "screen_context_revoke_account") return;
      const value = command === "screen_context_bind_account" ? { mode: "local", expiresAtMs: Date.now() + 900000 }
        : command === "memory_get_status" ? { supported: true, preferences: { enabled: false, retentionHours: 24 }, status: null }
        : command === "memory_wiki_pages" ? { pages: [] } : null;
      return { leaseId: lease, value };
    });
    const client = new ScreenContextClient(invoke, true);
    client.setAccount(null);
    render(<LocalizationTestProvider language="en"><MemoryPage client={client} onOpenSettings={vi.fn()} now={() => NOW} /></LocalizationTestProvider>);
    expect(await screen.findByRole("button", { name: "Start automatic memory" })).toBeTruthy();
    // The start screen is the one place that offers to turn memory on.
    expect(screen.queryByText("Automatic memory off")).toBeNull();
    expect((screen.getByRole("tab", { name: "Graph" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Manage" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says memory is off beside the memories it kept and links to Settings", async () => {
    const { onOpenSettings } = setup(false);
    await screen.findByRole("heading", { name: "Juniper release · Mira" });
    expect(await screen.findByText("Automatic memory off")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("decodes only native record IDs as openable originals", () => {
    const [page] = decodeWikiPages({ pages: [wire("aaaaaaaaaaa1", "Juniper release", "project", [
      { id: "bbbbbbbbbbb1", text: "x", status: "current", original_source_ids: [SOURCE, "../etc"] },
    ])] });
    expect(page.lines[0]).toMatchObject({ originalIds: [SOURCE], createdAt: at(11, 30), replacedAt: null, replaces: null });
    expect(() => decodeWikiPages({ pages: [wire("aaaaaaaaaaa1", "J", "project", [{ id: "bbbbbbbbbbb1", text: "x", status: "current", replaces: "nope" }])] })).toThrow("memory_unavailable");
  });

  it("decodes session notes from engines that write them and none from older ones", () => {
    expect(decodeWikiNotes({ pages: [] })).toEqual([]);
    const note = { key: "bbbbbbbbbbb1", line_ids: ["bbbbbbbbbbb1"], title: "Release moved", summary: [{ text: "Moved.", lines: ["bbbbbbbbbbb1"] }], points: [], compiled_at_ms: at(11, 40) };
    expect(decodeWikiNotes({ notes: [note] })[0]).toMatchObject({ key: "bbbbbbbbbbb1", lineIds: ["bbbbbbbbbbb1"], title: "Release moved", compiledAt: at(11, 40) });
    for (const bad of [{ ...note, summary: [] }, { ...note, title: "x".repeat(61) }, { ...note, line_ids: [] }, { ...note, points: [{ text: "x", lines: ["nope"] }] }]) {
      expect(() => decodeWikiNotes({ notes: [bad] })).toThrow("memory_unavailable");
    }
  });
});
describe("memory page when it cannot load", () => {
  function failing(code: () => string | null) {
    const invoke = vi.fn(async (command: string) => {
      if (command === "screen_context_revoke_account") return;
      let value: unknown;
      if (command === "screen_context_bind_account") value = { mode: "local", expiresAtMs: Date.now() + 900000 };
      else if (command === "memory_get_status") value = { supported: true, preferences: { enabled: true, retentionHours: 24 }, status: { active: true, wiki: { pages: 2 } } };
      else if (command === "memory_wiki_pages") {
        const error = code();
        // Tauri rejects with the command's error string.
        if (error) throw error;
        value = { pages: pages(), notes: [] };
      } else throw new Error(command);
      return { leaseId: lease, value };
    });
    const client = new ScreenContextClient(invoke, true);
    client.setAccount(null);
    const onOpenScreenRecording = vi.fn();
    render(<LocalizationTestProvider language="en"><MemoryPage client={client} onOpenSettings={vi.fn()} onOpenScreenRecording={onOpenScreenRecording} now={() => NOW} /></LocalizationTestProvider>);
    return { onOpenScreenRecording };
  }

  it("says screen recording is off or paused and opens its settings", async () => {
    let paused = true;
    const { onOpenScreenRecording } = failing(() => paused ? "memory_recording_required" : null);
    expect((await screen.findByRole("alert")).textContent).toContain(MEMORY_COPY.en.recordingStopped);
    expect(screen.queryByText(MEMORY_COPY.en.failed)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: MEMORY_COPY.en.openRecording }));
    expect(onOpenScreenRecording).toHaveBeenCalledTimes(1);
    // Resuming recording, then trying again, shows the memories.
    paused = false;
    fireEvent.click(screen.getByRole("button", { name: MEMORY_COPY.en.retry }));
    expect(await screen.findByRole("heading", { name: "Juniper release · Mira" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the general message for every other failure", async () => {
    failing(() => "memory_unavailable");
    expect((await screen.findByRole("alert")).textContent).toContain(MEMORY_COPY.en.failed);
    expect(screen.queryByText(MEMORY_COPY.en.recordingStopped)).toBeNull();
    expect(screen.queryByRole("button", { name: MEMORY_COPY.en.openRecording })).toBeNull();
  });
});
