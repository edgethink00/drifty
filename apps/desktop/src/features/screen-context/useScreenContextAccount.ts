import { useLayoutEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import {
  DESKTOP_AUTH_SESSION_CHANGING, DESKTOP_AUTH_SESSION_CHANGED, DESKTOP_AUTH_SESSION_FAILED,
} from "../auth/desktopAuthSessionEvents";
import { ScreenContextClient } from "./screenContextClient";
import { SCREEN_CONTEXT_POLICY_CHANGING } from "../../lib/api/screenContextPolicyEvents";

/** Lives with the main app, so closing Privacy never stops account revocation. */
export function useScreenContextAccount(status: string, userId: string | null): ScreenContextClient {
  const [client] = useState(() => new ScreenContextClient(invoke,
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window));
  useLayoutEffect(() => {
    if (!client.isDesktop()) return;
    client.setAccount(status === "loading" ? undefined : status === "authenticated" ? userId ?? undefined : null);
    client.credentialsReady();
    return () => { client.setAccount(undefined); };
  }, [client, status, userId]);
  useLayoutEffect(() => {
    if (!client.isDesktop()) return;
    const changing = () => client.invalidate();
    const changed = () => client.credentialsReady();
    window.addEventListener(DESKTOP_AUTH_SESSION_CHANGING, changing);
    window.addEventListener(DESKTOP_AUTH_SESSION_CHANGED, changed);
    window.addEventListener(DESKTOP_AUTH_SESSION_FAILED, changing);
    window.addEventListener(SCREEN_CONTEXT_POLICY_CHANGING, changing);
    return () => {
      window.removeEventListener(DESKTOP_AUTH_SESSION_CHANGING, changing);
      window.removeEventListener(DESKTOP_AUTH_SESSION_CHANGED, changed);
      window.removeEventListener(DESKTOP_AUTH_SESSION_FAILED, changing);
      window.removeEventListener(SCREEN_CONTEXT_POLICY_CHANGING, changing);
    };
  }, [client]);
  useLayoutEffect(() => {
    if (!client.isDesktop()) return;
    let ended = false;
    const subscriptions: (() => void)[] = [];
    for (const [event, handler] of [
      ["screen-context-invalidated", () => client.invalidate()],
      ["screen-context-visibility-changed", ({ payload }: TauriEvent<unknown>) => client.invalidateVisibility(payload)],
      ["screen-context-policy-ready", () => client.credentialsReady()],
    ] as const) {
      void listen(event, handler).then((stop) => {
        if (ended) stop(); else subscriptions.push(stop);
      }).catch(() => { if (!ended) client.dispose(); });
    }
    return () => { ended = true; subscriptions.forEach((stop) => stop()); };
  }, [client]);
  return client;
}
