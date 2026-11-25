import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ScreenContextStatus } from "@drifty/domain";
import { Toggle } from "../../components/Toggle";
import { useLocalization } from "../localization/LocalizationContext";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { decodeScreenStatus } from "../screen-context/screenContextWire";
import { decodeMemoryStatus, type MemoryStatus } from "../screen-context/memoryWire";
import { noteMemoryMayBeOn } from "../memory/memoryBeta";
import { clearMarkdownExport, openMarkdownFolder, useMarkdownExportState } from "../memory/memoryExport";
import { MemoryActivityStatus } from "./MemoryActivityStatus";
import { MemoryRuntimeInstall } from "./MemoryRuntimeInstall";
import "./memory-settings.css";

type Bound<T> = { value: T; generation: number };

const COPY = {
  ko: {
    title: "자동 기억", switchLabel: "일하는 동안 본 내용 기억하기",
    switchDesc: "보이는 창을 읽어 기억 탭의 흐름과 페이지로 정리해요. 따로 메모할 필요가 없어요.",
    needsTitle: "켜려면 필요한 것",
    recordingOff: "화면 기록이 꺼져 있거나 멈춰 있어요.", openRecording: "화면 기록 설정",
    modelMissing: "Drifty Cloud(체험·Pro)나 내 Anthropic 키가 필요해요.", connectKey: "키 연결",
    usageToday: (day: number, dayLimit: number) => "오늘 " + day + " / " + dayLimit + "회 정리",
    route: "AI 처리", routeCloud: "Drifty Cloud", routeOwn: "내 Anthropic 키",
    routeCloudDesc: "Pro에 포함돼요. 기억 전용 하루 한도로 처리해서 채팅 크레딧은 쓰지 않아요.",
    routeOwnDesc: "비용은 연결한 Anthropic 계정에 청구돼요.", routeOwnHint: " 체험이나 Pro는 키 없이 쓸 수 있어요.",
    showLog: "처리 기록 보기", hideLog: "처리 기록 닫기",
    reach: "읽는 범위",
    reachDesc: "모든 앱과 사이트에서 보이는 창을 30초마다 읽어요. 제외 목록, 비공개 창, 비밀번호 관리자·키체인·시스템 설정은 빼요.",
    manageExclusions: "제외 목록 관리",
    showSending: "보내는 내용 보기", hideSending: "보내는 내용 닫기",
    sendingBody: [
      "화면 글자와 그 화면 이미지 한 장: 기억을 뽑기 위해 Anthropic의 Claude Haiku에 보내요.",
      "뽑은 기억: 페이지와 노트를 쓰기 위해 같은 곳에 보내요. 검색용 색인은 이 Mac에서 만들어요.",
      "Drifty Cloud로 처리하면 Drifty를 거쳐 가요. 내용은 저장하지 않고 사용량만 기록해요. 내 키로는 Anthropic에 바로 보내요.",
      "채팅에서 쓴 기억: 채팅에 고른 AI에도 전달돼요. 기억을 쓰는 대화는 저장된 채팅 기록과 제품 분석에서 빠져요.",
      "기억은 이 컴퓨터에 암호화해 보관해요.",
    ],
    keepTitle: "보관과 지우기", originals: "읽은 내용 보관",
    originalsDesc: "창에서 읽은 글자와 거기서 뽑은 기억은 이 기간이 지나면 지워져요. 화면 이미지는 저장한 화면의 보관 기간을 따라요.",
    period: (hours: number) => hours === 0 ? "무제한" : hours % 24 === 0 && hours > 24 ? hours / 24 + "일" : hours + "시간",
    pages: "기억 페이지", pagesDesc: "원본이 지워져도 남고, 페이지마다 Markdown 파일로도 이 Mac에 보관해요.",
    pageCount: (count: number) => "페이지 " + count + "개",
    fileCount: (count: number) => "Markdown 파일 " + count + "개",
    exportFailed: "파일을 쓰지 못했어요. 잠시 뒤 다시 시도해요.", exportOpen: "폴더 열기",
    purge: "모두 지우기", purgeDesc: "기억, 페이지, 원본 화면과 보관한 Markdown 파일을 지우고 자동 기억을 꺼요. 활동 기록은 남아요.",
    purgeAction: "지우기…", purgeConfirm: "현재 프로필의 기억과 페이지, 원본 화면, 보관한 Markdown 파일을 모두 지울까요? 되돌릴 수 없어요.", purgeFinal: "모두 지우기", cancel: "취소",
    loadError: "기억 설정을 불러오지 못했어요.",
    credentialsError: "체험이나 Pro로 Drifty Cloud를 쓰거나, AI 연결에서 Anthropic 키를 연결해 주세요.",
    recordingError: "화면 기록을 켜거나 일시정지를 풀어 주세요.",
    applyError: "설정을 적용하지 못했어요. 연결과 화면 기록 상태를 확인해 주세요.",
    phases: {
      unavailable: "기억 엔진에 연결하지 못했어요", extracting: "화면에서 기억을 만드는 중",
      limited: "한도에 닿아 다음 시간에 이어서 정리해요", retrying: "정리에 실패해 다시 시도할 예정이에요",
      pending: "새 화면을 정리하려고 기다리는 중", failed: "정리하지 못한 화면이 있어요",
      ready: "잘 기억하고 있어요", waiting_for_source: "아직 기억할 화면이 없어요",
    },
    recordingPaused: "화면 기록이 멈춰 있어 새 기억을 만들지 않아요", checking: "상태를 확인하고 있어요",
    lastRun: (time: string) => "마지막 정리 " + time, keysNeeded: "AI 연결이 없어 멈춰 있어요",
    routeErrors: {
      sign_in_required: "Drifty 로그인이 끊겨 멈춰 있어요", full_account_required: "Drifty Cloud는 정식 계정에서 쓸 수 있어요",
      plan_required: "체험이나 Pro가 끝나 Drifty Cloud를 쓸 수 없어요", credits_exhausted: "Drifty Cloud 크레딧을 다 써서 멈춰 있어요",
      memory_hourly_limit: "Drifty Cloud 시간당 한도에 닿아 잠시 쉬어요", memory_daily_limit: "기억 전용 하루 한도에 닿아 한도가 풀리면 이어서 정리해요",
      key_rejected: "Anthropic이 키를 거절해 멈춰 있어요", provider_busy: "AI가 바빠 잠시 뒤 다시 시도해요",
    },
    embeddingLoading: "검색 모델을 처음 한 번 내려받는 중이에요 (약 220MB)", embeddingFailed: "검색 모델을 내려받지 못했어요. 인터넷 연결을 확인해 주세요",
  },
  en: {
    title: "Automatic memory", switchLabel: "Remember what I see while working",
    switchDesc: "Reads the windows you see and organizes them into the flow and pages of Work memory. No notes needed.",
    needsTitle: "Needed to turn on",
    recordingOff: "Screen recording is off or paused.", openRecording: "Screen recording settings",
    modelMissing: "Needs Drifty Cloud (trial or Pro) or your own Anthropic key.", connectKey: "Connect key",
    usageToday: (day: number, dayLimit: number) => "Today " + day + " / " + dayLimit + " updates",
    route: "AI processing", routeCloud: "Drifty Cloud", routeOwn: "Your Anthropic key",
    routeCloudDesc: "Included with Pro, on a daily allowance of its own, separate from Chat's credits.",
    routeOwnDesc: "Your connected Anthropic account is charged.", routeOwnHint: " Trials and Pro need no key.",
    showLog: "Show processing log", hideLog: "Hide processing log",
    reach: "What it reads",
    reachDesc: "Reads the visible window of every app and site every 30 seconds. Excluded apps and sites, private windows, password managers, Keychain and System Settings are never read.",
    manageExclusions: "Manage exclusions",
    showSending: "What is sent", hideSending: "Hide what is sent",
    sendingBody: [
      "Screen text and one image of that screen go to Anthropic's Claude Haiku to extract memories.",
      "Extracted memories go to the same place to write pages and notes. The search index is built on this Mac.",
      "Drifty Cloud routes it through Drifty, which keeps only usage, never content. Your own key sends it straight to Anthropic.",
      "Memories used in Chat also go to the AI chosen for Chat. Those chats stay out of saved Chat history and product analytics.",
      "Memories are encrypted on this computer.",
    ],
    keepTitle: "Keeping and deleting", originals: "Keep what was read",
    originalsDesc: "Text read from windows and the memories drawn from it are deleted after this time. Screen images follow the Saved screens period.",
    period: (hours: number) => hours === 0 ? "Unlimited" : hours % 24 === 0 && hours > 24 ? hours / 24 + " days" : hours + (hours === 1 ? " hour" : " hours"),
    pages: "Memory pages", pagesDesc: "Stay after the originals are gone. Each page is also saved as a Markdown file on this Mac.",
    pageCount: (count: number) => count + (count === 1 ? " page" : " pages"),
    fileCount: (count: number) => count + (count === 1 ? " Markdown file" : " Markdown files"),
    exportFailed: "Couldn't write the files. Drifty will try again shortly.", exportOpen: "Open folder",
    purge: "Delete everything", purgeDesc: "Deletes memories, pages, screens and Markdown files, and turns memory off. Activity history stays.",
    purgeAction: "Delete…", purgeConfirm: "Delete all memories, pages, original screens and kept Markdown files for this profile? This can't be undone.", purgeFinal: "Delete all", cancel: "Cancel",
    loadError: "Memory settings are unavailable.",
    credentialsError: "Use Drifty Cloud with a trial or Pro, or connect an Anthropic key in AI connection.",
    recordingError: "Enable or resume screen recording first.",
    applyError: "Could not apply settings. Check your connection and screen recording.",
    phases: {
      unavailable: "The memory engine is unavailable", extracting: "Making memories from a screen",
      limited: "At the update limit; continues next hour", retrying: "An update failed; it will retry",
      pending: "Waiting to process a new screen", failed: "Some screens could not be processed",
      ready: "Remembering as you work", waiting_for_source: "No screens to remember yet",
    },
    recordingPaused: "Screen recording is paused, so no new memories are made", checking: "Checking status",
    lastRun: (time: string) => "Last update " + time, keysNeeded: "Stopped: no AI connection",
    routeErrors: {
      sign_in_required: "Stopped: signed out of Drifty", full_account_required: "Drifty Cloud needs a full account",
      plan_required: "Drifty Cloud ended with the trial or plan", credits_exhausted: "Stopped: Drifty Cloud credits are used up",
      memory_hourly_limit: "Drifty Cloud's hourly limit reached; resuming shortly", memory_daily_limit: "Daily memory allowance reached; continues as it frees up",
      key_rejected: "Stopped: Anthropic rejected the key", provider_busy: "The AI is busy; retrying shortly",
    },
    embeddingLoading: "Downloading the search model once (about 220 MB)", embeddingFailed: "Couldn't download the search model. Check your internet connection",
  },
} as const;

