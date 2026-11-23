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
  it("keeps the current capability and visible generation through verified periodic renewal", async () => {
    const { client, invoke } = clientWith(async () => ({ leaseId: leaseA, value: "OWNED" }));
    await client.connect();
    const generation = client.getSnapshot().generation;
    const expiry = client.getSnapshot().binding!.expiresAtMs;
    await vi.advanceTimersByTimeAsync(890_000);
    expect(client.getSnapshot().generation).toBe(generation);
    expect(client.canDisplay(generation)).toBe(true);
    expect(client.getSnapshot().binding!.expiresAtMs).toBeGreaterThan(expiry);
    expect(invoke).toHaveBeenLastCalledWith("screen_context_bind_account", { expectedUserId: A, leaseId: leaseA });
    expect(invoke.mock.calls.filter(([command]) => command === "screen_context_revoke_account")).toHaveLength(1);
    client.dispose();
  });
  it("drops a late Replay read without interrupting verification or extending the account deadline", async () => {
    const read = deferred();
    const renewal = deferred();
    const { client, invoke } = clientWith(() => read.promise);
    await client.connect();
    const expiresAtMs = client.getSnapshot().binding!.expiresAtMs;
    invoke.mockImplementation(async (command, args) => command === "screen_context_revoke_account" ? undefined
      : command === "screen_context_bind_account" ? args?.leaseId ? renewal.promise : binding(leaseB)
      : read.promise);
    const decode = vi.fn();
    const late = client.consume("screen_context_read_evidence", {}, decode, vi.fn());
    const rejected = expect(late).rejects.toThrow("screen_context_account_changed");
    await vi.advanceTimersByTimeAsync(890_000);
    expect(invoke).toHaveBeenCalledWith("screen_context_bind_account", { expectedUserId: A, leaseId: leaseA });
    client.invalidateVisibility(leaseA);
    const generation = client.getSnapshot().generation;
    read.resolve({ leaseId: leaseA, value: "STALE_FRAME" });
    await rejected;
    expect(decode).not.toHaveBeenCalled();
    // Successful verification may leave the deadline unchanged (e.g. the same token).
    renewal.resolve({ leaseId: leaseA, value: { mode: "account", expiresAtMs } });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getSnapshot().binding!.expiresAtMs).toBe(expiresAtMs);
    expect(client.canDisplay(generation)).toBe(true);
    expect(invoke.mock.calls.filter(([command]) => command === "screen_context_revoke_account")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.canDisplay(generation)).toBe(false);
    expect(invoke.mock.calls.filter(([command]) => command === "screen_context_revoke_account")).toHaveLength(2);
    client.dispose();
  });
  it.each(["rejected", "foreign", "expired", "different-mode"] as const)("clears content when renewal is %s", async (failure) => {
    const { client, invoke } = clientWith(async () => undefined);
    await client.connect();
    const generation = client.getSnapshot().generation;
    invoke.mockImplementation(async (command, args) => {
      if (command === "screen_context_revoke_account") return;
      if (!args?.leaseId) return binding(leaseB);
      if (failure === "rejected") throw new Error("OWNED_AUTH_FAILURE");
      const reply = binding(failure === "foreign" ? leaseB : leaseA);
      if (failure === "expired") reply.value.expiresAtMs = Date.now();
      if (failure === "different-mode") reply.value.mode = "local";
      return reply;
    });
    await vi.advanceTimersByTimeAsync(890_000);
    expect(client.canDisplay(generation)).toBe(false);
    expect(client.getSnapshot().generation).toBeGreaterThan(generation);
    expect(client.getSnapshot().connection).toBe("ready");
    client.dispose();
  });
  it("ignores late renewal success or failure after another account has bound", async () => {
    for (const rejected of [false, true]) {
      const pending = deferred();
      const { client, invoke } = clientWith(async () => undefined);
      await client.connect();
      invoke.mockImplementation(async (command, args) => command === "screen_context_revoke_account" ? undefined
        : args?.leaseId ? pending.promise : binding(leaseB));
      await vi.advanceTimersByTimeAsync(890_000);
      client.setAccount(B); await client.connect();
      const generation = client.getSnapshot().generation;
      if (rejected) pending.reject(new Error("OLD_FAILURE")); else pending.resolve(binding());
      await vi.advanceTimersByTimeAsync(0);
      expect(client.getSnapshot().generation).toBe(generation);
      expect(client.canDisplay(generation)).toBe(true);
      client.dispose();
    }
  });
  it("cannot revive a grant that expired while verification was pending", async () => {
    const pending = deferred();
    const { client, invoke } = clientWith(async () => undefined);
    await client.connect();
    const generation = client.getSnapshot().generation;
    invoke.mockImplementation(async (command, args) => command === "screen_context_revoke_account" ? undefined
      : args?.leaseId ? pending.promise : binding(leaseB));
    await vi.advanceTimersByTimeAsync(890_000);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(client.canDisplay(generation)).toBe(false);
    pending.resolve(binding());
    await vi.advanceTimersByTimeAsync(0);
    expect(client.canDisplay(generation)).toBe(false);
    expect(client.getSnapshot().generation).toBeGreaterThan(generation);
    client.dispose();
  });
  it("does not spin on a verified token that cannot extend the current deadline", async () => {
    const { client, invoke } = clientWith(async () => undefined);
    await client.connect();
    const generation = client.getSnapshot().generation;
    const expiry = client.getSnapshot().binding!.expiresAtMs;
    invoke.mockImplementation(async (command, args) => command === "screen_context_revoke_account" ? undefined
      : args?.leaseId ? { leaseId: leaseA, value: {mode: "account", expiresAtMs: expiry} } : binding(leaseB));
    await vi.advanceTimersByTimeAsync(899_999);
    expect(invoke.mock.calls.filter(([,args]) => args?.leaseId)).toHaveLength(1);
    expect(client.canDisplay(generation)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.canDisplay(generation)).toBe(false);
    client.dispose();
  });
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

