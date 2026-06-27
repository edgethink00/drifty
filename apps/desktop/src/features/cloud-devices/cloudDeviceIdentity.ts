import { invoke, isTauri } from "@tauri-apps/api/core";
import { CLOUD_API_CLIENT_VERSION } from "../../lib/cloudContract";

export type CloudDevicePayload = {
  readonly installId: string;
  readonly label: string;
  readonly platform: "macos";
  readonly appVersion: string;
};

let cachedCloudDevicePayload: Promise<CloudDevicePayload | null> | null = null;

export async function readCloudDevicePayload(): Promise<CloudDevicePayload | null> {
  if (!isTauri()) return null;
  cachedCloudDevicePayload ??= invoke<string>("cloud_device_install_id")
    .then((installId) => ({
      installId,
      label: "Mac",
      platform: "macos" as const,
      appVersion: CLOUD_API_CLIENT_VERSION,
    }))
    .catch(() => null);
  return cachedCloudDevicePayload;
}

export async function withCloudDevicePayload<TBody extends Record<string, unknown>>(body: TBody): Promise<TBody & { readonly cloudDevice?: CloudDevicePayload }> {
  const cloudDevice = await readCloudDevicePayload();
  return cloudDevice ? { ...body, cloudDevice } : body;
}
