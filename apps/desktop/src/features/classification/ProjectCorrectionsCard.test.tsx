// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiReviewEvent } from "@drifty/domain";
import { ProjectCorrectionsCard } from "./ProjectCorrectionsCard";

function event(fields: Partial<AiReviewEvent> & { id: number }): AiReviewEvent {
  return {
    segmentId: "1",
    passId: 1,
    prevCategory: "entertainment",
    prevProductivity: "drift",
    newCategory: "social_media",
    newProductivity: "focus",
    reason: "Part of an SNS work session",
    createdAt: "2026-04-06T09:00:00+00:00",
    ...fields,
  };
}

describe("ProjectCorrectionsCard", () => {
  it("summarizes active corrections and reverts on click", () => {
    const onRevert = vi.fn();
    render(<ProjectCorrectionsCard events={[event({ id: 7 })]} onRevert={onRevert} />);
    expect(screen.getByText(/corrected 1 classification\b/i)).toBeTruthy();
    expect(screen.getByText(/Part of an SNS work session/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /revert/i }));
    expect(onRevert).toHaveBeenCalledWith(7);
  });

  it("renders nothing when every correction is reverted", () => {
    const { container } = render(<ProjectCorrectionsCard events={[event({ id: 1, revertedAt: "2026-04-06T10:00:00+00:00" })]} onRevert={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing with no events", () => {
    const { container } = render(<ProjectCorrectionsCard events={[]} onRevert={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
