/**
 * Canonical deterministic policy for LIVE (first-pass) activity classification.
 *
 * Keep this module dependency-free and environment-agnostic. The Supabase Edge
 * runtime consumes a generated deployment mirror under `functions/_shared`;
 * edit this source, then run `npm run sync:live-classification-policy`.
 */

export type LiveProductivityLabel = "focus" | "neutral" | "drift";

export type LiveActivityIntent =
  | "work_execution"
  | "work_support"
  | "informational"
  | "in_between"
  | "personal_admin"
  | "leisure"
  | "unknown";

export const LIVE_ACTIVITY_INTENTS: readonly LiveActivityIntent[] = [
  "work_execution",
  "work_support",
  "informational",
  "in_between",
  "personal_admin",
  "leisure",
  "unknown",
];

export type LiveWorkRelation =
  | "direct_work"
  | "work_support"
  | "not_work"
  | "unknown";
export type LiveLeisureEvidence = "explicit" | "absent";

export const LIVE_WORK_RELATIONS: readonly LiveWorkRelation[] = [
  "direct_work",
  "work_support",
  "not_work",
  "unknown",
];

export const LIVE_LEISURE_EVIDENCE: readonly LiveLeisureEvidence[] = [
  "explicit",
  "absent",
];

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

/** The policy-relevant subset of a minimized activity item. */
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

export type LivingSoulPatternConfidence = "low" | "medium" | "high";

export interface LivingSoulPromptPattern {
  readonly summary: string;
  readonly confidence: LivingSoulPatternConfidence;
  readonly evidenceCount: number;
}

export interface LivingSoulPromptContext {
  readonly revision: number;
  readonly declared: {
    readonly workActivities: readonly string[];
    readonly workDomain: string | null;
    readonly workDescription?: string | null;
    readonly purpose: string | null;
  };
  readonly learnedWorkSupport: readonly LivingSoulPromptPattern[];
  /** Query-time Soul evidence retrieved only for an exact selector match in this item's Episode. */
  readonly matchedContextualWorkSupport?: readonly LivingSoulPromptPattern[];
  readonly learnedDrift: readonly LivingSoulPromptPattern[];
  readonly ambiguities: readonly LivingSoulPromptPattern[];
}

export interface RecentEpisodePromptTransition {
  readonly appName: string;
  readonly domain?: string;
  readonly title?: string;
  readonly durationSeconds: number;
}

export interface RecentEpisodePromptContext {
  readonly windowMinutes: number;
  readonly observedMinutes: number;
  readonly dominantSurface: string | null;
  readonly currentSurfaceSeconds: number;
  readonly transitions: readonly RecentEpisodePromptTransition[];
}

export interface LiveClassificationMemoryContext {
  readonly soul: LivingSoulPromptContext | null;
  readonly episodeByItemId: Readonly<Record<string, RecentEpisodePromptContext>>;
}

export function productivityForLiveActivityIntent(
  intent: LiveActivityIntent,
): LiveProductivityLabel {
  if (intent === "work_execution" || intent === "work_support") return "focus";
  if (intent === "leisure") return "drift";
  return "neutral";
}

export const LIVE_CLASSIFICATION_RESOLUTION_MAX_CONFIDENCE = 0.5;

/**
 * Provider confidence describes the provider's original intent decision. Once
 * a deterministic resolver changes the resulting productivity, that value no
 * longer measures confidence in the final label. Keep the original value only
 * when the two decisions agree; otherwise make the resolution explicitly
 * uncertain so intervention gates cannot treat it as high-confidence drift.
 */
export function confidenceForResolvedLiveActivityProductivity(
  rawConfidence: number,
  rawProductivity: LiveProductivityLabel,
  finalProductivity: LiveProductivityLabel,
): number {
  const boundedConfidence = Number.isFinite(rawConfidence)
    ? Math.min(1, Math.max(0, rawConfidence))
    : LIVE_CLASSIFICATION_RESOLUTION_MAX_CONFIDENCE;
  return rawProductivity === finalProductivity
    ? boundedConfidence
    : Math.min(boundedConfidence, LIVE_CLASSIFICATION_RESOLUTION_MAX_CONFIDENCE);
}

const DEDICATED_WORKSPACE_APPS = new Set([
  "android studio",
  "cursor",
  "intellij idea",
  "iterm",
  "iterm2",
  "notion",
  "pycharm",
  "sublime text",
  "terminal",
  "visual studio code",
  "webstorm",
  "xcode",
  "zed",
]);

/**
 * v8 safety resolver: retain intent-first classification while pinning only
 * surfaces whose semantics are stronger than a model's title interpretation.
 */
export function resolveLiveActivityProductivity(
  intent: LiveActivityIntent,
  category: LiveActivityCategory,
  appName?: string,
): LiveProductivityLabel {
  if (appName && DEDICATED_WORKSPACE_APPS.has(appName.trim().toLowerCase()))
    return "focus";
  if (category === "workspace") return "focus";
  if (category === "game") return "drift";
  if (category === "music") return "neutral";
  return productivityForLiveActivityIntent(intent);
}

