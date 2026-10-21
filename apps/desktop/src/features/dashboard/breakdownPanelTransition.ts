import { useEffect, type RefObject } from "react";

/**
 * Motion for the Breakdown side column as it changes between its summary and an activity. The
 * column swaps its content in one commit (CSS hides the summary while the slot shows the
 * activity), so the motion works from a copy: just before a click or key that may change the
 * column, the column is copied; when React has changed it, before it is painted, the copy leaves
 * and the new content arrives, crossfading in place while it settles from a slight scale, never
 * a slide, within about a quarter of a second. Nothing in the column's own
 * rendering changes, the copy takes no input, and every change still completes at once under
 * reduced motion or without the Web Animations API.
 */

type Change = "open" | "back" | "swap";
/** "between": an activity has left its slot but the summary is not shown yet (two commits apart). */
type PanelKey = Element | "summary" | "between";

type Snapshot = {
  readonly ghost: HTMLElement;
  readonly scrollTop: number;
  readonly key: PanelKey;
  /** The column's size as it was shown: it can change with its content (an open activity's footer). */
  readonly width: number;
  readonly height: number;
};

type Running = { readonly finish: () => void };

/** What opens or switches an activity: a Day card, a Week block or a flow chart cell. */
const SOURCE_SELECTOR = ".your-day-anchored-card, .week-v2-calendar__event, .flow-cell";
// --ease-out-quart, the app's arrival curve.
const EASE_OUT = "cubic-bezier(0.25, 1, 0.5, 1)";

function slotOf(content: HTMLElement): HTMLElement | null {
  return content.querySelector<HTMLElement>(":scope > .activity-detail-slot");
}

function panelKey(content: HTMLElement): PanelKey {
  if (content.dataset.detailActive !== "true") return "summary";
  return slotOf(content)?.firstElementChild ?? "between";
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isBlock(event: Event, aside: HTMLElement): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || aside.contains(target)) return false;
  if (target.closest(SOURCE_SELECTOR)) return true;
  if (event instanceof MouseEvent && typeof document.elementsFromPoint === "function") {
    return document.elementsFromPoint(event.clientX, event.clientY).some((element) => element.matches(SOURCE_SELECTOR) && !aside.contains(element));
  }
  return false;
}

/** Lays the copy under the column, below its head (which both states share and which stays put). */
function mountGhost(aside: HTMLElement, content: HTMLElement, snapshot: Snapshot): HTMLElement {
  const head = content.querySelector<HTMLElement>(":scope > .week-v2-side__head");
  const headBottom = head ? Math.max(0, head.offsetTop + head.offsetHeight - content.scrollTop) : 0;
  const stage = document.createElement("div");
  stage.className = "week-v2-side__motion-stage";
  stage.setAttribute("aria-hidden", "true");
  stage.setAttribute("inert", "");
  Object.assign(stage.style, {
    position: "absolute", left: content.offsetLeft + "px", top: content.offsetTop + headBottom + "px",
    width: snapshot.width + "px", height: Math.max(0, snapshot.height - headBottom) + "px",
    overflow: "hidden", pointerEvents: "none", zIndex: "0",
  });
  const ghost = snapshot.ghost;
  ghost.removeAttribute("id");
  for (const element of Array.from(ghost.querySelectorAll("[id]"))) element.removeAttribute("id");
  ghost.classList.add("week-v2-side__ghost");
  Object.assign(ghost.style, {
    // Laid out at the size it was shown at, so a footer pinned to the bottom stays where it was.
    position: "absolute", left: "0", top: -headBottom + "px", width: snapshot.width + "px", height: snapshot.height + "px",
    margin: "0", opacity: "1", visibility: "visible", transition: "none", overflowY: "hidden", transformOrigin: "50% 0",
  });
  const ghostHead = ghost.querySelector<HTMLElement>(":scope > .week-v2-side__head");
  if (ghostHead && head) {
    // The real head stays in view; the copy keeps only its height, so it holds no second control.
    const spacer = document.createElement("div");
    const margins = getComputedStyle(head);
    Object.assign(spacer.style, { height: head.offsetHeight + "px", marginTop: margins.marginTop, marginBottom: margins.marginBottom });
    // An open activity hides everything in the column but its head and slot; the spacer stays.
    spacer.style.setProperty("display", "block", "important");
    ghostHead.replaceWith(spacer);
  }
  stage.append(ghost);
  aside.append(stage);
  ghost.scrollTop = snapshot.scrollTop;
  return stage;
}

/** The arriving content: the activity, or the summary's cards on the way back. */
function arriving(change: Change, content: HTMLElement): HTMLElement[] {
  if (change === "back") {
    return Array.from(content.children).filter((element): element is HTMLElement => element instanceof HTMLElement && !element.matches(".week-v2-side__head, .activity-detail-slot"));
  }
  const root = slotOf(content)?.firstElementChild;
  return root instanceof HTMLElement ? [root] : [];
}

