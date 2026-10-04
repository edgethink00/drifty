// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  changeLivingSoulPattern, livingSoulPatternHash, livingSoulPromptContext, reviewLivingSoulPattern,
  parseLivingSoulMarkdown, readLivingSoulForUser, renderLivingSoulMarkdown,
  synchronizeLivingSoulDeclaredContextForUser, updateLivingSoulLearnedState,
} from "./livingSoul";

const pattern = { summary: "Research videos can support a specific work task.", confidence: "low" as const,
  evidenceCount: 1, lastObservedAt: "2026-10-04T00:00:00.000Z" };
beforeEach(() => window.localStorage.clear());

async function seed(ownerId = "local") {
  const initial = await synchronizeLivingSoulDeclaredContextForUser(ownerId);
  return updateLivingSoulLearnedState({ ownerId, expectedRevision: initial.document.revision,
    learned: { workSupport: [pattern], drift: [], ambiguities: [] },
    feedbackAt: pattern.lastObservedAt, feedbackKind: "manual_correction" });
}

describe("user control of learned memory", () => {
  it("forgets a pattern, rejects a late response, and blocks the same wording on subsequent learning", async () => {
    const original = await seed();
    const forgotten = await changeLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision,
      kind: "workSupport", summary: pattern.summary });
    expect(forgotten.promptContext.learnedWorkSupport).toEqual([]);
    const late = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: original.document.revision,
      learned: original.document.learned, feedbackAt: pattern.lastObservedAt });
    expect(late.document).toEqual(forgotten.document);
    const next = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: forgotten.document.revision,
      learned: original.document.learned, feedbackAt: pattern.lastObservedAt, feedbackKind: "manual_correction" });
    expect(next.document.learned.workSupport).toEqual([]);
    expect(next.document.memoryControls?.dismissedHashes).toContain(await livingSoulPatternHash(pattern.summary));
  });

  it("keeps edited wording across future refinement, without leaking controls into provider context", async () => {
    const original = await seed();
    const edited = await changeLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision,
      kind: "workSupport", summary: pattern.summary, replacement: "Only product research videos support my work." });
    const refined = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: edited.document.revision,
      learned: { workSupport: [], drift: [{ ...edited.document.learned.workSupport[0] }], ambiguities: [] }, feedbackAt: pattern.lastObservedAt });
    expect(refined.document.learned.workSupport[0].summary).toBe("Only product research videos support my work.");
    expect(refined.document.learned.drift).toEqual([]);
    expect(livingSoulPromptContext(refined.document)).not.toHaveProperty("memoryControls");
    expect(parseLivingSoulMarkdown(renderLivingSoulMarkdown(refined.document))).toEqual(refined.document);
    await expect(changeLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision,
      kind: "workSupport", summary: pattern.summary })).rejects.toThrow("memory_changed");
  });

  it("leaves sibling owners and unreadable files untouched", async () => {
    const original = await seed("local");
    const sibling = await seed("sibling");
    await changeLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision, kind: "workSupport", summary: pattern.summary });
    const result = await readLivingSoulForUser("sibling");
    expect(result.state === "ready" && result.context.document).toEqual(sibling.document);
    const key = Object.keys(localStorage).find((key) => localStorage.getItem(key)?.includes(pattern.summary));
    expect(key).toBeTruthy();
    localStorage.setItem(key!, "invalid document");
    await expect(changeLivingSoulPattern({ ownerId: "sibling", expectedRevision: sibling.document.revision,
      kind: "workSupport", summary: pattern.summary })).rejects.toThrow();
    expect(localStorage.getItem(key!)).toBe("invalid document");
  });
});

