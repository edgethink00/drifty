import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";
import type { ExtremeNudgeToastEvent } from "./extremeNudgeData";
import type { DriftAlarmAction } from "./driftAlarmEvent";
import type { DriftAlarmEvent } from "./driftAlarmEvent";
import type { WatcherPeekEvent, WatcherPeekResponse } from "./watcherPeekTypes";
import type { CompanionHorizontalAnchor, CompanionPillState } from "./companionPillLayout";
import type { CompanionPillMilestoneEvent } from "./CompanionPillMoment";
import type { CompanionSurfacePolicy } from "./companionPillSettings";

type UnlistenFn = () => void;

type WatcherResponseEvent = {
  response: unknown;
};

type EndOfDayReviewActionEvent = {
  action: unknown;
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
  | "openTrends";
export type CompanionVisibilityAction = "hideOneHour" | "turnOff";
export type NativeWatcherPeekDelivery = "delivered" | "dropped_expired" | "dropped_surface_disabled";
export type NativeEndOfDayReviewDropReason = "expired_unseen";
export type CompanionPillDriftAlarmPayload = {
  kind: "companionDriftAlarm";
  alarm: DriftAlarmEvent;
};
export type CompanionPillWindowEvent = (
  | WatcherWindowEvent
  | CompanionPillDriftAlarmPayload
  | CompanionPillMilestoneEvent
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

/**
 * Hands a Day Review to the native surface and reports what became of it. An
 * older native build answers with no body; that is treated as delivered, the
 * only outcome it could report.
 */
export async function showNativeEndOfDayReview(event: EndOfDayReviewEvent): Promise<NativeWatcherPeekDelivery | null> {
  if (!isTauriRuntime()) return null;
  const result = await invoke<{ delivery?: unknown } | null | undefined>("watcher_peek_show", { payload: event });
  const delivery = result?.delivery;
  if (delivery === "dropped_expired" || delivery === "dropped_surface_disabled") return delivery;
  return "delivered";
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

/**
 * Unused. The renderer drives the native surface through
 * `setNativeCompanionSurfacePolicy` instead; this enable/disable shim maps
 * `true` to the Dev-only `Floating` policy on the Rust side, so calling it
 * would show the resident pill that no shipping policy presents.
 */
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
  /** The card opens upward from a status item low on its display (Windows bottom taskbar). */
  menuOpensUpward?: boolean | null;
  presentationId?: number | null;
};

export async function setNativeCompanionPillState(
  state: CompanionPillState,
  momentKey?: string,
  expiresAtMs?: number,
): Promise<NativeCompanionSetStateResult> {
  if (!isTauriRuntime()) return { prepared: false, menuAnchorX: null };
  const animated = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return invoke<NativeCompanionSetStateResult>("watcher_companion_set_state", { state, animated, ...(momentKey ? { momentKey } : {}), ...(expiresAtMs !== undefined ? { expiresAtMs } : {}) });
}

/** Reveal a menu-bar card only after its final React view has committed. */
export async function presentPreparedNativeCompanionMoment(presentationId?: number): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("watcher_companion_present_prepared", { presentationId });
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
 * pointer events to the page. null means the native window is hidden.
 */
export async function isNativeCompanionCursorOverCapsule(): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<boolean | null>("watcher_companion_cursor_over_capsule");
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

export async function dismissNativeCompanionMoment(kind: string, momentKey?: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_companion_dismiss_moment", { kind, ...(momentKey ? { momentKey } : {}) });
}

export async function hideNativeWatcherPeek(momentKey?: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_hide", { momentKey });
}

export async function dismissNativeWatcherPeek(momentKey?: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_dismiss", { momentKey });
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

export async function respondNativeWatcherPeek(response: WatcherPeekResponse, momentKey?: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_respond", { response, ...(momentKey ? { momentKey } : {}) });
}

export async function triggerNativeEndOfDayReviewAction(
  action: EndOfDayReviewAction,
  momentKey?: string,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_end_of_day_review_action", { action, ...(momentKey ? { momentKey } : {}) });
}

export async function notifyNativeEndOfDayReviewDisplayed(
  day: string,
  presentationDay: string,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_end_of_day_review_displayed", { day, presentationDay });
}

/** The Companion consumed a deferred Day Review unseen; the scheduler may rebuild it once. */
export async function notifyNativeEndOfDayReviewDropped(
  day: string,
  reason: NativeEndOfDayReviewDropReason,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_end_of_day_review_dropped", { day, reason });
}

export async function triggerNativeCompanionVisibilityAction(
  action: CompanionVisibilityAction,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_companion_visibility_action", { action });
}

export async function triggerNativeExtremeNudgeAction(action: DriftAlarmAction, momentKey?: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("watcher_peek_extreme_nudge_action", { action, ...(momentKey ? { momentKey } : {}) });
}

export async function listenToNativeWatcherShow(onShow: (event: CompanionPillWindowEvent) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<CompanionPillWindowEvent>("watcher-peek-show", ({ payload }) => onShow(payload));
}

export async function listenToNativeCompanionPillSnapshot(onUpdate: (event: WatcherPeekEvent) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<WatcherPeekEvent>("watcher-companion-snapshot", ({ payload }) => onUpdate(payload));
}

export async function listenToNativeCompanionPillClear(onClear: (momentKey?: string | null) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<{ momentKey?: string | null }>("watcher-companion-clear", ({ payload }) => onClear(payload?.momentKey));
}

/** Actual native shown/hidden state; Companion panels need not take focus. */
export async function listenToNativeCompanionVisibility(
  onVisibility: (visible: boolean) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<boolean>("watcher-companion-visibility", ({ payload }) => onVisibility(payload));
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

export async function listenToNativeWatcherDismissed(onDismissed: (momentKey?: string | null) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<{ momentKey?: string | null }>("watcher-peek-dismissed", ({ payload }) => onDismissed(payload?.momentKey));
}

export async function listenToNativeEndOfDayReviewAction(
  onAction: (action: EndOfDayReviewAction) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<EndOfDayReviewActionEvent>("end-of-day-review-action", ({ payload }) => {
    if (isEndOfDayReviewAction(payload.action)) {
      onAction(payload.action);
    }
  });
}

export async function listenToNativeEndOfDayReviewDisplayed(
  onDisplayed: (day: string, presentationDay?: string) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<{ day?: unknown; presentationDay?: unknown }>("end-of-day-review-displayed", ({ payload }) => {
    if (typeof payload?.day === "string") {
      onDisplayed(
        payload.day,
        typeof payload.presentationDay === "string" ? payload.presentationDay : undefined,
      );
    }
  });
}

export async function listenToNativeEndOfDayReviewDropped(
  onDropped: (day: string, reason: NativeEndOfDayReviewDropReason) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<{ day?: unknown; reason?: unknown }>("end-of-day-review-dropped", ({ payload }) => {
    if (typeof payload?.day === "string" && payload.reason === "expired_unseen") {
      onDropped(payload.day, payload.reason);
    }
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
    || value === "openTrends";
}

function isCompanionVisibilityAction(value: unknown): value is CompanionVisibilityAction {
  return value === "hideOneHour" || value === "turnOff";
}
