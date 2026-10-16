import { buildHourlySummary, findMatchingClassificationRule, topSites as buildTopSites } from "@drifty/domain";
import type {
  ActivityBlockLabelRecord,
  ActivityBlockLabelSaveInput,
  ActivityBlockUserLabelInput,
  ActivityCategory,
  ActivityClassificationRecord,
  ActivitySegment,
  AppIconMap,
  AppIdentity,
  ClassificationRuleInput,
  ClassificationRulePreview,
  HourBucket,
  ProductivityLabel,
  Project,
  ProjectAssignmentRecord,
  ProjectAssignmentsSaveResult,
  ProjectInput,
  SiteDuration,
  TimelinePage,
  TimelinePageQuery,
  TimelineQuery,
  TimelineSearchQuery,
  TrackerStatus,
} from "@drifty/domain";
import { localDateKey } from "../formatting";

const PREVIEW_FIXTURE_REASON = "Preview fixture classification";

type PreviewActivitySegment = ActivitySegment & { category: ActivityCategory; productivity: ProductivityLabel };
type PreviewSegmentSpec = readonly [
  id: string,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  appName: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
  overrides?: Partial<PreviewActivitySegment>,
];

const PREVIEW_APP_BUNDLE_IDS: Readonly<Record<string, string>> = {
  Arc: "company.thebrowser.Browser",
  Figma: "com.figma.Desktop",
  Linear: "com.linear",
  Mail: "com.apple.mail",
  Messages: "com.apple.MobileSMS",
  Notion: "notion.id",
  Slack: "com.tinyspeck.slackmacgap",
  Spotify: "com.spotify.client",
  "Visual Studio Code": "com.microsoft.VSCode",
};

const PREVIEW_APP_ICON_SOURCES: Readonly<Record<string, string>> = {
  "com.1password.1password":
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><rect width='48' height='48' rx='11' fill='%230a85ea'/><circle cx='24' cy='24' r='14' fill='none' stroke='%23ffffff' stroke-width='4'/><circle cx='24' cy='24' r='4' fill='%23ffffff'/><rect x='22' y='24' width='4' height='7' rx='1.5' fill='%23ffffff'/></svg>",
  "com.apple.keychainaccess":
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><rect width='48' height='48' rx='11' fill='%234a5568'/><circle cx='19' cy='22' r='7' fill='none' stroke='%23ecc94b' stroke-width='3.5'/><rect x='24' y='20' width='15' height='4' rx='1.5' fill='%23ecc94b'/><rect x='32' y='24' width='3' height='4' rx='1' fill='%23ecc94b'/><rect x='36' y='24' width='3' height='3' rx='1' fill='%23ecc94b'/></svg>",
  "com.apple.Safari":
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><rect width='48' height='48' rx='11' fill='%23ffffff'/><circle cx='24' cy='24' r='18' fill='%23007aff'/><polygon points='24,10 28,24 24,24' fill='%23ff3b30'/><polygon points='24,38 20,24 24,24' fill='%23ffffff'/><polygon points='24,10 20,24 24,24' fill='%23ff9500'/><polygon points='24,38 28,24 24,24' fill='%23d1d1d6'/></svg>",
  "com.apple.mail": "./assets/mail-CrE6QGcD.png",
  "com.apple.MobileSMS": "./assets/messages-aYNxSzkK.png",
  // Preview icons are bundled assets only. This one used to point at the
  // remote favicon service, which the webview CSP no longer allows now that
  // site icons are fetched natively; without a bundled Figma asset it falls
  // back to the lettered glyph.
  "com.linear": "./assets/linear-CuZX2ooj.png",
  "com.microsoft.VSCode": "./assets/visual-studio-code-DW738tZv.png",
  "com.spotify.client": "./assets/spotify-DuyINEyo.ico",
  "com.tinyspeck.slackmacgap": "./assets/slack-BKg3hZEm.png",
  "notion.id": "./assets/notion-CceIbM-j.png",
};

