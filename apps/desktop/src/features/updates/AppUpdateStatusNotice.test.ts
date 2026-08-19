import { describe, expect, it } from "vitest";
import { buildManualUpdateStatusNotice } from "./AppUpdateStatusNotice";

describe("buildManualUpdateStatusNotice", () => {
  it("stays silent while a manual check is in flight", () => {
    expect(buildManualUpdateStatusNotice({
      checking: true,
      error: null,
      hasAvailableUpdate: false,
      message: "Checking for updates...",
    })).toBeNull();
  });

  it("stays silent when an update window should open", () => {
    expect(buildManualUpdateStatusNotice({
      checking: false,
      error: null,
      hasAvailableUpdate: true,
      message: "Drifty 1.6.4 is available.",
    })).toBeNull();
  });

  it("shows a compact up-to-date toast", () => {
    expect(buildManualUpdateStatusNotice({
      checking: false,
      error: null,
      hasAvailableUpdate: false,
      message: "Drifty is up to date.",
    })).toEqual({
      compact: true,
      detail: "Drifty is up to date.",
      role: "status",
      title: "Update check complete",
    });
  });

  it("shows a failed check without repeating the title in the detail", () => {
    expect(buildManualUpdateStatusNotice({
      checking: false,
      error: "Update check failed: signed update metadata was unavailable.",
      hasAvailableUpdate: false,
      message: null,
    })).toEqual({
      detail: "signed update metadata was unavailable.",
      role: "alert",
      title: "Update check failed",
    });
  });
});
