import { afterEach, expect, it, vi } from "vitest";
import { submitFeedback, type FeedbackClient } from "./feedbackService";
import type { FeedbackDiagnostics } from "./feedbackDiagnostics";

const id = "7c6bfe27-92c9-4d42-a8f1-4ac2b5198101";
const unsupported = "Request body contains unsupported fields.";
const diagnostics = { schemaVersion: 2 } as FeedbackDiagnostics;
const payload = { email: "fixture@example.com", message: "Compatibility fixture", submissionId: id,
  attachments: [{ filename: "qa.png", contentType: "image/png", content: "aW1hZ2U=", size: 5 }], diagnostics };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([200, 401, 403, 409, 413, 429, 500, 502])("does not resend a possibly stored report after a misleading %s error", async status => {
  const rows: unknown[] = [];
  const invoke = vi.fn(async (_name: string, options: { body: unknown }) => {
    rows.push(options.body);
    return status === 200 ? { data: { error: unsupported }, error: null }
      : { data: null, error: { context: new Response(JSON.stringify({ error: unsupported }), { status }) } };
  });
  const client = { functions: { invoke } } as unknown as FeedbackClient;
  expect(await submitFeedback(payload, client)).toMatchObject({ success: false });
  expect(rows).toHaveLength(1);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it.each([
  { server: "retry", delay: 20_000, success: true, calls: 1 },
  { server: "diagnostics", delay: 12_000, success: true, calls: 2 },
  { server: "diagnostics", delay: 20_000, success: false, calls: 2 },
  { server: "basic", delay: 8_000, success: true, calls: 3 },
  { server: "basic", delay: 12_000, success: false, calls: 3 },
  { server: "basic", delay: 20_000, success: false, calls: 2 },
])("bounds $server server compatibility with $delay ms per full request", async ({ server, delay, success, calls }) => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  const invoke = vi.fn(async (_name: string, options: { body: Record<string, unknown>; signal: AbortSignal }) => {
    signals.push(options.signal);
    await new Promise(resolve => setTimeout(resolve, delay));
    if ((server !== "retry" && options.body.submissionId) || (server === "basic" && options.body.diagnostics)) {
      return { data: null, error: { context: new Response(JSON.stringify({ error: unsupported }), { status: 400 }) } };
    }
    return { data: { ok: true, feedbackId: id, diagnosticsStatus: server === "basic" ? undefined : "stored" }, error: null };
  });
  const client = { functions: { invoke } } as unknown as FeedbackClient;
  const pending = submitFeedback(payload, client);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await pending).toMatchObject({ success });
  expect(invoke).toHaveBeenCalledTimes(calls);
  expect(invoke.mock.calls.every(([, options]) => options.body.attachments === payload.attachments)).toBe(true);
  if (!success) expect(signals[signals.length - 1]?.aborted).toBe(true);
  // A late pre-write response cannot start another full upload after expiry.
  await vi.advanceTimersByTimeAsync(60_000);
  expect(invoke).toHaveBeenCalledTimes(calls);
});
