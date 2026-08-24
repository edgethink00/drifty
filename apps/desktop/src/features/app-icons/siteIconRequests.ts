import type { ActivitySegment } from "@drifty/domain";

/**
 * Site icons resolved to `data:` URLs, keyed by normalized domain. A `null`
 * value is a resolved miss - the domain has no usable icon - and is kept in
 * the map so it is not requested again.
 */
export type SiteIconMap = Readonly<Record<string, string | null>>;

export function normalizeSiteIconDomain(rawDomain: string): string | null {
  const domain = rawDomain.trim().toLowerCase().replace(/\.+$/, "");
  if (!domain || domain.length > 253) return null;
  // Browser-internal surfaces and extension IDs carry no dot.
  if (!domain.includes(".")) return null;
  if (domain === "localhost") return null;
  if (/[^a-z0-9.-]/.test(domain)) return null;
  if (domain.startsWith("-") || domain.startsWith(".") || domain.includes("..")) return null;
  // Bare IPv4 literals point at the local network, not a public site.
  if (/^\d+(\.\d+)*$/.test(domain)) return null;
  const tld = domain.split(".").pop() ?? "";
  if (tld.length < 2 || /[^a-z]/.test(tld)) return null;
  return domain;
}

export function collectMissingSiteIconRequests(
  segments: readonly ActivitySegment[],
  currentIcons: SiteIconMap,
): string[] {
  const requests = new Set<string>();

  for (const segment of segments) {
    if (!segment.siteDomain) continue;
    const domain = normalizeSiteIconDomain(segment.siteDomain);
    if (!domain) continue;
    if (hasIconEntry(currentIcons, domain)) continue;
    requests.add(domain);
  }

  return Array.from(requests);
}

/**
 * Records only the domains the native layer actually settled.
 *
 * The native batch caps how many domains it fetches per pass and omits the
 * rest, so a requested domain missing from the response means "not resolved
 * yet", not "no icon". Writing those as `null` would mark them resolved and
 * they would never be requested again, leaving permanent letter placeholders.
 */
export function mergeSiteIconResults(
  currentIcons: SiteIconMap,
  _domains: readonly string[],
  resolvedIcons: SiteIconMap,
): SiteIconMap {
  let changed = false;
  const nextIcons: Record<string, string | null> = { ...currentIcons };

  for (const [domain, iconSrc] of Object.entries(resolvedIcons)) {
    const nextIconSrc = iconSrc ?? null;
    if (!hasIconEntry(nextIcons, domain) || nextIcons[domain] !== nextIconSrc) {
      nextIcons[domain] = nextIconSrc;
      changed = true;
    }
  }

  return changed ? nextIcons : currentIcons;
}

function hasIconEntry(icons: SiteIconMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(icons, key);
}
