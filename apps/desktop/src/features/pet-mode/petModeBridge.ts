import type { DisplayLanguage } from "../localization/languageCatalog";
import { isDisplayLanguage } from "../localization/languageCatalog";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../companion/watcherBridge";
import type {
  PetModeContactAlignment,
  PetModeInterventionTarget,
  PetModeLabState,
  PetModeOutingTicket,
  PetModePreviewAction,
  PetModeResolvedTarget,
  PetModeSnapshot,
  PetModeWindowEvent,
} from "./petModeData";
import {
  PET_MODE_DRIFT_CHASE_TURN_COOLDOWN_MS,
  PET_MODE_DRIFT_CHASE_TURN_HYSTERESIS,
  resolvePetModeDriftCursorReturnDuration,
  type PetModeDriftHuntSettings,
} from "./petModeDriftHunt";

type UnlistenFn = () => void;

type PetModeContactEvent = {
  readonly id: string;
  readonly contacted?: boolean;
  readonly reason?: string | null;
};

type PetModePointerEvent = {
  readonly at: number;
};

type PetModeAlignmentEvent = PetModeContactAlignment;

export type PetVisibilityAction = "hideOneHour" | "turnOff";

type PetVisibilityActionEvent = {
  readonly action?: unknown;
};

function isPetVisibilityAction(value: unknown): value is PetVisibilityAction {
  return value === "hideOneHour" || value === "turnOff";
}

/** Memory-only, process-lifetime receipts; messages and policy attempts do not confirm applied DPI. */
export type PetModeWindowsDpiEvents = {
  readonly nativeMessageCount: number;
  readonly nativeLastAtMs?: number;
  readonly nativeLastDpiX?: number;
  readonly nativeLastDpiY?: number;
  readonly tauriScaleChangeCount: number;
  readonly tauriLastAtMs?: number;
  readonly tauriLastScaleFactor?: number;
  /** Optional to distinguish older native builds from an observed zero count. */
  readonly settingChangeCount?: number;
  readonly settingChangeLastAtMs?: number;
  readonly settingChangeLastWparam?: number;
  readonly displayChangeCount?: number;
  readonly displayChangeLastAtMs?: number;
  readonly policyFrameChangeCount?: number;
  readonly policyFrameChangeLastAtMs?: number;
};

export type PetModeInputBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
  readonly windowScaleFactor?: number;
  readonly nativeScaleFactor?: number;
  readonly windowDpiAwareness?: string;
  readonly threadDpiAwareness?: string;
  /** Context-sensitive monitor API diagnostic; not the frame calculation scale. */
  readonly currentMonitorScaleFactor?: number;
  readonly windowsDpiEvents?: PetModeWindowsDpiEvents;
  /** Memory-only native press observations; reading does not refresh input. */
  readonly windowsInput?: {
    readonly latest: WindowsPetInputSample | null;
    readonly lastPress: WindowsPetInputSample | null;
    readonly rendererPointerDownCount: number;
    readonly dragRequestCount: number;
  };
  /** Current owned geometry/hit query, separate from the retained press sample. */
  readonly windowsSurface?: {
    readonly clientWidth: number;
    readonly clientHeight: number;
    readonly webviewX: number;
    readonly webviewY: number;
    readonly webviewWidth: number;
    readonly webviewHeight: number;
    readonly cursorClientX: number;
    readonly cursorClientY: number;
    readonly pointTargetInsidePet: boolean;
    /** Missing/null fields remain unknown on older or unsupported native builds. */
    readonly webviewScale?: {
      readonly rasterizationScale: number | null;
      readonly boundsMode: number | null;
      readonly detectsMonitorScaleChanges: boolean | null;
      readonly zoomFactor: number | null;
      readonly backgroundAlpha: number | null;
      readonly parentMatchesPet: boolean | null;
    } | null;
    readonly children?: ReadonlyArray<{
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly dpi: number | null;
      readonly visible: boolean;
      readonly enabled: boolean;
      readonly pointInRect: boolean;
    }>;
    readonly childrenTruncated?: boolean;
    readonly childBoundsReadFailures?: number;
    readonly layeredAlpha?: number | null;
  };
  readonly expectedRenderWidth?: number;
  readonly expectedRenderHeight?: number;
  readonly sampledAtMs?: number;
};

