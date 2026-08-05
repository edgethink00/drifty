import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { formatRoundedDuration } from "../../lib/formatting";
import { copyTextToClipboard } from "../profile/ProfileModals";
import type { BadgeThemeOption } from "../share/embedSnippets";
import type { LeaderboardPeriod } from "./leaderboardService";
import {
  RANK_EMBED_DEFAULT_ACCENT,
  buildRankEmbedSnippet,
  buildRankEmbedUrl,
  buildRankMarkdownSnippet,
  type RankEmbedDesign,
} from "./rankEmbedSnippets";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";

type RankEmbedsModalProps = {
  readonly avatarUrl: string;
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

const FOCUS_LABEL: Record<LeaderboardPeriod, string> = {
  daily: "Focus · today",
  weekly: "Focus · this week",
  monthly: "Focus · this month",
};

const DESIGN_OPTIONS: ReadonlyArray<{ readonly value: RankEmbedDesign; readonly label: string }> = [
  { value: "minimal", label: "Minimal" },
  { value: "compact", label: "Compact" },
  { value: "card", label: "Card" },
];

const ACCENT_OPTIONS = [
  { color: RANK_EMBED_DEFAULT_ACCENT, name: "Green" },
  { color: "#6366f1", name: "Indigo" },
  { color: "#3b82f6", name: "Blue" },
  { color: "#ec4899", name: "Pink" },
  { color: "#f59e0b", name: "Amber" },
  { color: "#14b8a6", name: "Teal" },
] as const;

type AccentStyle = CSSProperties & { readonly "--rank-embed-accent": string };

function accentStyle(accent: string): AccentStyle {
  return { "--rank-embed-accent": accent };
}

export function RankEmbedsModal({
  avatarUrl,
  displayName,
  focusSeconds,
  isProfilePublic,
  isRanked,
  period: initialPeriod,
  publicId,
  rank,
  onClose,
}: RankEmbedsModalProps) {
  const [design, setDesign] = useState<RankEmbedDesign>("minimal");
  const [period, setPeriod] = useState<LeaderboardPeriod>(initialPeriod);
  const [theme, setTheme] = useState<BadgeThemeOption>("light");
  const [accent, setAccent] = useState<string>(RANK_EMBED_DEFAULT_ACCENT);
  const [copied, setCopied] = useState<"html" | "markdown" | null>(null);

  useModalDismiss(onClose);

  const live = Boolean(publicId && isProfilePublic && isRanked);
  const options = useMemo(() => ({ period, theme, accent, design }), [accent, design, period, theme]);
  const embedUrl = useMemo(() => (publicId ? buildRankEmbedUrl(publicId, options) : ""), [options, publicId]);
  const htmlSnippet = useMemo(() => (publicId ? buildRankEmbedSnippet(publicId, options) : ""), [options, publicId]);
  const markdownSnippet = useMemo(() => (publicId ? buildRankMarkdownSnippet(publicId, options) : ""), [options, publicId]);

  const copy = async (kind: "html" | "markdown", text: string) => {
    if (!live || !text) return;
    await copyTextToClipboard(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const rankLabel = isRanked && rank !== null ? `#${rank}` : "—";
  const focusLabel = isRanked ? formatRoundedDuration(focusSeconds) : "—";

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section
        className="auth-modal modal-shell profile-modal rank-embeds-modal"
        data-modal-variant="workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rank-embeds-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label="Close embed" onClick={onClose} />
        <div className="profile-modal__header rank-embeds-modal__header">
          <div>
            <h2 id="rank-embeds-title">Rank embed</h2>
            <p>Your current rank and period focus. Nothing else.</p>
          </div>
        </div>

        <div className="rank-embeds-modal__body">
          <div className="rank-embeds-modal__main">
            <div className={`rank-embed-stage rank-embed-stage--${theme}`} style={accentStyle(accent)}>
              <div className="rank-embed-stage__group">
                <span className="rank-embed-stage__caption">Website</span>
                {design === "card" ? (
                  <div className="rank-embed-preview">
                    <div className="rank-embed-preview__top">
                      <RankEmbedAvatar avatarUrl={avatarUrl} displayName={displayName} />
                      <span className="rank-embed-preview__name">{displayName}</span>
                      <span className="rank-embed-preview__rank">{isRanked && rank !== null ? `#${rank} · ${PERIOD_LABEL[period]}` : PERIOD_LABEL[period]}</span>
                    </div>
                    <div className="rank-embed-preview__focus">
                      <span className="rank-embed-preview__label">{FOCUS_LABEL[period]}</span>
                      <strong className="rank-embed-preview__value">{focusLabel}</strong>
                    </div>
                    <div className="rank-embed-preview__foot">
                      <span className="rank-embed-preview__dot" />
                      <span>live ranking</span>
                      <span className="rank-embed-preview__brand">powered by <b>drifty</b> ↗</span>
                    </div>
                  </div>
                ) : design === "compact" ? (
                  <div className="rank-embed-preview rank-embed-preview--compact">
                    <RankEmbedAvatar avatarUrl={avatarUrl} compact displayName={displayName} />
                    <span className="rank-embed-preview__name">{displayName}</span>
                    <span className="rank-embed-preview__rank">{rankLabel}</span>
                    <strong className="rank-embed-preview__value rank-embed-preview__value--sm">{focusLabel}</strong>
                  </div>
                ) : (
                  <div className="rank-embed-preview rank-embed-preview--minimal">
                    <span className="rank-embed-preview__label">{FOCUS_LABEL[period]}</span>
                    <strong className="rank-embed-preview__value rank-embed-preview__value--lg">{focusLabel}</strong>
                    <span className="rank-embed-preview__minimal-rank">
                      {isRanked && rank !== null ? `rank #${rank}` : "unranked"} · <b>drifty</b>
                    </span>
                  </div>
                )}
              </div>
              <div className="rank-embed-stage__group">
                <span className="rank-embed-stage__caption">README badge</span>
                <span className="rank-embed-badge" role="img" aria-label={`rank: ${rankLabel} · ${focusLabel}`}>
                  <span className="rank-embed-badge__label">rank</span>
                  <span className="rank-embed-badge__value">{isRanked ? `${rankLabel} · ${focusLabel}` : "—"}</span>
                </span>
              </div>
            </div>

            <div className="rank-embed-snippets">
              <div className="rank-embed-snippet">
                <span className="label-mono">Website · HTML</span>
                <div className="profile-copy-row profile-embed-card__variant-row">
                  <input className="settings-input profile-field profile-field--code profile-embed-card__code" readOnly disabled={!live} value={htmlSnippet} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" className="modal-btn modal-btn--secondary" disabled={!live} onClick={() => void copy("html", htmlSnippet)}>{copied === "html" ? "Copied" : "Copy"}</button>
                </div>
              </div>
              <div className="rank-embed-snippet">
                <span className="label-mono">README · Markdown</span>
                <div className="profile-copy-row profile-embed-card__variant-row">
                  <input className="settings-input profile-field profile-field--code profile-embed-card__code" readOnly disabled={!live} value={markdownSnippet} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" className="modal-btn modal-btn--secondary" disabled={!live} onClick={() => void copy("markdown", markdownSnippet)}>{copied === "markdown" ? "Copied" : "Copy"}</button>
                </div>
                {live ? <a className="rank-embed-snippet__preview" href={embedUrl} target="_blank" rel="noreferrer">Open live preview ↗</a> : null}
              </div>
              {!live ? (
                <div className="rank-embed-snippets__lock" role="note">
                  <LockIcon />
                  <strong>Embeds are not public yet</strong>
                  <p>{!isProfilePublic ? "Turn on your public profile first." : !isRanked ? "Join the leaderboard first." : "Save your profile first."}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rank-embed-options" aria-label="Embed options">
            <div>
              <span className="label-mono">Design</span>
              <div className="leaderboard-period-control seg" role="group" aria-label="Embed design">
                {DESIGN_OPTIONS.map((option) => (
                  <button key={option.value} type="button" className={design === option.value ? "on" : ""} aria-pressed={design === option.value} onClick={() => setDesign(option.value)}>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label-mono">Period</span>
              <div className="leaderboard-period-control seg" role="group" aria-label="Embed period">
                {(["daily", "weekly", "monthly"] as const).map((option) => (
                  <button key={option} type="button" className={period === option ? "on" : ""} aria-pressed={period === option} onClick={() => setPeriod(option)}>
                    <span>{PERIOD_LABEL[option]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label-mono">Theme</span>
              <div className="leaderboard-period-control seg" role="group" aria-label="Embed theme">
                {(["light", "dark"] as const).map((option) => (
                  <button key={option} type="button" className={theme === option ? "on" : ""} aria-pressed={theme === option} onClick={() => setTheme(option)}>
                    <span>{option === "light" ? "Light" : "Dark"}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label-mono">Accent</span>
              <div className="rank-embed-accents" role="radiogroup" aria-label="Embed accent color">
                {ACCENT_OPTIONS.map((option) => (
                  <button
                    key={option.color}
                    type="button"
                    className={`rank-embed-accent${accent === option.color ? " rank-embed-accent--on" : ""}`}
                    style={{ background: option.color }}
                    role="radio"
                    aria-checked={accent === option.color}
                    aria-label={`Accent ${option.name}`}
                    title={option.name}
                    onClick={() => setAccent(option.color)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function RankEmbedAvatar({ avatarUrl, compact = false, displayName }: { readonly avatarUrl: string; readonly compact?: boolean; readonly displayName: string }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const trimmedAvatarUrl = avatarUrl.trim();
  const className = `rank-embed-preview__avatar${compact ? " rank-embed-preview__avatar--sm" : ""}`;
  const initial = (displayName.charAt(0) || "D").toUpperCase();
  const shouldShowPhoto = Boolean(trimmedAvatarUrl && failedAvatarUrl !== trimmedAvatarUrl);

  return (
    <span className={className} aria-hidden="true">
      {initial}
      {shouldShowPhoto ? <img src={trimmedAvatarUrl} alt="" onError={() => setFailedAvatarUrl(trimmedAvatarUrl)} /> : null}
    </span>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
