import { useEffect, useSyncExternalStore } from "react";

/**
 * The Drifty window's size (feedback 51, 2026-10-25). The whole page scales
 * like browser zoom, so every screen keeps its proportions. The main window's
 * minimum size grows with it, and a step is offered only when the screen can
 * still give the page at least 960 x 600 of room at that size; below that the
 * dashboard and sidebar get cramped. The pet and companion windows keep their
 * size.
 */
export const ZOOM_LEVELS = [1, 1.1, 1.2, 1.3] as const;

export const UI_ZOOM_STORAGE_KEY = "drifty.uiZoom.v1";
const BASE_MIN_WIDTH = 960;
const BASE_MIN_HEIGHT = 680;
/** The shortest page a zoomed window may leave; the sidebar scrolls below 680. */
const FIT_MIN_HEIGHT = 600;
const listeners = new Set<() => void>();
let current: number | null = null;
/** The largest zoom the current screen can hold, or null before it is measured. */
let fitLimit: number | null = null;

export function normalizeZoom(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 1;
  const levels: readonly number[] = ZOOM_LEVELS;
  return levels.reduce((best, level) => (Math.abs(level - number) < Math.abs(best - number) ? level : best), 1);
}

/** How far a screen of this size (CSS px at 100%) lets the page grow. */
export function zoomLimitForArea(width: number, height: number): number {
  return Math.max(1, Math.min(width / BASE_MIN_WIDTH, height / FIT_MIN_HEIGHT));
}

export function levelFits(level: number, limit: number | null): boolean {
  return level === 1 || limit === null || level <= limit + 0.001;
}

/** The saved size, or the largest step that fits when the screen is smaller. */
export function appliedZoom(saved: number, limit: number | null): number {
  return [...ZOOM_LEVELS].reverse().find((level) => level <= saved + 0.001 && levelFits(level, limit)) ?? 1;
}

function read(): number {
  if (current !== null) return current;
  try {
    current = normalizeZoom(window.localStorage.getItem(UI_ZOOM_STORAGE_KEY) ?? 1);
  } catch {
    current = 1;
  }
  return current;
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function setUiZoom(value: number): void {
  current = normalizeZoom(value);
  try {
    window.localStorage.setItem(UI_ZOOM_STORAGE_KEY, String(current));
  } catch {
    // Applies for this launch.
  }
  notify();
}

function setFitLimit(limit: number) {
  const rounded = Math.round(limit * 1000) / 1000;
  if (rounded === fitLimit) return;
  fitLimit = rounded;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The saved size the user picked. */
export function useUiZoom(): number {
  return useSyncExternalStore(subscribe, read, () => 1);
}

/** The largest zoom this screen can hold (null until measured). */
export function useUiZoomLimit(): number | null {
  return useSyncExternalStore(subscribe, () => fitLimit, () => null);
}

/** The next fitting step up or down from the size in use. */
export function steppedZoom(value: number, direction: 1 | -1, limit: number | null): number {
  const levels = ZOOM_LEVELS.filter((level) => levelFits(level, limit));
  const nearest = levels.reduce((best, level, index) => (Math.abs(level - value) < Math.abs(levels[best]! - value) ? index : best), 0);
  return levels[Math.min(levels.length - 1, Math.max(0, nearest + direction))]!;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function measureNativeLimit(): Promise<void> {
  const { currentMonitor } = await import("@tauri-apps/api/window");
  const monitor = await currentMonitor().catch(() => null);
  if (!monitor) return;
  const scale = monitor.scaleFactor || 1;
  const area = monitor.workArea?.size ?? monitor.size;
  setFitLimit(zoomLimitForArea(area.width / scale, area.height / scale));
}

async function applyNativeZoom(zoom: number): Promise<void> {
  const [{ getCurrentWebview }, { getCurrentWindow, currentMonitor }, { LogicalSize }] = await Promise.all([
    import("@tauri-apps/api/webview"),
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/dpi"),
  ]);
  await getCurrentWebview().setZoom(zoom);
  const appWindow = getCurrentWindow();
  const monitor = await currentMonitor().catch(() => null);
  const scale = monitor?.scaleFactor ?? 1;
  const area = monitor?.workArea?.size ?? monitor?.size;
  const maxWidth = area ? area.width / scale : Number.POSITIVE_INFINITY;
  const maxHeight = area ? area.height / scale : Number.POSITIVE_INFINITY;
  const minWidth = Math.min(Math.round(BASE_MIN_WIDTH * zoom), Math.floor(maxWidth));
  const minHeight = Math.min(Math.round(BASE_MIN_HEIGHT * zoom), Math.floor(maxHeight));
  await appWindow.setMinSize(new LogicalSize(minWidth, minHeight));
  const inner = await appWindow.innerSize();
  const factor = await appWindow.scaleFactor();
  const width = inner.width / factor;
  const height = inner.height / factor;
  if (width < minWidth || height < minHeight) {
    await appWindow.setSize(new LogicalSize(Math.max(width, minWidth), Math.max(height, minHeight)));
  }
}

function applyPreviewZoom(zoom: number) {
  // Browser review builds have no native zoom; CSS zoom gives the same layout
  // once the full-height shell is divided back by the zoom (see the CSS).
  const root = document.documentElement;
  root.style.setProperty("zoom", zoom === 1 ? "" : String(zoom));
  root.style.setProperty("--fr-preview-zoom", String(zoom));
  if (zoom === 1) delete root.dataset.uiZoomPreview;
  else root.dataset.uiZoomPreview = "";
}

/** Applies the saved size to the main window and handles ⌘/Ctrl +, − and 0. */
export function useUiZoomRuntime(): void {
  const saved = useUiZoom();
  const limit = useUiZoomLimit();
  const zoom = appliedZoom(saved, limit);

  useEffect(() => {
    if (isTauri()) {
      void measureNativeLimit().catch(() => undefined);
      let timer: number | undefined;
      let unlisten: Array<() => void> = [];
      const remeasure = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void measureNativeLimit().catch(() => undefined), 400);
      };
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        unlisten = await Promise.all([appWindow.onMoved(remeasure), appWindow.onScaleChanged(remeasure)]);
      }).catch(() => undefined);
      return () => {
        window.clearTimeout(timer);
        unlisten.forEach((stop) => stop());
      };
    }
    // The preview's "screen" is the browser viewport; CSS zoom leaves it as is.
    const measure = () => setFitLimit(zoomLimitForArea(window.innerWidth, window.innerHeight));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.uiZoom = String(zoom);
    if (isTauri()) {
      void applyNativeZoom(zoom).catch((error: unknown) => {
        console.warn("Could not apply the window size", error);
      });
    } else {
      applyPreviewZoom(zoom);
    }
  }, [zoom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const inUse = appliedZoom(read(), fitLimit);
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setUiZoom(steppedZoom(inUse, 1, fitLimit));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setUiZoom(steppedZoom(inUse, -1, fitLimit));
      } else if (event.key === "0") {
        event.preventDefault();
        setUiZoom(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

export function resetUiZoomForTests(): void {
  current = null;
  fitLimit = null;
}