export type WindowsPetInputSample = {
  readonly sampledAtMs: number;
  readonly scaleFactor: number;
  readonly windowClientX: number;
  readonly windowClientY: number;
  readonly maskRevision: number;
  readonly maskSpanCount: number;
  readonly maskInside: boolean;
  readonly buttonDown: boolean;
  readonly interactive: boolean;
  readonly ignoredCursorEventsBeforeApply: boolean | null;
  readonly ignoredCursorEvents: boolean | null;
  readonly policyApplied: boolean;
};

export type PetModeCursorSample = {
  readonly cursorX: number;
  readonly cursorY: number;
  readonly windowX: number;
  readonly windowY: number;
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly visible: boolean;
};

export type PetModeStalkResult = {
  readonly outcome: "completed" | "timed_out" | "cancelled" | "pointer_pressed" | "different_display" | "disabled" | "hidden" | "unsupported_platform";
  readonly facing: "left" | "right";
  readonly cursorX: number | null;
  readonly cursorY: number | null;
  readonly cursorMovementDistance: number;
};

export type PetModeCursorReturnResult = {
  readonly outcome: "completed" | "cancelled" | "cursor_escaped" | "pointer_pressed" | "different_display" | "disabled" | "hidden" | "unsupported_platform";
  readonly movedDistance: number;
};

export type PetModeOutingHuntEntry = {
  readonly facing: "left" | "right";
};

export type PetModeSeatResolutionReason =
  | "control_overlap"
  | "no_control_overlap"
  | "anchor_clear_pending"
  | "motion_superseded"
  | "accessibility_unavailable"
  | "window_list_unavailable"
  | "no_candidate_window"
  | "scan_truncated"
  | "dense_control_strip"
  | "no_horizontal_gap"
  | "pet_disabled"
  | "pet_hidden"
  | "unsupported_platform";

export type PetModeSeatResolution = {
  readonly x: number;
  readonly y: number;
  /** True when the resolved safe seat differs from the sampled seat. */
  readonly moved: boolean;
  readonly reason: PetModeSeatResolutionReason;
};

// Windows first resolves the exact foreground browser-tab X through UIA, then
// native travel can legitimately use the full six-second cap before the paw
// reaches its reviewed contact frame. Keep the listener alive through lookup,
// travel, and the reviewed paw beat; the timeout is a lost-renderer failsafe,
// not a normal animation budget.
const PET_MODE_CONTACT_TIMEOUT_MS = 18_000;
let petModeEnabledSync: Promise<void> = Promise.resolve();

export async function setNativePetModeEnabled(
  enabled: boolean,
  snapshot: PetModeSnapshot | null,
  reducedMotion: boolean,
  width: number,
  height: number,
  forceReveal = false,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const sync = petModeEnabledSync.then(() => invoke("pet_mode_set_enabled", {
    enabled,
    snapshot,
    reducedMotion,
    width,
    height,
    forceReveal,
  }));
  // React effects can enqueue off/on transitions faster than Tauri can finish
  // the first command. Preserve call order without allowing one rejected invoke
  // to poison every later Pet Mode transition.
  petModeEnabledSync = sync.then(() => undefined, () => undefined);
  await sync;
  return true;
}

export async function updateNativePetMode(snapshot: PetModeSnapshot): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("pet_mode_update", { snapshot });
}

export async function setNativePetModeSize(width: number, height: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("pet_mode_set_size", { width, height });
}

/**
 * The dance pose stands the cat taller than the 99-point panel at its 1:1
 * body scale. Ask native for headroom above the panel right before showing
 * the pose and give it back afterwards. Resolves to whether the frame
 * changed; native also drops the headroom by itself before motion, drag, or
 * hide. On Windows, resizing during a dance keeps the needed headroom.
 */
