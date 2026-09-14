// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionPill } from "./CompanionPill";
import {
  CompanionPillMoment,
  resolveCompanionPillAutoDismissMs,
  type CompanionPillMomentEvent,
} from "./CompanionPillMoment";
import {
  buildCompanionExtremeNudgePreview,
  buildCompanionMilestonePreview,
} from "./companionPillPreview";

const nativeBridge = vi.hoisted(() => ({
  dragNativeCompanion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./watcherBridge", () => ({
  dragNativeCompanion: nativeBridge.dragNativeCompanion,
}));

function renderPill() {
  const onOpenDashboard = vi.fn();
  const onOpenMenu = vi.fn();
  return {
    ...render(
      <CompanionPill
        peekEvent={null}
        momentEvent={null}
        onDismissMoment={vi.fn()}
        onOpenDashboard={onOpenDashboard}
        onOpenSettings={vi.fn()}
        onOpenMenu={onOpenMenu}
      />,
    ),
    onOpenDashboard,
    onOpenMenu,
  };
}

const driftMoment: CompanionPillMomentEvent = {
  kind: "driftAlarm",
  id: "drift-1",
  title: "Still on YouTube.",
  summary: "Focus was VS Code.",
  returnLabel: "Back to VS Code",
  returnTargetId: "com.microsoft.VSCode",
  breakLabel: "5-min break",
  correctionLabel: "Not a drift",
};

function dispatchPointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  options: MouseEventInit & { pointerId: number },
) {
  const event = new MouseEvent(type, { bubbles: true, ...options });
  Object.defineProperty(event, "pointerId", { value: options.pointerId });
  fireEvent(element, event);
}

/* The card enters once the native geometry is wide enough to reveal its final
   layout. AppKit only reveals or clips that layout instead of squeezing it. */
function paintMomentFrame() {
  act(() => {
    vi.advanceTimersByTime(180);
  });
}

