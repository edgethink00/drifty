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
};

export type FeedbackAttachment = {
  filename: string;
  contentType: string;
  content: string;
  size: number;
};

export type FeedbackResult =
  | { success: true; diagnosticsIncluded: boolean }
  | { success: false; error: string };

export type FeedbackClient = Pick<NonNullable<typeof supabase>, "functions">;

type FeedbackFunctionResponse = {
  ok?: boolean;
  error?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_SEND_ERROR = "Unable to send feedback right now.";
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

  if (payload.diagnostics) {
    const withDiagnostics = await invokeSendFeedback(client, { ...body, diagnostics: payload.diagnostics });
    if (withDiagnostics.ok) return { success: true, diagnosticsIncluded: true };
    if (withDiagnostics.error !== UNSUPPORTED_FIELDS_ERROR) return { success: false, error: withDiagnostics.error };
  }

  const result = await invokeSendFeedback(client, body);
  return result.ok ? { success: true, diagnosticsIncluded: false } : { success: false, error: result.error };
}

async function invokeSendFeedback(
  client: FeedbackClient,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data, error } = await client.functions.invoke<FeedbackFunctionResponse>("send-feedback", { body });

    if (error) {
      return { ok: false, error: await readFunctionError(error) };
    }

    if (data?.error) {
      return { ok: false, error: data.error };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : GENERIC_SEND_ERROR,
    };
  }
}

async function readFunctionError(error: unknown): Promise<string> {
  const response = getErrorResponse(error);
  if (response) {
    try {
      const body = await response.json();
      if (isFeedbackFunctionResponse(body) && body.error) return body.error;
    } catch {
      return GENERIC_SEND_ERROR;
    }
  }

  return GENERIC_SEND_ERROR;
}

function getErrorResponse(error: unknown): Response | null {
  if (!error || typeof error !== "object" || !("context" in error)) return null;
  const context = (error as { context?: unknown }).context;
  return context instanceof Response ? context : null;
}

function isFeedbackFunctionResponse(value: unknown): value is FeedbackFunctionResponse {
  return typeof value === "object" && value !== null && (typeof (value as FeedbackFunctionResponse).error === "string" || typeof (value as FeedbackFunctionResponse).ok === "boolean");
}