export async function setNativePetDanceHeadroom(active: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return (await invoke<boolean>("pet_mode_set_dance_headroom", { active })) === true;
}

export async function setNativePetModeFloorHome(points: number): Promise<number | null> {
  if (!isTauriRuntime()) return null;
  return invoke<number>("pet_mode_set_floor_home", { points });
}

/**
 * Why the intervention no longer resolves to a bare boolean: every non-contact
 * outcome used to collapse into `false`, and the caller translated that into
 * "the user caught the cat". A silent renderer rejection, a slow AX scan, or a
 * hung webview then cancelled the automatic close as if the user had asked for
 * mercy. The outcome keeps user interception distinct from technical failure
 * so only a real catch can spend the reprieve.
 */
export type PetModeInterventionOutcome =
  | "contacted"
  | "user_intercepted"
  | "cancelled"
  | "rejected"
  | "timed_out"
  | "failed";

export type PetModeInterventionResult = {
  readonly outcome: PetModeInterventionOutcome;
  /** Renderer-reported detail (e.g. rejection guard), for diagnostics only. */
  readonly reason: string | null;
  /** Milliseconds from invoke to settlement, for drift alarm debug events. */
  readonly elapsedMs: number;
};

function classifyPetModeContactEvent(payload: PetModeContactEvent): PetModeInterventionOutcome {
  if (payload.contacted === true) return "contacted";
  // A malformed or version-skewed event must not claim the paw reached its
  // target. Treat it as a technical rejection so the caller can use the plain
  // Automatic close path the user explicitly enabled.
  if (payload.contacted !== false) return "rejected";
  // The renderer distinguishes a guard rejection from a user catch. A missing
  // reason (undefined from a stale renderer, null once Rust serializes an
  // omitted Option) came only from the interrupted-action paths, so it keeps
  // the user-interception meaning rather than silently losing the reprieve.
  if (payload.reason == null || payload.reason === "user_intercepted") {
    return "user_intercepted";
  }
  if (payload.reason === "activity_context_changed") return "cancelled";
  if (typeof payload.reason !== "string") return "rejected";
  return "rejected";
}

export async function playNativePetModeIntervention(
  target: PetModeInterventionTarget,
): Promise<PetModeInterventionResult> {
  const startedAt = Date.now();
  if (!isTauriRuntime()) {
    return { outcome: "failed", reason: "not_tauri_runtime", elapsedMs: 0 };
  }

  return new Promise<PetModeInterventionResult>((resolve) => {
    let settled = false;
    let timeoutId = 0;
    let unlisten: UnlistenFn | null = null;

    const finish = (outcome: PetModeInterventionOutcome, reason: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unlisten?.();
      resolve({ outcome, reason, elapsedMs: Date.now() - startedAt });
    };

    timeoutId = window.setTimeout(() => finish("timed_out", "contact_timeout"), PET_MODE_CONTACT_TIMEOUT_MS);
    void listen<PetModeContactEvent>("pet-mode-contact", ({ payload }) => {
      if (payload.id !== target.id) return;
      finish(classifyPetModeContactEvent(payload), payload.reason ?? null);
    }).then((nextUnlisten) => {
      if (settled) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
      return invoke("pet_mode_intervene", { target });
    }).catch((error: unknown) => {
      finish("failed", error instanceof Error ? error.message : "invoke_failed");
    });
  });
}

export async function previewNativePetModeIntervention(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("pet_mode_preview_intervention");
  return true;
}

export async function previewNativePetModeAction(action: PetModePreviewAction): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("pet_mode_preview_action", { action });
  return true;
}

export async function previewNativePetModeFacing(facing: "left" | "right"): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await emit("pet-mode-event", { kind: "preview_facing", facing } satisfies PetModeWindowEvent);
  return true;
}

export async function cancelNativePetMotion(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("pet_mode_cancel_motion");
}

