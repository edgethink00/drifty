import { invoke, isTauri } from "@tauri-apps/api/core";
import { BUILD_INFO } from "../../buildInfo";

export type CloudDevicePayload = {
  readonly installId: string;
  readonly label: string;
  readonly platform: "macos" | "windows";
  readonly appVersion: string;
};

type NativeCloudDeviceIdentity = {
  readonly installId: string;
  readonly label: string;
  readonly platform: "macos" | "windows";
};

let cachedCloudDevicePayload: Promise<CloudDevicePayload | null> | null = null;

export async function readCloudDevicePayload(): Promise<CloudDevicePayload | null> {
  if (!isTauri()) return null;
  cachedCloudDevicePayload ??= readNativeCloudDevicePayload();
  return cachedCloudDevicePayload;
}

export async function withCloudDevicePayload<TBody extends Record<string, unknown>>(body: TBody): Promise<TBody & { readonly cloudDevice?: CloudDevicePayload; readonly trialActivation: "explicit-v1" }> {
  const cloudDevice = await readCloudDevicePayload();
  return cloudDevice ? { ...body, trialActivation: "explicit-v1", cloudDevice } : { ...body, trialActivation: "explicit-v1" };
}

async function readNativeCloudDevicePayload(): Promise<CloudDevicePayload | null> {
  const identity = await readNativeCloudDeviceIdentity();
  if (identity) return toCloudDevicePayload(identity);

  return invoke<string>("cloud_device_install_id")
    .then((installId) => toCloudDevicePayload({ installId, label: "Mac", platform: "macos" }))
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
    label: identity.label || (identity.platform === "windows" ? "Windows PC" : "Mac"),
    platform: identity.platform,
    // The device row shows which build a person is actually running, so it must
    // carry the real app version. CLOUD_API_CLIENT_VERSION is the frozen
    // cloud-api-v1 compatibility floor and stays pinned for request metadata.
    appVersion: BUILD_INFO.version,
  };
}

function parseNativeCloudDeviceIdentity(value: unknown): NativeCloudDeviceIdentity | null {
  if (!isRecord(value)) return null;
  if (typeof value.installId !== "string" || !value.installId.trim()) return null;
  if (typeof value.label !== "string" || !value.label.trim()) return null;
  // Native builds before the cross-platform identity field were macOS-only.
  const platform = value.platform === undefined
    ? "macos"
    : value.platform === "macos" || value.platform === "windows"
      ? value.platform
      : null;
  if (!platform) return null;

  return {
    installId: value.installId,
    label: value.label,
    platform,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
