import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EndOfDayReviewEvent } from "./EndOfDayReview";
import type { WatcherPeekEvent, WatcherPeekResponse } from "./WatcherPeek";

type UnlistenFn = () => void;

type WatcherResponseEvent = {
  response: WatcherPeekResponse;
};

type EndOfDayReviewActionEvent = {
  action: unknown;
};

export type WatcherWindowEvent = WatcherPeekEvent | EndOfDayReviewEvent;
export type EndOfDayReviewAction = "openDashboard" | "viewDetails" | "openNotificationSettings";

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

export async function showNativeEndOfDayReview(event: EndOfDayReviewEvent): Promise<boolean> {
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

export async function triggerNativeEndOfDayReviewAction(action: EndOfDayReviewAction): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_end_of_day_review_action", { action });
}

export async function listenToNativeWatcherShow(onShow: (event: WatcherWindowEvent) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<WatcherWindowEvent>("watcher-peek-show", ({ payload }) => onShow(payload));
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

export async function listenToNativeEndOfDayReviewAction(onAction: (action: EndOfDayReviewAction) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<EndOfDayReviewActionEvent>("end-of-day-review-action", ({ payload }) => {
    if (isEndOfDayReviewAction(payload.action)) onAction(payload.action);
  });
}

function isWatcherPeekResponse(value: string): value is WatcherPeekResponse {
  return value === "return" || value === "snooze" || value === "dismiss";
}

function isEndOfDayReviewAction(value: unknown): value is EndOfDayReviewAction {
  return value === "openDashboard" || value === "viewDetails" || value === "openNotificationSettings";
}
