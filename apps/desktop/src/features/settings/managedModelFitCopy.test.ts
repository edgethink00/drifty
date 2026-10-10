import { describe, expect, it } from "vitest";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS, type TranslationKey } from "../localization/translations";
import type { ManagedLocalAiModel } from "./managedLocalAiCatalog";
import { MANAGED_LOCAL_AI_FALLBACK_CATALOG } from "./managedLocalAiCatalog";
import {
  formatMemoryGigabytes,
  managedModelInsufficientReason,
  managedModelMemoryGap,
  managedModelMemoryTag,
  memoryTagFromGap,
  smallestModelMemoryGap,
} from "./managedModelFitCopy";

const GIB = 1024 ** 3;

function translator(table: Record<TranslationKey, string>) {
  return (key: TranslationKey, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), table[key]);
}

function catalogFor(machineGb: number): readonly ManagedLocalAiModel[] {
  const minimums = [8, 8, 16, 36];
  return MANAGED_LOCAL_AI_FALLBACK_CATALOG.map((model, index) => ({
    ...model,
    recommended: index === 0,
    fit: machineGb < minimums[index] ? "insufficient" as const : "good" as const,
    minMemoryBytes: minimums[index] * GIB,
    machineMemoryBytes: machineGb * GIB,
  }));
}

describe("managed model memory fit copy", () => {
  it("names the required and installed memory in both languages", () => {
    const smart = catalogFor(8)[3];

    expect(managedModelInsufficientReason(smart, translator(ENGLISH_TRANSLATIONS) as never))
      .toBe("This computer has 8 GB of total memory, and this model needs at least 36 GB.");
    expect(managedModelInsufficientReason(smart, translator(KOREAN_TRANSLATIONS) as never))
      .toBe("이 컴퓨터의 전체 메모리는 8 GB이고, 이 모델은 36 GB 이상이 필요합니다.");
  });

  it("writes one short tag with the least memory the model needs", () => {
    const smart = catalogFor(8)[3];

    expect(managedModelMemoryTag(smart, translator(KOREAN_TRANSLATIONS) as never)).toBe("메모리 부족 · 최소 36 GB 필요");
    expect(managedModelMemoryTag(smart, translator(ENGLISH_TRANSLATIONS) as never)).toBe("Not enough memory · needs 36 GB+");
  });

  it("falls back to the bare state when the requirement is unknown", () => {
    const t = translator(KOREAN_TRANSLATIONS) as never;

    expect(memoryTagFromGap(null, t)).toBe("메모리 부족");
    expect(managedModelMemoryTag({ ...catalogFor(8)[3], minMemoryBytes: null }, t)).toBe("메모리 부족");
  });

  it("reports no gap for a model that fits or has no measurements", () => {
    expect(managedModelMemoryGap(catalogFor(16)[0])).toBeNull();
    expect(managedModelMemoryGap({ ...catalogFor(8)[3], machineMemoryBytes: null })).toBeNull();
    expect(smallestModelMemoryGap(MANAGED_LOCAL_AI_FALLBACK_CATALOG)).toBeNull();
  });

  it("finds the lightest requirement when every model is blocked", () => {
    expect(smallestModelMemoryGap(catalogFor(4))).toEqual({ requiredBytes: 8 * GIB, availableBytes: 4 * GIB });
    expect(smallestModelMemoryGap(catalogFor(8))).toBeNull();
  });

  it("rounds to whole gigabytes", () => {
    expect(formatMemoryGigabytes(16 * GIB)).toBe("16 GB");
    expect(formatMemoryGigabytes(15.6 * GIB)).toBe("16 GB");
  });
});
