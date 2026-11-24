import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { isCliSetupChoice } from "../../cliChoice";
import { cliCommands, isWindowsHost, setCliReviewRemote, useCliReviewRemote, type CliInstall } from "../../cliInstall";
import { SpinnerIcon } from "./shared";
import { cliFailure } from "../../cliConnectOutcome";

const GUIDES = {
  claude_cli: "https://code.claude.com/docs/en/quickstart",
  codex_cli: "https://developers.openai.com/codex/cli/",
} as const;
/** Each resolved check is shown for this long before the next one starts, so the steps read as done in order. */
const STAGE_MS = 650;

type StepState = "pending" | "running" | "active" | "done" | "failed";

function StepMark({ state, number }: { readonly state: StepState; readonly number: number }) {
  return <span className="dc-onb-cli-step__mark" aria-hidden="true">
    {state === "done" ? <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.6 6.3 4.9 8.6 9.4 3.6" /></svg>
      : state === "failed" ? <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 2.8v3.8M6 9.1v.1" /></svg>
      : state === "running" ? <SpinnerIcon />
      : number}
  </span>;
}

/**
 * The onboarding column is centered vertically, so a step opening or closing
 * moves it. Animate that move from where it is on screen (a FLIP) instead of
 * jumping; a render in the middle of a glide continues from the current spot.
 */
function useColumnGlide(root: RefObject<HTMLDivElement | null>) {
  const lastTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    const column = root.current?.closest<HTMLElement>(".dc-onb-content");
    if (!column) return;
    // Where it is drawn right now: the last layout position plus any glide still under way.
    const transform = getComputedStyle(column).transform;
    const offset = transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;
    column.style.transition = "none";
    column.style.transform = "";
    const top = column.getBoundingClientRect().top;
    const previous = lastTop.current;
    lastTop.current = top;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (previous === null || reduce) return;
    const delta = previous + offset - top;
    if (Math.abs(delta) < 1) return;
    column.style.transform = `translateY(${delta}px)`;
    void column.offsetHeight;
    column.style.transition = "transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1)";
    column.style.transform = "";
  });
  useEffect(() => () => {
    const column = root.current?.closest<HTMLElement>(".dc-onb-content");
    if (column) { column.style.transition = ""; column.style.transform = ""; }
  }, [root]);
}

/**
 * Reveals the checks in order: 0 = looking for the CLI, 1 = install known,
 * 2 = sign-in known. A blocked step stops the sequence there. When the last
 * check already found the CLI, a new check keeps step 1 done and replays only
 * from step 2, so checking again never looks like the install was lost.
 */
function useStagedReveal(install: CliInstall, checking: boolean): { readonly stage: 0 | 1 | 2; readonly shown: CliInstall } {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const resolved = !checking && install.state !== "checking";
  const lastFound = useRef<CliInstall | null>(null);
  if (resolved) lastFound.current = install.state === "found" ? install : null;
  const fromStep2 = useRef(false);
  // Layout effect: the stage resets before paint, so a finished step never flashes back for a frame.
  useLayoutEffect(() => {
    if (!resolved) {
      fromStep2.current = lastFound.current !== null;
      setStage(fromStep2.current ? 1 : 0);
      return;
    }
    if (install.state === "found" && fromStep2.current) {
      // Step 2 already showed its check while the lookup ran.
      setStage(2);
      return;
    }
    setStage(1);
    if (install.state !== "found") return;
    const timer = setTimeout(() => setStage(2), STAGE_MS);
    return () => clearTimeout(timer);
  }, [install.state, resolved]);
  // While a check runs, a CLI that was already found keeps showing as found.
  const shown = !resolved && lastFound.current ? lastFound.current : install;
  return { stage, shown };
}

