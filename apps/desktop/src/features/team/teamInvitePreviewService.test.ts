import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewTeamInvite } from "./teamInvitePreviewService";
import { fetchTeamMembershipStart } from "./teamSharingService";
import { acceptTeamInvite } from "./teamService";
import { createClient, organizationId } from "./teamServiceTestClient";

vi.mock("../../lib/supabase/client", () => ({ supabase: null, isSupabaseEnabled: () => false }));
const preview = {
  organizationId, organizationName: "Invited team", roleLabel: "Member", policyVersion: "a".repeat(32),
  policy: { projects: "hourly", tasks: "member_daily", focus: "team", memberSummary: false },
  trackingPolicy: "managed", schedule: { days: [1, 2], start_minute: 540, end_minute: 1080, timezone: "Asia/Seoul" },
};
beforeEach(() => vi.clearAllMocks());
describe("invite preview client boundary", () => {
  it("reads just the invite's metadata and sends the reviewed version on acceptance", async () => {
    const client = createClient();
    client.setFunctionResponse({ data: { ok: true, action: "preview", preview: { ...preview, rawHistory: "private" } }, error: null });
    expect(await previewTeamInvite(" DRFT-ABCD-2345 ", client)).toEqual({ success: true, error: null, data: preview });
    client.setFunctionResponse({ data: { ok: true, action: "accept", organizationId }, error: null });
    expect((await acceptTeamInvite({ inviteKey: "DRFT-ABCD-2345", expectedPolicyVersion: preview.policyVersion }, client)).success).toBe(true);
    expect(client.functionCalls.map((call) => call.body)).toMatchObject([
      { action: "preview", inviteKey: "DRFT-ABCD-2345" },
      { action: "accept", expectedPolicyVersion: preview.policyVersion },
    ]);
  });
  it.each([
    undefined, { ...preview, policyVersion: "bad" }, { ...preview, policy: { ...preview.policy, projects: "everything" } },
    { ...preview, schedule: { ...preview.schedule, timezone: "Not/aZone" } },
    { ...preview, schedule: { ...preview.schedule, days: [8] } },
    { ...preview, schedule: { ...preview.schedule, start_minute: 1200 } },
    { ...preview, schedule: null },
  ])("fails closed for old or malformed responses (%#)", async (value) => {
    const client = createClient();
    client.setFunctionResponse({ data: { ok: true, action: "preview", preview: value }, error: null });
    expect(await previewTeamInvite("DRFT-ABCD-2345", client)).toMatchObject({ success: false, reason: "remote_error" });
  });
  it("does not invent recording hours for the legacy free policy", async () => {
    const client = createClient();
    client.setFunctionResponse({ data: { ok: true, action: "preview", preview: { ...preview, trackingPolicy: "free", schedule: null } }, error: null });
    expect(await previewTeamInvite("DRFT-ABCD-2345", client)).toMatchObject({ success: true, data: { schedule: null } });
    expect(await previewTeamInvite("  ", client)).toMatchObject({ success: false, reason: "invalid_input" });
    expect(client.functionCalls).toHaveLength(1);
  });
});

it("requires a valid own membership start and fails closed when that RPC is absent", async () => {
  const client = createClient();
  client.setRpcResponse("get_organization_membership_start", { data: [{ joined_at: "2026-10-26T05:00:00Z" }], error: null });
  expect(await fetchTeamMembershipStart(organizationId, client)).toMatchObject({ success: true, data: "2026-10-26T05:00:00Z" });
  client.setRpcResponse("get_organization_membership_start", { data: [], error: null });
  expect(await fetchTeamMembershipStart(organizationId, client)).toMatchObject({ success: false });
  client.setRpcResponse("get_organization_membership_start", { data: [{ joined_at: "bad" }], error: null });
  expect(await fetchTeamMembershipStart(organizationId, client)).toMatchObject({ success: false });
});
