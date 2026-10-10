import type { LocalizationController } from "../localization/LocalizationContext";
import type { ManagedLocalAiModel } from "./managedLocalAiCatalog";

type Translate = LocalizationController["t"];

const BYTES_PER_GIB = 1024 * 1024 * 1024;

export type ManagedModelMemoryGap = {
  readonly requiredBytes: number;
  readonly availableBytes: number;
};

/** Whole-gigabyte label for installed or required memory, e.g. "16 GB". */
export function formatMemoryGigabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / BYTES_PER_GIB))} GB`;
}

/**
 * The exact numbers behind an "insufficient" verdict. The verdict compares the
 * model's minimum to the computer's total installed memory, so null means this
 * catalog entry came without those numbers (an older backend or the fallback
 * catalog) and the copy must stay generic.
 */
export function managedModelMemoryGap(model: ManagedLocalAiModel): ManagedModelMemoryGap | null {
  if (model.fit !== "insufficient") return null;
  const requiredBytes = model.minMemoryBytes;
  const availableBytes = model.machineMemoryBytes;
  if (typeof requiredBytes !== "number" || typeof availableBytes !== "number") return null;
  if (requiredBytes <= 0 || availableBytes <= 0) return null;
  return { requiredBytes, availableBytes };
}

/** Why the model cannot run here, in one sentence that names both numbers when known. */
export function managedModelInsufficientReason(model: ManagedLocalAiModel, t: Translate): string {
  const gap = managedModelMemoryGap(model);
  if (!gap) return t("settings.ai.fitInsufficient");
  return t("settings.ai.fitInsufficientMeasured", {
    required: formatMemoryGigabytes(gap.requiredBytes),
    available: formatMemoryGigabytes(gap.availableBytes),
  });
}

/**
 * The one short line shown beside a blocked model: the state and, when the
 * numbers are known, the least memory it needs.
 */
export function memoryTagFromGap(gap: ManagedModelMemoryGap | null, t: Translate): string {
  if (!gap) return t("settings.ai.notEnoughMemory");
  return t("settings.ai.fitTagMin", { required: formatMemoryGigabytes(gap.requiredBytes) });
}

export function managedModelMemoryTag(model: ManagedLocalAiModel, t: Translate): string {
  return memoryTagFromGap(managedModelMemoryGap(model), t);
}

/**
 * When every model is blocked, the lightest one's requirement is the nearest
 * bar this computer could clear; null when the numbers are not available.
 */
export function smallestModelMemoryGap(catalog: readonly ManagedLocalAiModel[]): ManagedModelMemoryGap | null {
  const gaps = catalog.flatMap((model) => {
    const gap = managedModelMemoryGap(model);
    return gap ? [gap] : [];
  });
  if (gaps.length === 0 || gaps.length !== catalog.length) return null;
  return gaps.reduce((best, gap) => (gap.requiredBytes < best.requiredBytes ? gap : best));
}