const PREVIEW_PROJECTS: readonly Project[] = [
  {
    id: "preview-project-drifty",
    name: "Drifty",
    description: "Desktop product and dashboard work",
    color: "#688c35",
    status: "active",
    anchors: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "preview-project-research",
    name: "Research",
    description: "Documentation and technical exploration",
    color: "#2f8b83",
    status: "active",
    anchors: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "preview-project-launch",
    name: "Launch",
    description: "Launch coordination and communication",
    color: "#c45f49",
    status: "active",
    anchors: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
];

const previewClassificationOverrides = new Map<string, Pick<ActivityClassificationRecord, "category" | "productivity">>();
const previewProjectOverrides = new Map<string, string | null>();
const previewDeletedSegmentIds = new Set<string>();
// Projects added, edited, archived or deleted in the browser preview. They
// live in memory only and reset on reload, the way the other review edits do.
// ?previewProjects=none starts with none, as for someone who has made none.
function initialPreviewProjects(): Project[] {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("previewProjects") === "none") return [];
  return PREVIEW_PROJECTS.map(cloneProject);
}
let previewProjectStore: Project[] = initialPreviewProjects();
let previewProjectSequence = 0;

function cloneProject(project: Project): Project {
  return { ...project, anchors: project.anchors.map((anchor) => ({ ...anchor })) };
}

function todayIsoDate() {
  return localDateKey(new Date());
}

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function at(day: string, hour: number, minute: number) {
  const date = new Date(`${day}T00:00:00`);
  date.setHours(hour, minute, 0, 0);
  return `${localDateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00`;
}

function secondsBetween(startedAt: string, endedAt: string) {
  return Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
}

/**
 * ?previewLevels=1 (browser preview only) shows added productivity levels: the
 * fixtures read as classified time, so fixed productivity applies to them, and
 * a "휴식" level holding entertainment is set up once if there is no level yet.
 */
const PREVIEW_LEVELS = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("previewLevels") === "1";