export function resolveLiveActivityEvidenceProductivity(
  workRelation: LiveWorkRelation,
  leisureEvidence: LiveLeisureEvidence,
  category: LiveActivityCategory,
  appName?: string,
): LiveProductivityLabel {
  const inferred: LiveProductivityLabel =
    workRelation === "direct_work" || workRelation === "work_support"
      ? "focus"
      : leisureEvidence === "explicit"
        ? "drift"
        : "neutral";
  if (appName && DEDICATED_WORKSPACE_APPS.has(appName.trim().toLowerCase()))
    return "focus";
  if (category === "workspace") return "focus";
  if (category === "game") return "drift";
  if (category === "music") return "neutral";
  return inferred;
}

const KNOWN_SHOPPING_HOST_FRAGMENTS = [
  "11st.co",
  "aliexpress.",
  "amazon.",
  "coupang.",
  "ebay.",
  "gmarket.",
  "musinsa.",
  "shopping.naver.",
  "smartstore.naver.",
  "temu.",
  "wconcept.",
];

const EXPLICIT_SHOPPING_TEXT_PATTERN =
  /(?:가격|특가|할인|구매|상품|쇼핑|장바구니|주문|판매|스토어|마켓|\bprice\b|\bsale\b|\bdiscount\b|\bbuy\b|\bproduct\b|\bshop\b|\bcart\b|\bcheckout\b|\bmarketplace\b)/i;

/** High-precision observed evidence for a consumer shopping decision. */
export function hasExplicitLiveShoppingEvidence(
  item: LiveClassificationPromptItem,
): boolean {
  const host = `${item.domain ?? ""} ${item.urlHost ?? ""}`.toLowerCase();
  if (KNOWN_SHOPPING_HOST_FRAGMENTS.some((fragment) => host.includes(fragment)))
    return true;
  const text = [item.title, item.windowTitle, item.siteUrl]
    .filter(Boolean)
    .join(" ");
  return EXPLICIT_SHOPPING_TEXT_PATTERN.test(text);
}

/**
 * High-precision v8.2 safety gate. An unsupported shopping guess must never be
 * enough to turn an otherwise ambiguous activity into drift.
 */
export function applyLiveShoppingEvidenceGuard(
  productivity: LiveProductivityLabel,
  category: LiveActivityCategory,
  item: LiveClassificationPromptItem,
): LiveProductivityLabel {
  return productivity === "drift" &&
    category === "shopping" &&
    !hasExplicitLiveShoppingEvidence(item)
    ? "neutral"
    : productivity;
}

export const MATCHED_CONTEXTUAL_DRIFT_GUARD_MAX_SECONDS = 180;
export const MATCHED_CONTEXTUAL_DRIFT_GUARD_MIN_EVIDENCE = 5;
export const MATCHED_CONTEXTUAL_DRIFT_SAFETY_REASON =
  "Kept neutral because a mature matched work context made a short drift decision uncertain.";

/**
 * A mature item-matched prior may suppress a destructive drift decision for a
 * short transition. It never upgrades the item to focus, and it does not hide
 * sustained use or semantically hard drift categories.
 */
export function applyMatchedContextualDriftSafetyGuard(
  productivity: LiveProductivityLabel,
  category: LiveActivityCategory,
  item: LiveClassificationPromptItem,
  memoryContext: LiveClassificationMemoryContext | null,
): LiveProductivityLabel {
  if (
    productivity !== "drift" ||
    category === "game" ||
    category === "shopping"
  )
    return productivity;
  const matureMatch = memoryContext?.soul?.matchedContextualWorkSupport?.some(
    (pattern) =>
      pattern.evidenceCount >= MATCHED_CONTEXTUAL_DRIFT_GUARD_MIN_EVIDENCE &&
      pattern.confidence !== "low",
  );
  if (!matureMatch) return productivity;
  const episode = memoryContext?.episodeByItemId[item.id];
  if (!episode) return productivity;
  const currentSeconds = Math.max(
    episode.currentSurfaceSeconds,
    item.durationSeconds ?? 0,
  );
  return currentSeconds > 0 &&
    currentSeconds <= MATCHED_CONTEXTUAL_DRIFT_GUARD_MAX_SECONDS
    ? "neutral"
    : productivity;
}

/** Production v8.2 resolver: intent mapping, narrow surface guards, then shopping evidence. */
export function resolveLiveActivityClassificationProductivity(
  intent: LiveActivityIntent,
  category: LiveActivityCategory,
  item: LiveClassificationPromptItem,
  memoryContext: LiveClassificationMemoryContext | null = null,
): LiveProductivityLabel {
  const shoppingGuarded = applyLiveShoppingEvidenceGuard(
    resolveLiveActivityProductivity(intent, category, item.appName),
    category,
    item,
  );
  return applyMatchedContextualDriftSafetyGuard(
    shoppingGuarded,
    category,
    item,
    memoryContext,
  );
}
