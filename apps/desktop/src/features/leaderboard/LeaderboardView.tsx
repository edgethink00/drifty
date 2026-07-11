import { useMemo, useState } from "react";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { LeaderboardBoard } from "./LeaderboardBoard";
import { ProfileAvatar, StateBlock, formatRank } from "./leaderboardViewHelpers";
import { formatRoundedDuration } from "../../lib/formatting";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import type { FocusCardControls } from "../share/useFocusCard";
import { ProfileEmbedsModal } from "../profile/ProfileEmbedsModal";
import { normalizeExternalUrl, type ProfileDraft } from "../profile/ProfileModals";
import type { ReactNode } from "react";

export type LeaderboardPublicProfileControls = {
  readonly card: FocusCardControls;
  readonly dailyProductivity: readonly DailyProductivityPoint[] | null;
  readonly draft: ProfileDraft;
  readonly focusSeconds7d: number;
  readonly profileError: string | null;
  readonly profileMessage: string | null;
  readonly publicId: string | null;
  readonly shareMessage: string | null;
  readonly webAccountPreview?: boolean;
  readonly onCopyProfileLink: () => void;
  readonly onEditProfile: () => void;
};

export type LeaderboardViewProps = {
  isSupabaseEnabled: boolean;
  isSignedIn: boolean;
  isLoading?: boolean;
  error?: string | null;
  isOptedIn: boolean;
  ownRank?: number | null;
  activePeriod?: LeaderboardPeriod;
  leaderboard?: LeaderboardRow[];
  totalFocusSeconds7d?: number;
  profileDisplayName?: string | null;
  email?: string | null;
  isActionLoading?: boolean;
  actionError?: string | null;
  publicProfile?: LeaderboardPublicProfileControls;
  statusMessage?: string | null;
  statusTone?: "error" | "neutral";
  onOptIn?: () => void;
  onSignIn?: () => void;
  onOptOut?: () => void;
  onOpenProfile?: () => void;
  onPeriodChange?: (period: LeaderboardPeriod) => void;
  onSelectProfile?: (row: LeaderboardRow) => void;
};

