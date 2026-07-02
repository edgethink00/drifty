import { cloudApiClientMetadata } from "../../lib/cloudContract";
import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";
import type {
  AuthUser,
  AuthenticatedClient,
  RpcProcedure,
  TeamClient,
  TeamFailureReason,
  TeamInviteActionResponse,
  TeamInviteFunctionBody,
  TeamResult,
} from "./teamTypes";
import { isRecord } from "./teamServiceRecords";

export function ok<T>(data: T): TeamResult<T> {
  return { success: true, error: null, data };
}

export function fail(reason: TeamFailureReason, error: string): TeamResult<never> {
  return { success: false, error, reason };
}

export type TeamErrorMessage = { readonly message: string };

export function isTeamErrorMessage(value: unknown): value is TeamErrorMessage {
  return isRecord(value) && typeof value.message === "string";
}

export function messageFromTeamError(value: Error | TeamErrorMessage, fallback: string): string {
  return value.message || fallback;
}

export async function requireAuthenticatedClient(client?: TeamClient | null): Promise<TeamResult<AuthenticatedClient>> {
  const resolvedClient = resolveClient(client);
  if (!resolvedClient) return fail("supabase_disabled", "Supabase is not configured");

  try {
    const { data, error } = await resolvedClient.auth.getUser();
    if (error) return fail("remote_error", messageFromRemoteFailure(error, "Unable to read the signed-in user."));
    if (!data.user) return fail("not_authenticated", "Not authenticated");
    if (isAnonymousUser(data.user)) return fail("full_account_required", "Use a full account for Teams.");
    return ok({ client: resolvedClient, user: data.user });
  } catch (error) {
    if (error instanceof Error || isTeamErrorMessage(error)) return fail("remote_error", messageFromTeamError(error, "Unable to read the signed-in user."));
    throw error;
  }
}

export async function callRows<T>(
  client: TeamClient,
  procedure: RpcProcedure,
  args: Record<string, unknown>,
  normalize: (row: unknown) => T,
): Promise<TeamResult<readonly T[]>> {
  try {
    const { data, error } = await client.rpc(procedure, args);
    if (error) return fail(reasonFromSqlCode(error.code), error.message);
    return ok((data ?? []).map(normalize));
  } catch (error) {
    if (error instanceof Error || isTeamErrorMessage(error)) return fail("remote_error", messageFromTeamError(error, "Unable to complete team request."));
    throw error;
  }
}

export async function callFirstRow<T>(
  client: TeamClient,
  procedure: RpcProcedure,
  args: Record<string, unknown>,
  normalize: (row: unknown) => T,
): Promise<TeamResult<T | null>> {
  const result = await callRows(client, procedure, args, normalize);
  if (!result.success) return result;
  return ok(result.data[0] ?? null);
}

export async function invokeTeamInvite(
  body: TeamInviteFunctionBody,
  client?: TeamClient | null,
): Promise<TeamResult<TeamInviteActionResponse>> {
  const auth = await requireAuthenticatedClient(client);
  if (!auth.success) return auth;

  try {
    const { data, error } = await auth.data.client.functions.invoke("team-invites", {
      body: { ...cloudApiClientMetadata, ...body },
    });
    if (error) return readFunctionFailure(error);
    if (!isRecord(data)) return fail("remote_error", "Team invite returned an invalid response.");
    if (typeof data.error === "string") return fail("remote_error", data.error);
    return ok(data);
  } catch (error) {
    if (error instanceof Error || isTeamErrorMessage(error)) return fail("remote_error", messageFromTeamError(error, "Unable to manage team invite."));
    throw error;
  }
}

function resolveClient(client?: TeamClient | null): TeamClient | null {
  if (client) return client;
  if (!isSupabaseEnabled() || !supabase) return null;
  return isTeamClient(supabase) ? supabase : null;
}

async function readFunctionFailure(error: unknown): Promise<TeamResult<never>> {
  const context = isRecord(error) ? error.context : null;
  if (context instanceof Response) {
    try {
      const body: unknown = await context.json();
      if (isRecord(body) && typeof body.error === "string") {
        return fail(reasonFromHttpStatus(context.status, body.error), body.error);
      }
    } catch (parseError) {
      if (parseError instanceof SyntaxError || parseError instanceof TypeError) {
        return fail("remote_error", "Unable to manage team invite.");
      }
      throw parseError;
    }
  }
  return fail("remote_error", messageFromRemoteFailure(error, "Unable to manage team invite."));
}

function reasonFromSqlCode(code: string | undefined): TeamFailureReason {
  switch (code) {
    case "28000": return "full_account_required";
    case "42501": return "forbidden";
    case "22023": return "invalid_input";
    case "P0002": return "not_found";
    case "23505": return "conflict";
    default: return "remote_error";
  }
}

function reasonFromHttpStatus(status: number, message: string): TeamFailureReason {
  if (message.includes("full account")) return "full_account_required";
  if (status === 400) return "invalid_input";
  if (status === 401) return "not_authenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "remote_error";
}

function isAnonymousUser(user: AuthUser): boolean {
  return user.is_anonymous === true || user.app_metadata?.provider === "anonymous" || user.app_metadata?.providers?.includes("anonymous") === true;
}

function messageFromRemoteFailure(value: unknown, fallback: string): string {
  if (value instanceof Error || isTeamErrorMessage(value)) return messageFromTeamError(value, fallback);
  return fallback;
}

function isTeamClient(value: unknown): value is TeamClient {
  return (
    isRecord(value) &&
    isRecord(value.auth) &&
    typeof value.auth.getUser === "function" &&
    typeof value.rpc === "function" &&
    isRecord(value.functions) &&
    typeof value.functions.invoke === "function"
  );
}
