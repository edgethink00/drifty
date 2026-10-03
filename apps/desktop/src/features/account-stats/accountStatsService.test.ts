
import { describe, expect, it, vi } from "vitest";
import { buildAccountStatsPayload } from "./accountStatsPayload";
import { publishAccountStats } from "./accountStatsService";

function payload() {
  return buildAccountStatsPayload([], {
    windowEndDay: "2026-10-03", startOfDayMinutes: 0, includeAiClassifications: false,
  });
}

describe("account stats publication owner", () => {
  it("rejects a new authenticated account returned after the original cycle started", async () => {
    let resolveUser!: (result: { data: { user: { id: string } }; error: null }) => void;
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { getUser: () => new Promise<{ data: { user: { id: string } }; error: null }>((resolve) => { resolveUser = resolve; }) },
      from: vi.fn(() => ({ upsert })),
    };
    const publishing = publishAccountStats(payload(), client, { expectedUserId: "account-a" });
    resolveUser({ data: { user: { id: "account-b" } }, error: null });
    const result = await publishing;
    expect(result.success).toBe(false);
    expect(result.accountChanged).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("publishes the original account's aggregate when the authenticated owner still matches", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { auth: { getUser: async () => ({ data: { user: { id: "account-a" } }, error: null }) }, from: vi.fn(() => ({ upsert })) };
    expect(await publishAccountStats(payload(), client, { expectedUserId: "account-a" })).toEqual({ success: true, error: null });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "account-a", window_end_date: "2026-10-03" }), { onConflict: "user_id" });
  });

  it("keeps the direct publish API compatible when no scheduled owner is supplied", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { auth: { getUser: async () => ({ data: { user: { id: "account-b" } }, error: null }) }, from: vi.fn(() => ({ upsert })) };
    expect((await publishAccountStats(payload(), client)).success).toBe(true);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "account-b" }), { onConflict: "user_id" });
  });
});
