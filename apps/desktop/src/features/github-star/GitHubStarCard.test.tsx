// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubStarCard } from "./GitHubStarCard";
import type { GitHubStarAvailability } from "./githubStar";

const viaGh: GitHubStarAvailability = { public: true, stars: 10, star: "not_starred" };
const usage = { trackedSeconds: 186 * 3600 };

describe("GitHubStarCard", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("titles the ask with the hours this person tracked", () => {
    render(<GitHubStarCard availability={viaGh} usage={usage} onStar={vi.fn()} onLater={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("You've tracked 186 hours with Drifty")).toBeTruthy();
    expect(screen.getByText("— Max, who makes Drifty")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Star on GitHub" })).toBeTruthy();
  });

  it("offers Open GitHub when gh cannot star", () => {
    render(<GitHubStarCard availability={{ ...viaGh, star: "unavailable" }} usage={usage} onStar={vi.fn()} onLater={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open GitHub" })).toBeTruthy();
  });

  it("Later answers the ask", () => {
    const onLater = vi.fn();
    render(<GitHubStarCard availability={viaGh} usage={usage} onStar={vi.fn()} onLater={onLater} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it("thanks after a star through gh, then leaves", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<GitHubStarCard availability={viaGh} usage={usage} onStar={() => Promise.resolve(true)} onLater={vi.fn()} onClose={onClose} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Star on GitHub" })); });
    expect(screen.getByText("Thanks for the star!")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves at once when GitHub opened in the browser instead", async () => {
    const onClose = vi.fn();
    render(<GitHubStarCard availability={{ ...viaGh, star: "unavailable" }} usage={usage} onStar={() => Promise.resolve(false)} onLater={vi.fn()} onClose={onClose} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open GitHub" })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

