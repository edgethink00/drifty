import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ScreenCapturePreferences, ScreenEvidenceDeletion, ScreenImageRetention, ScreenStorageLimitGb } from "@drifty/domain";
import { ModalPresence } from "../../components/ModalPresence";
import { useLocalization } from "../localization/LocalizationContext";
import { localeForDisplayLanguage } from "../../lib/formatting";
import { ScreenContextClient } from "../screen-context/screenContextClient";
import { openSystemSettingsPane } from "../../lib/api/systemSettingsClient";
import { accessibilityClient } from "../../lib/api/accessibilityClient";
import { decodeSampleAccepted, decodeScreenDeletion } from "../screen-context/screenContextWire";
import { EMPTY_SCREEN_PREFERENCES as EMPTY, isMacScreenRecording, replayAppNames, requestScreenRecordingPermission, screenRecordingPhase, screenRecordingPristine,
  turnOnScreenRecording, useScreenRecording, withScreenRecordingDefaults } from "../screen-context/useScreenRecording";
import { ScreenReplayViewer } from "../screen-context/ScreenReplayViewer";
import { useScreenDeletionPreview, type ScreenDeleteRange } from "../screen-context/useScreenDeletionPreview";
import { ScreenRecordingDeleteModal } from "./ScreenRecordingDeleteModal";
import { SettingsSelect } from "./SettingsSelect";
import "../screen-context/screen-context.css";

const RETENTIONS: readonly ScreenImageRetention[] = ["day", "week", "month", "unlimited"];
const LIMITS: readonly ScreenStorageLimitGb[] = [1, 5, 10, 20, 50];
/** A longer period needs room: choosing one raises a smaller storage limit to this. */
const ROOM_FOR: Readonly<Record<ScreenImageRetention, ScreenStorageLimitGb>> = { day: 1, week: 5, month: 20, unlimited: 20 };

/** Saved screens keep 24 hours and 1 GB unless the person chose otherwise. */
function screenRetention(preferences: ScreenCapturePreferences): { readonly retention: ScreenImageRetention; readonly limit: ScreenStorageLimitGb } {
  return { retention: preferences.retention ?? "day", limit: preferences.maxStorageGb ?? 1 };
}

