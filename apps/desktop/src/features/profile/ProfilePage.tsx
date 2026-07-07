// Profile tab — the home for everything the outside world can see about you:
// public profile fields, the opt-in public focus card, and the copy-paste embeds.
// Deliberately separate from the Leaderboard tab (which is just the ranking board);
// a user can publish a focus card without ever joining the leaderboard.
import { useEffect, useState } from "react";
import { ProfileAvatar } from "../leaderboard/leaderboardViewHelpers";
import { ProfileSocialLinks, copyTextToClipboard } from "./ProfileModals";
import { renderFocusBadgeSvg, formatFocusDuration, FOCUS_GREEN, AWAY_GREY } from "../share/badgeSvg";
import { buildEmbedSnippets, functionsBaseFromSupabaseUrl } from "../share/embedSnippets";
import type { FocusCardControls } from "../share/useFocusCard";

export type ProfilePageProps = {
  isSupabaseEnabled: boolean;
  isSignedIn: boolean;
  displayName: string;
  avatarUrl: string;
  bio: string;
  websiteUrl: string;
  githubUrl: string;
  linkedinUrl: string;
  publicId: string | null;
  /** Local rolling 7-day focus, for the badge preview (works without any cloud state). */
  focusSeconds7d: number;
  card: FocusCardControls;
  isLeaderboardOptedIn: boolean;
  leaderboardRank: number | null;
  shareMessage: string | null;
  profileMessage: string | null;
  profileError: string | null;
  onEditProfile: () => void;
  onCopyProfileLink: () => void;
  onOpenLeaderboard: () => void;
  onSignIn: () => void;
};