describe("recovery after a failed binding", () => {
  function flakyBinding(failures: number) {
    let binds = 0;
    const invoke = vi.fn<ScreenContextInvoke>(async (command) => {
      if (command === "screen_context_revoke_account") return;
      if (command === "screen_context_bind_account") {
        binds += 1;
        if (binds <= failures) throw new Error("OWNED_OFFLINE");
        return binding();
      }
      return undefined;
    });
    const client = new ScreenContextClient(invoke, true);
    client.setAccount(A);
    return { client, binds: () => binds };
  }
  it("retries with backoff until the binding succeeds", async () => {
    const { client, binds } = flakyBinding(2);
    await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
    expect(client.getSnapshot().connection).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(binds()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(binds()).toBe(2);
    expect(client.getSnapshot().connection).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(14_999);
    expect(binds()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(binds()).toBe(3);
    expect(client.getSnapshot().connection).toBe("ready");
    expect(client.canDisplay(client.getSnapshot().generation)).toBe(true);
    client.dispose();
  });
  it("keeps retrying at most every five minutes while the binding keeps failing", async () => {
    const { client, binds } = flakyBinding(Number.POSITIVE_INFINITY);
    await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
    await vi.advanceTimersByTimeAsync(5_000 + 15_000 + 30_000 + 60_000 + 120_000);
    expect(binds()).toBe(6);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(binds()).toBe(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(binds()).toBe(7);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(binds()).toBe(8);
    client.dispose();
  });
  it("starts the backoff over after a successful binding", async () => {
    let fail = true; let binds = 0;
    const invoke = vi.fn<ScreenContextInvoke>(async (command) => {
      if (command === "screen_context_revoke_account") return;
      binds += 1;
      if (fail) throw new Error("OWNED_OFFLINE");
      return binding();
    });
    const client = new ScreenContextClient(invoke, true);
    client.setAccount(A);
    await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
    await vi.advanceTimersByTimeAsync(5_000 + 15_000);
    expect(binds).toBe(3);
    fail = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.getSnapshot().connection).toBe("ready");
    fail = true;
    client.invalidate();
    await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
    const before = binds;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(binds).toBe(before + 1);
    client.dispose();
  });
  it("never reconnects after a deliberate revocation, an account change or dispose", async () => {
    for (const stop of ["invalidate", "account", "dispose"] as const) {
      const { client, binds } = flakyBinding(Number.POSITIVE_INFINITY);
      await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
      if (stop === "invalidate") client.invalidate();
      if (stop === "account") client.setAccount(B);
      if (stop === "dispose") client.dispose();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(binds()).toBe(1);
      expect(client.getSnapshot().binding).toBeNull();
      client.dispose();
    }
  });
  it("does not retry when nobody asked for the capability or the account is still loading", async () => {
    const invoke = vi.fn<ScreenContextInvoke>(async (command) => {
      if (command === "screen_context_revoke_account") return;
      throw new Error("OWNED_OFFLINE");
    });
    const client = new ScreenContextClient(invoke, true);
    client.setAccount(undefined);
    await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
    client.credentialsReady();
    client.retryUnavailable();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(invoke.mock.calls.filter(([command]) => command === "screen_context_bind_account")).toHaveLength(0);
    client.dispose();
  });
  it("retries at once on a wake signal, and the signal does nothing when no retry is due", async () => {
    const { client, binds } = flakyBinding(1);
    client.retryUnavailable();
    await vi.advanceTimersByTimeAsync(0);
    expect(binds()).toBe(0);
    await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
    client.retryUnavailable();
    await vi.advanceTimersByTimeAsync(0);
    expect(binds()).toBe(2);
    expect(client.getSnapshot().connection).toBe("ready");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(binds()).toBe(2);
    client.retryUnavailable();
    await vi.advanceTimersByTimeAsync(0);
    expect(binds()).toBe(2);
    client.dispose();
  });
});
