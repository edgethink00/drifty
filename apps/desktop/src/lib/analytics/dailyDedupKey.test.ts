import { describe, expect, it } from "vitest";

import { toDailyDedupKey } from "./eventHelpers";

/**
 * The daily cap only stays honest if the key covers every property the event
 * reports. If it ever covers a subset, the one row that survives the day keeps
 * whichever count bucket or error kind happened to arrive first, while looking
 * exactly like a normal row. These tests exist to make that failure loud.
 */
describe("daily dedup key", () => {
  it("covers every reported property so a surviving row cannot misdescribe itself", () => {
    const key = toDailyDedupKey({
      action: "load",
      result: "success",
      period: "daily",
      row_count_bucket: "6_20",
    });

    expect(key).toBe("action=load|period=daily|result=success|row_count_bucket=6_20");
  });

  it("separates rows that differ only in a count bucket", () => {
    const base = { trigger: "background_threshold", result: "success" } as const;

    expect(toDailyDedupKey({ ...base, saved_count_bucket: "1" }))
      .not.toBe(toDailyDedupKey({ ...base, saved_count_bucket: "21_50" }));
  });

  it("separates rows that differ only in an error kind", () => {
    const base = { action: "entitlement_check", result: "error" } as const;

    expect(toDailyDedupKey({ ...base, error_kind: "network" }))
      .not.toBe(toDailyDedupKey({ ...base, error_kind: "rate_limited" }));
  });

  it("does not depend on the order the properties were built in", () => {
    expect(toDailyDedupKey({ result: "error", action: "publish", period: "weekly" }))
      .toBe(toDailyDedupKey({ period: "weekly", action: "publish", result: "error" }));
  });

  it("keeps an absent optional property distinct from a present one", () => {
    expect(toDailyDedupKey({ action: "load", result: "error" }))
      .not.toBe(toDailyDedupKey({ action: "load", result: "error", period: "daily" }));
  });
});
