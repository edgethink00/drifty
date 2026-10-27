import { supabase } from "../../lib/supabase/client";

/** The two read permissions a key can carry (docs/architecture/personal-api.md). */
export type PersonalApiScope = "summary:read" | "activity:read";
/** Days a new key lasts; null keeps it until it is deleted. */
export type PersonalApiKeyLifetime = 30 | 90 | 365 | null;

export const PERSONAL_API_BASE_URL = "https://drifty.so/api/v1";
export const PERSONAL_API_DOCS_URL = "https://docs.drifty.so/account/api/";
export const PERSONAL_API_KEY_LIMIT = 10;
export const PERSONAL_API_KEY_NAME_MAX_LENGTH = 64;

export type PersonalApiKey = {
  readonly id: string;
  readonly name: string;
  /** The key's last four characters. */
  readonly hint: string;
  readonly scopes: readonly PersonalApiScope[];
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
};

export type PersonalApiKeysErrorCode =
  | "plan_required"
  | "key_limit_reached"
  | "full_account_required"
  | "account_changed"
  | "unavailable"
  | "failed";

export class PersonalApiKeysError extends Error {
  constructor(readonly code: PersonalApiKeysErrorCode, message: string) {
    super(message);
    this.name = "PersonalApiKeysError";
  }
}

export type PersonalApiKeysClient = {
  list(accountId: string): Promise<PersonalApiKey[]>;
  create(
    accountId: string,
    input: { readonly name: string; readonly scopes: readonly PersonalApiScope[]; readonly expiresInDays: PersonalApiKeyLifetime },
  ): Promise<{ readonly key: PersonalApiKey; readonly token: string }>;
  remove(accountId: string, keyId: string): Promise<void>;
};

type FunctionsClient = {
  readonly functions: {
    invoke<TData>(functionName: string, options?: { readonly body?: unknown }): Promise<{ readonly data: TData | null; readonly error: unknown }>;
  };
} | null;

const KNOWN_CODES = new Set<PersonalApiKeysErrorCode>(["plan_required", "key_limit_reached", "full_account_required", "account_changed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readKey(value: unknown): PersonalApiKey | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.hint !== "string") return null;
  const scopes = Array.isArray(value.scopes)
    ? value.scopes.filter((scope): scope is PersonalApiScope => scope === "summary:read" || scope === "activity:read")
    : [];
  return {
    id: value.id,
    name: value.name,
    hint: value.hint,
    scopes,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : null,
    lastUsedAt: typeof value.lastUsedAt === "string" ? value.lastUsedAt : null,
  };
}

async function readFailure(error: unknown): Promise<PersonalApiKeysError> {
  if (isRecord(error) && isRecord(error.context) && typeof error.context.json === "function") {
    try {
      const body: unknown = await (error.context.json as () => Promise<unknown>)();
      if (isRecord(body) && typeof body.code === "string" && KNOWN_CODES.has(body.code as PersonalApiKeysErrorCode)) {
        return new PersonalApiKeysError(body.code as PersonalApiKeysErrorCode, typeof body.error === "string" ? body.error : body.code);
      }
    } catch {
      // Falls through to the generic failure.
    }
  }
  return new PersonalApiKeysError("failed", error instanceof Error && error.message ? error.message : "API keys could not be reached.");
}

/** Settings › Developer's calls to the personal-api-keys Edge Function. */
export function createPersonalApiKeysClient(client: FunctionsClient = supabase): PersonalApiKeysClient {
  async function call<T>(body: Record<string, unknown>): Promise<T> {
    if (!client) throw new PersonalApiKeysError("unavailable", "Drifty's cloud is not configured in this build.");
    const { data, error } = await client.functions.invoke<T>("personal-api-keys", { body });
    if (error) throw await readFailure(error);
    if (data === null) throw new PersonalApiKeysError("failed", "API keys returned an empty answer.");
    return data;
  }

  return {
    async list(accountId) {
      const data = await call<{ keys?: unknown }>({ action: "list", accountId });
      if (!Array.isArray(data.keys)) throw new PersonalApiKeysError("failed", "API keys returned an invalid answer.");
      return data.keys.map(readKey).filter((key): key is PersonalApiKey => key !== null);
    },
    async create(accountId, input) {
      const data = await call<{ key?: unknown; token?: unknown }>({ action: "create", accountId, ...input });
      const key = readKey(data.key);
      if (!key || typeof data.token !== "string" || !data.token.startsWith("drifty_sk_")) {
        throw new PersonalApiKeysError("failed", "API keys returned an invalid answer.");
      }
      return { key, token: data.token };
    },
    async remove(accountId, keyId) {
      await call<{ deleted?: unknown }>({ action: "delete", accountId, keyId });
    },
  };
}