/** Phases that need the person's attention; the status dot turns amber for them. */
const ATTENTION_PHASES: ReadonlySet<string> = new Set(["unavailable", "limited", "retrying", "failed"]);
type StatusTone = "ok" | "warn" | "idle";
/** How long what memory read stays: 24 hours, 7 days, 30 days (the default) or until deleted (0). */
const RETENTION_CHOICES: readonly number[] = [24, 168, 720, 0];
const DEFAULT_MEMORY_RETENTION_HOURS = 720;

type Need = { readonly id: string; readonly text: string; readonly action?: { readonly label: string; readonly run: () => void } };

/**
 * Automatic memory (beta), the first blocks of Settings › AI › Memory above the
 * classification memory: one switch with its status and what it still needs,
 * what it reads, how it is processed (the processing log folded at the end),
 * then how long it stays and how to delete it.
 */
export function MemorySettings({ client, onOpenAiSettings, onOpenScreenRecording, onOpenExclusions, now = Date.now }: {
  readonly client: ScreenContextClient;
  readonly onOpenAiSettings?: () => void;
  readonly onOpenScreenRecording?: () => void;
  readonly onOpenExclusions?: () => void;
  readonly now?: () => number;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const ko = effectiveLanguage.startsWith("ko");
  const c = ko ? COPY.ko : COPY.en;
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [status, setStatus] = useState<Bound<MemoryStatus> | null>(null);
  const [capture, setCapture] = useState<Bound<ScreenContextStatus> | null>(null);
  const [hours, setHours] = useState(DEFAULT_MEMORY_RETENTION_HOURS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [sendingOpen, setSendingOpen] = useState(false);
  const markdown = useMarkdownExportState();
  const current = status && client.canDisplay(status.generation) ? status.value : null;
  const recording = capture && client.canDisplay(capture.generation) ? capture.value : null;
  const enabled = current?.preferences.enabled ?? false;
  const recordingReady = Boolean(recording?.preferences.enabled && !recording.paused && !recording.globalPaused);
  const readVersion = useRef(0);
  const refresh = useCallback(async () => {
    const issued = ++readVersion.current;
    let memory: Bound<MemoryStatus> | null = null;
    try {
      await client.consume("memory_get_status", { includeCredentials: true }, decodeMemoryStatus, (value, generation) => { memory = { value, generation }; });
      await client.consume("screen_context_get_status", {}, decodeScreenStatus, (value, generation) => {
        if (issued === readVersion.current && memory && memory.generation === generation && client.canDisplay(generation)) {
          setStatus(memory); setCapture({ value, generation });
        }
      });
    } catch (reason) {
      if (issued === readVersion.current) { setStatus(null); setCapture(null); }
      throw reason;
    }
  }, [client]);
  const engineReady = useCallback(() => { void refresh().catch(() => undefined); }, [refresh]);
  useEffect(() => {
    if (!client.isDesktop()) return;
    let live = true; let inFlight = false;
    const read = () => {
      if (inFlight) return;
      inFlight = true;
      void refresh()
        .then(() => { if (live) setError((previous) => previous === c.loadError ? null : previous); })
        .catch((reason: unknown) => { if (reason instanceof Error && reason.message === "screen_context_account_changed") return; if (live) setError(c.loadError); })
        .finally(() => { inFlight = false; });
    };
    read(); const timer = setInterval(read, 5000);
    return () => { live = false; readVersion.current += 1; clearInterval(timer); };
  }, [client, refresh, snapshot.generation, c.loadError]);
  useEffect(() => { if (current) noteMemoryMayBeOn(current.preferences.enabled); }, [current]);
  const savedHours = current?.preferences.retentionHours;
  useEffect(() => { if (savedHours !== undefined) setHours(savedHours); }, [savedHours]);
  useEffect(() => { setConfirmPurge(false); }, [snapshot.generation]);
  const action = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await operation(); await refresh(); }
    catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(code === "memory_credentials_required" ? c.credentialsError : code === "memory_recording_required" ? c.recordingError : c.applyError);
    } finally { setBusy(false); }
  };
  // Turning memory on is the choice to send its screen text; a changed retention or route applies in place.
  // Memory reads every app and site but the exclusions (owner decision 2026-11-24). Work sites an
  // earlier version saved are passed back unchanged and no longer limit browsers.
  const configure = (next: boolean, preferences: { retentionHours?: number; ownKey?: boolean } = {}) => action(() => client.mutate("memory_configure", {
    preferences: { enabled: next, retentionHours: preferences.retentionHours ?? hours, workSites: current?.preferences.workSites ?? [], apps: [],
      ...((preferences.ownKey ?? current?.preferences.ownKey) ? { ownKey: true } : {}) },
    acknowledgeExternalText: next,
  }, () => true, () => { if (next) noteMemoryMayBeOn(true); }));
  const changeHours = (value: number) => { setHours(value); if (enabled) void configure(true, { retentionHours: value }); };
  // The route is saved also while memory is off, so the next start uses it.
  const changeRoute = (ownKey: boolean) => void configure(enabled, { ownKey });
  if (!client.isDesktop()) return null;
  const supported = current?.supported !== false;
  const keys = current?.credentials ?? (current?.error === "memory_credentials_required" ? { anthropic: false, cloud: false } : null);
  const keysReady = !keys || keys.cloud || keys.anthropic;
  // With a Drifty Cloud session and a key both there, the person picks the route. Otherwise the engine
  // reports its route once running; before that, a Drifty Cloud session decides it.
  const routeChoice = Boolean(keys?.cloud && keys.anthropic);
  const cloudRoute = routeChoice ? current?.preferences.ownKey !== true : current?.route ? current.route.kind === "cloud" : Boolean(keys?.cloud);
  const needs: Need[] = enabled || !current ? [] : [
    ...(!recordingReady ? [{ id: "recording", text: c.recordingOff, action: onOpenScreenRecording ? { label: c.openRecording, run: onOpenScreenRecording } : undefined }] : []),
    ...(!keysReady ? [{ id: "model", text: c.modelMissing, action: onOpenAiSettings ? { label: c.connectKey, run: onOpenAiSettings } : undefined }] : []),
  ];
  const canTurnOn = Boolean(current) && supported && recordingReady && keysReady;
  const d = current?.diagnostics ?? null;
  const time = (ms: number) => new Date(ms).toLocaleTimeString(ko ? "ko-KR" : "en-US", { hour: "numeric", minute: "2-digit" });
  const fresh = d !== null && now() - d.as_of_ms <= 15000;
  const routeError = current?.route?.error && current.route.error !== "unavailable" ? c.routeErrors[current.route.error] : null;
  // One line under the switch says what memory is doing; the toggle itself already says it is on.
  const [statusText, statusTone]: readonly [string, StatusTone] = !recordingReady ? [c.recordingPaused, "warn"]
    : current?.error === "memory_credentials_required" ? [c.keysNeeded, "warn"]
    : current?.error ? [c.phases.unavailable, "warn"]
    : !fresh || !d ? [c.checking, "idle"]
    : routeError ? [routeError, "warn"]
    : current?.route?.embedding === "loading" ? [c.embeddingLoading, "idle"]
    : current?.route?.embedding === "failed" ? [c.embeddingFailed, "warn"]
    : [c.phases[d.phase], ATTENTION_PHASES.has(d.phase) ? "warn" : "ok"];
  // What leaves the computer stays under the switch, whether memory is on or off.
  const sending = <>
    <button type="button" className="settings-inline-link memory-settings__sending-toggle" aria-expanded={sendingOpen} onClick={() => setSendingOpen(!sendingOpen)}>{sendingOpen ? c.hideSending : c.showSending}</button>
    {sendingOpen && <ul className="memory-settings__sending">{c.sendingBody.map((line) => <li key={line} className="desc">{line}</li>)}</ul>}
  </>;
  const keptCounts = [
    current?.wikiPages != null ? c.pageCount(current.wikiPages) : null,
    markdown.files ? c.fileCount(markdown.files) : null,
  ].filter(Boolean).join(" · ");
  return <div className="memory-settings ph-no-capture" data-sentry-block data-setting-id="settings.memory">
    <div className="settings-block">
      <h3 className="settings-block__title-with-badge">{c.title}<span className="status-badge status-badge--beta">{t("common.beta")}</span></h3>
      <div className="settings-row">
        <div className="memory-settings__grow"><div className="lbl">{c.switchLabel}</div><div className="desc">{c.switchDesc}</div>
          {enabled && <p className="desc memory-settings__status" role="status"><span className="memory-settings__dot" data-tone={statusTone} aria-hidden="true" />
            <span>{statusText}{d?.last_extracted_at_ms ? " · " + c.lastRun(time(d.last_extracted_at_ms)) : ""}</span></p>}
          {current ? sending : null}</div>
        <div className="ctrl"><Toggle checked={enabled} disabled={busy || !current || (!enabled && !canTurnOn)} ariaLabel={c.switchLabel} onChange={(next) => void configure(next)} /></div>
      </div>
      {current?.supported === false && <MemoryRuntimeInstall ko={ko} onReady={engineReady} />}
      {!enabled && current && needs.length > 0 && <div className="settings-row">
        <div><div className="lbl">{c.needsTitle}</div>
          <ul className="memory-settings__needs">{needs.map((item) => <li key={item.id} className="desc"><span>{item.text}</span>
            {item.action ? <button type="button" className="settings-inline-link" onClick={item.action.run}>{item.action.label}</button> : null}</li>)}</ul></div>
      </div>}
      {current && <div className="settings-row">
        <div><div className="lbl">{c.reach}</div><div className="desc">{c.reachDesc}</div></div>
        {onOpenExclusions ? <div className="ctrl"><button type="button" className="settings-btn" onClick={onOpenExclusions}>{c.manageExclusions}</button></div> : null}
      </div>}
      {current && keysReady && <div className="settings-row">
        <div>{routeChoice ? <label className="lbl" htmlFor="memory-route">{c.route}</label> : <div className="lbl">{c.route}</div>}
          <div className="desc">{cloudRoute ? c.routeCloudDesc : c.routeOwnDesc + (keys?.cloud ? "" : c.routeOwnHint)}</div>
          {enabled && d ? <div className="desc memory-settings__meta">{c.usageToday(d.writes_day, d.writes_day_limit)}</div> : null}</div>
        {routeChoice
          ? <div className="ctrl"><select id="memory-route" className="settings-select" disabled={busy} value={cloudRoute ? "cloud" : "own"} onChange={(event) => changeRoute(event.target.value === "own")}>
            <option value="cloud">{c.routeCloud}</option><option value="own">{c.routeOwn}</option></select></div>
          : <div className="ctrl ctrl--value">{cloudRoute ? c.routeCloud : c.routeOwn}</div>}
      </div>}
      {enabled && current && <div className="settings-row memory-settings__log">
        <div className="memory-settings__grow">
          <button type="button" className="settings-inline-link" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}>{logOpen ? c.hideLog : c.showLog}</button>
          {logOpen && <MemoryActivityStatus status={current} capture={recording} ko={ko} />}
        </div>
      </div>}
      {error && <div className="settings-row"><p className="desc memory-settings__error" role="alert">{error}</p></div>}
    </div>
    <div className="settings-block">
      <h3>{c.keepTitle}</h3>
      <div className="settings-row">
        <div><label className="lbl" htmlFor="memory-retention">{c.originals}</label><div className="desc">{c.originalsDesc}</div></div>
        {/* A shorter period an earlier version saved (1 or 6 hours) stays offered until changed. */}
        <div className="ctrl"><select id="memory-retention" className="settings-select" disabled={busy} value={hours} onChange={(event) => changeHours(Number(event.target.value))}>
          {(RETENTION_CHOICES.includes(hours) ? RETENTION_CHOICES : [hours, ...RETENTION_CHOICES]).map((value) =>
            <option key={value} value={value}>{c.period(value)}</option>)}</select></div>
      </div>
      {/* What stays after the originals go, and where its files are. The pages themselves are managed in the
          Memory tab, so this row's one action is the local folder (owner review 2026-11-25). */}
      <div className="settings-row">
        <div><div className="lbl">{c.pages}</div><div className="desc">{c.pagesDesc}</div>
          {keptCounts ? <div className="desc memory-settings__meta">{keptCounts}</div> : null}
          {markdown.failed && <div className="desc memory-settings__export" role="status"><span className="memory-settings__error">{c.exportFailed}</span></div>}</div>
        {markdown.files ? <div className="ctrl"><button type="button" className="settings-btn" onClick={() => void openMarkdownFolder(client).catch(() => undefined)}>{c.exportOpen}</button></div> : null}
      </div>
      <div className="settings-row">
        <div className="memory-settings__grow"><div className="lbl">{c.purge}</div><div className="desc">{c.purgeDesc}</div>
          {confirmPurge && <div className="memory-settings__confirm" role="alert"><p className="desc">{c.purgeConfirm}</p>
            <div className="memory-settings__confirm-actions">
              <button type="button" className="settings-btn" onClick={() => setConfirmPurge(false)}>{c.cancel}</button>
              <button type="button" className="settings-btn danger" disabled={busy} onClick={() => void action(async () => { await client.mutate("memory_purge", {}, () => true, () => {}); setConfirmPurge(false); noteMemoryMayBeOn(false);
                await clearMarkdownExport(client).catch(() => undefined); })}>{c.purgeFinal}</button>
            </div></div>}</div>
        {!confirmPurge && <div className="ctrl"><button type="button" className="settings-btn danger" disabled={busy || !current} onClick={() => setConfirmPurge(true)}>{c.purgeAction}</button></div>}
      </div>
    </div>
  </div>;
}
