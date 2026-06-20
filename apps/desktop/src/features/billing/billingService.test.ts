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
