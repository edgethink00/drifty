import { describe, expect, it } from "vitest";

import {
  declaredContextFromOnboarding,
  livingSoulPromptContext,
  parseLivingSoulMarkdown,
  renderLivingSoulMarkdown,
  type LivingSoulDocument,
} from "./livingSoul";

const document: LivingSoulDocument = {
  schema: "drifty.soul/v1",
  revision: 3,
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T01:00:00.000Z",
  lastFeedbackAt: "2026-08-14T01:00:00.000Z",
  declared: {
    workActivities: ["Engineering", "Marketing"],
    workDomain: "AI productivity",
    workDescription: "I build product features, plan launches, and help customers.",
    purpose: "Protect focus",
  },
  learned: {
    workSupport: [{
      summary: "Professional social research can support a launch when it follows campaign work.",
      confidence: "medium",
      evidenceCount: 2,
      lastObservedAt: "2026-08-14T01:00:00.000Z",
    }],
    drift: [],
    ambiguities: [{
      summary: "Instagram is not always drift; use the surrounding sequence.",
      confidence: "low",
      evidenceCount: 1,
      lastObservedAt: "2026-08-14T00:30:00.000Z",
    }],
  },
  contextualPriors: [{
    selectorHash: "a".repeat(64),
    observedDays: ["2026-08-12", "2026-08-13", "2026-08-14"],
    lastObservedAt: "2026-08-14T01:00:00.000Z",
    summary: "A recurring communication context has preceded independently anchored work activity.",
  }],
};

describe("Living Soul document", () => {
  it("round-trips one bounded readable Soul.md document", () => {
    const markdown = renderLivingSoulMarkdown(document);
    const parsed = parseLivingSoulMarkdown(markdown);

    expect(markdown).toContain("# Living Soul");
    expect(markdown).toContain("## Learned work-support patterns");
    expect(markdown).toContain("## Passive contextual priors");
    expect(parsed).toEqual(document);
    expect(livingSoulPromptContext(document)).not.toHaveProperty("createdAt");
    expect(livingSoulPromptContext(document).learnedWorkSupport[0]).not.toHaveProperty("lastObservedAt");
  });

  it("reads declared context from the persisted document so profile changes can advance revision", () => {
    const markdown = renderLivingSoulMarkdown(document);
    const parsed = parseLivingSoulMarkdown(markdown);

    expect(parsed?.declared).toEqual(document.declared);
    expect(parsed?.learned).toEqual(document.learned);
  });

  it("rejects malformed metadata instead of silently replacing it", () => {
    expect(parseLivingSoulMarkdown("# Living Soul\n")).toBeNull();
    expect(parseLivingSoulMarkdown(renderLivingSoulMarkdown(document).replace("revision: 3", "revision: nope"))).toBeNull();
  });

  it("migrates an existing Soul without the passive-prior section", () => {
    const legacy = renderLivingSoulMarkdown(document).replace(
      /\n## Passive contextual priors\n[\s\S]*$/,
      "\n",
    );
    expect(parseLivingSoulMarkdown(legacy)?.contextualPriors).toEqual([]);
  });

  it("seeds declared work activities and description from onboarding", () => {
    expect(declaredContextFromOnboarding({
      version: 2,
      completed: true,
      displayName: "",
      workType: "Engineering",
      workTypeOther: "",
      workDomain: "Other",
      workDomainOther: "AI productivity",
      jobType: "Engineering, Marketing",
      jobTypeOther: "",
      workDescription: "I build product features and plan launches.",
      driftAlarmEnabled: true,
      extremeNudgeEnabled: true,
      browserHistoryBootstrapEnabled: false,
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: "protect_focus",
      completedAt: "2026-08-14T00:00:00.000Z",
    })).toEqual({
      workActivities: ["Engineering", "Marketing"],
      workDomain: null,
      workDescription: "I build product features and plan launches.",
      purpose: "Protect focus",
    });
  });

  it("moves a legacy field into the description when the description is empty", () => {
    expect(declaredContextFromOnboarding({
      version: 2,
      completed: true,
      displayName: "",
      workType: "Engineering",
      workTypeOther: "",
      workDomain: "Other",
      workDomainOther: "AI productivity",
      jobType: "Engineering",
      jobTypeOther: "",
      workDescription: "",
      driftAlarmEnabled: true,
      extremeNudgeEnabled: true,
      browserHistoryBootstrapEnabled: false,
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: "protect_focus",
      completedAt: "2026-08-14T00:00:00.000Z",
    })).toEqual({
      workActivities: ["Engineering"],
      workDomain: null,
      workDescription: "Works in AI productivity.",
      purpose: "Protect focus",
    });
  });
});
