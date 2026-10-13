import { useCallback, useState } from "react";
import type { AppIconMap } from "@drifty/domain";
import "./readPreview.css";
import {
  READ_ABSTAIN,
  READ_FIRST,
  READ_FRAMES,
  READ_LOG,
  READ_SAMPLES,
  READ_THIN,
  READ_TRY_EXAMPLES,
  READ_VIDEO_DAYS,
  READ_WEB_CASES,
  UNLOCK_LOCKED,
  UNLOCK_READY,
  readWithWebCase,
  type ReadFrameId,
  type ReadTryExampleId,
  type ReadWebCaseId,
} from "./readFixtures";
import type { InsightsRead, ReadUnlockProgress } from "./readModel";
import { ReadPage, type ReadCardTone, type ReadCompareStyle, type ReadEvidencePolish, type ReadMeasureStyle } from "./ReadPage";
import { ReadWait, type WaitPhase } from "./ReadWait";

/** The user's path through the tab, in order. */
export type ReadPreviewState =
  | "locked"
  | "ready"
  | "readyNoAi"
  | "writing"
  | "first"
  | "video"
  | "twoDays"
  | "abstain"
  | "thin";

const STATES: readonly { readonly id: ReadPreviewState; readonly label: string }[] = [
  { id: "locked", label: "1 Locked" },
  { id: "readyNoAi", label: "2 Ready, no AI" },
  { id: "ready", label: "2 Ready" },
  { id: "writing", label: "3 Writing" },
  { id: "first", label: "4 First read" },
  { id: "video", label: "5 Later: split" },
  { id: "twoDays", label: "5 Later: vs usual" },
  { id: "abstain", label: "5 Later: no read" },
  { id: "thin", label: "5 Later: too little" },
];

const WAIT_PHASE: Partial<Record<ReadPreviewState, WaitPhase>> = {
  locked: "locked",
  ready: "ready",
  readyNoAi: "ready-no-ai",
  writing: "writing",
};

const HOUR = 3600;

function readFor(state: ReadPreviewState): InsightsRead {
  if (state === "abstain") return READ_ABSTAIN;
  if (state === "thin") return READ_THIN;
  if (state === "first" || state === "writing") return READ_FIRST;
  if (state === "video" || state === "twoDays") return READ_SAMPLES[state];
  return READ_SAMPLES.video;
}

