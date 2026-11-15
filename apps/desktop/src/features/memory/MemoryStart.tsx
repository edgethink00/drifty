import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ScreenContextStatus } from "@drifty/domain";
import { openSystemSettingsPane } from "../../lib/api/systemSettingsClient";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { decodeScreenStatus } from "../screen-context/screenContextWire";
import type { MemoryStatus } from "../screen-context/memoryWire";
import { requestScreenRecordingPermission, turnOnScreenRecording } from "../screen-context/useScreenRecording";
import { noteMemoryMayBeOn } from "./memoryBeta";
import type { MemoryCopy } from "./memoryCopy";
import { nativeMemoryInstaller, notePendingStart, noteReopenAfterGrant, readPendingStart, type InstallProgress, type MemoryInstaller } from "./memoryInstaller";

type Step = "engine" | "models";
type Phase = "start" | "running" | "failed" | "key" | "permission" | "turningOn" | "error" | "unsupported";
/** The steps this start shows; fixed when it is pressed so the list does not reshuffle. */
type Needs = { readonly engine: boolean; readonly models: boolean; readonly key: boolean; readonly permission: boolean };
type Row = {
  readonly key: string; readonly label: string; readonly state: "todo" | "active" | "wait" | "done" | "stopped";
  readonly detail?: string; readonly hint?: string; readonly action?: ReactNode; readonly progress?: number;
};
const MB = 1024 * 1024;
const TRACKER_ATTEMPTS = 10;
const TRACKER_RETRY_MS = 1500;
const mb = (bytes: number) => Math.round(bytes / MB);

function readRecording(client: ScreenContextClient): Promise<ScreenContextStatus | null> {
  return new Promise((resolve, reject) => {
    void client.consume("screen_context_get_status", {}, decodeScreenStatus, (value) => resolve(value)).catch(reject);
  });
}

