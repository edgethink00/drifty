import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { WatcherPeekEvent, WatcherPeekResponse } from "./WatcherPeek";

type UnlistenFn = () => void;

type WatcherResponseEvent = {
  response: unknown;
};

export function isTauriRuntime() {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return false;
  const internals = window.__TAURI_INTERNALS__ as Record<string, unknown>;
  return typeof internals.invoke === "function" && typeof internals.transformCallback === "function";
}

export async function showNativeWatcherPeek(event: WatcherPeekEvent): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("watcher_peek_show", { payload: event });
  return true;
}

export async function hideNativeWatcherPeek(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_hide");
}

export async function dismissNativeWatcherPeek(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_dismiss");
}

export async function setNativeWatcherInteractive(interactive: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_set_interactive", { interactive });
}

export async function respondNativeWatcherPeek(response: WatcherPeekResponse): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_respond", { response });
}

export async function listenToNativeWatcherShow(onShow: (event: WatcherPeekEvent) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<WatcherPeekEvent>("watcher-peek-show", ({ payload }) => onShow(payload));
}

export async function listenToNativeWatcherResponse(onResponse: (response: WatcherPeekResponse) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<WatcherResponseEvent>("watcher-peek-response", ({ payload }) => {
    if (isWatcherPeekResponse(payload.response)) onResponse(payload.response);
  });
}

export async function listenToNativeWatcherDismissed(onDismissed: () => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen("watcher-peek-dismissed", onDismissed);
}

function isWatcherPeekResponse(value: unknown): value is WatcherPeekResponse {
  return value === "return" || value === "snooze" || value === "dismiss";
}
