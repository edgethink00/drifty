// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { formatLocalizedDayLabel } from "../../lib/formatting";
import { buildActivityLabelBlocks } from "../activity-labels/activityLabelBlocks";
import { ActivityInspectionProvider, useActivityInspection, type ActivityInspectionOptions } from "./ActivityInspectionContext";
import { ACTIVITY_DELETE_HOLD_MS, ActivityDeleteStyleContext, DEFAULT_ACTIVITY_DELETE_STYLE, type ActivityDeleteStyle } from "./activityDeleteStyle";
import { ActivityInspectorPreview, WeekActivityInspector, type ActivityInspectorEvent } from "./WeekActivityInspector";

const inspectionStyles = readFileSync(resolve("src/features/dashboard/activity-inspection.css"), "utf8");

const segment: ActivitySegment = {
  id: "record-1", appName: "Code", bundleId: "com.code", platform: "macos", source: "nsworkspace",
  startedAt: "2026-10-17T09:00:00", endedAt: "2026-10-17T09:30:00", durationSeconds: 1800,
  classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 },
};
const event: ActivityInspectorEvent = {
  id: "block-1", day: "2026-10-17", surface: "week", segmentIds: [segment.id], appName: "Code",
  category: "workspace", productivity: "focus", startLabel: "09:00", endLabel: "09:30", durationSeconds: 1800,
  hasMixedCategory: false, hasMixedProductivity: false, detailLabel: "Recorded context",
  identities: [{ id: "code", label: "Code", appName: "Code", bundleId: "com.code", siteDomain: null, seconds: 1800 }],
};
type InspectorProps = ComponentProps<typeof WeekActivityInspector>;
let anchor: HTMLButtonElement;
let stylesheet: HTMLStyleElement;

function setRect(element: HTMLElement, top: number) {
  element.getBoundingClientRect = () => ({
    x: 30, y: top, left: 30, top, right: 130, bottom: top + 40,
    width: 100, height: 40, toJSON: () => ({}),
  });
}

