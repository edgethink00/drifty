import type { LeaderboardRow } from "../leaderboard/leaderboardService";
import { getLeaderboardPeriodFocusLabel } from "../leaderboard/leaderboardWindow";
import type { PublicProfile } from "./profileService";
import { formatCompactDurationFromSeconds, formatRelativeTime } from "../../lib/formatting";
import { MetricTile } from "../../components/MetricTile";
import type { ChangeEvent } from "react";
import { useState } from "react";
import { renderFocusBadgeSvg, formatFocusDuration, FOCUS_GREEN, AWAY_GREY } from "../share/badgeSvg";
import { buildEmbedSnippets, functionsBaseFromSupabaseUrl } from "../share/embedSnippets";

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

        <div className="profile-editor-layout">
          <aside className="profile-editor-preview" aria-label="Public profile preview">
            <label className="profile-photo-picker">
              {avatarUrl.trim() ? <img className="profile-editor-preview__avatar" src={avatarUrl} alt="" aria-hidden="true" /> : <span className="profile-editor-preview__avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</span>}
              <span className="profile-photo-picker__badge" aria-hidden="true">
                <span className="profile-photo-picker__camera" />
              </span>
              <span className="sr-only">Choose profile photo</span>
              <input type="file" accept="image/*" onChange={onPhotoSelected} disabled={profileLoading || profileSaving} />
            </label>
            <div className="profile-editor-preview__copy">
              <span className="label-mono">Public preview</span>
              <strong>{profileDraft.displayName.trim() || displayName}</strong>
              <p>{profileDraft.bio.trim() || "No public bio yet."}</p>
            </div>
            <ProfileSocialLinks profile={{ website_url: profileDraft.websiteUrl, github_url: profileDraft.githubUrl, linkedin_url: profileDraft.linkedinUrl }} />
            <p className="profile-editor-preview__privacy">Only this profile card and aggregate leaderboard totals are public.</p>
          </aside>

          <div className="leaderboard-profile-sidebar__form">
            <div className="leaderboard-photo-control">
              <span>Profile photo</span>
              <div className="leaderboard-photo-control__hint">
                <p>Select the preview image to choose a file.</p>
                {avatarUrl.trim() ? <button type="button" className="ghost-button" onClick={onRemovePhoto} disabled={profileLoading || profileSaving}>Remove</button> : null}
              </div>
            </div>
            <label><span>Display name</span><input className="settings-input" value={profileDraft.displayName} onChange={(event) => onChange({ displayName: event.target.value })} disabled={profileLoading || profileSaving} /></label>
            <label><span>Bio</span><textarea className="settings-input settings-textarea" value={profileDraft.bio} onChange={(event) => onChange({ bio: event.target.value })} disabled={profileLoading || profileSaving} maxLength={160} /></label>
            <label><span>Website</span><input className="settings-input" value={profileDraft.websiteUrl} onChange={(event) => onChange({ websiteUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
            <label><span>GitHub</span><input className="settings-input" value={profileDraft.githubUrl} onChange={(event) => onChange({ githubUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
            <label><span>LinkedIn</span><input className="settings-input" value={profileDraft.linkedinUrl} onChange={(event) => onChange({ linkedinUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
          </div>
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

// Live "focus badge" embed panel: preview + copy-paste snippets. Reads only the opt-in
// aggregate (this week's focus); the actual badge image is rendered by the public `badge`
// Edge Function. Snippet building is dependency-light (see features/share/embedSnippets).
export function EmbedModal({
  publicId,
  focusSeconds,
  onClose,
}: {
  publicId: string;
  focusSeconds: number | null;
  onClose: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
  const functionsBase = supabaseUrl ? functionsBaseFromSupabaseUrl(supabaseUrl) : "";
  const snippets = buildEmbedSnippets(publicId, functionsBase);

  const isLive = focusSeconds != null && focusSeconds > 0;
  const value = isLive ? formatFocusDuration(focusSeconds) : "—";
  const previewSvg = renderFocusBadgeSvg({ value, accent: isLive ? FOCUS_GREEN : AWAY_GREY });
  const previewSrc = `data:image/svg+xml;utf8,${encodeURIComponent(previewSvg)}`;

  const copy = async (key: string, text: string) => {
    try {
      await copyTextToClipboard(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1800);
    } catch {
      setCopiedKey(null);
    }
  };

  const rows: Array<{ key: string; label: string; snippet: string }> = [
    { key: "markdown", label: "GitHub README (Markdown)", snippet: snippets.markdown },
    { key: "iframe", label: "Website card (iframe)", snippet: snippets.iframe },
    { key: "html", label: "Website badge (HTML)", snippet: snippets.html },
    { key: "link", label: "Profile link", snippet: snippets.profileUrl },
  ];

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section className="auth-modal profile-modal" aria-labelledby="embed-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="profile-modal__header">
          <div>
            <span className="label-mono">Embed your focus</span>
            <h2 id="embed-modal-title">Share a live badge</h2>
          </div>
        </div>
        <p className="profile-modal__bio">Drop this badge on your site, GitHub README, or blog. It updates itself with your weekly focus.</p>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "4px 0 16px" }}>
          <img src={previewSrc} alt="Drifty focus badge preview" height={20} style={{ display: "block" }} />
          {!isLive ? <span className="capture-recency">Fills in once this week has tracked focus.</span> : null}
        </div>

        {!supabaseUrl ? (
          <p className="capture-recency capture-recency--error">Cloud isn’t configured in this build, so the badge URL may not resolve yet.</p>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((row) => (
            <label key={row.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label-mono">{row.label}</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  className="settings-input"
                  style={{ flex: 1, fontFamily: "monospace", fontSize: "0.8rem" }}
                  readOnly
                  value={row.snippet}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button type="button" className="settings-btn" onClick={() => void copy(row.key, row.snippet)}>
                  {copiedKey === row.key ? "Copied" : "Copy"}
                </button>
              </div>
            </label>
          ))}
        </div>

        <p className="profile-modal__privacy">Only your opt-in aggregate focus is shared. Raw app, site, window, and session history stays on your device.</p>
        <button type="button" className="settings-btn auth-modal__close" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}

// Profile photos are stored inline (base64) and surfaced at small sizes (38px leaderboard rows,
// the profile modal avatar). Downscale + recompress before encoding so a multi-megabyte original
// never ends up inflating the leaderboard payload. Kept well under the server-side size guard.
export const AVATAR_MAX_DIMENSION = 256;
export const AVATAR_JPEG_QUALITY = 0.82;
export const AVATAR_MAX_OUTPUT_BYTES = 100_000;

export async function readImageFileAsDataUrl(file: File): Promise<string> {
  const source = await decodeImageFile(file);
  try {
    let dataUrl = renderAvatarDataUrl(source, AVATAR_MAX_DIMENSION, AVATAR_JPEG_QUALITY);
    if (dataUrl.length > AVATAR_MAX_OUTPUT_BYTES) {
      // Highly detailed images can still be large at full quality; try once more, smaller.
      dataUrl = renderAvatarDataUrl(source, 192, 0.7);
    }
    if (dataUrl.length > AVATAR_MAX_OUTPUT_BYTES) {
      throw new Error("Profile photo is too detailed to compress. Try a simpler image.");
    }
    return dataUrl;
  } finally {
    if (typeof (source as ImageBitmap).close === "function") {
      (source as ImageBitmap).close();
    }
  }
}

async function decodeImageFile(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      // Fall back to the <img> decode path below.
    }
  }
  return loadImageElement(file);
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read profile photo"));
    });
    image.src = objectUrl;
  });
}

function renderAvatarDataUrl(source: ImageBitmap | HTMLImageElement, size: number, quality: number): string {
  const sourceWidth = "naturalWidth" in source && source.naturalWidth ? source.naturalWidth : source.width;
  const sourceHeight = "naturalHeight" in source && source.naturalHeight ? source.naturalHeight : source.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("Unable to read profile photo");
  }

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to process profile photo");
  }

  // Center square-crop so the circular avatar isn't distorted, then scale into the canvas.
  const cropSize = Math.min(sourceWidth, sourceHeight);
  const cropX = (sourceWidth - cropSize) / 2;
  const cropY = (sourceHeight - cropSize) / 2;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.drawImage(source, cropX, cropY, cropSize, cropSize, 0, 0, size, size);

  return canvas.toDataURL("image/jpeg", quality);
}
