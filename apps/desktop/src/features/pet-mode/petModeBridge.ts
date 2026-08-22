import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../companion/watcherBridge";
import type {
  PetModeContactAlignment,
  PetModeInterventionTarget,
  PetModeLabState,
  PetModePreviewAction,
  PetModeResolvedTarget,
  PetModeSnapshot,
  PetModeWindowEvent,
} from "./petModeData";

type UnlistenFn = () => void;

type PetModeContactEvent = {
  readonly id: string;
  readonly contacted?: boolean;
};

type PetModePointerEvent = {
  readonly at: number;
};

type PetModeAlignmentEvent = PetModeContactAlignment;

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
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const sync = petModeEnabledSync.then(() => invoke("pet_mode_set_enabled", {
    enabled,
    snapshot,
    reducedMotion,
    width,
    height,
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

export async function playNativePetModeIntervention(
  target: PetModeInterventionTarget,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId = 0;
    let unlisten: UnlistenFn | null = null;

    const finish = (contacted: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unlisten?.();
      resolve(contacted);
    };

    timeoutId = window.setTimeout(() => finish(false), PET_MODE_CONTACT_TIMEOUT_MS);
    void listen<PetModeContactEvent>("pet-mode-contact", ({ payload }) => {
      if (payload.id === target.id) finish(payload.contacted !== false);
    }).then((nextUnlisten) => {
      if (settled) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
      return invoke("pet_mode_intervene", { target });
    }).catch(() => finish(false));
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

export async function cancelNativePetMotion(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("pet_mode_cancel_motion");
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

export async function reportNativePetContact(id: string, contacted = true): Promise<void> {
  await invoke("pet_mode_report_contact", { id, contacted });
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

export async function setNativePetPresence(visible: boolean): Promise<void> {
  await invoke("pet_mode_set_presence", { visible });
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

export async function roamNativePet(): Promise<void> {
  await invoke("pet_mode_roam");
}

export async function exitNativePetScreen(): Promise<"left" | "right"> {
  return invoke<"left" | "right">("pet_mode_exit_screen");
}

export async function returnNativePetFromOuting(side: "left" | "right"): Promise<void> {
  await invoke("pet_mode_return_from_outing", { side });
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

export async function resolveNativePetDrop(): Promise<PetDropPlan | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<PetDropPlan>("pet_mode_resolve_drop");
  } catch (error) {
    console.error("[pet-drop] invoke failed:", error);
    return null;
  }
}

export async function setNativePetModeGuides(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await emit("pet-mode-event", { kind: "guides", enabled });
}

export async function listenToNativePetDragProbe(
  onProbe: (probe: PetDropPlan | null) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<PetDropPlan | null>("pet-mode-drag-probe", ({ payload }) => onProbe(payload));
}
