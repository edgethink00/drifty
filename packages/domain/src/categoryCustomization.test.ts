import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "./activity";
import { buildCategoryDurations, classifyActivityDetailed } from "./aggregation";
import {
  categoryGuidanceChanged,
  categoryGuidanceFromCustomizations,
  categoryNameOverrides,
  categoryProductivityPreferences,
  classificationGuidanceChanged,
  classificationGuidanceFromCustomizations,
  customCategoryIds,
  deletedCategories,
  deletedCategoryCutoffs,
  normalizeCategoryCustomizations,
  normalizeProductivityCustomizations,
  productivityNameOverrides,
} from "./categoryCustomization";
import {
  hasLiveCategoryDescriptions,
  liveAddedCategoryIds,
  liveAllowedCategoriesLine,
  liveCategoryGuidancePromptLines,
  normalizeLiveCategoryGuidance,
  normalizeLiveReturnedCategory,
} from "./liveClassificationPolicy";
import { buildLiveClassificationPrompt, LIVE_CATEGORY_DEFINITIONS, LIVE_INTENT_FIRST_RUBRIC } from "./liveClassificationPrompt";
import { isContentDependentYouTubeActivity } from "./youtubeClassification";

function segment(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id: "segment-1",
    startedAt: "2026-10-10T09:00:00.000Z",
    endedAt: "2026-10-10T09:10:00.000Z",
    durationSeconds: 600,
    appName: "Arc",
    browserName: "Arc",
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  };
}

describe("category customizations", () => {
  it("keeps only usable settings for the nine customizable categories", () => {
    expect(normalizeCategoryCustomizations({
      learning: { name: "  Dev   study ", description: "  Coding talks  ", productivity: "focus" },
      entertainment: { productivity: "sometimes" },
      unknown: { name: "Mystery", description: "Anything" },
      shopping: { name: "", description: "   " },
      social_media: { description: "x".repeat(400) },
    })).toEqual({
      learning: { name: "Dev study", description: "Coding talks", productivity: "focus" },
      social_media: { description: "x".repeat(300) },
    });
  });

  it("sends only described categories to the model, with their custom name", () => {
    const guidance = categoryGuidanceFromCustomizations({
      entertainment: { name: "Shorts", productivity: "drift" },
      learning: { name: "Dev study", description: "Count <b>WWDC</b> talks here" },
      workspace: { description: "Design work in Figma" },
    });

    expect(guidance).toEqual([
      { category: "workspace", description: "Design work in Figma" },
      { category: "learning", name: "Dev study", description: "Count b WWDC /b talks here" },
    ]);
  });

  it("reclassifies only when what the model reads changes", () => {
    const base = { learning: { description: "Coding talks" } } as const;
    expect(categoryGuidanceChanged(base, { learning: { description: "Coding talks", productivity: "focus" } })).toBe(false);
    expect(categoryGuidanceChanged({}, { entertainment: { name: "Shorts" } })).toBe(false);
    expect(categoryGuidanceChanged(base, { learning: { description: "Coding talks and papers" } })).toBe(true);
    expect(categoryGuidanceChanged(base, { learning: { name: "Study", description: "Coding talks" } })).toBe(true);
  });

  it("derives display names and productivity preferences per category", () => {
    const customizations = { learning: { name: "Study", productivity: "focus" }, game: { description: "Puzzle apps" } } as const;
    expect(categoryNameOverrides(customizations)).toEqual({ learning: "Study" });
    expect(categoryProductivityPreferences(customizations)).toEqual({ learning: "focus" });
  });
});

describe("category productivity preference", () => {
  const preferences = { categoryProductivity: { entertainment: "neutral" as const } };

  it("pins automatic answers in the category", () => {
    const classified = classifyActivityDetailed(segment({
      siteDomain: "example.tv",
      classification: { category: "entertainment", productivity: "drift", source: "llm", confidence: 0.8 },
    }), preferences);

    expect(classified).toMatchObject({ category: "entertainment", productivity: "neutral", productivityPreference: true });
  });

  it("never overrides a manual correction or a saved user rule", () => {
    const manual = classifyActivityDetailed(segment({
      classification: { category: "entertainment", productivity: "drift", source: "manual", confidence: 1 },
    }), preferences);
    const ruled = classifyActivityDetailed(segment({ siteDomain: "example.tv" }), {
      ...preferences,
      rules: [{ targetKind: "site", targetValue: "example.tv", category: "entertainment", productivity: "drift" }],
    });

    expect(manual.productivity).toBe("drift");
    expect(ruled).toMatchObject({ source: "rule", productivity: "drift" });
  });
});

