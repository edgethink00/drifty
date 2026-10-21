// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CollapsedRailTooltip } from "./CollapsedRailTooltip";

function Rail({ active }: { readonly active: boolean }) {
  return (
    <aside className={active ? "sidebar sidebar--collapsed" : "sidebar"} data-testid="rail">
      <button type="button" className="nav-item">
        <svg aria-hidden="true" />
        <span>Insights</span>
        <span className="nav-item__hover-label" aria-hidden="true">Insights</span>
      </button>
      <button type="button" className="nav-item">
        <svg aria-hidden="true" />
        <span>History</span>
        <span className="nav-item__hover-label" aria-hidden="true">History</span>
      </button>
      <CollapsedRailTooltip active={active} />
    </aside>
  );
}

function bodyTooltip(): HTMLElement | null {
  return document.body.querySelector(":scope > .rail-tooltip");
}

// jsdom has no PointerEvent, so send the pointer events as MouseEvents, which
// carry relatedTarget the way a browser does.
function pointer(type: "pointerover" | "pointerout", target: Element, relatedTarget: Element | null = null) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget }));
  });
}

function click(target: Element) {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => cleanup());

describe("CollapsedRailTooltip", () => {
  it("names the hovered rail item in a body-level layer outside the clipped rail", () => {
    const { getByText, getByTestId } = render(<Rail active />);
    const item = getByText("History", { selector: "span:not(.nav-item__hover-label)" }).closest("button")!;
    item.getBoundingClientRect = () => ({ left: 9, right: 45, top: 200, bottom: 236, width: 36, height: 36, x: 9, y: 200, toJSON: () => ({}) });

    pointer("pointerover", item);

    const tooltip = bodyTooltip();
    expect(tooltip?.textContent).toBe("History");
    expect(getByTestId("rail").contains(tooltip)).toBe(false);
    expect(tooltip?.style.left).toBe("53px");
    expect(tooltip?.style.top).toBe("218px");

    pointer("pointerout", item, document.body);
    expect(bodyTooltip()).toBeNull();
  });

  it("moves to the next item and stays put while the pointer crosses the item's own icon", () => {
    const { getByText } = render(<Rail active />);
    const first = getByText("Insights", { selector: "span:not(.nav-item__hover-label)" }).closest("button")!;
    const second = getByText("History", { selector: "span:not(.nav-item__hover-label)" }).closest("button")!;

    pointer("pointerover", first);
    pointer("pointerout", first, first.querySelector("svg"));
    expect(bodyTooltip()?.textContent).toBe("Insights");

    pointer("pointerover", second);
    expect(bodyTooltip()?.textContent).toBe("History");
  });

  it("stays quiet while the rail is expanded and clears when the rail opens", () => {
    const { getByText, rerender } = render(<Rail active />);
    const item = getByText("Insights", { selector: "span:not(.nav-item__hover-label)" }).closest("button")!;
    pointer("pointerover", item);
    expect(bodyTooltip()).not.toBeNull();

    act(() => rerender(<Rail active={false} />));
    expect(bodyTooltip()).toBeNull();

    pointer("pointerover", item);
    expect(bodyTooltip()).toBeNull();
  });

  it("hides when an item is clicked", () => {
    const { getByText } = render(<Rail active />);
    const item = getByText("Insights", { selector: "span:not(.nav-item__hover-label)" }).closest("button")!;
    pointer("pointerover", item);
    click(item);
    expect(bodyTooltip()).toBeNull();
  });
});

