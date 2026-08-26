import { describe, expect, it, vi } from "vitest";
import { deleteDriftyAccount } from "./accountDeletionService";

describe("deleteDriftyAccount", () => {
  it("invokes the authenticated deletion function with only the typed confirmation", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, localDataRetained: true },
      error: null,
    });

    await expect(deleteDriftyAccount("alex@example.com", { functions: { invoke } })).resolves.toEqual({
      success: true,
      localDataRetained: true,
    });
    expect(invoke).toHaveBeenCalledWith("delete-account", {
      body: { confirmation: "alex@example.com" },
    });
  });

  it("surfaces the Edge Function's safe deletion error", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: { context: Response.json({
        code: "billing_delete_failed",
        stage: "not_started",
        error: "Unable to stop billing, so your account was not deleted.",
      }, { status: 502 }) },
    });

    await expect(deleteDriftyAccount("alex@example.com", { functions: { invoke } })).resolves.toEqual({
      success: false,
      code: "billing_delete_failed",
      stage: "not_started",
      error: "Unable to stop billing, so your account was not deleted.",
    });
  });

  it("treats an unreadable transport failure as an unknown remote outcome", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("connection reset"));

    await expect(deleteDriftyAccount("alex@example.com", { functions: { invoke } })).resolves.toEqual({
      success: false,
      code: "transport_unknown",
      stage: "unknown",
      error: "connection reset",
    });
  });
});
