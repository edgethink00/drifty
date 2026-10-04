import type { ActivitySegment } from "@drifty/domain";

export type ActivityDeviceSource = {
  readonly id: string | null;
  readonly label: string;
  readonly platform: "macos" | "windows" | "unknown";
};

/** Known other devices make provenance relevant even on a local-only day. */
export function buildActivityDevices(
  segments: readonly (Pick<ActivitySegment, "deviceId"> & Partial<Pick<ActivitySegment, "platform">>)[],
  knownLabels: ReadonlyMap<string, string> | undefined,
  thisDeviceLabel: string,
  syncedDeviceLabel: string,
  includeLocal = (knownLabels?.size ?? 0) > 0,
): ActivityDeviceSource[] {
  if (!includeLocal && !segments.some((segment) => segment.deviceId)) return [];
  const devices = new Map<string | null, { label: string; platforms: Set<"macos" | "windows"> }>();
  for (const segment of segments) {
    const id = segment.deviceId || null;
    const device = devices.get(id) ?? {
      label: id ? knownLabels?.get(id)?.trim() || syncedDeviceLabel : thisDeviceLabel,
      platforms: new Set<"macos" | "windows">(),
    };
    if (segment.platform === "macos" || segment.platform === "windows") device.platforms.add(segment.platform);
    devices.set(id, device);
  }
  return [...devices].map(([id, device]) => ({
    id, label: device.label,
    platform: device.platforms.size === 1 ? [...device.platforms][0] : "unknown",
  }));
}

/** Received history stays filterable when the live device list is unavailable. */
export function buildRemoteDeviceLabels(
  knownLabels: ReadonlyMap<string, string>,
  currentDeviceId: string | null,
  segmentGroups: readonly (readonly Pick<ActivitySegment, "deviceId">[])[],
  fallbackLabel: (number: number) => string,
): ReadonlyMap<string, string> {
  const ids = new Set(knownLabels.keys());
  for (const segments of segmentGroups) {
    for (const segment of segments) {
      if (segment.deviceId) ids.add(segment.deviceId);
    }
  }
  if (currentDeviceId) ids.delete(currentDeviceId);
  return new Map([...ids].sort().map((id, index) => [
    id, knownLabels.get(id)?.trim() || fallbackLabel(index + 1),
  ]));
}
