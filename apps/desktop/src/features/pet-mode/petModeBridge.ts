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

export type PetModeInputBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
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

// Native travel can legitimately use the full six-second cap before the paw
// reaches its reviewed contact frame. Keep the listener alive through both.
const PET_MODE_CONTACT_TIMEOUT_MS = 8_000;
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
  target: Pick<PetModeInterventionTarget, "browserName" | "labTarget">,
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
  readonly moved: boolean;
  /** Optional while an HMR renderer can still be paired with an older native process. */
  readonly shakeDetected?: boolean;
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
};

export async function beginNativePetDrag(
  startClientX: number,
  startClientY: number,
  pickupDelayMs: number,
): Promise<PetModeNativeDragResult> {
  return invoke<PetModeNativeDragResult>("pet_mode_begin_drag", {
    startClientX,
    startClientY,
    pickupDelayMs,
  });
}

export async function listenToNativePetDragEnd(
  onDragEnd: (result: PetModeNativeDragResult) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<PetModeNativeDragResult>("pet-mode-drag-end", ({ payload }) => onDragEnd(payload));
}

export async function listenToNativePetDragStart(
  onDragStart: () => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<boolean>("pet-mode-drag-start", () => onDragStart());
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

export async function rememberNativePetPosition(): Promise<void> {
  await invoke("pet_mode_remember_position");
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
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("pet_mode_visibility_action", { action });
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
  onProbe: (probe: PetDropPlan | null) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<PetDropPlan | null>("pet-mode-drag-probe", ({ payload }) => onProbe(payload));
}
