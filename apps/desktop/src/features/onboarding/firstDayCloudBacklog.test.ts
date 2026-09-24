// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginFirstDayCloudBacklog,
  clearFirstDayCloudBacklog,
  isFirstDayCloudBacklogActive,
  readFirstDayCloudBacklog,
  releaseFirstDayCloudBacklog,
  resumeFirstDayCloudBacklog,
  updateFirstDayCloudBacklog,
} from "./firstDayCloudBacklog";

const day = "2026-09-24";

function recovery(ownerId: string, overrides: Partial<Parameters<typeof resumeFirstDayCloudBacklog>[0]> = {}) {
  return {
    ownerId,
    importHistory: vi.fn().mockResolvedValue(undefined),
    resolveTargetDay: vi.fn().mockResolvedValue(day),
    runClassification: vi.fn().mockResolvedValue({ status: "empty" }),
    hasRemainingCandidates: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("first-day Cloud backlog", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a small per-account marker and prevents an old pass clearing a newer one", () => {
    const old = beginFirstDayCloudBacklog("alice", day, true)!;
    expect(readFirstDayCloudBacklog("bob")).toBeNull();
    expect(JSON.stringify(old)).not.toContain("history");
    const next = beginFirstDayCloudBacklog("alice", day, false)!;
    expect(clearFirstDayCloudBacklog("alice", old.runId)).toBe(false);
    expect(updateFirstDayCloudBacklog("alice", old.runId, { importPending: false })).toBeNull();
    expect(readFirstDayCloudBacklog("alice")?.runId).toBe(next.runId);
    expect(clearFirstDayCloudBacklog("alice", next.runId)).toBe(true);
  });

  it("resumes an interrupted import before classifying and clears only after the candidate probe", async () => {
    const marker = beginFirstDayCloudBacklog("alice", day, true)!;
    releaseFirstDayCloudBacklog(marker.runId); // simulate a new renderer session
    const steps: string[] = [];
    const options = recovery("alice", {
      importHistory: vi.fn(async () => { steps.push("import"); }),
      runClassification: vi.fn(async () => { steps.push("classify"); return { status: "empty" }; }),
      hasRemainingCandidates: vi.fn(async () => { steps.push("probe"); return false; }),
    });
    expect(await resumeFirstDayCloudBacklog(options)).toBe("completed");
    expect(steps).toEqual(["import", "classify", "probe"]);
    expect(readFirstDayCloudBacklog("alice")).toBeNull();
  });

  it("retains the marker after a failed optional import or a failed classification pass", async () => {
    const marker = beginFirstDayCloudBacklog("alice", day, true)!;
    releaseFirstDayCloudBacklog(marker.runId);
    const options = recovery("alice", {
      importHistory: vi.fn().mockRejectedValue(new Error("browser locked")),
    });
    expect(await resumeFirstDayCloudBacklog(options)).toBe("pending");
    expect(options.runClassification).toHaveBeenCalledOnce();
    expect(readFirstDayCloudBacklog("alice")?.importPending).toBe(true);

    const retry = recovery("alice", { runClassification: vi.fn().mockResolvedValue(null) });
    expect(await resumeFirstDayCloudBacklog(retry)).toBe("pending");
    expect(readFirstDayCloudBacklog("alice")?.importPending).toBe(false);
    expect(await resumeFirstDayCloudBacklog(recovery("alice"))).toBe("completed");
  });

  it("does not overlap the live foreground or background pass", async () => {
    const marker = beginFirstDayCloudBacklog("alice", day, false)!;
    const options = recovery("alice");
    expect(isFirstDayCloudBacklogActive(marker.runId)).toBe(true);
    expect(await resumeFirstDayCloudBacklog(options)).toBe("pending");
    expect(options.runClassification).not.toHaveBeenCalled();
    releaseFirstDayCloudBacklog(marker.runId);
    expect(await resumeFirstDayCloudBacklog(options)).toBe("completed");
  });
});