/** Install, sign in, then test: the checks run in order on entry and stop at the first step that needs the user. */
export function CliConnectStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const rootRef = useRef<HTMLDivElement | null>(null);
  useColumnGlide(rootRef);
  const choice = isCliSetupChoice(flow.setupChoice) ? flow.setupChoice : "claude_cli";
  const { stage, shown: install } = useStagedReveal(flow.cliInstalls[choice], flow.cliInstallChecking);
  const commands = cliCommands(choice, isWindowsHost());
  const provider = flow.cliName;
  const found = stage >= 1 && install.state === "found";
  const signedInKnown = stage >= 2 && install.state === "found";
  const signedIn = signedInKnown && install.signedIn !== false;
  const signInBlocked = signedInKnown && install.signedIn === false;
  const installBlocked = stage >= 1 && (install.state === "missing" || install.state === "unavailable");
  const ready = signedIn;
  const phase = flow.connectionPhase;
  const testRan = ready && flow.inlineCliTestRunId > 0;
  const testing = testRan && phase === "testing";
  const passed = testRan && phase === "success";
  const failed = testRan && phase === "failed";
  const fix = failed ? cliFailure(flow.connectionFailure) : null;
  const stepClass = (state: StepState) =>
    `dc-onb-cli-step dc-onb-cli-step--${state}`;
  const step1 = stage === 0 ? "running" : found ? "done" : "active";
  const step2 = !found ? "pending" : stage === 1 ? "running" : signedIn ? "done" : "active";
  const step3 = !ready ? "pending" : passed ? "done" : failed ? "failed" : testing ? "running" : "active";
  return <div className="dc-onb-cli-connect" ref={rootRef}>
    <ol className="dc-onb-cli-steps">
      <li className={stepClass(step1)}>
        <StepMark state={step1} number={1} />
        <div className="dc-onb-cli-step__body" role="status">
          <span className="dc-onb-cli-step__title">
            {stage === 0 ? t("onboarding.cli.connectSearching", { provider })
              : install.state === "found" ? t("onboarding.cli.connectFound", { provider })
              : install.state === "unavailable" ? t("onboarding.cli.connectUnavailable", { provider })
              : t("onboarding.cli.connectMissing", { provider })}
            {found && install.state === "found" && install.version ? <span className="dc-onb-cli-step__meta">{install.version}</span> : null}
          </span>
          {installBlocked ? <div className="dc-onb-cli-step__reveal">
            {install.state === "missing" ? <>
              <p className="dc-onb-cli-step__text">{t("onboarding.cli.stepInstallBody")}</p>
              <CliCommand command={commands.install} />
              <p className="dc-onb-cli-step__hint">{t("onboarding.cli.installThenCheck")}</p>
            </> : <p className="dc-onb-cli-step__text">{t("onboarding.cli.unavailableBody")}</p>}
            <CheckAgainButton onClick={flow.recheckCli} />
          </div> : null}
        </div>
      </li>
      <li className={stepClass(step2)}>
        <StepMark state={step2} number={2} />
        <div className="dc-onb-cli-step__body">
          <span className="dc-onb-cli-step__title">
            {step2 === "running" ? t("onboarding.cli.checkingLogin", { provider })
              : signedIn ? t("onboarding.cli.stepLoginDone", { provider })
              : signInBlocked ? t("onboarding.cli.stepLoginNeeded", { provider })
              : t("onboarding.cli.stepLogin")}
          </span>
          {signInBlocked ? <div className="dc-onb-cli-step__reveal">
            <p className="dc-onb-cli-step__text">{t("onboarding.cli.stepLoginBody")}</p>
            <CliCommand command={commands.login} />
            <p className="dc-onb-cli-step__hint">{t("onboarding.cli.loginThenCheck")}</p>
            <CheckAgainButton onClick={flow.recheckCli} />
          </div> : null}
        </div>
      </li>
      <li className={stepClass(step3)}>
        <StepMark state={step3} number={3} />
        <div className="dc-onb-cli-step__body" role="status">
          <span className="dc-onb-cli-step__title">{t("onboarding.cli.stepVerify")}</span>
          {ready ? <div className="dc-onb-cli-step__reveal">
            <p className="dc-onb-cli-step__text">
              {passed ? t("onboarding.cli.verifyPassed")
                : testing ? t("onboarding.cli.checking", { provider })
                : fix ? t(fix.key, { provider })
                : t("onboarding.cli.stepVerifyBody")}
            </p>
            {fix?.command ? <CliCommand command={commands[fix.command]} /> : null}
            {!passed ? (
              <button type="button" className="dc-onb-secondary-button dc-onb-cli-step-button" disabled={testing} onClick={flow.runInlineCliTest}>
                {testing ? <><SpinnerIcon />{t("onboarding.cli.testing")}</> : failed ? t("onboarding.test.retry") : t("onboarding.action.testConnection")}
              </button>
            ) : null}
          </div> : null}
        </div>
      </li>
    </ol>
    <div className="dc-onb-cli-links">
      <a className="dc-onb-cli-guide" href={GUIDES[choice]} target="_blank" rel="noopener noreferrer" onClick={event => {
        if ("__TAURI_INTERNALS__" in window) { event.preventDefault(); void openUrl(GUIDES[choice]); }
      }}>{t("onboarding.cli.install")} <span aria-hidden="true">↗</span></a>
      <button type="button" onClick={flow.returnToSetupChoice}>{t("onboarding.cli.switch")}</button>
    </div>
    {import.meta.env.DEV ? <CliReviewRemotePanel /> : null}
  </div>;
}