export async function stalkNativePetCursor(settings: PetModeDriftHuntSettings): Promise<PetModeStalkResult | null> {
  if (!isTauriRuntime()) return null;
  const chase = settings.mode === "chase";
  return invoke<PetModeStalkResult>("pet_mode_stalk_cursor", {
    request: {
      durationMs: chase ? settings.chaseDurationMs : 3_200,
      biteGap: 0,
      captureRadius: settings.captureRadius,
      speed: settings.stalkSpeed,
      retargetCursor: chase,
      turnHysteresis: chase && settings.softTurns ? PET_MODE_DRIFT_CHASE_TURN_HYSTERESIS : 0,
      turnCooldownMs: chase && settings.softTurns ? PET_MODE_DRIFT_CHASE_TURN_COOLDOWN_MS : 0,
    },
  });
}

export async function returnWithNativePetCursor({
  targetX,
  targetY,
  approachFacing,
  cursorMovementDistance,
  settings,
}: {
  readonly targetX: number;
  readonly targetY: number;
  readonly approachFacing: "left" | "right";
  readonly cursorMovementDistance: number;
  readonly settings: PetModeDriftHuntSettings;
}): Promise<PetModeCursorReturnResult | null> {
  if (!isTauriRuntime()) return null;
  return invoke<PetModeCursorReturnResult>("pet_mode_carry_cursor", {
    request: {
      targetX,
      targetY,
      approachFacing,
      distance: settings.carryDistance,
      durationMs: resolvePetModeDriftCursorReturnDuration(cursorMovementDistance, settings),
      captureRadius: settings.captureRadius,
      cursorLagMs: settings.cursorLagMs,
      gripTolerance: settings.cursorSlack,
      yankDistance: settings.cursorYankDistance,
      maxGripMs: settings.cursorGripMs,
    },
  });
}

export async function applyNativePetModeLabTarget(
  target: Pick<
    PetModeInterventionTarget,
    "browserName" | "browserIdentity" | "siteDomain" | "siteUrl" | "labTarget"
  >,
): Promise<string> {
  if (!isTauriRuntime()) return "not_tauri_runtime";
  return invoke<string>("pet_mode_lab_apply_target", { target });
}

