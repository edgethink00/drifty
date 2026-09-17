// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LeaderboardSparkline } from "./LeaderboardSparkline";
import type { LeaderboardSparklinePoint } from "./leaderboardGraphStyle";

afterEach(() => {
  cleanup();
});

const week: LeaderboardSparklinePoint[] = [
  { day: "2026-09-14", focus: 3_200 },
  { day: "2026-09-15", focus: 2_800 },
  { day: "2026-09-16", focus: 4_100 },
  { day: "2026-09-17", focus: 3_500 },
  { day: "2026-09-18", focus: 4_800 },
  { day: "2026-09-19", focus: 3_000 },
  { day: "2026-09-20", focus: 3_600 },
];

describe("LeaderboardSparkline", () => {
  it("renders nothing with fewer than two points", () => {
    const { container } = render(
      <LeaderboardSparkline points={week.slice(0, 1)} variant="default" language="en" ariaLabel="week" />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders a filled area chart by default", () => {
    render(<LeaderboardSparkline points={week} variant="default" language="en" ariaLabel="Daily focus" />);
    expect(screen.getByRole("img", { name: "Daily focus" })).toBeTruthy();
    expect(document.querySelector("polygon")).toBeTruthy();
    expect(document.querySelector("polyline")).toBeTruthy();
  });

  it("omits fill for the line-only variant", () => {
    render(<LeaderboardSparkline points={week} variant="flat" language="en" ariaLabel="Daily focus" />);
    expect(document.querySelector("polygon")).toBeNull();
    expect(document.querySelector("polyline")).toBeTruthy();
  });

  it("labels Korean weekdays from the actual days", () => {
    const { container } = render(
      <LeaderboardSparkline points={week} variant="flat" language="ko" ariaLabel="집중" />,
    );
    expect([...container.querySelectorAll(".leaderboard-sparkline__axis span")].map((node) => node.textContent)).toEqual(
      ["월", "화", "수", "목", "금", "토", "일"],
    );
  });
});

