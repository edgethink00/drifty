import type { ActivityClassification, ActivitySegment } from "./activity";

/**
 * Social domains are not single-purpose. The same host serves a doomscroll
 * feed, a work DM thread, and a competitor's profile someone was told to go
 * read. Classifying the whole host as drift made the drift alarm — and the
 * extreme nudge that closes tabs — fire on all three.
 *
 * This mirrors the YouTube split that already exists: consumption surfaces
 * resolve to drift on their own, purposeful surfaces stay unknown so
 * inheritance and the AI gate decide, and the ambiguous home feed only
 * becomes drift once the user has actually settled into it.
 */
export const SOCIAL_FEED_DRIFT_MINIMUM_SECONDS = 30;

type SocialSiteId = "instagram" | "x" | "facebook" | "tiktok";

type SocialSiteRules = {
  readonly id: SocialSiteId;
  readonly hosts: readonly string[];
  /** Paths that are the product's consumption surface: drift without further proof. */
  readonly consumptionPaths: readonly RegExp[];
  /** Paths with an explicit non-browsing purpose: never auto-drift. */
  readonly purposefulPaths: readonly RegExp[];
  /** The bare home feed, drift only once sustained. */
  readonly homePaths: readonly RegExp[];
};

const SOCIAL_SITE_RULES: readonly SocialSiteRules[] = [
  {
    id: "instagram",
    hosts: ["instagram.com"],
    consumptionPaths: [/^\/reels?(?:\/|$)/, /^\/explore(?:\/|$)/, /^\/stories(?:\/|$)/],
    purposefulPaths: [/^\/direct(?:\/|$)/, /^\/accounts(?:\/|$)/, /^\/notifications(?:\/|$)/],
    homePaths: [/^\/$/],
  },
  {
    id: "x",
    hosts: ["x.com", "twitter.com"],
    consumptionPaths: [/^\/explore(?:\/|$)/, /^\/i\/trending(?:\/|$)/, /^\/i\/grok(?:\/|$)/],
    purposefulPaths: [/^\/messages(?:\/|$)/, /^\/notifications(?:\/|$)/, /^\/settings(?:\/|$)/, /^\/compose(?:\/|$)/],
    homePaths: [/^\/$/, /^\/home(?:\/|$)/],
  },
  {
    id: "facebook",
    hosts: ["facebook.com"],
    consumptionPaths: [/^\/reel(?:\/|$)/, /^\/watch(?:\/|$)/, /^\/stories(?:\/|$)/],
    purposefulPaths: [/^\/messages(?:\/|$)/, /^\/notifications(?:\/|$)/, /^\/settings(?:\/|$)/],
    homePaths: [/^\/$/],
  },
  {
    id: "tiktok",
    hosts: ["tiktok.com"],
    consumptionPaths: [/^\/foryou(?:\/|$)/, /^\/explore(?:\/|$)/, /^\/@[^/]+\/video(?:\/|$)/],
    purposefulPaths: [/^\/messages(?:\/|$)/, /^\/notifications(?:\/|$)/, /^\/setting(?:\/|$)/],
    homePaths: [/^\/$/],
  },
];

export type SocialSurfaceKind = "consumption" | "purposeful" | "home_feed" | "other";

export type SocialSurface = {
  readonly siteId: SocialSiteId;
  readonly kind: SocialSurfaceKind;
};

export function resolveSocialSurface(segment: ActivitySegment): SocialSurface | null {
  const rules = findSocialSiteRules(segment.siteDomain);
  if (!rules) return null;

  const path = socialPathFromUrl(segment.siteUrl);
  // Without a captured path there is no evidence of which surface this is.
  // Guessing here is exactly what made profile visits look like doomscrolling.
  if (path === null) return { siteId: rules.id, kind: "other" };

  if (rules.purposefulPaths.some((pattern) => pattern.test(path))) {
    return { siteId: rules.id, kind: "purposeful" };
  }
  if (rules.consumptionPaths.some((pattern) => pattern.test(path))) {
    return { siteId: rules.id, kind: "consumption" };
  }
  if (rules.homePaths.some((pattern) => pattern.test(path))) {
    return { siteId: rules.id, kind: "home_feed" };
  }
  return { siteId: rules.id, kind: "other" };
}

export function isSocialSite(siteDomain?: string | null): boolean {
  return findSocialSiteRules(siteDomain) !== null;
}

/**
 * The home feed is the one surface where dwell time is the signal. A glance
 * on the way to a DM is not drift; ten minutes of thumb-scrolling is.
 */
export function isSustainedSocialHomeFeed(segment: ActivitySegment): boolean {
  const surface = resolveSocialSurface(segment);
  return surface?.kind === "home_feed"
    && segment.durationSeconds >= SOCIAL_FEED_DRIFT_MINIMUM_SECONDS;
}

/**
 * A social surface that carries no verdict of its own and must be handed to
 * inheritance or the AI gate rather than assumed to be drift.
 */
export function isUnresolvedSocialSurface(segment: ActivitySegment): boolean {
  const surface = resolveSocialSurface(segment);
  if (!surface) return false;
  if (surface.kind === "consumption") return false;
  return !isSustainedSocialHomeFeed(segment);
}

export function classifySocialActivity(segment: ActivitySegment): ActivityClassification | null {
  const surface = resolveSocialSurface(segment);
  if (!surface) return null;

  if (surface.kind === "consumption") {
    return { category: "social_media", productivity: "drift" };
  }
  if (isSustainedSocialHomeFeed(segment)) {
    return { category: "social_media", productivity: "drift" };
  }
  // Purposeful surfaces, brief home-feed glances, and specific profiles or
  // posts stay unknown: neutral here means "not yet judged", not "fine".
  return { category: "unknown", productivity: "neutral" };
}

function findSocialSiteRules(siteDomain?: string | null): SocialSiteRules | null {
  const host = normalizeSocialHost(siteDomain);
  if (!host) return null;
  return SOCIAL_SITE_RULES.find((rules) => rules.hosts.some(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  )) ?? null;
}

function normalizeSocialHost(value?: string | null): string {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./, "").replace(/^m\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function socialPathFromUrl(siteUrl?: string | null): string | null {
  const trimmed = siteUrl?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const pathname = parsed.pathname || "/";
    return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : "/";
  } catch {
    return null;
  }
}
