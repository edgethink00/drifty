import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import type { FeedbackDiagnostics } from "./feedbackDiagnostics";
import { submitFeedback, type FeedbackClient } from "./feedbackService";

const unsupported = "Request body contains unsupported fields.";
const payload = { email: "fixture@example.com", message: "Keep this report",
  diagnostics: { schemaVersion: 2 } as FeedbackDiagnostics,
  attachments: [{ filename: "fixture.png", contentType: "image/png", content: "aW1hZ2U=", size: 5 }] };
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it.each([200, 401, 403, 409, 413, 429, 500, 502])("does not resend after a misleading HTTP %s reply", async status => {
  const invoke = vi.fn().mockResolvedValue(status === 200
    ? { data: { error: unsupported }, error: null }
    : { data: null, error: { context: new Response(JSON.stringify({ error: unsupported }), { status }) } });
  const client = { functions: { invoke } } as unknown as FeedbackClient;
  expect(await submitFeedback(payload, client)).toMatchObject({ success: false, error: unsupported });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0][1].body).toMatchObject({ diagnostics: payload.diagnostics, attachments: payload.attachments });
  expect(invoke.mock.calls[0][1].body).not.toHaveProperty("submissionId");
});

it("does not resend an unrelated HTTP 400 rejection", async () => {
  const invoke = vi.fn().mockResolvedValue({ data: null, error: { context: Response.json({ error: "Invalid message." }, { status: 400 }) } });
  expect(await submitFeedback(payload, { functions: { invoke } } as unknown as FeedbackClient))
    .toMatchObject({ success: false, error: "Invalid message." });
  expect(invoke).toHaveBeenCalledTimes(1);
});

it.each([400, 502, 200])("preserves the legacy wire contract with the real SDK over HTTP %s", async status => {
  const received: Record<string, unknown>[] = [];
  let stored = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    received.push(body);
    response.setHeader("Content-Type", "application/json");
    if (received.length === 1) {
      // 400 rejects before writing. The other replies model an ambiguous
      // error after storage, which must never trigger a second submission.
      if (status !== 400) stored++;
      response.writeHead(status);
      response.end(JSON.stringify({ error: unsupported }));
    } else {
      stored++;
      response.end(JSON.stringify({ ok: true }));
    }
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = createClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, "fixture-only",
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const result = await submitFeedback(payload, client);
  expect(received).toHaveLength(status === 400 ? 2 : 1);
  expect(stored).toBe(1);
  expect(received.every(body => !("submissionId" in body))).toBe(true);
  expect(received[0]).toMatchObject({ diagnostics: payload.diagnostics, attachments: payload.attachments });
  if (status === 400) {
    expect(result).toMatchObject({ success: true, diagnosticsIncluded: false, diagnosticsStatus: "storage_unsupported" });
    expect(received[1]).not.toHaveProperty("diagnostics");
    expect(received[1]).toMatchObject({ email: payload.email, message: payload.message, attachments: payload.attachments });
  } else {
    expect(result).toMatchObject({ success: false, error: unsupported });
  }
});
