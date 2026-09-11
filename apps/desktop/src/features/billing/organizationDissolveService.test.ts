import { describe, expect, it, vi } from "vitest";

import {
  dissolveOwnOrganization,
  ORGANIZATION_SEAT_RELEASE_TIMEOUT_MS,
  type OrganizationSeatClient,
} from "./organizationSeatService";

function functionError(status: number | null, body: unknown): unknown {
  return {
    name: "FunctionsHttpError",
    context: {
      ...(status === null ? {} : { status }),
      json: () => Promise.resolve(body),
    },
  };
}

describe("dissolveOwnOrganization", () => {
  it("sends the dissolve action with no target of its own", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, action: "dissolve-organization", organizationId: "org-1", removedMemberships: 2 },
      error: null,
    });
    const client: OrganizationSeatClient = { functions: { invoke } };

    const result = await dissolveOwnOrganization(client);

    expect(result).toEqual({ outcome: "dissolved" });
    // The organization is resolved from the caller's own membership on the
    // server. Accepting an id from the client would let one owner name another
    // organization.
    expect(invoke).toHaveBeenCalledWith("manage-enterprise-seats", {
      timeout: ORGANIZATION_SEAT_RELEASE_TIMEOUT_MS,
      body: { action: "dissolve-organization" },
    });
  });

  it("treats a repeat of a completed dissolution as dissolved", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, action: "dissolve-organization", alreadyDissolved: true },
      error: null,
    });

    const result = await dissolveOwnOrganization({ functions: { invoke } });

    expect(result).toEqual({ outcome: "dissolved" });
  });

  it.each([
    ["a success flag without the matching action", { ok: true, action: "release-own-seat" }],
    ["a truthy but non-boolean success flag", { ok: "true", action: "dissolve-organization" }],
    ["an empty body", null],
  ])("never reports %s as dissolved", async (_label, data) => {
    const invoke = vi.fn().mockResolvedValue({ data, error: null });

    const result = await dissolveOwnOrganization({ functions: { invoke } });

    expect(result.outcome).toBe("pending");
  });

  it.each([
    ["an unsettled server reply", 502],
    ["a gateway timeout", 504],
    ["a status the transport did not report", null],
  ])("keeps %s pending rather than claiming the subscription is untouched", async (_label, status) => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: functionError(status, { error: "still settling" }) });

    const result = await dissolveOwnOrganization({ functions: { invoke } });

    expect(result).toEqual({ outcome: "pending", error: "still settling" });
  });

  it("reports a refusal from the server as refused", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: functionError(403, { error: "Only the Enterprise owner can dissolve the organization." }),
    });

    const result = await dissolveOwnOrganization({ functions: { invoke } });

    expect(result).toEqual({
      outcome: "refused",
      error: "Only the Enterprise owner can dissolve the organization.",
    });
  });

  it("reports an error carried in a 200 body as refused rather than dissolved", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { error: "nope" }, error: null });

    const result = await dissolveOwnOrganization({ functions: { invoke } });

    expect(result).toEqual({ outcome: "refused", error: "nope" });
  });

  it("is unavailable without a configured client and never invokes anything", async () => {
    const result = await dissolveOwnOrganization(null);

    expect(result.outcome).toBe("unavailable");
  });
});
