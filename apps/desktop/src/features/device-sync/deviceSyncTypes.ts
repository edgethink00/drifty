export type DeviceSyncBackfillProgress = {
  /** sync_counter value when the cycle ran — the end of known history. */
  readonly totalSeq: number;
  /** Push cursor — how far this device has uploaded. */
  readonly pushedSeq: number;
};

export type DeviceSyncStatus = {
  readonly enabled: boolean;
  readonly deviceId: string | null;
  readonly lastPushedAt: string | null;
  readonly lastPulledAt: string | null;
  readonly pendingPushCount: number;
  readonly backfill: DeviceSyncBackfillProgress | null;
  readonly lastError: string | null;
};

export const IDLE_DEVICE_SYNC_STATUS: DeviceSyncStatus = {
  enabled: false,
  deviceId: null,
  lastPushedAt: null,
  lastPulledAt: null,
  pendingPushCount: 0,
  backfill: null,
  lastError: null,
};

export type DeviceSyncCycleReason = "startup" | "interval" | "focus" | "visibility" | "manual";

export type SyncPushResponse = {
  readonly deviceId: string;
  readonly syncGeneration: number;
  readonly acceptedSegments: number;
  readonly acceptedDeletions: number;
  readonly serverTime: string;
};

export type SyncDeviceEntry = {
  readonly id: string;
  readonly label: string;
  readonly isCurrent: boolean;
  readonly isActive: boolean;
  readonly revokedAt: string | null;
};

export type SyncDevicesResponse = {
  readonly deviceId: string;
  readonly syncGeneration: number;
  readonly syncStatus: "active" | "paused";
  readonly devices: readonly SyncDeviceEntry[];
  readonly serverTime: string;
};

export type SyncPurgeResponse = {
  readonly deviceId: string;
  readonly syncGeneration: number;
  readonly syncStatus: "paused";
  readonly purgedSegments: number | null;
  readonly serverTime: string;
};

export type SyncResumeResponse = {
  readonly deviceId: string;
  readonly syncGeneration: number;
  readonly syncStatus: "active";
  readonly serverTime: string;
};
