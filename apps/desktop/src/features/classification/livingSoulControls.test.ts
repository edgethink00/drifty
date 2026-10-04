// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  adoptLivingSoulSuggestion, changeLivingSoulPattern, livingSoulPatternHash, livingSoulPromptContext, reviewLivingSoulPattern,
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
  it("raises a confirmed pattern to high confidence without inflating evidence, pins its group, and restores it on unconfirm", async () => {
    const original = await seed();
    const confirmed = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: original.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "confirm" });
    expect(confirmed.document.learned.workSupport).toEqual([{ ...pattern, confidence: "high" }]);
    expect(confirmed.promptContext.learnedWorkSupport[0]).toMatchObject({ confidence: "high", evidenceCount: 1 });
    expect(confirmed.document.lastFeedbackAt).toBe(original.document.lastFeedbackAt);
    expect(parseLivingSoulMarkdown(renderLivingSoulMarkdown(confirmed.document))).toEqual(confirmed.document);
    const refined = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: confirmed.document.revision,
      learned: { workSupport: [], drift: [{ ...pattern, evidenceCount: 99 }], ambiguities: [] }, feedbackAt: pattern.lastObservedAt });
    expect(refined.document.learned.workSupport).toEqual([{ ...pattern, confidence: "high" }]);
    expect(refined.document.learned.drift).toEqual([]);
    expect(refined.promptContext).not.toHaveProperty("memoryControls");
    const unconfirmed = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: refined.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "unconfirm" });
    expect(unconfirmed.document.learned.workSupport).toEqual([pattern]);
    expect(unconfirmed.document.memoryControls?.confirmedPriorConfidence).toBeUndefined();
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
    expect(rejected.document.memoryControls?.rejectedPatterns?.[hash].pattern.confidence).toBe("low");
    const restored = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: refined.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "restore" });
    expect(restored.document.learned.workSupport).toEqual([{ ...pattern, confidence: "high" }]);
    const unconfirmed = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: restored.document.revision,
      kind: "workSupport", summary: pattern.summary, action: "unconfirm" });
    expect(unconfirmed.document.learned).toEqual(original.document.learned);
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

describe("adopting a suggested memory", () => {
  const suggestion = { ownerId: "local", kind: "workSupport" as const, summary: "Editing papers online counts as work.",
    evidenceDays: 3, observedAt: "2026-10-04T00:00:00.000Z", activity: "Aside / overleaf.com", productivity: "focus" as const };

  async function start() {
    return synchronizeLivingSoulDeclaredContextForUser("local");
  }

  it("adds a pinned, confirmed pattern with suggestion provenance and survives reload and refinement", async () => {
    const initial = await start();
    const adopted = await adoptLivingSoulSuggestion({ ...suggestion, expectedRevision: initial.document.revision });
    const hash = await livingSoulPatternHash(suggestion.summary);
    expect(adopted.document.learned.workSupport).toEqual([{ summary: suggestion.summary, confidence: "high", evidenceCount: 3, lastObservedAt: suggestion.observedAt }]);
    expect(adopted.document.memoryControls?.confirmedHashes).toContain(hash);
    expect(adopted.document.memoryControls?.origins[hash]).toMatchObject({ source: "suggestion", activity: "Aside / overleaf.com", productivity: "focus" });
    expect(parseLivingSoulMarkdown(renderLivingSoulMarkdown(adopted.document))).toEqual(adopted.document);
    expect(livingSoulPromptContext(adopted.document)).not.toHaveProperty("memoryControls");
    const refined = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: adopted.document.revision,
      learned: { workSupport: [], drift: [], ambiguities: [] }, feedbackAt: suggestion.observedAt, feedbackKind: "manual_correction" });
    expect(refined.document.learned.workSupport.map((p) => p.summary)).toEqual([suggestion.summary]);
  });

  it("refuses a stale revision, a duplicate, blocked wording and a full group without evicting anything", async () => {
    const initial = await start();
    const adopted = await adoptLivingSoulSuggestion({ ...suggestion, expectedRevision: initial.document.revision });
    await expect(adoptLivingSoulSuggestion({ ...suggestion, summary: "Other sentence for the same group.", expectedRevision: initial.document.revision }))
      .rejects.toThrow("memory_changed");
    await expect(adoptLivingSoulSuggestion({ ...suggestion, expectedRevision: adopted.document.revision })).rejects.toThrow("memory_duplicate");

    const rejected = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: adopted.document.revision, kind: "workSupport", summary: suggestion.summary, action: "reject" });
    await expect(adoptLivingSoulSuggestion({ ...suggestion, expectedRevision: rejected.document.revision })).rejects.toThrow("memory_duplicate");

    let revision = rejected.document.revision;
    for (let index = 0; index < 4; index += 1) {
      const filled = await adoptLivingSoulSuggestion({ ...suggestion, kind: "drift", summary: "Drift sentence number " + index + " for the group.", expectedRevision: revision });
      revision = filled.document.revision;
    }
    await expect(adoptLivingSoulSuggestion({ ...suggestion, kind: "drift", summary: "One drift sentence too many for the group.", expectedRevision: revision }))
      .rejects.toThrow("memory_group_full");
    const result = await readLivingSoulForUser("local");
    expect(result.state === "ready" && result.context.document.learned.drift).toHaveLength(4);
  });

  it("does not create a Soul for a missing owner", async () => {
    await expect(adoptLivingSoulSuggestion({ ...suggestion, ownerId: "nobody", expectedRevision: 1 })).rejects.toThrow("memory_changed");
  });
});


describe("confirmed patterns in the classifier context", () => {
  it("lists confirmed patterns first in their group and rejects malformed prior confidence", async () => {
    const initial = await synchronizeLivingSoulDeclaredContextForUser("local");
    const second = { ...pattern, summary: "Release notes drafting supports a work task." };
    const seeded = await updateLivingSoulLearnedState({ ownerId: "local", expectedRevision: initial.document.revision,
      learned: { workSupport: [pattern, second], drift: [], ambiguities: [] }, feedbackAt: pattern.lastObservedAt, feedbackKind: "manual_correction" });
    const confirmed = await reviewLivingSoulPattern({ ownerId: "local", expectedRevision: seeded.document.revision,
      kind: "workSupport", summary: second.summary, action: "confirm" });
    expect(confirmed.promptContext.learnedWorkSupport.map((entry) => entry.summary)).toEqual([second.summary, pattern.summary]);
    const markdown = renderLivingSoulMarkdown(confirmed.document);
    expect(parseLivingSoulMarkdown(markdown)).toEqual(confirmed.document);
    const hash = await livingSoulPatternHash(second.summary);
    expect(parseLivingSoulMarkdown(markdown.replace('"' + hash + '":"low"', '"' + hash + '":"extreme"'))).toBeNull();
  });
});

