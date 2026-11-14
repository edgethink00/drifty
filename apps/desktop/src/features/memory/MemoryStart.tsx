import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ScreenContextStatus } from "@drifty/domain";
import { openSystemSettingsPane } from "../../lib/api/systemSettingsClient";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { decodeScreenStatus } from "../screen-context/screenContextWire";
import type { MemoryStatus } from "../screen-context/memoryWire";
import { requestScreenRecordingPermission, turnOnScreenRecording } from "../screen-context/useScreenRecording";
import { noteMemoryMayBeOn } from "./memoryBeta";
import type { MemoryCopy } from "./memoryCopy";

type Runtime = { readonly phase: "missing" | "downloading" | "verifying" | "ready" | "failed" | "unsupported"; readonly received: number; readonly total: number };
type Phase = "start" | "preparing" | "failed" | "permission" | "key" | "error" | "unsupported";
const MB = 1024 * 1024;

async function readRuntime(): Promise<Runtime | null> {
  try { return await invoke<Runtime>("memory_runtime_status"); } catch { return null; }
}

function readRecording(client: ScreenContextClient): Promise<ScreenContextStatus | null> {
  return new Promise((resolve, reject) => {
    void client.consume("screen_context_get_status", {}, decodeScreenStatus, (value) => resolve(value)).catch(reject);
  });
}

/**
 * The Memory page before it holds a page: one action that does everything memory needs
 * (owner decision 2026-11-12). Pressing it downloads the memory engine once, turns
 * screen recording on (asking macOS when needed), checks the AI connection and starts
 * memory on every supported work app; excluded apps and sites and private windows are
 * skipped. The title and body hang from a fixed line, so only the slot under them
 * changes between the button, progress, a retry and a caption.
 */
