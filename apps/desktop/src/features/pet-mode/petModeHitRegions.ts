import { updateNativePetHitRegion } from "./petModeBridge";
import {
  PET_MODE_PAW_ARRIVAL_OFFSET_X_PX,
  PET_MODE_PAW_GROUND_OFFSET_Y_PX,
} from "./petModeData";

export const PET_MODE_HIT_REGION_VERSION = 1;
const generationClock = globalThis as typeof globalThis & {
  __driftyPetHitRegionGeneration?: { readonly millisecond: number; readonly sequence: number };
};
const now = Date.now();
const storageKey = "drifty.pet_mode.hit_region_generation";
const hitRegionSessionStorage = (() => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
})();
const storedGeneration = (() => {
  try {
    return hitRegionSessionStorage?.getItem(storageKey) ?? null;
  } catch {
    return null;
  }
})();
const storedMatch = storedGeneration?.match(/^(\d{13})-(\d{6})$/);
const storedClock = storedMatch
  ? { millisecond: Number(storedMatch[1]), sequence: Number(storedMatch[2]) }
  : undefined;
const previousGeneration = generationClock.__driftyPetHitRegionGeneration ?? storedClock;
const generationMillisecond = Math.max(now, previousGeneration?.millisecond ?? now);
const generationSequence = previousGeneration && previousGeneration.millisecond >= now
  ? previousGeneration.sequence + 1
  : 0;
generationClock.__driftyPetHitRegionGeneration = {
  millisecond: generationMillisecond,
  sequence: generationSequence,
};
// Fixed-width decimal fields are intentionally lexicographically ordered.
// Native can therefore reject a delayed request from an older renderer even
// after a reload reset the React revision counter.
const PET_MODE_HIT_REGION_GENERATION = `${String(generationMillisecond).padStart(13, "0")}-${String(generationSequence).padStart(6, "0")}`;
try {
  hitRegionSessionStorage?.setItem(storageKey, PET_MODE_HIT_REGION_GENERATION);
} catch {
  // Sandboxed or privacy-restricted WebViews may deny storage. The in-memory
  // clock still preserves ordering for the current renderer lifetime.
}
let nextRevision = 0;

type PetModeHitRegionArtifact = {
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly subpixelResolution: number;
  readonly alphaThreshold: number;
  readonly tolerancePx: number;
  readonly mirrorResamplingToleranceXPx: number;
  readonly regions: Readonly<Record<string, readonly number[]>>;
};

let artifactPromise: Promise<PetModeHitRegionArtifact> | null = null;

function translateHitRegionSpans(
  spans: readonly number[],
  sweepOffsetX: number,
  offsetY: number,
  width: number,
  height: number,
): readonly number[] {
  const rows = new Map<number, Array<[number, number]>>();
  for (let index = 0; index < spans.length; index += 3) {
    const y = spans[index];
    const start = spans[index + 1];
    const end = spans[index + 2];
    const shiftedY = y + offsetY;
    if (shiftedY < 0 || shiftedY >= height) continue;
    const intervals = rows.get(shiftedY) ?? [];
    intervals.push([
      Math.max(0, Math.min(start, start + sweepOffsetX)),
      Math.min(width, Math.max(end, end + sweepOffsetX)),
    ]);
    rows.set(shiftedY, intervals);
  }

  const expanded: number[] = [];
  for (const [y, intervals] of [...rows.entries()].sort(([a], [b]) => a - b)) {
    intervals.sort(([a], [b]) => a - b);
    let [mergedStart, mergedEnd] = intervals[0];
    for (const [start, end] of intervals.slice(1)) {
      if (start <= mergedEnd) {
        mergedEnd = Math.max(mergedEnd, end);
      } else {
        expanded.push(y, mergedStart, mergedEnd);
        [mergedStart, mergedEnd] = [start, end];
      }
    }
    expanded.push(y, mergedStart, mergedEnd);
  }
  return expanded;
}

function resolveHitRegionSpans(
  artifact: PetModeHitRegionArtifact,
  regionId: string,
): readonly number[] | undefined {
  const pawArrival = regionId.match(/^paw-arrival:(\d+)$/);
  const pawGrounded = regionId.match(/^paw-grounded:(\d+)$/);
  const pawFrame = pawArrival?.[1] ?? pawGrounded?.[1];
  if (pawFrame === undefined) return artifact.regions[regionId];
  const spans = artifact.regions[`paw:${Number(pawFrame)}`];
  if (!spans) return undefined;
  return translateHitRegionSpans(
    spans,
    pawArrival ? PET_MODE_PAW_ARRIVAL_OFFSET_X_PX * artifact.subpixelResolution : 0,
    PET_MODE_PAW_GROUND_OFFSET_Y_PX * artifact.subpixelResolution,
    artifact.width,
    artifact.height,
  );
}

