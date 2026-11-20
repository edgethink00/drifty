// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityCardDetailRun } from "@drifty/domain";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ActivityDetailLog, ActivityLogMeta } from "./ActivityDetailLog";

afterEach(cleanup);

const start = Date.parse("2026-11-20T14:17:00");
const run = (label: string, offset: number, totalSeconds: number): ActivityCardDetailRun => ({
  label, kind: "app", seconds: totalSeconds, totalSeconds, startMs: start + offset * 1000, endMs: start + (offset + totalSeconds) * 1000, segmentIds: [label],
});

describe("activity panel durations under a minute", () => {
  it("reads a sub-minute block's recorded time in seconds", () => {
    render(<LocalizationTestProvider language="ko"><ActivityLogMeta startMs={start} endMs={start + 60_000} recordedSeconds={25} identities={[]} appIcons={{}} /></LocalizationTestProvider>);
    expect(screen.getByText("기록 25초")).toBeTruthy();
  });

  it("gives a sub-minute block's lines in seconds so they add up to it", () => {
    const { container } = render(<LocalizationTestProvider language="en"><ActivityDetailLog runs={[run("a.com", 0, 20), run("b.com", 20, 10)]} /></LocalizationTestProvider>);
    expect([...container.querySelectorAll("strong")].map((cell) => cell.textContent)).toEqual(["20s", "10s"]);
  });

  it("keeps whole minutes once the block reaches a minute", () => {
    const { container } = render(<LocalizationTestProvider language="en"><ActivityDetailLog runs={[run("a.com", 0, 100), run("b.com", 100, 30)]} /></LocalizationTestProvider>);
    expect([...container.querySelectorAll("strong")].map((cell) => cell.textContent)).toEqual(["2m", "1m"]);
  });
});

