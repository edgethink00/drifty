import { cloudApiClientMetadata } from "../../lib/cloudContract";
import { supabase } from "../../lib/supabase/client";
import { withCloudDevicePayload } from "../cloud-devices/cloudDeviceIdentity";
import type { SuggestionCompletionRequest } from "./memorySuggestions";

export const CLOUD_MEMORY_SUGGESTION_TIMEOUT_MS = 60_000;

/**
 * Asks Drifty Cloud to draft or verify one suggestion. The client sends
 * structured evidence only (titles and notes are blanked unless both title
 * settings are on) and the server builds the prompt, so the mode cannot act as a
 * general completion endpoint. Returns the provider answer as JSON text in the
 * same shape a local model produces, or null on any failure.
 */
export function createCloudSuggestionCompleter(
  canSend: () => boolean = () => true,
  ownerId?: string,
  onOwnerChanged?: () => void,
): (request: SuggestionCompletionRequest) => Promise<string | null> {
  return async ({ cluster, language, showTitles, verify }) => {
    if (!supabase || cluster.signal === "settled" || !canSend()) return null;
    const client = supabase;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, CLOUD_MEMORY_SUGGESTION_TIMEOUT_MS);
    });
    try {
      // The outer deadline covers native preparation and SDK body decoding,
      // including transports that ignore AbortSignal.
      return await Promise.race([(async () => {
        const payload = await withCloudDevicePayload({
          ...cloudApiClientMetadata,
          mode: "suggest_memory",
          stage: verify ? "verify" : "draft",
          ...(verify ? { summary: verify.summary } : {}),
          language,
          showTitles,
          cluster: {
            app: cluster.app,
            domain: cluster.domain,
            kind: cluster.kind,
            signal: cluster.signal === "uncertain" ? "uncertain" : "mixed",
            minutes: Math.round(cluster.minutes),
            days: Math.max(1, Math.round(cluster.days)),
            productivityMinutes: {
              focus: Math.round(cluster.productivityMinutes.focus),
              neutral: Math.round(cluster.productivityMinutes.neutral),
              drift: Math.round(cluster.productivityMinutes.drift),
            },
            meanModelConfidence: cluster.meanModelConfidence ?? null,
            evidence: cluster.evidence.slice(0, 6).map((row) => ({
              title: showTitles ? row.title : "",
              minutes: Math.round(row.minutes),
              filedAs: row.filedAs,
              reason: showTitles ? row.reason : "",
            })),
          },
        });
        // Native device identity can suspend preparation; check again at egress.
        if (controller.signal.aborted || !canSend()) return null;
        const session = ownerId ? await client.auth.getSession() : null;
        if (session?.error) return null;
        if (ownerId && session?.data.session?.user.id !== ownerId) {
          onOwnerChanged?.();
          return null;
        }
        if (controller.signal.aborted || !canSend()) return null;
        // Bind this request to the verified owner even if the SDK's shared auth
        // changes while its fetch wrapper is awaiting a refreshed session.
        const token = session?.data.session?.access_token;
        if (ownerId && !token) return null;
        const { data, error } = await client.functions.invoke("classify-activity", {
          body: payload,
          signal: controller.signal,
          timeout: CLOUD_MEMORY_SUGGESTION_TIMEOUT_MS,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        });
        if (error || typeof data !== "object" || data === null) return null;
        const body = data as { summary?: unknown; skip?: unknown; labels?: unknown };
        if (verify) return Array.isArray(body.labels) ? JSON.stringify({ labels: body.labels }) : null;
        if (body.skip === true) return JSON.stringify({ skip: true });
        return typeof body.summary === "string" ? JSON.stringify({ summary: body.summary }) : null;
      })(), timeout]);
    } catch {
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

