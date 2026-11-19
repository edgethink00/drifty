// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { milestoneCardState } from "./CompanionMilestoneCard";
import { CompanionPillMoment, type CompanionPillMilestoneEvent } from "./CompanionPillMoment";

afterEach(cleanup);

const breakCard: CompanionPillMilestoneEvent = {
  kind: "milestone",
  id: "focus-break-1",
  milestoneKind: "session",
  tier: 1,
  title: "Rest 5 minutes",
  subtitle: "Back at 2:17 AM",
  destination: null,
  frame: "card",
  tone: "rest",
  progress: { done: 1, total: 4 },
  choices: [{ id: "focusSkipBreak", label: "Skip break" }],
  generatedAt: new Date().toISOString(),
};

describe("focus session cards", () => {
  it("offers a break card's Skip break with its round dots", () => {
    const onMilestoneChoice = vi.fn();
    render(<CompanionPillMoment event={breakCard} onDismiss={vi.fn()} onOpenDashboard={vi.fn()} onMilestoneChoice={onMilestoneChoice} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip break" }));
    expect(onMilestoneChoice).toHaveBeenCalledWith("focusSkipBreak");
    expect(document.querySelectorAll(".mcard__dots i[data-on]")).toHaveLength(1);
  });

  it("draws the next round as the same card without a choice, and both stay 6 seconds", () => {
    const roundCard: CompanionPillMilestoneEvent = { ...breakCard, id: "focus-round-1", tone: null, choices: null, progress: { done: 2, total: 4 } };
    expect(milestoneCardState(breakCard)).toBe("breakCard");
    expect(milestoneCardState(roundCard)).toBe("noteCard");
    const { container } = render(<CompanionPillMoment event={roundCard} onDismiss={vi.fn()} onOpenDashboard={vi.fn()} />);
    const card = container.querySelector<HTMLElement>(".view--mcard");
    expect(card?.dataset.tone).toBeUndefined();
    expect(card?.style.getPropertyValue("--auto-duration")).toBe("6000ms");
    expect(card?.querySelector(".mcard__button")).toBeNull();
    expect(card?.querySelector(".card__close-ring")).not.toBeNull();
  });

  it("pauses a card's countdown while the pointer is on it", () => {
    const { container } = render(<CompanionPillMoment event={breakCard} onDismiss={vi.fn()} onOpenDashboard={vi.fn()} />);
    const card = container.querySelector<HTMLElement>(".view--mcard")!;
    expect(card.dataset.tone).toBe("rest");
    expect(card.dataset.auto).toBe("running");
    fireEvent.pointerEnter(card);
    expect(card.dataset.auto).toBe("paused");
  });

  it("draws the session's end as the same card, with its focus time and a way to today", () => {
    const end: CompanionPillMilestoneEvent = { ...breakCard, id: "focus-done-2", tone: null, progress: null, choices: null, destination: "dashboard", statSeconds: 100 * 60 };
    expect(milestoneCardState(end)).toBe("breakCard");
    const onOpenDestination = vi.fn();
    const { container } = render(<LocalizationTestProvider language="ko"><CompanionPillMoment event={end} onDismiss={vi.fn()} onOpenDashboard={vi.fn()} onOpenDestination={onOpenDestination} /></LocalizationTestProvider>);
    expect(container.querySelector(".view--mcard .mcard__stat")?.textContent).toBe("1시간 40분");
    fireEvent.click(container.querySelector<HTMLButtonElement>(".view--mcard .mcard__button")!);
    expect(onOpenDestination).toHaveBeenCalledWith("dashboard");
  });

  it("writes a session summary's figure the way the app writes durations", () => {
    const summary: CompanionPillMilestoneEvent = { ...breakCard, id: "focus-done-1", frame: null, progress: null, choices: null, destination: "dashboard", statSeconds: 56 * 60 };
    render(<LocalizationTestProvider language="ko"><CompanionPillMoment event={summary} onDismiss={vi.fn()} onOpenDashboard={vi.fn()} onOpenDestination={vi.fn()} /></LocalizationTestProvider>);
    expect(document.querySelector(".mile__stat")?.textContent).toBe("56분");
  });
});