/** Keeps the block centred while its height changes, easing it to the new place instead of jumping. */
function useGlide() {
  const ref = useRef<HTMLElement>(null);
  const last = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // offsetTop is the layout position, unaffected by a transform still in flight.
    const top = element.offsetTop;
    const from = last.current;
    last.current = top;
    if (from === null || Math.abs(from - top) < 1 || typeof element.animate !== "function"
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    element.animate([{ transform: "translateY(" + (from - top) + "px)" }, { transform: "none" }],
      { duration: 280, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  });
  return ref;
}

function SetupList({ rows, label }: { rows: readonly Row[]; label: string }) {
  return (
    <ol className="memory-setup" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className={"memory-setup__row is-" + row.state}>
          <span className="memory-setup__mark" aria-hidden="true">
            {row.state === "done"
              ? <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.2 5.2 4.2 7.1 7.9 3.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : row.state === "stopped" ? "!" : null}
          </span>
          <span className="memory-setup__label">{row.label}</span>
          <span className="memory-setup__end">{row.action ?? <span className="memory-setup__detail">{row.detail}</span>}</span>
          {row.hint ? <span className="memory-setup__hint">{row.hint}</span> : null}
          {row.progress !== undefined ? (
            <span className="memory-setup__bar" role="progressbar" aria-label={row.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.progress * 100)}>
              <span style={{ transform: "scaleX(" + Math.max(0.015, row.progress) + ")" }} />
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The Memory page before it holds a page: one action that does everything memory needs
 * (owner decisions 2026-11-12 and 2026-11-15). Pressing it downloads the memory engine and
 * then the on-device search model back to back, asks for an AI connection only when none
 * exists, and asks for screen recording last, because granting it makes macOS quit and
 * reopen Drifty; the reopened app returns here and finishes turning memory on. The button
 * becomes the list of those steps, and the block stays centred in the pane as it grows.
 */
export function MemoryStart({ client, status, copy, installer = nativeMemoryInstaller, onOpenAiSettings, onChanged }: {
  readonly client: ScreenContextClient;
  readonly status: MemoryStatus | null;
  readonly copy: MemoryCopy;
  readonly installer?: MemoryInstaller;
  readonly onOpenAiSettings?: () => void;
  readonly onChanged: () => Promise<void> | void;
}) {
  const pending = useRef(readPendingStart());
  const [phase, setPhase] = useState<Phase>(pending.current ? "running" : "start");
  const [needs, setNeeds] = useState<Needs | null>(pending.current);
  const [engine, setEngine] = useState<InstallProgress | null>(null);
  const [models, setModels] = useState<InstallProgress | null>(null);
  const [current, setCurrent] = useState<Step | null>(null);
  const [failed, setFailed] = useState<Step | null>(null);
  const [permitted, setPermitted] = useState<boolean | null>(null);
  const [, setTick] = useState(0);
  const pace = useRef<{ at: number; bytes: number } | null>(null);
  const running = useRef(false);
  const resumed = useRef(false);
  const alive = useRef(true);
  const glide = useGlide();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const enabled = status?.preferences.enabled === true;
  const keys = status?.credentials ?? null;
  const keysMissing = keys !== null && !keys.cloud && !keys.anthropic;

  // What the start will download, whether this Mac can run memory, and whether macOS will be asked.
  useEffect(() => {
    void Promise.all([installer.engine(), installer.models(), client.screenRecordingPermitted().catch(() => null)]).then(([first, second, granted]) => {
      if (!alive.current) return;
      setEngine(first ?? null);
      setModels(second ?? null);
      setPermitted(granted);
      if (first?.phase === "unsupported" || second?.phase === "unsupported") setPhase("unsupported");
    });
  }, [installer, client]);

  const download = useCallback(async (step: Step): Promise<boolean> => {
    const read = step === "engine" ? installer.engine : installer.models;
    const install = step === "engine" ? installer.installEngine : installer.installModels;
    const save = step === "engine" ? setEngine : setModels;
    const before = (await read()) ?? null;
    if (before) save(before);
    if (before?.phase === "unsupported") { setPhase("unsupported"); notePendingStart(null); return false; }
    if (before?.phase === "ready") return true;
    setCurrent(step);
    const timer = setInterval(() => { void read().then((value) => { if (alive.current && value) save(value); }); }, 400);
    try { await install(); }
    catch { if (alive.current) { setFailed(step); setPhase("failed"); setCurrent(null); } return false; }
    finally { clearInterval(timer); }
    save({ phase: "ready", received: 0, total: before?.total ?? 0 });
    return true;
  }, [installer]);

  const start = useCallback(async () => {
    if (running.current || !status) return;
    running.current = true;
    // The AI connection row joins only when the start reaches it without one: a trial or Pro
    // session can reach the engine a moment after the page first read the status.
    const steps: Needs = needs ?? { engine: !status.supported && engine?.phase !== "ready", models: models?.phase !== "ready", key: false, permission: permitted !== true };
    setNeeds(steps);
    notePendingStart(steps);
    setFailed(null);
    setPhase("running");
    pace.current = null;
    try {
      // 1–2. The memory engine and the search model it embeds with, each downloaded once.
      if (!status.supported && !(await download("engine"))) return;
      if (!(await download("models"))) return;
      setCurrent(null);
      // 3. The AI connection: Drifty Cloud on a trial or Pro, or the person's own Anthropic key.
      if (keysMissing) {
        const asked = { ...steps, key: true };
        setNeeds(asked);
        notePendingStart(asked);
        setPhase("key");
        return;
      }
      // 4. Screen recording, last: granting it makes macOS quit and reopen the app.
      const recording = await readRecording(client);
      if (!recording?.helperInstalled) { setPhase("unsupported"); notePendingStart(null); return; }
      if (!recording.preferences.enabled || recording.paused || recording.lastFailure === "permission") {
        if (!(await client.screenRecordingPermitted())) {
          // The grant can be gone since the start was pressed (or since a pending start was saved):
          // show its row, or the start would stop with no button.
          const asked = { ...steps, permission: true };
          setNeeds(asked);
          notePendingStart(asked);
          setPhase("permission");
          return;
        }
        // Right after macOS reopens the app, tracking may not have started yet; wait for it briefly.
        for (let attempt = 1; ; attempt += 1) {
          try {
            if (!recording.preferences.enabled) await turnOnScreenRecording(client);
            else await client.mutate("screen_context_configure", { preferences: { ...recording.preferences, enabled: true }, resume: true }, decodeScreenStatus, () => {});
            break;
          } catch (failure) {
            const notReady = failure instanceof Error && failure.message === "screen_context_tracker_not_ready";
            if (!notReady || attempt >= TRACKER_ATTEMPTS || !alive.current) throw failure;
            await new Promise((resolve) => setTimeout(resolve, TRACKER_RETRY_MS));
          }
        }
      }
      // 5. Memory itself. Pressing start is the choice to send screen text for it.
      setPhase("turningOn");
      const { retentionHours, workSites } = status.preferences;
      await client.mutate("memory_configure", { preferences: { enabled: true, retentionHours, workSites, apps: [] }, acknowledgeExternalText: true }, () => true, () => {});
      noteMemoryMayBeOn(true);
      notePendingStart(null);
      if (alive.current) setPhase("start");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      if (alive.current && code !== "screen_context_account_changed") {
        if (code === "memory_credentials_required") setNeeds((value) => value && { ...value, key: true });
        setPhase(code === "memory_credentials_required" ? "key" : "error");
      }
    } finally {
      running.current = false;
      if (alive.current) await onChanged();
    }
  }, [client, status, needs, engine, models, keysMissing, permitted, download, onChanged]);

  // Reopened by macOS after the grant, or back from the AI settings: carry the start on.
  useEffect(() => {
    if (!status || resumed.current || !pending.current) return;
    resumed.current = true;
    if (enabled) { notePendingStart(null); setPhase("start"); return; }
    void start();
  }, [status, enabled, start]);
  // Once a connection exists (a Drifty Cloud session arrived, or a key was saved), starting continues.
  // While waiting for one, check every two seconds and on returning to the window.
  useEffect(() => {
    if (phase === "key" && keys !== null && !keysMissing) void start();
  }, [phase, keys, keysMissing, start]);
  useEffect(() => {
    if (phase !== "key") return;
    const check = () => { void onChanged(); };
    const timer = setInterval(check, 2000);
    window.addEventListener("focus", check);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); };
  }, [phase, onChanged]);
  // Back from System Settings with the permission granted, starting continues.
  useEffect(() => {
    if (phase !== "permission") return;
    const resume = () => { void client.screenRecordingPermitted().then((granted) => { if (granted && alive.current) void start(); }).catch(() => undefined); };
    window.addEventListener("focus", resume);
    return () => window.removeEventListener("focus", resume);
  }, [phase, client, start]);
  // The remaining time follows the measured download speed.
  useEffect(() => {
    if (current === null) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [current]);
  const allow = async () => {
    noteReopenAfterGrant();
    try {
      const granted = await requestScreenRecordingPermission(client);
      if (granted) { void start(); return; }
      void openSystemSettingsPane("screenRecording", { guide: true }).catch(() => undefined);
    } catch { if (alive.current) setPhase("error"); }
  };

  const lines = (parts: readonly string[]) => parts.flatMap((part, index) => index === 0 ? [part] : [<br key={index} />, part]);
  const engineNeeded = status?.supported === false && engine?.phase !== "ready";
  const modelsNeeded = models !== null && models.phase !== "ready";
  const stepRow = (step: Step, label: string, progress: InstallProgress | null): Row => {
    const total = progress?.total ?? 0;
    const size = total ? copy.setupSize(mb(total)) : "";
    if (failed === step) return { key: step, label, state: "stopped", hint: copy.startFailed,
      action: <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => void start()}>{copy.retry}</button> };
    if (current === step) {
      if (progress?.phase === "verifying") return { key: step, label, state: "active", detail: copy.startVerifying, progress: 1 };
      const received = Math.min(total, progress?.received ?? 0);
      return { key: step, label, state: "active", detail: total ? copy.setupProgress(mb(received), mb(total)) : "", progress: total ? received / total : 0 };
    }
    const done = progress?.phase === "ready" || (step === "engine" && status?.supported === true) || (current !== null && step === "engine" && current === "models");
    return { key: step, label, state: done ? "done" : "todo", detail: size };
  };

  let title = copy.startTitle;
  let body = copy.startBody;
  let slot: ReactNode = null;
  let caption: ReactNode = null;
  if (phase === "unsupported") {
    title = copy.startUnsupportedTitle;
    body = copy.startUnsupportedBody;
  } else if (enabled) {
    title = copy.startOnTitle;
    body = copy.startOnBody;
    const seen = status?.sources ?? 0;
    slot = <SetupList label={copy.startOnTitle} rows={[
      { key: "read", label: copy.onRead, state: seen > 0 ? "done" : "wait", detail: seen > 0 ? copy.onReadCount(seen) : copy.onReadWaiting },
      { key: "first", label: copy.onFirst, state: seen > 0 ? "active" : "todo", detail: seen > 0 ? copy.onFirstActive : "" },
    ]} />;
    caption = status?.route?.embedding === "loading" ? copy.startModelLoading : null;
  } else if ((phase === "start" || phase === "error") && !needs) {
    slot = <button type="button" className="app-btn app-btn--primary" disabled={!status} onClick={() => void start()}>{copy.startAction}</button>;
    const bytes = (engineNeeded ? engine?.total ?? 0 : 0) + (modelsNeeded ? models?.total ?? 0 : 0);
    caption = phase === "error" ? copy.startError : bytes ? copy.startSize(Math.round(mb(bytes) / 10) * 10) : null;
  } else {
    const steps = needs ?? { engine: engineNeeded, models: modelsNeeded, key: keysMissing, permission: permitted !== true };
    const rows: Row[] = [];
    if (steps.engine) rows.push(stepRow("engine", copy.setupEngine, engine));
    if (steps.models) rows.push(stepRow("models", copy.setupModels, models));
    if (steps.key) rows.push(phase === "key"
      ? { key: "key", label: copy.setupKey, state: "wait", hint: copy.startKeyCaption,
        action: <button type="button" className="app-btn app-btn--primary app-btn--compact" onClick={onOpenAiSettings}>{copy.startKey}</button> }
      : { key: "key", label: copy.setupKey, state: keysMissing ? "todo" : "done" });
    if (steps.permission) rows.push(phase === "permission"
      ? { key: "permission", label: copy.setupPermission, state: "wait", hint: copy.setupPermissionHint,
        action: <button type="button" className="app-btn app-btn--primary app-btn--compact" onClick={() => void allow()}>{copy.startPermission}</button> }
      : { key: "permission", label: copy.setupPermission, state: phase === "turningOn" ? "done" : "todo" });
    slot = rows.length ? <SetupList label={copy.startAction} rows={rows} /> : null;
    if (phase === "turningOn") caption = copy.startTurningOn;
    else if (phase === "error") caption = <>{copy.startError} · <button type="button" className="work-memory-link" onClick={() => void start()}>{copy.retry}</button></>;
    else if (current) {
      const now = Date.now();
      const left = (progress: InstallProgress | null, needed: boolean) => needed && progress && progress.phase !== "ready" ? Math.max(0, progress.total - (progress.phase === "downloading" ? progress.received : 0)) : 0;
      const remaining = left(engine, current === "engine") + left(models, true);
      const done = (engine?.phase === "downloading" ? engine.received : 0) + (models?.phase === "downloading" ? models.received : 0);
      if (!pace.current || done < pace.current.bytes) pace.current = { at: now, bytes: done };
      const elapsed = (now - pace.current.at) / 1000;
      const speed = elapsed >= 1.5 ? (done - pace.current.bytes) / elapsed : 0;
      if (speed > 0) caption = copy.startRemaining(remaining / speed + (current === "engine" ? 5 : 0));
    }
  }
  return (
    <div className="memory-start-frame">
      <section ref={glide} className="memory-start" aria-labelledby="memory-start-title">
        <h2 id="memory-start-title" className="memory-start__title">{title}</h2>
        <p className="memory-start__body">{lines(body)}</p>
        {slot || caption ? (
          <div className="memory-start__slot">
            {slot}
            <p className={"memory-start__caption" + (phase === "error" ? " is-alert" : "")} role="status">{caption}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