function CheckAgainButton({ onClick }: { readonly onClick: () => void }) {
  const { t } = useLocalization();
  return <button type="button" className="dc-onb-secondary-button dc-onb-cli-step-button" onClick={onClick}>{t("onboarding.cli.checkAgain")}</button>;
}

/** Development review only: switches that act like installing or signing in from Terminal. */
function CliReviewRemotePanel() {
  const review = useCliReviewRemote();
  const [open, setOpen] = useState(true);
  if (!review || typeof document === "undefined") return null;
  // Sits in the strip left of the 900x580 onboarding card, so it never covers the steps.
  return createPortal(<aside className="dc-cli-remote" aria-label="Review remote">
    <button type="button" className="dc-cli-remote__head" aria-expanded={open} onClick={() => setOpen(!open)}>리모컨 {open ? "−" : "+"}</button>
    {open ? <>
      <span className="dc-cli-remote__label">터미널 상태</span>
      <label><input type="checkbox" checked={review.installed} onChange={event => setCliReviewRemote({ installed: event.target.checked })} />설치됨</label>
      <label><input type="checkbox" checked={review.signedIn} onChange={event => setCliReviewRemote({ signedIn: event.target.checked })} />로그인됨</label>
      <span className="dc-cli-remote__label">재감지</span>
      <div className="dc-cli-remote__seg">
        <button type="button" aria-pressed={review.redetect === "manual"} onClick={() => setCliReviewRemote({ redetect: "manual" })}>버튼</button>
        <button type="button" aria-pressed={review.redetect === "focus"} onClick={() => setCliReviewRemote({ redetect: "focus" })}>자동</button>
      </div>
      <small>{review.redetect === "manual" ? "'다시 확인'을 눌러야 반영돼요." : "바꾸면 0.6초 뒤 다시 확인해요."}</small>
    </> : null}
  </aside>, document.body);
}

/** Clipboard API first; the review preview and older webviews fall back to a selection copy, then to selecting the text. */
export function CliCommand({ command }: { readonly command: string }) {
  const { t } = useLocalization();
  const [copy, setCopy] = useState<"idle" | "copied" | "selected">("idle");
  const codeRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), copy === "copied" ? 1600 : 4000);
    return () => clearTimeout(timer);
  }, [copy]);
  const selectCommand = () => {
    const element = codeRef.current;
    const selection = window.getSelection();
    if (!element || !selection) return false;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };
  const onCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(command);
        setCopy("copied");
        return;
      }
    } catch { /* Fall through to the selection copy. */ }
    const selected = selectCommand();
    let copied = false;
    try { copied = selected && document.execCommand("copy"); } catch { copied = false; }
    setCopy(copied ? "copied" : "selected");
  };
  return <div className="dc-onb-cli-command">
    <span className="dc-onb-cli-command__prompt" aria-hidden="true">{isWindowsHost() ? ">" : "$"}</span>
    <code ref={codeRef}>{command}</code>
    <button type="button" onClick={() => void onCopy()} aria-live="polite">
      {copy === "copied" ? t("onboarding.cli.copied") : copy === "selected" ? t("onboarding.cli.copySelected") : t("onboarding.cli.copy")}
    </button>
  </div>;
}
