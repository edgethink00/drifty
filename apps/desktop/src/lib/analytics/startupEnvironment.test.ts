import { beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  capturePostHogEvent: vi.fn(),
}));

const startupMocks = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  getInstallLocation: vi.fn(),
  getOpenAtLoginStatus: vi.fn(),
}));

vi.mock("./posthogClient", () => ({
  capturePostHogEvent: analyticsMocks.capturePostHogEvent,
}));

vi.mock("../api/startupSettingsClient", () => ({
  startupSettingsClient: startupMocks,
}));

const {
  reportStartupEnvironment,
  reportStartupRegistration,
  toAnalyticsInstallLocation,
  toAnalyticsOpenAtLoginStatus,
  toAnalyticsStartupBackend,
} = await import("./startupEnvironment");

beforeEach(() => {
  vi.clearAllMocks();
  startupMocks.isAvailable.mockReturnValue(true);
});

describe("startup environment mapping", () => {
  it("converts native camelCase values to the analytics taxonomy", () => {
    expect(toAnalyticsInstallLocation("userApplications")).toBe("user_applications");
    expect(toAnalyticsInstallLocation("removableVolume")).toBe("removable_volume");
    expect(toAnalyticsOpenAtLoginStatus("requiresApproval")).toBe("requires_approval");
    expect(toAnalyticsOpenAtLoginStatus("notRegistered")).toBe("not_registered");
    expect(toAnalyticsStartupBackend("smAppService")).toBe("sm_app_service");
  });

  it("reports unknown instead of dropping an unreadable value", () => {
    expect(toAnalyticsInstallLocation(null)).toBe("unknown");
    expect(toAnalyticsOpenAtLoginStatus(null)).toBe("unknown");
    expect(toAnalyticsStartupBackend(null)).toBe("unknown");
  });
});

describe("reportStartupEnvironment", () => {
  it("pairs the install location with the open-at-login status", async () => {
    startupMocks.getInstallLocation.mockResolvedValue("translocated");
    startupMocks.getOpenAtLoginStatus.mockResolvedValue({
      success: true,
      enabled: true,
      status: "enabled",
      backend: "smAppService",
    });

    await reportStartupEnvironment();

    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("app_launch_environment", {
      install_location: "translocated",
      open_at_login_status: "enabled",
      startup_backend: "sm_app_service",
    });
  });

  it("still reports when one native read fails", async () => {
    startupMocks.getInstallLocation.mockRejectedValue(new Error("unavailable"));
    startupMocks.getOpenAtLoginStatus.mockResolvedValue({
      success: true,
      enabled: false,
      status: "requiresApproval",
      backend: "smAppService",
    });

    await reportStartupEnvironment();

    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("app_launch_environment", {
      install_location: "unknown",
      open_at_login_status: "requires_approval",
      startup_backend: "sm_app_service",
    });
  });

  it("stays silent outside the native runtime", async () => {
    startupMocks.isAvailable.mockReturnValue(false);

    await reportStartupEnvironment();

    expect(analyticsMocks.capturePostHogEvent).not.toHaveBeenCalled();
  });
});

describe("reportStartupRegistration", () => {
  it("records a pending approval as an unsuccessful registration", () => {
    reportStartupRegistration({
      phase: "onboarding",
      requestedEnabled: true,
      outcome: { success: false, enabled: false, status: "requiresApproval", backend: "smAppService" },
    });

    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("startup_registration", {
      phase: "onboarding",
      requested_enabled: true,
      result: "unavailable",
      open_at_login_status: "requires_approval",
      startup_backend: "sm_app_service",
    });
  });

  it("records a thrown native call as an error", () => {
    reportStartupRegistration({
      phase: "settings",
      requestedEnabled: false,
      outcome: null,
      failed: true,
    });

    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("startup_registration", {
      phase: "settings",
      requested_enabled: false,
      result: "error",
      open_at_login_status: "unknown",
      startup_backend: "unknown",
    });
  });
});
