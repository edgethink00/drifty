import { supabase } from "../../lib/supabase/client";
import { cloudApiClientMetadata } from "../../lib/cloudContract";

export type FeedbackPayload = {
  email: string;
  message: string;
  attachments?: FeedbackAttachment[];
};

export type FeedbackAttachment = {
  filename: string;
  contentType: string;
  content: string;
  size: number;
};

export type FeedbackResult =
  | { success: true }
  | { success: false; error: string };

export type FeedbackClient = Pick<NonNullable<typeof supabase>, "functions">;

type FeedbackFunctionResponse = {
  ok?: boolean;
  error?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_SEND_ERROR = "Unable to send feedback right now.";

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

  try {
    const { data, error } = await client.functions.invoke<FeedbackFunctionResponse>("send-feedback", {
      body: {
        ...cloudApiClientMetadata,
        email,
        message,
        ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
      },
    });

    if (error) {
      return { success: false, error: await readFunctionError(error) };
    }

    if (data?.error) {
      return { success: false, error: data.error };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
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
