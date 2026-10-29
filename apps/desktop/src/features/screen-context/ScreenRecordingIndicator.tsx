import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ScreenContextStatus } from "@drifty/domain";
import { useLocalization } from "../localization/LocalizationContext";
import type { ScreenContextClient } from "./screenContextClient";
import { screenRecordingPhase } from "./useScreenRecording";
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
  const [pollFailed, setPollFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const ready = snapshot.connection === "ready";
  useEffect(() => {
    if (!ready || busy) return;
    let alive = true; let inFlight = false;
    const poll = async () => {
      if (inFlight) return; inFlight = true;
      try { await client.consume("screen_context_get_status", {}, decodeScreenStatus, (value, generation) => { if (alive) { setStatus({ value, generation }); setPollFailed(false); } }); }
      catch { if (alive) setPollFailed(true); }
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
  // Share Settings' interpretation: enabled is not evidence that a screen is being saved.
  const phase = screenRecordingPhase(current);
  if (phase === "checking" || phase === "unavailable" || phase === "off") return null;
  const displayPhase = pollFailed ? "unknown" : phase;
  const labelKey = displayPhase === "trackingPaused" || displayPhase === "paused"
    ? "screenRecording.chrome.paused" : `screenRecording.chrome.${displayPhase}` as const;
  const tone = displayPhase === "recording" ? "recording"
    : displayPhase === "waiting" || displayPhase === "trackingPaused" || displayPhase === "paused" ? "paused" : "attention";
  const apps = current.supportedApps.filter((app) => current.preferences.allowedApps.includes(app.id)).map((app) => app.name).join(" · ")
    || t("screenRecording.permission.supportedApps");
  const explanation = displayPhase === "waiting" ? t("screenRecording.status.waitingBody", { apps })
    : displayPhase === "storage" ? t("screenRecording.status.storageBody")
    : displayPhase === "stopped" ? t("screenRecording.status.stoppedBody")
    : displayPhase === "permission" ? t("screenRecording.chrome.permissionBody")
    : displayPhase === "unknown" ? t("screenRecording.chrome.unknownBody")
    : displayPhase === "trackingPaused" ? t("screenRecording.status.trackingPausedBody")
    : displayPhase === "paused" ? t("screenRecording.status.pausedBody") : null;
  const configure = async (enabled: boolean) => {
    setBusy(true); setOpen(false);
    try {
      await client.mutate("screen_context_configure", { preferences: { ...current.preferences, enabled }, resume: enabled }, decodeScreenStatus,
        (value, generation) => setStatus({ value, generation }));
    } catch { /* The next poll shows the real state. */ }
    finally { setBusy(false); }
  };
  return <div className="screen-recording-indicator" ref={root}>
    <button type="button" className="screen-recording-indicator__pill" data-state={tone} data-phase={displayPhase} title={explanation ?? undefined} aria-haspopup="menu" aria-expanded={open}
      disabled={busy} onClick={() => setOpen((value) => !value)}>
      <span className="screen-recording-indicator__dot" aria-hidden="true" />
      <span>{t(labelKey)}</span>
    </button>
    {open ? <div className="screen-recording-indicator__menu" role="menu">
      {explanation ? <p className="screen-recording-indicator__explanation" role="presentation">{explanation}</p> : null}
      {current.paused
        ? <button type="button" role="menuitem" onClick={() => void configure(true)}>{t("screenRecording.chrome.resume")}</button>
        : <button type="button" role="menuitem" onClick={() => void configure(false)}>{t("screenRecording.chrome.turnOff")}</button>}
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpenSettings(); }}>{t("screenRecording.chrome.settings")}</button>
    </div> : null}
  </div>;
}
