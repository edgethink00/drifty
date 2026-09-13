import { describe, expect, it } from "vitest";
import {
  cloudAiBackoffMessage,
  CloudAiRequestBackoffRegistry,
  isDailyCloudQuotaBackoff,
} from "./cloudAiRequestBackoff";

const NOW = Date.parse("2026-08-26T10:00:00.000Z");

describe("CloudAiRequestBackoffRegistry", () => {
  it("holds payment-required failures for fifteen minutes", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const entry = registry.record({
      key: "user-1",
      status: 402,
      message: "Cloud AI classification requires an active trial or subscription.",
      nowMs: NOW,
    });

    expect(entry.retryAtMs).toBe(NOW + 15 * 60 * 1000);
    expect(registry.current("user-1", NOW + 14 * 60 * 1000)).toEqual(entry);
    expect(registry.current("user-1", NOW + 15 * 60 * 1000)).toBeNull();
  });

  it("aligns daily quota failures to the next UTC quota window", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const entry = registry.record({
      key: "user-1",
      status: 429,
      message: "Daily AI classification quota exceeded. Please try again tomorrow.",
      nowMs: NOW,
    });

    expect(entry.retryAtMs).toBe(Date.parse("2026-08-27T00:01:00.000Z"));
  });

  it("honors a longer Retry-After header", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const entry = registry.record({
      key: "user-1",
      status: 429,
      message: "Minute AI classification quota exceeded.",
      retryAfter: "180",
      nowMs: NOW,
    });

    expect(entry.retryAtMs).toBe(NOW + 3 * 60 * 1000);
  });

  it("keeps accounts isolated and supports an explicit recovery clear", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const entry = registry.record({ key: "user-1", status: 429, message: "Rate limited", nowMs: NOW });

    expect(registry.current("user-1", NOW)).toEqual(entry);
    expect(registry.current("user-2", NOW)).toBeNull();
    registry.clear("user-1");
    expect(registry.current("user-1", NOW)).toBeNull();
  });

  it("does not shorten an active backoff when a shorter response arrives later", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const daily = registry.record({
      key: "user-1",
      status: 429,
      message: "Daily AI classification quota exceeded.",
      nowMs: NOW,
    });
    const minute = registry.record({
      key: "user-1",
      status: 429,
      message: "Minute AI classification quota exceeded.",
      nowMs: NOW + 100,
    });

    expect(minute).toEqual(daily);
  });

  it("does not let an older successful request clear a newer failure", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const requestRevision = registry.revision("user-1");
    const entry = registry.record({ key: "user-1", status: 429, message: "Rate limited", nowMs: NOW });

    expect(registry.clear("user-1", requestRevision)).toBe(false);
    expect(registry.current("user-1", NOW)).toEqual(entry);
    expect(registry.clear("user-1", registry.revision("user-1"))).toBe(true);
  });

  it("caps oversized Retry-After values and clears an empty key without clearing another account", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const oversized = registry.record({
      key: "",
      status: 429,
      message: "Rate limited",
      retryAfter: "999999999999999",
      nowMs: NOW,
    });
    const other = registry.record({ key: "user-1", status: 429, message: "Rate limited", nowMs: NOW });

    expect(oversized.retryAtMs).toBe(NOW + 24 * 60 * 60 * 1000);
    expect(registry.clear("")).toBe(true);
    expect(registry.current("user-1", NOW)).toEqual(other);
  });

  it("formats a stable local suppression reason without exposing an account id", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const entry = registry.record({ key: "private-user", status: 429, message: "Rate limited", nowMs: NOW });

    expect(cloudAiBackoffMessage(entry, NOW)).toBe(
      "Cloud AI classification is paused after HTTP 429. Automatic requests resume in about 2 minutes. Rate limited",
    );
  });

  it("reports the next live expiry and distinguishes a daily quota from a short pause", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const minute = registry.record({
      key: "user-1",
      status: 429,
      message: "Minute AI classification quota exceeded.",
      nowMs: NOW,
    });
    expect(isDailyCloudQuotaBackoff(minute)).toBe(false);
    expect(registry.nextExpiryMs(NOW)).toBe(minute.retryAtMs);
    expect(registry.nextExpiryMs(minute.retryAtMs)).toBeNull();
    const daily = registry.record({
      key: "user-2",
      status: 429,
      message: "Daily AI classification quota exceeded. Please try again tomorrow.",
      nowMs: NOW,
    });
    expect(isDailyCloudQuotaBackoff(daily)).toBe(true);
  });

  it("uses the structured quota window when the message does not describe it", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const entry = registry.record({
      key: "user-1",
      status: 429,
      message: "Upstream provider rate limit exceeded.",
      quotaWindow: "day",
      nowMs: NOW,
    });

    expect(entry.retryAtMs).toBe(Date.parse("2026-08-27T00:01:00.000Z"));
    expect(isDailyCloudQuotaBackoff(entry)).toBe(true);
  });

  it("lets the structured window override a daily-sounding message", () => {
    const registry = new CloudAiRequestBackoffRegistry();
    const entry = registry.record({
      key: "user-1",
      status: 429,
      message: "Daily burst limit hit; retry shortly.",
      quotaWindow: "minute",
      nowMs: NOW,
    });

    expect(entry.retryAtMs).toBe(NOW + 60 * 1000);
    expect(isDailyCloudQuotaBackoff(entry)).toBe(false);
  });
});
