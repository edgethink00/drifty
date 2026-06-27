import { cloudApiClientMetadata } from "../../lib/cloudContract";
import { supabase } from "../../lib/supabase/client";
import { withCloudDevicePayload } from "../cloud-devices/cloudDeviceIdentity";
import type { AiConnectionTestResult } from "./aiConnectionTest";

type CloudFunctionResult<TData> = {
  readonly data: TData | null;
  readonly error: unknown;
};

type CloudAiConnectionTestClient = {
  readonly functions: {
    invoke: <TData>(functionName: string, options: { readonly body: Record<string, unknown> }) => Promise<CloudFunctionResult<TData>>;
  };
} | null;

type CloudAiConnectionTestResponse = {
  readonly ok?: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly latencyMs?: number;
  readonly error?: string;
};

export async function testCloudAiConnection(client: CloudAiConnectionTestClient = supabase): Promise<AiConnectionTestResult> {
  if (!client) return { kind: "error", message: "Supabase is not configured." };

  try {
    const body = await withCloudDevicePayload({ ...cloudApiClientMetadata });
    const { data, error } = await client.functions.invoke<CloudAiConnectionTestResponse>("test-ai-connection", {
      body,
    });
    if (error) return { kind: "error", message: await readFunctionError(error, "Cloud AI connection test failed.") };
    if (data?.error) return { kind: "error", message: data.error };
    if (data?.ok !== true) return { kind: "error", message: "Cloud AI connection test returned an invalid response." };

    const latencyMs = typeof data.latencyMs === "number" && Number.isFinite(data.latencyMs) ? data.latencyMs : 0;
    const providerLabel = providerDisplayName(data.provider);
    return { kind: "success", message: `Cloud AI connected via ${providerLabel} in ${latencyMs} ms.` };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error && error.message ? error.message : "Cloud AI connection test failed.",
    };
  }
}

function providerDisplayName(provider: string | undefined): string {
  switch (provider) {
    case "google":
      return "Google";
    case "openrouter":
      return "OpenRouter";
    default:
      return "Drifty Cloud";
  }
}

async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  if (!error || typeof error !== "object" || !("context" in error)) return fallback;
  const context = error.context;
  if (!(context instanceof Response)) return fallback;

  try {
    const body: unknown = await context.clone().json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  } catch {
    return context.status ? `${fallback} ${context.status} ${context.statusText}`.trim() : fallback;
  }

  return fallback;
}
