import { describe, expect, it } from "vitest";
import { formatFocusDriftWindowRange } from "./focusDriftHoverFormat";

describe("formatFocusDriftWindowRange", () => {
  it("writes a shared meridiem once", () => {
    expect(formatFocusDriftWindowRange(20 * 60 + 30, 0, "en")).toBe("8:30–9:00 PM");
    expect(formatFocusDriftWindowRange(9 * 60, 0, "en")).toBe("9:00–9:30 AM");
  });

  it("keeps both meridiems when the slot crosses noon or midnight", () => {
    expect(formatFocusDriftWindowRange(11 * 60 + 30, 0, "en")).toBe("11:30 AM – 12:00 PM");
    expect(formatFocusDriftWindowRange(23 * 60 + 30, 0, "en")).toBe("11:30 PM – 12:00 AM");
  });

  it("follows the configured start of day", () => {
    // Bucket 0 of a day that starts at 4:00 AM is the 4:00 slot, not midnight.
    expect(formatFocusDriftWindowRange(0, 4 * 60, "en")).toBe("4:00–4:30 AM");
    expect(formatFocusDriftWindowRange(8 * 60, 20 * 60, "en")).toBe("4:00–4:30 AM");
  });

  it("collapses a shared Korean meridiem the same way", () => {
    expect(formatFocusDriftWindowRange(20 * 60 + 30, 0, "ko")).toBe("오후 8:30–9:00");
    expect(formatFocusDriftWindowRange(11 * 60 + 30, 0, "ko")).toBe("오전 11:30 – 오후 12:00");
  });

  it("falls back to the start time for an empty slot length", () => {
    expect(formatFocusDriftWindowRange(20 * 60 + 30, 0, "en", 0)).toBe("8:30 PM");
  });
});
