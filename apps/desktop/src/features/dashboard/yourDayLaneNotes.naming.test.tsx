// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LaneNotes, type LaneInteract, type LaneItem } from "./yourDayLaneNotes";
import type { WeekCalendarEvent } from "./weekCalendar";

afterEach(cleanup);

function item(id: string, from: number, to: number, pending = false): LaneItem {
  return {
    event: { id, durationMinutes: to - from, activeDurationMinutes: to - from, identities: [] } as unknown as WeekCalendarEvent,
    top: from, bottom: to, drawnTop: from, drawnBottom: to, title: id, description: null, named: !pending, origin: undefined,
    tone: "#000", timeLabel: "", clockRange: "", hoverTitle: id, openMinute: from, pending,
  };
}
const interact: LaneInteract = () => ({ onClick: () => {}, onMouseEnter: () => {}, onMouseLeave: () => {}, onFocus: () => {}, onBlur: () => {}, "data-flow-highlighted": false });
const ITEMS = [item("Named work", 540, 600), item("Visual Studio Code", 600, 640, true), item("youtube.com", 640, 700, true)];
const NAMING = { chip: "생성 중", note: "이 시간이 끝나면 곧 AI 이름이 붙어요" };
const draw = (naming?: typeof NAMING) => render(
  <LaneNotes items={ITEMS} interact={interact} duration={(minutes) => minutes + "분"} icon={() => null} height={1440} naming={naming} />,
);

describe("Your Day cards whose name is on its way", () => {
  it("marks every card of the open window with a chip and says why on hover, and leaves named cards as they are", () => {
    draw(NAMING);
    expect(screen.getAllByText("생성 중")).toHaveLength(2);
    const open = screen.getByRole("button", { name: /youtube\.com/ });
    expect(open.textContent).toBe("youtube.com생성 중60분");
    expect(open.getAttribute("title")).toBe(NAMING.note);
    const named = screen.getByRole("button", { name: /Named work/ });
    expect(named.textContent).not.toContain("생성 중");
    expect(named.getAttribute("title")).toBeNull();
  });

  it("shows no chip when names are not being made", () => {
    draw();
    expect(screen.queryByText("생성 중")).toBeNull();
    expect(screen.getByRole("button", { name: /youtube\.com/ }).getAttribute("title")).toBeNull();
  });
});
