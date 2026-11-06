import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";
import { SCREEN_CONTEXT_BUILD_ENABLED } from "../screen-context/screenContextBuild";

export type MemoryCloudSession = { readonly url: string; readonly accessToken: string };
type Send = (session: MemoryCloudSession | null) => Promise<void>;

/** Drifty Cloud's memory function beside the account's other Edge Functions; only a hosted project qualifies. */
export function memoryCloudUrl(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.host)) return null;
    return url.origin + "/functions/v1/memory-cloud";
  } catch {
    return null;
  }
}

const sendToEngine: Send = (session) => invoke<void>("memory_set_cloud_session", { session });

/**
 * While automatic memory is available and the account has a trial or Pro,
 * hands the signed-in session (and each refresh) to the native memory engine,
 * so its model calls spend Drifty Cloud credits and need no key. Otherwise it
 * clears the session and memory uses the user's own Anthropic key.
 */
export function useMemoryCloudSession(active: boolean, cloudPlan: boolean, send: Send = sendToEngine): void {
  useEffect(() => {
    if (!active || !SCREEN_CONTEXT_BUILD_ENABLED) return;
    const url = memoryCloudUrl(import.meta.env.VITE_SUPABASE_URL);
    const client = isSupabaseEnabled() ? supabase : null;
    let live = true;
    const push = (session: { access_token: string; user: { is_anonymous?: boolean } } | null) => {
      if (!live) return;
      const usable = cloudPlan && url && session && session.access_token && session.user.is_anonymous !== true;
      void send(usable ? { url, accessToken: session.access_token } : null).catch(() => {});
    };
    if (client) void client.auth.getSession().then(({ data }) => push(data.session)).catch(() => push(null));
    else push(null);
    // The session comes with each event; calling auth methods inside this callback can stall it.
    const subscription = client?.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") push(session);
    }).data.subscription;
    return () => {
      live = false;
      subscription?.unsubscribe();
      void send(null).catch(() => {});
    };
  }, [active, cloudPlan, send]);
}
