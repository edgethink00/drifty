import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

/**
 * How the Breakdown panel's bottom-bar delete asks before it deletes. The note in
 * the bar is the product default (owner decision 2026-11-01, docs/product-decisions.md);
 * the other candidates stay selectable in Dev settings › Previews.
 */
export type ActivityDeleteStyle = "note" | "banner" | "steady" | "popover" | "panel" | "hold" | "undo" | "timer";

export type ActivityDeleteStyleOption = {
  readonly id: ActivityDeleteStyle;
  readonly label: string;
  readonly detail: string;
};

export const ACTIVITY_DELETE_STYLE_KEY = "drifty.dev.activityDeleteStyle";
export const DEFAULT_ACTIVITY_DELETE_STYLE: ActivityDeleteStyle = "note";
/** How long Delete must be held in the press-and-hold candidate. */
export const ACTIVITY_DELETE_HOLD_MS = 800;

export const ACTIVITY_DELETE_STYLE_OPTIONS: readonly ActivityDeleteStyleOption[] = [
  { id: "note", label: "A · Note in the bar (decided 2026-11-01)", detail: "Delete keeps its label, width and place; the bar's empty left side says it can't be undone, with Cancel beside Delete" },
  { id: "banner", label: "B · Warning bar", detail: "The whole bar turns into a soft warning strip with the sentence, Cancel and Delete" },
  { id: "steady", label: "C · Same button, no timer", detail: "Delete fills in place with the same label and width; leaving the bar, Escape or a click elsewhere cancels" },
  { id: "popover", label: "D · Small card above Delete", detail: "A small card above Delete asks, with Cancel and Delete" },
  { id: "panel", label: "E · Question in the panel", detail: "The panel body asks with Cancel and Delete, as the floating card does, under the activity's header" },
  { id: "hold", label: "F · Press and hold", detail: "Holding Delete fills it and deletes; a short press says to hold" },
  { id: "undo", label: "G · Delete, then Undo", detail: "One press hides the activity; a notice offers Undo, and the records are deleted when it closes" },
  { id: "timer", label: "H · Second press within 3 s (previous)", detail: "Delete turns into Confirm with a draining line for three seconds" },
];

export function isActivityDeleteStyle(value: unknown): value is ActivityDeleteStyle {
  return ACTIVITY_DELETE_STYLE_OPTIONS.some((option) => option.id === value);
}

const listeners = new Set<() => void>();
/** Used only when storage is unavailable, so a choice still applies until reload. */
let fallbackChoice: ActivityDeleteStyle | null = null;

export function readActivityDeleteStyle(): ActivityDeleteStyle {
  if (typeof window === "undefined") return DEFAULT_ACTIVITY_DELETE_STYLE;
  try {
    const stored = window.localStorage.getItem(ACTIVITY_DELETE_STYLE_KEY);
    return isActivityDeleteStyle(stored) ? stored : DEFAULT_ACTIVITY_DELETE_STYLE;
  } catch {
    return fallbackChoice ?? DEFAULT_ACTIVITY_DELETE_STYLE;
  }
}

/** Stores a Dev choice; the default is stored as nothing. */
export function writeActivityDeleteStyle(value: ActivityDeleteStyle): void {
  try {
    if (value === DEFAULT_ACTIVITY_DELETE_STYLE) window.localStorage.removeItem(ACTIVITY_DELETE_STYLE_KEY);
    else window.localStorage.setItem(ACTIVITY_DELETE_STYLE_KEY, value);
  } catch {
    fallbackChoice = value;
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The stored Dev choice, kept in step between Dev settings and the dashboard. */
export function useStoredActivityDeleteStyle(): ActivityDeleteStyle {
  return useSyncExternalStore(subscribe, readActivityDeleteStyle, () => DEFAULT_ACTIVITY_DELETE_STYLE);
}

/**
 * Development servers accept a deleteStyle=<id> query so a review link can open
 * one candidate directly. Release builds ignore it.
 */
export function resolveActivityDeleteStyleReviewOverride(
  search: string,
  enabled = import.meta.env.DEV,
): ActivityDeleteStyle | null {
  if (!enabled) return null;
  const value = new URLSearchParams(search).get("deleteStyle");
  return isActivityDeleteStyle(value) ? value : null;
}

/** What the development review page posts to the framed app to switch candidates. */
export const ACTIVITY_DELETE_STYLE_REVIEW_MESSAGE = "drifty-review:delete-style";
/** What the framed app posts back once it listens, so the page can send its current choice. */
export const ACTIVITY_DELETE_STYLE_REVIEW_READY = "drifty-review:delete-style-ready";

/**
 * The review link's candidate, which the development review page can switch
 * without reloading the framed app, so the open activity stays put. Only the
 * framing page is heard, and release builds neither read the link nor listen.
 */
export function useActivityDeleteStyleReviewOverride(
  enabled = import.meta.env.DEV,
  reviewParent: Window | null = typeof window === "undefined" ? null : window.parent,
): ActivityDeleteStyle | null {
  const [override, setOverride] = useState<ActivityDeleteStyle | null>(() => (
    typeof window === "undefined" ? null : resolveActivityDeleteStyleReviewOverride(window.location.search, enabled)
  ));
  useEffect(() => {
    if (!enabled || !reviewParent || reviewParent === window) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== reviewParent) return;
      const data: unknown = event.data;
      if (!data || typeof data !== "object") return;
      const { type, style } = data as { readonly type?: unknown; readonly style?: unknown };
      if (type === ACTIVITY_DELETE_STYLE_REVIEW_MESSAGE && isActivityDeleteStyle(style)) setOverride(style);
    };
    window.addEventListener("message", onMessage);
    reviewParent.postMessage({ type: ACTIVITY_DELETE_STYLE_REVIEW_READY }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, reviewParent]);
  return override;
}

/** A stored candidate applies only while Dev mode is on; a review link always applies. */
export function resolveActivityDeleteStyle(input: {
  readonly devModeActive: boolean;
  readonly stored: ActivityDeleteStyle;
  readonly reviewOverride: ActivityDeleteStyle | null;
}): ActivityDeleteStyle {
  if (input.reviewOverride) return input.reviewOverride;
  return input.devModeActive ? input.stored : DEFAULT_ACTIVITY_DELETE_STYLE;
}

export const ActivityDeleteStyleContext = createContext<ActivityDeleteStyle>(DEFAULT_ACTIVITY_DELETE_STYLE);

export function useActivityDeleteStyle(): ActivityDeleteStyle {
  return useContext(ActivityDeleteStyleContext);
}
