import { describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import {
  buildClassificationCorrectionDraft,
  classificationCorrectionScopeForRow,
  persistClassificationCorrection,
  persistUnidentifiedRecordsCorrection,
} from "./classificationCorrection";

const segment: ActivitySegment = {
  id: "selected", platform: "macos", source: "nsworkspace", appName: "Browser", bundleId: "test.browser", startedAt: "2026-09-05T09:00:00", endedAt: "2026-09-05T09:10:00", durationSeconds: 600,
  siteDomain: "example.com", siteUrl: "https://example.com/lesson?utm_source=test", windowTitle: "Lesson",
};
function draft() {
  return buildClassificationCorrectionDraft({ scope: "detail", rowId: "lesson", segment, classificationOptions: {}, displayLabel: "Lesson" })!;
}
describe("classification correction persistence", () => {
  it("saves an exact URL choice without requiring an apply-mode selection", async () => {
    const saveRule = vi.fn(async () => true);
    await persistClassificationCorrection({ ...draft(), category: "learning" }, { saveRule });
    expect(saveRule).toHaveBeenCalledWith(expect.objectContaining({ targetKind: "site", targetValue: "example.com", matchScope: "detail", detailKind: "siteUrl", detailValue: "https://example.com/lesson", category: "learning" }));
  });
  it("saves a broad app choice without narrowing it to a window title", async () => {
    const saveRule = vi.fn(async () => true);
    const appDraft = buildClassificationCorrectionDraft({ scope: "surface", rowId: null, segment: { ...segment, siteDomain: null, siteUrl: null }, classificationOptions: {}, displayLabel: "Browser" })!;
    await persistClassificationCorrection(appDraft, { saveRule });
    expect(saveRule).toHaveBeenCalledWith(expect.objectContaining({ targetKind: "app", targetValue: "test.browser", matchScope: "surface", detailKind: null, detailValue: null }));
  });
  it("propagates failed and rejected rule writes", async () => {
    const saveRule = vi.fn(async () => false);
    expect(await persistClassificationCorrection(draft(), { saveRule })).toBe(false);
    saveRule.mockRejectedValueOnce(new Error("offline"));
    await expect(persistClassificationCorrection(draft(), { saveRule })).rejects.toThrow("offline");
  });
});

describe("corrections for activity we could not identify", () => {
  const untitled: ActivitySegment = {
    id: "untitled-1", platform: "macos", source: "nsworkspace", appName: "ChatGPT", bundleId: "com.openai.chat",
    startedAt: "2026-09-07T10:01:00", endedAt: "2026-09-07T10:01:36", durationSeconds: 36,
  };
  const defaultTitled: ActivitySegment = { ...untitled, id: "untitled-2", windowTitle: "ChatGPT" };

  it("routes a row pencil to a records correction only when the row cannot be named", () => {
    expect(classificationCorrectionScopeForRow("detail", { unidentified: true })).toBe("records");
    expect(classificationCorrectionScopeForRow("detail", { unidentified: false })).toBe("detail");
    expect(classificationCorrectionScopeForRow("detail", null)).toBe("detail");
    expect(classificationCorrectionScopeForRow("surface", { unidentified: true })).toBe("surface");
  });

  it("builds a draft for captures that carry no title, where a detail rule is impossible", () => {
    expect(buildClassificationCorrectionDraft({
      rowId: "row", scope: "detail", segment: untitled, classificationOptions: {}, displayLabel: "ChatGPT",
    })).toBeNull();

    const recordsDraft = buildClassificationCorrectionDraft({
      rowId: "row", scope: "records", segment: untitled, classificationOptions: {}, displayLabel: "ChatGPT",
    });
    expect(recordsDraft).not.toBeNull();
    expect(recordsDraft?.detailKind).toBeNull();
    expect(recordsDraft?.detailValue).toBeNull();
  });

  it("writes one manual record per capture in the row and never a rule", async () => {
    const draft = buildClassificationCorrectionDraft({
      rowId: "row", scope: "records", segment: untitled, classificationOptions: {}, displayLabel: "ChatGPT",
    })!;
    const saveClassifications = vi.fn(async () => ({ saved: 2 }));
    const saved = await persistUnidentifiedRecordsCorrection(
      { ...draft, category: "workspace", productivity: "focus" },
      [untitled, defaultTitled],
      { saveClassifications },
      "2026-09-07T12:00:00.000Z",
    );

    expect(saved).toBe(true);
    expect(saveClassifications).toHaveBeenCalledWith([
      expect.objectContaining({ segmentId: "untitled-1", category: "workspace", productivity: "focus", source: "manual", confidence: 1 }),
      expect.objectContaining({ segmentId: "untitled-2", category: "workspace", productivity: "focus", source: "manual", confidence: 1 }),
    ]);
    await expect(persistClassificationCorrection(draft, { saveRule: vi.fn(async () => true) })).rejects.toThrow(/do not save a rule/);
  });

  it("reports a partial write as a failure instead of claiming the row was corrected", async () => {
    const draft = buildClassificationCorrectionDraft({
      rowId: "row", scope: "records", segment: untitled, classificationOptions: {}, displayLabel: "ChatGPT",
    })!;
    const saveClassifications = vi.fn(async () => ({ saved: 1 }));
    expect(await persistUnidentifiedRecordsCorrection(draft, [untitled, defaultTitled], { saveClassifications })).toBe(false);
  });
});
