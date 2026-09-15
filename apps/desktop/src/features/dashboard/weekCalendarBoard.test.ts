// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { handleWeekCalendarBoardWheel } from "./weekCalendarBoard";

describe("handleWeekCalendarBoardWheel", () => {
  it("forwards vertical wheel from the weekday labels into the timeline scroller", () => {
    const board = document.createElement("div");
    const scroller = document.createElement("div");
    const head = document.createElement("div");
    board.append(head, scroller);
    scroller.scrollTop = 10;

    handleWeekCalendarBoardWheel({ deltaX: 0, deltaY: 40, target: head }, board, scroller);

    expect(scroller.scrollTop).toBe(50);
    expect(board.scrollLeft).toBe(0);
  });

  it("forwards horizontal wheel from the timeline into the shared board", () => {
    const board = document.createElement("div");
    const scroller = document.createElement("div");
    const event = document.createElement("div");
    board.append(scroller);
    scroller.append(event);
    board.scrollLeft = 8;
    Object.defineProperty(board, "scrollWidth", { configurable: true, value: 400 });
    Object.defineProperty(board, "clientWidth", { configurable: true, value: 200 });

    handleWeekCalendarBoardWheel({ deltaX: 24, deltaY: 16, target: event }, board, scroller);

    expect(board.scrollLeft).toBe(32);
    expect(scroller.scrollTop).toBe(0);
  });

  it("does not pan the board horizontally when the week grid already fits", () => {
    const board = document.createElement("div");
    const scroller = document.createElement("div");
    const event = document.createElement("div");
    board.append(scroller);
    scroller.append(event);
    board.scrollLeft = 0;
    Object.defineProperty(board, "scrollWidth", { configurable: true, value: 200 });
    Object.defineProperty(board, "clientWidth", { configurable: true, value: 200 });

    handleWeekCalendarBoardWheel({ deltaX: 40, deltaY: 0, target: event }, board, scroller);

    expect(board.scrollLeft).toBe(0);
  });
});
