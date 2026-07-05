// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FirstDayPreparationScreen } from "./FirstDayPreparationScreen";

afterEach(() => {
  cleanup();
});

describe("FirstDayPreparationScreen", () => {
  it("shows an indeterminate state with no percent while importing", () => {
    render(<FirstDayPreparationScreen phase="importing" progress={null} />);

    expect(screen.getByText("Getting your day ready")).toBeTruthy();
    expect(screen.getByText("Working…")).toBeTruthy();

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar.className).toContain("first-day-prep__progress--indeterminate");
    expect(progressbar.getAttribute("aria-valuenow")).toBeNull();
  });

  it("renders a real percent and determinate bar while classifying", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={0.72} />);

    expect(screen.getByText("Making sense of your day")).toBeTruthy();
    expect(screen.getByText("72%")).toBeTruthy();

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar.className).not.toContain("first-day-prep__progress--indeterminate");
    expect(progressbar.getAttribute("aria-valuenow")).toBe("72");
  });

  it("clamps progress into the 0-100 range", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={1.4} />);

    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("leads the classifying copy with the user's onboarding work activity", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={0.4} workActivityLabel="Designing" />);

    expect(screen.getByText("Sorting your Designing time…")).toBeTruthy();
  });

  it("falls back to the generic classifying copy without a work activity", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={0.4} workActivityLabel={null} />);

    expect(screen.getByText("Reading through your day…")).toBeTruthy();
  });
});
