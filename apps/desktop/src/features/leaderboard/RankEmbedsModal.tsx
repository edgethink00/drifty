import { ExternalLinkIcon } from "../../components/ExternalLinkIcon";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { formatLocalizedDuration } from "../../lib/formatting";
import { useCopyFeedback } from "../../lib/useCopyFeedback";
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
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";

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
  const { effectiveLanguage, t } = useLocalization();
  const [design, setDesign] = useState<RankEmbedDesign>("minimal");
  const [period, setPeriod] = useState<LeaderboardPeriod>(initialPeriod);
  const [theme, setTheme] = useState<BadgeThemeOption>("light");
  const [accent, setAccent] = useState<string>(RANK_EMBED_DEFAULT_ACCENT);
  const { copiedKey: copied, showCopied } = useCopyFeedback<"html" | "markdown">();

  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);

  const live = Boolean(publicId && isProfilePublic && isRanked);
  const options = useMemo(() => ({ period, theme, accent, design }), [accent, design, period, theme]);
  const embedUrl = useMemo(() => (publicId ? buildRankEmbedUrl(publicId, options) : ""), [options, publicId]);
  const htmlSnippet = useMemo(() => (publicId ? buildRankEmbedSnippet(publicId, options) : ""), [options, publicId]);
  const markdownSnippet = useMemo(() => (publicId ? buildRankMarkdownSnippet(publicId, options) : ""), [options, publicId]);

  const copy = async (kind: "html" | "markdown", text: string) => {
    if (!live || !text) return;
    await copyTextToClipboard(text);
    showCopied(kind);
  };

  const rankLabel = isRanked && rank !== null ? `#${rank}` : "—";
  const focusLabel = isRanked ? formatLocalizedDuration(focusSeconds, effectiveLanguage) : "—";
  const periodLabel = (value: LeaderboardPeriod) => t(value === "daily" ? "leaderboard.daily" : value === "weekly" ? "leaderboard.weekly" : "leaderboard.monthly");
  const focusPeriodLabel = (value: LeaderboardPeriod) => t(value === "daily" ? "leaderboard.embed.focusToday" : value === "weekly" ? "leaderboard.embed.focusWeek" : "leaderboard.embed.focusMonth");
  const designLabel = (value: RankEmbedDesign) => t(value === "minimal" ? "leaderboard.embed.minimal" : value === "compact" ? "leaderboard.embed.compact" : "leaderboard.embed.card");
  const accentName = (name: string) => effectiveLanguage === "ko"
    ? ({ Green: "초록", Indigo: "인디고", Blue: "파랑", Pink: "분홍", Amber: "황금", Teal: "청록" }[name] ?? name)
    : effectiveLanguage === "es"
      ? ({ Green: "Verde", Indigo: "Índigo", Blue: "Azul", Pink: "Rosa", Amber: "Ámbar", Teal: "Turquesa" }[name] ?? name)
      : name;

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        className="auth-modal modal-shell profile-modal rank-embeds-modal"
        data-modal-variant="workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rank-embeds-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("leaderboard.embed.close")} onClick={onClose} />
        <div className="profile-modal__header rank-embeds-modal__header">
          <div>
            <h2 id="rank-embeds-title">{t("leaderboard.embed.title")}</h2>
            <p>{t("leaderboard.embed.detail")}</p>
          </div>
        </div>

        <div className="rank-embeds-modal__body">
          <div className="rank-embeds-modal__main">
            <div className={`rank-embed-stage rank-embed-stage--${theme}`} style={accentStyle(accent)}>
              <div className="rank-embed-stage__group">
                <span className="rank-embed-stage__caption">{t("leaderboard.embed.website")}</span>
                {design === "card" ? (
                  <div className="rank-embed-preview">
                    <div className="rank-embed-preview__top">
                      <RankEmbedAvatar avatarUrl={avatarUrl} displayName={displayName} />
                      <span className="rank-embed-preview__name">{displayName}</span>
                      <span className="rank-embed-preview__rank">{isRanked && rank !== null ? `#${rank} · ${periodLabel(period)}` : periodLabel(period)}</span>
                    </div>
                    <div className="rank-embed-preview__focus">
                      <span className="rank-embed-preview__label">{focusPeriodLabel(period)}</span>
                      <strong className="rank-embed-preview__value">{focusLabel}</strong>
                    </div>
                    <div className="rank-embed-preview__foot">
                      <span className="rank-embed-preview__dot" />
                      <span>{t("leaderboard.embed.liveRanking")}</span>
                      <span className="rank-embed-preview__brand"><span>{t("leaderboard.embed.poweredBy")} <b>drifty</b></span><ExternalLinkIcon /></span>
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
                    <span className="rank-embed-preview__label">{focusPeriodLabel(period)}</span>
                    <strong className="rank-embed-preview__value rank-embed-preview__value--lg">{focusLabel}</strong>
                    <span className="rank-embed-preview__minimal-rank">
                      {isRanked && rank !== null ? `${t("leaderboard.embed.rank")} #${rank}` : t("leaderboard.embed.unranked")} · <b>drifty</b>
                    </span>
                  </div>
                )}
              </div>
              <div className="rank-embed-stage__group">
                <span className="rank-embed-stage__caption">{t("leaderboard.embed.readmeBadge")}</span>
                <span className="rank-embed-badge" role="img" aria-label={`rank: ${rankLabel} · ${focusLabel}`}>
                  <span className="rank-embed-badge__label">{t("leaderboard.embed.rank")}</span>
                  <span className="rank-embed-badge__value">{isRanked ? `${rankLabel} · ${focusLabel}` : "—"}</span>
                </span>
              </div>
            </div>

            <div className="rank-embed-snippets">
              <div className="rank-embed-snippet">
                <span className="label-mono">{t("leaderboard.embed.website")} · HTML</span>
                <div className="profile-copy-row profile-embed-card__variant-row">
                  <input className="settings-input profile-field profile-field--code profile-embed-card__code" readOnly disabled={!live} value={htmlSnippet} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" className="modal-btn modal-btn--secondary profile-copy-row__copy" disabled={!live} onClick={() => void copy("html", htmlSnippet)}>{copied === "html" ? t("leaderboard.embed.copied") : t("leaderboard.embed.copy")}</button>
                </div>
              </div>
              <div className="rank-embed-snippet">
                <span className="label-mono">README · Markdown</span>
                <div className="profile-copy-row profile-embed-card__variant-row">
                  <input className="settings-input profile-field profile-field--code profile-embed-card__code" readOnly disabled={!live} value={markdownSnippet} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" className="modal-btn modal-btn--secondary profile-copy-row__copy" disabled={!live} onClick={() => void copy("markdown", markdownSnippet)}>{copied === "markdown" ? t("leaderboard.embed.copied") : t("leaderboard.embed.copy")}</button>
                </div>
                {live ? <a className="rank-embed-snippet__preview" href={embedUrl} target="_blank" rel="noreferrer">{t("leaderboard.embed.openPreview")}<ExternalLinkIcon /></a> : null}
              </div>
              {!live ? (
                <div className="rank-embed-snippets__lock" role="note">
                  <LockIcon />
                  <strong>{t("leaderboard.embed.locked")}</strong>
                  <p>{!isProfilePublic ? t("leaderboard.embed.publicFirst") : !isRanked ? t("leaderboard.embed.joinFirst") : t("leaderboard.embed.saveFirst")}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rank-embed-options" aria-label={t("leaderboard.embed.optionsAria")}>
            <div>
              <span className="label-mono">{t("leaderboard.embed.design")}</span>
              <div className="leaderboard-period-control seg" role="group" aria-label={t("leaderboard.embed.designAria")}>
                {DESIGN_OPTIONS.map((option) => (
                  <button key={option.value} type="button" className={design === option.value ? "on" : ""} aria-pressed={design === option.value} onClick={() => setDesign(option.value)}>
                    <span>{designLabel(option.value)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label-mono">{t("leaderboard.embed.period")}</span>
              <div className="leaderboard-period-control seg" role="group" aria-label={t("leaderboard.embed.periodAria")}>
                {(["daily", "weekly", "monthly"] as const).map((option) => (
                  <button key={option} type="button" className={period === option ? "on" : ""} aria-pressed={period === option} onClick={() => setPeriod(option)}>
                    <span>{periodLabel(option)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label-mono">{t("leaderboard.embed.theme")}</span>
              <div className="leaderboard-period-control seg" role="group" aria-label={t("leaderboard.embed.themeAria")}>
                {(["light", "dark"] as const).map((option) => (
                  <button key={option} type="button" className={theme === option ? "on" : ""} aria-pressed={theme === option} onClick={() => setTheme(option)}>
                    <span>{t(option === "light" ? "settings.appearance.light" : "settings.appearance.dark")}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label-mono">{t("leaderboard.embed.accent")}</span>
              <div className="rank-embed-accents" role="radiogroup" aria-label={t("leaderboard.embed.accentAria")}>
                {ACCENT_OPTIONS.map((option) => (
                  <button
                    key={option.color}
                    type="button"
                    className={`rank-embed-accent${accent === option.color ? " rank-embed-accent--on" : ""}`}
                    style={{ background: option.color }}
                    role="radio"
                    aria-checked={accent === option.color}
                    aria-label={t("leaderboard.embed.accentOptionAria", { name: accentName(option.name) })}
                    title={accentName(option.name)}
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