describe("deleted categories", () => {
  const deletedAt = "2026-10-15T12:00:00.000Z";
  const options = { deletedCategories: { entertainment: deletedAt } };
  const watched = (startedAt: string, source: "llm" | "manual" = "llm") => segment({
    startedAt,
    siteDomain: "example.tv",
    classification: { category: "entertainment", productivity: "drift", source, confidence: 0.8 },
  });

  it("keeps the deletion time and drops the category from the model's guidance", () => {
    const customizations = normalizeCategoryCustomizations({
      entertainment: { description: "영화와 드라마", deletedAt },
      learning: { description: "WWDC 세션" },
    });

    expect(customizations.entertainment).toEqual({ description: "영화와 드라마", deletedAt });
    expect(deletedCategoryCutoffs(customizations)).toEqual({ entertainment: deletedAt });
    expect(deletedCategories(customizations)).toEqual(["entertainment"]);
    expect(categoryGuidanceFromCustomizations(customizations).map((entry) => "category" in entry ? entry.category : null)).toEqual(["learning"]);
  });

  it("files activity from the deletion on as unclassified, and keeps earlier records", () => {
    expect(classifyActivityDetailed(watched("2026-10-15T12:30:00.000Z"), options)).toMatchObject({ category: "unknown", source: "unknown" });
    expect(classifyActivityDetailed(watched("2026-10-15T11:30:00.000Z"), options)).toMatchObject({ category: "entertainment", productivity: "drift" });
  });

  it("tells the classifier not to return a deleted category, without any written text", () => {
    const guidance = classificationGuidanceFromCustomizations(
      { entertainment: { description: "영화와 드라마", deletedAt } },
      {},
    );

    expect(guidance).toEqual([{ category: "entertainment", removed: true }]);
    expect(hasLiveCategoryDescriptions(guidance)).toBe(false);
    expect(liveCategoryGuidancePromptLines(guidance).join("\n")).toContain('<user_removed_categories>["entertainment"]</user_removed_categories>');
    expect(liveCategoryGuidancePromptLines(guidance, { includeCategories: false })).toEqual([]);
    // A reader that predates removals drops entries without a description.
    expect(normalizeLiveCategoryGuidance([{ category: "entertainment" }])).toEqual([]);
  });

  it("never overrides a manual correction", () => {
    expect(classifyActivityDetailed(watched("2026-10-15T12:30:00.000Z", "manual"), options)).toMatchObject({ category: "entertainment", source: "manual" });
  });
});

describe("user category guidance in the live prompt", () => {
  const items = [{ id: "a", appName: "Arc", domain: "youtube.com", urlHost: "youtube.com", title: "WWDC recaps", durationSeconds: 600 }];

  it("adds nothing when the user wrote no descriptions", () => {
    expect(buildLiveClassificationPrompt(items, null, { intentFirst: true, categoryGuidance: [] }))
      .toBe(buildLiveClassificationPrompt(items, null, { intentFirst: true }));
  });

  it("places the user's definitions right after the default definitions", () => {
    const prompt = buildLiveClassificationPrompt(items, null, {
      intentFirst: true,
      categoryGuidance: [{ category: "learning", name: "Dev study", description: "Conference talks and WWDC sessions" }],
    });
    const definitions = prompt.indexOf(LIVE_CATEGORY_DEFINITIONS);
    const guidance = prompt.indexOf("<user_category_guidance>");
    const rubric = prompt.indexOf(LIVE_INTENT_FIRST_RUBRIC);

    expect(definitions).toBeGreaterThan(-1);
    expect(guidance).toBeGreaterThan(definitions);
    expect(rubric).toBeGreaterThan(guidance);
    expect(prompt).toContain('{"category":"learning","name":"Dev study","description":"Conference talks and WWDC sessions"}');
  });
});

