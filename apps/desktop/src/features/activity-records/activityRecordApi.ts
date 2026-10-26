import { invoke, isTauri } from "@tauri-apps/api/core";
import { supabase } from "../../lib/supabase/client";
import { BUILD_INFO } from "../../buildInfo";
import { readCloudDevicePayload } from "../cloud-devices/cloudDeviceIdentity";
import type { ActivityRecordDeletionPayload, ActivityRecordSendResult } from "./activityRecordEngine";
import type { ActivityRecordItem } from "./activityRecordPayload";

const RECORD_ACTIVITY_FUNCTION = "record-activity";
const RECORD_ACTIVITY_TIMEOUT_MS = 60_000;

type CloudHttpResponse = { status: number; body: string };

/**
 * Sends one batch over the same native HTTP command as device sync (it accepts
 * only Supabase Edge Function URLs). Throws on any failure so the cursor stays.
 */
export async function sendActivityRecords(
  expectedAccountId: string,
  batch: { readonly records: readonly ActivityRecordItem[]; readonly deletions: readonly ActivityRecordDeletionPayload[] },
): Promise<ActivityRecordSendResult> {
  if (!supabase || !isTauri()) throw new Error("Activity records need the desktop app and Supabase.");
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken || data.session?.user?.id !== expectedAccountId) {
    throw new Error("The signed-in account changed.");
  }
  const device = await readCloudDevicePayload();
  if (!device) throw new Error("Device identity is unavailable.");

  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const response = await invoke<CloudHttpResponse>("cloud_sync_http_post", {
    request: {
      url: `${supabaseUrl}/functions/v1/${RECORD_ACTIVITY_FUNCTION}`,
      bearerToken: accessToken,
      apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ""),
      bodyJson: {
        accountId: expectedAccountId,
        installId: device.installId,
        appVersion: BUILD_INFO.version,
        records: batch.records,
        deletions: batch.deletions,
      },
      timeoutMs: RECORD_ACTIVITY_TIMEOUT_MS,
    },
  });
  // Before the function is deployed it answers 404; wait like capture off
  // instead of asking again every cycle.
  if (response.status === 404) return { capture: "off" };
  if (response.status >= 400) throw new Error(`Activity records failed (HTTP ${response.status})`);
  const parsed: unknown = JSON.parse(response.body);
  const capture = typeof parsed === "object" && parsed !== null ? (parsed as { capture?: unknown }).capture : undefined;
  if (capture !== "on" && capture !== "off") throw new Error("Activity records returned an unknown answer.");
  return { capture };
}