function play(change: Change, snapshot: Snapshot, aside: HTMLElement, content: HTMLElement): Running {
  const animations: Animation[] = [];
  const cleanups: (() => void)[] = [];
  const run = (element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    animations.push(element.animate(keyframes, options));
  };
  const keep = (element: HTMLElement, styles: Record<string, string>) => {
    const previous = element.getAttribute("style");
    for (const [name, value] of Object.entries(styles)) element.style.setProperty(name, value);
    cleanups.push(() => { if (!previous) element.removeAttribute("style"); else element.setAttribute("style", previous); });
  };
  // The head (and its » / ‹) changes in place with no motion: fading the chevron in from nothing
  // made it flash on every open and back.
  // A crossfade on complementary curves (their opacities always add up to one), so the column
  // never shows less than either side: fading out before fading in left it half empty for a
  // moment, which read as a blink. The arriving content settles from the anchored popovers'
  // 0.985 without their drop.
  const fade = 150;
  keep(aside, { position: "relative" });
  keep(content, { position: "relative", "z-index": "1" });
  const stage = mountGhost(aside, content, snapshot);
  cleanups.push(() => stage.remove());
  if (stage.firstElementChild) run(stage.firstElementChild, [{ opacity: 1 }, { opacity: 0 }], { duration: fade, easing: "linear", fill: "forwards" });
  for (const element of arriving(change, content)) {
    keep(element, { "transform-origin": "50% 0" });
    run(element, [{ opacity: 0 }, { opacity: 1 }], { duration: fade, easing: "linear" });
    run(element, [{ transform: "scale(0.985)" }, { transform: "none" }], { duration: 240, easing: EASE_OUT });
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    for (const animation of animations) animation.cancel();
    for (const cleanup of cleanups.reverse()) cleanup();
  };
  Promise.all(animations.map((animation) => animation.finished)).then(finish, () => {});
  return { finish };
}

/** Plays the column's change while enabled (the side panel shows activities). */
export function useBreakdownPanelTransition(
  asideRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    let running: Running | null = null;
    let watcher: { readonly observer: MutationObserver; readonly timer: number; readonly at: number } | null = null;
    const stopWatching = () => {
      if (!watcher) return;
      watcher.observer.disconnect();
      window.clearTimeout(watcher.timer);
      watcher = null;
    };
    // The change can land a few frames after the input (a Day card opens through its chart cell),
    // so the column is watched until it changes. A mutation callback runs before that change is
    // painted, so the copy is in place on the first frame that shows it.
    const watch = (snapshot: Snapshot, content: HTMLElement) => {
      const observer = new MutationObserver(() => {
        const aside = asideRef.current, current = contentRef.current;
        if (!aside || !current) { stopWatching(); return; }
        const key = panelKey(current);
        // Wait for the column to settle: the copy and the arriving parts are measured as shown.
        if (key === snapshot.key || key === "between") return;
        stopWatching();
        const change: Change = snapshot.key === "summary" ? "open" : key === "summary" ? "back" : "swap";
        running = play(change, snapshot, aside, current);
      });
      observer.observe(content, { attributes: true, attributeFilter: ["data-detail-active"] });
      const slot = slotOf(content);
      if (slot) observer.observe(slot, { childList: true });
      watcher = { observer, timer: window.setTimeout(stopWatching, 800), at: performance.now() };
    };
    const capture = (event: Event) => {
      const aside = asideRef.current, content = contentRef.current;
      if (!aside || !content || typeof content.animate !== "function" || prefersReducedMotion()) return;
      if (event instanceof KeyboardEvent && !["Enter", " ", "Escape"].includes(event.key)) return;
      if (getComputedStyle(content).visibility === "hidden") return;
      const target = event.target instanceof Element ? event.target : null;
      const inPanel = Boolean(target && aside.contains(target));
      const escape = event instanceof KeyboardEvent && event.key === "Escape";
      // Only a block opens or switches an activity; the panel itself and Escape take it back.
      if (!inPanel && !escape && !isBlock(event, aside)) return;
      // A Day card passes its click on to its chart cell; the first input already holds the copy.
      if (watcher && performance.now() - watcher.at < 150) return;
      stopWatching();
      running?.finish();
      running = null;
      watch({
        ghost: content.cloneNode(true) as HTMLElement,
        scrollTop: content.scrollTop,
        key: panelKey(content),
        width: content.offsetWidth,
        height: content.offsetHeight,
      }, content);
    };
    document.addEventListener("click", capture, true);
    document.addEventListener("keydown", capture, true);
    return () => {
      document.removeEventListener("click", capture, true);
      document.removeEventListener("keydown", capture, true);
      stopWatching();
      running?.finish();
    };
  }, [asideRef, contentRef, enabled]);
}
