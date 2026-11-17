import { supabase } from "../../lib/supabase/client";
import { BUILD_INFO } from "../../buildInfo";
import { cloudApiClientMetadata } from "../../lib/cloudContract";
import type { FeedbackDiagnostics } from "./feedbackDiagnostics";

export type FeedbackPayload = {
  email: string;
  message: string;
  attachments?: FeedbackAttachment[];
  /** Present only when the person left "Include debug logs" checked. */
  diagnostics?: FeedbackDiagnostics | null;
  /** Reused only in the open draft; saved receipts never restore retry state. */
  submissionId?: string;
};

export type FeedbackAttachment = {
  filename: string;
  contentType: string;
  content: string;
  size: number;
};

export type FeedbackDiagnosticsStatus = "stored" | "not_requested" | "invalid" | "too_large" | "storage_unsupported" | "unconfirmed";

export type FeedbackResult =
  | { success: true; diagnosticsIncluded: boolean; diagnosticsStatus?: FeedbackDiagnosticsStatus; feedbackId?: string | null }
  | { success: false; error: string };

export type FeedbackClient = Pick<NonNullable<typeof supabase>, "functions">;

type FeedbackFunctionResponse = {
  ok?: boolean;
  diagnosticsStatus?: FeedbackDiagnosticsStatus;
  feedbackId?: string;
  error?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_SEND_ERROR = "Unable to send feedback right now.";
// Includes response-body reads and the legacy compatibility resend. Expiry
// releases the form with its draft intact; a late acknowledgement is ignored.
const FEEDBACK_SEND_TIMEOUT_MS = 30_000;
/**
 * What a send-feedback deployment that predates diagnostics answers when the
 * body carries the new field. The report is resent without diagnostics so a
 * client released ahead of the function never loses the person's message.
 */
const UNSUPPORTED_FIELDS_ERROR = "Request body contains unsupported fields.";

export async function submitFeedback(payload: FeedbackPayload, client: FeedbackClient | null = supabase): Promise<FeedbackResult> {
  const email = payload.email.trim();
  const message = payload.message.trim();

  if (!client) {
    return { success: false, error: "Feedback sending is not configured in this build." };
  }

  if (!email) {
    return { success: false, error: "Enter an email address so we can follow up." };
  }

  if (!EMAIL_PATTERN.test(email)) {
    return { success: false, error: "Enter a valid email address, like name@example.com." };
  }

  if (!message) {
    return { success: false, error: "Write a short note before sending feedback." };
  }

  const body = {
    ...cloudApiClientMetadata,
    // clientVersion stays pinned to the cloud-api-v1 floor, so it cannot say
    // which build a report came from. Send the running build separately.
    appVersion: BUILD_INFO.version,
    email,
    message,
    ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
  };
  const deadline = Date.now() + FEEDBACK_SEND_TIMEOUT_MS;

  if (payload.submissionId) {
    const identified = await invokeSendFeedback(client, { ...body, submissionId: payload.submissionId,
      ...(payload.diagnostics ? { diagnostics: payload.diagnostics } : {}) }, deadline);
    if (identified.ok) return receipt(identified, Boolean(payload.diagnostics));
    // This exact pre-write rejection permits compatibility with older servers.
    // A lost/ambiguous response never drops its ID for a compatibility resend.
    if (!identified.unsupportedFields) return { success: false, error: identified.error };
  }

  if (payload.diagnostics) {
    const withDiagnostics = await invokeSendFeedback(client, { ...body, diagnostics: payload.diagnostics }, deadline);
    if (withDiagnostics.ok) return receipt(withDiagnostics, true);
    if (!withDiagnostics.unsupportedFields) return { success: false, error: withDiagnostics.error };
  }

  const result = await invokeSendFeedback(client, body, deadline);
  return result.ok ? receipt(payload.diagnostics ? { ...result, diagnosticsStatus: "storage_unsupported" } : result, false) : { success: false, error: result.error };
}

type InvokeFeedbackResult = { ok: true; diagnosticsStatus?: FeedbackDiagnosticsStatus; feedbackId?: string }
  | { ok: false; error: string; unsupportedFields?: boolean };

async function invokeSendFeedback(
  client: FeedbackClient,
  body: Record<string, unknown>,
  deadline: number,
): Promise<InvokeFeedbackResult> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return { ok: false, error: GENERIC_SEND_ERROR };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expiry = new Promise<InvokeFeedbackResult>(resolve => {
      timer = setTimeout(() => {
        resolve({ ok: false, error: GENERIC_SEND_ERROR });
        controller.abort();
      }, remainingMs);
    });
    const request = async (): Promise<InvokeFeedbackResult> => {
      const { data, error } = await client.functions.invoke<FeedbackFunctionResponse>("send-feedback", { body, signal: controller.signal });

      if (error) {
        return { ok: false, ...await readFunctionError(error) };
      }

      if (data?.error) {
        return { ok: false, error: data.error };
      }

      if (data?.ok !== true) return { ok: false, error: GENERIC_SEND_ERROR };
      return { ok: true, diagnosticsStatus: data.diagnosticsStatus, feedbackId: data.feedbackId };
    };
    return await Promise.race([request(), expiry]);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : GENERIC_SEND_ERROR,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readFunctionError(error: unknown): Promise<{ error: string; unsupportedFields?: boolean }> {
  const response = getErrorResponse(error);
  if (response) {
    try {
      const body = await response.json();
      if (isFeedbackFunctionResponse(body) && body.error) {
        // Only the known pre-write HTTP rejection permits a compatibility resend.
        // A matching error string in a 2xx/5xx reply does not prove non-storage.
        return { error: body.error, unsupportedFields: response.status === 400 && body.error === UNSUPPORTED_FIELDS_ERROR };
      }
    } catch {
      return { error: GENERIC_SEND_ERROR };
    }
  }

  return { error: GENERIC_SEND_ERROR };
}

function getErrorResponse(error: unknown): Response | null {
  if (!error || typeof error !== "object" || !("context" in error)) return null;
  const context = (error as { context?: unknown }).context;
  return context instanceof Response ? context : null;
}

function isFeedbackFunctionResponse(value: unknown): value is FeedbackFunctionResponse {
  return typeof value === "object" && value !== null && (typeof (value as FeedbackFunctionResponse).error === "string" || typeof (value as FeedbackFunctionResponse).ok === "boolean");
}

/** A legacy function cannot acknowledge attachment storage. Never infer it
 * merely from having sent the diagnostics field. */
function receipt(result: { diagnosticsStatus?: FeedbackDiagnosticsStatus; feedbackId?: string }, requested: boolean): FeedbackResult {
  const allowed: readonly string[] = ["stored", "not_requested", "invalid", "too_large", "storage_unsupported"];
  const diagnosticsStatus = result.diagnosticsStatus && allowed.includes(result.diagnosticsStatus) ? result.diagnosticsStatus : requested ? "unconfirmed" : "not_requested";
  const feedbackId = typeof result.feedbackId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.feedbackId) ? result.feedbackId : null;
  const value = { success: true as const, diagnosticsIncluded: diagnosticsStatus === "stored", diagnosticsStatus, feedbackId };
  try { if (typeof window !== "undefined") window.localStorage.setItem("drifty.support.lastFeedbackReceipt.v1", JSON.stringify(value)); } catch { /* Support receipt only. */ }
  return value;
}
