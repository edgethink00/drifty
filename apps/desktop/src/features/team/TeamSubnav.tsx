import { useLayoutEffect, useRef, type PointerEvent, type ReactNode } from "react";

/**
 * The tabs under the team page's tabs: the boards on the Dashboard and the
 * sections of Settings, drawn alike (owner decision 2026-10-25, as Linear's
 * and Vercel's). The strip draws the open tab's fill once, under the tabs,
 * and slides it to the tab that opens; a softer fill follows the pointer.
 * The positions are custom properties on the strip, so the marks are plain CSS.
 */
export function TeamSubnavStrip({ className, role, ariaLabel, children }: {
  readonly className: string;
  readonly role: "group" | "tablist";
  readonly ariaLabel: string;
  readonly children: ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // The open tab may change, grow by a rename or move as the strip wraps: place its mark after every render and on resize.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const place = () => {
      const open = node.querySelector<HTMLElement>(":scope > .on");
      node.style.setProperty("--tab-mark-o", open ? "1" : "0");
      if (!open) return;
      node.style.setProperty("--tab-mark-x", String(open.offsetLeft) + "px");
      node.style.setProperty("--tab-mark-y", String(open.offsetTop) + "px");
      node.style.setProperty("--tab-mark-w", String(open.offsetWidth) + "px");
      node.style.setProperty("--tab-mark-h", String(open.offsetHeight) + "px");
    };
    place();
    // The first placement is not animated; moves after it slide.
    const ready = requestAnimationFrame(() => node.classList.add("is-ready"));
    if (typeof ResizeObserver === "undefined") return () => cancelAnimationFrame(ready);
    const observer = new ResizeObserver(place);
    observer.observe(node);
    return () => {
      cancelAnimationFrame(ready);
      observer.disconnect();
    };
  });
  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const node = ref.current;
    const tab = (event.target as HTMLElement).closest<HTMLElement>(".team-subnav__tab");
    if (!node || !tab || tab.parentElement !== node) return;
    node.style.setProperty("--tab-hover-x", String(tab.offsetLeft) + "px");
    node.style.setProperty("--tab-hover-y", String(tab.offsetTop) + "px");
    node.style.setProperty("--tab-hover-w", String(tab.offsetWidth) + "px");
    node.style.setProperty("--tab-hover-h", String(tab.offsetHeight) + "px");
    node.style.setProperty("--tab-hover-o", tab.classList.contains("on") ? "0" : "1");
  };
  const leave = () => ref.current?.style.setProperty("--tab-hover-o", "0");
  return (
    <div
      ref={ref}
      className={className + " is-sliding"}
      role={role}
      aria-label={ariaLabel}
      onPointerOver={follow}
      onPointerLeave={leave}
    >
      {children}
    </div>
  );
}

