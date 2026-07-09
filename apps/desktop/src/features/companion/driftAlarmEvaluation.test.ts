import { describe, expect, it } from "vitest";
import { pruneExpiredDriftAlarmAiRetries } from "./driftAlarmEvaluation";

describe("pruneExpiredDriftAlarmAiRetries", () => {
  const nowMs = 1_800_000_000_000;

  it("removes cooldowns at or past expiry and keeps pending ones", () => {
    const retries = new Map<string, number>([
      ["expired-long-ago", nowMs - 60_000],
      ["expires-now", nowMs],
      ["still-cooling", nowMs + 30_000],
    ]);

    pruneExpiredDriftAlarmAiRetries(retries, nowMs);

    expect([...retries.keys()]).toEqual(["still-cooling"]);
  });

  it("handles an empty map", () => {
    const retries = new Map<string, number>();

    pruneExpiredDriftAlarmAiRetries(retries, nowMs);

    expect(retries.size).toBe(0);
  });
});
