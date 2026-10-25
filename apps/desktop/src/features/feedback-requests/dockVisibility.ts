import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

/**
 * macOS only: whether Drifty keeps a Dock tile after its window closes
 * (feedback 5 and 36, 2026-10-25). There is no fully hidden mode: it would
 * also drop Drifty from the app switcher and leave the menu bar icon as the
 * only way back.
 */
export type DockVisibility = "always" | "while-open";

const PREVIEW_STORAGE_KEY = "drifty.preview.dockVisibility";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function parse(value: unknown): DockVisibility {
  return value === "while-open" ? value : "always";
}

export async function getDockVisibility(): Promise<DockVisibility> {
  if (!isTauri()) return parse(window.localStorage.getItem(PREVIEW_STORAGE_KEY));
  return parse(await invoke<string>("dock_visibility_get"));
}

export async function setDockVisibility(mode: DockVisibility): Promise<DockVisibility> {
  if (!isTauri()) {
    window.localStorage.setItem(PREVIEW_STORAGE_KEY, mode);
    return mode;
  }
  return parse(await invoke<string>("dock_visibility_set", { mode }));
}

export function useDockVisibility() {
  const [mode, setMode] = useState<DockVisibility | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void getDockVisibility().then((value) => { if (current) setMode(value); }).catch(() => { if (current) setMode("always"); });
    return () => { current = false; };
  }, []);
  const choose = (next: DockVisibility) => {
    const previous = mode;
    setMode(next);
    setFailed(false);
    void setDockVisibility(next).catch(() => {
      setMode(previous);
      setFailed(true);
    });
  };
  return { mode, failed, choose } as const;
}
