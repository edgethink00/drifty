import { expect } from "vitest";

import type { TeamClient } from "./teamService";

export type AuthUser = {
  readonly id: string;
  readonly email?: string | null;
  readonly is_anonymous?: boolean | null;
};

export type RpcResponse = {
  readonly data: readonly unknown[] | null;
  readonly error: { readonly message: string; readonly code?: string } | null;
};

export type FunctionResponse = {
  readonly data: unknown;
  readonly error: unknown | null;
};

export type RpcCall = {
  readonly procedure: string;
  readonly args: Record<string, unknown> | undefined;
};

export type FunctionCall = {
  readonly name: string;
  readonly body: Record<string, unknown>;
};

export type MockTeamClient = TeamClient & {
  readonly rpcCalls: readonly RpcCall[];
  readonly functionCalls: readonly FunctionCall[];
  setUser(user: AuthUser | null): void;
  setRpcResponse(procedure: string, response: RpcResponse): void;
  setFunctionResponse(response: FunctionResponse): void;
};

export const organizationId = "11111111-1111-4111-8111-111111111111";
export const inviteId = "22222222-2222-4222-8222-222222222222";

const forbiddenPayloadKeys = [
  "segments",
  "app_name",
  "site_domain",
  "window_title",
  "timeline",
  "sessions",
  "raw",
  "app_user_id",
] as const;

export function createClient(): MockTeamClient {
  let user: AuthUser | null = { id: "user-1", email: "alex@example.com", is_anonymous: false };
  let functionResponse: FunctionResponse = { data: { ok: true }, error: null };
  const rpcCalls: RpcCall[] = [];
  const functionCalls: FunctionCall[] = [];
  const rpcResponses = new Map<string, RpcResponse>();

  return {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
    rpc: async (procedure, args) => {
      rpcCalls.push({ procedure, args });
      return rpcResponses.get(procedure) ?? { data: [], error: null };
    },
    functions: {
      invoke: async (name, options) => {
        functionCalls.push({ name, body: options.body });
        return functionResponse;
      },
    },
    get rpcCalls() {
      return rpcCalls;
    },
    get functionCalls() {
      return functionCalls;
    },
    setUser(nextUser) {
      user = nextUser;
    },
    setRpcResponse(procedure, response) {
      rpcResponses.set(procedure, response);
    },
    setFunctionResponse(response) {
      functionResponse = response;
    },
  };
}

export function expectLastRpcCall(client: MockTeamClient): RpcCall {
  const index = client.rpcCalls.length - 1;
  const call = index >= 0 ? client.rpcCalls[index] : undefined;
  if (!call) throw new Error("Expected an RPC call.");
  return call;
}

export function expectRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) throw new Error("Expected a payload object.");
  return value;
}

export function expectNoForbiddenPayloadKeys(payload: Record<string, unknown>): void {
  for (const key of forbiddenPayloadKeys) {
    expect(payload).not.toHaveProperty(key);
  }
}
