import type { ActivitySegment, ProductivityLabel } from "@drifty/domain";
import type { WatcherSnapshot } from "../companion/watcherData";

// The pet shipped as a Dev preview, so its settings lived under `drifty.dev.*`.
// Now that it is a production feature the keys drop that prefix, and the old
// ones are still read once so an existing preview user keeps their pet and
// their chosen coat instead of silently reverting to the defaults.
export const PET_MODE_STORAGE_KEY = "drifty.pet.enabled";
export const PET_MODE_COAT_STORAGE_KEY = "drifty.pet.coat";
export const PET_MODE_LEGACY_STORAGE_KEY = "drifty.dev.petMode";
export const PET_MODE_LEGACY_COAT_STORAGE_KEY = "drifty.dev.petModeCoat";
export const PET_MODE_PRESENCE_RATIO = 0.6;
export const PET_MODE_PRESENT_MS = 9 * 60 * 1000;
export const PET_MODE_AWAY_MS = 6 * 60 * 1000;
export const PET_MODE_LIFE_ACTION_INTERVAL_MS = 12 * 60 * 1000;
export const PET_MODE_WALK_SPEED = 20.8;
export const PET_MODE_WALK_STRIDE = 26;
export const PET_MODE_RUN_SPEED = 300;
export const PET_MODE_RUN_STRIDE = 72;
export const PET_MODE_GAIT_CADENCE = 0.9;
export const PET_MODE_GAIT_FRAME_COUNT = 30;
// The native panel starts mostly outside the display edge and uses the same
// 420ms protocol duration to walk inward. This value times the matching gait
// and renderer fallback.
export const PET_MODE_ENTRY_DURATION_MS = 420;
// One complete upper-lid pass: close, a very short contact, then reopen.
// Keeping the phase and CSS animation on one shared duration prevents the
// overlay from being removed before the opening frame has finished.
export const PET_MODE_BLINK_DURATION_MS = 228;
export const PET_MODE_BLINK_INTERVAL_MIN_MS = 4_420;
export const PET_MODE_BLINK_INTERVAL_MAX_MS = 7_280;
export type PetModeDragTransitionFrame = {
  readonly pose: "idle" | "held";
  readonly y: number;
  readonly opacity: number;
  readonly durationMs: number;
};

// Approved V10.1 drag hand-off. These are deliberately discrete reviewed
// frames rather than a CSS morph: the generated held pose must retain its
// contour while the native window changes ownership to and from AppKit.
export const PET_MODE_DRAG_PICKUP_TIMELINE: readonly PetModeDragTransitionFrame[] = [
  { pose: "idle", y: 0, opacity: 1, durationMs: 0 },
  { pose: "idle", y: -1, opacity: .99, durationMs: 18 },
  { pose: "idle", y: -2, opacity: .97, durationMs: 18 },
  { pose: "held", y: -3, opacity: .92, durationMs: 16 },
  { pose: "held", y: -4, opacity: .95, durationMs: 18 },
  { pose: "held", y: -4, opacity: .98, durationMs: 18 },
  { pose: "held", y: -4, opacity: 1, durationMs: 18 },
  { pose: "held", y: -4, opacity: 1, durationMs: 20 },
  { pose: "held", y: -4, opacity: 1, durationMs: 22 },
] as const;

export const PET_MODE_DRAG_RELEASE_TIMELINE: readonly PetModeDragTransitionFrame[] = [
  { pose: "held", y: -4, opacity: 1, durationMs: 0 },
  { pose: "held", y: -3, opacity: .99, durationMs: 16 },
  { pose: "held", y: -2, opacity: .97, durationMs: 16 },
  { pose: "held", y: -1, opacity: .72, durationMs: 18 },
  { pose: "idle", y: 0, opacity: .55, durationMs: 18 },
  { pose: "idle", y: 0, opacity: .82, durationMs: 18 },
  { pose: "idle", y: 0, opacity: .96, durationMs: 20 },
  { pose: "idle", y: 0, opacity: 1, durationMs: 22 },
  { pose: "idle", y: 0, opacity: 1, durationMs: 28 },
] as const;

