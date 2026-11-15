import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ enabled: true, invoke: vi.fn(), capture: vi.fn() }));
vi.mock("../../lib/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("../../lib/analytics/productAnalyticsPreference", () => ({ readProductAnalyticsEnabled: () => mocks.enabled }));
vi.mock("../../lib/analytics/posthogClient", () => ({ capturePostHogEvent: mocks.capture }));
import { recordCliPilot, requestCliPilotAssignment } from "./cliPilot";

describe("CLI pilot privacy and delivery", () => {
  beforeEach(() => { mocks.enabled = true; mocks.invoke.mockReset(); mocks.capture.mockReset(); });
  it("does not enroll or collect when product analytics is off", async () => {
    mocks.enabled = false;
    expect(await requestCliPilotAssignment(new AbortController().signal)).toBeNull();
    recordCliPilot("cli", "selected", "codex_cli");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it("lets previously enrolled accounts restore their connection without new enrollment", async () => {
    mocks.enabled = false;
    mocks.invoke.mockResolvedValue({ data: { variant: "cli" }, error: null });
    expect(await requestCliPilotAssignment(new AbortController().signal, "read")).toBe("cli");
    expect(mocks.invoke).toHaveBeenCalledWith("onboarding-cli-pilot", expect.objectContaining({ body: { action: "read" } }));
  });
  it("keeps the existing setup on a failed or aborted assignment", async () => {
    mocks.invoke.mockResolvedValue({ data: { variant: "cli" }, error: new Error("offline") });
    expect(await requestCliPilotAssignment(new AbortController().signal)).toBeNull();
    const controller = new AbortController(); controller.abort();
    mocks.invoke.mockResolvedValue({ data: { variant: "cli" }, error: null });
    expect(await requestCliPilotAssignment(controller.signal)).toBeNull();
  });
});
