import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ScreenEvidenceDeletion } from "@drifty/domain";
import { ModalPresence } from "../../components/ModalPresence";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { localeForDisplayLanguage } from "../../lib/formatting";
import { ScreenContextClient } from "../screen-context/screenContextClient";
import { openSystemSettingsPane } from "../../lib/api/systemSettingsClient";
import { decodeSampleAccepted, decodeScreenDeletion } from "../screen-context/screenContextWire";
import { EMPTY_SCREEN_PREFERENCES as EMPTY, isMacScreenRecording, requestScreenRecordingPermission, screenRecordingPhase, screenRecordingPristine,
  turnOnScreenRecording, useScreenRecording, withScreenRecordingDefaults } from "../screen-context/useScreenRecording";
import { ScreenReplayViewer } from "../screen-context/ScreenReplayViewer";
import "../screen-context/screen-context.css";

type DeleteRange = "1" | "24" | "all";

function errorMessage(error: string | null, t: ReturnType<typeof useLocalization>["t"]): string | null {
  return error === "screen_context_storage_full" ? t("screenContext.storageFull")
    : error === "screen_context_tracker_not_ready" ? t("screenContext.trackerNotReady") : error ? t("screenRecording.error") : null;
}

function Control({ children }: { readonly children: ReactNode }) {
  return <div className="ctrl settings-permission-control settings-permission-control--single">{children}</div>;
}

/**
 * Settings › General › Permissions. Screen recording is an optional permission:
 * allowing it turns recording on, and without it recording stays off. Windows has
 * no OS permission, so the same row offers Turn on. Installs that cannot record show no row.
 */
