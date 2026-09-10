import { describe, expect, it, vi } from "vitest";

import {
  ORGANIZATION_SEAT_RELEASE_TIMEOUT_MS,
  releaseOwnOrganizationSeat,
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

describe("releaseOwnOrganizationSeat", () => {
  it("sends the self-release action for the caller's own seat", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, action: "release-own-seat", seatId: "seat-1" },
      error: null,
    });
    const client: OrganizationSeatClient = { functions: { invoke } };

    const result = await releaseOwnOrganizationSeat(" seat-1 ", client);

    expect(result).toEqual({ outcome: "released" });
    expect(invoke).toHaveBeenCalledWith("manage-enterprise-seats", {
      timeout: ORGANIZATION_SEAT_RELEASE_TIMEOUT_MS,
      body: { action: "release-own-seat", seatId: "seat-1" },
    });
  });

  it("treats a repeated release of an already released seat as released", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, action: "release-own-seat", seatId: "seat-1", alreadyReleased: true },
      error: null,
    });

    const result = await releaseOwnOrganizationSeat("seat-1", { functions: { invoke } });

    expect(result).toEqual({ outcome: "released" });
  });

  it.each([
    ["a success flag without the matching action", { ok: true, action: "revoke-seat" }],
    ["a truthy but non-boolean success flag", { ok: "true", action: "release-own-seat" }],
    ["an empty body", null],
  ])("never reports %s as released", async (_label, data) => {
    const invoke = vi.fn().mockResolvedValue({ data, error: null });

    const result = await releaseOwnOrganizationSeat("seat-1", { functions: { invoke } });

    expect(result.outcome).toBe("pending");
  });

  it("reports a 200 body error as a refusal", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { error: "You can only release your own Enterprise seat." },
      error: null,
    });

    const result = await releaseOwnOrganizationSeat("seat-1", { functions: { invoke } });

    expect(result).toEqual({
      outcome: "refused",
      error: "You can only release your own Enterprise seat.",
    });
  });

  it("keeps the server's 502 reconciliation message as pending, not as a failure", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: functionError(502, { error: "Access was paused, but Polar seat reconciliation is still pending." }),
    });

    const result = await releaseOwnOrganizationSeat("seat-1", { functions: { invoke } });

    expect(result).toEqual({
      outcome: "pending",
      error: "Access was paused, but Polar seat reconciliation is still pending.",
    });
  });

  it.each([401, 403, 404, 409])("reports %d as a refusal with the server message", async (status) => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: functionError(status, { error: "The Enterprise owner's seat cannot be released here." }),
    });

    const result = await releaseOwnOrganizationSeat("seat-1", { functions: { invoke } });

    expect(result).toEqual({
      outcome: "refused",
      error: "The Enterprise owner's seat cannot be released here.",
    });
  });

  it("reports a 500 as unavailable", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: functionError(500, null) });

    const result = await releaseOwnOrganizationSeat("seat-1", { functions: { invoke } });

    expect(result.outcome).toBe("unavailable");
  });

  it("treats a reply with no readable status as pending rather than as an untouched seat", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: functionError(null, null) });

    const result = await releaseOwnOrganizationSeat("seat-1", { functions: { invoke } });

    expect(result.outcome).toBe("pending");
  });

  it("reports a thrown transport error as unavailable", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("offline"));

    const result = await releaseOwnOrganizationSeat("seat-1", { functions: { invoke } });

    expect(result).toEqual({ outcome: "unavailable", error: "offline" });
  });

  it("refuses an empty seat id without calling the function", async () => {
    const invoke = vi.fn();

    const result = await releaseOwnOrganizationSeat("   ", { functions: { invoke } });

    expect(result.outcome).toBe("refused");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports an unconfigured client as unavailable", async () => {
    const result = await releaseOwnOrganizationSeat("seat-1", null);

    expect(result.outcome).toBe("unavailable");
  });
});
