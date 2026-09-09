import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Keeps a click-opened anchored popup mounted through its exit transition.
 *
 * Wrap the boundary around the conditional, not inside it:
 * `<AnchoredPresence>{open ? <Menu /> : null}</AnchoredPresence>`. A popup that
 * portals elsewhere must place this boundary inside its own portal, because the
 * pose is applied through a descendant selector.
 *
 * Hover-driven cards deliberately keep entry-only motion: a retained card would
 * sit under the pointer while it travels to the next target.
 */
export function AnchoredPresence({ children }: { readonly children: ReactNode }) {
  const present = children !== null && children !== undefined && children !== false;
  const retained = useRef<ReactNode>(null);
  const root = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(present);
  const [entered, setEntered] = useState(false);
  const [reduced, setReduced] = useState(() => typeof window !== "undefined"
    && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const visible = present || mounted;
  const exiting = !present;
  const phase = exiting ? "exiting" : entered || reduced ? "open" : "entering";

  useLayoutEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    if (present) retained.current = children;
  }, [children, present]);

  // A closing menu must leave the focus and accessibility trees at once, even
  // though its pixels are still fading. React's DOM types have no `inert` prop.
  useLayoutEffect(() => {
    if (root.current) root.current.inert = exiting;
  }, [exiting]);

  useLayoutEffect(() => {
    const settle = () => {
      setMounted(false);
      setEntered(false);
      retained.current = null;
    };
    if (!present) {
      // A popup dismissed before its first frame has no visible exit to retain.
      if (reduced || !entered) {
        settle();
        return;
      }
      const timer = window.setTimeout(settle, exitFallbackMs(root.current));
      return () => window.clearTimeout(timer);
    }
    setMounted(true);
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [present, reduced]);

  if (!visible || (!present && reduced)) return null;
  return (
    <div
      ref={root}
      data-anchored-presence={phase}
      onTransitionEnd={(event) => {
        const finished = event.target instanceof HTMLElement ? event.target : null;
        if (!exiting || event.propertyName !== "transform" || finished?.parentElement !== event.currentTarget) return;
        setMounted(false);
        setEntered(false);
        retained.current = null;
      }}
    >
      {present ? children : retained.current}
    </div>
  );
}

// CSS owns the timing; read it back rather than duplicating the number here.
function exitFallbackMs(root: HTMLElement | null): number {
  const panel = root?.firstElementChild;
  if (!panel) return 0;
  const style = window.getComputedStyle(panel);
  const milliseconds = (value: string) => value.trim().endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000;
  const durations = style.transitionDuration.split(",").map(milliseconds);
  const delays = style.transitionDelay.split(",").map(milliseconds);
  const longest = Math.max(0, ...durations
    .map((duration, index) => duration + (delays[index % delays.length] || 0))
    .filter(Number.isFinite));
  // jsdom has no stylesheet timing; browser zero-motion styles remove immediately.
  return style.transitionDuration ? longest + 80 : 220;
}
