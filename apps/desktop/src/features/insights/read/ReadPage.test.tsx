// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fillFacts, readFacts } from "./readFacts";
import { READ_ABSTAIN, READ_FRAMES, READ_LOG, READ_THIN, READ_VIDEO_DAYS, readWithWebCase } from "./readFixtures";
import { FLOW_PER_CLASS, WEB_EDGE_MAX, WEB_RING_MAX, placeApps } from "./ReadEvidenceViews";
import { durationLabel } from "./readFormat";
import { dayMetrics, splitRows, type InsightsRead } from "./readModel";
import { READ_CAT_SEATS, ReadCat, seatForWeek } from "./ReadCat";
import { ReadPage } from "./ReadPage";
import { shiftDate } from "./readFormat";
import { PET_MODE_SIT_BODY_PATH, PET_MODE_SLEEP_BODY_PATH } from "../../pet-mode/petModeVectorArt";

afterEach(cleanup);

function page(read: InsightsRead) {
  return render(
    <ReadPage log={READ_LOG} selectedId={read.id} onSelect={() => undefined} />,
  );
}

describe("ReadPage", () => {
  // Your read never redraws Your usage: a week without a read says how many
  // days counted, not how long each day was.
  it.each([["thin", READ_THIN], ["no read", READ_ABSTAIN]] as const)("shows no per-day totals for a %s week", (_, read) => {
    const text = page(read).container.querySelector(".rp-root")?.textContent ?? "";
    const totals = read.days.map((day) => dayMetrics(day).tracked).filter((seconds) => seconds > 0).map((seconds) => durationLabel(seconds, "en"));
    expect(totals.length).toBeGreaterThan(0);
    for (const total of totals) expect(text).not.toContain(total);
  });

  // The model writes no numbers; every one in the read's words is the app's own, marked and sourced.
  it("fills the numbers in the read's words from the week's days", () => {
    const { container } = page(READ_VIDEO_DAYS);
    const body = container.querySelector(".rp-voice__body");
    expect(body?.textContent).not.toMatch(/[{}]/);
    const span = splitRows(READ_VIDEO_DAYS).find((row) => row.id === "span");
    const gap = durationLabel(Math.abs((span?.values[0] ?? 0) - (span?.values[1] ?? 0)), "en");
    const fact = container.querySelector('.rp-fact[data-fact="span.gap"]');
    expect(fact?.textContent).toBe(gap);
    expect(fact?.getAttribute("title")).toContain("Day length");
    expect(container.querySelector('.rp-fact[data-fact="a.days"]')?.textContent).toBe("5 days");
  });

  // The read speaks for itself: no logo, product name or "AI read"/"Weekly read" label on its card.
  it("puts no logo or AI label on the read's card", () => {
    const card = page(READ_VIDEO_DAYS).container.querySelector(".rp-voice");
    expect(card?.querySelector("img")).toBeNull();
    expect(card?.textContent).not.toMatch(/Drifty|AI read|Weekly read/i);
  });

  // The cat is pet mode's own art, never redrawn here: every seat shows one coat, and it is the pet's sitting or sleeping body.
  it.each(READ_CAT_SEATS.flatMap((seat) => [[seat, "sit", PET_MODE_SIT_BODY_PATH], [seat, "sleep", PET_MODE_SLEEP_BODY_PATH]] as const))(
    "draws the %s seat with pet mode's own %s pose",
    (seat, pose, body) => {
      const { container } = render(<ReadCat seat={seat} pose={pose} />);
      const coats = container.querySelectorAll(".rp-cat__fur");
      expect(coats).toHaveLength(1);
      expect(coats[0].getAttribute("d")).toBe(body);
    },
  );

  // The cat's seat turns once a week from the first read, through every seat and back, and a read keeps its seat.
  it("moves the cat to the next seat each week, starting from the first read", () => {
    const first = "2026-08-31";
    const weeks = Array.from({ length: READ_CAT_SEATS.length + 1 }, (_, week) => seatForWeek(first, shiftDate(first, week * 7)));
    expect(weeks.slice(0, READ_CAT_SEATS.length)).toEqual(READ_CAT_SEATS);
    expect(weeks[READ_CAT_SEATS.length]).toBe(READ_CAT_SEATS[0]);
    const seatOf = (read: InsightsRead) => {
      const view = page(read);
      const seat = view.container.querySelector(".rp-cat")?.getAttribute("class")?.match(/seat-(\w+)/)?.[1];
      view.unmount();
      return seat;
    };
    const seats = READ_LOG.map(seatOf);
    expect(new Set(seats).size).toBe(READ_LOG.length);
    expect(seats[READ_LOG.length - 1]).toBe(READ_CAT_SEATS[0]);
    expect(seatOf(READ_LOG[0])).toBe(seats[0]);
  });

  it("refuses words that name a number the app cannot compute", () => {
    expect(fillFacts("Focus fell {focus.unknown}.", readFacts(READ_VIDEO_DAYS, "en"))).toBeNull();
  });

  // Every picture is on the page at once, each with the read's own sentence; its numbers are counted from the switches and app times.
  it("shows every evidence picture and counts their numbers from the read's app breakdown", () => {
    const facts = readFacts(READ_VIDEO_DAYS, "en");
    expect(facts["switch.subject.share.a"]?.value).toBe("27%");
    expect(facts["switch.subject.share.b"]?.value).toBe("5%");
    expect(facts["switch.work.a"]?.value).toBe("59");
    expect(facts["switch.work.b"]?.value).toBe("75");
    expect(facts["app.yt.a"]?.value).toBe(durationLabel(160 * 60, "en"));
    const { container } = page(READ_VIDEO_DAYS);
    expect(container.querySelectorAll(".rp-measure")).toHaveLength(4);
    expect(container.querySelectorAll(".rp-web")).toHaveLength(1);
    expect(container.querySelectorAll(".rp-flow")).toHaveLength(1);
    const notes = [...container.querySelectorAll(".rp-view-note")].map((note) => note.textContent ?? "");
    expect(notes).toHaveLength(2);
    for (const note of notes) expect(note).not.toMatch(/[{}]/);
    expect(container.textContent).not.toContain("Evidence");
  });

  // Each measure line's change is the number the read's words cite, so a reader finds it on the line.
  it("puts the body's numbers on the measure lines as each side's change", () => {
    const facts = readFacts(READ_VIDEO_DAYS, "en");
    const { container } = page(READ_VIDEO_DAYS);
    const change = (index: number) => container.querySelectorAll(".rp-measure .rp-delta")[index]?.textContent ?? "";
    const ids = [...container.querySelectorAll(".rp-measure .rp-measure__name")].map((name) => name.textContent);
    expect(change(ids.indexOf("Focus"))).toBe("−" + facts["focus.gap"]?.value);
    expect(change(ids.indexOf("First activity"))).toBe(facts["firstActivity.gap"]?.value + " earlier");
    expect(change(ids.indexOf("Day length"))).toBe("+" + facts["span.gap"]?.value);
  });

  // Focus and drift are hours of the same days, so their lines share one axis; the other measures keep their own.
  it("puts focus and drift on one shared axis", () => {
    const { container } = page(READ_VIDEO_DAYS);
    const ticks = (name: string) => {
      const line = [...container.querySelectorAll(".rp-measure")].find((entry) => entry.querySelector(".rp-measure__name")?.textContent === name);
      return [...(line?.querySelectorAll(".rp-measure__tick") ?? [])].map((tick) => tick.textContent);
    };
    // Focus sits right over drift and leaves the shared axis's ticks to it.
    expect(ticks("Focus")).toEqual([]);
    expect(ticks("Drift")).toEqual(["0", "2h", "4h", "6h", "8h"]);
    expect(ticks("First activity")).not.toEqual(ticks("Drift"));
    // Focus's average sits on drift's 0–8h axis: 4h 3m is just past the middle.
    const focusLine = [...container.querySelectorAll(".rp-measure")].find((entry) => entry.querySelector(".rp-measure__name")?.textContent === "Focus");
    expect(parseFloat((focusLine?.querySelector(".rp-measure__mean.is-a") as HTMLElement | null)?.style.left ?? "")).toBeCloseTo(50.6, 0);
  });

  // One switch above the evidence picks the side every picture leads with; the list counts the subject's links
  // against the other side, and the apps carry the icons Your usage gets from the app icon map.
  it("counts the subject's links for the shown group against the other, with the apps' own icons", () => {
    const icon = "data:image/png;base64,iVBORw0KGgo=";
    const { container } = render(
      <ReadPage log={READ_LOG} selectedId={READ_VIDEO_DAYS.id} onSelect={() => undefined} appIcons={{ "com.microsoft.VSCode": icon }} />,
    );
    const firstLink = () => container.querySelector(".rp-links > .rp-link")?.textContent;
    expect(firstLink()).toBe("VS Code9vs 2");
    expect(container.querySelector('.rp-web [data-app="code"] image')?.getAttribute("href")).toBe(icon);
    const plate = () => ({
      value: container.querySelector(".rp-measure .rp-measure__value b")?.textContent ?? "",
      compared: container.querySelector(".rp-measure .rp-measure__value span")?.textContent?.replace("vs ", "") ?? "",
    });
    const before = plate();
    expect(screen.getAllByRole("button", { name: /Started at the desk/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Started at the desk/ }));
    expect(firstLink()).toBe("VS Code2vs 9");
    expect(container.querySelector(".rp-flow")?.getAttribute("aria-label")).toContain("Started at the desk");
    // The plates turn to lead with the same side: the large value and the one it is compared with swap.
    expect(plate()).toEqual({ value: before.compared, compared: before.value });
  });

  it("leaves out the side switch and the totals on the minimal evidence", () => {
    const { container } = render(
      <ReadPage log={READ_LOG} selectedId={READ_VIDEO_DAYS.id} onSelect={() => undefined} evidencePolish="minimal" />,
    );
    expect(screen.queryByRole("group", { name: "Side the evidence leads with" })).toBeNull();
    expect(container.querySelectorAll(".rp-links > .rp-link")).toHaveLength(5);
    expect(container.querySelector(".rp-links__sum")).toBeNull();
    expect(container.querySelector(".rp-view-note")).toBeNull();
    expect(container.querySelector(".rp-figure b")?.textContent).toBe("27%");
  });

  // A heavy week keeps the web readable: one hub, at most WEB_RING_MAX apps around it with the subject and its partners
  // always among them, every class still on the ring, at most WEB_EDGE_MAX lines plus the subject's own, and the list
  // compares the two sides with a quiet "vs" figure, not a signed chip.
  it("keeps a heavy week's app web to a readable ring and line count", () => {
    const read = readWithWebCase(READ_FRAMES.usual, "heavy");
    const evidence = read.evidence!;
    if (evidence.kind !== "split") throw new Error("split");
    const { placed } = placeApps(evidence.apps!, evidence.switches!, "yt");
    const ring = [...placed.values()].filter((entry) => !entry.hub);
    expect(ring.length).toBe(WEB_RING_MAX);
    expect(new Set(ring.map((entry) => entry.app.kind))).toEqual(new Set(["focus", "neutral", "drift"]));
    for (const id of ["yt", "x", "code", "figma", "reddit"]) expect(placed.has(id)).toBe(true);
    const { container } = render(<ReadPage log={[read, ...READ_LOG.slice(1)]} selectedId={read.id} onSelect={() => undefined} />);
    const lines = [...container.querySelectorAll(".rp-web__line")].map((line) => line.getAttribute("data-edge")!);
    const subjectLines = evidence.switches!.filter((edge) => (edge.a === "yt" || edge.b === "yt") && edge.perDay[0] > 0 && placed.has(edge.a) && placed.has(edge.b));
    expect(lines.length).toBeLessThanOrEqual(WEB_EDGE_MAX + subjectLines.length);
    for (const edge of subjectLines) expect(lines).toContain(edge.a + "-" + edge.b);
    expect(container.querySelectorAll(".rp-links .rp-delta")).toHaveLength(0);
    expect(container.querySelector(".rp-links > .rp-link .rp-link__vs")?.textContent).toBe("vs 3");
  });

  // Time flow names at most FLOW_PER_CLASS apps a class; a heavy class's rest is one "Other" row.
  it("folds a heavy class's smaller apps into one Other row in time flow", () => {
    const read = readWithWebCase(READ_FRAMES.usual, "heavy");
    const { container } = render(<ReadPage log={[read, ...READ_LOG.slice(1)]} selectedId={read.id} onSelect={() => undefined} />);
    const names = [...container.querySelectorAll(".rp-flow__app .rp-flow__label.is-strong")].map((node) => node.textContent);
    expect(names.filter((name) => name === "Other")).toHaveLength(3);
    expect(names).toHaveLength(3 * (FLOW_PER_CLASS + 1));
    expect(names).toContain("Instagram");
    expect(names).not.toContain("Netflix");
  });

  // Hovering an app in the web lights its lines and names its time and every switch it took part in.
  it("lights an app's lines in the web on hover and counts all its switches", () => {
    const { container } = page(READ_VIDEO_DAYS);
    const node = container.querySelector('.rp-web__node[data-app="yt"]')!;
    fireEvent.mouseEnter(node, { clientX: 200, clientY: 100 });
    expect(container.querySelector(".rp-web")?.classList.contains("is-focused")).toBe(true);
    expect(container.querySelector(".rp-tip")?.textContent).toContain("YouTube");
    // 9 + 5 + 4 + 3 + 2: every YouTube link on a video day.
    expect(container.querySelector(".rp-tip")?.textContent).toContain("23 switches a day");
    fireEvent.mouseLeave(node);
    expect(container.querySelector(".rp-tip")).toBeNull();
  });

  // Time flow labels each app as Dayflow does: its time and its share of the average day under its name,
  // with no signed change against the other side (product decision 2026-10-08).
  it("labels each app in time flow with its time and share of the day, and no signed change", () => {
    const { container } = page(READ_VIDEO_DAYS);
    const flow = container.querySelector(".rp-flow")!;
    const sub = (name: string) => [...flow.querySelectorAll(".rp-flow__app")].find((app) => app.querySelector(".rp-flow__label.is-strong")?.textContent === name)?.querySelector(".rp-flow__label.is-num")?.textContent;
    expect(sub("VS Code")).toBe(durationLabel(130 * 60, "en") + " · 25%");
    expect(sub("YouTube")).toBe(durationLabel(160 * 60, "en") + " · 30%");
    expect(flow.textContent).not.toMatch(/[+−]\d/);
  });

  // As in Dayflow, the day starts as one total bar that splits into its classes, then into their apps.
  // Hovering an app lights its path from the total through its class and names both sides' times; leaving clears it.
  it("lights an app's path in time flow on hover and names both sides", () => {
    const { container } = page(READ_VIDEO_DAYS);
    const flow = container.querySelector(".rp-flow")!;
    const youtube = [...flow.querySelectorAll(".rp-flow__app")].find((app) => app.querySelector(".rp-flow__label.is-strong")?.textContent === "YouTube")!;
    fireEvent.mouseEnter(youtube, { clientX: 300, clientY: 200 });
    expect(flow.classList.contains("is-focused")).toBe(true);
    expect([...flow.querySelectorAll(".rp-flow__ribbon.is-lit")].map((node) => node.classList.contains("is-from-day"))).toEqual([true, false]);
    const tip = container.querySelector(".rp-tip")!;
    expect(tip.textContent).toContain("YouTube");
    expect(tip.textContent).toContain("Video before 07:00 " + durationLabel(160 * 60, "en") + " · 30%");
    expect(tip.textContent).toContain("Started at the desk " + durationLabel(14 * 60, "en"));
    fireEvent.mouseLeave(youtube);
    expect(container.querySelector(".rp-tip")).toBeNull();
    expect(flow.classList.contains("is-focused")).toBe(false);
  });

  // A read carries no caveat sentence about how few days a side has (product decision 2026-10-10).
  // The two sides head the measures block as its first line; nothing on the page floats above the blocks.
  it("names the comparison's two sides inside the measures block", () => {
    const { container } = page(READ_VIDEO_DAYS);
    const card = container.querySelector(".rp-measures-card")!;
    expect(card.firstElementChild?.classList.contains("rp-compare")).toBe(true);
    expect(container.querySelectorAll(".rp-ev > .rp-compare")).toHaveLength(0);
    expect(card.querySelector(".rp-compare")?.textContent).toContain("Started at the desk");
  });

  it("shows no caveat sentence about sample size", () => {
    const { container } = page(READ_VIDEO_DAYS);
    expect(container.textContent).not.toMatch(/treat this as a lead|only two days on the other side/i);
    expect(container.querySelector(".rp-compare p")).toBeNull();
  });

  it("starts time flow from the day's total and splits it into one ribbon per class", () => {
    const { container } = page(READ_VIDEO_DAYS);
    const total = container.querySelector(".rp-flow .rp-flow__total")!;
    expect([...total.querySelectorAll("text")].map((node) => node.textContent)).toEqual(["Total", durationLabel(528 * 60, "en") + " · 5-day avg"]);
    expect(container.querySelectorAll(".rp-flow__ribbon.is-from-day")).toHaveLength(3);
    // Focus first, drift right under it, neutral last.
    expect([...container.querySelectorAll(".rp-flow__ribbon.is-from-day")].map((node) => node.getAttribute("class")!.match(/is-(focus|drift|neutral)/)![1])).toEqual(["focus", "drift", "neutral"]);
  });

  // Against an earlier stretch (last week, the last four weeks), the earlier days are one usual range, not a second
  // set of dots, and this week's days inside that range go faint so the days outside it stand out.
  it("draws an earlier stretch as a usual range and fades this week's days inside it", () => {
    const frame = READ_FRAMES.lastWeek;
    const { container } = render(
      <ReadPage log={READ_LOG.map((entry) => (entry.id === frame.id ? frame : entry))} selectedId={frame.id} onSelect={() => undefined} />,
    );
    const rows = splitRows(frame);
    expect(container.querySelectorAll(".rp-measures .rp-range")).toHaveLength(rows.length);
    expect(container.querySelectorAll(".rp-measures .rp-dot.is-b")).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Side the evidence leads with" })).toBeNull();
    for (const row of rows) {
      const earlier = row.days[1].map((day) => day.value);
      const inside = row.days[0].filter((day) => day.value >= Math.min(...earlier) && day.value <= Math.max(...earlier)).length;
      const strip = container.querySelector(".rp-measure[data-measure='" + row.id + "']")!;
      expect(strip.querySelectorAll(".rp-dot.is-a.is-usual")).toHaveLength(inside);
      expect(strip.querySelectorAll(".rp-dot.is-a")).toHaveLength(row.days[0].length);
    }
  });

  // The patterns a read dropped are shown only on a week without a read, where they are its body;
  // a week with a read leaves them out (product decision 2026-10-10).
  it("lists the dropped patterns only on a week without a read", () => {
    const dropped = (read: InsightsRead) => read.checked.filter((check) => check.verdict === "dropped").length;
    expect(dropped(READ_VIDEO_DAYS)).toBeGreaterThan(0);
    for (const read of [READ_VIDEO_DAYS, READ_LOG[1]]) {
      const { container } = page(read);
      expect(container.querySelector(".rp-list")).toBeNull();
      expect(container.textContent).not.toContain("left out");
      cleanup();
    }
    expect(page(READ_ABSTAIN).container.querySelectorAll(".rp-list li")).toHaveLength(dropped(READ_ABSTAIN));
  });

  it("shows only the day-by-day evidence when a read has no app breakdown", () => {
    const { container } = page(READ_LOG[1]);
    expect(container.querySelector(".rp-web")).toBeNull();
    expect(container.querySelector(".rp-flow")).toBeNull();
  });

  // The read's only reaction is two thumbs; the pick is kept on this device per read and pressing it again clears it.
  it("keeps a read's thumb on this device and clears it on a second press", () => {
    window.localStorage.clear();
    page(READ_VIDEO_DAYS);
    const useful = () => screen.getByRole("button", { name: "Useful" });
    fireEvent.click(useful());
    expect(useful().getAttribute("aria-pressed")).toBe("true");
    cleanup();
    page(READ_VIDEO_DAYS);
    expect(useful().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(useful());
    expect(useful().getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem("drifty.read.votes.v1")).toBe("{}");
    cleanup();
    page(READ_ABSTAIN);
    expect(screen.queryByRole("group", { name: "Was this useful?" })).toBeNull();
  });

  // Taking on this week's try marks it as running and tells the next read to check it.
  it("keeps this week's try pressed once the user takes it on, and lets it go on a second press", () => {
    page(READ_LOG[0]);
    const pill = () => screen.getByRole("button", { name: /this week/ });
    expect(pill().getAttribute("aria-pressed")).toBe("false");
    expect(pill().textContent).toBe("Try this week");
    fireEvent.click(pill());
    expect(pill().getAttribute("aria-pressed")).toBe("true");
    expect(pill().textContent).toBe("Trying this week");
    fireEvent.click(pill());
    expect(pill().getAttribute("aria-pressed")).toBe("false");
  });

  // The try line is one block: this week's try, then last week's result on one line. No steps and no next-read cell
  // (product decision 2026-10-10).
  it("draws the try as one block with last week's result under it", () => {
    const { container } = page(READ_LOG[0]);
    const block = container.querySelector(".rp-try")!;
    expect(block.querySelector(".rp-trylead__what")?.textContent).toBe(READ_LOG[0].tryNext!.action.en);
    expect(block.querySelector(".rp-tryres__what")?.textContent).toBe(READ_LOG[0].followUp!.action.en);
    expect(block.querySelector(".rp-tryres__verdict")?.textContent).toBe("Steady");
    expect(block.querySelectorAll(".rp-step, .rp-seg, ol")).toHaveLength(0);
  });

  // An older week that neither tried anything nor was tried on draws no try line.
  it("leaves out the try line for a past week with nothing to try or check", () => {
    expect(page(READ_ABSTAIN).container.querySelector(".rp-try")).toBeNull();
  });

  // Your read steps through weeks with Your usage's navigator, in the toolbar slot Your usage uses.
  it("puts the week navigator in the Insights toolbar and stops at either end", () => {
    const toolbar = document.createElement("div");
    document.body.appendChild(toolbar);
    const selected: string[] = [];
    const view = (id: string) => (
      <ReadPage log={READ_LOG} selectedId={id} onSelect={(next) => selected.push(next)} toolbar={toolbar} />
    );
    const { rerender } = render(view(READ_LOG[0].id));
    const nav = toolbar.querySelector(".day-nav");
    expect(nav?.textContent).toContain("Sep 21–27");
    expect((screen.getByRole("button", { name: "Newer read" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Go to the latest read" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Older read" }));
    expect(selected).toEqual([READ_LOG[1].id]);
    rerender(view(READ_LOG[READ_LOG.length - 1].id));
    expect((screen.getByRole("button", { name: "Older read" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Go to the latest read" }));
    expect(selected).toEqual([READ_LOG[1].id, READ_LOG[0].id]);
    toolbar.remove();
  });
});
