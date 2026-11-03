// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cyclePlaybackSpeed, firstScreenIndexIn, posterScreenIndex, readPlaybackSpeed, screenHoldSeconds } from "./screenPlayback";

const at = (seconds: number) => 1_000_000 + seconds * 1000;
const line = (start: number, end: number, totalSeconds: number) => ({ startMs: at(start), endMs: at(end), totalSeconds });

afterEach(() => window.localStorage.clear());

describe("screen replay timing", () => {
  it("holds each screen for the usual gap, so time spent in other apps plays as a cut", () => {
    // Screens every 10 seconds, then 20 minutes in an app that is not recorded.
    expect(screenHoldSeconds([at(0), at(10), at(20), at(1220), at(1230)])).toBe(10);
    expect(screenHoldSeconds([at(0), at(30), at(60)])).toBe(30);
    expect(screenHoldSeconds([at(0)])).toBe(10);
  });

  it("finds the first screen inside a stretch", () => {
    const times = [at(0), at(10), at(20), at(300), at(310)];
    expect(firstScreenIndexIn(times, at(5), at(25))).toBe(1);
    expect(firstScreenIndexIn(times, at(30), at(290))).toBe(-1);
    expect(firstScreenIndexIn(times, at(300), at(301))).toBe(3);
    expect(firstScreenIndexIn(times, at(400), at(500))).toBe(-1);
  });

  it("stands an activity for the longest Details line that has screens", () => {
    const times = [0, 10, 20, 30, 40, 50, 60, 70].map(at);
    // The longest line (900s) has no screens; the next longest holds screens 3-7.
    const lines = [line(0, 25, 300), line(25, 80, 600), line(100, 1000, 900)];
    expect(posterScreenIndex(times, lines)).toBe(5);
    expect(posterScreenIndex(times)).toBe(3);
    expect(posterScreenIndex(times, [line(500, 600, 60)])).toBe(3);
  });

  it("cycles 20x, 40x and 60x and remembers the choice", () => {
    expect(readPlaybackSpeed()).toBe(20);
    expect(cyclePlaybackSpeed(20)).toBe(40);
    expect(readPlaybackSpeed()).toBe(40);
    expect(cyclePlaybackSpeed(40)).toBe(60);
    expect(cyclePlaybackSpeed(60)).toBe(20);
    window.localStorage.setItem("drifty.screenReplaySpeed.v1", "33");
    expect(readPlaybackSpeed()).toBe(20);
  });
});
