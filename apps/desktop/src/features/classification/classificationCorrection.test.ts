import { describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { buildClassificationCorrectionDraft, persistClassificationCorrection } from "./classificationCorrection";

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
