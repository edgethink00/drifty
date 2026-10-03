import { useEffect, useRef, type RefObject } from "react";
import type { FirstDayDiscoveryItem, FirstDayVerdict } from "./firstDayPreparationStory";

/**
 * The first-day preparation motion (owner decision 2026-10-04): the day's largest apps and sites
 * circle the Drifty hourglass on a tilted ring, and each one spirals into the hourglass when its
 * classification arrives, which glows once in that verdict's colour. Nothing collects below the
 * title; the dashboard shows the split.
 */

/** Spiral-in time. A classified icon's face fades on the ring after this (CSS --land-delay). */
export const FIRST_DAY_LANDING_MS = 1300;
const MAX_FLIGHTS_PER_UPDATE = 6;
const FLIGHT_STAGGER_MS = 170;
const ORBIT_TURN_S = 15;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

type Point = { readonly x: number; readonly y: number };

const TAU = Math.PI * 2;

/**
 * Where a waiting icon is at time t (seconds): a tilted ring around the hourglass, large and in front
 * on the near side and small and behind on the far side. fraction is its share of the ring; seed
 * varies each icon's bob so the group never moves in lockstep.
 */
function place(t: number, fraction: number, seed: number, width: number, height: number) {
  const angle = TAU * (fraction + t / ORBIT_TURN_S);
  const rx = Math.min(width / 2 - 22, 168);
  const ry = Math.min(height / 2 - 18, 30);
  const depth = Math.sin(angle);
  const near = (depth + 1) / 2;
  return {
    x: width / 2 + rx * Math.cos(angle),
    y: height / 2 + ry * depth - Math.cos(angle) * 9 + Math.sin(t * 2.1 + seed) * 2.5,
    scale: 0.66 + near * 0.38,
    rotate: Math.sin(t * 0.9 + seed) * 7,
    opacity: 0.5 + near * 0.5,
    layer: depth > 0 ? 3 : 1,
  };
}

/** Moves the waiting icons every frame; spacing eases closed whenever one leaves. */
export function useTokenMotion(stageRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof requestAnimationFrame !== "function" || prefersReducedMotion()) return undefined;
    stage.dataset.live = "true";
    const eased = new WeakMap<Element, number>();
    const startedAt = performance.now();
    let last = startedAt;
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.06, (now - last) / 1000);
      last = now;
      const t = (now - startedAt) / 1000;
      const tokens = Array.from(stage.querySelectorAll<HTMLElement>("[data-token]")).filter((token) => !token.classList.contains("is-gone"));
      const waiting = tokens.filter((token) => token.dataset.verdict === "pending");
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      tokens.forEach((token, index) => {
        const slot = waiting.indexOf(token);
        const target = slot < 0 ? undefined : (slot + 0.5) / waiting.length;
        const previous = eased.get(token);
        let fraction = previous ?? target ?? index / Math.max(1, tokens.length);
        if (previous !== undefined && target !== undefined) {
          let delta = target - previous;
          delta -= Math.round(delta);
          fraction = previous + delta * Math.min(1, dt * 2.4);
        }
        eased.set(token, fraction);
        const p = place(t, fraction, Number(token.dataset.seed ?? index), width, height);
        token.style.transform = "translate(" + p.x.toFixed(1) + "px, " + p.y.toFixed(1) + "px) translate(-50%, -50%) scale(" + p.scale.toFixed(3) + ") rotate(" + p.rotate.toFixed(1) + "deg)";
        token.style.opacity = p.opacity.toFixed(3);
        token.style.zIndex = String(p.layer);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      delete stage.dataset.live;
    };
  }, [stageRef]);
}

const centerOf = (element: Element): Point => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};
const at = (point: Point, scale = 1, rotate = 0) => "translate(" + point.x + "px, " + point.y + "px) translate(-50%, -50%) scale(" + scale + ") rotate(" + rotate + "deg)";
const byKey = (root: Element, attribute: string, key: string) =>
  Array.from(root.querySelectorAll("[" + attribute + "]")).filter((element) => element.getAttribute(attribute) === key);

/** The icon spirals into the hourglass, which pulses and glows once in the verdict's colour. */
function launch(root: HTMLElement, token: HTMLElement, verdict: FirstDayVerdict) {
  if (typeof token.animate !== "function" || token.getClientRects().length === 0) return;
  const mark = root.querySelector(".first-day-prep__hourglass") ?? root.querySelector(".first-day-prep__mark");
  if (!mark) return;
  const start = centerOf(token);
  const center = centerOf(mark);
  token.classList.add("is-gone");

  const flight = document.createElement("div");
  flight.className = "first-day-prep__flight";
  flight.dataset.verdict = verdict;
  const face = token.querySelector(".first-day-prep__token-face");
  const icon = document.createElement("div");
  icon.className = "first-day-prep__flight-icon";
  if (face) icon.append(face.cloneNode(true));
  flight.append(icon);
  root.append(flight);

  const intake = Math.round(FIRST_DAY_LANDING_MS * 0.48);
  // Spiral in: the radius closes while the icon keeps turning with the ring.
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const from = Math.atan2(start.y - center.y, start.x - center.x);
  const frames: Keyframe[] = Array.from({ length: 9 }, (_, step) => {
    const s = step / 8;
    const angle = from + s * Math.PI * 1.1;
    const r = radius * (1 - s) * (1 - s * 0.15);
    return { transform: at({ x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r * 0.6 }, 1.08 - s * 0.82, s * 220), opacity: s < 0.86 ? 1 : 0, offset: s };
  });
  flight.animate(frames, { duration: intake, easing: "cubic-bezier(0.5, 0, 0.75, 0.4)", fill: "forwards" }).onfinish = () => flight.remove();
  (mark as HTMLElement).animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.16)", offset: 0.35 }, { transform: "scale(0.97)", offset: 0.7 }, { transform: "scale(1)" }],
    { duration: 460, delay: intake - 80, easing: "ease-out", composite: "add" } as KeyframeAnimationOptions,
  );
  const tint = root.querySelector<HTMLElement>(".first-day-prep__mark-tint");
  if (tint) {
    tint.dataset.verdict = verdict;
    tint.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0 }], { duration: 720, delay: intake - 60, easing: "ease-out" });
  }
}

/**
 * Sends every visible source whose classification just arrived into the hourglass. The first render
 * and a reduced-motion preference send none; the classified icon then simply fades on the ring.
 */
export function useVerdictFlights(rootRef: RefObject<HTMLElement | null>, items: readonly FirstDayDiscoveryItem[]) {
  const previousRef = useRef<Map<string, FirstDayVerdict> | null>(null);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = new Map(items.map((item) => [item.key, item.verdict]));
    const root = rootRef.current;
    if (!previous || !root || prefersReducedMotion()) return undefined;
    const landed = items.filter((item) => item.verdict !== "pending" && previous.get(item.key) === "pending").slice(0, MAX_FLIGHTS_PER_UPDATE);
    const timers = landed.map((item, index) => window.setTimeout(() => {
      const token = byKey(root, "data-find-key", item.key)[0] as HTMLElement | undefined;
      if (token && !token.classList.contains("is-gone")) launch(root, token, item.verdict);
    }, index * FLIGHT_STAGGER_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [items, rootRef]);
}

