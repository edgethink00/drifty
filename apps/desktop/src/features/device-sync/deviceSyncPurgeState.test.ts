import { describe, expect, it } from "vitest";

import { SYNC_PUSH_SEQ_KEY } from "./deviceSyncEngine";
import { buildSyncStateAfterCloudPurge } from "./deviceSyncPurgeState";

describe("buildSyncStateAfterCloudPurge", () => {
  it("stores the new generation without resetting the push cursor", () => {
    const state = buildSyncStateAfterCloudPurge(4);

    expect(state).toEqual({
      sync_generation: "4",
      sync_pull_cursor: null,
      sync_deletion_pull_cursor: null,
      sync_last_pulled_at: null,
    });
    expect(state).not.toHaveProperty(SYNC_PUSH_SEQ_KEY);
  });

  it("rejects an invalid server generation", () => {
    expect(() => buildSyncStateAfterCloudPurge(0)).toThrow("invalid sync generation");
  });
});
