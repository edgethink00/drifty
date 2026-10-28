// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  accessibilityPaneIsDeviceControl,
  rememberMacosMajorVersion,
  resetReportedMacosMajorVersion,
  useAccessibilityPaneIsDeviceControl,
} from "./accessibilityPaneName";

afterEach(() => resetReportedMacosMajorVersion());

describe("the System Settings name of the Accessibility page", () => {
  it("is Device Control and Data Access from macOS 27", () => {
    expect(accessibilityPaneIsDeviceControl(26)).toBe(false);
    expect(accessibilityPaneIsDeviceControl(27)).toBe(true);
    expect(accessibilityPaneIsDeviceControl(28)).toBe(true);
    // Unknown, Windows and older native builds keep the long-standing name.
    expect(accessibilityPaneIsDeviceControl(null)).toBe(false);
    expect(accessibilityPaneIsDeviceControl(undefined)).toBe(false);
  });

  it("follows the version the native status reports", () => {
    const { result } = renderHook(() => useAccessibilityPaneIsDeviceControl());
    expect(result.current).toBe(false);
    act(() => rememberMacosMajorVersion(27));
    expect(result.current).toBe(true);
    // A later status without a version keeps what was learned.
    act(() => rememberMacosMajorVersion(null));
    expect(result.current).toBe(true);
  });
});
