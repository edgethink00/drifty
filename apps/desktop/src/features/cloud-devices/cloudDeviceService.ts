import { supabase } from "../../lib/supabase/client";

export type CloudDeviceAccess = {
  readonly allowed: boolean;
  readonly reason: "device_limit_reached" | "invalid_device" | "unavailable" | null;
  readonly message: string | null;
  readonly activeDeviceCount: number | null;
  readonly maxActiveDevices: number;
  readonly activeWindowDays: number;
  readonly deviceId: string | null;
};

export type CloudDeviceRecord = {
  readonly id: string;
  readonly label: string;
  readonly platform: string;
  readonly appVersion: string | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly revokedAt: string | null;
  readonly isCurrent: boolean;
  readonly isActive: boolean;
};

export type CloudDeviceResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

type CloudDeviceFunctionClient = {
  readonly functions: {
    invoke<TData>(functionName: string, options?: { readonly body?: unknown }): Promise<{ readonly data: TData | null; readonly error: unknown }>;
  };
} | null;

type RevokeCloudDeviceResponse = {
  readonly ok?: boolean;
  readonly error?: string;
};

export async function revokeCloudDevice(
  deviceId: string,
  client: CloudDeviceFunctionClient = supabase,
): Promise<CloudDeviceResult<{ readonly ok: true }>> {
  if (!client) return { success: false, error: "Cloud device management is unavailable because Supabase is not configured." };

  try {
    const { data, error } = await client.functions.invoke<RevokeCloudDeviceResponse>("manage-cloud-devices", {
      body: { action: "revoke", deviceId },
    });

    if (error) return { success: false, error: await readFunctionError(error, "Unable to remove Cloud device.") };
    if (data?.error) return { success: false, error: data.error };
    if (data?.ok !== true) return { success: false, error: "Cloud device management returned an invalid response." };
    return { success: true, data: { ok: true } };
  } catch (error) {
    return { success: false, error: error instanceof Error && error.message ? error.message : "Unable to remove Cloud device." };
  }
}

type JsonResponseLike = {
  readonly json: () => Promise<unknown>;
};

async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  if (!isRecord(error)) return fallback;
  const context = error.context;
  if (!isJsonResponseLike(context)) return fallback;
  try {
    const body = await context.json();
    return readErrorMessage(body) ?? fallback;
  } catch {
    return fallback;
  }
}

function readErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return typeof body.error === "string" && body.error ? body.error : null;
}

function isJsonResponseLike(value: unknown): value is JsonResponseLike {
  return isRecord(value) && typeof value.json === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