export function MemoryStart({ client, status, copy, onOpenAiSettings, onChanged }: {
  readonly client: ScreenContextClient;
  readonly status: MemoryStatus | null;
  readonly copy: MemoryCopy;
  readonly onOpenAiSettings?: () => void;
  readonly onChanged: () => Promise<void> | void;
}) {
  const [phase, setPhase] = useState<Phase>("start");
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (status?.supported !== false) return;
    void readRuntime().then((value) => { if (alive.current && value) { setRuntime(value); if (value.phase === "unsupported") setPhase("unsupported"); } });
  }, [status?.supported]);
  const enabled = status?.preferences.enabled === true;
  const keys = status?.credentials ?? null;
  const keysMissing = keys !== null && !keys.cloud && !keys.anthropic;

  const start = useCallback(async () => {
    if (running.current || !status) return;
    running.current = true;
    try {
      // 1. The memory engine, downloaded once.
      if (!status.supported) {
        const before = await readRuntime();
        if (before?.phase === "unsupported") { setPhase("unsupported"); return; }
        if (before?.phase !== "ready") {
          setPhase("preparing");
          const timer = setInterval(() => { void readRuntime().then((value) => { if (alive.current && value) setRuntime(value); }); }, 400);
          try { await invoke("memory_runtime_install"); }
          catch { if (alive.current) setPhase("failed"); return; }
          finally { clearInterval(timer); }
        }
      }
      // 2. Screen recording, which memory reads.
      const recording = await readRecording(client);
      if (!recording?.helperInstalled) { setPhase("unsupported"); return; }
      if (!recording.preferences.enabled || recording.paused || recording.lastFailure === "permission") {
        if (!(await client.screenRecordingPermitted())) { setPhase("permission"); return; }
        if (!recording.preferences.enabled) await turnOnScreenRecording(client);
        else await client.mutate("screen_context_configure", { preferences: { ...recording.preferences, enabled: true }, resume: true }, decodeScreenStatus, () => {});
      }
      // 3. The AI connection: Drifty Cloud on a trial or Pro, or the person's own Anthropic key.
      if (keysMissing) { setPhase("key"); return; }
      // 4. Memory itself. Pressing start is the choice to send screen text for it.
      const { retentionHours, workSites } = status.preferences;
      await client.mutate("memory_configure", { preferences: { enabled: true, retentionHours, workSites, apps: [] }, acknowledgeExternalText: true }, () => true, () => {});
      noteMemoryMayBeOn(true);
      if (alive.current) setPhase("start");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      if (alive.current && code !== "screen_context_account_changed") setPhase(code === "memory_credentials_required" ? "key" : "error");
    } finally {
      running.current = false;
      if (alive.current) await onChanged();
    }
  }, [client, status, keysMissing, onChanged]);

  // Back from System Settings with the permission granted, starting continues.
  useEffect(() => {
    if (phase !== "permission") return;
    const resume = () => { void client.screenRecordingPermitted().then((granted) => { if (granted && alive.current) void start(); }).catch(() => undefined); };
    window.addEventListener("focus", resume);
    return () => window.removeEventListener("focus", resume);
  }, [phase, client, start]);
  const allow = async () => {
    try {
      const granted = await requestScreenRecordingPermission(client);
      if (granted) { void start(); return; }
      void openSystemSettingsPane("screenRecording", { guide: true }).catch(() => undefined);
    } catch { if (alive.current) setPhase("error"); }
  };

  const shown: Phase = enabled ? "start" : phase === "start" && keysMissing ? "key" : phase;
  const lines = (parts: readonly string[]) => parts.flatMap((part, index) => index === 0 ? [part] : [<br key={index} />, part]);
  const title = enabled ? copy.startOnTitle : shown === "unsupported" ? copy.startUnsupportedTitle : copy.startTitle;
  const body = enabled ? copy.startOnBody : shown === "unsupported" ? copy.startUnsupportedBody : copy.startBody;
  const total = runtime?.total ? Math.round(runtime.total / MB) : 0;
  const received = runtime ? Math.min(total, Math.round(runtime.received / MB)) : 0;
  const progress = runtime?.phase === "verifying" || runtime?.phase === "ready" ? 1 : total ? received / total : 0;
  let action: ReactNode = null;
  let caption: ReactNode = null;
  if (enabled) {
    caption = status?.route?.embedding === "loading" ? copy.startModelLoading : null;
  } else if (shown === "start" || shown === "error") {
    action = <button type="button" className="app-btn app-btn--primary" disabled={!status} onClick={() => void start()}>{copy.startAction}</button>;
    caption = shown === "error" ? copy.startError : null;
  } else if (shown === "permission") {
    action = <button type="button" className="app-btn app-btn--primary" onClick={() => void allow()}>{copy.startPermission}</button>;
    caption = copy.startPermissionCaption;
  } else if (shown === "key") {
    action = <button type="button" className="app-btn app-btn--primary" onClick={onOpenAiSettings}>{copy.startKey}</button>;
    caption = copy.startKeyCaption;
  } else if (shown === "preparing" || shown === "failed") {
    action = <div className="memory-start__meter" role="progressbar" aria-label={copy.startEngine} aria-valuemin={0} aria-valuemax={total || 100} aria-valuenow={total ? received : undefined}>
      <span className={"memory-start__meter-fill" + (shown === "failed" ? " is-stopped" : "")} style={{ transform: "scaleX(" + Math.max(0.02, progress) + ")" }} />
    </div>;
    caption = shown === "failed"
      ? <>{copy.startFailed} · <button type="button" className="work-memory-link" onClick={() => void start()}>{copy.retry}</button></>
      : runtime?.phase === "verifying" ? copy.startVerifying : total ? copy.startPreparing(received, total) : copy.startEngine;
  }
  return (
    <div className="memory-start-frame">
      <section className="memory-start" aria-labelledby="memory-start-title">
        <h2 id="memory-start-title" className="memory-start__title">{title}</h2>
        <p className="memory-start__body">{lines(body)}</p>
        {action || caption ? (
          <div className="memory-start__slot">
            {action}
            <p className={"memory-start__caption" + (shown === "failed" || shown === "error" ? " is-alert" : "")} role="status">{caption}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