export function ScreenRecordingPermissionRow({ client, groupEnd = false, showDiagnostics = false }: {
  readonly client: ScreenContextClient;
  readonly groupEnd?: boolean;
  readonly showDiagnostics?: boolean;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const { current, busy, error, setError, run, configure } = useScreenRecording(client);
  const [denied, setDenied] = useState(false);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const phase = screenRecordingPhase(current);
  const preferences = current?.preferences ?? EMPTY;
  const mac = current ? isMacScreenRecording(current) : true;
  // Saving also needs Accessibility on macOS. When Screen Recording itself is
  // still allowed, the refusal comes from Accessibility, so the row says that.
  const [screenAllowed, setScreenAllowed] = useState(false);
  useEffect(() => {
    if (phase !== "permission" || !mac) { setScreenAllowed(false); return; }
    let active = true;
    void client.screenRecordingPermitted().then((granted) => { if (active) setScreenAllowed(granted); }).catch(() => undefined);
    return () => { active = false; };
  }, [client, phase, mac]);
  const accessibilityOff = phase === "permission" && mac && screenAllowed && !denied;
  const apps = current?.supportedApps.map((app) => app.name).join(" · ") || t("screenRecording.permission.supportedApps");
  const turnOn = () => current ? configure({ ...withScreenRecordingDefaults(preferences, current), enabled: true }, true) : Promise.resolve();
  const allow = () => run(async () => {
    const granted = await requestScreenRecordingPermission(client);
    setDenied(!granted);
    if (!granted) { void openSystemSettingsPane("screenRecording").catch(() => undefined); return; }
    // Allowing the permission is the choice to record; it is saved as on right away.
    await turnOnScreenRecording(client);
  });
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const lastSaved = current?.lastAcceptedAtMs ? t("screenRecording.status.recordingBody", { time: clock(current.lastAcceptedAtMs) }) : null;
  const on = phase === "recording" || phase === "waiting" || phase === "trackingPaused" || phase === "storage";
  const note = phase === "waiting" ? [t("screenRecording.status.waitingBody", { apps }), lastSaved].filter(Boolean).join(" · ")
    : phase === "recording" ? lastSaved
    : phase === "trackingPaused" ? t("screenRecording.status.trackingPausedBody")
    : phase === "paused" ? t("screenRecording.status.pausedBody")
    : phase === "storage" ? t("screenRecording.status.storageBody")
    : phase === "stopped" ? t("screenRecording.status.stoppedBody")
    : (phase === "permission" || (phase === "off" && mac)) && denied ? t("screenRecording.setup.permissionDenied")
    : accessibilityOff ? t("screenRecording.permission.accessibilityMissing")
    : phase === "permission" ? t("screenRecording.permission.missing") : null;
  const action = (label: string, onClick: () => void) => <Control>
    <button type="button" className="settings-btn" disabled={busy || !current} aria-busy={busy || undefined} onClick={onClick}>{label}</button>
  </Control>;
  // An install without the recording component never shows the row.
  if (phase === "checking" || phase === "unavailable") return null;
  const control = on ? <Control><span className="settings-permission-status" data-tone={phase === "recording" || phase === "waiting" ? "success" : "neutral"}>{t("common.enabled")}</span></Control>
    : phase === "paused" || phase === "stopped" ? action(t("screenRecording.status.resume"), () => void configure({ ...preferences, enabled: true }, true))
    : !mac ? action(t("screenRecording.permission.turnOn"), () => void turnOn())
    : accessibilityOff ? action(t("screenRecording.setup.permissionOpen"), () => { void openSystemSettingsPane("accessibility").catch(() => setError("unavailable")); })
    : denied ? action(t("screenRecording.setup.permissionOpen"), () => { void openSystemSettingsPane("screenRecording").catch(() => setError("unavailable")); })
    : action(t("screenRecording.setup.permissionAction"), () => void allow());
  const errorText = errorMessage(error, t);
  return <div data-setting-id="settings.permissions.screenRecording" className={"settings-row settings-permission-row ph-no-capture" + (groupEnd ? " settings-row--group-end" : "")} data-phase={phase}>
    <div>
      <div className="settings-permission-title-line">
        <div className="lbl">{t("screenRecording.switch")}</div>
        <span className="ui-badge ui-badge--quiet settings-permission-requirement">{t("common.optional")}</span>
      </div>
      <div className="desc">
        {t(mac ? "screenRecording.permission.descMac" : "screenRecording.permission.descWindows", { apps })}
        {on || phase === "paused" ? <> <button type="button" className="settings-inline-link settings-permission-link" disabled={busy}
          onClick={() => void configure({ ...preferences, enabled: false })}>{t("screenRecording.permission.turnOff")} <span aria-hidden="true">→</span></button></> : null}
      </div>
      {note ? <div className="desc screen-recording-permission__note" role="status">{note}</div> : null}
      {errorText ? <div className="settings-permission-error" role="alert">{errorText}</div> : null}
      {showDiagnostics && current ? <details className="screen-recording__diagnostics">
        <summary>{t("screenRecording.diagnostics")}</summary>
        <p className="desc">accepted {current.accepted} · dropped {current.dropped} · last {current.lastFailure ?? "none"}</p>
        <button type="button" className="settings-btn" disabled={busy || !preferences.enabled || current.paused} onClick={() => { void run(async () => {
          await client.consume("screen_context_sample_now", {}, decodeSampleAccepted, (accepted) => setSampleNote(accepted ? "accepted" : "not accepted"));
        }); }}>{t("screenContext.sample")}</button>
        {sampleNote ? <span className="desc"> {sampleNote}</span> : null}
      </details> : null}
    </div>
    {control}
  </div>;
}

/** Settings › Privacy & Data › This computer's data: view or delete saved screens, once recording has been used. */
export function ScreenRecordingDataRow({ client }: { readonly client: ScreenContextClient }) {
  const { t } = useLocalization();
  const { snapshot, current, busy, error, run } = useScreenRecording(client);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteRange, setDeleteRange] = useState<DeleteRange>("1");
  const [deletion, setDeletion] = useState<ScreenEvidenceDeletion | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const deleteButton = useRef<HTMLButtonElement | null>(null);
  // The replay viewer handles its own account changes; a delete inside it must not close it.
  useLayoutEffect(() => { setDeletion(null); setDeleteOpen(false); }, [snapshot.generation]);
  const preferences = current?.preferences ?? EMPTY;
  const remove = () => run(async () => {
    const endMs = Date.now();
    const startMs = deleteRange === "all" ? null : endMs - Number(deleteRange) * 3_600_000;
    await client.mutate("screen_context_delete_evidence", { startMs, endMs: startMs === null ? null : endMs }, decodeScreenDeletion,
      (value) => { setDeletion(value); setDeleteOpen(false); });
  });
  const closeDelete = () => { if (busy) return; setDeleteOpen(false); window.requestAnimationFrame(() => deleteButton.current?.focus()); };
  const dismissDelete = useOverlayDismiss(closeDelete);
  if (!client.isDesktop() || !current?.helperInstalled || (!preferences.enabled && screenRecordingPristine(preferences))) return null;
  const errorText = errorMessage(error, t);
  return <>
    <div data-setting-id="settings.privacy.screenRecordings" className="settings-row ph-no-capture">
      <div><div className="lbl">{t("screenRecording.row.saved")}</div><div className="desc">{t("screenRecording.keep.body")}</div>
        {deletion ? <div className="desc screen-recording__result" role="status">{t("screenRecording.delete.done", { count: deletion.removedCount })}</div> : null}
        {errorText ? <div className="desc screen-recording__error" role="alert">{errorText}</div> : null}</div>
      <div className="ctrl screen-recording__keep-actions">
        <button type="button" className="settings-btn" onClick={() => setViewerOpen(true)}>{t("screenRecording.row.view")}</button>
        <button ref={deleteButton} type="button" className="settings-btn danger" disabled={busy} onClick={() => setDeleteOpen(true)}>{t("screenRecording.keep.delete")}</button>
      </div>
    </div>
    {createPortal(<ModalPresence onDismiss={closeDelete} dismissDisabled={busy}>{deleteOpen ? <div className="auth-modal__overlay" {...dismissDelete}>
      <section className="auth-modal modal-shell screen-recording-delete" data-modal-variant="compact" role="dialog" aria-modal="true" aria-labelledby="screen-recording-delete-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="screen-recording-delete-title">{t("screenRecording.delete.title")}</h2>
        <p className="desc">{t("screenRecording.delete.body")}</p>
        <div className="settings-mode-switch settings-mode-switch--triple screen-recording-delete__range" role="radiogroup" aria-label={t("screenRecording.delete.range")}>
          {([["1", t("screenRecording.delete.hour")], ["24", t("screenRecording.delete.day")], ["all", t("screenRecording.delete.all")]] as const).map(([value, label]) =>
            <button key={value} type="button" role="radio" aria-checked={deleteRange === value} disabled={busy}
              className={"settings-mode-option" + (deleteRange === value ? " is-active" : "")} onClick={() => setDeleteRange(value)}><span>{label}</span></button>)}
        </div>
        <div className="screen-recording-delete__actions">
          <button type="button" className="modal-btn modal-btn--ghost" disabled={busy} onClick={closeDelete}>{t("screenRecording.delete.cancel")}</button>
          <button type="button" className="modal-btn modal-btn--danger" disabled={busy} aria-busy={busy} onClick={() => void remove()}>{t("screenRecording.delete.confirm")}</button>
        </div>
      </section>
    </div> : null}</ModalPresence>, document.body)}
    {viewerOpen ? createPortal(<ScreenReplayViewer client={client} source={{ kind: "recent" }} title={t("screenRecording.viewer.recent")}
      onClose={() => setViewerOpen(false)} onInvalidated={() => setViewerOpen(false)} />, document.body) : null}
  </>;
}