describe("productivity definitions", () => {
  const items = [{ id: "a", appName: "Arc", domain: "youtube.com", urlHost: "youtube.com", title: "WWDC recaps", durationSeconds: 600 }];

  it("keeps a name and description for the three labels only", () => {
    expect(normalizeProductivityCustomizations({
      focus: { name: "  Deep  work ", description: "  Coding talks  " },
      drift: { name: "" },
      other: { description: "ignored" },
    })).toEqual({ focus: { name: "Deep work", description: "Coding talks" } });
    expect(productivityNameOverrides({ focus: { name: "Deep work" }, drift: { description: "Shorts" } })).toEqual({ focus: "Deep work" });
  });

  it("sends described labels after described categories, and never a rename alone", () => {
    const guidance = classificationGuidanceFromCustomizations(
      { learning: { description: "WWDC sessions" }, game: { name: "Play" } },
      { drift: { name: "Slack off", description: "YouTube Shorts" }, focus: { name: "Deep work" } },
    );

    expect(guidance).toEqual([
      { category: "learning", description: "WWDC sessions" },
      { productivity: "drift", name: "Slack off", description: "YouTube Shorts" },
    ]);
  });

  it("treats a productivity description change as a model-facing change", () => {
    const base = { categories: {}, productivity: { focus: { description: "Coding talks" } } };
    expect(classificationGuidanceChanged(base, { categories: {}, productivity: { focus: { description: "Coding talks and papers" } } })).toBe(true);
    expect(classificationGuidanceChanged(base, { categories: {}, productivity: { focus: { name: "Deep work", description: "Coding talks" } } })).toBe(true);
    expect(classificationGuidanceChanged({ categories: {}, productivity: {} }, { categories: {}, productivity: { neutral: { name: "Calm" } } })).toBe(false);
  });

  it("drops unknown labels and duplicates instead of rejecting the request", () => {
    expect(normalizeLiveCategoryGuidance([
      { productivity: "drift", description: "Shorts" },
      { productivity: "drift", description: "Second" },
      { productivity: "sleep", description: "never accepted" },
      { productivity: "focus", description: "Docs" },
    ])).toEqual([
      { productivity: "focus", description: "Docs" },
      { productivity: "drift", description: "Shorts" },
    ]);
  });

  it("adds a productivity block to the intent prompt and keeps it in the productivity-only pass", () => {
    const categoryGuidance = [
      { category: "learning" as const, description: "Conference talks" },
      { productivity: "drift" as const, description: "Reaction videos" },
    ];
    const intent = buildLiveClassificationPrompt(items, null, { intentFirst: true, categoryGuidance });
    const productivityOnly = buildLiveClassificationPrompt(items, null, { productivityOnly: true, categoryGuidance });

    expect(intent.indexOf("<user_productivity_guidance>")).toBeGreaterThan(intent.indexOf("<user_category_guidance>"));
    expect(intent.indexOf(LIVE_INTENT_FIRST_RUBRIC)).toBeGreaterThan(intent.indexOf("<user_productivity_guidance>"));
    expect(intent).toContain('<user_productivity_guidance>[{"productivity":"drift","description":"Reaction videos"}]</user_productivity_guidance>');
    expect(productivityOnly).toContain("<user_productivity_guidance>");
    expect(productivityOnly).not.toContain("<user_category_guidance>");
  });
});

describe("content-dependent YouTube activity", () => {
  const video = segment({ siteDomain: "youtube.com", siteUrl: "https://www.youtube.com/watch?v=abc", youtubeVideoId: "abc", youtubeCategory: "Entertainment" });

  it("covers videos decided by their official category", () => {
    expect(isContentDependentYouTubeActivity(video)).toBe(true);
    expect(isContentDependentYouTubeActivity({ ...video, youtubeCategory: "Education" })).toBe(true);
  });

  it("leaves surface signals with the built-in rule", () => {
    expect(isContentDependentYouTubeActivity({ ...video, youtubeIsShorts: true })).toBe(false);
    expect(isContentDependentYouTubeActivity({ ...video, siteDomain: "music.youtube.com" })).toBe(false);
    expect(isContentDependentYouTubeActivity({ ...video, youtubeCategory: "Music" })).toBe(false);
    expect(isContentDependentYouTubeActivity({ ...video, siteDomain: "example.com" })).toBe(false);
  });
});

