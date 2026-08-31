import { describe, expect, it } from "vitest";
import {
  AUTO_UPDATE_CHECK_BUSY_RETRY_MS,
  AUTO_UPDATE_CHECK_INTERVAL_MS,
  AUTO_UPDATE_CHECK_RETRY_MS,
  nextAutomaticCheckAtAfterResult,
  nextAutomaticCheckDelayMs,
  parseNextAutomaticCheckAt,
} from "./useAutomaticUpdateScheduler";

describe("automatic update scheduling", () => {
  it("waits for the startup quiet period when no check is persisted", () => {
    expect(nextAutomaticCheckDelayMs({
      nextCheckAtMs: null,
      nowMs: 1_000,
      startupNotBeforeMs: 3_500,
    })).toBe(2_500);
  });

  it("honors a future persisted check across long-running sessions", () => {
    expect(nextAutomaticCheckDelayMs({
      nextCheckAtMs: 90_000,
      nowMs: 10_000,
      startupNotBeforeMs: 12_500,
    })).toBe(80_000);
  });

  it("checks immediately after wake when the persisted deadline passed", () => {
    expect(nextAutomaticCheckDelayMs({
      nextCheckAtMs: 5_000,
      nowMs: 90_000,
      startupNotBeforeMs: 2_500,
    })).toBe(0);
  });

  it("uses daily, failure, and busy retry cadences", () => {
    expect(nextAutomaticCheckAtAfterResult({ kind: "none" }, 100)).toBe(100 + AUTO_UPDATE_CHECK_INTERVAL_MS);
    expect(nextAutomaticCheckAtAfterResult({ kind: "available" }, 100)).toBe(100 + AUTO_UPDATE_CHECK_INTERVAL_MS);
    expect(nextAutomaticCheckAtAfterResult({ kind: "error" }, 100)).toBe(100 + AUTO_UPDATE_CHECK_RETRY_MS);
    expect(nextAutomaticCheckAtAfterResult(undefined, 100)).toBe(100 + AUTO_UPDATE_CHECK_BUSY_RETRY_MS);
  });

  it("rejects malformed persisted deadlines", () => {
    expect(parseNextAutomaticCheckAt(null)).toBeNull();
    expect(parseNextAutomaticCheckAt("bad")).toBeNull();
    expect(parseNextAutomaticCheckAt("-1")).toBeNull();
    expect(parseNextAutomaticCheckAt("1234")).toBe(1234);
  });
});
