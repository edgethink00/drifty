import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";
import type { ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import type { DriftAlarmAction } from "./driftAlarmEvent";
import type { DriftAlarmEvent } from "./driftAlarmEvent";
import type { WatcherPeekEvent, WatcherPeekResponse } from "./WatcherPeek";
import type { CompanionHorizontalAnchor, CompanionPillState } from "./companionPillLayout";
import type { CompanionPillMilestoneEvent } from "./CompanionPillMoment";
import type { CompanionReentryEvent } from "./companionReentry";
import type { CompanionSurfacePolicy } from "./companionPillSettings";

type UnlistenFn = () => void;

type WatcherResponseEvent = {
  response: unknown;
};

type EndOfDayReviewActionEvent = {
  action: unknown;
  activityAt?: unknown;
};

type CompanionVisibilityActionEvent = {
  action: unknown;
};

export type WatcherWindowEvent = WatcherPeekEvent | EndOfDayReviewEvent | ExtremeNudgeToastEvent;
export type EndOfDayReviewAction =
  | "openDashboard"
  | "viewDetails"
  | "openNotificationSettings"
  | "openSettings"
  | "openAiSettings"
  | "openLeaderboard"
  | "openTrends"
  | "openActivityDay";
export type CompanionVisibilityAction = "hideOneHour" | "turnOff";
export type CompanionPillDriftAlarmPayload = {
  kind: "companionDriftAlarm";
  alarm: DriftAlarmEvent;
};
export type CompanionPillWindowEvent = (
  | WatcherWindowEvent
  | CompanionPillDriftAlarmPayload
  | CompanionPillMilestoneEvent
  | CompanionReentryEvent
) & {
  /** Native-only paint hint; omitted by browser prototypes and legacy watcher surfaces. */
  __companionPresentation?: "floating" | "menuBar";
};
export type NativeCompanionPointerEvent = {
  screenX: number;
  screenY: number;
};
export type NativeCompanionTransitionEvent = {
  state: CompanionPillState;
  phase: "started" | "completed";
  anchor: CompanionHorizontalAnchor;
};

export function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  if (isTauri()) return true;
  return "__TAURI_INTERNALS__" in window;
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

export async function showNativeExtremeNudgeToast(event: ExtremeNudgeToastEvent): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("watcher_peek_show", { payload: event });
  return true;
}

export async function showNativeCompanionDriftAlarm(event: DriftAlarmEvent): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("watcher_peek_show", {
    payload: { kind: "companionDriftAlarm", alarm: event } satisfies CompanionPillDriftAlarmPayload,
  });
  return true;
}

export async function showNativeCompanionMilestone(
  event: CompanionPillMilestoneEvent,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("watcher_peek_show", { payload: event });
  return true;
}

export async function showNativeCompanionReentry(event: CompanionReentryEvent): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("watcher_peek_show", { payload: event });
  return true;
}

export async function setNativeCompanionPillEnabled(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_companion_set_enabled", { enabled });
}

export async function setNativeCompanionSurfacePolicy(
  policy: CompanionSurfacePolicy,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_companion_set_surface_policy", { policy });
}

export type NativeCompanionSetStateResult = {
  prepared: boolean;
  menuAnchorX: number | null;
};

export async function setNativeCompanionPillState(
  state: CompanionPillState,
): Promise<NativeCompanionSetStateResult> {
  if (!isTauriRuntime()) return { prepared: false, menuAnchorX: null };
  const animated = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return invoke<NativeCompanionSetStateResult>("watcher_companion_set_state", { state, animated });
}

/** Reveal a menu-bar card only after its final React view has committed. */
export async function presentPreparedNativeCompanionMoment(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_companion_present_prepared");
}

/**
 * The capsule lives in a fixed transparent native canvas. That unused canvas
 * has to be click-through whenever the cursor is not over the visible pill.
 */
export async function setNativeCompanionClickThrough(ignore: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_companion_set_click_through", { ignore });
}

/**
 * Whether the cursor is over the visible capsule rather than its transparent
 * canvas. Asked natively because a click-through window no longer reports
 * pointer events to the page.
 */
export async function isNativeCompanionCursorOverCapsule(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    return await invoke<boolean>("watcher_companion_cursor_over_capsule");
  } catch {
    return false;
  }
}

