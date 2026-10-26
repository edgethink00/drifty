import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenContextClient, type ScreenContextInvoke } from "./screenContextClient";

const A = "5c1c587e-6327-4da4-8290-663195343c62";
const B = "cbb9e134-ffbc-4384-b6b9-6b83cafbef14";
const leaseA = "a9db1b29-80fb-4104-9272-46e0845a4774";
const leaseB = "c65b878f-5e63-40c6-9b2d-8a5c444026f0";
function binding(leaseId = leaseA) {
  return { leaseId, value: { mode: "account", expiresAtMs: Date.now() + 900_000 } };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clientWith(read: (command: string) => Promise<unknown>) {
  const invoke = vi.fn<ScreenContextInvoke>((command) => command === "screen_context_revoke_account"
    ? Promise.resolve(undefined) : command === "screen_context_bind_account" ? Promise.resolve(binding()) : read(command));
  const client = new ScreenContextClient(invoke, true);
  client.setAccount(A);
  return { client, invoke };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("local screen evidence account lifetime", () => {
  it("does no native I/O in a browser and cannot report a fake binding", async () => {
    const invoke = vi.fn<ScreenContextInvoke>();
    const client = new ScreenContextClient(invoke, false);
    client.setAccount(null);
    await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
    expect(invoke).not.toHaveBeenCalled();
    expect(client.getSnapshot().connection).toBe("unavailable");
  });
  it("clears immediately on A→B→A and never decodes a late decrypted reply", async () => {
    const pending = deferred();
    const { client } = clientWith(() => pending.promise);
    await client.connect();
    const decode = vi.fn((v: unknown) => v);
    const accept = vi.fn();
    const request = client.consume("screen_context_read", {}, decode, accept);
    await Promise.resolve();
    const oldGeneration = client.getSnapshot().generation;
    client.setAccount(B);
    expect(client.getSnapshot().binding).toBeNull();
    client.setAccount(A);
    pending.resolve({ leaseId: leaseA, value: "OWNED_PRIVATE_TEXT" });
    await expect(request).rejects.toThrow("screen_context_account_changed");
    expect(client.isCurrent(oldGeneration)).toBe(false);
    expect(decode).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });
  it("refuses a foreign lease, an expired reply and revocation inside a decoder", async () => {
    for (const kind of ["foreign", "expired", "decoder"] as const) {
      const { client } = clientWith(async () => {
        if (kind === "expired") vi.setSystemTime(Date.now() + 901_000);
        return { leaseId: kind === "foreign" ? leaseB : leaseA, value: "OWNED" };
      });
      const accept = vi.fn();
      const decode = vi.fn((v: unknown) => { if (kind === "decoder") client.invalidate(); return v; });
      await expect(client.consume("screen_context_read", {}, decode, accept)).rejects.toThrow("screen_context_account_changed");
      expect(accept).not.toHaveBeenCalled();
      expect(decode).toHaveBeenCalledTimes(kind === "decoder" ? 1 : 0);
      client.dispose();
    }
  });
  it("sanitizes native errors before they reach a content consumer", async () => {
    const { client } = clientWith(async () => { throw new Error("OWNED_TOKEN_OR_TEXT_ECHO"); });
    await expect(client.consume("screen_context_read", {}, (v) => v, vi.fn())).rejects.toThrow("screen_context_account_unavailable");
  });
  it("a failed older revocation cannot overwrite a newer ready state", async () => {
    const old = deferred();
    let revokes = 0;
    const invoke = vi.fn<ScreenContextInvoke>((command) => command === "screen_context_revoke_account"
      ? ++revokes === 1 ? old.promise : Promise.resolve() : Promise.resolve(binding()));
    const client = new ScreenContextClient(invoke, true);
    client.setAccount(A);
    client.setAccount(B);
    await client.connect();
    old.reject(new Error("OWNED_OLD_FAILURE"));
    await Promise.resolve();
    expect(client.getSnapshot().connection).toBe("ready");
  });
  it("an in-flight old binding cannot replace the next account binding", async () => {
    const old = deferred();
    let binds = 0;
    const invoke = vi.fn<ScreenContextInvoke>((command) => command === "screen_context_revoke_account"
      ? Promise.resolve() : ++binds === 1 ? old.promise : Promise.resolve(binding(leaseB)));
    const client = new ScreenContextClient(invoke, true);
    client.setAccount(A);
    const first = client.connect();
    const firstRejected = expect(first).rejects.toThrow("screen_context_account_changed");
    await vi.advanceTimersByTimeAsync(0);
    expect(binds).toBe(1);
    client.setAccount(B);
    await client.connect();
    old.resolve(binding());
    await firstRejected;
    const accept = vi.fn();
    // No new content request may reuse the previous account's lease.
    invoke.mockImplementationOnce(async (_command, args) => ({ leaseId: args?.leaseId, value: 7 }));
    await client.consume("screen_context_read", { leaseId: "untrusted" }, (v) => v, accept);
    expect(invoke).toHaveBeenLastCalledWith("screen_context_read", { leaseId: leaseB });
    expect(accept).toHaveBeenCalledWith(7, client.getSnapshot().generation);
  });
  it("does not grant from malformed native responses or a failed latest revocation", async () => {
    const invoke = vi.fn<ScreenContextInvoke>(async (command) => command === "screen_context_revoke_account" ? undefined
      : { ...binding(), leaseId: "invalid" });
    const client = new ScreenContextClient(invoke, true);
    client.setAccount(A);
    await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
    expect(client.getSnapshot().binding).toBeNull();
    invoke.mockImplementation(async () => { throw new Error("OWNED_FAILURE"); });
    client.setAccount(B);
    await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
    expect(client.getSnapshot().binding).toBeNull();
  });
  it("hides already-consumed content on expiry or clock rollback without reviving it", async () => {
    for (const clockChange of [901_000, -1_000]) {
      const { client } = clientWith(async () => ({ leaseId: leaseA, value: "OWNED" }));
      const accept = vi.fn();
      await client.consume("screen_context_read", {}, (v) => v, accept);
      const generation = client.getSnapshot().generation;
      expect(client.canDisplay(generation)).toBe(true);
      const before = Date.now();
      vi.setSystemTime(before + clockChange);
      expect(client.canDisplay(generation)).toBe(false);
      vi.setSystemTime(before);
      expect(client.canDisplay(generation)).toBe(false);
      client.dispose();
    }
  });
  it.each(["screen_context_configure", "screen_context_request_permission"] as const)("clears content before %s and prevents polling from rotating its native lease mid-write", async (mutation) => {
    const pending = deferred(); let binds = 0;
    const invoke = vi.fn<ScreenContextInvoke>(async (command) => {
      if (command === "screen_context_revoke_account") return;
      if (command === "screen_context_bind_account") return binding(++binds === 1 ? leaseA : leaseB);
      if (command === mutation) return pending.promise;
      return { leaseId: leaseA, value: "OLD_PRIVATE_TEXT" };
    });
    const client = new ScreenContextClient(invoke, true); client.setAccount(A); await client.connect();
    const before = client.getSnapshot().generation;
    const accept = vi.fn();
    const write = client.mutate(mutation, {}, (v) => v, accept);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.canDisplay(before)).toBe(false);
    await expect(client.consume("screen_context_get_status", {}, (v) => v, vi.fn())).rejects.toThrow("screen_context_account_changed");
    expect(binds).toBe(1);
    pending.resolve({ leaseId: leaseA, value: 7 }); await write;
    expect(binds).toBe(2);
    expect(accept).toHaveBeenCalledWith(7, client.getSnapshot().generation);
    expect(client.canDisplay(client.getSnapshot().generation)).toBe(true);
  });
  it("an older failed mutation cannot revoke the next account", async () => {
    const pending = deferred(); let binds = 0;
    const invoke = vi.fn<ScreenContextInvoke>(async (command) => {
      if (command === "screen_context_revoke_account") return;
      if (command === "screen_context_bind_account") return binding(++binds === 1 ? leaseA : leaseB);
      return pending.promise;
    });
    const client = new ScreenContextClient(invoke, true); client.setAccount(A); await client.connect();
    const write = client.mutate("screen_context_delete_evidence", {}, (v) => v, vi.fn());
    const rejected = expect(write).rejects.toThrow("screen_context_account_changed");
    await vi.advanceTimersByTimeAsync(0);
    client.setAccount(B); await client.connect();
    const current = client.getSnapshot().generation;
    pending.reject(new Error("OWNED_OLD_FAILURE")); await rejected;
    expect(client.canDisplay(current)).toBe(true);
  });
});
