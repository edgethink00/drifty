import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type RailTooltip = {
  readonly label: string;
  readonly left: number;
  readonly top: number;
};

const TOOLTIP_GAP_PX = 8;

function railItemFrom(target: EventTarget | null, rail: Element): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const item = target.closest<HTMLElement>(".nav-item");
  return item && rail.contains(item) ? item : null;
}

function tooltipFor(item: HTMLElement): RailTooltip | null {
  const label = item.querySelector(".nav-item__hover-label")?.textContent?.trim();
  if (!label) return null;
  const rect = item.getBoundingClientRect();
  return {
    label,
    left: Math.round(rect.right + TOOLTIP_GAP_PX),
    top: Math.round(rect.top + rect.height / 2),
  };
}

function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * Names the collapsed rail's icons on hover and keyboard focus. The rail clips
 * its overflow so focus can never scroll the avatar out of view, and that clip
 * also hid the in-button label, so the name is drawn in a body-level layer
 * beside the chip. Render it inside the sidebar; it watches its parent.
 */
export function CollapsedRailTooltip({ active }: { readonly active: boolean }) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const [tooltip, setTooltip] = useState<RailTooltip | null>(null);

  useEffect(() => {
    const rail = markerRef.current?.parentElement;
    setTooltip(null);
    if (!active || !rail) return undefined;

    const hide = () => setTooltip(null);
    const onPointerOver = (event: PointerEvent) => {
      const item = railItemFrom(event.target, rail);
      if (item) setTooltip(tooltipFor(item));
    };
    const onPointerOut = (event: PointerEvent) => {
      const item = railItemFrom(event.target, rail);
      if (item && !(event.relatedTarget instanceof Node && item.contains(event.relatedTarget))) hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const item = railItemFrom(event.target, rail);
      setTooltip(item && isFocusVisible(item) ? tooltipFor(item) : null);
    };

    rail.addEventListener("pointerover", onPointerOver);
    rail.addEventListener("pointerout", onPointerOut);
    rail.addEventListener("focusin", onFocusIn);
    rail.addEventListener("focusout", hide);
    rail.addEventListener("click", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      rail.removeEventListener("pointerover", onPointerOver);
      rail.removeEventListener("pointerout", onPointerOut);
      rail.removeEventListener("focusin", onFocusIn);
      rail.removeEventListener("focusout", hide);
      rail.removeEventListener("click", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [active]);

  return (
    <>
      <span ref={markerRef} hidden />
      {active && tooltip
        ? createPortal(
            <span
              className="nav-item__hover-label rail-tooltip"
              aria-hidden="true"
              style={{ left: tooltip.left, top: tooltip.top }}
            >
              {tooltip.label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