export function LeaderboardView({
  isSupabaseEnabled,
  isSignedIn,
  isLoading = false,
  error = null,
  isOptedIn,
  ownRank = null,
  activePeriod = "weekly",
  leaderboard = [],
  totalFocusSeconds7d = 0,
  profileDisplayName = null,
  email = null,
  isActionLoading = false,
  actionError = null,
  publicProfile,
  statusMessage = null,
  statusTone = "neutral",
  onOptIn,
  onSignIn,
  onOptOut,
  onOpenProfile,
  onPeriodChange,
  onSelectProfile,
}: LeaderboardViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [embedsOpen, setEmbedsOpen] = useState(false);
  const previewName = resolvePublicNamePreview(profileDisplayName, email);
  const currentUserRank = ownRank ?? leaderboard.find((row) => row.display_name === previewName)?.rank ?? null;
  const trimmedSearchQuery = searchQuery.trim().toLowerCase();
  const profileDraft = publicProfile?.draft ?? null;
  const profileAvatarUrl = profileDraft?.avatarUrl.trim() ?? "";
  const editProfile = publicProfile?.onEditProfile ?? onOpenProfile ?? null;
  const profileHandle = resolveProfileHandle(email);
  // Presence stats: all derived from local rolling focus + the 30-day daily series
  // already flowing to the embeds — no lifetime/all-time value is published.
  const weekFocusSeconds = publicProfile?.focusSeconds7d ?? 0;
  const dailyAverageSeconds = Math.round(weekFocusSeconds / 7);
  const last30FocusSeconds = (publicProfile?.dailyProductivity ?? []).reduce((sum, point) => sum + Math.max(0, point.focus), 0);
  const socialPills = buildSocialPills(profileDraft);
  const filteredLeaderboard = useMemo(() => {
    if (!trimmedSearchQuery) return leaderboard;
    return leaderboard.filter((row) => row.display_name.toLowerCase().includes(trimmedSearchQuery) || String(row.rank).includes(trimmedSearchQuery));
  }, [leaderboard, trimmedSearchQuery]);

  return (
    <section className="leaderboard-panel" aria-label="Leaderboard">
      {!isSupabaseEnabled ? (
        <StateBlock
          eyebrow="Sync required"
          title="Leaderboard unavailable"
          detail="Supabase is not configured for this workspace."
        />
      ) : isLoading ? (
        <StateBlock
          eyebrow="Refreshing"
          title="Loading leaderboard"
          detail="Checking the latest opt-in rankings."
        />
      ) : error ? (
        <StateBlock
          eyebrow="Fetch error"
          title="Unable to load leaderboard"
          detail={error}
        />
      ) : (
        <div className="leaderboard-panel__stack">
          <section className="leaderboard-profile-block" aria-label="Leaderboard participation">
            <section
              className="leaderboard-hero"
              aria-label="Your leaderboard participation"
              style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", alignItems: "stretch" }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "40% minmax(0, 1fr)", alignItems: "center", gap: "clamp(1.5rem, 5vw, 3.2rem)" }}>
                <div
                  style={{ position: "relative", display: "flex", alignItems: "center", gap: "var(--space-4)", minWidth: 0, padding: "var(--space-4) var(--space-3)", border: 0, borderRadius: "var(--radius-lg)", background: "color-mix(in srgb, var(--accent-soft) 46%, var(--surface))" }}
                >
                  <ProfileAvatar
                    className="leaderboard-hero__avatar"
                    name={previewName}
                    src={profileAvatarUrl || null}
                    style={{ width: 77, height: 77, borderRadius: 18, fontSize: "1.68rem", flex: "0 0 auto" }}
                  />
                  <div style={{ display: "grid", gap: "0.28rem", minWidth: 0 }}>
                    <span className={`leaderboard-hero__status${isOptedIn ? " leaderboard-hero__status--live" : ""}`} style={{ justifySelf: "start" }}>
                      {isOptedIn
                        ? currentUserRank !== null
                          ? `On the board · ${formatRank(currentUserRank)}`
                          : "On the board"
                        : "Not on the board yet"}
                    </span>
                    <h3 style={{ margin: 0, lineHeight: 1.15, fontSize: "1.15rem", whiteSpace: "normal" }}>{previewName}</h3>
                    {profileHandle ? <span className="leaderboard-hero__handle">{profileHandle}</span> : null}
                  </div>
                  {editProfile ? (
                    <button
                      type="button"
                      className="leaderboard-profile-edit-button"
                      aria-label="Edit public profile"
                      onClick={editProfile}
                      style={{ position: "absolute", top: "var(--space-3)", right: "var(--space-3)", margin: 0 }}
                    >
                      <PencilIcon />
                    </button>
                  ) : null}
                </div>
                {publicProfile ? (
                  <div
                    aria-label="Focus totals"
                    style={{ display: "flex", flexWrap: "wrap", gap: "clamp(1.8rem, 5vw, 3.2rem)", justifyContent: "flex-end", alignSelf: "center", width: "100%", paddingRight: "var(--space-5)" }}
                  >
                    <HeroStat label="Focus · this week" value={formatRoundedDuration(weekFocusSeconds)} accent />
                    <HeroStat label="Daily avg" value={formatRoundedDuration(dailyAverageSeconds)} />
                    <HeroStat label="Last 30 days" value={formatRoundedDuration(last30FocusSeconds)} />
                  </div>
                ) : null}
              </div>

              <div
                style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", paddingTop: "var(--space-3)", paddingRight: "var(--space-5)", borderTop: "1px solid color-mix(in srgb, var(--line) 76%, transparent)" }}
              >
                <div className="leaderboard-hero__participation-slot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: 0 }}>
                  {isOptedIn ? (
                    <button
                      type="button"
                      className="ghost-button leaderboard-hero__participation leaderboard-hero__participation--danger profile-btn hero-action-btn"
                      onClick={() => onOptOut?.()}
                      disabled={isActionLoading || !onOptOut}
                    >
                      {isActionLoading ? "Leaving…" : "Leave leaderboard"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="settings-btn settings-btn--primary leaderboard-hero__participation leaderboard-hero__participation--join profile-btn hero-action-btn"
                      onClick={() => (isSignedIn ? onOptIn?.() : onSignIn?.())}
                      disabled={isActionLoading || (isSignedIn ? !onOptIn : !onSignIn)}
                    >
                      {isActionLoading ? "Joining…" : "Join leaderboard"}
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                  {publicProfile ? (
                    <>
                      <button type="button" className="settings-btn settings-btn--primary profile-btn hero-action-btn" onClick={() => setEmbedsOpen(true)}>
                        <EmbedIcon />
                        Embed
                      </button>
                      {/* Share copies the public profile link — only meaningful once you're on the board. */}
                      {isOptedIn ? (
                        <button type="button" className="ghost-button profile-btn hero-action-btn" onClick={publicProfile.onCopyProfileLink}>
                          <ShareIcon />
                          Share
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {socialPills.map((pill) => (
                    <a key={pill.key} href={pill.href} target="_blank" rel="noreferrer" className="ghost-button profile-btn hero-action-btn" style={{ textDecoration: "none" }}>
                      {pill.icon}
                      {pill.label}
                    </a>
                  ))}
                </div>
              </div>
            </section>
            {actionError ? <p className="capture-recency capture-recency--error" role="status">{actionError}</p> : null}
            {publicProfile?.profileError || publicProfile?.profileMessage ? (
              <div className="leaderboard-public-profile__messages">
                {publicProfile.profileError ? <p className="capture-recency capture-recency--error">{publicProfile.profileError}</p> : null}
                {publicProfile.profileMessage ? <p className="capture-recency">{publicProfile.profileMessage}</p> : null}
              </div>
            ) : null}
          </section>

          {publicProfile && embedsOpen ? (
            <ProfileEmbedsModal
              card={publicProfile.card}
              dailyProductivity={publicProfile.dailyProductivity}
              displayName={previewName}
              draft={publicProfile.draft}
              focusSeconds7d={publicProfile.focusSeconds7d}
              publicId={publicProfile.publicId}
              webAccountPreview={publicProfile.webAccountPreview}
              onClose={() => setEmbedsOpen(false)}
              onCopyProfileLink={publicProfile.onCopyProfileLink}
              onEditProfile={publicProfile.onEditProfile}
            />
          ) : null}

          <LeaderboardBoard
            activePeriod={activePeriod}
            currentUserRank={currentUserRank}
            filteredLeaderboard={filteredLeaderboard}
            isOptedIn={isOptedIn}
            leaderboard={leaderboard}
            previewName={previewName}
            searchQuery={searchQuery}
            statusMessage={statusMessage}
            statusTone={statusTone}
            totalFocusSeconds7d={totalFocusSeconds7d}
            onPeriodChange={onPeriodChange}
            onSearchQueryChange={setSearchQuery}
            onSelectProfile={onSelectProfile}
          />
          {publicProfile?.shareMessage ? <div className="leaderboard-share-toast" role="status">{publicProfile.shareMessage}</div> : null}
        </div>
      )}
    </section>
  );
}

function resolvePublicNamePreview(profileDisplayName?: string | null, email?: string | null) {
  const trimmedName = profileDisplayName?.trim();
  if (trimmedName) return trimmedName;

  const emailPrefix = email?.split("@")[0]?.trim();
  return emailPrefix || "drifty";
}

function resolveProfileHandle(email?: string | null): string | null {
  const prefix = email?.split("@")[0]?.trim();
  if (!prefix) return null;
  const handle = prefix.toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  return handle ? `@${handle}` : null;
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 19.5 6 14.1 15.9 4.2a2.1 2.1 0 0 1 3 0l.9.9a2.1 2.1 0 0 1 0 3L9.9 18 4.5 19.5Z" />
      <path d="m14.5 5.6 3.9 3.9" />
    </svg>
  );
}

function EmbedIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="m8.3 10.8 7.4-4.5M8.3 13.2l7.4 4.5" />
    </svg>
  );
}

function HeroStat({ label, value, accent = false }: { readonly label: string; readonly value: string; readonly accent?: boolean }) {
  const color = accent ? "var(--accent-strong)" : "var(--text)";
  return (
    <div style={{ display: "grid", gap: "0.4rem", minWidth: 0 }}>
      <span className="label-mono" style={{ fontSize: "0.56rem", color: accent ? "var(--accent-strong)" : undefined }}>{label}</span>
      <strong style={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1, color, whiteSpace: "nowrap" }}>{value}</strong>
    </div>
  );
}

type SocialPill = { readonly key: string; readonly href: string; readonly label: string; readonly icon: ReactNode };

function buildSocialPills(draft: ProfileDraft | null): SocialPill[] {
  if (!draft) return [];
  const defs: ReadonlyArray<{ key: string; value: string; label: string; icon: ReactNode }> = [
    { key: "website", value: draft.websiteUrl, label: "Website", icon: <WebsiteIcon /> },
    { key: "github", value: draft.githubUrl, label: "GitHub", icon: <GitHubIcon /> },
    { key: "linkedin", value: draft.linkedinUrl, label: "LinkedIn", icon: <LinkedInIcon /> },
  ];
  const pills: SocialPill[] = [];
  for (const def of defs) {
    const href = normalizeExternalUrl(def.value);
    if (href) pills.push({ key: def.key, href, label: def.label, icon: def.icon });
  }
  return pills;
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.8 9.6.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.5-1.1-4.5-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1 .8-.2 1.6-.3 2.5-.3.8 0 1.7.1 2.5.3 1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.5 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 3.9-1.3 6.8-5.1 6.8-9.6C22 6.6 17.5 2 12 2Z" />
    </svg>
  );
}

function WebsiteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.5-1 1.8-2 3.7-2 3.9 0 4.6 2.6 4.6 5.9V21h-4v-5.3c0-1.3 0-2.9-1.8-2.9s-2 1.4-2 2.8V21H9z" />
    </svg>
  );
}
