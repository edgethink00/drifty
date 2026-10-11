import { describe, expect, it } from "vitest";
import { translateFor } from "../features/localization/translate";
import { classifyBackgroundError, describeActionError, describeBackgroundError } from "./actionErrors";

const ko = translateFor("ko");

describe("action errors", () => {
  it("shows the action's own line and keeps the original wording as detail", () => {
    expect(describeActionError(new Error("database is locked"), "저장하지 못했어요.")).toEqual({ message: "저장하지 못했어요.", detail: "database is locked" });
    expect(describeActionError("저장하지 못했어요.", "저장하지 못했어요.")).toEqual({ message: "저장하지 못했어요.", detail: null });
    expect(describeActionError(undefined, "저장하지 못했어요.")).toEqual({ message: "저장하지 못했어요.", detail: null });
  });

  it("names the causes a person can act on for background failures", () => {
    expect(classifyBackgroundError(new Error("database is locked"))).toBe("storageBusy");
    expect(classifyBackgroundError(new Error("Tracker request timed out after 30s"))).toBe("timeout");
    expect(classifyBackgroundError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyBackgroundError(new Error("Tracker is not available. Please run the desktop app."))).toBe("trackerUnavailable");
    expect(classifyBackgroundError(new Error("id is required"))).toBeNull();
  });

  it("never shows tracker wording as the visible background line", () => {
    const described = describeBackgroundError(new Error("id is required"), ko);
    expect(described.message).toBe(ko("shell.error.generic"));
    expect(described.detail).toBe("id is required");
    expect(describeBackgroundError(new Error("database is locked"), ko).message).toBe(ko("shell.error.storageBusy"));
  });
});
