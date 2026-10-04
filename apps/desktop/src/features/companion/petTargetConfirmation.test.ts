import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmPetTargetWithRecovery,
  PET_TARGET_RECHECK_DELAY_MS,
  type PetTargetConfirmation,
} from "./petTargetConfirmation";

afterEach(() => vi.useRealTimers());

describe("pet target capture recovery", () => {
  it.each(["confirmed", "current-window-changed", "system-transient-active"] as const)("does not retry %s", async result => {
    const confirm = vi.fn(async () => result);
    await expect(confirmPetTargetWithRecovery({ confirm, isAuthorized: () => true, retryUnavailable: true })).resolves.toBe(result);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it.each(["confirmed", "current-window-changed", "current-snapshot-unavailable"] as const)("waits once for fresh capture, returning %s", async second => {
    vi.useFakeTimers();
    const confirm = vi.fn<() => Promise<PetTargetConfirmation>>()
      .mockResolvedValueOnce("current-snapshot-unavailable").mockResolvedValueOnce(second);
    const attempt = confirmPetTargetWithRecovery({ confirm, isAuthorized: () => true, retryUnavailable: true });
    await vi.advanceTimersByTimeAsync(PET_TARGET_RECHECK_DELAY_MS - 1);
    expect(confirm).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(attempt).resolves.toBe(second);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps native-app unavailable handling immediate", async () => {
    vi.useFakeTimers();
    const confirm = vi.fn(async () => "current-snapshot-unavailable" as const);
    await expect(confirmPetTargetWithRecovery({ confirm, isAuthorized: () => true, retryUnavailable: false })).resolves.toBe("current-snapshot-unavailable");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never reads when the attempt was already cancelled", async () => {
    const confirm = vi.fn(async () => "confirmed" as const);
    await expect(confirmPetTargetWithRecovery({ confirm, isAuthorized: () => false, retryUnavailable: true })).resolves.toBe("cancelled");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not schedule recovery after cancellation during the first read", async () => {
    vi.useFakeTimers();
    let authorized = true;
    const confirm = vi.fn(async () => {
      authorized = false;
      return "current-snapshot-unavailable" as const;
    });
    await expect(confirmPetTargetWithRecovery({ confirm, isAuthorized: () => authorized, retryUnavailable: true })).resolves.toBe("cancelled");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not re-read after cancellation during the recovery wait", async () => {
    vi.useFakeTimers();
    let authorized = true;
    const confirm = vi.fn(async () => "current-snapshot-unavailable" as const);
    const attempt = confirmPetTargetWithRecovery({ confirm, isAuthorized: () => authorized, retryUnavailable: true });
    await vi.advanceTimersByTimeAsync(100);
    authorized = false;
    await vi.advanceTimersByTimeAsync(PET_TARGET_RECHECK_DELAY_MS);
    await expect(attempt).resolves.toBe("cancelled");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("rejects a confirmed result if cancellation arrives during the second read", async () => {
    vi.useFakeTimers();
    let authorized = true;
    const confirm = vi.fn<() => Promise<PetTargetConfirmation>>()
      .mockResolvedValueOnce("current-snapshot-unavailable").mockImplementationOnce(async () => {
        authorized = false;
        return "confirmed";
      });
    const attempt = confirmPetTargetWithRecovery({ confirm, isAuthorized: () => authorized, retryUnavailable: true });
    await vi.advanceTimersByTimeAsync(PET_TARGET_RECHECK_DELAY_MS);
    await expect(attempt).resolves.toBe("cancelled");
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