function seedPreviewLevel(): void {
  if (!PREVIEW_LEVELS || "__TAURI_INTERNALS__" in window) return;
  try {
    const productivityKey = "drifty.productivityCustomizations.v1";
    const categoryKey = "drifty.categoryCustomizations.v1";
    const productivity = JSON.parse(window.localStorage.getItem(productivityKey) ?? "{}") as Record<string, unknown>;
    if (Object.keys(productivity).some((key) => key.startsWith("level-"))) return;
    window.localStorage.setItem(productivityKey, JSON.stringify({ ...productivity, "level-rest0001": { name: "휴식", color: "#5b86b5", createdAt: "2026-10-16T00:00:00.000Z" } }));
    const categories = JSON.parse(window.localStorage.getItem(categoryKey) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(categoryKey, JSON.stringify({ ...categories, entertainment: { productivity: "neutral", level: "level-rest0001" } }));
  } catch {
    // Without storage the preview simply shows no level.
  }
}
seedPreviewLevel();

function previewBundleId(appName: string) {
  return PREVIEW_APP_BUNDLE_IDS[appName] ?? `com.fixture.${appName.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

function makeSegment(
  id: string,
  day: string,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  appName: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
  overrides: Partial<PreviewActivitySegment> = {},
): PreviewActivitySegment {
  const startedAt = at(day, startHour, startMinute);
  const endedAt = at(day, endHour, endMinute);
  const classification: PreviewActivitySegment["classification"] = overrides.classification ?? {
    category,
    productivity,
    // A fixed productivity applies to classified time, not manual corrections.
    source: PREVIEW_LEVELS ? "llm" : "manual",
    confidence: 0.96,
    reason: PREVIEW_FIXTURE_REASON,
    classifiedAt: endedAt,
  };

  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: secondsBetween(startedAt, endedAt),
    appName,
    bundleId: overrides.bundleId ?? previewBundleId(appName),
    windowTitle: overrides.windowTitle ?? null,
    browserName: overrides.browserName ?? null,
    siteDomain: overrides.siteDomain ?? null,
    siteTitle: overrides.siteTitle ?? null,
    category,
    productivity,
    classification,
    platform: "macos",
    source: "manual",
    confidence: 0.96,
    ...overrides,
  };
}

function todaySegments(day: string): PreviewActivitySegment[] {
  const specs: readonly PreviewSegmentSpec[] = [
    ["preview-t1", 9, 12, 9, 24, "Mail", "communication", "neutral", { windowTitle: "Inbox" }],
    ["preview-t2", 9, 30, 10, 16, "Visual Studio Code", "workspace", "focus", { windowTitle: "DashboardPage.tsx" }],
    ["preview-t3", 10, 16, 10, 22, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Pull request #284" }],
    ["preview-t4", 10, 22, 11, 3, "Visual Studio Code", "workspace", "focus", { windowTitle: "FlowChartView.tsx" }],
    ["preview-t5", 11, 10, 11, 16, "Slack", "communication", "neutral", { windowTitle: "#design-engineering" }],
    ["preview-t6", 11, 16, 11, 49, "Figma", "workspace", "focus", { windowTitle: "Category rhythm" }],
    ["preview-t7", 11, 49, 11, 54, "Arc", "social_media", "drift", { browserName: "Arc", siteDomain: "x.com", siteTitle: "Launch replies" }],
    ["preview-t8", 12, 44, 12, 56, "Arc", "entertainment", "drift", { browserName: "Arc", siteDomain: "youtube.com", siteTitle: "Product teardown" }],
    ["preview-t9", 13, 0, 13, 47, "Visual Studio Code", "workspace", "focus", { windowTitle: "AppUsagePanel.tsx" }],
    ["preview-t10", 13, 47, 13, 53, "Messages", "communication", "neutral", { windowTitle: "Min" }],
    ["preview-t11", 13, 53, 14, 27, "Figma", "workspace", "focus", { windowTitle: "Homepage crop options" }],
    ["preview-t12", 14, 33, 14, 39, "Arc", "social_media", "drift", { browserName: "Arc", siteDomain: "reddit.com", siteTitle: "r/productivity" }],
    ["preview-t13", 14, 39, 14, 56, "Arc", "entertainment", "drift", { browserName: "Arc", siteDomain: "youtube.com", siteTitle: "Short review" }],
    ["preview-t14", 14, 56, 15, 35, "Visual Studio Code", "workspace", "focus", { windowTitle: "Dashboard QA" }],
    ["preview-t15", 18, 32, 18, 40, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "drifty.so", siteTitle: "Homepage preview" }],
    ["preview-t16", 18, 40, 19, 24, "Visual Studio Code", "workspace", "focus", { windowTitle: "Homepage demo" }],
    ["preview-t17", 19, 24, 19, 39, "Arc", "social_media", "drift", { browserName: "Arc", siteDomain: "x.com", siteTitle: "Launch replies" }],
    ["preview-t18", 19, 44, 19, 50, "Linear", "workspace", "focus", { windowTitle: "Demo follow-up" }],
    ["preview-t19", 19, 50, 20, 15, "Visual Studio Code", "workspace", "focus", { windowTitle: "Homepage demo" }],
    ["preview-t20", 20, 15, 20, 23, "Slack", "communication", "neutral", { windowTitle: "#launch-room" }],
  ];
  return specs.map(([id, startHour, startMinute, endHour, endMinute, appName, category, productivity, overrides]) =>
    makeSegment(id, day, startHour, startMinute, endHour, endMinute, appName, category, productivity, overrides),
  );
}

function weekSegments(today: string): PreviewActivitySegment[] {
  const plans: ReadonlyArray<readonly [offset: number, segments: readonly PreviewSegmentSpec[]]> = [
    [1, [
      ["thu-mail", 8, 48, 9, 3, "Mail", "communication", "neutral", { windowTitle: "Investor updates" }],
      ["thu-code-a", 9, 8, 10, 22, "Visual Studio Code", "workspace", "focus", { windowTitle: "billingService.ts" }],
      ["thu-github", 10, 25, 10, 54, "Arc", "workspace", "focus", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Review billing entitlement PR" }],
      ["thu-slack", 11, 6, 11, 22, "Slack", "communication", "neutral", { windowTitle: "#launch-room" }],
      ["thu-figma", 13, 2, 14, 18, "Figma", "workspace", "focus", { windowTitle: "Pricing empty states" }],
      ["thu-linear", 14, 26, 14, 49, "Linear", "workspace", "focus", { windowTitle: "DTM-231 · AI setup copy" }],
      ["thu-code-b", 15, 4, 16, 36, "Visual Studio Code", "workspace", "focus", { windowTitle: "AiSetupPanel.tsx" }],
      ["thu-youtube", 17, 28, 18, 2, "Arc", "entertainment", "drift", { browserName: "Arc", siteDomain: "youtube.com", siteTitle: "WWDC recaps" }],
    ]],
    [2, [
      ["wed-notion", 8, 55, 9, 24, "Notion", "workspace", "focus", { windowTitle: "Release checklist" }],
      ["wed-code-a", 9, 32, 10, 46, "Visual Studio Code", "workspace", "focus", { windowTitle: "WeekDashboard.tsx" }],
      ["wed-docs", 10, 52, 11, 18, "Arc", "learning", "focus", { browserName: "Arc", siteDomain: "docs.rs", siteTitle: "tauri-plugin-store" }],
      ["wed-spotify", 12, 16, 12, 48, "Spotify", "music", "neutral", { windowTitle: "Deep Focus" }],
      ["wed-code-b", 13, 5, 14, 12, "Visual Studio Code", "workspace", "focus", { windowTitle: "previewData.ts" }],
      ["wed-slack", 14, 24, 14, 44, "Slack", "communication", "neutral", { windowTitle: "Design QA thread" }],
      ["wed-figma", 15, 9, 16, 2, "Figma", "workspace", "focus", { windowTitle: "Homepage crop options" }],
      ["wed-x", 17, 6, 17, 32, "Arc", "social_media", "drift", { browserName: "Arc", siteDomain: "x.com", siteTitle: "Launch replies" }],
    ]],
    [3, [
      ["tue-mail", 8, 35, 8, 58, "Mail", "communication", "neutral", { windowTitle: "Feedback digest" }],
      ["tue-figma", 9, 14, 10, 18, "Figma", "workspace", "focus", { windowTitle: "Cloud connected state" }],
      ["tue-code-a", 10, 26, 11, 37, "Visual Studio Code", "workspace", "focus", { windowTitle: "dashboardAiUnavailableState.ts" }],
      ["tue-github", 11, 40, 12, 7, "Arc", "workspace", "focus", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Actions run #842" }],
      ["tue-messages", 13, 2, 13, 16, "Messages", "communication", "neutral", { windowTitle: "Min" }],
      ["tue-linear", 13, 30, 14, 16, "Linear", "workspace", "focus", { windowTitle: "Triage visual regressions" }],
      ["tue-code-b", 14, 28, 15, 42, "Visual Studio Code", "workspace", "focus", { windowTitle: "flowHoverGroups.ts" }],
      ["tue-reddit", 17, 35, 18, 4, "Arc", "social_media", "drift", { browserName: "Arc", siteDomain: "reddit.com", siteTitle: "r/tauri" }],
    ]],
    [4, [
      ["mon-notion", 8, 50, 9, 20, "Notion", "workspace", "focus", { windowTitle: "Weekly plan" }],
      ["mon-code-a", 9, 28, 10, 52, "Visual Studio Code", "workspace", "focus", { windowTitle: "classificationViewData.ts" }],
      ["mon-slack", 11, 10, 11, 31, "Slack", "communication", "neutral", { windowTitle: "#product" }],
      ["mon-stack", 11, 36, 12, 3, "Arc", "learning", "focus", { browserName: "Arc", siteDomain: "stackoverflow.com", siteTitle: "CSS grid sticky rail" }],
      ["mon-code-b", 13, 12, 14, 38, "Visual Studio Code", "workspace", "focus", { windowTitle: "AppUsagePanel.tsx" }],
      ["mon-figma", 15, 2, 15, 46, "Figma", "workspace", "focus", { windowTitle: "Week calendar density" }],
      ["mon-youtube", 17, 41, 18, 16, "Arc", "entertainment", "drift", { browserName: "Arc", siteDomain: "youtube.com", siteTitle: "Desk setup review" }],
    ]],
    [5, [
      ["sun-docs", 10, 25, 11, 18, "Arc", "learning", "focus", { browserName: "Arc", siteDomain: "developer.apple.com", siteTitle: "App icon guidelines" }],
      ["sun-spotify", 12, 40, 13, 18, "Spotify", "music", "neutral", { windowTitle: "Sunday reset" }],
      ["sun-youtube", 14, 22, 15, 8, "Arc", "entertainment", "drift", { browserName: "Arc", siteDomain: "youtube.com", siteTitle: "Camera reviews" }],
    ]],
    [6, [
      ["sat-mail", 9, 45, 10, 6, "Mail", "communication", "neutral", { windowTitle: "Newsletter skim" }],
      ["sat-linear", 10, 22, 11, 4, "Linear", "workspace", "focus", { windowTitle: "Backlog pruning" }],
      ["sat-x", 13, 20, 13, 58, "Arc", "social_media", "drift", { browserName: "Arc", siteDomain: "x.com", siteTitle: "Weekend scroll" }],
    ]],
  ];
  return plans.flatMap(([offset, specs]) => {
    const day = shiftDay(today, -offset);
    return specs.map(([id, startHour, startMinute, endHour, endMinute, appName, category, productivity, overrides]) =>
      makeSegment(`preview-w${offset}-${id}`, day, startHour, startMinute, endHour, endMinute, appName, category, productivity, overrides),
    );
  });
}

function historySegments(today: string): PreviewActivitySegment[] {
  const segments: PreviewActivitySegment[] = [];
  for (let offset = 7; offset <= 60; offset += 1) {
    const day = shiftDay(today, -offset);
    const weekday = new Date(`${day}T12:00:00`).getDay();
    if (weekday === 0 || weekday === 6) {
      if (offset % 3 !== 0) {
        segments.push(makeSegment(`preview-h${offset}a`, day, 10, 20, 11, 30, "Arc", "learning", "focus", { siteDomain: "react.dev", browserName: "Arc" }));
        segments.push(makeSegment(`preview-h${offset}b`, day, 14, 15, 15, 5, "Arc", "entertainment", "drift", { siteDomain: "youtube.com", browserName: "Arc" }));
      }
    } else {
      const extraMinutes = (offset * 7) % 28;
      segments.push(makeSegment(`preview-h${offset}a`, day, 9, 10, 12, 5 + extraMinutes, "Visual Studio Code", "workspace", "focus"));
      segments.push(makeSegment(`preview-h${offset}b`, day, 13, 20, 16, 30, "Visual Studio Code", "workspace", "focus"));
      segments.push(makeSegment(`preview-h${offset}c`, day, 16, 35, 17, 20, "Slack", "communication", "neutral"));
      if (offset % 2 === 0) {
        segments.push(makeSegment(`preview-h${offset}d`, day, 17, 30, 18, 15, "Arc", "social_media", "drift", { siteDomain: "x.com", browserName: "Arc" }));
      }
    }
  }
  return segments;
}

function basePreviewProjectId(segment: ActivitySegment): string | null {
  if (
    segment.siteDomain === "docs.rs"
    || segment.siteDomain === "react.dev"
    || segment.siteDomain === "developer.apple.com"
    || segment.siteDomain === "stackoverflow.com"
  ) return "preview-project-research";
  if (segment.appName === "Mail" || segment.appName === "Messages" || segment.appName === "Slack") {
    return "preview-project-launch";
  }
  if (
    segment.appName === "Visual Studio Code"
    || segment.appName === "Figma"
    || segment.appName === "Linear"
    || segment.appName === "Notion"
    || segment.siteDomain === "github.com"
    || segment.siteDomain === "drifty.so"
  ) return "preview-project-drifty";
  return null;
}

function applyPreviewOverrides(segment: PreviewActivitySegment): PreviewActivitySegment {
  const classification = previewClassificationOverrides.get(segment.id);
  if (!classification) return segment;
  return {
    ...segment,
    category: classification.category,
    productivity: classification.productivity,
    classification: {
      ...segment.classification!,
      category: classification.category,
      productivity: classification.productivity,
      source: "manual",
      confidence: 1,
      reason: "Preview-only manual correction",
      classifiedAt: new Date().toISOString(),
    },
  };
}

function previewSegments(today = todayIsoDate()) {
  return [...todaySegments(today), ...weekSegments(today), ...historySegments(today)]
    .filter((segment) => !previewDeletedSegmentIds.has(segment.id))
    .map(applyPreviewOverrides);
}

export function previewProjects(): Project[] {
  return previewProjectStore.map(cloneProject);
}

/** Mirrors the tracker's save: a trimmed name is required, an unknown id creates. */
export function previewSaveProject(input: ProjectInput): Project {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  const now = new Date().toISOString();
  const existing = input.id ? previewProjectStore.find((project) => project.id === input.id) : undefined;
  if (!existing) previewProjectSequence += 1;
  const saved: Project = {
    id: existing?.id ?? input.id ?? `preview-project-new-${previewProjectSequence}`,
    name,
    description: input.description.trim(),
    color: input.color?.trim() || existing?.color || PREVIEW_PROJECTS[0]!.color,
    status: input.status ?? "active",
    anchors: existing?.anchors ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  previewProjectStore = existing
    ? previewProjectStore.map((project) => (project.id === saved.id ? saved : project))
    : [...previewProjectStore, saved];
  return cloneProject(saved);
}

/** Mirrors the tracker's delete: the project goes, and its matched time falls back to no project. */
export function previewDeleteProject(id: string): { deleted: number } {
  const before = previewProjectStore.length;
  previewProjectStore = previewProjectStore.filter((project) => project.id !== id);
  return { deleted: before - previewProjectStore.length };
}

export function previewProjectAssignments(query: TimelineQuery): ProjectAssignmentRecord[] {
  const projectIds = new Set(previewProjectStore.map((project) => project.id));
  return previewTimeline(query).map((segment) => {
    const projectId = previewProjectOverrides.has(segment.id)
      ? previewProjectOverrides.get(segment.id) ?? null
      : basePreviewProjectId(segment);
    return {
      segmentId: segment.id,
      projectId: projectId !== null && projectIds.has(projectId) ? projectId : null,
      source: previewProjectOverrides.has(segment.id) ? "manual" : "ai",
      confidence: previewProjectOverrides.has(segment.id) ? 1 : 0.9,
      reason: previewProjectOverrides.has(segment.id) ? "Preview-only manual project correction" : "Preview fixture project",
      assignedAt: segment.endedAt,
    };
  });
}

const previewActivityBlockLabels = new Map<string, ActivityBlockLabelRecord>();

function previewLabelKey(blockKey: string, source: ActivityBlockLabelRecord["source"]): string {
  return source + "|" + blockKey;
}

/** In-memory labels for the browser preview; nothing is generated or persisted. */
export function previewGetActivityBlockLabels(query: TimelineQuery): ActivityBlockLabelRecord[] {
  const start = "day" in query ? query.day : query.start.slice(0, 10);
  const end = "day" in query ? query.day : query.end.slice(0, 10);
  return [...previewActivityBlockLabels.values()].filter((label) => label.logicalDay >= start && label.logicalDay <= end);
}

export function previewSaveActivityBlockLabels(labels: readonly ActivityBlockLabelSaveInput[]): { saved: number; skipped: number } {
  for (const label of labels) {
    previewActivityBlockLabels.set(previewLabelKey(label.blockKey, "ai"), { ...label, source: "ai" });
  }
  return { saved: labels.length, skipped: 0 };
}

export function previewSaveActivityBlockUserLabel(label: ActivityBlockUserLabelInput, previousBlockKey?: string | null): ActivityBlockLabelRecord {
  if (previousBlockKey && previousBlockKey !== label.blockKey) previewActivityBlockLabels.delete(previewLabelKey(previousBlockKey, "user"));
  const title = label.title.trim();
  const record: ActivityBlockLabelRecord = {
    ...label,
    source: "user",
    status: title ? "user" : "hidden",
    title,
    description: title ? label.description.trim() : "",
  };
  previewActivityBlockLabels.set(previewLabelKey(label.blockKey, "user"), record);
  return record;
}

export function previewDeleteActivityBlockUserLabel(blockKey: string): { deleted: number } {
  return { deleted: previewActivityBlockLabels.delete(previewLabelKey(blockKey, "user")) ? 1 : 0 };
}

export function previewSaveProjectAssignments(
  assignments: readonly ProjectAssignmentRecord[],
): ProjectAssignmentsSaveResult {
  for (const assignment of assignments) previewProjectOverrides.set(assignment.segmentId, assignment.projectId);
  return { saved: assignments.length, skippedManual: 0 };
}

export function previewSaveClassifications(
  classifications: readonly ActivityClassificationRecord[],
): { saved: number } {
  for (const classification of classifications) {
    previewClassificationOverrides.set(classification.segmentId, {
      category: classification.category,
      productivity: classification.productivity,
    });
  }
  return { saved: classifications.length };
}

/**
 * The tracker's rule preview over the synthetic records; preview mode keeps no
 * rules. Fixtures carry a pinned "manual" source only so they read the same on
 * every screen; they stand for automatic results here, and only a correction
 * made in preview counts as the user's own.
 */
export function previewClassificationRule(input: ClassificationRuleInput): ClassificationRulePreview {
  let matchedCount = 0;
  let matchedSeconds = 0;
  let manualCount = 0;
  for (const segment of previewSegments()) {
    if (!findMatchingClassificationRule(segment, [{ ...input, enabled: true }])) continue;
    const stored = segment.classification;
    if (stored?.source === "manual" && stored.reason !== PREVIEW_FIXTURE_REASON) {
      manualCount += 1;
      continue;
    }
    matchedCount += 1;
    matchedSeconds += segment.durationSeconds;
  }
  return { matchedCount, matchedSeconds, manualCount };
}

export function previewDeleteActivitySegments(ids: readonly string[]): { deleted: number } {
  const availableIds = new Set(previewSegments().map((segment) => segment.id));
  let deleted = 0;
  for (const id of ids) {
    if (!availableIds.has(id) || previewDeletedSegmentIds.has(id)) continue;
    previewDeletedSegmentIds.add(id);
    deleted += 1;
  }
  return { deleted };
}

export function resetPreviewMutations(): void {
  previewClassificationOverrides.clear();
  previewProjectOverrides.clear();
  previewDeletedSegmentIds.clear();
  previewProjectStore = initialPreviewProjects();
  previewProjectSequence = 0;
}

function inRange(segment: PreviewActivitySegment, query: TimelineQuery) {
  if ("day" in query && query.day) return segment.startedAt.slice(0, 10) === query.day;
  const startedAt = new Date(segment.startedAt).getTime();
  const start = "start" in query && query.start ? new Date(query.start).getTime() : Number.NEGATIVE_INFINITY;
  const end = "end" in query && query.end ? new Date(query.end).getTime() : Number.POSITIVE_INFINITY;
  return startedAt >= start && startedAt <= end;
}

export function previewStatus(): TrackerStatus {
  return {
    running: true,
    accessibilityGranted: true,
    lastEventAt: at(todayIsoDate(), 20, 23),
    databasePath: "browser-preview",
    trackerMode: "preview",
    idleSeconds: 0,
    idleDetectionAvailable: true,
    message: "Browser preview data",
  };
}

export function previewTimeline(query: TimelineQuery): ActivitySegment[] {
  return previewSegments().filter((segment) => inRange(segment, query));
}

export function previewTimelinePage(query: TimelinePageQuery): TimelinePage {
  const rows = previewSegments()
    .filter((segment) => inTimelinePageRange(segment, query))
    .filter((segment) => isBeforeTimelinePageCursor(segment, query));
  return previewTimelinePageFromRows(rows, query);
}

export function previewTimelineSearch(query: TimelineSearchQuery): TimelinePage {
  const tokens = searchTokens(query.query);
  if (tokens.length === 0) return { items: [], hasMore: false, nextCursor: null };
  const rows = previewSegments()
    .filter((segment) => inTimelinePageRange(segment, query))
    .filter((segment) => isBeforeTimelinePageCursor(segment, query))
    .filter((segment) => segmentMatchesSearchTokens(segment, tokens));
  return previewTimelinePageFromRows(rows, query);
}

function previewTimelinePageFromRows(rows: readonly ActivitySegment[], query: TimelinePageQuery): TimelinePage {
  const limit = clampTimelinePageLimit(query.limit);
  const sortedRows = [...rows].sort(compareTimelinePageSegmentsDescending);
  const pageRows = sortedRows.slice(0, limit);
  const items = [...pageRows].reverse();
  const hasMore = sortedRows.length > limit;
  const cursorRow = hasMore ? pageRows[pageRows.length - 1] : null;
  return {
    items,
    hasMore,
    nextCursor: cursorRow
      ? {
          beforeEndedAt: cursorRow.endedAt,
          beforeSegmentId: cursorRow.id,
        }
      : null,
  };
}

function isBeforeTimelinePageCursor(segment: ActivitySegment, query: TimelinePageQuery): boolean {
  const beforeEndedAtMs = query.beforeEndedAt ? Date.parse(query.beforeEndedAt) : null;
  const beforeSegmentId = query.beforeSegmentId ?? null;
  if (beforeEndedAtMs === null || !Number.isFinite(beforeEndedAtMs) || beforeSegmentId === null) return true;
  const endedAtMs = Date.parse(segment.endedAt);
  return endedAtMs < beforeEndedAtMs || (endedAtMs === beforeEndedAtMs && segment.id < beforeSegmentId);
}

function searchTokens(query: string): readonly string[] {
  return query.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0);
}

function segmentMatchesSearchTokens(segment: PreviewActivitySegment, tokens: readonly string[]): boolean {
  const fields = previewSearchFields(segment);
  return tokens.every((token) => fields.some((field) => field.includes(token)));
}

function previewSearchFields(segment: PreviewActivitySegment): readonly string[] {
  return [
    segment.appName,
    segment.browserName,
    segment.siteDomain,
    segment.siteTitle,
    segment.siteUrl,
    segment.windowTitle,
    segment.classification?.category,
    segment.classification?.productivity,
    segment.category,
    segment.productivity,
  ]
    .filter((field): field is string => typeof field === "string" && field.length > 0)
    .map((field) => field.toLowerCase());
}

export function previewHourlySummary(query: TimelineQuery): HourBucket[] {
  return buildHourlySummary(previewTimeline(query));
}

export function previewTopSites(query: TimelineQuery & { limit?: number }): SiteDuration[] {
  return buildTopSites(previewTimeline(query), query.limit ?? 5);
}

export function previewAppIcons(apps: AppIdentity[]): AppIconMap {
  return apps.reduce<AppIconMap>((acc, app) => {
    const key = app.bundleId || app.appName;
    const iconSrc = PREVIEW_APP_ICON_SOURCES[key] ?? PREVIEW_APP_ICON_SOURCES[previewBundleId(app.appName)] ?? null;
    acc[key] = iconSrc;
    acc[app.appName] = iconSrc;
    return acc;
  }, {});
}

export function shouldUsePreviewData() {
  if (typeof window === "undefined") return false;
  if ("__TAURI_INTERNALS__" in window) return false;
  if (import.meta.env.VITE_DRIFTY_PREVIEW === "1") return true;
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get("driftyPreview") === "1") return true;
  try {
    const previewValue = window.localStorage.getItem("drifty.preview");
    if (previewValue === "1") return true;
  } catch {
    return false;
  }
  return false;
}

export function shouldUseLeaderboardPreview(): boolean {
  if (typeof window === "undefined") return false;
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get("leaderboardPreview") === "1") return true;
  return shouldUsePreviewData();
}

function clampTimelinePageLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 200;
  return Math.min(500, Math.max(1, Math.floor(limit)));
}

function inTimelinePageRange(segment: PreviewActivitySegment, query: TimelinePageQuery): boolean {
  if (query.day) return segment.startedAt.slice(0, 10) === query.day;
  const startedAt = new Date(segment.startedAt).getTime();
  const start = query.start ? new Date(query.start).getTime() : Number.NEGATIVE_INFINITY;
  const end = query.end ? new Date(query.end).getTime() : Number.POSITIVE_INFINITY;
  return startedAt >= start && startedAt <= end;
}

function compareTimelinePageSegmentsDescending(left: ActivitySegment, right: ActivitySegment): number {
  const endedAtDelta = Date.parse(right.endedAt) - Date.parse(left.endedAt);
  if (endedAtDelta !== 0) return endedAtDelta;
  return right.id.localeCompare(left.id);
}