export function ProfilePage({
  isSupabaseEnabled,
  isSignedIn,
  displayName,
  avatarUrl,
  bio,
  websiteUrl,
  githubUrl,
  linkedinUrl,
  publicId,
  focusSeconds7d,
  card,
  isLeaderboardOptedIn,
  leaderboardRank,
  shareMessage,
  profileMessage,
  profileError,
  onEditProfile,
  onCopyProfileLink,
  onOpenLeaderboard,
  onSignIn,
}: ProfilePageProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const { refresh: refreshCard } = card;
  useEffect(() => {
    if (isSignedIn) void refreshCard();
  }, [isSignedIn, refreshCard]);

  const trimmedBio = bio.trim();
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
  const functionsBase = supabaseUrl ? functionsBaseFromSupabaseUrl(supabaseUrl) : "";
  const snippets = publicId ? buildEmbedSnippets(publicId, functionsBase) : null;

  const isLive = card.enabled === true && focusSeconds7d > 0;
  const previewSvg = renderFocusBadgeSvg({
    value: focusSeconds7d > 0 ? formatFocusDuration(focusSeconds7d) : "—",
    accent: isLive ? FOCUS_GREEN : AWAY_GREY,
  });
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

  const embedRows: Array<{ key: string; label: string; snippet: string }> = snippets
    ? [
        { key: "markdown", label: "GitHub README (Markdown)", snippet: snippets.markdown },
        { key: "iframe", label: "Website card (iframe)", snippet: snippets.iframe },
        { key: "html", label: "Website badge (HTML)", snippet: snippets.html },
        { key: "link", label: "Profile link", snippet: snippets.profileUrl },
      ]
    : [];

  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <h1>Your public profile</h1>
        </div>
      </div>

      {!isSupabaseEnabled ? (
        <section className="leaderboard-profile-block" aria-label="Profile unavailable">
          <span className="label-mono">Sync required</span>
          <p className="capture-recency">Supabase is not configured for this workspace, so public profile features are unavailable.</p>
        </section>
      ) : !isSignedIn ? (
        <section className="leaderboard-profile-block" aria-label="Sign in to build your profile">
          <span className="label-mono">Public profile</span>
          <p className="capture-recency">Sign in to create your public profile, focus card, and embeds. Nothing is published until you turn it on.</p>
          <div className="leaderboard-hero__actions">
            <button type="button" className="settings-btn" onClick={onSignIn}>Sign in</button>
          </div>
        </section>
      ) : (
        <div className="leaderboard-panel__stack">
          {/* Identity */}
          <section className="leaderboard-profile-block" aria-label="Your public identity">
            <section className="leaderboard-hero" aria-label="Profile identity">
              <div className="leaderboard-hero__identity">
                <ProfileAvatar className="leaderboard-hero__avatar" name={displayName} src={avatarUrl || null} />
                <div className="leaderboard-hero__main">
                  <div className="leaderboard-hero__name-row">
                    <h3>{displayName}</h3>
                    <button type="button" className="settings-btn" onClick={onEditProfile}>Edit profile</button>
                  </div>
                  {trimmedBio ? <p className="leaderboard-profile-bio">{trimmedBio}</p> : <p className="leaderboard-profile-bio">Add a short bio so your public card feels complete.</p>}
                  <ProfileSocialLinks profile={{ website_url: websiteUrl, github_url: githubUrl, linkedin_url: linkedinUrl }} />
                </div>
              </div>
            </section>
          </section>

          {/* Public focus card */}
          <section className="leaderboard-profile-block" aria-label="Public focus card">
            <div className="leaderboard-section-kicker">
              <div>
                <span className="label-mono">Public focus card</span>
                <p>One switch controls everything below. Off means your card and badges show nothing.</p>
              </div>
              <span className="leaderboard-privacy-badge">Aggregates only</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "4px 0 0" }}>
              <img src={previewSrc} alt="Drifty focus badge preview" height={20} style={{ display: "block" }} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <p className="capture-recency" style={{ margin: 0 }}>
                  {card.enabled === true
                    ? "On — anyone with your link can see your weekly focus, drift/neutral split, and daily focus."
                    : card.enabled === null
                      ? "Checking…"
                      : "Off — turn on to share your focus card publicly."}
                </p>
                {card.error ? <p className="capture-recency capture-recency--error" style={{ margin: "4px 0 0" }}>{card.error}</p> : null}
              </div>
              {card.enabled === true ? (
                <button type="button" className="ghost-button" disabled={card.busy} onClick={() => void card.disable()}>
                  {card.busy ? "Saving…" : "Make private"}
                </button>
              ) : (
                <button type="button" className="settings-btn" disabled={card.busy || card.enabled === null} onClick={() => void card.enable()}>
                  {card.busy ? "Turning on…" : "Make public"}
                </button>
              )}
            </div>
          </section>

          {/* Embeds */}
          <section className="leaderboard-profile-block" aria-label="Embeds">
            <div className="leaderboard-section-kicker">
              <div>
                <span className="label-mono">Embeds</span>
                <p>Drop these on your site, GitHub README, or blog. They update themselves.</p>
              </div>
            </div>
            {snippets ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {embedRows.map((row) => (
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
                <div>
                  <button type="button" className="ghost-button" onClick={onCopyProfileLink}>Copy profile link</button>
                </div>
              </div>
            ) : (
              <div>
                <p className="capture-recency">Save your profile once to mint your public link, then your embeds appear here.</p>
                <button type="button" className="settings-btn" onClick={onEditProfile}>Set up profile</button>
              </div>
            )}
          </section>

          {/* Leaderboard summary */}
          <section className="leaderboard-profile-block" aria-label="Leaderboard participation">
            <div className="leaderboard-section-kicker">
              <div>
                <span className="label-mono">Leaderboard</span>
                <p>
                  {isLeaderboardOptedIn
                    ? leaderboardRank !== null
                      ? `On the board · #${leaderboardRank}`
                      : "On the board"
                    : "Not on the board — joining is separate from your focus card."}
                </p>
              </div>
              <button type="button" className="ghost-button" onClick={onOpenLeaderboard}>Open leaderboard</button>
            </div>
          </section>

          {profileError ? <p className="capture-recency capture-recency--error">{profileError}</p> : null}
          {profileMessage ? <p className="capture-recency">{profileMessage}</p> : null}
          <p className="capture-recency">Only your opt-in aggregate focus is shared. Raw app, site, window, and session history stays on your device.</p>
        </div>
      )}

      {shareMessage ? <div className="leaderboard-share-toast" role="status">{shareMessage}</div> : null}
    </div>
  );
}
