import { describe, expect, it } from "vitest";

import {
  declaredContextFromOnboarding,
  livingSoulPromptContext,
  normalizeLivingSoulPattern,
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
      petModeEnabled: false,
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
      petModeEnabled: false,
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

  it("strips raw identifiers a refiner may leak into a learned pattern", () => {
    // The refinement prompt tells the model not to store raw URLs, account
    // names, or private titles, but a prompt is guidance, not a guarantee.
    // Memory now shows these summaries in Settings, so the host enforces it.
    const leaked = normalizeLivingSoulPattern({
      summary: "Visiting https://mail.internal.acme.com/thread/9182 after standup is usually work.",
      confidence: "medium",
      evidenceCount: 3,
      lastObservedAt: "2026-08-14T01:00:00.000Z",
    });

    expect(leaked?.summary).not.toContain("https://");
    expect(leaked?.summary).not.toContain("mail.internal.acme.com");

    const emailLeak = normalizeLivingSoulPattern({
      summary: "Email from alex@example.com usually precedes focused work.",
      confidence: "low",
      evidenceCount: 1,
      lastObservedAt: "2026-08-14T01:00:00.000Z",
    });

    expect(emailLeak?.summary).not.toContain("alex@example.com");

    const handleLeak = normalizeLivingSoulPattern({
      summary: "Replies to @acme_support are work, not drift.",
      confidence: "low",
      evidenceCount: 1,
      lastObservedAt: "2026-08-14T01:00:00.000Z",
    });

    expect(handleLeak?.summary).not.toContain("@acme_support");
  });

  it("keeps a generalized pattern untouched", () => {
    const clean = normalizeLivingSoulPattern({
      summary: "Product research before implementation is usually work support.",
      confidence: "medium",
      evidenceCount: 4,
      lastObservedAt: "2026-08-14T01:00:00.000Z",
    });

    expect(clean?.summary).toBe("Product research before implementation is usually work support.");
  });

  it("keeps a bare site domain, which is the subject of Drifty's own site rules", () => {
    // Fallback learning writes rules like this from a user correction. The
    // domain is the rule, and it is already visible in the timeline, so
    // redacting it here would destroy the pattern rather than protect anything.
    const siteRule = normalizeLivingSoulPattern({
      summary: "instagram.com is not always drift; classify it from the surrounding sequence.",
      confidence: "low",
      evidenceCount: 2,
      lastObservedAt: "2026-08-14T01:00:00.000Z",
    });

    expect(siteRule?.summary).toBe(
      "instagram.com is not always drift; classify it from the surrounding sequence.",
    );
  });

  it("removes locations that identify one document, machine, or person", () => {
    const summarize = (summary: string) => normalizeLivingSoulPattern({
      summary,
      confidence: "low",
      evidenceCount: 1,
      lastObservedAt: "2026-08-14T01:00:00.000Z",
    })?.summary;

    expect(summarize("Opening file:///Users/alex/Secret/report.pdf is work."))
      .toBe("Opening [removed] is work.");
    expect(summarize("Editing /Users/alex/Desktop/Client/spec.md is work."))
      .toBe("Editing [removed] is work.");
    expect(summarize("Editing C:\\Users\\alex\\Client\\spec.docx is work."))
      .toBe("Editing [removed] is work.");
    expect(summarize("Checking 192.168.1.20:8080/dashboard is work."))
      .toBe("Checking [removed] is work.");
  });

  it("keeps technical vocabulary that only looks like a handle", () => {
    const summarize = (summary: string) => normalizeLivingSoulPattern({
      summary,
      confidence: "low",
      evidenceCount: 1,
      lastObservedAt: "2026-08-14T01:00:00.000Z",
    })?.summary;

    // CSS at-rules and scoped package names are how developers describe work.
    // Redacting them would corrupt an otherwise valid learned pattern.
    expect(summarize("CSS @media query debugging is work."))
      .toBe("CSS @media query debugging is work.");
    expect(summarize("Reading @testing-library/react docs supports implementation."))
      .toBe("Reading @testing-library/react docs supports implementation.");
  });
});
