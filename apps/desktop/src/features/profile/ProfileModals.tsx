import type { LeaderboardRow } from "../leaderboard/leaderboardService";
import { getLeaderboardPeriodFocusLabel } from "../leaderboard/leaderboardWindow";
import type { PublicProfile } from "./profileService";
import { formatCompactDurationFromSeconds, formatRelativeTime } from "../../lib/formatting";
import { MetricTile } from "../../components/MetricTile";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useRef, type ChangeEvent } from "react";

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
  onClose,
}: {
  row: LeaderboardRow;
  profile: PublicProfile | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const displayName = profile?.display_name || row.display_name;
  const bio = profile?.bio?.trim();
  const focusSeconds = row.focus_seconds;
  const rank = row.rank;
  const periodFocusLabel = getLeaderboardPeriodFocusLabel(row.period);
  useModalDismiss(onClose);

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section className="auth-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="public-profile-title" onClick={(event) => event.stopPropagation()}>
        <ModalCloseButton label="Close profile" onClick={onClose} />
        <div className="profile-modal__header">
          {profile?.avatar_url ? <img className="profile-modal__avatar" src={profile.avatar_url} alt="" aria-hidden="true" /> : <div className="profile-modal__avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</div>}
          <div>
            <h2 id="public-profile-title">{displayName}</h2>
          </div>
        </div>
        {isLoading ? <p className="capture-recency">Loading public profile…</p> : null}
        {error ? <p className="capture-recency capture-recency--error">{error}</p> : null}
        <p className="profile-modal__bio">{bio || "No public bio yet."}</p>
        <ProfileSocialLinks profile={profile ?? { website_url: null, github_url: null, linkedin_url: null }} />
        <div className="profile-modal__stats" aria-label={`${displayName} leaderboard stats`}>
          <MetricTile label="Rank" value={`#${rank}`} detail="Current period board" />
          <MetricTile label="Focus" value={formatCompactDurationFromSeconds(focusSeconds)} detail={periodFocusLabel} />
          <MetricTile label="Updated" value={formatRelativeTime(row.updated_at)} />
        </div>
        <p className="profile-modal__privacy">Only public profile fields and aggregate leaderboard totals are shown. Raw app, site, window, and session history is not shown on your public profile.</p>
      </section>
    </div>
  );
}

export function EditProfileModal({
  displayName,
  avatarUrl,
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
  const dialogRef = useRef<HTMLElement | null>(null);
  const trimmedAvatarUrl = avatarUrl.trim();
  const bioLength = profileDraft.bio.length;
  useModalDismiss(onClose, { disabled: profileSaving });
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-modal-initial-focus]" });

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section ref={dialogRef} className="auth-modal profile-modal profile-editor-modal" role="dialog" aria-modal="true" aria-labelledby="edit-profile-dialog-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <ModalCloseButton label="Close profile editor" onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="edit-profile-dialog-title">Edit profile</h2>
          </div>
        </div>

        <div className="profile-editor-layout">
          <aside className="profile-editor-preview" aria-label="Public profile preview">
            <div className="profile-editor-preview__photo">
              <label className="profile-photo-picker">
                {trimmedAvatarUrl ? <img className="profile-editor-preview__avatar" src={trimmedAvatarUrl} alt="" aria-hidden="true" /> : <span className="profile-editor-preview__avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</span>}
                <span className="profile-photo-picker__badge" aria-hidden="true">
                  <span className="profile-photo-picker__camera" />
                </span>
                <input type="file" accept="image/*" aria-label="Choose profile photo" onChange={onPhotoSelected} disabled={profileLoading || profileSaving} />
              </label>
              {trimmedAvatarUrl ? (
                <button type="button" className="profile-photo-picker__remove" onClick={onRemovePhoto} disabled={profileLoading || profileSaving}>
                  Remove photo
                </button>
              ) : null}
            </div>
            <div className="profile-editor-preview__copy">
              <div className="profile-editor-preview__heading">
                <span className="label-mono">Public preview</span>
                <span className="profile-editor-preview__privacy-badge">Aggregates only</span>
              </div>
              <strong>{profileDraft.displayName.trim() || displayName}</strong>
              <p>{profileDraft.bio.trim() || "No public bio yet."}</p>
            </div>
            <ProfileSocialLinks profile={{ website_url: profileDraft.websiteUrl, github_url: profileDraft.githubUrl, linkedin_url: profileDraft.linkedinUrl }} />
            <p className="profile-editor-preview__privacy">Only this profile card and aggregate leaderboard totals are public.</p>
          </aside>

          <div className="leaderboard-profile-sidebar__form">
            <label><span>Display name</span><input className="settings-input" data-modal-initial-focus value={profileDraft.displayName} onChange={(event) => onChange({ displayName: event.target.value })} disabled={profileLoading || profileSaving} /></label>
            <label>
              <span>Bio</span>
              <textarea className="settings-input settings-textarea" value={profileDraft.bio} onChange={(event) => onChange({ bio: event.target.value })} disabled={profileLoading || profileSaving} maxLength={160} />
              <small>{bioLength}/160 characters</small>
            </label>
            <fieldset className="profile-editor-links">
              <legend>Public links</legend>
              <label><span>Website</span><input className="settings-input modal-code" value={profileDraft.websiteUrl} onChange={(event) => onChange({ websiteUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
              <label><span>GitHub</span><input className="settings-input modal-code" value={profileDraft.githubUrl} onChange={(event) => onChange({ githubUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
              <label><span>LinkedIn</span><input className="settings-input modal-code" value={profileDraft.linkedinUrl} onChange={(event) => onChange({ linkedinUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
            </fieldset>
            <PublicProfileToggle
              checked={profileDraft.isPublic}
              disabled={profileLoading || profileSaving}
              onChange={(isPublic) => onChange({ isPublic })}
            />
          </div>
        </div>

        {profileError ? <p className="capture-recency capture-recency--error">{profileError}</p> : null}
        {profileMessage ? <p className="capture-recency">{profileMessage}</p> : null}

        <div className="modal-foot profile-editor-modal__actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={onSave} disabled={profileLoading || profileSaving}>{profileSaving ? "Saving…" : "Save profile"}</button>
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
  return (
    <label className="profile-visibility-toggle">
      <input
        className="modal-switch"
        type="checkbox"
        role="switch"
        aria-label="Public profile"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="profile-visibility-toggle__copy">
        <strong>Public profile</strong>
        <small>
          Controls your profile page and profile embeds. Leaderboard participation is separate;
          turning this off does not leave the board.
        </small>
      </span>
    </label>
  );
}

export function ProfileSocialLinks({ profile }: { profile: { website_url?: string | null; github_url?: string | null; linkedin_url?: string | null } }) {
  const socialLinks: Array<{ key: string; value?: string | null }> = [
    { key: "website", value: profile.website_url },
    { key: "github", value: profile.github_url },
    { key: "linkedin", value: profile.linkedin_url },
  ];
  const links: Array<{ key: string; href: string; text: string }> = [];

  for (const link of socialLinks) {
    const href = normalizeExternalUrl(link.value);
    if (href) {
      links.push({ key: link.key, href, text: formatExternalLinkText(link.value) });
    }
  }

  if (links.length === 0) return <p className="profile-socials profile-socials--empty">No public links added.</p>;

  return (
    <div className="profile-socials" aria-label="Public profile links">
      {links.map((link) => <a key={link.key} href={link.href} target="_blank" rel="noreferrer">{link.text}</a>)}
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

export function buildPublicProfileUrl(publicId: string): string {
  return `https://drifty.so/profile/?id=${encodeURIComponent(publicId)}`;
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