function query(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

function initialState(): ReadPreviewState {
  const value = query("readState");
  return STATES.some((entry) => entry.id === value) ? (value as ReadPreviewState) : "locked";
}

/** ?readHours=6 previews the locked dialog at another point of the unlock. */
function lockedProgress(): ReadUnlockProgress {
  const hours = Number(query("readHours"));
  return Number.isFinite(hours) && hours > 0 ? { ...UNLOCK_LOCKED, trackedSeconds: hours * HOUR } : UNLOCK_LOCKED;
}

function noop() {}

/**
 * Dev-only design review for Your read. Fixture content only; it is reachable
 * when the dev server runs with ?driftyRead=1 and never in production builds.
 */
export function InsightsReadPreview({ toolbar = null, appIcons }: { readonly toolbar?: HTMLElement | null; readonly appIcons?: AppIconMap } = {}) {
  const [state, setState] = useState<ReadPreviewState>(initialState);
  const [selection, setSelection] = useState<string>(() => readFor(initialState()).id);
  // Set when the first read has just been revealed behind the writing dialog, so the read page takes over without a fade.
  const [revealed, setRevealed] = useState(false);
  const showChrome = query("readChrome") !== "0";
  const holdWriting = query("readHold") === "1";
  // Design review only: how much the evidence keeps (?readPolish=tidy|finding|minimal).
  const polishQuery = query("readPolish");
  const evidencePolish: ReadEvidencePolish = polishQuery === "finding" || polishQuery === "minimal" ? polishQuery : "tidy";
  // Design review only: where the measures go (?readMeasures=side|rail|beside).
  const measuresQuery = query("readMeasures");
  const measureStyle: ReadMeasureStyle = measuresQuery === "rail" || measuresQuery === "beside" ? measuresQuery : "side";
  // Design review only: what the cards under the read sit on (?readCards=panel|grey|well).
  const cardsQuery = query("readCards");
  const cardTone: ReadCardTone = cardsQuery === "well" || cardsQuery === "panel" ? cardsQuery : "grey";
  // Design review only: the video week read through a comparison whose sides name themselves (?readFrame=usual|lastWeek|best|try).
  const frameQuery = query("readFrame");
  const frame = frameQuery && frameQuery in READ_FRAMES ? READ_FRAMES[frameQuery as ReadFrameId] : null;
  // Design review only: what the latest read's try line carries (?readTry=firstWork|cap|stop|block).
  const tryQuery = query("readTry");
  const tryExample = tryQuery && tryQuery in READ_TRY_EXAMPLES ? READ_TRY_EXAMPLES[tryQuery as ReadTryExampleId] : null;
  // Design review only: the app web and time flow with more or fewer apps (?readWeb=heavy|light|hub|noSubject).
  const webQuery = query("readWeb");
  const webCase = webQuery && webQuery in READ_WEB_CASES ? (webQuery as ReadWebCaseId) : null;
  // Design review only: where the comparison's two sides are named (?readCompare=inside|above).
  const compareStyle: ReadCompareStyle = query("readCompare") === "above" ? "above" : "inside";
  // With a comparison frame, the first read uses the one a first read can make without earlier weeks: most focused days against the rest.
  const firstRead: InsightsRead = frame ? { ...READ_FRAMES.best, id: READ_FIRST.id, isFirst: true, followUp: undefined } : READ_FIRST;
  const firstLog: readonly InsightsRead[] = [firstRead];
  const framed = frame ?? READ_VIDEO_DAYS;
  const latest = webCase ? readWithWebCase(framed, webCase) : framed;
  const shownLatest = tryExample ? { ...latest, ...tryExample } : latest;
  const log = shownLatest === READ_VIDEO_DAYS ? READ_LOG : READ_LOG.map((entry) => (entry.id === READ_VIDEO_DAYS.id ? shownLatest : entry));

  // Writing the first read leads straight into it once the dialog has cleared, as it would after the model returns.
  const onWritten = useCallback(() => {
    setState("first");
    setSelection(READ_FIRST.id);
    setRevealed(true);
  }, []);

  function go(next: ReadPreviewState) {
    setRevealed(false);
    setState(next);
    setSelection(readFor(next).id);
  }

  const phase = WAIT_PHASE[state];
  const body = phase ? (
    <ReadWait
      phase={phase}
      progress={state === "locked" ? lockedProgress() : UNLOCK_READY}
      firstRead={firstRead}
      holdWriting={holdWriting}
      silhouette={(
        <ReadPage log={firstLog} selectedId={firstRead.id} onSelect={noop} appIcons={appIcons} evidencePolish={evidencePolish} measureStyle={measureStyle} cardTone={cardTone} compareStyle={compareStyle} arrival="none" />
      )}
      onWrite={() => go("writing")}
      onSetUpAi={() => go("ready")}
      onWritten={onWritten}
    />
  ) : (
    <ReadPage
      log={state === "first" ? firstLog : log}
      selectedId={selection}
      onSelect={setSelection}
      toolbar={toolbar}
      appIcons={appIcons}
      evidencePolish={evidencePolish}
      measureStyle={measureStyle}
      cardTone={cardTone}
      compareStyle={compareStyle}
      arrival={revealed && state === "first" ? "none" : "fade"}
    />
  );

  return (
    <>
      {body}
      {showChrome ? (
        <div className="insights-read-devbar" role="toolbar" aria-label="Your read design review">
          <span className="insights-read-devbar__group">
            {STATES.map((entry) => (
              <button key={entry.id} type="button" className={entry.id === state ? "is-active" : ""} onClick={() => go(entry.id)}>{entry.label}</button>
            ))}
          </span>
        </div>
      ) : null}
    </>
  );
}
