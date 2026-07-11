import { useEffect, useMemo, useState } from "react";
import { formatRoundedDuration } from "../../lib/formatting";
import { copyTextToClipboard } from "../profile/ProfileModals";
import type { BadgeThemeOption } from "../share/embedSnippets";
import type { LeaderboardPeriod } from "./leaderboardService";
import { buildRankEmbedSnippet, buildRankEmbedUrl } from "./rankEmbedSnippets";

type RankEmbedsModalProps = {
  readonly displayName: string;
  readonly focusSeconds: number;
  readonly isProfilePublic: boolean;
  readonly isRanked: boolean;
  readonly period: LeaderboardPeriod;
  readonly publicId: string | null;
  readonly rank: number | null;
  readonly onClose: () => void;
};

const PERIOD_LABEL: Record<LeaderboardPeriod, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export function RankEmbedsModal({
  displayName,
  focusSeconds,
  isProfilePublic,
  isRanked,
  period: initialPeriod,
  publicId,
  rank,
  onClose,
}: RankEmbedsModalProps) {
  const [period, setPeriod] = useState<LeaderboardPeriod>(initialPeriod);
  const [theme, setTheme] = useState<BadgeThemeOption>("light");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const live = Boolean(publicId && isProfilePublic && isRanked);
  const embedUrl = useMemo(
    () => (publicId ? buildRankEmbedUrl(publicId, { period, theme }) : ""),
    [period, publicId, theme],
  );
  const snippet = useMemo(
    () => (publicId ? buildRankEmbedSnippet(publicId, { period, theme }) : ""),
    [period, publicId, theme],
  );

  const copy = async () => {
    if (!live || !snippet) return;
    await copyTextToClipboard(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section
        className="auth-modal profile-modal rank-embeds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rank-embeds-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="profile-modal__x" aria-label="Close rank embed" onClick={onClose}>×</button>
        <div className="profile-modal__header">
          <div className="profile-modal__avatar rank-embeds-modal__icon" aria-hidden="true">
            <RankIcon />
          </div>
          <div>
            <span className="label-mono">Leaderboard</span>
            <h2 id="rank-embeds-title">Rank embed</h2>
            <p>Your current rank and period focus. Nothing else.</p>
          </div>
        </div>

        <div className="rank-embeds-modal__body">
          <div className={`rank-embed-stage rank-embed-stage--${theme}`}>
            <div className="rank-embed-preview">
              <div className="rank-embed-preview__top">
                <span className="rank-embed-preview__avatar" aria-hidden="true">{(displayName.charAt(0) || "D").toUpperCase()}</span>
                <span className="rank-embed-preview__name">{displayName}</span>
                <span className="rank-embed-preview__period">{PERIOD_LABEL[period]}</span>
              </div>
              <div className="rank-embed-preview__stats">
                <div><span>Rank</span><strong>{isRanked && rank !== null ? `#${rank}` : "—"}</strong></div>
                <div><span>Focus</span><strong>{isRanked ? formatRoundedDuration(focusSeconds) : "—"}</strong></div>
              </div>
              <div className="rank-embed-preview__foot"><span className="rank-embed-preview__dot" /> live ranking <b>drifty</b></div>
            </div>
            {!live ? (
              <div className="rank-embed-stage__lock" role="note">
                <strong>Rank embed is not public yet</strong>
                <p>{!isProfilePublic ? "Turn on your public profile first." : !isRanked ? "Join the leaderboard first." : "Save your profile first."}</p>
              </div>
            ) : null}
          </div>

          <div className="rank-embed-options">
            <div>
              <span className="label-mono">Period</span>
              <div className="leaderboard-period-control seg" role="group" aria-label="Rank embed period">
                {(["daily", "weekly", "monthly"] as const).map((option) => (
                  <button key={option} type="button" className={period === option ? "on" : ""} aria-pressed={period === option} onClick={() => setPeriod(option)}>
                    <span>{PERIOD_LABEL[option]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label-mono">Theme</span>
              <div className="leaderboard-period-control seg" role="group" aria-label="Rank embed theme">
                {(["light", "dark"] as const).map((option) => (
                  <button key={option} type="button" className={theme === option ? "on" : ""} aria-pressed={theme === option} onClick={() => setTheme(option)}>
                    <span>{option === "light" ? "Light" : "Dark"}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rank-embed-snippet">
            <span className="label-mono">Website · iframe</span>
            <div className="profile-copy-row profile-embed-card__variant-row">
              <input className="settings-input profile-field profile-field--code profile-embed-card__code" readOnly disabled={!live} value={snippet} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" className="settings-btn settings-btn--primary profile-btn" disabled={!live} onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
            </div>
            {live ? <a className="rank-embed-snippet__preview" href={embedUrl} target="_blank" rel="noreferrer">Open live preview ↗</a> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function RankIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v3a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H5a2 2 0 0 0 2 4M17 5h2a2 2 0 0 1-2 4" />
    </svg>
  );
}