describe("CompanionPill native interactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("scales auto-dismiss time to each moment's information and action load", () => {
    const review = {
      kind: "endOfDayReview" as const,
      day: "2026-08-03",
      generatedAt: new Date().toISOString(),
      trackedLabel: "6:34 tracked",
      focusLabel: "4:12 focus",
      driftLabel: "0:58 drift",
      totalSeconds: 23_640,
      focusSeconds: 15_120,
      driftSeconds: 3_480,
      topSource: null,
    };
    const passingMilestone: CompanionPillMomentEvent = {
      kind: "milestone",
      id: "recovery",
      milestoneKind: "recovery",
      tier: 1,
      title: "Back in focus",
      subtitle: "You returned on your own.",
      destination: null,
    };

    expect(resolveCompanionPillAutoDismissMs(passingMilestone)).toBe(4_000);
    expect(resolveCompanionPillAutoDismissMs(buildCompanionMilestonePreview("weekly-final-rank-1", 1))).toBe(6_000);
    expect(resolveCompanionPillAutoDismissMs({ ...driftMoment, mode: "drift" })).toBe(9_000);
    expect(resolveCompanionPillAutoDismissMs({ ...driftMoment, mode: "break_return" })).toBe(12_500);
    expect(resolveCompanionPillAutoDismissMs({ ...review, layout: "full" })).toBe(12_000);
    expect(resolveCompanionPillAutoDismissMs({ ...review, layout: "compact" })).toBe(10_000);
    expect(resolveCompanionPillAutoDismissMs({ ...review, layout: "minimal" })).toBe(8_000);
    expect(resolveCompanionPillAutoDismissMs(buildCompanionExtremeNudgePreview(1))).toBe(12_500);
  });

  it("samples from pointer-down without styling a simple click as a drag", async () => {
    const { container, onOpenDashboard } = renderPill();
    const pill = container.querySelector<HTMLElement>(".pill");
    expect(pill).not.toBeNull();

    dispatchPointer(pill!, "pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      screenX: 1_520,
      screenY: 72,
    });
    dispatchPointer(pill!, "pointerup", { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(pill!);
    await act(async () => undefined);

    expect(nativeBridge.dragNativeCompanion).toHaveBeenCalledOnce();
    expect(nativeBridge.dragNativeCompanion).toHaveBeenCalledWith(10, 10);
    expect(pill?.classList.contains("is-dragging")).toBe(false);
    expect(onOpenDashboard).not.toHaveBeenCalled();
  });

  it("starts one native AppKit drag from the original press", () => {
    nativeBridge.dragNativeCompanion.mockReturnValueOnce(new Promise(() => undefined));
    const { container } = renderPill();
    const pill = container.querySelector<HTMLElement>(".pill");

    dispatchPointer(pill!, "pointerdown", {
      button: 0,
      pointerId: 2,
      clientX: 10,
      clientY: 10,
      screenX: 1_520,
      screenY: 72,
    });
    expect(nativeBridge.dragNativeCompanion).toHaveBeenCalledWith(10, 10);
    expect(nativeBridge.dragNativeCompanion).toHaveBeenCalledOnce();
    expect(pill?.classList.contains("is-dragging")).toBe(true);
  });

  it("does not start a second native drag for movement within one gesture", async () => {
    const { container } = renderPill();
    const pill = container.querySelector<HTMLElement>(".pill");

    dispatchPointer(pill!, "pointerdown", { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
    dispatchPointer(pill!, "pointermove", { buttons: 1, pointerId: 3, clientX: 19, clientY: 10 });
    dispatchPointer(pill!, "pointerup", { button: 0, pointerId: 3, clientX: 19, clientY: 10 });
    await act(async () => undefined);

    expect(nativeBridge.dragNativeCompanion).toHaveBeenCalledOnce();
    expect(pill?.classList.contains("is-dragging")).toBe(false);
  });

  /* Global native tracking continues after the cursor leaves the card; its
     countdown must remain paused for that whole gesture. */
  it("holds a card's auto-dismiss countdown while it is being dragged", async () => {
    vi.useFakeTimers();
    nativeBridge.dragNativeCompanion.mockReturnValueOnce(new Promise(() => undefined));
    const onDismissMoment = vi.fn();
    const { container } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={driftMoment}
        onDismissMoment={onDismissMoment}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    paintMomentFrame();
    const pill = container.querySelector<HTMLElement>(".pill");
    expect(container.querySelector<HTMLElement>(".view--drift")?.dataset.auto).toBe("running");

    dispatchPointer(pill!, "pointerdown", { button: 0, pointerId: 11, clientX: 10, clientY: 10 });

    expect(nativeBridge.dragNativeCompanion).toHaveBeenCalled();
    expect(container.querySelector<HTMLElement>(".view--drift")?.dataset.auto).toBe("paused");
    /* The whole budget can elapse mid-gesture without the card vanishing. */
    act(() => vi.advanceTimersByTime(20_000));
    expect(onDismissMoment).not.toHaveBeenCalled();
  });

  it("never adds auto-dismiss time when the wall clock moves backwards during hover", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T09:30:00.000Z"));
    let monotonicMs = 0;
    const performanceNowSpy = vi.spyOn(performance, "now").mockImplementation(() => monotonicMs);
    const onDismiss = vi.fn();
    const { container } = render(
      <CompanionPillMoment
        event={driftMoment}
        onDismiss={onDismiss}
        onOpenDashboard={vi.fn()}
      />,
    );
    const view = container.querySelector<HTMLElement>(".view--drift");

    monotonicMs = 4_000;
    vi.setSystemTime(new Date("2026-08-05T08:30:00.000Z"));
    fireEvent.pointerEnter(view!);
    act(() => vi.advanceTimersByTime(20_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.pointerLeave(view!);
    act(() => vi.advanceTimersByTime(4_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();
    performanceNowSpy.mockRestore();
  });

  it("holds auto-dismiss while keyboard focus remains inside the card", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { container } = render(
      <CompanionPillMoment
        event={driftMoment}
        onDismiss={onDismiss}
        onOpenDashboard={vi.fn()}
      />,
    );
    const view = container.querySelector<HTMLElement>(".view--drift");
    const primaryAction = container.querySelector<HTMLButtonElement>(".act--primary");

    fireEvent.focus(primaryAction!);
    expect(view?.dataset.auto).toBe("paused");
    act(() => vi.advanceTimersByTime(20_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.blur(primaryAction!, { relatedTarget: null });
    expect(view?.dataset.auto).toBe("running");
    act(() => vi.advanceTimersByTime(8_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not turn pointer-origin focus into a sticky timer hold", () => {
    const { container } = render(
      <CompanionPillMoment
        event={driftMoment}
        onDismiss={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );
    const view = container.querySelector<HTMLElement>(".view--drift");
    const primaryAction = container.querySelector<HTMLButtonElement>(".act--primary");

    fireEvent.pointerDown(primaryAction!);
    fireEvent.focus(primaryAction!);
    expect(view?.dataset.auto).toBe("running");
  });

  /* v2 prints the measured figure beside the headline; v1 states the threshold
     alone. The event carrying (or omitting) the value is what switches it. */
  it("prints a milestone's measured figure only when the event carries one", () => {
    const milestone = {
      kind: "milestone" as const,
      id: "stat-1",
      milestoneKind: "total" as const,
      tier: 1 as const,
      title: "1 hour of focus",
      subtitle: "A solid hour, captured automatically.",
      destination: "dashboard" as const,
      statSeconds: 62 * 60,
    };
    const props = {
      peekEvent: null,
      onDismissMoment: vi.fn(),
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    const { container, rerender } = render(<CompanionPill {...props} momentEvent={milestone} />);

    /* Past an hour it reads as h:mm, so it is not mistaken for minutes:seconds
       on a surface where the resting pill already shows 2:41 that way. */
    expect(container.querySelector(".mile__stat")?.textContent).toBe("1:02");
    expect(container.querySelector(".mile__stat")?.getAttribute("aria-label")).toBe("1:02 today");
    expect(container.querySelector(".mile__action")?.textContent).toContain("View day");

    /* A record is about the run that beat it, not the whole day. */
    rerender(
      <CompanionPill
        {...props}
        momentEvent={{
          ...milestone,
          milestoneKind: "record",
          destination: "insights",
          statSeconds: 48 * 60,
        }}
      />,
    );
    expect(container.querySelector(".mile__stat")?.textContent).toBe("48m");
    expect(container.querySelector(".mile__stat")?.getAttribute("aria-label")).toBe("48m this run");
    expect(container.querySelector(".mile__action")?.textContent).toContain("View insights");

    rerender(
      <CompanionPill
        {...props}
        momentEvent={{
          ...milestone,
          milestoneKind: "rank",
          destination: "leaderboard",
          statLabel: "7 days",
        }}
      />,
    );
    expect(container.querySelector(".mile__stat")?.getAttribute("aria-label")).toBe("1:02 7 days");
    expect(container.querySelector(".mile__action")?.textContent).toContain("View rank");

    rerender(<CompanionPill {...props} momentEvent={{ ...milestone, statSeconds: null }} />);
    expect(container.querySelector(".mile__stat")).toBeNull();
  });

  it("keeps the resident state stable while the pointer is preparing a drag", () => {
    nativeBridge.dragNativeCompanion.mockReturnValueOnce(new Promise(() => undefined));
    const { container } = renderPill();
    const pill = container.querySelector<HTMLElement>(".pill");

    fireEvent.mouseEnter(pill!, { screenX: 10, screenY: 10 });
    fireEvent.mouseMove(pill!, { screenX: 12, screenY: 10 });
    dispatchPointer(pill!, "pointerdown", { button: 0, pointerId: 8, clientX: 10, clientY: 10 });
    expect(pill?.dataset.state).toBe("collapsed");
  });

  /* A drift alarm or the day review can land over whatever you were reading,
     and the panel has no title bar, so the card's own background has to move
     the window. */
  it("drags the window by a decision card's background", async () => {
    const { container } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={driftMoment}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    const pill = container.querySelector<HTMLElement>(".pill");

    dispatchPointer(pill!, "pointerdown", { button: 0, pointerId: 4, clientX: 10, clientY: 10 });
    await act(async () => undefined);

    await waitFor(() => expect(nativeBridge.dragNativeCompanion).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["extreme nudge", buildCompanionExtremeNudgePreview(), ".view--nudge .card__copy"],
    ["day review", {
      kind: "endOfDayReview" as const,
      day: "2026-08-03",
      generatedAt: new Date().toISOString(),
      trackedLabel: "6:34 tracked",
      focusLabel: "4:12 focus",
      driftLabel: "0:58 drift",
      totalSeconds: 23_640,
      focusSeconds: 15_120,
      driftSeconds: 3_480,
      topSource: null,
    }, ".view--eod .eodv12b--head"],
  ])("drags the expanded %s card by its non-control content", async (_label, moment, selector) => {
    const { container } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={moment}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    const dragTarget = container.querySelector<HTMLElement>(selector);
    expect(dragTarget).not.toBeNull();

    dispatchPointer(dragTarget!, "pointerdown", {
      button: 0,
      pointerId: 14,
      clientX: 90,
      clientY: 40,
    });
    await act(async () => undefined);

    expect(nativeBridge.dragNativeCompanion).toHaveBeenCalledOnce();
    expect(nativeBridge.dragNativeCompanion).toHaveBeenCalledWith(90, 40);
  });

  it("routes Compact v2 through compact native geometry while preserving the eod visual state", () => {
    const onStateChange = vi.fn();
    const compactReview = {
      kind: "endOfDayReview" as const,
      layout: "compact" as const,
      day: "2026-08-03",
      generatedAt: new Date().toISOString(),
      trackedLabel: "6:34 tracked",
      focusLabel: "4:12 focus",
      driftLabel: "0:58 drift",
      totalSeconds: 23_640,
      focusSeconds: 15_120,
      driftSeconds: 3_480,
      topSource: null,
    };
    const { container, rerender } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={compactReview}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
        onStateChange={onStateChange}
      />,
    );
    const pill = container.querySelector<HTMLElement>(".pill");

    expect(pill?.dataset.state).toBe("eod");
    expect(pill?.dataset.cardState).toBe("eodCompact");
    expect(pill?.dataset.eodLayout).toBe("compact");
    expect(onStateChange).toHaveBeenCalledWith("eodCompact");

    rerender(
      <CompanionPill
        peekEvent={null}
        momentEvent={{ ...compactReview, layout: "full" }}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
        onStateChange={onStateChange}
      />,
    );
    expect(pill?.dataset.cardState).toBe("eod");
    expect(pill?.dataset.eodLayout).toBe("full");
    expect(onStateChange).toHaveBeenCalledWith("eod");

    rerender(
      <CompanionPill
        peekEvent={null}
        momentEvent={{ ...compactReview, layout: "minimal" }}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
        onStateChange={onStateChange}
      />,
    );
    expect(pill?.dataset.cardState).toBe("eodMinimal");
    expect(pill?.dataset.eodLayout).toBe("compact");
    expect(pill?.dataset.eodVersion).toBe("minimal");
    expect(onStateChange).toHaveBeenCalledWith("eodMinimal");

    rerender(
      <CompanionPill
        peekEvent={null}
        momentEvent={{
          ...compactReview,
          layout: "full",
          assessment: {
            state: "pending",
            route: "cloud",
            reason: "cloud_trial_expired",
            recoveryAction: "upgrade",
          },
        }}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
        onStateChange={onStateChange}
      />,
    );
    expect(pill?.dataset.cardState).toBe("eodPending");
    expect(pill?.dataset.eodAssessment).toBe("pending");
    expect(onStateChange).toHaveBeenCalledWith("eodPending");
  });

  it("opens a milestone destination from its visible CTA on a simple click", () => {
    vi.useFakeTimers();
    const onOpenDestination = vi.fn();
    const { container } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={buildCompanionMilestonePreview("weekly-final-rank-3", 1)}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenMilestoneDestination={onOpenDestination}
        onOpenSettings={vi.fn()}
      />,
    );
    const cardHit = container.querySelector<HTMLElement>(".mile__action");
    expect(cardHit).not.toBeNull();
    expect(cardHit?.textContent).toContain("View rank");

    dispatchPointer(cardHit!, "pointerdown", {
      button: 0,
      pointerId: 31,
      clientX: 70,
      clientY: 24,
    });
    dispatchPointer(cardHit!, "pointermove", {
      buttons: 1,
      pointerId: 31,
      clientX: 72,
      clientY: 25,
    });
    dispatchPointer(cardHit!, "pointerup", {
      button: 0,
      pointerId: 31,
      clientX: 72,
      clientY: 25,
    });
    fireEvent.click(cardHit!);

    expect(nativeBridge.dragNativeCompanion).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLElement>(".pill")?.dataset.momentExiting).toBe("true");
    expect(onOpenDestination).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(160));
    expect(onOpenDestination).toHaveBeenCalledOnce();
    expect(onOpenDestination).toHaveBeenCalledWith("leaderboard");
  });

  it("turns movement on a milestone CTA into a native drag", () => {
    nativeBridge.dragNativeCompanion.mockReturnValueOnce(new Promise(() => undefined));
    const onOpenDestination = vi.fn();
    const { container } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={buildCompanionMilestonePreview("weekly-final-rank-3", 2)}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenMilestoneDestination={onOpenDestination}
        onOpenSettings={vi.fn()}
      />,
    );
    const pill = container.querySelector<HTMLElement>(".pill");
    const cardHit = container.querySelector<HTMLElement>(".mile__action");
    expect(pill).not.toBeNull();
    expect(cardHit).not.toBeNull();

    dispatchPointer(cardHit!, "pointerdown", {
      button: 0,
      pointerId: 32,
      clientX: 70,
      clientY: 24,
    });
    dispatchPointer(pill!, "pointermove", {
      buttons: 1,
      pointerId: 32,
      clientX: 78,
      clientY: 25,
    });
    fireEvent.click(cardHit!);

    expect(nativeBridge.dragNativeCompanion).toHaveBeenCalledOnce();
    expect(nativeBridge.dragNativeCompanion).toHaveBeenCalledWith(70, 24);
    expect(pill?.classList.contains("is-dragging")).toBe(true);
    expect(onOpenDestination).not.toHaveBeenCalled();
  });

  /* Moving a card must never fire the decision printed on it. */
  it("leaves a press that starts on a card control to that control", async () => {
    const onMomentAction = vi.fn();
    const { container } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={driftMoment}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
        onMomentAction={onMomentAction}
      />,
    );
    const actionButton = container.querySelector<HTMLElement>(".card__actions button");
    expect(actionButton).not.toBeNull();

    dispatchPointer(actionButton!, "pointerdown", { button: 0, pointerId: 9, clientX: 10, clientY: 10 });
    dispatchPointer(actionButton!, "pointermove", { buttons: 1, pointerId: 9, clientX: 60, clientY: 30 });
    await act(async () => undefined);

    expect(nativeBridge.dragNativeCompanion).not.toHaveBeenCalled();
  });

  it("expands the companion break choices in place", () => {
    vi.useFakeTimers();
    const onMomentAction = vi.fn();
    const { getByRole, queryByRole } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={driftMoment}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
        onMomentAction={onMomentAction}
      />,
    );
    paintMomentFrame();

    expect(queryByRole("button", { name: "15m" })).toBeNull();
    fireEvent.click(getByRole("button", { name: "5-min break" }));
    expect(getByRole("button", { name: "15m" })).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "15m" }));

    expect(onMomentAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(160));
    expect(onMomentAction).toHaveBeenCalledWith({ type: "start_break", minutes: 15 });
  });

  it("keeps alert settings in the default overflow on drift and extreme cards", () => {
    vi.useFakeTimers();
    const onMomentAction = vi.fn();
    const props = {
      peekEvent: null,
      onDismissMoment: vi.fn(),
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
      onMomentAction,
    };
    const { getByRole, rerender } = render(<CompanionPill {...props} momentEvent={driftMoment} />);
    paintMomentFrame();
    fireEvent.click(getByRole("button", { name: "Open alert settings" }));
    act(() => vi.advanceTimersByTime(160));
    expect(onMomentAction).toHaveBeenCalledWith({ type: "settings" });

    onMomentAction.mockClear();
    rerender(<CompanionPill {...props} momentEvent={buildCompanionExtremeNudgePreview()} />);
    paintMomentFrame();
    fireEvent.click(getByRole("button", { name: "Open alert settings" }));
    act(() => vi.advanceTimersByTime(160));
    expect(onMomentAction).toHaveBeenCalledWith({ type: "settings" });
  });

  it("labels the extreme nudge choice as Take a break and uses its durations", () => {
    vi.useFakeTimers();
    const onMomentAction = vi.fn();
    const { getByRole, queryByRole } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={{
          kind: "extremeNudgeToast",
          placement: "top-right",
          id: "extreme-break-options",
          generatedAt: new Date().toISOString(),
          title: "Closed YouTube for you.",
          closedLabel: "YouTube",
          focusLabel: "VS Code",
          breakOptions: [5, 15, 30, 60],
        }}
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
        onMomentAction={onMomentAction}
      />,
    );
    paintMomentFrame();

    expect(queryByRole("button", { name: "15m" })).toBeNull();
    fireEvent.click(getByRole("button", { name: "Take a break" }));
    fireEvent.click(getByRole("button", { name: "30m" }));

    expect(onMomentAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(160));
    expect(onMomentAction).toHaveBeenCalledWith({ type: "start_break", minutes: 30 });
  });

  it("keeps the current card mounted for the full visual exit before dismissing", () => {
    vi.useFakeTimers();
    const onDismissMoment = vi.fn();
    const { container } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={driftMoment}
        onDismissMoment={onDismissMoment}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    paintMomentFrame();

    const pill = container.querySelector<HTMLElement>(".pill");
    const card = container.querySelector<HTMLElement>(".view--drift");
    fireEvent.click(card!.querySelector(".card__close")!);

    expect(pill?.dataset.momentExiting).toBe("true");
    expect(card?.classList.contains("is-active")).toBe(true);
    expect(onDismissMoment).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(159));
    expect(onDismissMoment).not.toHaveBeenCalled();
    expect(container.querySelector(".view--drift")).toBe(card);
    act(() => vi.advanceTimersByTime(1));
    expect(onDismissMoment).toHaveBeenCalledWith("explicit");
  });

  it("keeps the complete reverse exit for direct menu-bar alerts", () => {
    vi.useFakeTimers();
    const onDismissMoment = vi.fn();
    const { container } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={driftMoment}
        presentsMomentImmediately
        onDismissMoment={onDismissMoment}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelector(".view--drift .card__close")!);
    act(() => vi.advanceTimersByTime(339));
    expect(onDismissMoment).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismissMoment).toHaveBeenCalledWith("explicit");
  });

  it("starts the full auto-dismiss budget only after a direct menu-bar alert is visible", () => {
    vi.useFakeTimers();
    const onDismissMoment = vi.fn();
    const props = {
      peekEvent: null,
      momentEvent: driftMoment,
      presentsMomentImmediately: true,
      onDismissMoment,
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    const { rerender } = render(
      <CompanionPill {...props} directEntryAnimationReady={false} />,
    );

    act(() => vi.advanceTimersByTime(20_000));
    expect(onDismissMoment).not.toHaveBeenCalled();

    rerender(<CompanionPill {...props} directEntryAnimationReady />);
    act(() => vi.advanceTimersByTime(8_999));
    expect(onDismissMoment).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismissMoment).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(340));
    expect(onDismissMoment).toHaveBeenCalledWith("auto");
  });

  it("stages resident controls around the native panel resize", () => {
    vi.useFakeTimers();
    const onStateChange = vi.fn();
    const props = {
      peekEvent: null,
      onDismissMoment: vi.fn(),
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
      onStateChange,
    };
    const { container, rerender } = render(<CompanionPill {...props} momentEvent={null} />);
    rerender(<CompanionPill {...props} momentEvent={driftMoment} />);

    const pill = container.querySelector<HTMLElement>(".pill");
    expect(pill?.dataset.transition).toBe("opening");
    expect(pill?.dataset.anchor).toBe("center");
    expect(pill?.dataset.cardState).toBe("drift");
    expect(container.querySelector(".view--drift")?.classList.contains("is-active")).toBe(false);
    expect(container.querySelector(".view--collapsed")?.classList.contains("is-active")).toBe(true);
    paintMomentFrame();
    expect(container.querySelector(".view--drift")?.classList.contains("is-active")).toBe(true);
    expect(container.querySelector(".view--collapsed")?.classList.contains("is-active")).toBe(false);
    expect(pill?.dataset.transition).toBeUndefined();

    rerender(<CompanionPill {...props} momentEvent={null} />);
    const exitingMoment = container.querySelector(".view--drift");
    expect(exitingMoment).not.toBeNull();
    expect(exitingMoment?.classList.contains("is-active")).toBe(false);
    expect(pill?.dataset.state).toBe("collapsed");
    expect(pill?.dataset.transition).toBe("closing");
    expect(container.querySelector(".view--collapsed")?.classList.contains("is-active")).toBe(false);

    act(() => vi.advanceTimersByTime(39));
    expect(container.querySelector(".view--collapsed")?.classList.contains("is-active")).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector(".view--collapsed")?.classList.contains("is-active")).toBe(true);

    act(() => vi.advanceTimersByTime(260));
    expect(container.querySelector(".view--drift")).toBeNull();
    expect(container.querySelector<HTMLElement>(".pill")?.dataset.state).toBe("collapsed");
  });

  it("pins transition content to the selected left edge", () => {
    vi.useFakeTimers();
    const { container } = render(
      <CompanionPill
        peekEvent={null}
        momentEvent={driftMoment}
        anchor="left"
        onDismissMoment={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const pill = container.querySelector<HTMLElement>(".pill");
    expect(pill?.dataset.transition).toBe("opening");
    expect(pill?.dataset.anchor).toBe("left");
  });

  it("pauses auto-dismiss for a native pointer inside the expanded panel", () => {
    vi.useFakeTimers();
    const onDismissMoment = vi.fn();
    const props = {
      peekEvent: null,
      momentEvent: driftMoment,
      onDismissMoment,
      onOpenDashboard: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    const { container, rerender } = render(
      <CompanionPill {...props} isPointerInside />,
    );
    paintMomentFrame();
    const driftView = container.querySelector<HTMLElement>(".view--drift");

    expect(driftView?.dataset.auto).toBe("paused");
    act(() => vi.advanceTimersByTime(20_000));
    expect(onDismissMoment).not.toHaveBeenCalled();

    rerender(<CompanionPill {...props} isPointerInside={false} />);
    expect(driftView?.dataset.auto).toBe("running");
    act(() => vi.advanceTimersByTime(8_999));
    expect(onDismissMoment).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismissMoment).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(160));
    expect(onDismissMoment).toHaveBeenCalledTimes(1);
  });

  it("keeps all resident controls visible without a hover mode", () => {
    const { container } = renderPill();
    const pill = container.querySelector<HTMLElement>(".pill");

    fireEvent.mouseEnter(pill!, { screenX: 10, screenY: 10 });
    fireEvent.mouseMove(pill!, { screenX: 12, screenY: 10 });
    fireEvent.mouseLeave(pill!);

    expect(pill?.dataset.state).toBe("collapsed");
    expect(container.querySelector(".view--peek")).toBeNull();
    expect(container.querySelectorAll(".view--collapsed .icon-btn")).toHaveLength(2);
  });

  it("opens the native Companion menu without starting a window drag", async () => {
    const { getByRole, onOpenMenu } = renderPill();
    const menuButton = getByRole("button", { name: "Open Companion menu" });

    dispatchPointer(menuButton, "pointerdown", {
      button: 0,
      pointerId: 21,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.click(menuButton);
    await act(async () => undefined);

    expect(nativeBridge.dragNativeCompanion).not.toHaveBeenCalled();
    expect(onOpenMenu).toHaveBeenCalledOnce();
  });
});