describe("user-added categories", () => {
  const added = {
    "custom-side0001": { name: "사이드 프로젝트", description: "주말에 만드는 앱", color: "#3F7CAC", createdAt: "2026-10-16T01:00:00.000Z" },
    "custom-read0002": { name: "독서", createdAt: "2026-10-16T00:00:00.000Z" },
    "custom-gone0003": { name: "옛 카테고리", createdAt: "2026-10-15T00:00:00.000Z", deletedAt: "2026-10-16T02:00:00.000Z" },
  };

  it("keeps added categories that have a name, in the order they were made", () => {
    const normalized = normalizeCategoryCustomizations({ ...added, "custom-noname01": { description: "이름 없음" }, "custom-BAD": { name: "x" } });
    expect(Object.keys(normalized).sort()).toEqual(["custom-gone0003", "custom-read0002", "custom-side0001"]);
    expect(normalized["custom-side0001"]).toEqual({ name: "사이드 프로젝트", description: "주말에 만드는 앱", color: "#3f7cac", createdAt: "2026-10-16T01:00:00.000Z" });
    expect(customCategoryIds(normalized)).toEqual(["custom-gone0003", "custom-read0002", "custom-side0001"]);
  });

  it("offers live added categories to the model by id, name, and words, and lets it return their ids", () => {
    const guidance = categoryGuidanceFromCustomizations(normalizeCategoryCustomizations(added));
    expect(guidance).toEqual([
      { category: "custom-read0002", name: "독서", added: true },
      { category: "custom-side0001", name: "사이드 프로젝트", description: "주말에 만드는 앱", added: true },
    ]);
    expect(hasLiveCategoryDescriptions(guidance)).toBe(true);
    expect(liveAllowedCategoriesLine(guidance)).toBe("Use only these categories: workspace, learning, communication, music, game, social_media, entertainment, shopping, utility, custom-read0002, custom-side0001, unknown.");
    expect(liveAllowedCategoriesLine([])).toBe("Use only these categories: workspace, learning, communication, music, game, social_media, entertainment, shopping, utility, unknown.");
    const prompt = liveCategoryGuidancePromptLines(guidance).join("\n");
    expect(prompt).toContain('<user_added_categories>[{"category":"custom-read0002","name":"독서"},{"category":"custom-side0001","name":"사이드 프로젝트","description":"주말에 만드는 앱"}]</user_added_categories>');
    expect(prompt).not.toContain("<user_category_guidance>");
    expect(liveCategoryGuidancePromptLines(guidance, { includeCategories: false })).toEqual([]);
    const allowed = new Set(liveAddedCategoryIds(guidance));
    expect(normalizeLiveReturnedCategory("custom-side0001", allowed)).toBe("custom-side0001");
    expect(normalizeLiveReturnedCategory("custom-gone0003", allowed)).toBe("unknown");
    expect(normalizeLiveReturnedCategory("learning", allowed)).toBe("learning");
  });

  it("counts an added category's time, its fixed productivity, and its deletion like a built-in one", () => {
    const sideProject = (startedAt: string) => segment({
      id: startedAt,
      startedAt,
      endedAt: new Date(Date.parse(startedAt) + 600_000).toISOString(),
      classification: { category: "custom-side0001", productivity: "neutral", source: "llm", confidence: 0.8 },
    });
    const options = { categoryProductivity: { "custom-side0001": "focus" as const }, deletedCategories: { "custom-side0001": "2026-10-10T12:00:00.000Z" } };

    expect(classifyActivityDetailed(sideProject("2026-10-10T09:00:00.000Z"), options)).toMatchObject({ category: "custom-side0001", productivity: "focus" });
    expect(classifyActivityDetailed(sideProject("2026-10-10T13:00:00.000Z"), options).category).not.toBe("custom-side0001");
    const durations = buildCategoryDurations([sideProject("2026-10-10T09:00:00.000Z")], options);
    expect(durations.map((entry) => entry.category).slice(-2)).toEqual(["custom-side0001", "unknown"]);
    expect(durations.find((entry) => entry.category === "custom-side0001")?.totalSeconds).toBe(600);
  });

  it("drops added entries without a valid id or name, so an older reader never offers them", () => {
    expect(normalizeLiveCategoryGuidance([
      { category: "custom-ok000001", name: "  <독서>  ", added: true },
      { category: "learning", name: "학습", added: true },
      { category: "custom-noname01", added: true },
      { category: "custom-ok000001", name: "중복", added: true },
    ])).toEqual([{ category: "custom-ok000001", name: "독서", added: true }]);
  });
});

