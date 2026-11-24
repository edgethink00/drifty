import { useEffect, useState } from "react";
import { ExternalLinkIcon } from "../../components/ExternalLinkIcon";
import { localeForDisplayLanguage } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { GitHubStarAvailability, GitHubStarUsage } from "./githubStar";
import "./GitHubStarCard.css";

// Korean and English copy; other display languages read the English.
const COPY = {
  en: {
    title: (hours: string) => `You've tracked ${hours} hours with Drifty`,
    titleNoUsage: "Drifty is open source",
    // One sentence per line, so neither line ends mid-thought.
    body: ["Drifty is open source.", "A star helps other people find it."],
    signature: "— Max, who makes Drifty",
    star: "Star on GitHub",
    open: "Open GitHub",
    thanks: "Thanks for the star!",
    later: "Later",
    label: "Star Drifty on GitHub",
  },
  ko: {
    title: (hours: string) => `지금까지 ${hours}시간을 Drifty로 기록했어요`,
    titleNoUsage: "Drifty는 오픈소스예요",
    body: ["Drifty는 오픈소스예요.", "별 하나가 다른 사람이 Drifty를 찾게 도와줘요."],
    signature: "— Drifty를 만드는 Max",
    star: "GitHub에 별 누르기",
    open: "GitHub 열기",
    thanks: "별 고마워요!",
    later: "나중에",
    label: "GitHub에 별 누르기",
  },
} as const;

/** How long the thank-you stays before the card leaves. */
const THANKS_MS = 2_400;

function StarIcon() {
  return (
    <svg className="github-star__icon" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M8 .8l2.2 4.5 4.9.7-3.6 3.5.9 4.9L8 12.1l-4.4 2.3.9-4.9L.9 6l4.9-.7z" />
    </svg>
  );
}

export type GitHubStarCardProps = {
  readonly availability: GitHubStarAvailability;
  readonly usage?: GitHubStarUsage | null;
  /** Resolves true when gh starred the repository. */
  readonly onStar: () => Promise<boolean>;
  /** "Later": the card does not ask again. */
  readonly onLater: () => void;
  /** After a star (or GitHub opened in the browser). */
  readonly onClose: () => void;
  readonly onShown?: () => void;
};

/** The one-time ask, floating in the main window's lower-right corner (Dayflow's place). */
export function GitHubStarCard({ availability, usage = null, onStar, onLater, onClose, onShown }: GitHubStarCardProps) {
  const { effectiveLanguage } = useLocalization();
  const copy = effectiveLanguage === "ko" ? COPY.ko : COPY.en;
  const format = new Intl.NumberFormat(localeForDisplayLanguage(effectiveLanguage));
  const [phase, setPhase] = useState<"idle" | "busy" | "thanks">("idle");
  const usesGh = availability.star === "not_starred";
  useEffect(() => { onShown?.(); }, [onShown]);
  useEffect(() => {
    if (phase !== "thanks") return undefined;
    const timer = window.setTimeout(onClose, THANKS_MS);
    return () => window.clearTimeout(timer);
  }, [onClose, phase]);
  const press = async () => {
    setPhase("busy");
    const starred = await onStar().catch(() => false);
    if (starred) setPhase("thanks");
    else onClose();
  };

  const hours = usage && usage.trackedSeconds >= 3600 ? format.format(Math.floor(usage.trackedSeconds / 3600)) : null;
  const action = phase === "thanks" ? copy.thanks : usesGh ? copy.star : copy.open;
  return (
    <section className="github-star" data-placement="corner" data-phase={phase} aria-label={copy.label}>
      <div className="github-star__copy">
        <strong className="github-star__title">{hours ? copy.title(hours) : copy.titleNoUsage}</strong>
        <span className="github-star__body">{copy.body.map((sentence) => <span key={sentence} className="github-star__sentence">{sentence}</span>)}</span>
        <span className="github-star__signature">{copy.signature}</span>
      </div>
      <div className="github-star__actions">
        <button type="button" className="github-star__action" onClick={() => { void press(); }} disabled={phase !== "idle"} aria-busy={phase === "busy" || undefined}>
          {phase === "busy" ? <span className="action-label__spinner" aria-hidden="true" /> : <StarIcon />}
          <span>{action}</span>
          {!usesGh && phase === "idle" ? <ExternalLinkIcon className="github-star__external" /> : null}
        </button>
        {phase === "idle" ? <button type="button" className="github-star__later" onClick={onLater}>{copy.later}</button> : null}
      </div>
    </section>
  );
}