describe("feedback on saved memory", () => {
  it("confirms without inflating evidence, persists locally and pins the original group across refinement", async () => {
    const original = await seed();
    const confirmed = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "confirm" });
    expect(confirmed.document.learned).toEqual(original.document.learned);
    expect(confirmed.document.lastFeedbackAt).toBe(original.document.lastFeedbackAt);
    expect(parseLivingSoulMarkdown(renderLivingSoulMarkdown(confirmed.document))).toEqual(confirmed.document);
    const refined = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: confirmed.document.revision,
      learned: { workSupport: [], drift: [{ ...pattern, evidenceCount: 99 }], ambiguities: [] }, feedbackAt: pattern.lastObservedAt });
    expect(refined.document.learned.workSupport).toEqual([pattern]);
    expect(refined.document.learned.drift).toEqual([]);
    expect(refined.promptContext).not.toHaveProperty("memoryControls");
    const unconfirmed = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: refined.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "unconfirm" });
    const after = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: unconfirmed.document.revision,
      learned: { workSupport: [], drift: [], ambiguities: [] }, feedbackAt: pattern.lastObservedAt });
    expect(after.document.learned.workSupport).toEqual([]);
  });

  it("rejects immediately, preserves an undo copy across reload and learning, and restores evidence and confirmation", async () => {
    const original = await seed();
    const confirmed = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "confirm" });
    const rejected = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: confirmed.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "reject" });
    const hash = await livingSoulPatternHash(pattern.summary);
    expect(rejected.promptContext.learnedWorkSupport).toEqual([]);
    expect(rejected.document.memoryControls?.rejectedPatterns?.[hash].confirmed).toBe(true);
    expect(parseLivingSoulMarkdown(renderLivingSoulMarkdown(rejected.document))).toEqual(rejected.document);
    const late = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: confirmed.document.revision,
      learned: original.document.learned, feedbackAt: pattern.lastObservedAt });
    expect(late.document).toEqual(rejected.document);
    const refined = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: rejected.document.revision,
      learned: original.document.learned, feedbackAt: pattern.lastObservedAt, feedbackKind: "manual_correction" });
    expect(refined.document.learned.workSupport).toEqual([]);
    expect(refined.document.memoryControls?.rejectedPatterns).toEqual(rejected.document.memoryControls?.rejectedPatterns);
    const restored = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: refined.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "restore" });
    expect(restored.document.learned).toEqual(original.document.learned);
    expect(restored.document.memoryControls?.origins).toEqual(original.document.memoryControls?.origins);
    expect(restored.document.memoryControls?.confirmedHashes).toEqual([hash]);
    expect(restored.document.memoryControls?.dismissedHashes).not.toContain(hash);
    expect(restored.document.memoryControls?.rejectedPatterns).toEqual({});
  });

  it("does not evict other active patterns when a restore group is full", async () => {
    const original = await seed();
    const rejected = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "reject" });
    const filled = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: rejected.document.revision,
      learned: { workSupport: Array.from({length:6}, (_, i) => ({...pattern, summary: "Different work context " + i})), drift: [], ambiguities: [] }, feedbackAt: pattern.lastObservedAt });
    await expect(reviewLivingSoulPattern({ ownerId: "local", expectedRevision: filled.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "restore" })).rejects.toThrow("memory_restore_limit");
    const state = await readLivingSoulForUser("local");
    expect(state.state === "ready" && state.context.document).toEqual(filled.document);
  });

  it("forgets an undo copy while keeping its exclusion and sibling owners intact", async () => {
    const original = await seed();
    const sibling = await seed("sibling");
    const rejected = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "reject" });
    await expect(reviewLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "restore" })).rejects.toThrow("memory_changed");
    const forgotten = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: rejected.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "forgetRejected" });
    expect(forgotten.document.memoryControls?.rejectedPatterns).toEqual({});
    expect(forgotten.document.memoryControls?.dismissedHashes).toContain(await livingSoulPatternHash(pattern.summary));
    const state = await readLivingSoulForUser("sibling");
    expect(state.state === "ready" && state.context.document).toEqual(sibling.document);
  });

  it("rejects malformed persisted feedback controls instead of advertising usable memory", async () => {
    const original = await seed();
    const hash = await livingSoulPatternHash(pattern.summary);
    const invalid = { ...original.document, memoryControls: { ...original.document.memoryControls!, confirmedHashes: ["not a hash"] } };
    expect(parseLivingSoulMarkdown(renderLivingSoulMarkdown(invalid))).toBeNull();
    const archive = { ...original.document, memoryControls: { ...original.document.memoryControls!, rejectedPatterns: {
      [hash]: { kind: "workSupport" as const, pattern, rejectedAt: pattern.lastObservedAt },
    } } };
    expect(parseLivingSoulMarkdown(renderLivingSoulMarkdown(archive))).toBeNull();
  });
});

it("preserves all exclusions when feedback storage is full", async () => {
  const original = await seed();
  const full = { ...original.document, memoryControls: { ...original.document.memoryControls!,
    dismissedHashes: Array.from({length:64}, (_, i) => i.toString(16).padStart(64, "0")) } };
  const key = Object.keys(localStorage).find((key) => key.startsWith("drifty:living-soul:v1:"))!;
  localStorage.setItem(key, renderLivingSoulMarkdown(full));
  await expect(reviewLivingSoulPattern({ ownerId: "local", expectedRevision: full.revision,
    kind: "workSupport", summary: pattern.summary, action: "reject" })).rejects.toThrow("memory_limit");
  const result = await readLivingSoulForUser("local");
  expect(result.state === "ready" && result.context.document).toEqual(full);
});

it("excludes identical wording in other groups as well", async () => {
  const initial = await synchronizeLivingSoulDeclaredContextForUser("local");
  const original = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: initial.document.revision,
    learned: { workSupport: [pattern], drift: [{...pattern}], ambiguities: [] }, feedbackAt: pattern.lastObservedAt });
  const rejected = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision,
    kind: "workSupport", summary: pattern.summary, action: "reject" });
  expect(rejected.promptContext.learnedWorkSupport).toEqual([]);
  expect(rejected.promptContext.learnedDrift).toEqual([]);
});
