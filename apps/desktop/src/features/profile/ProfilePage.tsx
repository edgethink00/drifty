// Profile tab — the home for everything the outside world can see about you:
// public profile fields, the opt-in public focus card, and the copy-paste embeds.
// Deliberately separate from the Leaderboard tab (which is just the ranking board);
// a user can publish a focus card without ever joining the leaderboard.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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

  // Embeds are grouped by what they LOOK like (badge vs card), with the paste formats
  // listed under each visual — the badge is one artifact whether it lands in a README
  // or a website, so it gets one preview and two code variants.
  type EmbedVariant = { key: string; label: string; snippet: string };
  type EmbedGroup = { key: string; title: string; preview: ReactNode; variants: EmbedVariant[] };
  const embedGroups: EmbedGroup[] = snippets
    ? [
        {
          key: "badge",
          title: "Focus badge",
          preview: <img src={previewSrc} alt="Focus badge preview" height={20} style={{ display: "block" }} />,
          variants: [
            { key: "markdown", label: "GitHub README · Markdown", snippet: snippets.markdown },
            { key: "html", label: "Website · HTML", snippet: snippets.html },
          ],
        },
        {
          key: "card",
          title: "Focus card",
          preview: <FocusCardEmbedPreview displayName={displayName} focusSeconds={focusSeconds7d} />,
          variants: [
            { key: "iframe", label: "Website · iframe", snippet: snippets.iframe },
          ],
        },
      ]
    : [];

  return (
    <div className="page profile-page">
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
          {/* Identity + leaderboard status */}
          <section className="leaderboard-profile-block" aria-label="Your public identity">
            <div className="profile-identity__main">
              <ProfileAvatar className="leaderboard-hero__avatar" name={displayName} src={avatarUrl || null} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="profile-identity__name-row">
                  <h3>{displayName}</h3>
                  <button type="button" className="ghost-button" onClick={onEditProfile}>Edit profile</button>
                </div>
                <p className="profile-identity__bio">{trimmedBio || "Add a short bio so your public card feels complete."}</p>
                <ProfileSocialLinks profile={{ website_url: websiteUrl, github_url: githubUrl, linkedin_url: linkedinUrl }} />
              </div>
            </div>
            <div className="profile-identity__board" aria-label="Leaderboard participation">
              <span className="label-mono">Leaderboard</span>
              <span className="profile-identity__board-status">
                {isLeaderboardOptedIn
                  ? leaderboardRank !== null
                    ? `On the board · #${leaderboardRank}`
                    : "On the board"
                  : "Not on the board — joining is separate from your focus card."}
              </span>
              <button type="button" className="ghost-button" onClick={onOpenLeaderboard}>Open leaderboard</button>
            </div>
          </section>

          {/* Public focus card control */}
          <section className="leaderboard-profile-block" aria-label="Public focus card">
            <div className="leaderboard-section-kicker">
              <div>
                <span className="label-mono">Public focus card</span>
                <p>One switch controls everything below. Off means your card and badges show nothing.</p>
              </div>
              <span className="leaderboard-privacy-badge">Aggregates only</span>
            </div>
            <div className="profile-card-control__row">
              <span className="profile-card-control__badge">
                <img src={previewSrc} alt="Drifty focus badge preview" height={20} style={{ display: "block" }} />
              </span>
              <div className="profile-card-control__copy">
                <p className="capture-recency">
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
              <>
                <div className="profile-embed-grid">
                  {embedGroups.map((group) => (
                    <div key={group.key} className="profile-embed-card">
                      <div className="profile-embed-card__head">
                        <span className="label-mono">{group.title}</span>
                      </div>
                      <div className="profile-embed-card__preview">{group.preview}</div>
                      {group.variants.map((variant) => (
                        <div key={variant.key} className="profile-embed-card__variant">
                          <span className="label-mono profile-embed-card__variant-label">{variant.label}</span>
                          <div className="profile-embed-card__variant-row">
                            <input
                              className="settings-input profile-embed-card__code"
                              readOnly
                              value={variant.snippet}
                              onFocus={(event) => event.currentTarget.select()}
                            />
                            <button type="button" className="settings-btn" onClick={() => void copy(variant.key, variant.snippet)}>
                              {copiedKey === variant.key ? "Copied" : "Copy"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="profile-embed-card profile-embed-card--link">
                  <span className="label-mono">Profile link</span>
                  <div className="profile-embed-card__variant-row">
                    <input
                      className="settings-input profile-embed-card__code"
                      readOnly
                      value={snippets.profileUrl}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <button type="button" className="settings-btn" aria-label="Copy profile link" onClick={onCopyProfileLink}>
                      Copy
                    </button>
                  </div>
                </div>
                <div className="profile-embed-card profile-embed-card--link">
                  <span className="label-mono">Data · JSON (30-day daily focus)</span>
                  <div className="profile-embed-card__variant-row">
                    <input
                      className="settings-input profile-embed-card__code"
                      readOnly
                      value={snippets.dataUrl}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <button type="button" className="settings-btn" onClick={() => void copy("data", snippets.dataUrl)}>
                      {copiedKey === "data" ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <p className="capture-recency">Save your profile once to mint your public link, then your embeds appear here.</p>
                <button type="button" className="settings-btn" onClick={onEditProfile}>Set up profile</button>
              </div>
            )}
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

// Local mock of the hosted drifty.so/embed card so users can see what the iframe embed
// will look like before pasting it anywhere. Purely presentational; mirrors the embed
// page's layout (avatar · name · weekly focus · powered-by footer).
function FocusCardEmbedPreview({ displayName, focusSeconds }: { displayName: string; focusSeconds: number }) {
  const name = displayName.trim() || "drifty";
  const isLive = focusSeconds > 0;
  return (
    <div aria-label="Website card preview" style={{ width: 320, maxWidth: "100%", border: "1px solid var(--line, #e2e2dc)", borderRadius: 14, padding: "13px 15px", background: "var(--surface, #fff)", display: "flex", flexDirection: "column", gap: 9, boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surface-strong, #f2f2ee)", border: "1px solid var(--line, #e2e2dc)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#1c7e3c" }}>
        {(name.charAt(0) || "D").toUpperCase()}
        </span>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</strong>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="label-mono">Focus · this week</span>
        <span style={{ fontSize: "1.3rem", fontWeight: 800, letterSpacing: "-0.02em", color: "#1c7e3c", lineHeight: 1 }}>
          {isLive ? formatFocusDuration(focusSeconds) : "—"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--line, #e9e9e4)", paddingTop: 8, fontSize: "0.72rem", color: "var(--muted, #6b6f66)" }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: isLive ? "#2e9e4f" : "#9a9e96" }} />
        <span>live preview</span>
        <span style={{ marginLeft: "auto", fontWeight: 600 }}>powered by <strong>drifty</strong> ↗</span>
      </div>
    </div>
  );
}
