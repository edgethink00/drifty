import { describe, expect, it, vi } from "vitest";

import { createBillingPortalSession } from "./billingService";

type MockBillingClient = Parameters<typeof createBillingPortalSession>[0];

describe("billingService", () => {
  it("creates a Polar customer portal session", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { url: "https://portal.example.test" },
      error: null,
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await createBillingPortalSession(client);

    expect(result).toEqual({ success: true, data: { url: "https://portal.example.test" } });
    expect(invoke).toHaveBeenCalledWith("create-polar-customer-portal", { body: {} });
  });

  it("accepts the Polar customer portal URL response key", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { customerPortalUrl: "https://portal.example.test/session" },
      error: null,
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await createBillingPortalSession(client);

    expect(result).toEqual({ success: true, data: { url: "https://portal.example.test/session" } });
  });

  it("returns the billing portal function error body when Supabase wraps the response context", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: {
        context: {
          json: () => Promise.resolve({ error: "Billing management is not available for this account yet." }),
        },
      },
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await createBillingPortalSession(client);

    expect(result).toEqual({ success: false, error: "Billing management is not available for this account yet." });
  });

  it("returns an error when the portal function omits a redirect URL", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {},
      error: null,
    });
    const client: MockBillingClient = { functions: { invoke } };

    const result = await createBillingPortalSession(client);

    expect(result).toEqual({ success: false, error: "Billing management did not return a redirect URL." });
  });
});
