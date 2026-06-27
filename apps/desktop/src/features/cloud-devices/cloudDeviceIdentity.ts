import { invoke, isTauri } from "@tauri-apps/api/core";
import { CLOUD_API_CLIENT_VERSION } from "../../lib/cloudContract";

export type CloudDevicePayload = {
  readonly installId: string;
  readonly label: string;
  readonly platform: "macos";
  readonly appVersion: string;
};

type NativeCloudDeviceIdentity = {
  readonly installId: string;
  readonly label: string;
};

let cachedCloudDevicePayload: Promise<CloudDevicePayload | null> | null = null;

export async function readCloudDevicePayload(): Promise<CloudDevicePayload | null> {
  if (!isTauri()) return null;
  cachedCloudDevicePayload ??= readNativeCloudDevicePayload();
  return cachedCloudDevicePayload;
}

export async function withCloudDevicePayload<TBody extends Record<string, unknown>>(body: TBody): Promise<TBody & { readonly cloudDevice?: CloudDevicePayload }> {
  const cloudDevice = await readCloudDevicePayload();
  return cloudDevice ? { ...body, cloudDevice } : body;
}

async function readNativeCloudDevicePayload(): Promise<CloudDevicePayload | null> {
  const identity = await readNativeCloudDeviceIdentity();
  if (identity) return toCloudDevicePayload(identity);

  return invoke<string>("cloud_device_install_id")
    .then((installId) => toCloudDevicePayload({ installId, label: "Mac" }))
    .catch(() => null);
}

async function readNativeCloudDeviceIdentity(): Promise<NativeCloudDeviceIdentity | null> {
  return invoke<unknown>("cloud_device_identity")
    .then(parseNativeCloudDeviceIdentity)
    .catch(() => null);
}

function toCloudDevicePayload(identity: NativeCloudDeviceIdentity): CloudDevicePayload {
  return {
    installId: identity.installId,
    label: identity.label || "Mac",
    platform: "macos",
    appVersion: CLOUD_API_CLIENT_VERSION,
  };
}

function parseNativeCloudDeviceIdentity(value: unknown): NativeCloudDeviceIdentity | null {
  if (!isRecord(value)) return null;
  if (typeof value.installId !== "string" || !value.installId.trim()) return null;
  if (typeof value.label !== "string" || !value.label.trim()) return null;

  return {
    installId: value.installId,
    label: value.label,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