export async function listenToNativePetModeEvent(
  onEvent: (event: PetModeWindowEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<PetModeWindowEvent>("pet-mode-event", ({ payload }) => onEvent(payload));
}

export async function reportNativePetModeLabState(state: PetModeLabState): Promise<void> {
  if (!isTauriRuntime()) return;
  await emit("pet-mode-lab-state", state);
}

export async function listenToNativePetModeLabState(
  onState: (state: PetModeLabState) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<PetModeLabState>("pet-mode-lab-state", ({ payload }) => onState(payload));
}

export async function requestNativePetModeLabState(): Promise<void> {
  if (!isTauriRuntime()) return;
  await emit("pet-mode-lab-state-request");
}

export async function listenToNativePetModeLabStateRequest(
  onRequest: () => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen("pet-mode-lab-state-request", onRequest);
}

export async function moveNativePetToTarget(
  target: PetModeInterventionTarget,
): Promise<PetModeResolvedTarget> {
  // The close run is not gated on prefers-reduced-motion; see
  // `move_pet_to_target` in src-tauri/src/commands/pet_mode.rs.
  return invoke<PetModeResolvedTarget>("pet_mode_move_to_target", { target });
}

export async function alignNativePetContact(request: {
  readonly targetX: number;
  readonly targetY: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly diagnostic: string;
}): Promise<PetModeContactAlignment> {
  return invoke<PetModeContactAlignment>("pet_mode_align_contact", { request });
}

export async function reportNativePetContact(
  id: string,
  contacted = true,
  reason: string | null = null,
): Promise<void> {
  await invoke("pet_mode_report_contact", { id, contacted, reason });
}

export async function reportNativePetPointer(): Promise<void> {
  await invoke("pet_mode_report_pointer");
}

export async function listenToNativePetPointer(
  onPointer: (event: PetModePointerEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<PetModePointerEvent>("pet-mode-pointer", ({ payload }) => onPointer(payload));
}

export async function listenToNativePetAlignment(
  onAlignment: (event: PetModeAlignmentEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<PetModeAlignmentEvent>("pet-mode-alignment", ({ payload }) => onAlignment(payload));
}

export async function returnNativePetHome(): Promise<void> {
  await invoke("pet_mode_return_home");
}

export async function setNativePetPresence(
  visible: boolean,
  outingGeneration?: number,
): Promise<void> {
  await invoke("pet_mode_set_presence", { visible, outingGeneration });
}

export async function setNativePetInteractive(interactive: boolean): Promise<void> {
  await invoke("pet_mode_set_interactive", { interactive });
}

export type PetModeHitRegionUpdate = {
  readonly generation: string;
  readonly version: number;
  readonly regionId: string;
  readonly revision: number;
  readonly mirrored: boolean;
  readonly spans: readonly number[];
};

export async function updateNativePetHitRegion(update: PetModeHitRegionUpdate): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("pet_mode_update_hit_region", { update });
}

export type PetModeNativeDragResult = {
  readonly manualRequestId?: string;
  readonly moved: boolean;
  /** Optional while an HMR renderer can still be paired with an older native process. */
  readonly shakeDetected?: boolean;
  /** Optional while an HMR renderer can still be paired with an older native process. */
  readonly strokeDetected?: boolean;
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
};

const manualDragClock = globalThis as typeof globalThis & { __driftyManualDragClock?: number };
const MANUAL_DRAG_CLOCK_STORAGE_KEY = "drifty.petMode.manualDragClock.v1";
const MANUAL_DRAG_CLOCK_HEADROOM = 1_000_000_000_000;
const MAX_MANUAL_DRAG_CLOCK_SEED = Number.MAX_SAFE_INTEGER - MANUAL_DRAG_CLOCK_HEADROOM;
function boundedManualDragClock(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function readPersistedManualDragClock(raw: string | null | undefined): number {
  if (!raw) return 0;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("seed" in value) || !("offset" in value)) return 0;
  const seed = boundedManualDragClock(value.seed);
  const offset = boundedManualDragClock(value.offset);
  if (seed !== value.seed || offset !== value.offset || seed > MAX_MANUAL_DRAG_CLOCK_SEED
    || offset > MANUAL_DRAG_CLOCK_HEADROOM || !Number.isSafeInteger(seed + offset)) return 0;
  return seed + offset;
}
export function createPetManualDragRequestId(): string {
  // Fixed width permits native to reject a delayed A after a newer B. The
  // persisted monotonic clock survives full renderer reloads and wall-clock
  // rollback, while memory retains ordering if storage becomes unavailable.
  let persisted = 0;
  try { persisted = readPersistedManualDragClock(globalThis.localStorage?.getItem(MANUAL_DRAG_CLOCK_STORAGE_KEY)); } catch { /* Storage unavailable or corrupt. */ }
  const now = Date.now() * 1_000;
  const previous = Math.max(boundedManualDragClock(manualDragClock.__driftyManualDragClock), persisted);
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_MANUAL_DRAG_CLOCK_SEED || previous === Number.MAX_SAFE_INTEGER) {
    throw new Error("Pet Mode manual request clock is exhausted");
  }
  const next = Math.max(
    now,
    previous + 1,
  );
  manualDragClock.__driftyManualDragClock = next;
  // Validate the persisted seed separately from its generated increments: an
  // accepted boundary seed must never reset when its counter crosses that
  // boundary, including after reload. Numeric exhaustion is an explicit error.
  const seed = Math.min(next, MAX_MANUAL_DRAG_CLOCK_SEED);
  try { globalThis.localStorage?.setItem(MANUAL_DRAG_CLOCK_STORAGE_KEY, JSON.stringify({ seed, offset: next - seed })); } catch { /* Memory retains ordering. */ }
  return `${String(Math.floor(next / 1_000)).padStart(13, "0")}-${String(next % 1_000).padStart(6, "0")}`;
}

type ManualDragEvent<T> = T | { readonly manualRequestId: string; readonly value: T };
function normalizeManualDragEvent<T>(payload: ManualDragEvent<T>): { value: T; manualRequestId?: string } {
  if (payload !== null && typeof payload === "object" && "manualRequestId" in payload && "value" in payload) {
    return payload as { value: T; manualRequestId: string };
  }
  return { value: payload as T };
}

export async function beginNativePetDrag(
  startClientX: number,
  startClientY: number,
  pickupDelayMs: number,
  pointerType?: string,
  manualRequestId?: string,
): Promise<PetModeNativeDragResult> {
  return invoke<PetModeNativeDragResult>("pet_mode_begin_drag", {
    startClientX,
    startClientY,
    pickupDelayMs,
    ...(pointerType === undefined ? {} : { pointerType }),
    ...(manualRequestId === undefined ? {} : { manualRequestId }),
  });
}

export async function listenToNativePetDragEnd(
  onDragEnd: (result: PetModeNativeDragResult) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<PetModeNativeDragResult>("pet-mode-drag-end", ({ payload }) => onDragEnd(payload));
}

export async function listenToNativePetDragStart(
  onDragStart: (manualRequestId?: string) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<ManualDragEvent<boolean>>("pet-mode-drag-start", ({ payload }) => onDragStart(normalizeManualDragEvent(payload).manualRequestId));
}

export async function listenToNativePetStrokeDetected(
  onStrokeDetected: (manualRequestId?: string) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<ManualDragEvent<boolean>>("pet-mode-stroke-detected", ({ payload }) => onStrokeDetected(normalizeManualDragEvent(payload).manualRequestId));
}

export async function reportNativePetDragError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await invoke("pet_mode_report_drag_error", { error: message });
}

