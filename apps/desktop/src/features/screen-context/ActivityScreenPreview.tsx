import { useEffect, useMemo, useRef, useState, type PointerEvent, type Ref } from "react";
import type { ActivityCardDetailRun } from "@drifty/domain";
import { localeForDisplayLanguage } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { ActivityEvidenceSelection } from "./activityEvidenceSelection";
import type { ScreenContextClient } from "./screenContextClient";
import { useScreenFrameCache } from "./screenFrameCache";
import {
  cyclePlaybackSpeed, firstScreenIndexIn, posterScreenIndex, readPlaybackSpeed, screenHoldSeconds, usePlaybackClock,
  type ScreenPlaybackSpeed,
} from "./screenPlayback";
import { useScreenEvidenceRows, type ScreenEvidenceRow, type ScreenEvidenceSource } from "./useScreenEvidenceRows";
import { PlayIcon } from "./ScreenPlaybackIcons";

/** What the replay shows, for the Details lines beside it: the saved screens' times and the line on screen. */
export type ScreenReplayState = { readonly frameTimes: readonly number[]; readonly currentLine: number | null };
/** A Details line asking the replay to play from its first screen. */
export type ScreenReplaySeek = { readonly startMs: number; readonly endMs: number; readonly nonce: number };
export type ScreenReplayOpenOptions = { readonly playing: boolean };

const PREFETCH_AHEAD = 4;

function ExpandIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
  </svg>;
}

/**
 * The saved screens of an activity, shown in its detail. In preview mode they replay in place, fast
 * forward, the way Dayflow plays a card's screens; button mode is an entry to the viewer. Screens kept
 * without an image use the entry too. Renders nothing when no screen was kept.
 */
export function ActivityScreenPreview({ client, selection, mode, buttonRef, onOpen, lines, seek = null, initialRecordId = null, onReplayState }: {
  readonly client: ScreenContextClient;
  readonly selection: ActivityEvidenceSelection;
  readonly mode: "preview" | "button";
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly onOpen: (recordId: string | null, options?: ScreenReplayOpenOptions) => void;
  /** The activity's Details lines: the poster comes from the longest one, and each start is marked on the track. */
  readonly lines?: readonly ActivityCardDetailRun[];
  readonly seek?: ScreenReplaySeek | null;
  /** Where the viewer last was, so the replay resumes there on return. */
  readonly initialRecordId?: string | null;
  readonly onReplayState?: (state: ScreenReplayState | null) => void;
}) {
  const { t } = useLocalization();
  const source = useMemo<ScreenEvidenceSource>(() => ({ kind: "activity", selection }), [selection]);
  const rows = useScreenEvidenceRows(client, source);
  const playable = useMemo(() => rows?.filter((row) => row.frameRetained) ?? [], [rows]);
  if (!rows || rows.length === 0) return null;
  if (mode === "button" || playable.length === 0) {
    return <button ref={buttonRef} type="button" className="app-btn app-btn--secondary week-activity-inspector__evidence-entry screen-preview-entry" onClick={() => onOpen(null)}>
      <span>{t("screenRecording.preview.open")}</span><span className="screen-preview-entry__meta">{t("screenRecording.preview.count", { count: rows.length })}</span>
    </button>;
  }
  return <ScreenPlayer key={JSON.stringify(selection)} client={client} rows={playable} lines={lines} seek={seek}
    initialRecordId={initialRecordId} buttonRef={buttonRef} onOpen={onOpen} onReplayState={onReplayState} />;
}