export const PET_MODE_DRAG_PICKUP_MS = PET_MODE_DRAG_PICKUP_TIMELINE.reduce(
  (total, frame) => total + frame.durationMs,
  0,
);
export const PET_MODE_DRAG_SETTLE_MS = PET_MODE_DRAG_RELEASE_TIMELINE.reduce(
  (total, frame) => total + frame.durationMs,
  0,
);
// Tail and stretch use cleaned frames from selected Google Flow Omni Flash
// takes. Every active take starts and ends on the exact approved idle bitmap,
// preventing a full-silhouette snap at either hand-off.
export const PET_MODE_LIFE_MOTION_FPS = 12;
export const PET_MODE_LIFE_MOTION_FRAME_COUNT = 37;
export const PET_MODE_LIFE_MOTION_DURATION_MS = PET_MODE_LIFE_MOTION_FRAME_COUNT * 1000 / PET_MODE_LIFE_MOTION_FPS;
export const PET_MODE_TAIL_FLICK_DURATION_MS = PET_MODE_LIFE_MOTION_DURATION_MS;
// Locked to the approved prototype's F12 v1.6 action. The cat reaches on
// source frames 0…14, contacts on 14, then returns over the same clean arc.
// Keep this as data rather than a CSS tween so every rendered pose remains a
// reviewed source frame.
export const PET_MODE_PAW_FPS = 24;
export const PET_MODE_PAW_CONTACT_FRAME = 14;
export const PET_MODE_PAW_TIMELINE = [
  ...Array.from({ length: PET_MODE_PAW_CONTACT_FRAME + 1 }, (_, frame) => ({ frame, durationUnits: 1 })),
  ...Array.from({ length: PET_MODE_PAW_CONTACT_FRAME }, (_, offset) => ({
    frame: PET_MODE_PAW_CONTACT_FRAME - 1 - offset,
    durationUnits: 0.75,
  })),
] as const;

export type PetModeMotionKind = "entry" | "walk" | "run";

export type PetModePreviewAction =
  | "stop"
  | "life_loop"
  | "walk"
  | "blink"
  | "stretch"
  | "tail_flick"
  | "sleep"
  | "wake"
  | "pet"
  | "outing";

export type PetModeLabAction = PetModePreviewAction | "intervention";

export type PetModeLabState = {
  readonly phase: string;
  readonly activeAction: PetModeLabAction | null;
  readonly lifeLoopEnabled: boolean;
};

export type PetModeSnapshot = {
  readonly productivity: ProductivityLabel;
  readonly contextLabel: string;
  readonly durationSeconds: number;
};

export type PetModeInterventionTarget = {
  readonly id: string;
  readonly appName: string;
  readonly browserName: string | null;
  readonly preview: boolean;
  readonly labTarget?: "browser_tab_x" | "drifty_window_x" | null;
};

export type PetModeWindowEvent =
  | { readonly kind: "snapshot"; readonly snapshot: PetModeSnapshot }
  | { readonly kind: "facing"; readonly facing: "left" | "right" }
  | { readonly kind: "motion"; readonly motion: PetModeMotionKind }
  | { readonly kind: "entry_complete" }
  | { readonly kind: "preview_action"; readonly action: PetModePreviewAction }
  | { readonly kind: "intervention"; readonly target: PetModeInterventionTarget };

export type PetModeResolvedTarget = {
  readonly facing: "left" | "right";
  readonly targetKind: "browser_tab_close" | "window_close" | "fallback";
  readonly confidence: "high" | "medium" | "low";
  readonly diagnostic: string;
  readonly targetX: number;
  readonly targetY: number;
};

export type PetModeContactAlignment = {
  readonly targetX: number;
  readonly targetY: number;
  readonly contactX: number;
  readonly contactY: number;
  readonly errorX: number;
  readonly errorY: number;
  readonly errorDistance: number;
  readonly attempts: number;
  readonly diagnostic: string;
};

export function getPetModeGaitFramesPerSecond(motion: PetModeMotionKind): number {
  if (motion === "entry") {
    return PET_MODE_GAIT_FRAME_COUNT * 1000 / PET_MODE_ENTRY_DURATION_MS;
  }
  const speed = motion === "run" ? PET_MODE_RUN_SPEED : PET_MODE_WALK_SPEED;
  const stride = motion === "run" ? PET_MODE_RUN_STRIDE : PET_MODE_WALK_STRIDE;
  return PET_MODE_GAIT_FRAME_COUNT * speed * PET_MODE_GAIT_CADENCE / stride;
}