export async function isNativePetCursorInside(): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<boolean>("pet_mode_cursor_inside");
  } catch {
    return null;
  }
}

export async function sampleNativePetCursor(): Promise<PetModeCursorSample | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<PetModeCursorSample>("pet_mode_cursor_sample");
  } catch {
    return null;
  }
}

export async function getNativePetInputBounds(): Promise<PetModeInputBounds | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<PetModeInputBounds>("pet_mode_input_bounds");
  } catch {
    return null;
  }
}

export async function placeNativePetModeAtCenterForLab(): Promise<PetModeInputBounds | null> {
  if (!isTauriRuntime()) return null;
  return invoke<PetModeInputBounds>("pet_mode_lab_place_center");
}

export async function roamNativePet(postDrop = false): Promise<void> {
  await invoke("pet_mode_roam", { postDrop });
}

export async function exitNativePetScreen(): Promise<PetModeOutingTicket> {
  return invoke<PetModeOutingTicket>("pet_mode_exit_screen");
}

export async function returnNativePetFromOuting(ticket: PetModeOutingTicket): Promise<void> {
  await invoke("pet_mode_return_from_outing", {
    side: ticket.side,
    outingGeneration: ticket.generation,
  });
}

export async function prepareNativePetOutingHunt(
  ticket: PetModeOutingTicket,
): Promise<PetModeOutingHuntEntry | null> {
  if (!isTauriRuntime()) return null;
  return invoke<PetModeOutingHuntEntry | null>("pet_mode_prepare_outing_hunt", {
    side: ticket.side,
    outingGeneration: ticket.generation,
  });
}

export async function rememberNativePetPosition(
  reducedMotion = false,
): Promise<PetModeSeatResolution> {
  return invoke<PetModeSeatResolution>("pet_mode_remember_position", { reducedMotion });
}

export async function reconcileNativePetPosition(
  reducedMotion = false,
  holdSeat = false,
): Promise<PetModeSeatResolution> {
  return invoke<PetModeSeatResolution>("pet_mode_reconcile_position", { reducedMotion, holdSeat });
}