beforeEach(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = inspectionStyles;
  document.head.append(stylesheet);
  anchor = document.createElement("button");
  anchor.textContent = "Source activity";
  document.body.append(anchor);
  setRect(anchor, 100);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => {
  cleanup();
  anchor.remove();
  stylesheet.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function PanelChrome({ host = true }: { readonly host?: boolean }) {
  const { registerPanel, panelActive, dismissSelection } = useActivityInspection();
  return (
    <aside className="week-v2-side__content" data-testid="chrome" data-detail-active={panelActive} style={{ overflowY: "auto" }}>
      <button className="week-v2-side__head" onClick={dismissSelection}>Summary tab</button>
      <div data-testid="summary">Day summary</div>
      {host ? <div className="activity-detail-slot" data-testid="panel-host" ref={registerPanel} hidden={!panelActive} /> : null}
    </aside>
  );
}

function Selection({ onClose, ...props }: Partial<InspectorProps>) {
  const [selected, setSelected] = useState(true);
  return selected ? (
    <WeekActivityInspector
      event={event} segments={[segment]} appIcons={{}} anchorElement={anchor}
      {...props}
      onClose={(restoreFocus) => {
        onClose?.(restoreFocus);
        setSelected(false);
      }}
    />
  ) : null;
}

function panelTree(props: Partial<InspectorProps> = {}, {
  host = true, onRequestOpen = () => undefined, language = "en" as "en" | "ko",
  options = {} as Partial<ActivityInspectionOptions>,
  deleteStyle = DEFAULT_ACTIVITY_DELETE_STYLE as ActivityDeleteStyle,
} = {}) {
  return (
    <LocalizationTestProvider language={language}>
      <ActivityDeleteStyleContext.Provider value={deleteStyle}>
        <ActivityInspectionProvider options={{ presentation: "panel", hover: "off", ...options }} scopeKey="day" onRequestOpen={onRequestOpen}>
          <PanelChrome host={host} />
          <Selection {...props} />
        </ActivityInspectionProvider>
      </ActivityDeleteStyleContext.Provider>
    </LocalizationTestProvider>
  );
}

describe("activity inspector panel", () => {
  it("leads with the block's name and lists its activities in time order in the log body", () => {
    const start = Date.parse("2026-10-17T09:00:00");
    const detailLog = vi.fn(() => ({
      runs: [
        { label: "Checkout handler", kind: "activity" as const, seconds: 600, totalSeconds: 660, startMs: start, endMs: start + 11 * 60_000, segmentIds: [segment.id], also: { label: "Slack", kind: "app" as const, seconds: 60 } },
        { label: "youtube.com", kind: "app" as const, seconds: 240, totalSeconds: 240, startMs: start + 12 * 60_000, endMs: start + 16 * 60_000, segmentIds: [segment.id] },
      ],
      recordedSeconds: 1800,
    }));
    render(panelTree({ detailLog, logStretch: { startMs: start, endMs: start + 30 * 60_000, segmentIds: [segment.id] } }));
    const detail = within(screen.getByTestId("panel-host")).getByRole("region", { name: "Activity details" });
    // The app header gives way to the name (the app here, as the block has none) and its stretch.
    expect(within(detail).queryByRole("heading", { level: 3, name: "Code" })).toBeNull();
    expect(detail.querySelector(".activity-log-head__app")?.textContent).toBe("Code");
    expect(detail.querySelector(".activity-log-meta")?.textContent).toContain("09:00–09:30");
    expect(detail.querySelector(".activity-log-meta")?.textContent).toContain("30m recorded");
    const rows = within(within(detail).getByRole("region", { name: "Details" })).getAllByRole("listitem");
    // Nothing under anything: start time, what it was (a second activity after a dot), its minutes.
    expect(rows.map((row) => row.textContent)).toEqual(["09:00Checkout handler · Slack11m", "09:12youtube.com4m"]);
    expect(rows[1].classList.contains("activity-detail-log__row--app")).toBe(true);
    expect(detail.querySelector(".week-activity-inspector__activity-list")).toBeNull();
    expect(detailLog).toHaveBeenCalledWith(start, start + 30 * 60_000, [segment.id]);
  });

  it("portals accessible details into the host, registers once, and leaves pointer focus alone", () => {
    const onRequestOpen = vi.fn();
    anchor.focus();
    // JSDOM treats every programmatic focus as focus-visible; model pointer focus.
    vi.spyOn(anchor, "matches").mockImplementation((selector) => selector === ":focus-visible"
      ? false : HTMLElement.prototype.matches.call(anchor, selector));
    render(panelTree({}, { onRequestOpen }));
    const host = screen.getByTestId("panel-host");
    const detail = within(host).getByRole("region", { name: "Activity details" });
    expect(detail.parentElement).toBe(host);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(detail).queryByRole("heading", { name: "Activity details" })).toBeNull();
    expect(within(detail).getByRole("heading", { level: 3, name: "Code" })).toBeTruthy();
    // The date has its own line, so the time and length wrap as one unit.
    expect(detail.querySelector(".week-activity-inspector__date")?.textContent).toBe(formatLocalizedDayLabel(event.day!, "en"));
    expect(detail.querySelector(".week-activity-inspector__time")?.textContent).toBe("09:00–09:30 · 30m");
    expect(within(detail).queryByText("Recorded context")).toBeNull();
    expect(within(detail).getByRole("list")).toBeTruthy();
    expect((detail as HTMLElement).style.left).toBe("");
    expect((detail as HTMLElement).style.top).toBe("");
    expect((detail as HTMLElement).style.width).toBe("100%");
    expect(document.activeElement).toBe(anchor);
    expect(getComputedStyle(detail).position).toBe("static");
    expect(getComputedStyle(detail).overflow).toBe("visible");
    expect(getComputedStyle(detail).boxShadow).toBe("none");
    expect(getComputedStyle(host).minWidth).toBe("0");
    expect(getComputedStyle(screen.getByTestId("summary")).display).toBe("none");
    expect(getComputedStyle(screen.getByRole("button", { name: "Summary tab" })).display).not.toBe("none");
    expect(onRequestOpen).toHaveBeenCalledTimes(1);
  });

  it("waits for a panel host without falling back to a body popover", () => {
    const onRequestOpen = vi.fn();
    const { rerender } = render(panelTree({}, { host: false, onRequestOpen }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.querySelector(".week-activity-inspector")).toBeNull();
    expect(onRequestOpen).toHaveBeenCalledTimes(1);
    rerender(panelTree({}, { host: true, onRequestOpen }));
    expect(within(screen.getByTestId("panel-host")).getByRole("region")).toBeTruthy();
    expect(onRequestOpen).toHaveBeenCalledTimes(1);
  });

  it("focuses details once for a keyboard opening when its host arrives, then preserves focus across updates", () => {
    anchor.focus();
    vi.spyOn(anchor, "matches").mockImplementation((selector) => selector === ":focus-visible"
      ? true : HTMLElement.prototype.matches.call(anchor, selector));
    const onClassify = vi.fn(async () => undefined);
    const { rerender } = render(panelTree({ onClassify }, { host: false }));
    expect(document.activeElement).toBe(anchor);
    rerender(panelTree({ onClassify }));
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Activity details" }));
    const category = screen.getByRole("button", { name: /Change Category/ });
    category.focus();
    rerender(panelTree({ onClassify, event: { ...event, appName: "Refreshed Code" } }));
    expect(document.activeElement).toBe(category);
  });

  it("keeps the selection through chart scrolling, offscreen and disconnected anchors, and outside clicks", async () => {
    const onClose = vi.fn();
    render(panelTree({ onClose }));
    setRect(anchor, -400);
    fireEvent.scroll(window);
    fireEvent.resize(window);
    anchor.remove();
    fireEvent.scroll(document);
    fireEvent.pointerDown(document.body);
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 10)); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Activity details" })).toBeTruthy();
  });

  it.each(["Escape", "Summary tab"])("returns to summary through %s and restores focus without scrolling", (action) => {
    const onClose = vi.fn();
    const focus = vi.spyOn(anchor, "focus");
    render(panelTree({ onClose }));
    const summary = screen.getByTestId("summary");
    const chrome = screen.getByTestId("chrome");
    chrome.scrollTop = 190;
    if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: action }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getByTestId("summary")).toBe(summary);
    expect(getComputedStyle(summary).display).not.toBe("none");
    expect(chrome.scrollTop).toBe(190);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("closes a nested picker on the first Escape and the panel on the second", () => {
    const onClose = vi.fn();
    render(panelTree({ onClose, onClassify: vi.fn(async () => undefined) }));
    fireEvent.click(screen.getByRole("button", { name: /Change Category/ }));
    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(within(listbox).getByRole("option", { name: "Workspace" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves and undoes on the original source records without re-registering during a save", async () => {
    let finishSave!: () => void;
    const onSaveValues = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }))
      .mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onRequestOpen = vi.fn();
    render(panelTree({ onSaveValues, onClose }, { onRequestOpen }));
    fireEvent.click(screen.getByRole("button", { name: /Change Category/ }));
    fireEvent.click(screen.getByRole("option", { name: "Communication" }));
    expect(onSaveValues).toHaveBeenCalledWith("category", [expect.objectContaining({ segment, category: "communication", productivity: "focus" })]);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Summary tab" }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finishSave(); });
    fireEvent.click(screen.getByRole("button", { name: "Undo Category change" }));
    await waitFor(() => expect(onSaveValues).toHaveBeenCalledTimes(2));
    expect(onSaveValues.mock.calls[1]).toEqual(["category", [expect.objectContaining({ segment, category: "workspace", productivity: "focus" })]]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo Category change" })).toBeNull());
    expect(onRequestOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Summary tab" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the panel open while a delete runs and retries it on failure", async () => {
    let failDelete!: (error: Error) => void;
    const onDelete = vi.fn().mockImplementationOnce(() => new Promise<void>((_, reject) => { failDelete = reject; }))
      .mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(panelTree({ onDelete, onClose }));
    const detail = screen.getByRole("region", { name: "Activity details" });
    fireEvent.click(within(detail).getByRole("button", { name: "Delete activity…" }));
    expect(onDelete).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 400));
    fireEvent.click(within(detail).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith([segment.id]);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Summary tab" }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { failDelete(new Error("Try again")); });
    expect(within(detail).getByRole("alert").textContent).toContain("Try again");
    fireEvent.click(within(detail).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getComputedStyle(screen.getByTestId("summary")).display).not.toBe("none"));
  });

  it.each(["remote records", "preview data", "missing records"])("disables editing and deletion for %s", (reason) => {
    render(panelTree({ actionsDisabledReason: reason, onSaveValues: vi.fn(), onDelete: vi.fn() }));
    expect((screen.getByRole("button", { name: /Change Category/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Change Productivity/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^Delete activity/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("localizes the detail region and selected date", () => {
    render(panelTree({}, { language: "ko" }));
    const detail = screen.getByRole("region", { name: "활동 상세" });
    expect(detail.textContent).toContain(formatLocalizedDayLabel(event.day!, "ko"));
  });

  it("uses the actual site identity instead of a long window title, with the icon at the first line", () => {
    const longTitle = "arxiv.org · Example Paper: A Long Title for Overflow Testing";
    render(panelTree({ event: { ...event, appName: longTitle, detailLabel: longTitle,
      identities: [{ ...event.identities[0], appName: "Safari", siteDomain: "arxiv.org", label: longTitle }],
    } }));
    const header = screen.getByRole("heading", { level: 3, name: "arxiv.org" }).closest("header")!;
    expect(header.textContent).not.toContain(longTitle);
    expect(header.textContent).toContain("09:00–09:30");
    expect(getComputedStyle(header).alignItems).toBe("start");
    expect(screen.queryByRole("heading", { name: "Activity details" })).toBeNull();
  });

  it("keeps its source records and uses the latest close callback across parent reanchoring", async () => {
    const oldClose = vi.fn();
    const newClose = vi.fn();
    const onRequestOpen = vi.fn();
    const onSaveValues = vi.fn(async () => undefined);
    const { rerender } = render(panelTree({ onClose: oldClose, onSaveValues }, { onRequestOpen }));
    const replacementAnchor = document.createElement("button");
    document.body.append(replacementAnchor);
    setRect(replacementAnchor, -200);
    const focus = vi.spyOn(replacementAnchor, "focus");
    try {
      rerender(panelTree({ anchorElement: replacementAnchor, onClose: newClose, onSaveValues,
        event: { ...event, id: "regrouped", appName: "Regrouped Code" }, segments: [{ ...segment, id: "unrelated-new-record" }],
      }, { onRequestOpen }));
      fireEvent.click(screen.getByRole("button", { name: /Change Category/ }));
      fireEvent.click(screen.getByRole("option", { name: "Communication" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Undo Category change" })).toBeTruthy());
      expect(onSaveValues).toHaveBeenCalledWith("category", [expect.objectContaining({ segment })]);
      expect(onRequestOpen).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Summary tab" }));
      expect(oldClose).not.toHaveBeenCalled();
      expect(newClose).toHaveBeenCalledWith(false);
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      replacementAnchor.remove();
    }
  });
});

describe("original popover presentation", () => {
  it.each(["outside", "offscreen"])("keeps default body placement, mount focus and %s dismissal without a provider", (action) => {
    const onClose = vi.fn();
    render(<Selection onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Code" });
    expect(dialog.parentElement).toBe(document.body);
    expect((dialog as HTMLElement).style.width).toBe("304px");
    expect(document.activeElement).toBe(dialog);
    if (action === "outside") fireEvent.pointerDown(document.body);
    else { setRect(anchor, -400); fireEvent.scroll(window); }
    expect(onClose).toHaveBeenCalledWith(false);
  });
});

describe("activity panel navigation and actions", () => {
  it.each([
    ["note", "Delete this activity · This can't be undone."],
    ["banner", "Deleting this activity cannot be undone."],
  ] as const)("asks in the bar (%s): Delete keeps its place, the bar warns, and nothing times out", (deleteStyle, sentence) => {
    vi.useFakeTimers();
    try {
      const onDelete = vi.fn(async () => undefined);
      render(panelTree({ onDelete }, { deleteStyle }));
      const detail = screen.getByRole("region", { name: "Activity details" });
      const footer = detail.querySelector<HTMLElement>(".activity-inspection__footer")!;
      const request = within(detail).getByRole("button", { name: "Delete activity…" });
      fireEvent.click(request);
      // The same button in the same spot waits, with the same label.
      const armed = within(detail).getByRole("button", { name: "Delete" });
      expect(armed).toBe(request);
      expect(footer.dataset.style).toBe(deleteStyle);
      // The narrow bar shows the warning; the full sentence with the count is its title and description.
      const note = footer.querySelector<HTMLElement>(".activity-inspection__footer-note")!;
      expect(note.textContent).toBe("This can't be undone.");
      expect(note.title).toBe(sentence);
      expect(document.getElementById(armed.getAttribute("aria-describedby")!)?.textContent).toBe(sentence);
      expect(footer.querySelector(".activity-inspection__arm-timer")).toBeNull();
      expect(within(detail).getByRole("heading", { level: 3, name: "Code" })).toBeTruthy();
      // A double-click lands its second press inside the guard and deletes nothing.
      fireEvent.click(armed);
      expect(onDelete).not.toHaveBeenCalled();
      // No timer lets it go.
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(footer.dataset.armed).toBe("true");
      // Cancel does, and gives focus back to Delete.
      fireEvent.click(within(footer).getByRole("button", { name: "Cancel" }));
      expect(footer.dataset.armed).toBeUndefined();
      expect(footer.querySelector(".activity-inspection__footer-note")).toBeNull();
      expect(document.activeElement).toBe(within(detail).getByRole("button", { name: "Delete activity…" }));
      // So does Escape, before it leaves the activity.
      fireEvent.click(within(detail).getByRole("button", { name: "Delete activity…" }));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(within(footer).queryByRole("button", { name: "Cancel" })).toBeNull();
      fireEvent.click(within(detail).getByRole("button", { name: "Delete activity…" }));
      act(() => { vi.advanceTimersByTime(400); });
      fireEvent.click(within(detail).getByRole("button", { name: "Delete" }));
      expect(onDelete).toHaveBeenCalledWith([segment.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the same button without a timer, letting it go when the pointer leaves, focus moves on or a press lands elsewhere", () => {
    vi.useFakeTimers();
    try {
      const onDelete = vi.fn(async () => undefined);
      render(panelTree({ onDelete, onClassify: vi.fn(async () => undefined) }, { deleteStyle: "steady" }));
      const detail = screen.getByRole("region", { name: "Activity details" });
      const footer = detail.querySelector<HTMLElement>(".activity-inspection__footer")!;
      const request = within(detail).getByRole("button", { name: "Delete activity…" });
      const arm = () => fireEvent.click(within(detail).getByRole("button", { name: "Delete activity…" }));
      arm();
      const armed = within(detail).getByRole("button", { name: "Delete" });
      expect(armed).toBe(request);
      expect(armed.dataset.tip).toBe("Delete this activity · This can't be undone.");
      expect(within(footer).getAllByRole("button")).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(footer.dataset.armed).toBe("true");
      const leave = new Event("pointerleave");
      Object.defineProperty(leave, "pointerType", { value: "mouse" });
      act(() => { footer.dispatchEvent(leave); });
      expect(footer.dataset.armed).toBeUndefined();
      arm();
      fireEvent.pointerDown(document.body);
      expect(footer.dataset.armed).toBeUndefined();
      arm();
      fireEvent.focusOut(request, { relatedTarget: within(detail).getByRole("button", { name: /Change Category/ }) });
      expect(footer.dataset.armed).toBeUndefined();
      arm();
      act(() => { vi.advanceTimersByTime(400); });
      fireEvent.click(within(detail).getByRole("button", { name: "Delete" }));
      expect(onDelete).toHaveBeenCalledWith([segment.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks in a small card above Delete, closing on Cancel, Escape or a press outside", () => {
    const onDelete = vi.fn(async () => undefined);
    render(panelTree({ onDelete }, { deleteStyle: "popover" }));
    const detail = screen.getByRole("region", { name: "Activity details" });
    const request = within(detail).getByRole("button", { name: "Delete activity…" });
    fireEvent.click(request);
    let card = within(detail).getByRole("dialog", { name: "Delete activity?" });
    expect(card.textContent).toContain("Deleting this activity cannot be undone.");
    expect(request.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(detail).queryByRole("dialog")).toBeNull();
    fireEvent.click(request);
    fireEvent.pointerDown(document.body);
    expect(within(detail).queryByRole("dialog")).toBeNull();
    fireEvent.click(request);
    fireEvent.click(within(within(detail).getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(within(detail).queryByRole("dialog")).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(request);
    card = within(detail).getByRole("dialog");
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith([segment.id]);
  });

  it("asks in the panel body under the activity's header in the panel candidate", () => {
    const onDelete = vi.fn(async () => undefined);
    render(panelTree({ onDelete }, { deleteStyle: "panel" }));
    const detail = screen.getByRole("region", { name: "Activity details" });
    const request = within(detail).getByRole("button", { name: "Delete activity…" });
    fireEvent.click(request);
    const question = detail.querySelector<HTMLElement>(".week-activity-inspector__confirmation")!;
    expect(question.textContent).toContain("Delete activity?");
    expect(question.textContent).toContain("Deleting this activity cannot be undone.");
    expect(within(detail).getByRole("heading", { level: 3, name: "Code" })).toBeTruthy();
    // The question takes the body's place above the bar, which waits without a second Delete.
    const footer = detail.querySelector<HTMLElement>(".activity-inspection__footer")!;
    expect(question.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.querySelector("[data-delete-request]")).toBeNull();
    expect(document.activeElement).toBe(within(question).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(detail.querySelector(".week-activity-inspector__confirmation")).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Delete activity…" }));
    fireEvent.click(within(detail.querySelector<HTMLElement>(".week-activity-inspector__confirmation")!).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith([segment.id]);
  });

  it("deletes only once Delete has been held, by pointer or keyboard, and says so after a short press", () => {
    vi.useFakeTimers();
    try {
      const onDelete = vi.fn(async () => undefined);
      const { unmount } = render(panelTree({ onDelete }, { deleteStyle: "hold" }));
      const detail = screen.getByRole("region", { name: "Activity details" });
      const footer = detail.querySelector<HTMLElement>(".activity-inspection__footer")!;
      const button = within(detail).getByRole("button", { name: "Delete activity…" });
      expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toBe("Hold to delete");
      fireEvent.click(button);
      fireEvent.pointerDown(button);
      expect(button.dataset.holding).toBe("true");
      act(() => { vi.advanceTimersByTime(ACTIVITY_DELETE_HOLD_MS / 2); });
      fireEvent.pointerUp(button);
      expect(onDelete).not.toHaveBeenCalled();
      expect(button.dataset.holding).toBeUndefined();
      expect(footer.querySelector(".activity-inspection__footer-note")?.textContent).toBe("Hold to delete");
      fireEvent.pointerDown(button);
      act(() => { vi.advanceTimersByTime(ACTIVITY_DELETE_HOLD_MS); });
      expect(onDelete).toHaveBeenCalledWith([segment.id]);
      unmount();

      const onKeyboardDelete = vi.fn(async () => undefined);
      render(panelTree({ onDelete: onKeyboardDelete }, { deleteStyle: "hold" }));
      const keyboardButton = screen.getByRole("button", { name: "Delete activity…" });
      fireEvent.keyDown(keyboardButton, { key: " " });
      fireEvent.keyDown(keyboardButton, { key: " ", repeat: true });
      act(() => { vi.advanceTimersByTime(ACTIVITY_DELETE_HOLD_MS); });
      expect(onKeyboardDelete).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a newly chosen candidate from its first press", () => {
    const onDelete = vi.fn(async () => undefined);
    const { rerender } = render(panelTree({ onDelete }, { deleteStyle: "note" }));
    const detail = screen.getByRole("region", { name: "Activity details" });
    fireEvent.click(within(detail).getByRole("button", { name: "Delete activity…" }));
    expect(detail.querySelector(".activity-inspection__footer")?.getAttribute("data-armed")).toBe("true");
    rerender(panelTree({ onDelete }, { deleteStyle: "popover" }));
    const footer = detail.querySelector<HTMLElement>(".activity-inspection__footer")!;
    expect(footer.dataset.style).toBe("popover");
    expect(footer.dataset.armed).toBeUndefined();
    expect(within(detail).queryByRole("dialog")).toBeNull();
    expect(within(detail).getByRole("heading", { level: 3, name: "Code" })).toBeTruthy();
  });

  it("deletes on one press in the undo candidate, leaving Undo to the app", async () => {
    const onDelete = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(panelTree({ onDelete, onClose }, { deleteStyle: "undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete activity…" }));
    expect(onDelete).toHaveBeenCalledWith([segment.id]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("keeps the previous second press within three seconds as a candidate", () => {
    vi.useFakeTimers();
    try {
      const onDelete = vi.fn(async () => undefined);
      render(panelTree({ onDelete }, { deleteStyle: "timer" }));
      const detail = screen.getByRole("region", { name: "Activity details" });
      const footer = detail.querySelector<HTMLElement>(".activity-inspection__footer")!;
      fireEvent.click(within(detail).getByRole("button", { name: "Delete activity…" }));
      const armed = within(detail).getByRole("button", { name: "Confirm" });
      expect(armed.dataset.tip).toBe("Delete this activity · This can't be undone.");
      expect(document.getElementById(armed.getAttribute("aria-describedby")!)?.textContent).toBe(armed.dataset.tip);
      expect(armed.querySelector(".activity-inspection__arm-timer")).toBeTruthy();
      // Nothing else in the bar or the activity changes while it waits.
      expect(within(detail).getByRole("heading", { level: 3, name: "Code" })).toBeTruthy();
      expect(footer.querySelectorAll("button")).toHaveLength(1);
      // A double-click lands its second press inside the guard and deletes nothing.
      fireEvent.click(armed);
      expect(onDelete).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(3000); });
      expect(within(detail).queryByRole("button", { name: "Confirm" })).toBeNull();
      expect(document.activeElement).toBe(within(detail).getByRole("button", { name: "Delete activity…" }));
      // Escape also disarms before it leaves the activity.
      fireEvent.click(within(detail).getByRole("button", { name: "Delete activity…" }));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(within(detail).getByRole("button", { name: "Delete activity…" })).toBeTruthy();
      fireEvent.click(within(detail).getByRole("button", { name: "Delete activity…" }));
      act(() => { vi.advanceTimersByTime(2000); });
      fireEvent.click(within(detail).getByRole("button", { name: "Confirm" }));
      expect(onDelete).toHaveBeenCalledWith([segment.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a failed footer delete armed with its error until it is retried", async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new Error("disk busy")).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(panelTree({ onClose, onDelete }));
    const detail = screen.getByRole("region", { name: "Activity details" });
    fireEvent.click(within(detail).getByRole("button", { name: "Delete activity…" }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    fireEvent.click(within(detail).getByRole("button", { name: "Delete" }));
    expect(await within(detail).findByRole("alert")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    const retry = within(detail).getByRole("button", { name: "Delete" });
    expect(retry.dataset.tip).toBeUndefined();
    fireEvent.click(retry);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledTimes(2);
  });


  it("names the footer delete action with its full scope and keeps its guards", () => {
    const { unmount } = render(panelTree({ onDelete: vi.fn(async () => undefined) }));
    const button = screen.getByRole("button", { name: "Delete activity…" });
    expect(button.textContent?.trim()).toBe("Delete");
    expect(document.querySelector(".week-activity-inspector__actions")).toBeNull();
    fireEvent.click(button);
    expect(document.querySelector("[data-delete-confirm]")).toBeTruthy();
    unmount();
    render(panelTree({ onDelete: vi.fn(), actionsDisabledReason: "remote records" }));
    expect((screen.getByRole("button", { name: "Delete activity…" }) as HTMLButtonElement).disabled).toBe(true);
  });

});

describe("activity hover preview", () => {
  function preview() {
    const [block] = buildActivityLabelBlocks(new Map([[event.day!, [{ topMinutes: 540, durationMinutes: 30, segmentIds: [segment.id] }]]]), {
      startOfDayMinutes: 0, segmentsById: new Map([[segment.id, segment]]), labels: [], windows: [], language: "en", nowMs: Date.now(),
    });
    const activityLabel = { block, display: { title: "Recorded task name", description: "Recorded task context", origin: "ai" as const, status: "ready" as const }, scope: "block" as const };
    return <ActivityInspectorPreview event={event} segments={[segment]} appIcons={{}} anchorElement={anchor}
      actionsDisabledReason={null} activityLabel={activityLabel} onDismiss={vi.fn()} />;
  }

  it("retains the full read-only hover content", () => {
    render(preview());
    const tooltip = screen.getByRole("tooltip", { name: "Code" });
    expect(tooltip.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(2);
    expect(within(tooltip).getByRole("list")).toBeTruthy();
    expect(within(tooltip).getByText(/^Delete activity/)).toBeTruthy();
    expect(within(tooltip).queryByRole("button")).toBeNull();
  });
});
