import { describe, expect, it, vi } from "vitest";
import { buildProjectPassSegmentUnits, type ProjectPassPromptInput } from "@drifty/domain";
import { parseLocalProjectVerdict, recoverLocalProjectNames } from "./localProjectNameRecovery";

const windows = buildProjectPassSegmentUnits([
  { id: "s1", startedAt: "2026-11-15T10:00:00Z", endedAt: "2026-11-15T10:02:00Z", durationSeconds: 120, appName: "Calculator", platform: "macos", source: "accessibility" },
  { id: "s2", startedAt: "2026-11-15T10:03:00Z", endedAt: "2026-11-15T10:05:00Z", durationSeconds: 120, appName: "System Settings", platform: "macos", source: "accessibility" },
]);
const input: ProjectPassPromptInput = { beforeContextWindows: [], coreWindows: windows, afterContextWindows: [], workProfile: null,
  projects: [{ id: "p-real", name: "calculator practice", description: "arithmetic exercises", anchors: [] }] };
const output = { assignments: windows.map((w) => ({ id: w.id, projectId: "calculator practice", confidence: 0.9, reason: "invented detail" })), corrections: [] };

describe("local project name recovery", () => {
  it("accepts only independently confirmed exact project names and preserves the core ids", async () => {
    const verify = vi.fn().mockResolvedValueOnce({ answer: "YES", confidence: 0.95 }).mockResolvedValueOnce({ answer: "NO", confidence: 0.95 });
    const result = await recoverLocalProjectNames(output, input, verify);
    expect(result?.assignments).toEqual([
      { id: windows[0].id, projectId: "p-real", confidence: 0.9, reason: undefined },
      { id: windows[1].id, projectId: null, confidence: 0.9, reason: undefined },
    ]);
    expect(verify.mock.calls[0][0]).toContain("Calculator");
    expect(verify.mock.calls[1][0]).toContain("System Settings");
  });
  it("rejects low-confidence, invalid, and ambiguous decisions instead of saving them", async () => {
    expect(await recoverLocalProjectNames(output, input, async () => ({ answer: "NO", confidence: 0.1 }))).toBeNull();
    expect(await recoverLocalProjectNames(output, input, async () => null)).toBeNull();
    expect(await recoverLocalProjectNames(output, { ...input, projects: [...input.projects, { ...input.projects[0], id: "p-other" }] }, async () => ({ answer: "YES", confidence: 1 }))).toBeNull();
    expect(await recoverLocalProjectNames({ ...output, assignments: [{ ...output.assignments[0], projectId: "other" }] }, input, async () => ({ answer: "YES", confidence: 1 }))).toBeNull();
  });
  it("does not accept duplicates or invented windows", async () => {
    const verify = async () => ({ answer: "YES" as const, confidence: 1 });
    expect(await recoverLocalProjectNames({ ...output, assignments: [output.assignments[0], output.assignments[0]] }, input, verify)).toBeNull();
    expect(await recoverLocalProjectNames({ ...output, assignments: [...output.assignments, { id: "invented", projectId: null, confidence: 1 }] }, input, verify)).toBeNull();
  });
  it("handles more than twelve assigned windows without discarding the batch", async () => {
    const many = Array.from({ length: 13 }, (_, index) => ({ ...windows[0], id: `window-${index}` }));
    const verify = vi.fn().mockResolvedValue({ answer: "YES", confidence: 0.95 });
    const result = await recoverLocalProjectNames({ assignments: many.map((window) => ({ id: window.id, projectId: "p-real", confidence: 0.9 })), corrections: [] }, { ...input, coreWindows: many }, verify);
    expect(result?.assignments).toHaveLength(13);
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it("rechecks a null result when exactly one manual anchor matches", async () => {
    const anchored = { ...input, projects: [{ ...input.projects[0], anchors: [{ kind: "app" as const, value: "Calculator", source: "manual" as const }] }] };
    const missed = { assignments: windows.map(w => ({ id: w.id, projectId: null, confidence: 0.9 })), corrections: [] };
    const verify = vi.fn().mockResolvedValue({ answer: "YES", confidence: 0.95 });
    const result = await recoverLocalProjectNames(missed, anchored, verify);
    expect(result?.assignments.map(a => a.projectId)).toEqual(["p-real", null]);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0][0]).toContain("app=Calculator");
  });
  it("does not guess when an anchor is shared or was harvested", async () => {
    const anchor = { kind: "app" as const, value: "Calculator", source: "manual" as const };
    const missed = { assignments: windows.map(w => ({ id: w.id, projectId: null, confidence: 0.9 })), corrections: [] };
    const project = { ...input.projects[0], anchors: [anchor] };
    const verify = vi.fn();
    const shared = await recoverLocalProjectNames(missed, { ...input, projects: [project, { ...project, id: "other" }] }, verify);
    expect(shared?.assignments.every(a => a.projectId === null)).toBe(true);
    const harvested = await recoverLocalProjectNames(missed, { ...input, projects: [{ ...project, anchors: [{ ...anchor, source: "harvested" }] }] }, verify);
    expect(harvested?.assignments.every(a => a.projectId === null)).toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });
  it("uses only titles allowed in the analysis input when matching a keyword", async () => {
    const segment = { id: "s1", startedAt: "2026-11-15T10:00:00Z", endedAt: "2026-11-15T10:02:00Z", durationSeconds: 120, appName: "TextEdit", windowTitle: "파랑 출시 기획", platform: "macos" as const, source: "accessibility" as const };
    const projects = [{ ...input.projects[0], anchors: [{ kind: "keyword" as const, value: "파랑", source: "manual" as const }] }];
    const allowed = buildProjectPassSegmentUnits([segment], { contextPolicy: { windowTitle: true, contentContext: false, siteUrl: false } });
    const hidden = buildProjectPassSegmentUnits([segment], { contextPolicy: { windowTitle: false, contentContext: false, siteUrl: false } });
    const verify = vi.fn().mockResolvedValue({ answer: "YES", confidence: 0.95 });
    const classify = (coreWindows: typeof allowed) => recoverLocalProjectNames({ assignments: [{ id: coreWindows[0].id, projectId: null, confidence: 0.9 }], corrections: [] }, { ...input, projects, coreWindows }, verify);
    expect((await classify(allowed))?.assignments[0].projectId).toBe("p-real");
    expect((await classify(hidden))?.assignments[0].projectId).toBeNull();
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it("rechecks an exact project name in a title without treating it as proof", async () => {
    const segment = { id: "s1", startedAt: "2026-11-15T10:00:00Z", endedAt: "2026-11-15T10:02:00Z", durationSeconds: 120, appName: "TextEdit", windowTitle: "Bluebird launch copy", platform: "macos" as const, source: "accessibility" as const };
    const coreWindows = buildProjectPassSegmentUnits([segment], { contextPolicy: { windowTitle: true, contentContext: false, siteUrl: false } });
    const projects = [{ id: "p1", name: "Bluebird", description: "prepare product launch", anchors: [] }];
    const missed = { assignments: [{ id: coreWindows[0].id, projectId: null, confidence: 0.9 }], corrections: [] };
    const yes = await recoverLocalProjectNames(missed, { ...input, projects, coreWindows }, async () => ({ answer: "YES", confidence: 0.95 }));
    const no = await recoverLocalProjectNames(missed, { ...input, projects, coreWindows }, async () => ({ answer: "NO", confidence: 0.95 }));
    expect(yes?.assignments[0].projectId).toBe("p1");
    expect(no?.assignments[0].projectId).toBeNull();
  });
  it("accepts well-formed verdicts only", () => {
    expect(parseLocalProjectVerdict('<think></think>{"answer":"NO","confidence":0.95}')).toEqual({ answer: "NO", confidence: 0.95 });
    expect(parseLocalProjectVerdict('{"answer":"yes","confidence":1}')).toBeNull();
    expect(parseLocalProjectVerdict('{"answer":"YES","confidence":2}')).toBeNull();
    expect(parseLocalProjectVerdict('<think>{"answer":"YES","confidence":1}</think>broken')).toBeNull();
    expect(parseLocalProjectVerdict('{"answer":"YES","confidence":1} extra')).toBeNull();
  });
});
