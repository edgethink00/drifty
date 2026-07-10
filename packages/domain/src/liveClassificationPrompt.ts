/**
 * Canonical builder for the LIVE (first-pass) activity-classification prompt.
 *
 * This is the single source of truth for the cloud edge function
 * (`classify-activity`), the on-device local-provider path
 * (`localAiProviderRequest.ts`), and the offline eval harness
 * (`scripts/eval-live-classification`). Keep it dependency-free and
 * environment-agnostic (no Deno / Node / DOM APIs) so every surface can import it.
 *
 * The prompt version is tracked separately by each call site
 * (`v6-productivity-rubric`); bump those in lockstep when the wording changes.
 */

export type LiveProductivityLabel = "focus" | "neutral" | "drift";

export type LiveActivityCategory =
  | "workspace"
  | "learning"
  | "communication"
  | "music"
  | "game"
  | "social_media"
  | "entertainment"
  | "shopping"
  | "utility"
  | "unknown";

export const LIVE_ACTIVITY_CATEGORIES: readonly LiveActivityCategory[] = [
  "workspace",
  "learning",
  "communication",
  "music",
  "game",
  "social_media",
  "entertainment",
  "shopping",
  "utility",
  "unknown",
];

export const LIVE_PRODUCTIVITY_LABELS: readonly LiveProductivityLabel[] = [
  "focus",
  "neutral",
  "drift",
];

/** The prompt-relevant subset of a minimized activity item. */
export interface LiveClassificationPromptItem {
  readonly id: string;
  readonly appName?: string;
  readonly domain?: string;
  readonly urlHost?: string;
  readonly siteUrl?: string;
  readonly windowTitle?: string;
  readonly title?: string;
  readonly youtubeChannelName?: string;
  readonly youtubeCategory?: string;
  readonly redditCommunity?: string;
  readonly durationSeconds?: number;
}

/**
 * Prompt variant toggles, used to A/B prompt improvements offline before they
 * ship. With no options this returns the exact v6 (`v6-productivity-rubric`)
 * wording; each flag layers one measured improvement on top.
 */
export interface LiveClassificationPromptOptions {
  /** A-1: replace the terse neutral rubric with explicit category + productivity definitions. */
  readonly includeDefinitions?: boolean;
  /**
   * A-2: pin near-certain category→productivity anchors. `"full"` also pins
   * learning→focus; `"workspace-game"` drops the contested learning anchor
   * (personal-topic learning — news, help threads — is legitimately non-focus).
   * Omit for no anchors.
   */
  readonly couplingAnchors?: "full" | "workspace-game";
}

// A-1: one-line gloss per category so boundaries aren't guessed.
// Exported so the edge (`classify-activity`) and client
// (`localAiProviderRequest`) copies can be pinned against these canonical
// strings by liveClassificationPromptParity.test.ts.
export const LIVE_CATEGORY_DEFINITIONS = [
  "Category definitions:",
  "- workspace: doing work in professional, dev, or business tools/sites (editors, terminals, analytics, ads, dashboards, business apps, code hosting, deploy, cloud consoles).",
  "- learning: seeking or reading information — web search, docs, tutorials, technical articles, AI-assistant chats, reference reading.",
  "- communication: messaging, email, chat, or meetings (Slack, Discord, email, Zoom/Meet), whatever the topic.",
  "- music: listening to or managing music.",
  "- game: playing a game.",
  "- social_media: browsing personal social feeds, posts, or profiles.",
  "- entertainment: watching videos/streams or other leisure media.",
  "- shopping: browsing or buying products (product pages, marketplaces, carts).",
  "- utility: personal admin and system tasks — settings, cloud storage, app stores, sign-in, account/service/booking management (including travel booking management), finance/quote lookups, maps.",
  "- unknown: not enough evidence to tell.",
].join("\n");

// A-1: define the productivity axis. Encodes the confirmed policy — work
// communication is focus, personal communication and personal admin/reading are
// neutral, work-relevant content browsed on social platforms is neutral, and
// no-evidence is never drift.
export const LIVE_PRODUCTIVITY_DEFINITIONS = [
  "Productivity definitions:",
  "- focus: on-task work, work-adjacent activity that supports it (work tools, work-related search/reading/AI-chat/tutorials, account or business setup), and work communication (work chat channels, team servers, work meetings). Use the work profile to judge relevance.",
  "- neutral: supporting or in-between activity that is neither deep work nor a distraction — personal communication (friends, personal DMs), background music, purposeful personal admin (settings, cloud storage, app store, account/service/booking management, finance quotes), personal informational reading (personal finance or news, general non-work research), and work-relevant discussion read on a social platform.",
  "- drift: off-task personal leisure — personal social feeds and posts, entertainment video/streams, games, product shopping, and idle browsing.",
  "- When evidence is insufficient, use category unknown with productivity neutral and confidence 0.5 or lower. Never label an activity drift just because you cannot tell what it is.",
].join("\n");

