import type { ActivitySegment, AppIconMap, AppIdentity } from "@drifty/domain";

export function collectMissingAppIconRequests(segments: readonly ActivitySegment[], currentIcons: AppIconMap): AppIdentity[] {
  const requests = new Map<string, AppIdentity>();

  for (const segment of segments) {
    const identity = segmentToAppIdentity(segment);
    const identityKey = appIconIdentityKey(identity);
    if (hasIconEntry(currentIcons, identityKey)) continue;
    if (!requests.has(identityKey)) requests.set(identityKey, identity);
  }

  return Array.from(requests.values());
}

export function mergeAppIconResults(currentIcons: AppIconMap, identities: readonly AppIdentity[], resolvedIcons: AppIconMap): AppIconMap {
  let changed = false;
  const nextIcons: AppIconMap = { ...currentIcons };

  for (const identity of identities) {
    const identityKey = appIconIdentityKey(identity);
    const iconSrc = resolvedIcons[identityKey] ?? resolvedIcons[identity.appName] ?? null;

    if (nextIcons[identityKey] !== iconSrc) {
      nextIcons[identityKey] = iconSrc;
      changed = true;
    }
    if (nextIcons[identity.appName] !== iconSrc) {
      nextIcons[identity.appName] = iconSrc;
      changed = true;
    }
  }

  return changed ? nextIcons : currentIcons;
}

function segmentToAppIdentity(segment: ActivitySegment): AppIdentity {
  const bundleId = segment.bundleId?.trim();
  return { appName: segment.appName, bundleId: bundleId ? bundleId : null };
}

export function appIconIdentityKey(identity: AppIdentity): string {
  const bundleId = identity.bundleId?.trim();
  return bundleId ? bundleId : identity.appName;
}

function hasIconEntry(appIcons: AppIconMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(appIcons, key);
}

export type AppIconLoadRequest = {
  readonly segments: readonly ActivitySegment[];
  readonly shouldReportFailure?: () => boolean;
  readonly failureMessage: string;
};