function loadArtifact(): Promise<PetModeHitRegionArtifact> {
  artifactPromise ??= fetch(`/pet-mode/hit-regions-v${PET_MODE_HIT_REGION_VERSION}.json`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Pet Mode hit regions failed to load (${response.status})`);
      const artifact = await response.json() as PetModeHitRegionArtifact;
      if (
        artifact.version !== PET_MODE_HIT_REGION_VERSION
        || artifact.logicalWidth !== 144
        || artifact.logicalHeight !== 99
        || artifact.subpixelResolution !== 2
        || artifact.width !== 288
        || artifact.height !== 198
        || artifact.mirrorResamplingToleranceXPx !== 2
      ) {
        throw new Error("Pet Mode hit-region artifact is incompatible");
      }
      return artifact;
    })
    .catch((error) => {
      // A startup/HMR fetch can fail transiently. Keep that attempt fail-closed,
      // but let the next committed frame retry instead of caching a permanent
      // ungrabbable pet for the renderer lifetime.
      artifactPromise = null;
      throw error;
    });
  return artifactPromise;
}

export async function preloadPetModeHitRegions(): Promise<void> {
  await loadArtifact();
}

// Native bounds its refresh at two seconds. Give that response a margin, but
// do not leave the renderer waiting forever if WebView loses the IPC response.
export const PET_MODE_HIT_REGION_ACK_TIMEOUT_MS = 2500;

async function awaitHitRegionAcknowledgement(operation: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Pet Mode hit-region acknowledgement timed out")), PET_MODE_HIT_REGION_ACK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function stagePetModeHitRegionTransition(request: {
  readonly regionId: string;
  readonly mirrored: boolean;
}): Promise<void> {
  // Reserve both revisions before the first await. If a newer transition is
  // started while this acknowledgement is pending, native will reject this
  // operation's delayed retry instead of letting stale fail-closed state erase
  // the newer committed region.
  const firstRevision = ++nextRevision;
  const retryRevision = ++nextRevision;
  const publishEmptyRegion = (revision: number) => updateNativePetHitRegion({
    version: PET_MODE_HIT_REGION_VERSION,
    generation: PET_MODE_HIT_REGION_GENERATION,
    regionId: request.regionId,
    revision,
    mirrored: request.mirrored,
    spans: [],
  });
  try {
    await awaitHitRegionAcknowledgement(publishEmptyRegion(firstRevision));
  } catch {
    // The first update may have reached native even when its acknowledgement
    // was lost. Retry with a newer revision so both sides converge on the same
    // fail-closed transition before the renderer is allowed to change frames.
    await awaitHitRegionAcknowledgement(publishEmptyRegion(retryRevision));
  }
}

export async function publishPetModeHitRegion(request: {
  readonly regionId: string;
  readonly mirrored: boolean;
  readonly interactive: boolean;
}): Promise<void> {
  // As with transition staging, reserve the failure revision up front so a
  // stale request cannot later allocate a revision newer than its successor.
  const revision = ++nextRevision;
  const failClosedRevision = ++nextRevision;
  try {
    if (!request.interactive) {
      await updateNativePetHitRegion({
        version: PET_MODE_HIT_REGION_VERSION,
        generation: PET_MODE_HIT_REGION_GENERATION,
        regionId: request.regionId,
        revision,
        mirrored: request.mirrored,
        spans: [],
      });
      return;
    }
    const artifact = await loadArtifact();
    const spans = resolveHitRegionSpans(artifact, request.regionId);
    if (!spans) throw new Error(`Unknown Pet Mode hit region: ${request.regionId}`);
    await updateNativePetHitRegion({
      version: artifact.version,
      generation: PET_MODE_HIT_REGION_GENERATION,
      regionId: request.regionId,
      revision,
      mirrored: request.mirrored,
      spans,
    });
  } catch {
    // A newer fail-closed revision covers both load failures and the case where
    // native accepted the intended region but its refresh acknowledgement was
    // lost. Never leave uncertain state interactive.
    await updateNativePetHitRegion({
      version: PET_MODE_HIT_REGION_VERSION,
      generation: PET_MODE_HIT_REGION_GENERATION,
      regionId: request.regionId,
      revision: failClosedRevision,
      mirrored: request.mirrored,
      spans: [],
    }).catch(() => undefined);
  }
}