export async function probeNativePetAxSeat(): Promise<PetModeSeatResolution> {
  return invoke<PetModeSeatResolution>("pet_mode_probe_ax_seat");
}

export type PetDropKind = "hold" | "stay_top" | "stay_floor" | "already_on" | "catch" | "hop";

export type PetDropPlan = {
  readonly kind: PetDropKind;
  readonly distance: number;
  readonly durationMs: number;
  readonly targetY: number;
  readonly ledge: string;
};

export async function resolveNativePetDrop(forceFloor = false): Promise<PetDropPlan | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<PetDropPlan>("pet_mode_resolve_drop", { forceFloor });
  } catch (error) {
    console.error("[pet-drop] invoke failed:", error);
    return null;
  }
}

export async function setNativePetModeGuides(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await emit("pet-mode-event", { kind: "guides", enabled });
}

export async function triggerNativePetVisibilityAction(
  action: PetVisibilityAction,
  options?: { keepQuickControlsVisible?: boolean },
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("pet_mode_visibility_action", {
    action,
    ...(options?.keepQuickControlsVisible ? { keepQuickControlsVisible: true } : {}),
  });
}

export async function listenToNativePetVisibilityAction(
  onAction: (action: PetVisibilityAction) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<PetVisibilityActionEvent>("pet-visibility-action", ({ payload }) => {
    if (isPetVisibilityAction(payload.action)) onAction(payload.action);
  });
}

export async function listenToNativePetDragProbe(
  onProbe: (probe: PetDropPlan | null, manualRequestId?: string) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<ManualDragEvent<PetDropPlan | null>>("pet-mode-drag-probe", ({ payload }) => {
    const event = normalizeManualDragEvent(payload);
    onProbe(event.value, event.manualRequestId);
  });
}

export type PetQuickControlsAction =
  | "hideOneHour"
  | "turnOff"
  | "openDashboard"
  | "openSettings"
  | "toggleAutomaticClose"
  | "automaticClosePause15"
  | "automaticClosePause60"
  | "automaticClosePauseToday"
  | "automaticClosePauseForever"
  | "automaticCloseEnable15"
  | "automaticCloseEnable60"
  | "automaticCloseEnableToday"
  | "automaticCloseEnableForever"
  | "automaticCloseRestore"
  | "automaticCloseExtend60"
  | "automaticCloseExtendToday"
  | "acknowledgeDismiss";

export type PetQuickControlsAutomaticCloseOverridePayload = {
  readonly enabled: boolean;
  readonly kind: "15" | "60" | "today" | "forever";
  readonly endsAtMs: number | null;
};

export type PetQuickControlsStatePayload = {
  readonly automaticCloseEnabled: boolean;
  readonly automaticCloseSavedEnabled: boolean;
  readonly automaticCloseOverride: PetQuickControlsAutomaticCloseOverridePayload | null;
  readonly language: DisplayLanguage;
  readonly theme: "light" | "dark";
  readonly followSystem?: boolean;
};

function isPetQuickControlsAutomaticCloseOverridePayload(
  value: unknown,
): value is PetQuickControlsAutomaticCloseOverridePayload {
  if (!value || typeof value !== "object") return false;
  const override = value as Record<string, unknown>;
  const kind = override.kind;
  if (
    typeof override.enabled !== "boolean"
    || (kind !== "15" && kind !== "60" && kind !== "today" && kind !== "forever")
  ) return false;
  return kind === "forever"
    ? override.endsAtMs === null
    : typeof override.endsAtMs === "number" && Number.isFinite(override.endsAtMs);
}

function isPetQuickControlsStatePayload(value: unknown): value is PetQuickControlsStatePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.automaticCloseEnabled === "boolean"
    && typeof payload.automaticCloseSavedEnabled === "boolean"
    && (payload.automaticCloseOverride === null
      || isPetQuickControlsAutomaticCloseOverridePayload(payload.automaticCloseOverride))
    && isDisplayLanguage(payload.language)
    && (payload.theme === "light" || payload.theme === "dark")
    && (payload.followSystem === undefined || typeof payload.followSystem === "boolean");
}

