import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("project auto-analysis gating contract", () => {
  it("gates the scheduled pass on having an active project", () => {
    expect(appSource).toContain("const hasActiveProject = projectClassification.projects.some");
    expect(appSource).toContain("if (!projectClassificationFeatureEnabled || !hasActiveProject)");
  });

  it("keeps the scheduler effect reactive to the project-library gate", () => {
    expect(appSource).toContain(
      "}, [hasActiveProject, isPreviewSurface, projectAnalysisConnected, projectClassificationFeatureEnabled, startOfDayMinutes]);",
    );
  });

  it("no longer carries a separate project-analysis consent gate", () => {
    // Project matching sends the same minimized fields to the same configured
    // provider as live AI classification, which has no separate approval step.
    expect(appSource).not.toContain("projectPassConsented");
    expect(appSource).not.toContain("PROJECT_PASS_CONSENT_STORAGE_KEY");
    expect(appSource).not.toContain("ProjectPassConsentModal");
  });

  it("starts matching only after the new project is persisted", () => {
    const saveBody = appSource.split("const handleSaveProject")[1]?.split("}, [analysisModel.analysisConnected")[0] ?? "";
    expect(saveBody).toContain("if (!saved) return false;");
    expect(saveBody.indexOf("if (!saved) return false;")).toBeLessThan(saveBody.indexOf("scheduleProjectAutoAnalysis"));
  });

  it("collects a burst of creations into one debounced pass", () => {
    expect(appSource).toContain("const PROJECT_AUTO_ANALYSIS_DEBOUNCE_MS = 8_000;");
    const scheduleBody = appSource.split("const scheduleProjectAutoAnalysis")[1]?.split("}, [flushQueuedProjectAutoAnalysis])")[0] ?? "";
    // A newer creation must restart the window rather than queue a second run.
    expect(scheduleBody).toContain("window.clearTimeout(queuedAutoAnalysisTimerRef.current)");
    expect(scheduleBody).toContain("PROJECT_AUTO_ANALYSIS_DEBOUNCE_MS");
    expect(scheduleBody).toContain('"queued"');
  });

  it("lets an explicit run skip the debounce window", () => {
    const requestBody = appSource.split("const requestProjectPassRun")[1]?.split("}, [flushQueuedProjectAutoAnalysis")[0] ?? "";
    expect(requestBody).toContain("flushQueuedProjectAutoAnalysis()");
  });

  it("clears a pending debounce timer on unmount", () => {
    expect(appSource).toContain("useEffect(() => () => {\n    if (queuedAutoAnalysisTimerRef.current !== null) window.clearTimeout(queuedAutoAnalysisTimerRef.current);");
  });

  it("does not let the scheduler reset the on-open guard while a burst is still queued", () => {
    // Emptying the library resets the one-shot guard so a first project re-ticks
    // on open. That reset must not fire while creation-triggered work is still
    // collecting, or the scheduler runs the same window a second time.
    const resetLine = appSource.split("projectPassOpenTickedRef.current = false")[0] ?? "";
    const guardedReset = resetLine.slice(-400);
    expect(guardedReset).toContain("queuedAutoAnalysisTimerRef.current === null");
  });
});
