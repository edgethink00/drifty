import type { ScreenContextAccountBinding, ScreenContextReply } from "@drifty/domain";
import { SCREEN_CONTEXT_BUILD_ENABLED } from "./screenContextBuild";

export type ScreenContextInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
export type ScreenContextConnection = "unavailable" | "idle" | "binding" | "ready";
export interface ScreenContextSnapshot {
  readonly generation: number;
  readonly connection: ScreenContextConnection;
  readonly binding: ScreenContextAccountBinding | null;
}
const CHANGED = "screen_context_account_changed";
const UNAVAILABLE = "screen_context_account_unavailable";
const NATIVE_ERRORS = [CHANGED, UNAVAILABLE, "memory_unavailable", "memory_credentials_required", "memory_recording_required", "screen_context_unavailable", "screen_context_key_unavailable", "screen_context_storage_full",
  "screen_context_clock_changed", "screen_context_invalid_settings", "screen_context_unsupported_app", "screen_context_ocr_unavailable",
  "screen_context_helper_unavailable", "screen_context_tracker_not_ready", "screen_context_invalid_range",
  "screen_context_ai_recipient_unavailable", "screen_context_ai_settings_unsaved"];
function nativeError(raw: unknown): Error {
  return new Error(typeof raw === "string" && NATIVE_ERRORS.includes(raw) ? raw : UNAVAILABLE);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function bindingReply(value: unknown): ScreenContextReply<ScreenContextAccountBinding> {
  if (!record(value) || typeof value.leaseId !== "string" || !UUID.test(value.leaseId)
    || !record(value.value) || (value.value.mode !== "local" && value.value.mode !== "account")
    || typeof value.value.expiresAtMs !== "number" || !Number.isSafeInteger(value.value.expiresAtMs)
    || value.value.expiresAtMs <= Date.now() || value.value.expiresAtMs > Date.now() + 16 * 60_000) {
    throw new Error(UNAVAILABLE);
  }
  return { leaseId: value.leaseId, value: { mode: value.value.mode, expiresAtMs: value.value.expiresAtMs } };
}

/** One main-window instance. No content is cached here. Account changes clear
 * the capability synchronously; all IPC consumers must use consume(). */
export class ScreenContextClient {
  private expectedUserId: string | null | undefined;
  private leaseId: string | null = null;
  private leaseClockStart = 0;
  private leaseClockDeadline = 0;
  private leaseWallStart = 0;
  private leaseExpired = false;
  private wanted = false;
  private disposed = false;
  private revocation: Promise<void> = Promise.resolve();
  private connecting: Promise<void> | null = null;
  private mutationGeneration: number | null = null;
  private renewal: ReturnType<typeof setTimeout> | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: ScreenContextSnapshot;
  private readonly native: boolean;

  constructor(private readonly invoke: ScreenContextInvoke, native: boolean) {
    this.native = native && SCREEN_CONTEXT_BUILD_ENABLED;
    this.snapshot = { generation: 0, connection: this.native ? "idle" : "unavailable", binding: null };
  }
  getSnapshot = (): ScreenContextSnapshot => this.snapshot;
  isDesktop(): boolean { return this.native; }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(connection: ScreenContextConnection, binding: ScreenContextAccountBinding | null = null): void {
    this.snapshot = { ...this.snapshot, connection, binding };
    for (const listener of this.listeners) listener();
  }
  private clear(): void {
    this.leaseId = null;
    this.leaseExpired = true;
    this.connecting = null;
    if (this.renewal !== null) clearTimeout(this.renewal);
    this.renewal = null;
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = null;
    this.snapshot = { generation: this.snapshot.generation + 1, connection: this.native ? "idle" : "unavailable", binding: null };
    for (const listener of this.listeners) listener();
  }
  setAccount(expectedUserId: string | null | undefined): void {
    this.expectedUserId = expectedUserId;
    this.invalidate();
  }
  invalidate(): void {
    this.clear();
    if (!this.native || this.disposed) return;
    const generation = this.snapshot.generation;
    // Revoke immediately, even while an earlier network bind is outstanding.
    this.revocation = this.invoke("screen_context_revoke_account").then(() => undefined, () => {
      if (this.isCurrent(generation)) this.publish("unavailable");
      throw new Error(UNAVAILABLE);
    });
    void this.revocation.catch(() => undefined);
  }
  /** Lease-free and content-free: whether recording was ever turned on on this computer. */
  async wasConfigured(): Promise<boolean> {
    if (!this.native || this.disposed) return false;
    return (await this.invoke("screen_context_was_configured")) === true;
  }
  /** Lease-free preflight: whether macOS already allows Screen Recording. Never prompts. */
  async screenRecordingPermitted(): Promise<boolean> {
    if (!this.native || this.disposed) return false;
    const raw = await this.invoke("screen_context_permission_status");
    return record(raw) && raw.granted === true;
  }
  credentialsReady(): void {
    if (this.wanted && this.expectedUserId !== undefined) void this.connect().catch(() => undefined);
    else if (this.native && this.expectedUserId !== undefined) {
      const generation = this.snapshot.generation;
      void this.invoke("screen_context_was_configured").then((configured) => {
        if (configured === true && this.isCurrent(generation)) return this.connect();
      }).catch(() => undefined);
    }
  }
  private installBinding(reply: ScreenContextReply<ScreenContextAccountBinding>): void {
    this.leaseId = reply.leaseId;
    this.leaseWallStart = Date.now();
    this.leaseClockStart = performance.now();
    this.leaseClockDeadline = this.leaseClockStart + reply.value.expiresAtMs - this.leaseWallStart;
    this.leaseExpired = false;
    if (this.renewal !== null) clearTimeout(this.renewal);
    if (this.expiry !== null) clearTimeout(this.expiry);
    const generation = this.snapshot.generation;
    const remaining = reply.value.expiresAtMs - Date.now();
    // The hard deadline remains independent of verification: stalled native
    // credential I/O must not keep private content visible after expiry.
    this.expiry = setTimeout(() => {
      if (!this.isCurrent(generation) || this.leaseId !== reply.leaseId
        || this.snapshot.binding?.expiresAtMs !== reply.value.expiresAtMs) return;
      this.invalidate(); this.credentialsReady();
    }, Math.max(1, remaining));
    // A token near its own expiry may not yield a longer grant. Wait for that
    // deadline instead of repeatedly verifying it in a tight renewal loop.
    this.renewal = remaining > 10_000
      ? setTimeout(() => { void this.renew(generation, reply.leaseId); }, remaining - 10_000) : null;
    this.publish("ready", reply.value);
  }
  private async renew(generation: number, leaseId: string): Promise<void> {
    if (!this.isCurrent(generation) || this.leaseId !== leaseId) return;
    try {
      if (!this.leaseCurrent()) throw new Error(CHANGED);
      const mode = this.snapshot.binding?.mode;
      const reply = bindingReply(await this.invoke("screen_context_bind_account", {
        expectedUserId: this.expectedUserId, leaseId,
      }));
      if (!this.isCurrent(generation) || this.leaseId !== leaseId) return;
      // Native verification must preserve the exact live capability. Expiry,
      // clock changes and unrelated bindings can never restore visible content.
      if (!this.leaseCurrent() || reply.leaseId !== leaseId || reply.value.mode !== mode) throw new Error(CHANGED);
      this.installBinding(reply);
    } catch {
      if (this.isCurrent(generation) && this.leaseId === leaseId) {
        this.invalidate();
        this.credentialsReady();
      }
    }
  }
  async connect(): Promise<void> {
    this.wanted = true;
    if (this.disposed || !this.native || this.expectedUserId === undefined) throw new Error(UNAVAILABLE);
    if (this.mutationGeneration === this.snapshot.generation) throw new Error(CHANGED);
    if (this.leaseId && this.leaseCurrent()) return;
    if (this.leaseId) this.invalidate();
    if (this.connecting) return this.connecting;
    const generation = this.snapshot.generation;
    const expectedUserId = this.expectedUserId;
    this.publish("binding");
    const run = async () => {
      try {
        await this.revocation;
        if (!this.isCurrent(generation)) throw new Error(CHANGED);
        const reply = bindingReply(await this.invoke("screen_context_bind_account", { expectedUserId }));
        if (!this.isCurrent(generation)) throw new Error(CHANGED);
        this.installBinding(reply);
        if (!this.isCurrent(generation)) throw new Error(CHANGED);
      } catch {
        if (this.isCurrent(generation)) this.publish("unavailable");
        throw new Error(this.isCurrent(generation) ? UNAVAILABLE : CHANGED);
      } finally {
        if (this.isCurrent(generation)) this.connecting = null;
      }
    };
    this.connecting = run();
    return this.connecting;
  }
  isCurrent(generation: number): boolean {
    return !this.disposed && this.snapshot.generation === generation;
  }
  private leaseCurrent(): boolean {
    if (this.leaseExpired || !this.leaseId || !this.snapshot.binding) return false;
    const wall = Date.now(); const clock = performance.now();
    if (wall < this.leaseWallStart || wall >= this.snapshot.binding.expiresAtMs
      || clock < this.leaseClockStart || clock >= this.leaseClockDeadline) this.leaseExpired = true;
    return !this.leaseExpired;
  }
  canDisplay(generation: number): boolean {
    return this.isCurrent(generation) && this.snapshot.connection === "ready" && this.leaseCurrent();
  }
  /** Decode only after lease/generation checks. The synchronous callback must
   * tag rendered state with generation and check canDisplay() in render. */
  async consume<T>(command: string, args: Record<string, unknown>, decode: (value: unknown) => T,
    accept: (value: T, generation: number) => void): Promise<void> {
    await this.connect();
    const generation = this.snapshot.generation;
    const leaseId = this.leaseId;
    if (!leaseId) throw new Error(CHANGED);
    let raw: unknown;
    try { raw = await this.invoke(command, { ...args, leaseId }); }
    catch (error) { throw this.isCurrent(generation) ? nativeError(error) : new Error(CHANGED); }
    if (!this.canDisplay(generation) || this.leaseId !== leaseId || !record(raw) || raw.leaseId !== leaseId) {
      throw new Error(CHANGED);
    }
    const decoded = decode(raw.value);
    if (!this.isCurrent(generation)) throw new Error(CHANGED);
    accept(decoded, generation);
  }
  /** Mutations clear visible content before submitting. Only bounded non-content
   * acknowledgments are consumed, then a new native lease is obtained. */
  async mutate<T>(command: "memory_configure" | "memory_purge" | "memory_forget_source" | "memory_wiki_delete" | "screen_context_configure" | "screen_context_delete_evidence" | "screen_context_request_permission", args: Record<string, unknown>,
    decode: (value: unknown) => T, accept: (value: T, generation: number) => void): Promise<void> {
    await this.connect();
    const leaseId = this.leaseId;
    const expiry = this.snapshot.binding?.expiresAtMs ?? 0;
    if (!leaseId) throw new Error(CHANGED);
    this.mutationGeneration = this.snapshot.generation + 1;
    this.clear();
    const generation = this.snapshot.generation;
    try {
      const raw = await this.invoke(command, { ...args, leaseId });
      if (!this.isCurrent(generation) || Date.now() >= expiry || !record(raw) || raw.leaseId !== leaseId) throw new Error(CHANGED);
      const value = decode(raw.value);
      if (!this.isCurrent(generation)) throw new Error(CHANGED);
      this.mutationGeneration = null;
      await this.connect();
      if (!this.canDisplay(generation)) throw new Error(CHANGED);
      accept(value, generation);
    } catch (error) {
      if (!this.isCurrent(generation)) throw new Error(CHANGED);
      this.invalidate();
      throw nativeError(error instanceof Error && NATIVE_ERRORS.includes(error.message) ? error.message : error);
    } finally {
      if (this.mutationGeneration === generation) this.mutationGeneration = null;
    }
  }
  dispose(): void {
    this.invalidate();
    this.disposed = true;
    this.listeners.clear();
  }
}
