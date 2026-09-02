import { supabase } from "../../lib/supabase/client";

export type AccountDeletionStage = "not_started" | "billing_stopped" | "unknown";

export type AccountDeletionFailureCode =
  | "account_deletion_unavailable"
  | "auth_required"
  | "confirmation_mismatch"
  | "shared_team_owner"
  | "account_check_failed"
  | "billing_unavailable"
  | "billing_delete_failed"
  | "billing_state_unknown"
  | "cloud_purge_failed"
  | "auth_delete_failed"
  | "account_state_unknown"
  | "transport_unknown"
  | "local_sync_reset_failed"
  | "local_calendar_disconnect_failed"
  | "invalid_response";

export type AccountDeletionResult =
  | { readonly success: true; readonly localDataRetained: true }
  | {
    readonly success: false;
    readonly code: AccountDeletionFailureCode;
    readonly stage: AccountDeletionStage;
    readonly error: string;
  };

type AccountDeletionResponse = {
  readonly ok?: unknown;
  readonly localDataRetained?: unknown;
  readonly code?: unknown;
  readonly stage?: unknown;
  readonly error?: unknown;
};

type AccountDeletionClient = {
  readonly functions: {
    invoke<TData>(functionName: string, options?: { readonly body?: unknown }): Promise<{
      readonly data: TData | null;
      readonly error: unknown;
    }>;
  };
} | null;

export async function deleteDriftyAccount(
  confirmation: string,
  client: AccountDeletionClient = supabase,
): Promise<AccountDeletionResult> {
  if (!client) {
    return deletionFailure(
      "account_deletion_unavailable",
      "not_started",
      "Account deletion is unavailable because Supabase is not configured.",
    );
  }

  try {
    const { data, error } = await client.functions.invoke<AccountDeletionResponse>("delete-account", {
      body: { confirmation },
    });
    if (error) return readFunctionFailure(error);
    if (typeof data?.error === "string" && data.error) return parseFunctionFailure(data);
    if (data?.ok !== true || data.localDataRetained !== true) {
      return deletionFailure("invalid_response", "unknown", "Account deletion returned an invalid response.");
    }
    return { success: true, localDataRetained: true };
  } catch (error) {
    return deletionFailure(
      "transport_unknown",
      "unknown",
      error instanceof Error && error.message ? error.message : "Unable to delete your account.",
    );
  }
}

async function readFunctionFailure(error: unknown): Promise<Exclude<AccountDeletionResult, { success: true }>> {
  if (!isRecord(error) || !isRecord(error.context) || typeof error.context.json !== "function") {
    return deletionFailure("transport_unknown", "unknown", "Unable to delete your account.");
  }
  try {
    const body: unknown = await error.context.json();
    return parseFunctionFailure(body);
  } catch {
    return deletionFailure("transport_unknown", "unknown", "Unable to delete your account.");
  }
}

function parseFunctionFailure(value: unknown): Exclude<AccountDeletionResult, { success: true }> {
  if (!isRecord(value)) {
    return deletionFailure("invalid_response", "unknown", "Account deletion returned an invalid response.");
  }
  const code = isAccountDeletionFailureCode(value.code) ? value.code : "invalid_response";
  const stage = isAccountDeletionStage(value.stage) ? value.stage : "unknown";
  const message = typeof value.error === "string" && value.error
    ? value.error
    : "Account deletion returned an invalid response.";
  return deletionFailure(code, stage, message);
}

function deletionFailure(
  code: AccountDeletionFailureCode,
  stage: AccountDeletionStage,
  error: string,
): Exclude<AccountDeletionResult, { success: true }> {
  return { success: false, code, stage, error };
}

function isAccountDeletionStage(value: unknown): value is AccountDeletionStage {
  return value === "not_started" || value === "billing_stopped" || value === "unknown";
}

function isAccountDeletionFailureCode(value: unknown): value is AccountDeletionFailureCode {
  return typeof value === "string" && ACCOUNT_DELETION_FAILURE_CODES.has(value as AccountDeletionFailureCode);
}

const ACCOUNT_DELETION_FAILURE_CODES = new Set<AccountDeletionFailureCode>([
  "account_deletion_unavailable",
  "auth_required",
  "confirmation_mismatch",
  "shared_team_owner",
  "account_check_failed",
  "billing_unavailable",
  "billing_delete_failed",
  "billing_state_unknown",
  "cloud_purge_failed",
  "auth_delete_failed",
  "account_state_unknown",
  "transport_unknown",
  "local_sync_reset_failed",
  "local_calendar_disconnect_failed",
  "invalid_response",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
