import { describe, expect, it, vi } from "vitest";
import type { FocusCardPayload } from "./focusCardPublisher";
import { captureFocusCardConsent, fetchOwnFocusCard, publishFocusCard, refreshFocusCardAggregates, setFocusCardDetailFlags, setFocusCardEnabled } from "./focusCardService";

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

describe("Focus Card authenticated owner boundary", () => {
  const operations = [
    ["read", (client: never) => fetchOwnFocusCard(client, "owner-a")],
    ["publish", (client: never) => publishFocusCard(payload(), true, client, "owner-a")],
    ["refresh", (client: never) => refreshFocusCardAggregates(payload(), client, "owner-a")],
    ["details", (client: never) => setFocusCardDetailFlags({ shareCategoryBreakdown: false, shareHourlyPattern: false }, client, "owner-a")],
    ["disable", (client: never) => setFocusCardEnabled(false, client, "owner-a")],
  ] as const;

  it.each(operations)("rejects %s before accessing a different owner's card", async (_name, operation) => {
    const from = vi.fn();
    const client = { auth: { getUser: async () => ({ data: { user: { id: "owner-b" } }, error: null }) }, from };
    const result = await operation(client as never);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Account changed/);
    expect(from).not.toHaveBeenCalled();
  });

  it("checks the owner returned after an asynchronous auth lookup", async () => {
    let resolve!: (value: { data: { user: { id: string } }; error: null }) => void;
    const from = vi.fn();
    const client = { auth: { getUser: () => new Promise<{ data: { user: { id: string } }; error: null }>(done => { resolve = done; }) }, from };
    const task = publishFocusCard(payload(), true, client as never, "owner-a", "revision-a");
    resolve({ data: { user: { id: "owner-b" } }, error: null });
    expect((await task).success).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("still publishes for the expected current owner", async () => {
    const select = vi.fn().mockReturnValue({ single: async () => ({ error: null, data: { consent_revision: "committed-revision" } }) });
    const upsert = vi.fn().mockReturnValue({ select });
    const client = { auth: { getUser: async () => ({ data: { user: { id: "owner-a" } }, error: null }) }, from: () => ({ upsert }) };
    expect(await publishFocusCard(payload(), true, client as never, "owner-a", "revision-a")).toEqual({ success: true, error: null, data: "committed-revision" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "owner-a", enabled: true, expected_consent_revision: "revision-a" }), { onConflict: "user_id" });
    expect(select).toHaveBeenCalledWith("consent_revision");
  });
});


describe("Focus Card consent snapshot", () => {
  it("rejects a delayed read of identical OFF flags with a different displayed revision", async () => {
    let resolve!: (value: { data: Record<string, unknown>; error: null }) => void;
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "owner-a" } } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise(done => { resolve = done; }) }) }) }),
    };
    const captured = captureFocusCardConsent(client as never, "owner-a", {
      enabled: false, detailFlags: { shareCategoryBreakdown: false, shareHourlyPattern: false }, consentRevision: "displayed-before-off",
    });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    resolve({ data: { enabled: false, consent_revision: "after-repeated-off" }, error: null });
    const result = await captured;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/review/i);
  });
  it("does not obtain a fresh token when the displayed status has not loaded", async () => {
    const getUser = vi.fn();
    const result = await captureFocusCardConsent({ auth: { getUser } } as never, "owner-a", {
      enabled: null, detailFlags: null, consentRevision: null,
    });
    expect(result.success).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  });
  it("returns an authentication failure without rejecting a queued snapshot", async () => {
    const client = { auth: { getUser: async () => { throw new Error("Auth unavailable"); } } };
    expect(await captureFocusCardConsent(client as never, "owner-a")).toEqual({ success: false, error: "Auth unavailable" });
  });
  it("requires review when the displayed consent differs from the server", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "owner-a" } } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { enabled: true, share_category_breakdown: false, share_hourly_pattern: false, consent_revision: "new-revision" }, error: null,
      }) }) }) }),
    };
    const result = await captureFocusCardConsent(client as never, "owner-a", {
      enabled: true, detailFlags: { shareCategoryBreakdown: true, shareHourlyPattern: false },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/review/i);
  });
  it.each([
    [null, "00000000-0000-0000-0000-000000000000"],
    [{ consent_revision: "revision-before-build" }, "revision-before-build"],
  ])("captures the server revision or absence before a write", async (row, expected) => {
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "owner-a" } } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    };
    expect(await captureFocusCardConsent(client as never, "owner-a")).toEqual({ success: true, error: null, data: expected });
  });
  it("fails closed for an existing row without server ordering support", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "owner-a" } } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { enabled: false }, error: null }) }) }) }),
    };
    expect((await captureFocusCardConsent(client as never, "owner-a")).success).toBe(false);
  });
  it("never falls back to an unversioned publication or retries a stale token", async () => {
    const upsert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: null, error: { code: "PT409", message: "Focus card consent changed. Review it and try again." } }) }) });
    const client = { auth: { getUser: async () => ({ data: { user: { id: "owner-a" } } }) }, from: () => ({ upsert }) };
    expect((await publishFocusCard(payload(), true, client as never, "owner-a")).success).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect((await publishFocusCard(payload(), true, client as never, "owner-a", "old-token")).success).toBe(false);
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][0].expected_consent_revision).toBe("old-token");
  });
});
