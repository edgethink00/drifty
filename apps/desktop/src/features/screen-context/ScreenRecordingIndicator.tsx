import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ScreenContextStatus } from "@drifty/domain";
import { useLocalization } from "../localization/LocalizationContext";
import type { ScreenContextClient } from "./screenContextClient";
import { decodeScreenStatus } from "./screenContextWire";
import "./screen-recording-indicator.css";

type Bound<T> = { readonly generation: number; readonly value: T };

/** Visible while screen recording is on, so it is never on without the person seeing it. */
export function ScreenRecordingIndicator({ client, onOpenSettings }: {
  readonly client: ScreenContextClient;
  readonly onOpenSettings: () => void;
}) {
  const { t } = useLocalization();
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [status, setStatus] = useState<Bound<ScreenContextStatus> | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const ready = snapshot.connection === "ready";
  useEffect(() => {
    if (!ready || busy) return;
    let alive = true; let inFlight = false;
    const poll = async () => {
      if (inFlight) return; inFlight = true;
      try { await client.consume("screen_context_get_status", {}, decodeScreenStatus, (value, generation) => { if (alive) setStatus({ value, generation }); }); }
      catch { /* The settings page reports failures; the indicator only hides. */ }
      finally { inFlight = false; }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [client, ready, busy, snapshot.generation]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); root.current?.querySelector<HTMLButtonElement>(".screen-recording-indicator__pill")?.focus(); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const current = status && client.canDisplay(status.generation) ? status.value : null;
  if (!current || !current.helperInstalled || !current.preferences.enabled) return null;
  const paused = current.paused || current.globalPaused || current.lastFailure === "permission";
  const configure = async (enabled: boolean) => {
    setBusy(true); setOpen(false);
    try {
      await client.mutate("screen_context_configure", { preferences: { ...current.preferences, enabled }, resume: enabled }, decodeScreenStatus,
        (value, generation) => setStatus({ value, generation }));
    } catch { /* The next poll shows the real state. */ }
    finally { setBusy(false); }
  };
  return <div className="screen-recording-indicator" ref={root}>
    <button type="button" className="screen-recording-indicator__pill" data-state={paused ? "paused" : "recording"} aria-haspopup="menu" aria-expanded={open}
      disabled={busy} onClick={() => setOpen((value) => !value)}>
      <span className="screen-recording-indicator__dot" aria-hidden="true" />
      <span>{paused ? t("screenRecording.chrome.paused") : t("screenRecording.chrome.recording")}</span>
    </button>
    {open ? <div className="screen-recording-indicator__menu" role="menu">
      {current.paused
        ? <button type="button" role="menuitem" onClick={() => void configure(true)}>{t("screenRecording.chrome.resume")}</button>
        : <button type="button" role="menuitem" onClick={() => void configure(false)}>{t("screenRecording.chrome.turnOff")}</button>}
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpenSettings(); }}>{t("screenRecording.chrome.settings")}</button>
    </div> : null}
  </div>;
}