// A-2: only the near-certain couplings are pinned; everything else stays model-judged.
export const LIVE_COUPLING_ANCHORS_LINE: Record<"full" | "workspace-game", string> = {
  full: "Category productivity anchors: workspace and learning are always focus; game is always drift. For every other category, judge productivity from the evidence.",
  "workspace-game": "Category productivity anchors: workspace is always focus; game is always drift. For every other category (including learning), judge productivity from the evidence.",
};

// v6 wording, kept verbatim for the baseline variant.
const V6_NEUTRAL_RUBRIC =
  "Use neutral only for genuinely in-between activities, such as background music while working or brief communication with unclear purpose. Do not use neutral as an uncertainty fallback: if your reason says the activity is professional or work-related, the label must be focus, even for supporting tools, consoles, account setup, or work-relevant research. If the evidence is insufficient to decide, use category unknown with confidence 0.5 or lower instead of guessing.";

export function buildLiveClassificationPrompt(
  items: readonly LiveClassificationPromptItem[],
  workProfile: string | null = null,
  options: LiveClassificationPromptOptions = {},
): string {
  return [
    "Classify each activity into activity category, productivity label, confidence, and short reason.",
    ...(workProfile
      ? [
          `User work profile: ${workProfile}.`,
          "Use the user's work profile as context when deciding whether an activity is work-related.",
        ]
      : []),
    primaryEvidenceGuidance(items),
    ...redditPromptGuidance(items),
    "Use only these categories: workspace, learning, communication, music, game, social_media, entertainment, shopping, utility, unknown.",
    "Use only these productivity labels: focus, neutral, drift.",
    ...(options.includeDefinitions
      ? [LIVE_CATEGORY_DEFINITIONS, LIVE_PRODUCTIVITY_DEFINITIONS]
      : [V6_NEUTRAL_RUBRIC]),
    ...(options.couplingAnchors ? [LIVE_COUPLING_ANCHORS_LINE[options.couplingAnchors]] : []),
    "Return JSON only in the shape {\"results\":[{\"id\":string,\"category\":string,\"productivity\":string,\"confidence\":number,\"reason\":string}]}. Do not include raw titles, domains, or work profile details in the reason.",
    JSON.stringify(items.map(promptItem)),
  ].join("\n");
}

function primaryEvidenceGuidance(items: readonly LiveClassificationPromptItem[]): string {
  const hasYouTubeContext = items.some((item) => item.youtubeChannelName || item.youtubeCategory);
  const contentEvidence = hasYouTubeContext
    ? "page/video title, YouTube channel name, YouTube video category"
    : "page title";
  return `Use the observed app, site, optional URL path, window title, ${contentEvidence}, and duration as the primary evidence.`;
}

function redditPromptGuidance(items: readonly LiveClassificationPromptItem[]): readonly string[] {
  if (!items.some((item) => item.redditCommunity)) return [];
  return [
    "Reddit-specific guidance: apply only to items with redditCommunity. Do not classify Reddit as social_media from the domain alone; prioritize the community, title, optional URL path, and apparent task intent.",
    "For Reddit items, use social_media only for casual feeds, memes, personal updates, or general scrolling. Work, tool, study, or product-research communities may be workspace, learning, utility, neutral, or unknown.",
  ];
}

function promptItem({
  id,
  appName,
  domain,
  urlHost,
  siteUrl,
  windowTitle,
  title,
  youtubeChannelName,
  youtubeCategory,
  redditCommunity,
  durationSeconds,
}: LiveClassificationPromptItem): Record<string, unknown> {
  return {
    id,
    appName,
    domain,
    urlHost,
    ...(siteUrl ? { siteUrl } : {}),
    ...(windowTitle ? { windowTitle } : {}),
    ...(title ? { title } : {}),
    ...(youtubeChannelName ? { youtubeChannelName } : {}),
    ...(youtubeCategory ? { youtubeCategory } : {}),
    ...(redditCommunity ? { redditCommunity } : {}),
    durationSeconds,
  };
}

/** Gemini structured-output schema, mirrored by the cloud edge function. */
export function liveClassificationResponseSchema(): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      results: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            category: { type: "STRING", enum: [...LIVE_ACTIVITY_CATEGORIES] },
            productivity: { type: "STRING", enum: [...LIVE_PRODUCTIVITY_LABELS] },
            confidence: { type: "NUMBER" },
            reason: { type: "STRING" },
          },
          required: ["id", "category", "productivity", "confidence", "reason"],
        },
      },
    },
    required: ["results"],
  };
}