export function getPetModeLifeActionInterval(productivity: ProductivityLabel | null): number {
  // B3 stays intentionally subtle: focused work only makes autonomous actions
  // rarer. It never changes the pet's mood or creates a reward/punishment loop.
  return productivity === "focus"
    ? PET_MODE_LIFE_ACTION_INTERVAL_MS * 1.65
    : PET_MODE_LIFE_ACTION_INTERVAL_MS;
}

export function resolveInitialPetModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(PET_MODE_STORAGE_KEY);
  if (stored !== null) return stored === "1";
  return window.localStorage.getItem(PET_MODE_LEGACY_STORAGE_KEY) === "1";
}

// The prototype shipped the cat as a themed pair: its light theme used a
// charcoal coat with ivory facial detail, and its dark theme inverted both.
// The native pet lost that pairing when the silhouette moved to baked
// rasters, so the coat is an explicit user choice here instead of a theme
// side effect. `ivory` keeps the exact colors the current pet already ships.
export const PET_MODE_COATS = ["ivory", "charcoal", "grey", "apricot", "sage", "plum"] as const;
export type PetModeCoat = (typeof PET_MODE_COATS)[number];
export const PET_MODE_DEFAULT_COAT: PetModeCoat = "ivory";

export function isPetModeCoat(value: unknown): value is PetModeCoat {
  return typeof value === "string" && (PET_MODE_COATS as readonly string[]).includes(value);
}

// One definition per coat, shared by the pet window and the Settings picker.
// `fur` is the same value the CSS token carries, so the swatch always shows
// the color the pet will actually be instead of a hand-maintained copy.
export type PetModeCoatSpec = {
  readonly value: PetModeCoat;
  readonly fur: string;
  readonly ink: string;
};

export const PET_MODE_COAT_SPECS: readonly PetModeCoatSpec[] = [
  {
    value: "ivory",
    fur: "#e8e5da",
    ink: "#171916",
  },
  {
    value: "charcoal",
    fur: "#33332f",
    ink: "#f2f1ed",
  },
  {
    value: "grey",
    fur: "#a3a199",
    ink: "#1a1b18",
  },
  {
    value: "apricot",
    fur: "#d9b18c",
    ink: "#3c2b1c",
  },
  {
    value: "sage",
    fur: "#93a88e",
    ink: "#1c241a",
  },
  {
    value: "plum",
    fur: "#7a5f6b",
    ink: "#efe6ea",
  },
];

export function getPetModeCoatSpec(coat: PetModeCoat): PetModeCoatSpec {
  return PET_MODE_COAT_SPECS.find((spec) => spec.value === coat) ?? PET_MODE_COAT_SPECS[0];
}

// The pet's approved geometry is 144x99 with the cat drawn at 121.2x92.4
// inside it. Size is expressed as a percentage of that reviewed layout so the
// cat, its hit target, and the native panel all scale by one factor instead of
// each carrying its own numbers.
export const PET_MODE_BASE_WIDTH = 144;
export const PET_MODE_BASE_HEIGHT = 99;
export const PET_MODE_SIZES = [50, 75, 100, 125] as const;
export type PetModeSize = (typeof PET_MODE_SIZES)[number];
export const PET_MODE_DEFAULT_SIZE: PetModeSize = 100;
export const PET_MODE_SIZE_STORAGE_KEY = "drifty.pet.size";

export function isPetModeSize(value: unknown): value is PetModeSize {
  return typeof value === "number" && (PET_MODE_SIZES as readonly number[]).includes(value);
}

export function resolveInitialPetModeSize(): PetModeSize {
  if (typeof window === "undefined") return PET_MODE_DEFAULT_SIZE;
  const stored = Number(window.localStorage.getItem(PET_MODE_SIZE_STORAGE_KEY));
  return isPetModeSize(stored) ? stored : PET_MODE_DEFAULT_SIZE;
}