function storedSize(bytes: number, locale: string): string {
  const gb = bytes >= 1024 ** 3;
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: gb ? 1 : 0 }).format(bytes / (gb ? 1024 ** 3 : 1024 ** 2));
  return value + (gb ? "GB" : "MB");
}

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
export function ScreenRecordingPermissionRow({ client, accessibilityGranted = null, groupEnd = false, showDiagnostics = false }: {
  readonly client: ScreenContextClient;
  readonly accessibilityGranted?: boolean | null;
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
  const accessibilityBlocked = phase === "permission" && current?.lastFailure === "accessibility_permission";
  const apps = (current && replayAppNames(current)) || t("screenRecording.permission.supportedApps");
  const turnOn = () => current ? configure({ ...withScreenRecordingDefaults(preferences, current), enabled: true }, true) : Promise.resolve();
  const allow = () => run(async () => {
    if (accessibilityBlocked && !(await accessibilityClient.getStatus()).granted) {
      await openSystemSettingsPane("accessibility", { guide: true });
      return;
    }
    const granted = preferences.enabled
      ? await client.screenRecordingPermitted()
      : await requestScreenRecordingPermission(client);
    setDenied(!granted);
    // The request does not always list Drifty (macOS 27), so the drag-to-grant guide comes along.
    if (!granted) { void openSystemSettingsPane("screenRecording", { guide: true }).catch(() => undefined); return; }
    // Allowing the permission is the choice to record; it is saved as on right away.
    await turnOnScreenRecording(client, preferences.enabled);
  });
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const lastSaved = current?.lastAcceptedAtMs ? t("screenRecording.status.recordingBody", { time: clock(current.lastAcceptedAtMs) }) : null;
  const on = phase === "recording" || phase === "waiting" || phase === "trackingPaused" || phase === "storage";
  // The description already names the recorded apps, so recording shows only when a screen was last saved.
  const note = phase === "recording" || phase === "waiting" ? lastSaved
    : phase === "retrying" ? t("screenRecording.status.retrying")
    : phase === "trackingPaused" ? t("screenRecording.status.trackingPausedBody")
    : phase === "paused" ? t("screenRecording.status.pausedBody")
    : phase === "storage" ? t("screenRecording.status.storageBody")
    : phase === "stopped" ? t("screenRecording.status.stoppedBody")
    : (phase === "permission" || (phase === "off" && mac)) && denied ? t("screenRecording.setup.permissionDenied")
    : accessibilityBlocked ? t(accessibilityGranted === false
      ? "screenRecording.permission.accessibilityMissing"
      : "screenRecording.permission.accessibilityRecovery")
    : phase === "permission" ? t("screenRecording.permission.missing") : null;
  const action = (label: string, onClick: () => void) => <Control>
    <button type="button" className="settings-btn" disabled={busy || !current} aria-busy={busy || undefined} onClick={onClick}>{label}</button>
  </Control>;
  // An install without the recording component never shows the row.
  if (phase === "checking" || phase === "unavailable") return null;
  const control = on || phase === "retrying" ? <Control><span className="settings-permission-status" data-tone={phase === "recording" || phase === "waiting" ? "success" : "neutral"}>{t("common.enabled")}</span></Control>
    : phase === "paused" ? action(t("screenRecording.status.resume"), () => void configure({ ...preferences, enabled: true }, true))
    : phase === "stopped" || phase === "permission" ? action(t(mac ? "screenRecording.status.reconnect" : "screenRecording.status.resume"), () => {
      if (!mac) { void configure({ ...preferences, enabled: true }, true); return; }
      void allow();
    })
    : !mac ? action(t("screenRecording.permission.turnOn"), () => void turnOn())
    : denied ? action(t("screenRecording.setup.permissionOpen"), () => { void openSystemSettingsPane("screenRecording", { guide: true }).catch(() => setError("unavailable")); })
    : action(t("screenRecording.setup.permissionAction"), () => void allow());
  const errorText = errorMessage(error, t);
  return <div data-setting-id="settings.permissions.screenRecording" className={"settings-row settings-permission-row ph-no-capture" + (groupEnd ? " settings-row--group-end" : "")} data-phase={phase}>
    <div>
      <div className="settings-permission-title-line">
        <div className="lbl">{t("screenRecording.switch")}</div>
        <span className="ui-badge ui-badge--quiet settings-permission-requirement">{t("common.optional")}</span>
      </div>
      <div className="desc">
        {t(current?.generalCaptureSupported ? "screenRecording.permission.descGeneral" : mac ? "screenRecording.permission.descMac" : "screenRecording.permission.descWindows",
          { apps, keep: t(`screenRecording.keepSentence.${screenRetention(preferences).retention}`) })}
        {preferences.enabled ? <> <button type="button" className="settings-inline-link settings-permission-link" disabled={busy}
          onClick={() => { setDenied(false); void configure({ ...preferences, enabled: false }); }}>{t("screenRecording.permission.turnOff")} <span aria-hidden="true">→</span></button></> : null}
      </div>
      <div className="desc">{t("screenRecording.permission.trackingContinues")}</div>
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

/**
 * Settings › Privacy & Data › This computer's data: view or delete saved screens, and how long and how
 * much of them stay, once recording has been used. Past 24 hours screens are saved compressed; the
 * storage limit deletes the oldest first.
 */
export function ScreenRecordingDataRow({ client }: { readonly client: ScreenContextClient }) {
  const { effectiveLanguage, t } = useLocalization();
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const { snapshot, current, busy, error, setError, run, configure } = useScreenRecording(client);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteRange, setDeleteRange] = useState<ScreenDeleteRange>("1");
  const [deletion, setDeletion] = useState<ScreenEvidenceDeletion | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const deleteButton = useRef<HTMLButtonElement | null>(null);
  const preview = useScreenDeletionPreview(client, deleteOpen, deleteRange, snapshot.generation);
  // The replay viewer handles its own account changes; a delete inside it must not close it.
  useLayoutEffect(() => { setDeletion(null); setDeleteOpen(false); }, [snapshot.generation]);
  const preferences = current?.preferences ?? EMPTY;
  const remove = () => run(async () => {
    const target = preview.current;
    if (!target || target.value.recordCount === 0 || !client.canDisplay(target.generation)) return;
    // Keep the exact bounded interval the person reviewed, rather than moving it
    // forward while they read. Everything retains its existing purge semantics.
    await client.mutate("screen_context_delete_evidence", { startMs: target.startMs, endMs: target.endMs }, decodeScreenDeletion,
      (value) => { setDeletion(value); setDeleteOpen(false); });
  });
  const closeDelete = () => { if (busy) return; setDeleteOpen(false); window.requestAnimationFrame(() => deleteButton.current?.focus()); };
  if (!client.isDesktop() || !current?.helperInstalled || (!preferences.enabled && screenRecordingPristine(preferences))) return null;
  const errorText = errorMessage(error, t);
  const { retention, limit } = screenRetention(preferences);
  const keep = (next: { readonly retention: ScreenImageRetention; readonly limit: ScreenStorageLimitGb }) =>
    void configure({ ...preferences, retention: next.retention, maxStorageGb: next.limit });
  return <>
    <div data-setting-id="settings.privacy.screenRecordings" className="settings-row ph-no-capture">
      <div><div className="lbl">{t("screenRecording.row.saved")}</div>
        {current.storedBytes !== undefined ? <div className="desc">{t("screenRecording.keep.body", { size: storedSize(current.storedBytes, locale) })}</div> : null}
        {deletion ? <div className="desc screen-recording__result" role="status">{t("screenRecording.delete.done", { count: deletion.removedCount })}</div> : null}
        {errorText && !deleteOpen ? <div className="desc screen-recording__error" role="alert">{errorText}</div> : null}</div>
      <div className="ctrl screen-recording__keep-actions">
        <button type="button" className="settings-btn" onClick={() => setViewerOpen(true)}>{t("screenRecording.row.view")}</button>
        <button ref={deleteButton} type="button" className="settings-btn danger" disabled={busy} onClick={() => { setError(null); setDeleteOpen(true); }}>{t("screenRecording.keep.delete")}</button>
      </div>
    </div>
    <div data-setting-id="settings.privacy.screenRetention" className="settings-row ph-no-capture">
      <div><div className="lbl">{t("screenRecording.keep.period")}</div><div className="desc">{t("screenRecording.keep.periodDesc")}</div></div>
      <div className="ctrl">
        <SettingsSelect ariaLabel={t("screenRecording.keep.period")} value={retention} disabled={busy}
          options={RETENTIONS.map((value) => ({ value, label: t(`screenRecording.keep.${value}`) }))}
          onChange={(value) => keep({ retention: value, limit: Math.max(limit, ROOM_FOR[value]) as ScreenStorageLimitGb })} />
      </div>
    </div>
    <div data-setting-id="settings.privacy.screenStorageLimit" className="settings-row ph-no-capture">
      <div><div className="lbl">{t("screenRecording.keep.limit")}</div><div className="desc">{t("screenRecording.keep.limitDesc")}</div></div>
      <div className="ctrl">
        <SettingsSelect ariaLabel={t("screenRecording.keep.limit")} value={String(limit)} disabled={busy}
          options={LIMITS.map((value) => ({ value: String(value), label: t("screenRecording.keep.gb", { count: value }) }))}
          onChange={(value) => keep({ retention, limit: Number(value) as ScreenStorageLimitGb })} />
      </div>
    </div>
    {createPortal(<ModalPresence>{deleteOpen ? (
      <ScreenRecordingDeleteModal range={deleteRange} onRangeChange={setDeleteRange} preview={preview} busy={busy}
        error={errorText} onClose={closeDelete} onConfirm={() => void remove()} />
    ) : null}</ModalPresence>, document.body)}
    {viewerOpen ? createPortal(<ScreenReplayViewer client={client} source={{ kind: "recent" }} title={t("screenRecording.viewer.recent")}
      onClose={() => setViewerOpen(false)} onInvalidated={() => setViewerOpen(false)} />, document.body) : null}
  </>;
}