function isPetQuickControlsAction(value: unknown): value is PetQuickControlsAction {
  return value === "hideOneHour"
    || value === "turnOff"
    || value === "openDashboard"
    || value === "openSettings"
    || value === "toggleAutomaticClose"
    || value === "automaticClosePause15"
    || value === "automaticClosePause60"
    || value === "automaticClosePauseToday"
    || value === "automaticClosePauseForever"
    || value === "automaticCloseEnable15"
    || value === "automaticCloseEnable60"
    || value === "automaticCloseEnableToday"
    || value === "automaticCloseEnableForever"
    || value === "automaticCloseRestore"
    || value === "automaticCloseExtend60"
    || value === "automaticCloseExtendToday"
    || value === "acknowledgeDismiss";
}

export async function setNativePetQuickControlsVisible(visible: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("pet_quick_controls_set_visible", { visible });
}

type PetQuickControlsHoldEvent = {
  readonly held: boolean;
  readonly generation: number;
};

function isPetQuickControlsHoldEvent(value: unknown): value is PetQuickControlsHoldEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return typeof event.held === "boolean"
    && typeof event.generation === "number"
    && Number.isSafeInteger(event.generation)
    && event.generation > 0;
}

export async function listenToNativePetQuickControlsHold(
  onHold: (held: boolean, generation: number) => void,
): Promise<(() => void) | undefined> {
  if (!isTauriRuntime()) return undefined;
  return listen<unknown>("pet-quick-controls-hold", ({ payload }) => {
    if (isPetQuickControlsHoldEvent(payload)) onHold(payload.held, payload.generation);
  });
}

let quickControlsStateSync = Promise.resolve();

export async function syncNativePetQuickControlsState(
  state: PetQuickControlsStatePayload,
): Promise<void> {
  if (!isTauriRuntime()) return;
  const sync = quickControlsStateSync.then(() => invoke<void>("pet_quick_controls_sync_state", { state }));
  quickControlsStateSync = sync.catch(() => undefined);
  await sync;
}

export async function getNativePetQuickControlsState(): Promise<PetQuickControlsStatePayload | null> {
  if (!isTauriRuntime()) return null;
  const state = await invoke<unknown>("pet_quick_controls_get_state");
  return isPetQuickControlsStatePayload(state) ? state : null;
}

export async function isNativePetQuickControlsCursorInside(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    return await invoke<boolean>("pet_quick_controls_cursor_inside");
  } catch {
    return false;
  }
}

export async function triggerNativePetQuickControlsAction(
  action: PetQuickControlsAction,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("pet_quick_controls_action", { action });
}

export async function setNativePetQuickControlsMenuOpen(open: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("pet_quick_controls_action", {
    action: open ? "menuOpened" : "menuClosed",
  });
}

export async function listenToNativePetQuickControlsAction(
  onAction: (action: PetQuickControlsAction) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<{ action?: unknown }>("pet-quick-controls-action", ({ payload }) => {
    if (isPetQuickControlsAction(payload.action)) onAction(payload.action);
  });
}

export async function listenToNativePetQuickControlsMenuState(
  onOpenChange: (open: boolean) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<{ open?: unknown }>("pet-quick-controls-menu-state", ({ payload }) => {
    onOpenChange(payload?.open === true);
  });
}

export async function listenToNativePetQuickControlsState(
  onState: (state: PetQuickControlsStatePayload) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<unknown>("pet-quick-controls-state", ({ payload }) => {
    if (isPetQuickControlsStatePayload(payload)) onState(payload);
  });
}

export async function finishNativePetFullscreenIntervention(id: string, interrupted: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("pet_mode_finish_fullscreen_intervention", { id, interrupted });
}

export async function completeNativePetFullscreenClose(id: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("pet_mode_complete_fullscreen_close", { id });
}
