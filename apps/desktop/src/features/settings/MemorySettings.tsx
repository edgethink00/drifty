import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ScreenContextStatus } from "@drifty/domain";
import { Toggle } from "../../components/Toggle";
import { useLocalization } from "../localization/LocalizationContext";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { decodeScreenStatus } from "../screen-context/screenContextWire";
import { decodeMemoryStatus, type MemoryStatus } from "../screen-context/memoryWire";
import { BROWSER_APP_IDS } from "../screen-context/useScreenRecording";
import { noteMemoryMayBeOn } from "../memory/memoryBeta";
import { clearMarkdownExport, openMarkdownFolder, useMarkdownExportState } from "../memory/memoryExport";
import { MemoryActivityStatus } from "./MemoryActivityStatus";
import "../screen-context/screen-ai-consent.css";
import "./memory-settings.css";

type Bound<T> = { value: T; generation: number };
/** Site names as the activity tracker records them: lowercase host, no scheme, path or www. */
export function workSites(input: string): string[] {
  const names = input.split(/[\s,]+/).map((part) => part.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, ""))
    .filter((name) => /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(name) && name.length <= 253);
  return [...new Set(names)].slice(0, 32);
}

const COPY = {
  ko: {
    title: "자동 기억", switchLabel: "일하는 동안 본 내용 기억하기",
    switchDesc: "고른 앱의 보이는 창을 읽어 기억 탭의 흐름과 페이지로 정리해요. 따로 메모할 필요가 없어요.",
    needsTitle: "켜려면 필요한 것",
    recordingOff: "화면 기록이 꺼져 있거나 멈춰 있어요.", openRecording: "화면 기록 설정",
    modelMissing: "Drifty Cloud(체험·Pro)나 내 Anthropic 키가 필요해요.", connectKey: "키 연결",
    consent: "고른 앱 화면의 글자를 기억 정리를 위해 AI 서비스로 보내는 데 동의해요.",
    unsupported: "이 빌드에는 기억 엔진이 없어 켤 수 없어요.",
    status: "상태", openTab: "기억 탭 열기", usage: "오늘 정리",
    usageValue: (day: number, dayLimit: number) => day + " / " + dayLimit + "회",
    usageDesc: (hour: number, hourLimit: number) => "이번 시간 " + hour + " / " + hourLimit + "회. 한도에 닿으면 다음 시간에 이어서 정리해요.",
    route: "AI 처리", routeCloud: "Drifty Cloud · Pro에 포함", routeOwn: "내 Anthropic 키",
    routeCloudDesc: "키 없이 Pro와 체험에 포함된 기억 전용 하루 한도로 처리하고, 채팅 크레딧은 쓰지 않아요. Drifty는 보낸 내용을 저장하지 않아요.",
    routeOwnDesc: "비용은 연결한 Anthropic 계정에 청구돼요. 체험이나 Pro에서는 키 없이 Drifty Cloud로 처리해요.",
    details: "자세한 처리 상태", hide: "닫기", show: "보기",
    apps: "기억할 앱",
    appsDesc: "고른 앱의 보이는 창만 30초마다 읽어요. 자동 기억을 켜 두는 동안 화면 기록도 이 앱들만 저장해요.",
    sites: "브라우저 업무 사이트",
    sitesDesc: "여기 있는 사이트에서만 브라우저 화면을 기억해요. 비공개 창과 기록에서 제외한 사이트는 읽지 않아요.",
    sitesEmpty: "아직 없어요. 비어 있으면 브라우저는 기억하지 않아요.",
    addSite: "추가", sitePlaceholder: "github.com", removeSite: (site: string) => site + " 빼기",
    showSending: "보내는 내용 보기", hideSending: "보내는 내용 닫기",
    sendingBody: [
      "화면 글자: 기억을 뽑기 위해 Anthropic의 Claude Haiku에 보내요. 이미지 파일은 보내지 않아요.",
      "뽑은 기억: 페이지와 노트를 쓰기 위해 같은 곳에 보내요. 검색용 색인은 이 Mac에서 만들어요.",
      "체험이나 Pro에서는 Drifty Cloud를 거쳐 보내요. Drifty는 내용을 저장하지 않고 사용량만 기록해요. 내 키로 쓰면 Anthropic에 바로 보내요.",
      "채팅에서 쓴 기억: 채팅에 고른 AI에도 전달돼요. 기억을 쓰는 대화는 저장된 채팅 기록과 제품 분석에서 빠져요.",
      "기억은 이 컴퓨터에 암호화해 보관해요.",
    ],
    keepTitle: "자동 기억 보관과 지우기", originals: "원본 화면과 기억 텍스트", originalsDesc: "이 기간이 지나면 지워져요.",
    hours: (value: number) => value + "시간",
    pages: "기억 페이지", pagesDesc: "원본이 지워져도 직접 지울 때까지 남아요.",
    pageCount: (count: number) => "페이지 " + count + "개", manage: "기억 탭에서 관리",
    exportTitle: "Markdown 파일",
    exportDesc: "페이지마다 .md 파일로 이 Mac에 함께 보관해요. Obsidian이나 AI 도구에서 열 수 있어요.",
    fileCount: (count: number) => "파일 " + count + "개",
    exportFailed: "파일을 쓰지 못했어요. 잠시 뒤 다시 시도해요.", exportOpen: "폴더 열기",
    purge: "모두 지우기", purgeDesc: "기억, 페이지, 원본 화면과 보관한 Markdown 파일을 지우고 자동 기억을 꺼요. 활동 기록은 남아요.",
    purgeAction: "모두 지우기…", purgeConfirm: "현재 프로필의 기억과 페이지, 원본 화면, 보관한 Markdown 파일을 모두 지울까요? 되돌릴 수 없어요.", purgeFinal: "모두 지우기", cancel: "취소",
    loadError: "기억 설정을 불러오지 못했어요.",
    credentialsError: "체험이나 Pro로 Drifty Cloud를 쓰거나, AI 연결에서 Anthropic 키를 연결해 주세요.",
    recordingError: "화면 기록을 켜거나 일시정지를 풀어 주세요.",
    applyError: "설정을 적용하지 못했어요. 연결과 화면 기록 상태를 확인해 주세요.",
    phases: {
      unavailable: "기억 엔진에 연결하지 못했어요", extracting: "화면에서 기억을 만드는 중",
      limited: "한도에 닿아 다음 시간에 이어서 정리해요", retrying: "정리에 실패해 다시 시도할 예정이에요",
      pending: "새 화면을 정리하려고 기다리는 중", failed: "정리하지 못한 화면이 있어요",
      ready: "켜져 있어요", waiting_for_source: "켜져 있어요 · 아직 기억할 화면이 없어요",
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
    switchDesc: "Reads visible windows of the apps you choose and organizes them into the flow and pages of Work memory. No notes needed.",
    needsTitle: "Needed to turn on",
    recordingOff: "Screen recording is off or paused.", openRecording: "Screen recording settings",
    modelMissing: "Needs Drifty Cloud (trial or Pro) or your own Anthropic key.", connectKey: "Connect key",
    consent: "Allow sending the text on screens of the chosen apps to AI services to organize memory.",
    unsupported: "This build has no memory engine, so memory can't be turned on.",
    status: "Status", openTab: "Open Work memory", usage: "Today's updates",
    usageValue: (day: number, dayLimit: number) => day + " / " + dayLimit,
    usageDesc: (hour: number, hourLimit: number) => "This hour " + hour + " / " + hourLimit + ". At the limit, memory continues the next hour.",
    route: "AI processing", routeCloud: "Drifty Cloud · included with Pro", routeOwn: "Your Anthropic key",
    routeCloudDesc: "No key needed: included with Pro and trials under a daily allowance of its own, separate from Chat's credits. Drifty does not store what is sent.",
    routeOwnDesc: "Your connected Anthropic account is charged. With a trial or Pro, Drifty Cloud covers it without a key.",
    details: "Processing details", hide: "Hide", show: "Show",
    apps: "Apps to remember",
    appsDesc: "Reads visible windows of chosen apps every 30 seconds. While memory is on, screen recording also saves only these apps.",
    sites: "Work sites in browsers",
    sitesDesc: "Browser windows are remembered only on these sites. Private windows and sites excluded from recording are never read.",
    sitesEmpty: "None yet. With none, browsers are not remembered.",
    addSite: "Add", sitePlaceholder: "github.com", removeSite: (site: string) => "Remove " + site,
    showSending: "What is sent", hideSending: "Hide what is sent",
    sendingBody: [
      "Screen text goes to Anthropic's Claude Haiku to extract memories. No image files are sent.",
      "Extracted memories go to the same place to write pages and notes. The search index is built on this Mac.",
      "With a trial or Pro it passes through Drifty Cloud, which keeps only usage, never the content. With your own key it goes straight to Anthropic.",
      "Memories used in Chat also go to the AI chosen for Chat. Those chats stay out of saved Chat history and product analytics.",
      "Memories are encrypted on this computer.",
    ],
    keepTitle: "Automatic memory: keeping and deleting", originals: "Original screens and memory text", originalsDesc: "Deleted after this time.",
    hours: (value: number) => value + (value === 1 ? " hour" : " hours"),
    pages: "Memory pages", pagesDesc: "Stay after the originals are gone, until you delete them.",
    pageCount: (count: number) => count + (count === 1 ? " page" : " pages"), manage: "Manage in Work memory",
    exportTitle: "Markdown files",
    exportDesc: "Each page is also kept as a .md file on this Mac, ready for Obsidian or an AI tool.",
    fileCount: (count: number) => count + (count === 1 ? " file" : " files"),
    exportFailed: "Couldn't write the files. Drifty will try again shortly.", exportOpen: "Open folder",
    purge: "Delete everything", purgeDesc: "Deletes memories, pages, original screens and kept Markdown files, and turns memory off. Activity history stays.",
    purgeAction: "Delete everything…", purgeConfirm: "Delete all memories, pages, original screens and kept Markdown files for this profile? This can't be undone.", purgeFinal: "Delete all", cancel: "Cancel",
    loadError: "Memory settings are unavailable.",
    credentialsError: "Use Drifty Cloud with a trial or Pro, or connect an Anthropic key in AI connection.",
    recordingError: "Enable or resume screen recording first.",
    applyError: "Could not apply settings. Check your connection and screen recording.",
    phases: {
      unavailable: "The memory engine is unavailable", extracting: "Making memories from a screen",
      limited: "At the update limit; continues next hour", retrying: "An update failed; it will retry",
      pending: "Waiting to process a new screen", failed: "Some screens could not be processed",
      ready: "On", waiting_for_source: "On · no screens to remember yet",
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

type Need = { readonly id: string; readonly text: string; readonly action?: { readonly label: string; readonly run: () => void } };

/**
 * Automatic memory (beta), the first blocks of Settings › AI › Memory above the
 * classification memory: one switch with what it still needs and what to
 * remember, then how long it stays and how to delete it.
 */
export function MemorySettings({ client, onOpenMemoryTab, onOpenAiSettings, onOpenScreenRecording, now = Date.now }: {
  readonly client: ScreenContextClient;
  readonly onOpenMemoryTab?: () => void;
  readonly onOpenAiSettings?: () => void;
  readonly onOpenScreenRecording?: () => void;
  readonly now?: () => number;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const ko = effectiveLanguage.startsWith("ko");
  const c = ko ? COPY.ko : COPY.en;
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [status, setStatus] = useState<Bound<MemoryStatus> | null>(null);
  const [capture, setCapture] = useState<Bound<ScreenContextStatus> | null>(null);
  const [hours, setHours] = useState(24);
  const [sites, setSites] = useState<string[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const [siteDraft, setSiteDraft] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  const savedSites = current?.preferences.workSites.join("\n");
  useEffect(() => { if (savedSites !== undefined) setSites(savedSites ? savedSites.split("\n") : []); }, [savedSites]);
  // Memory keeps its own apps. Settings saved before that reuse the recording's selected apps, as the engine does.
  const legacyApps = recording && recording.preferences.scope !== "active_display_scene" ? recording.preferences.allowedApps : [];
  const savedApps = current ? (current.preferences.apps.length > 0 ? current.preferences.apps : legacyApps).join("\n") : undefined;
  useEffect(() => { if (savedApps !== undefined) setApps(savedApps ? savedApps.split("\n") : []); }, [savedApps]);
  useEffect(() => { setConsent(false); setConfirmPurge(false); }, [snapshot.generation]);
  const browserSelected = apps.some((id) => BROWSER_APP_IDS.includes(id));
  const action = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await operation(); await refresh(); }
    catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(code === "memory_credentials_required" ? c.credentialsError : code === "memory_recording_required" ? c.recordingError : c.applyError);
    } finally { setBusy(false); }
  };
  // While memory is on its consent stands, so a changed site list or retention applies in place.
  const configure = (next: boolean, preferences: { retentionHours?: number; workSites?: string[]; apps?: string[] } = {}) => action(() => client.mutate("memory_configure", {
    preferences: { enabled: next, retentionHours: preferences.retentionHours ?? hours, workSites: preferences.workSites ?? sites, apps: preferences.apps ?? apps },
    acknowledgeExternalText: next && (enabled || consent),
  }, () => true, () => { if (next) noteMemoryMayBeOn(true); }));
  const changeSites = (next: string[]) => { setSites(next); if (enabled) void configure(true, { workSites: next }); };
  const addSite = () => {
    const added = workSites(siteDraft);
    if (added.length === 0) return;
    setSiteDraft("");
    changeSites(workSites([...sites, ...added].join("\n")));
  };
  const changeHours = (value: number) => { setHours(value); if (enabled) void configure(true, { retentionHours: value }); };
  const toggleApp = (id: string, checked: boolean) => {
    if (!recording) return;
    const next = checked ? [...new Set([...apps, id])] : apps.filter((app) => app !== id);
    setApps(next);
    // While on, the change applies in place; memory cannot run with no app.
    if (enabled && next.length > 0) void configure(true, { apps: next });
  };
  if (!client.isDesktop()) return null;
  const supported = current?.supported !== false;
  const keys = current?.credentials ?? (current?.error === "memory_credentials_required" ? { anthropic: false, cloud: false } : null);
  const keysReady = !keys || keys.cloud || keys.anthropic;
  // The engine reports its route once running; before that, a Drifty Cloud session decides it.
  const cloudRoute = current?.route ? current.route.kind === "cloud" : Boolean(keys?.cloud);
  const appsChosen = apps.length > 0;
  const needs: Need[] = enabled || !current ? [] : [
    ...(!supported ? [{ id: "engine", text: c.unsupported }] : []),
    ...(!recordingReady ? [{ id: "recording", text: c.recordingOff, action: onOpenScreenRecording ? { label: c.openRecording, run: onOpenScreenRecording } : undefined }] : []),
    ...(!keysReady ? [{ id: "model", text: c.modelMissing, action: onOpenAiSettings ? { label: c.connectKey, run: onOpenAiSettings } : undefined }] : []),
  ];
  const canTurnOn = Boolean(current) && supported && recordingReady && consent && appsChosen && keysReady;
  const d = current?.diagnostics ?? null;
  const time = (ms: number) => new Date(ms).toLocaleTimeString(ko ? "ko-KR" : "en-US", { hour: "numeric", minute: "2-digit" });
  const fresh = d !== null && now() - d.as_of_ms <= 15000;
  const routeError = current?.route?.error && current.route.error !== "unavailable" ? c.routeErrors[current.route.error] : null;
  const statusText = !recordingReady ? c.recordingPaused
    : current?.error === "memory_credentials_required" ? c.keysNeeded
    : current?.error ? c.phases.unavailable
    : !fresh || !d ? c.checking
    : routeError ? routeError
    : current?.route?.embedding === "loading" ? c.embeddingLoading
    : current?.route?.embedding === "failed" ? c.embeddingFailed
    : c.phases[d.phase];
  // What leaves the computer, folded beside the consent (off) or the processing details (on).
  const sending = <>
    <button type="button" className="settings-inline-link memory-settings__sending-toggle" aria-expanded={sendingOpen} onClick={() => setSendingOpen(!sendingOpen)}>{sendingOpen ? c.hideSending : c.showSending}</button>
    {sendingOpen && <ul className="memory-settings__sending">{c.sendingBody.map((line) => <li key={line} className="desc">{line}</li>)}</ul>}
  </>;
  return <div className="memory-settings ph-no-capture" data-sentry-block data-setting-id="settings.memory">
    <div className="settings-block">
      <h3>{c.title} <span className="status-badge status-badge--beta">{t("common.beta")}</span></h3>
      <div className="settings-row">
        <div><div className="lbl">{c.switchLabel}</div><div className="desc">{c.switchDesc}</div></div>
        <div className="ctrl"><Toggle checked={enabled} disabled={busy || !current || (!enabled && !canTurnOn)} ariaLabel={c.switchLabel} onChange={(next) => void configure(next)} /></div>
      </div>
      {!enabled && current && needs.length > 0 && <div className="settings-row">
        <div><div className="lbl">{c.needsTitle}</div>
          <ul className="memory-settings__needs">{needs.map((item) => <li key={item.id} className="desc"><span>{item.text}</span>
            {item.action ? <button type="button" className="settings-inline-link" onClick={item.action.run}>{item.action.label}</button> : null}</li>)}</ul></div>
      </div>}
      {!enabled && current && <div className="settings-row">
        <div className="memory-settings__grow">
          <label className="memory-settings__consent"><input type="checkbox" disabled={busy || !supported} checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>{c.consent}</span></label>
          {sending}
        </div>
      </div>}
      {enabled && <div className="settings-row">
        <div><div className="lbl">{c.status}</div><div className="desc" role="status">{statusText}{d?.last_extracted_at_ms ? " · " + c.lastRun(time(d.last_extracted_at_ms)) : ""}</div></div>
        {onOpenMemoryTab ? <div className="ctrl"><button type="button" className="settings-btn" onClick={onOpenMemoryTab}>{c.openTab}</button></div> : null}
      </div>}
      {enabled && d && <div className="settings-row">
        <div><div className="lbl">{c.usage}</div><div className="desc">{c.usageDesc(d.writes_hour, d.writes_hour_limit)}</div></div>
        <div className="ctrl ctrl--value">{c.usageValue(d.writes_day, d.writes_day_limit)}</div>
      </div>}
      {current && keysReady && <div className="settings-row">
        <div><div className="lbl">{c.route}</div><div className="desc">{cloudRoute ? c.routeCloudDesc : c.routeOwnDesc}</div></div>
        <div className="ctrl ctrl--value">{cloudRoute ? c.routeCloud : c.routeOwn}</div>
      </div>}
      <div className="settings-row memory-settings__stack">
        <div><div className="lbl">{c.apps}</div><div className="desc">{c.appsDesc}</div></div>
        <fieldset className="screen-ai-consent__choices memory-settings__apps" disabled={busy || !recording} aria-label={c.apps}>
          <div className="screen-ai-consent__chips">{recording?.supportedApps.map((app) => <label className="screen-ai-consent__chip" key={app.id}>
            <input type="checkbox" checked={apps.includes(app.id)} disabled={enabled && apps.length === 1 && apps.includes(app.id)} onChange={(event) => toggleApp(app.id, event.target.checked)} />{app.name}</label>)}</div>
        </fieldset>
      </div>
      {browserSelected && <div className="settings-row memory-settings__stack">
        <div><label className="lbl" htmlFor="memory-site-input">{c.sites}</label><div className="desc">{c.sitesDesc}</div></div>
        <div className="memory-settings__sites">
          {sites.length === 0 ? <p className="desc">{c.sitesEmpty}</p>
            : <ul className="memory-settings__site-list">{sites.map((site) => <li key={site}><span>{site}</span>
              <button type="button" className="memory-settings__site-remove" disabled={busy} aria-label={c.removeSite(site)} onClick={() => changeSites(sites.filter((item) => item !== site))}>×</button></li>)}</ul>}
          <form className="memory-settings__site-add" onSubmit={(event) => { event.preventDefault(); addSite(); }}>
            <input id="memory-site-input" className="settings-input" value={siteDraft} placeholder={c.sitePlaceholder} disabled={busy} onChange={(event) => setSiteDraft(event.target.value)} />
            <button type="submit" className="settings-btn" disabled={busy || workSites(siteDraft).length === 0}>{c.addSite}</button>
          </form>
        </div>
      </div>}
      {enabled && current && <div className="settings-row">
        <div className="memory-settings__grow"><div className="lbl">{c.details}</div>
          {detailsOpen && <MemoryActivityStatus status={current} capture={recording} ko={ko} />}
          {sending}</div>
        <div className="ctrl"><button type="button" className="settings-btn" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? c.hide : c.show}</button></div>
      </div>}
      {error && <div className="settings-row"><p className="desc memory-settings__error" role="alert">{error}</p></div>}
    </div>
    <div className="settings-block">
      <h3>{c.keepTitle}</h3>
      <div className="settings-row">
        <div><label className="lbl" htmlFor="memory-retention">{c.originals}</label><div className="desc">{c.originalsDesc}</div></div>
        <div className="ctrl"><select id="memory-retention" className="settings-select" disabled={busy} value={hours} onChange={(event) => changeHours(Number(event.target.value))}>
          {[1, 6, 24].map((value) => <option key={value} value={value}>{c.hours(value)}</option>)}</select></div>
      </div>
      <div className="settings-row">
        <div><div className="lbl">{c.pages}</div><div className="desc">{c.pagesDesc}{current?.wikiPages != null ? " · " + c.pageCount(current.wikiPages) : ""}</div></div>
        {onOpenMemoryTab ? <div className="ctrl"><button type="button" className="settings-btn" onClick={onOpenMemoryTab}>{c.manage}</button></div> : null}
      </div>
      <div className="settings-row">
        <div><div className="lbl">{c.exportTitle}</div><div className="desc">{c.exportDesc}{markdown.files ? " · " + c.fileCount(markdown.files) : ""}</div>
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