function ScreenPlayer({ client, rows, lines, seek, initialRecordId, buttonRef, onOpen, onReplayState }: {
  readonly client: ScreenContextClient;
  readonly rows: readonly ScreenEvidenceRow[];
  readonly lines?: readonly ActivityCardDetailRun[];
  readonly seek: ScreenReplaySeek | null;
  readonly initialRecordId: string | null;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly onOpen: (recordId: string | null, options?: ScreenReplayOpenOptions) => void;
  readonly onReplayState?: (state: ScreenReplayState | null) => void;
}) {
  const { t, effectiveLanguage } = useLocalization();
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const cache = useScreenFrameCache(client);
  const count = rows.length;
  const times = useMemo(() => rows.map((row) => row.observedAtMs), [rows]);
  const holdSeconds = useMemo(() => screenHoldSeconds(times), [times]);
  const poster = useMemo(() => posterScreenIndex(times, lines), [times, lines]);
  const resumeIndex = initialRecordId ? rows.findIndex((row) => row.id === initialRecordId) : -1;
  const [index, setIndex] = useState(() => (resumeIndex >= 0 ? resumeIndex : poster));
  const [started, setStarted] = useState(resumeIndex >= 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ScreenPlaybackSpeed>(readPlaybackSpeed);
  const [hover, setHover] = useState<{ readonly index: number; readonly fraction: number } | null>(null);
  const current = Math.min(index, count - 1);
  const shown = hover?.index ?? (started ? current : Math.min(poster, count - 1));
  const multiple = count > 1;

  usePlaybackClock({ playing, speed, holdSeconds, index: current, count, onStep: setIndex, onEnd: () => setPlaying(false) });

  const wanted = useMemo(() => {
    const ids = [rows[shown]?.id];
    if (playing) for (let ahead = 1; ahead <= PREFETCH_AHEAD; ahead += 1) ids.push(rows[current + ahead]?.id);
    return ids.filter((id): id is string => typeof id === "string");
  }, [rows, shown, playing, current]);
  useEffect(() => { cache.want(wanted); }, [cache, wanted]);

  // A Details line plays from its first screen; a request from before this replay existed is not replayed.
  const handledSeek = useRef(seek?.nonce ?? null);
  useEffect(() => {
    if (!seek || seek.nonce === handledSeek.current) return;
    handledSeek.current = seek.nonce;
    const target = firstScreenIndexIn(times, seek.startMs, seek.endMs);
    if (target < 0) return;
    setHover(null);
    setIndex(target);
    setStarted(true);
    setPlaying(multiple);
  }, [seek, times, multiple]);

  const currentMs = hover ? times[hover.index] : started ? times[current] : null;
  // The detail re-renders only when the line on screen changes, not with every screen.
  const currentLine = useMemo(() => {
    if (currentMs === null || !lines) return null;
    const found = lines.findIndex((line) => currentMs >= line.startMs && currentMs < line.endMs);
    return found >= 0 ? found : null;
  }, [currentMs, lines]);
  useEffect(() => { onReplayState?.({ frameTimes: times, currentLine }); }, [onReplayState, times, currentLine]);
  useEffect(() => () => onReplayState?.(null), [onReplayState]);

  // While the next screen is still being read, the last one stays up rather than a blank frame.
  const generation = cache.displayGeneration();
  const frame = cache.get(rows[shown].id);
  const lastShown = useRef<{ readonly url: string; readonly generation: number } | null>(null);
  if (frame?.url) lastShown.current = { url: frame.url, generation };
  const held = !frame && lastShown.current && client.canDisplay(lastShown.current.generation) ? lastShown.current.url : null;
  const image = frame?.url ?? held;

  const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const minute = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const meta = count === 1
    ? t("screenRecording.preview.metaOne", { time: minute(times[0]) })
    : t("screenRecording.preview.meta", { start: minute(times[0]), end: minute(times[count - 1]), count });
  const ticks = useMemo(() => {
    if (count < 2) return [];
    const marks = new Set<number>();
    for (const line of lines ?? []) {
      const first = firstScreenIndexIn(times, line.startMs, line.endMs);
      if (first > 0) marks.add(first);
    }
    return [...marks].sort((a, b) => a - b).map((mark) => (mark / (count - 1)) * 100);
  }, [count, lines, times]);
  const progress = started && multiple ? (current / (count - 1)) * 100 : 0;

  // Pointing only previews: a press plays from the first screen, or resumes where it paused, so
  // the play mark in the middle never starts halfway through.
  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    setHover(null);
    if (!started || current >= count - 1) setIndex(0);
    setStarted(true);
    setPlaying(multiple);
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (playing || !multiple || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const next = Math.round(fraction * (count - 1));
    setHover((prior) => (prior && prior.index === next && Math.abs(prior.fraction - fraction) < 0.005 ? prior : { index: next, fraction }));
  };

  const placeholder = frame?.failed ? t("screenRecording.viewer.failed")
    : frame ? t("screenRecording.viewer.noImage") : t("screenRecording.preview.loading");
  return <div className="screen-player" data-playing={playing || undefined}>
    <div className="screen-player__stage">
      <button type="button" className="screen-player__screen" aria-label={playing ? t("screenRecording.player.pause") : t("screenRecording.player.play")}
        onClick={toggle} onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)}>
        {image
          ? <img src={image} alt="" />
          : <span className="screen-player__placeholder">{placeholder}</span>}
        {hover ? <span className="screen-player__hover-line" style={{ left: hover.fraction * 100 + "%" }} aria-hidden="true" /> : null}
        {multiple && !playing ? <span className="screen-player__disc" aria-hidden="true"><PlayIcon /></span> : null}
      </button>
      {multiple ? <button type="button" className="screen-player__speed" aria-label={t("screenRecording.player.speed", { speed })}
        onClick={() => setSpeed(cyclePlaybackSpeed(speed))}>{speed}x</button> : null}
      <button ref={buttonRef} type="button" className="screen-player__expand" aria-label={t("screenRecording.player.expand")}
        onClick={() => { setPlaying(false); onOpen(rows[shown].id, { playing }); }}><ExpandIcon /></button>
    </div>
    {multiple ? <div className="screen-player__track">
      <span className="screen-player__rail" aria-hidden="true" />
      <span className="screen-player__fill" style={{ width: progress + "%" }} aria-hidden="true" />
      {ticks.map((tick) => <span key={tick} className="screen-player__tick" style={{ left: tick + "%" }} aria-hidden="true" />)}
      <input type="range" min={0} max={count - 1} step={1} value={started ? current : 0} aria-label={t("screenRecording.viewer.timeline")}
        aria-valuetext={clock(times[started ? current : 0])}
        onChange={(event) => { setHover(null); setIndex(Number(event.currentTarget.value)); setStarted(true); }} />
    </div> : null}
    <div className="screen-player__meta">
      <span className="screen-player__now">{currentMs === null ? t("screenRecording.preview.label") : clock(currentMs)}</span>
      <span>{meta}</span>
    </div>
  </div>;
}