export function getPetModeWindowSize(size: PetModeSize): { readonly width: number; readonly height: number } {
  // Rounded to whole points: the native panel cannot occupy a fraction of a
  // pixel, and letting the window round independently of the CSS scale would
  // clip the cat's outline at some sizes.
  return {
    width: Math.round(PET_MODE_BASE_WIDTH * size / 100),
    height: Math.round(PET_MODE_BASE_HEIGHT * size / 100),
  };
}

export function resolveInitialPetModeCoat(): PetModeCoat {
  if (typeof window === "undefined") return PET_MODE_DEFAULT_COAT;
  const stored = window.localStorage.getItem(PET_MODE_COAT_STORAGE_KEY);
  if (isPetModeCoat(stored)) return stored;
  const legacy = window.localStorage.getItem(PET_MODE_LEGACY_COAT_STORAGE_KEY);
  return isPetModeCoat(legacy) ? legacy : PET_MODE_DEFAULT_COAT;
}

export function buildPetModeSnapshot(snapshot: WatcherSnapshot): PetModeSnapshot {
  return {
    productivity: snapshot.productivity,
    contextLabel: snapshot.contextLabel,
    durationSeconds: snapshot.durationSeconds,
  };
}

export function buildPetModeInterventionTarget(input: {
  readonly id: string;
  readonly appName: string;
  readonly browserName?: string | null;
  readonly preview?: boolean;
  readonly labTarget?: "browser_tab_x" | "drifty_window_x" | null;
}): PetModeInterventionTarget {
  return {
    id: input.id,
    appName: input.appName.trim() || "Unknown app",
    browserName: input.browserName?.trim() || null,
    preview: input.preview ?? false,
    labTarget: input.labTarget ?? null,
  };
}

type PetModePreviewSegment = Pick<
  ActivitySegment,
  "id" | "endedAt" | "appName" | "browserName" | "deviceId" | "source"
>;

export function buildPetModePreviewInterventionTarget(
  segments: readonly PetModePreviewSegment[],
): PetModeInterventionTarget | null {
  let latestBrowser: PetModePreviewSegment | null = null;
  let latestEndedAt = Number.NEGATIVE_INFINITY;

  for (const segment of segments) {
    if (segment.deviceId) continue;
    if (segment.source === "browser-history-import") continue;
    if (!segment.browserName?.trim()) continue;
    if (segment.appName.trim().toLowerCase().includes("drifty")) continue;

    const endedAt = Date.parse(segment.endedAt);
    if (!Number.isFinite(endedAt) || endedAt <= latestEndedAt) continue;
    latestBrowser = segment;
    latestEndedAt = endedAt;
  }

  if (!latestBrowser) return null;
  return buildPetModeInterventionTarget({
    id: `pet-preview:${latestBrowser.id}:${Date.now()}`,
    appName: latestBrowser.appName,
    browserName: latestBrowser.browserName,
    preview: true,
  });
}

/**
 * Dev settings bring Drifty to the foreground, so the Lab deliberately uses
 * the last locally observed browser as the target it can return to and test.
 */
export function buildPetModeLabBrowserTabTarget(
  segments: readonly PetModePreviewSegment[],
): PetModeInterventionTarget | null {
  let latestBrowser: PetModePreviewSegment | null = null;
  let latestEndedAt = Number.NEGATIVE_INFINITY;

  for (const segment of segments) {
    if (segment.deviceId) continue;
    if (segment.source === "browser-history-import") continue;
    if (!segment.browserName?.trim()) continue;
    if (segment.appName.trim().toLowerCase().includes("drifty")) continue;

    const endedAt = Date.parse(segment.endedAt);
    if (!Number.isFinite(endedAt) || endedAt <= latestEndedAt) continue;
    latestBrowser = segment;
    latestEndedAt = endedAt;
  }

  if (!latestBrowser) return null;
  return buildPetModeInterventionTarget({
    id: `pet-lab-browser-x:${latestBrowser.id}:${Date.now()}`,
    appName: latestBrowser.appName,
    browserName: latestBrowser.browserName,
    labTarget: "browser_tab_x",
  });
}

export function buildPetModeLabDriftyWindowTarget(): PetModeInterventionTarget {
  return buildPetModeInterventionTarget({
    id: `pet-lab-drifty-x:${Date.now()}`,
    appName: "Drifty",
    labTarget: "drifty_window_x",
  });
}
