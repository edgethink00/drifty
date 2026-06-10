import type { LeaderboardRow } from "../leaderboard/leaderboardService";
import { getLeaderboardPeriodFocusLabel } from "../leaderboard/leaderboardWindow";
import type { PublicProfile } from "./profileService";
import { formatCompactDurationFromSeconds, formatRelativeTime } from "../../lib/formatting";
import { MetricTile } from "../../components/MetricTile";
import type { ChangeEvent } from "react";

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

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section className="auth-modal profile-modal" aria-labelledby="public-profile-title" onClick={(event) => event.stopPropagation()}>
        <div className="profile-modal__header">
          {profile?.avatar_url ? <img className="profile-modal__avatar" src={profile.avatar_url} alt="" aria-hidden="true" /> : <div className="profile-modal__avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</div>}
          <div>
            <span className="label-mono">Leaderboard profile</span>
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
        <button type="button" className="settings-btn auth-modal__close" onClick={onClose}>Close</button>
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
  profileDraft: { displayName: string; bio: string; avatarUrl: string; websiteUrl: string; githubUrl: string; linkedinUrl: string; isPublic: boolean };
  profileLoading: boolean;
  profileSaving: boolean;
  profileMessage: string | null;
  profileError: string | null;
  onClose: () => void;
  onPhotoSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemovePhoto: () => void;
  onChange: (updater: Partial<{ displayName: string; bio: string; avatarUrl: string; websiteUrl: string; githubUrl: string; linkedinUrl: string; isPublic: boolean }>) => void;
  onSave: () => void;
}) {
  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section className="auth-modal profile-modal profile-editor-modal" aria-labelledby="edit-profile-title" onClick={(event) => event.stopPropagation()}>
        <div className="profile-modal__header">
          {avatarUrl.trim() ? <img className="profile-modal__avatar" src={avatarUrl} alt="" aria-hidden="true" /> : <div className="profile-modal__avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</div>}
          <div>
            <span className="label-mono">Edit profile</span>
            <h2 id="edit-profile-title">{displayName}</h2>
          </div>
        </div>

        <div className="leaderboard-profile-sidebar__form">
          <div className="leaderboard-photo-control">
            <span>Profile photo</span>
            <div className="leaderboard-photo-control__actions">
              <label className="settings-btn leaderboard-photo-control__upload">
                Upload photo
                <input type="file" accept="image/*" onChange={onPhotoSelected} disabled={profileLoading || profileSaving} />
              </label>
              {avatarUrl.trim() ? <button type="button" className="ghost-button" onClick={onRemovePhoto} disabled={profileLoading || profileSaving}>Remove</button> : null}
            </div>
            <p>Shown on your public leaderboard profile.</p>
          </div>
          <label><span>Display name</span><input className="settings-input" value={profileDraft.displayName} onChange={(event) => onChange({ displayName: event.target.value })} disabled={profileLoading || profileSaving} /></label>
          <label><span>Bio</span><textarea className="settings-input settings-textarea" value={profileDraft.bio} onChange={(event) => onChange({ bio: event.target.value })} disabled={profileLoading || profileSaving} maxLength={160} /></label>
          <label><span>Website</span><input className="settings-input" value={profileDraft.websiteUrl} onChange={(event) => onChange({ websiteUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
          <label><span>GitHub</span><input className="settings-input" value={profileDraft.githubUrl} onChange={(event) => onChange({ githubUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
          <label><span>LinkedIn</span><input className="settings-input" value={profileDraft.linkedinUrl} onChange={(event) => onChange({ linkedinUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
        </div>

        {profileError ? <p className="capture-recency capture-recency--error">{profileError}</p> : null}
        {profileMessage ? <p className="capture-recency">{profileMessage}</p> : null}

        <div className="profile-editor-modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button type="button" className="settings-btn" onClick={onSave} disabled={profileLoading || profileSaving}>{profileSaving ? "Saving…" : "Save profile"}</button>
        </div>
      </section>
    </div>
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

  if (links.length === 0) return <p className="profile-socials profile-socials--empty">No public links yet.</p>;

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

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read profile photo"));
      }
    });
    reader.addEventListener("error", () => reject(new Error("Unable to read profile photo")));
    reader.readAsDataURL(file);
  });
}
