import type { LeaderboardRow } from "../leaderboard/leaderboardService";
import { KeyHint } from "../../components/KeyHint";
import { useModalSubmitShortcut } from "../../lib/useModalSubmitShortcut";
import { getLeaderboardPeriodFocusLabel } from "../leaderboard/leaderboardWindow";
import { getDailyAverageSeconds, ProfileAvatar } from "../leaderboard/leaderboardViewHelpers";
import { getLeaderFocusSeconds, getLeaderShareRatio, getRankGap, getRankTier, getTopPercentile } from "../leaderboard/leaderboardStanding";
import type { PublicProfile } from "./profileService";
import { formatLocalizedCompactDurationFromSeconds, formatRelativeTime, localeForDisplayLanguage } from "../../lib/formatting";
import { MetricTile } from "../../components/MetricTile";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import { ActionLabel } from "../../components/ActionLabel";

export type ProfileDraft = {
  displayName: string;
  bio: string;
  avatarUrl: string;
  websiteUrl: string;
  githubUrl: string;
  linkedinUrl: string;
  isPublic: boolean;
};

const EDITABLE_PROFILE_FIELDS = ["displayName", "bio", "avatarUrl", "websiteUrl", "githubUrl", "linkedinUrl"] as const;

function sameEditableProfile(a: ProfileDraft, b: ProfileDraft): boolean {
  return EDITABLE_PROFILE_FIELDS.every((field) => a[field] === b[field]);
}

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
  // Keep the clicked leaderboard identity stable while the profile details resolve.
  // The row already carries the public name and avatar shown immediately before this modal.
  const displayName = row.display_name || profile?.display_name || "Member";
  const avatarUrl = row.avatar_url?.trim() || profile?.avatar_url?.trim() || "";
  const bio = profile?.bio?.trim();
  const focusSeconds = row.focus_seconds;
  const rank = row.rank;
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const periodFocusLabel = effectiveLanguage !== "en"
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
  const profileState = isLoading ? "loading" : error ? "error" : profile ? "ready" : "unavailable";
  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section className="auth-modal modal-shell profile-modal" data-modal-variant="standard" data-profile-state={profileState} role="dialog" aria-modal="true" aria-busy={isLoading || undefined} aria-labelledby="public-profile-title" onClick={(event) => event.stopPropagation()}>
        <ModalCloseButton label={t("profile.close")} onClick={onClose} />
        <div className="profile-modal__header">
          <span className="profile-modal__crest" data-rank-tier={rankTier ?? undefined}>
            <ProfileAvatar className="profile-modal__avatar" name={displayName} src={avatarUrl} />
            <span className="profile-modal__rank-badge" aria-hidden="true">#{rank}</span>
          </span>
          <div className="profile-modal__identity">
            <h2 id="public-profile-title">{displayName}</h2>
            <p className="profile-modal__standing">{standing}</p>
          </div>
        </div>
        {isLoading ? (
          <>
            <p className="sr-only" role="status" aria-live="polite">{t("profile.loading")}</p>
            <p className="profile-modal__bio profile-modal__bio--empty profile-modal__bio--loading" aria-hidden="true">
              <span className="profile-modal__bio-placeholder" />
            </p>
          </>
        ) : error ? (
          <p className="profile-modal__bio profile-modal__bio--error" role="alert">{error}</p>
        ) : profile ? (
          <>
            <p className={`profile-modal__bio ${bio ? "" : "profile-modal__bio--empty"}`.trim()}>{bio || t("profile.noBio")}</p>
            <ProfileSocialLinks profile={profile} hideWhenEmpty />
          </>
        ) : (
          <p className="profile-modal__bio profile-modal__bio--empty">{t("profile.unavailable")}</p>
        )}
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

type GraphemeSegmenter = { segment(input: string): Iterable<{ segment: string }> };