/**
 * Hand the original press coordinates to the native AppKit drag loop. The
 * companion NSPanel keeps the visible capsule below the menu bar while its
 * transparent gutter may extend outside the work area.
 */
export async function dragNativeCompanion(startClientX: number, startClientY: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_companion_clamp_to_screen", { startClientX, startClientY });
}

export async function updateNativeCompanionPill(event: WatcherPeekEvent): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_companion_update", { payload: event });
}

export async function dismissNativeCompanionMoment(kind: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_companion_dismiss_moment", { kind });
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

export async function isNativeWatcherCursorInside(): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;

  try {
    return await invoke<boolean>("watcher_peek_cursor_inside");
  } catch {
    return null;
  }
}

export async function respondNativeWatcherPeek(response: WatcherPeekResponse): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_respond", { response });
}

export async function triggerNativeEndOfDayReviewAction(
  action: EndOfDayReviewAction,
  activityAt?: string,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_end_of_day_review_action", { action, activityAt });
}

export async function notifyNativeEndOfDayReviewDisplayed(day: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_end_of_day_review_displayed", { day });
}

export async function triggerNativeCompanionVisibilityAction(
  action: CompanionVisibilityAction,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_companion_visibility_action", { action });
}

export async function triggerNativeExtremeNudgeAction(action: DriftAlarmAction): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_extreme_nudge_action", { action });
}

export async function listenToNativeWatcherShow(onShow: (event: CompanionPillWindowEvent) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<CompanionPillWindowEvent>("watcher-peek-show", ({ payload }) => onShow(payload));
}

export async function listenToNativeCompanionPillSnapshot(onUpdate: (event: WatcherPeekEvent) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<WatcherPeekEvent>("watcher-companion-snapshot", ({ payload }) => onUpdate(payload));
}

export async function listenToNativeCompanionPillClear(onClear: () => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen("watcher-companion-clear", onClear);
}

export async function listenToNativeCompanionTransition(
  onTransition: (event: NativeCompanionTransitionEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<NativeCompanionTransitionEvent>("watcher-companion-transition", ({ payload }) => {
    onTransition(payload);
  });
}

export async function listenToNativeCompanionPointerEntered(
  onEnter: (event: NativeCompanionPointerEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<NativeCompanionPointerEvent>("watcher-companion-pointer-entered", ({ payload }) => onEnter(payload));
}

export async function listenToNativeCompanionPointerMoved(
  onMove: (event: NativeCompanionPointerEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<NativeCompanionPointerEvent>("watcher-companion-pointer-moved", ({ payload }) => onMove(payload));
}

export async function listenToNativeCompanionPointerExited(
  onExit: (event: NativeCompanionPointerEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<NativeCompanionPointerEvent>("watcher-companion-pointer-exited", ({ payload }) => onExit(payload));
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

export async function listenToNativeEndOfDayReviewAction(
  onAction: (action: EndOfDayReviewAction, activityAt?: string) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<EndOfDayReviewActionEvent>("end-of-day-review-action", ({ payload }) => {
    if (isEndOfDayReviewAction(payload.action)) {
      onAction(payload.action, typeof payload.activityAt === "string" ? payload.activityAt : undefined);
    }
  });
}

export async function listenToNativeEndOfDayReviewDisplayed(
  onDisplayed: (day: string) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<{ day?: unknown }>("end-of-day-review-displayed", ({ payload }) => {
    if (typeof payload?.day === "string") onDisplayed(payload.day);
  });
}

export async function listenToNativeCompanionVisibilityAction(
  onAction: (action: CompanionVisibilityAction) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<CompanionVisibilityActionEvent>("companion-visibility-action", ({ payload }) => {
    if (isCompanionVisibilityAction(payload.action)) onAction(payload.action);
  });
}

function isWatcherPeekResponse(value: unknown): value is WatcherPeekResponse {
  return value === "return" || value === "snooze" || value === "dismiss";
}

function isEndOfDayReviewAction(value: unknown): value is EndOfDayReviewAction {
  return value === "openDashboard"
    || value === "viewDetails"
    || value === "openNotificationSettings"
    || value === "openSettings"
    || value === "openAiSettings"
    || value === "openLeaderboard"
    || value === "openTrends"
    || value === "openActivityDay";
}

function isCompanionVisibilityAction(value: unknown): value is CompanionVisibilityAction {
  return value === "hideOneHour" || value === "turnOff";
}
