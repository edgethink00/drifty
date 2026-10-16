import {
  EXCLUDED_SITE_RULE_PREFIX,
  isExcludedSegment,
  isExcludedSiteRule,
  suggestedExcludedSite,
  type ExcludedAppRule,
} from "@drifty/domain";
import type { HistoryRow } from "./historyGroups";

/** What "don't record" on a History row keeps out of history: the row's site, or its app. */
export type HistoryExclusionTarget = {
  readonly kind: "site" | "app";
  /** The site rule's domain, or the app's name. */
  readonly name: string;
  readonly bundleId: string | null;
  /** The host the row was recorded on, when the rule covers more than that host. */
  readonly recordedHost: string | null;
};

/**
 * A browser row is about its site; the browser itself is never offered, since
 * that would hide all browsing. Other rows are about their app. Activity that
 * is already excluded has nothing left to hide.
 */
export function historyExclusionTarget(row: HistoryRow): HistoryExclusionTarget | null {
  if (isExcludedSegment(row)) return null;
  if (row.siteDomain) {
    const name = suggestedExcludedSite(row.siteDomain);
    if (!name) return null;
    const host = row.siteDomain.toLowerCase().replace(/^www\./u, "");
    return { kind: "site", name, bundleId: null, recordedHost: host !== name ? host : null };
  }
  if (row.browserName) return null;
  const name = row.appName.trim();
  return name ? { kind: "app", name, bundleId: row.bundleId?.trim() || null, recordedHost: null } : null;
}

/** The saved rule that already keeps this target out of history, if any. */
export function coveringExclusionRule(rules: readonly ExcludedAppRule[], target: HistoryExclusionTarget): ExcludedAppRule | null {
  for (const rule of rules) {
    if (target.kind === "site") {
      if (!isExcludedSiteRule(rule)) continue;
      if (target.name === rule.name || target.name.endsWith(`.${rule.name}`)) return rule;
      continue;
    }
    if (isExcludedSiteRule(rule)) continue;
    if (rule.bundleId && target.bundleId ? rule.bundleId === target.bundleId : rule.name.localeCompare(target.name, undefined, { sensitivity: "accent" }) === 0) return rule;
  }
  return null;
}

/** The rule saved for a target, in the same shape Settings saves. */
export function exclusionRuleFor(target: HistoryExclusionTarget): ExcludedAppRule {
  if (target.kind === "site") {
    return { id: EXCLUDED_SITE_RULE_PREFIX + target.name, name: target.name, bundleId: null, source: "user", kind: "site" };
  }
  return { id: target.bundleId || target.name, name: target.name, bundleId: target.bundleId, source: "user", kind: "app" };
}

/** The query that counts or deletes a rule's past records: a site's by domain, an app's by name and bundle ID. */
export function exclusionHistoryQuery(rule: Pick<ExcludedAppRule, "id" | "kind" | "name" | "bundleId">): { name: string; bundleId: string | null; siteDomain?: string } {
  return isExcludedSiteRule(rule)
    ? { name: rule.name, bundleId: null, siteDomain: rule.name }
    : { name: rule.name, bundleId: rule.bundleId ?? null };
}

/** What the History view asks the app to do: save the rule, delete its past records, or both. */
export type HistoryExclusionRequest = {
  readonly rule: ExcludedAppRule;
  readonly save: boolean;
  readonly deletePast: boolean;
};

export type HistoryExclusionOutcome = {
  readonly deleted: number;
  /** The rule was saved and past records were deleted, but reloading the view failed. */
  readonly refreshFailed?: boolean;
};