/** First visible character of a name, keeping emoji, flags, and joined sequences whole. */
function firstGrapheme(value: string): string {
  const text = value.trim();
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locales?: string | string[], options?: { granularity: "grapheme" }) => GraphemeSegmenter;
  }).Segmenter;
  if (Segmenter) {
    for (const part of new Segmenter(undefined, { granularity: "grapheme" }).segment(text)) return part.segment;
    return "";
  }
  return Array.from(text)[0] ?? "";
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
  const avatarInitial = firstGrapheme(profileDraft.displayName.trim() || displayName).toUpperCase();
  useModalDismiss(onClose, { disabled: profileSaving });
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-modal-initial-focus]" });
  // A failure that needs a second line extends the bottom edge only.
  useAnchoredDialog(dialogRef);
  // What the editor showed once the profile loaded, or what was last saved.
  // Edits beyond it survive a stray outside click; Cancel still discards them.
  const [savedDraft, setSavedDraft] = useState<ProfileDraft | null>(profileLoading ? null : profileDraft);
  useEffect(() => {
    if (!profileLoading && savedDraft === null) setSavedDraft(profileDraft);
  }, [profileDraft, profileLoading, savedDraft]);
  const wasSaving = useRef(profileSaving);
  useEffect(() => {
    if (wasSaving.current && !profileSaving && !profileError) setSavedDraft(profileDraft);
    wasSaving.current = profileSaving;
  }, [profileDraft, profileError, profileSaving]);
  const hasUnsavedInput = savedDraft !== null && !sameEditableProfile(profileDraft, savedDraft);
  const overlayDismiss = useOverlayDismiss(onClose, { disabled: profileSaving, keepOpen: hasUnsavedInput });
  // The bio is multi-line: Enter in a one-line field saves, ⌘/Ctrl+Enter saves from any field.
  useModalSubmitShortcut(dialogRef, "modEnter", onSave, { disabled: profileLoading || profileSaving });

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section ref={dialogRef} className="auth-modal modal-shell profile-modal profile-editor-modal" data-modal-variant="workspace" role="dialog" aria-modal="true" aria-labelledby="edit-profile-dialog-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <ModalCloseButton label={t("profile.editor.close")} onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="edit-profile-dialog-title">{t("profile.editor.title")}</h2>
            <p>{t("profile.editor.previewPrivacy")}</p>
          </div>
        </div>

        <div className="profile-editor-fields">
          <div className="profile-editor-photo">
            <label className="profile-photo-picker">
              {trimmedAvatarUrl ? <img className="profile-photo-picker__avatar" src={trimmedAvatarUrl} alt="" aria-hidden="true" /> : <span className="profile-photo-picker__avatar" aria-hidden="true">{avatarInitial}</span>}
              <span className="profile-photo-picker__badge" aria-hidden="true">
                <span className="profile-photo-picker__plus" />
              </span>
              <input type="file" accept="image/*" aria-label={t("profile.editor.choosePhoto")} onChange={onPhotoSelected} disabled={profileLoading || profileSaving} />
            </label>
            {trimmedAvatarUrl ? (
              <button type="button" className="profile-photo-picker__remove" onClick={onRemovePhoto} disabled={profileLoading || profileSaving}>
                {t("profile.editor.removePhoto")}
              </button>
            ) : null}
          </div>
          <label className="profile-editor-tile">
            <span>{t("profile.editor.displayName")}</span>
            <input
              className="profile-editor-input profile-editor-input--name"
              data-modal-initial-focus
              aria-label={t("profile.editor.displayName")}
              placeholder={displayName}
              value={profileDraft.displayName}
              onChange={(event) => onChange({ displayName: event.target.value })}
              disabled={profileLoading || profileSaving}
            />
          </label>
          <label className="profile-editor-tile">
            <span>{t("profile.editor.bio")}</span>
            <textarea
              className="profile-editor-input profile-editor-input--bio"
              aria-label={t("profile.editor.bio")}
              placeholder={t("profile.editor.bioPlaceholder")}
              value={profileDraft.bio}
              onChange={(event) => onChange({ bio: event.target.value })}
              disabled={profileLoading || profileSaving}
              maxLength={160}
              rows={2}
            />
            <small className="profile-editor-count">{t("profile.editor.characters", { count: bioLength })}</small>
          </label>
          <div className="profile-editor-tile profile-editor-links" role="group" aria-label={t("profile.editor.publicLinks")}>
            <label className="profile-editor-row"><span>{t("dashboard.today.website")}</span><input className="profile-editor-input" inputMode="url" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} placeholder="example.com" value={profileDraft.websiteUrl} onChange={(event) => onChange({ websiteUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
            <label className="profile-editor-row"><span>GitHub</span><input className="profile-editor-input" inputMode="url" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} placeholder="github.com/username" value={profileDraft.githubUrl} onChange={(event) => onChange({ githubUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
            <label className="profile-editor-row"><span>LinkedIn</span><input className="profile-editor-input" inputMode="url" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} placeholder="linkedin.com/in/username" value={profileDraft.linkedinUrl} onChange={(event) => onChange({ linkedinUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
          </div>
          {publicId && profileDraft.isPublic ? (
            <button
              type="button"
              className="app-btn app-btn--quiet app-btn--compact profile-editor-fields__open-page"
              onClick={() => void openPublicProfilePage(publicId)}
            >
              {t("profile.editor.openPublicPage")}
            </button>
          ) : null}
        </div>

        <div className="modal-foot profile-editor-modal__actions">
          {/* The outcome of the last save or photo pick sits in the footer's
              note slot beside Save, which retries it, instead of a line
              inserted above the footer. */}
          <p className={profileError ? "modal-foot__note modal-foot__note--error" : "modal-foot__note"} role="status" title={profileError ?? profileMessage ?? undefined}>
            {profileError ?? profileMessage ?? ""}
          </p>
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("common.cancel")}<KeyHint shortcut="escape" /></button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={onSave} disabled={profileLoading || profileSaving} aria-busy={profileSaving}><ActionLabel busy={profileSaving} busyLabel={t("common.saving")}>{t("profile.editor.save")}</ActionLabel><KeyHint shortcut="modEnter" /></button>
        </div>
      </section>
    </div>
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

export { copyTextToClipboard } from "../../lib/clipboard";
