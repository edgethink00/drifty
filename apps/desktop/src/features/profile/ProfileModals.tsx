import type { LeaderboardRow } from "../leaderboard/leaderboardService";
import { getLeaderboardPeriodFocusLabel } from "../leaderboard/leaderboardWindow";
import { getDailyAverageSeconds } from "../leaderboard/leaderboardViewHelpers";
import { getLeaderFocusSeconds, getLeaderShareRatio, getRankGap, getRankTier, getTopPercentile } from "../leaderboard/leaderboardStanding";
import type { PublicProfile } from "./profileService";
import { formatLocalizedCompactDurationFromSeconds, formatRelativeTime } from "../../lib/formatting";
import { MetricTile } from "../../components/MetricTile";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useRef, type ChangeEvent, type CSSProperties } from "react";
import { useLocalization } from "../localization/LocalizationContext";

export type ProfileDraft = {
  displayName: string;
  bio: string;
  avatarUrl: string;
  websiteUrl: string;
  githubUrl: string;
  linkedinUrl: string;
  isPublic: boolean;
};

export function ProfileModal({
  row,
  profile,
  isLoading,
  error,
  leaderboardRows = [],
  onClose,
}: {
  row: LeaderboardRow;
  profile: PublicProfile | null;
  isLoading: boolean;
  error: string | null;
  leaderboardRows?: readonly LeaderboardRow[];
  onClose: () => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const displayName = profile?.display_name || row.display_name;
  const bio = profile?.bio?.trim();
  const focusSeconds = row.focus_seconds;
  const rank = row.rank;
  const locale = effectiveLanguage === "ko" ? "ko-KR" : "en-US";
  const periodFocusLabel = effectiveLanguage === "ko"
    ? t(row.period === "daily" ? "leaderboard.embed.focusToday" : row.period === "weekly" ? "leaderboard.embed.focusWeek" : "leaderboard.embed.focusMonth")
    : getLeaderboardPeriodFocusLabel(row.period);
  const rankTier = getRankTier(rank);
  const percentile = getTopPercentile(rank, row.participant_count);
  const leaderFocusSeconds = getLeaderFocusSeconds(leaderboardRows, row);
  const leaderShare = getLeaderShareRatio(focusSeconds, leaderFocusSeconds);
  const leaderSharePercent = leaderShare === null ? null : Math.max(1, Math.round(leaderShare * 100));
  const rankGap = getRankGap(leaderboardRows, row);
  const dailyAverageSeconds = getDailyAverageSeconds(focusSeconds, row.period);
  const showsDailyAverage = row.period !== "daily";
  const hasStandingTiles = showsDailyAverage || rankGap !== null;
  // On the podium the rank is the story; a "top 1%" line there is noise.
  const participantLabel = (row.participant_count ?? 0).toLocaleString(locale);
  const standing = percentile === null
    ? t("profile.standingRank", { rank })
    : rank <= 3
      ? t("profile.standingRankOfParticipants", { rank, participants: participantLabel })
      : t("profile.standingPercentile", { rank, participants: participantLabel, percent: percentile });
  useModalDismiss(onClose);

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section className="auth-modal modal-shell profile-modal" data-modal-variant="standard" role="dialog" aria-modal="true" aria-labelledby="public-profile-title" onClick={(event) => event.stopPropagation()}>
        <ModalCloseButton label={t("profile.close")} onClick={onClose} />
        <div className="profile-modal__header">
          <span className="profile-modal__crest" data-rank-tier={rankTier ?? undefined}>
            {profile?.avatar_url ? <img className="profile-modal__avatar" src={profile.avatar_url} alt="" aria-hidden="true" /> : <span className="profile-modal__avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</span>}
            <span className="profile-modal__rank-badge" aria-hidden="true">#{rank}</span>
          </span>
          <div className="profile-modal__identity">
            <h2 id="public-profile-title">{displayName}</h2>
            <p className="profile-modal__standing">{standing}</p>
          </div>
        </div>
        {isLoading ? <p className="capture-recency">{t("profile.loading")}</p> : null}
        {error ? <p className="capture-recency capture-recency--error">{error}</p> : null}
        <p className="profile-modal__bio">{bio || t("profile.noBio")}</p>
        <ProfileSocialLinks profile={profile ?? { website_url: null, github_url: null, linkedin_url: null }} hideWhenEmpty />
        <div className="profile-modal__hero" data-rank-tier={rankTier ?? undefined}>
          <span className="eyebrow">{periodFocusLabel}</span>
          <strong className="profile-modal__hero-value">{formatLocalizedCompactDurationFromSeconds(focusSeconds, effectiveLanguage)}</strong>
          {leaderShare === null || leaderSharePercent === null ? null : (
            <>
              <span
                className="profile-modal__leader-bar"
                role="img"
                aria-label={rank === 1 ? t("profile.leaderTop") : t("profile.leaderBarAria", { percent: leaderSharePercent })}
              >
                <span className="profile-modal__leader-bar-fill" style={{ "--profile-leader-share": leaderShare } as CSSProperties} />
              </span>
              <p className="profile-modal__hero-note">{rank === 1 ? t("profile.leaderTop") : t("profile.leaderShare", { percent: leaderSharePercent })}</p>
            </>
          )}
        </div>
        {hasStandingTiles ? (
        <div className="profile-modal__stats" aria-label={t("profile.statsAria", { name: displayName })}>
          {!showsDailyAverage ? null : (
            <MetricTile
              label={t("profile.dailyAverage")}
              value={formatLocalizedCompactDurationFromSeconds(dailyAverageSeconds, effectiveLanguage)}
              detail={t("profile.dailyAverageDetail")}
            />
          )}
          {rankGap === null ? null : (
            <MetricTile
              label={rankGap.kind === "lead" ? t("profile.gapLead", { rank: rankGap.rivalRank }) : t("profile.gapChase")}
              value={rankGap.seconds === 0 ? t("profile.gapTie") : formatLocalizedCompactDurationFromSeconds(rankGap.seconds, effectiveLanguage)}
              detail={rankGap.kind === "lead" ? t("profile.gapLeadDetail") : t("profile.gapChaseDetail")}
            />
          )}
        </div>
        ) : null}
        <p className="profile-modal__updated">{t("profile.updatedAt", { time: formatRelativeTime(row.updated_at, locale) })}</p>
      </section>
    </div>
  );
}

export function EditProfileModal({
  displayName,
  avatarUrl,
  publicId,
  profileDraft,
  profileLoading,
  profileSaving,
  profileMessage,
  profileError,
  onClose,
  onPhotoSelected,
  onRemovePhoto,
  onChange,
  onSave,
}: {
  displayName: string;
  avatarUrl: string;
  publicId: string | null;
  profileDraft: ProfileDraft;
  profileLoading: boolean;
  profileSaving: boolean;
  profileMessage: string | null;
  profileError: string | null;
  onClose: () => void;
  onPhotoSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemovePhoto: () => void;
  onChange: (updater: Partial<ProfileDraft>) => void;
  onSave: () => void;
}) {
  const { t } = useLocalization();
  const dialogRef = useRef<HTMLElement | null>(null);
  const trimmedAvatarUrl = avatarUrl.trim();
  const bioLength = profileDraft.bio.length;
  useModalDismiss(onClose, { disabled: profileSaving });
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-modal-initial-focus]" });

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section ref={dialogRef} className="auth-modal modal-shell profile-modal profile-editor-modal" data-modal-variant="workspace" role="dialog" aria-modal="true" aria-labelledby="edit-profile-dialog-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <ModalCloseButton label={t("profile.editor.close")} onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="edit-profile-dialog-title">{t("profile.editor.title")}</h2>
          </div>
        </div>

        <div className="profile-editor-layout">
          <aside className="profile-editor-preview" aria-label={t("profile.editor.previewAria")}>
            <div className="profile-editor-preview__photo">
              <label className="profile-photo-picker">
                {trimmedAvatarUrl ? <img className="profile-editor-preview__avatar" src={trimmedAvatarUrl} alt="" aria-hidden="true" /> : <span className="profile-editor-preview__avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</span>}
                <span className="profile-photo-picker__badge" aria-hidden="true">
                  <span className="profile-photo-picker__camera" />
                </span>
                <input type="file" accept="image/*" aria-label={t("profile.editor.choosePhoto")} onChange={onPhotoSelected} disabled={profileLoading || profileSaving} />
              </label>
              {trimmedAvatarUrl ? (
                <button type="button" className="profile-photo-picker__remove" onClick={onRemovePhoto} disabled={profileLoading || profileSaving}>
                  {t("profile.editor.removePhoto")}
                </button>
              ) : null}
            </div>
            <div className="profile-editor-preview__copy">
              <div className="profile-editor-preview__heading">
                <span className="label-mono">{t("profile.editor.publicPreview")}</span>
                <span className="profile-editor-preview__privacy-badge">{t("profile.editor.aggregatesOnly")}</span>
              </div>
              <strong>{profileDraft.displayName.trim() || displayName}</strong>
              <p>{profileDraft.bio.trim() || t("profile.noBio")}</p>
            </div>
            <ProfileSocialLinks profile={{ website_url: profileDraft.websiteUrl, github_url: profileDraft.githubUrl, linkedin_url: profileDraft.linkedinUrl }} />
            <p className="profile-editor-preview__privacy">{t("profile.editor.previewPrivacy")}</p>
            {/* Visibility sits with the preview it governs: what is published, whether it is
                published, and a way to go look at it now read as one cluster. */}
            <PublicProfileToggle
              checked={profileDraft.isPublic}
              disabled={profileLoading || profileSaving}
              onChange={(isPublic) => onChange({ isPublic })}
            />
            {publicId && profileDraft.isPublic ? (
              <button
                type="button"
                className="app-btn app-btn--quiet app-btn--compact profile-editor-preview__open-page"
                onClick={() => void openPublicProfilePage(publicId)}
              >
                {t("profile.editor.openPublicPage")}
              </button>
            ) : null}
          </aside>

          <div className="leaderboard-profile-sidebar__form">
            <label><span>{t("profile.editor.displayName")}</span><input className="settings-input" data-modal-initial-focus value={profileDraft.displayName} onChange={(event) => onChange({ displayName: event.target.value })} disabled={profileLoading || profileSaving} /></label>
            <label>
              <span>{t("profile.editor.bio")}</span>
              <textarea className="settings-input settings-textarea" value={profileDraft.bio} onChange={(event) => onChange({ bio: event.target.value })} disabled={profileLoading || profileSaving} maxLength={160} />
              <small>{t("profile.editor.characters", { count: bioLength })}</small>
            </label>
            <fieldset className="profile-editor-links">
              <legend>{t("profile.editor.publicLinks")}</legend>
              <label><span>{t("dashboard.today.website")}</span><input className="settings-input modal-code" value={profileDraft.websiteUrl} onChange={(event) => onChange({ websiteUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
              <label><span>GitHub</span><input className="settings-input modal-code" value={profileDraft.githubUrl} onChange={(event) => onChange({ githubUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
              <label><span>LinkedIn</span><input className="settings-input modal-code" value={profileDraft.linkedinUrl} onChange={(event) => onChange({ linkedinUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
            </fieldset>
          </div>
        </div>

        {profileError ? <p className="capture-recency capture-recency--error">{profileError}</p> : null}
        {profileMessage ? <p className="capture-recency">{profileMessage}</p> : null}

        <div className="modal-foot profile-editor-modal__actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={onSave} disabled={profileLoading || profileSaving}>{profileSaving ? t("common.saving") : t("profile.editor.save")}</button>
        </div>
      </section>
    </div>
  );
}

/**
 * Master visibility for profile-owned surfaces. `profiles.is_public` gates the public profile
 * page and profile/rank embeds. Leaderboard rows are governed separately by their opt-in state.
 */
export function PublicProfileToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useLocalization();
  return (
    <label className="profile-visibility-toggle">
      <input
        className="modal-switch"
        type="checkbox"
        role="switch"
        aria-label={t("profile.editor.publicAria")}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="profile-visibility-toggle__copy">
        <strong>{t("profile.editor.publicTitle")}</strong>
        <small>{t("profile.editor.publicDetail")}</small>
      </span>
    </label>
  );
}

export type ProfileLinkKind = "website" | "github" | "linkedin";

export function ProfileSocialLinks({
  profile,
  hideWhenEmpty = false,
}: {
  profile: { website_url?: string | null; github_url?: string | null; linkedin_url?: string | null };
  /** Viewer surfaces hide the empty row; editing surfaces keep it as guidance. */
  hideWhenEmpty?: boolean;
}) {
  const { t } = useLocalization();
  const socialLinks: Array<{ key: ProfileLinkKind; value?: string | null }> = [
    { key: "website", value: profile.website_url },
    { key: "github", value: profile.github_url },
    { key: "linkedin", value: profile.linkedin_url },
  ];
  const links: Array<{ key: ProfileLinkKind; href: string; text: string }> = [];

  for (const link of socialLinks) {
    const href = normalizeExternalUrl(link.value);
    if (href) {
      links.push({ key: link.key, href, text: formatProfileLinkLabel(link.key, link.value) });
    }
  }

  if (links.length === 0) {
    if (hideWhenEmpty) return null;
    return <p className="profile-socials profile-socials--empty">{t("profile.linksEmpty")}</p>;
  }

  return (
    <div className="profile-socials" aria-label={t("profile.linksAria")}>
      {links.map((link) => (
        <a key={link.key} className="profile-social" data-link-kind={link.key} href={link.href} title={link.href} target="_blank" rel="noreferrer">
          <span className="profile-social__label">{link.text}</span>
        </a>
      ))}
    </div>
  );
}

export function normalizeExternalUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function formatExternalLinkText(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/**
 * Chip label per link kind. Each platform's own shorthand carries the kind, so
 * the chip needs no brand mark: a bare domain reads as a website, `@name` as a
 * GitHub handle, and `in/name` as a LinkedIn profile.
 */
export function formatProfileLinkLabel(kind: ProfileLinkKind, value?: string | null): string {
  const text = formatExternalLinkText(value);
  if (!text) return text;

  if (kind === "github") {
    const handle = /^(?:www\.)?github\.com\/([^/?#]+)/i.exec(text);
    return handle ? `@${handle[1]}` : text;
  }

  if (kind === "linkedin") {
    const handle = /^(?:[\w-]+\.)?linkedin\.com\/(?:in|company|pub)\/([^/?#]+)/i.exec(text);
    return handle ? `in/${handle[1]}` : text;
  }

  // A website chip only needs its host; the full URL stays in the title.
  return text.replace(/^www\./i, "").split("/")[0] ?? text;
}

export function buildPublicProfileUrl(publicId: string): string {
  return `https://drifty.so/profile/?id=${encodeURIComponent(publicId)}`;
}

/**
 * Open the live public profile page in the default browser. The in-app editor can only
 * preview the fields it owns, so this is the one place a user can see exactly what the
 * public URL serves before sharing it.
 */
export async function openPublicProfilePage(publicId: string): Promise<void> {
  const url = buildPublicProfileUrl(publicId);
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("Unable to copy profile link");
  } finally {
    document.body.removeChild(textarea);
  }
}
