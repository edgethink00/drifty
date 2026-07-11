import { describe, expect, it } from "vitest";
import type { FocusCardPayload } from "./focusCardPublisher";
import { refreshFocusCardAggregates } from "./focusCardService";

function payload(): FocusCardPayload {
  return {
    focus_seconds_today: 3600,
    focus_seconds_7d: 7200,
    drift_seconds_7d: 600,
    neutral_seconds_7d: 300,
    focus_share: 0.89,
    daily_focus: [{ day: "2026-07-11", focus: 3600, drift: 600 }],
    window_start_date: "2026-06-12",
    window_end_date: "2026-07-11",
    share_category_breakdown: true,
    share_hourly_pattern: true,
    category_breakdown_7d: [{ category: "workspace", seconds: 7200, focusSeconds: 6500, neutralSeconds: 300, driftSeconds: 400 }],
    hourly_focus_pattern: [{ hour: 9, focusSeconds: 900 }],
  };
}

describe("refreshFocusCardAggregates", () => {
  it("updates aggregates behind live server consent filters without writing consent flags", async () => {
    const updates: Array<{ payload: Record<string, unknown>; filters: Array<[string, string | boolean]> }> = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
      from: () => ({
        update: (nextPayload: Record<string, unknown>) => {
          const record = { payload: nextPayload, filters: [] as Array<[string, string | boolean]> };
          updates.push(record);
          const builder = {
            eq(column: string, value: string | boolean) {
              record.filters.push([column, value]);
              return builder;
            },
            then(resolve: (value: { error: null }) => unknown) {
              return Promise.resolve(resolve({ error: null }));
            },
          };
          return builder;
        },
      }),
    };

    const result = await refreshFocusCardAggregates(payload(), client as never);

    expect(result.success).toBe(true);
    expect(updates).toHaveLength(3);
    expect(updates[0].filters).toEqual([["user_id", "user-1"], ["enabled", true]]);
    expect(updates[1].filters).toContainEqual(["share_category_breakdown", true]);
    expect(updates[2].filters).toContainEqual(["share_hourly_pattern", true]);
    expect(updates.every((update) => !("enabled" in update.payload))).toBe(true);
    expect(updates.every((update) => !("share_category_breakdown" in update.payload))).toBe(true);
    expect(updates.every((update) => !("share_hourly_pattern" in update.payload))).toBe(true);
    expect(updates.every((update) => update.payload.share_top_apps === false)).toBe(true);
    expect(updates.every((update) => Array.isArray(update.payload.top_apps_7d) && update.payload.top_apps_7d.length === 0)).toBe(true);
  });
});
