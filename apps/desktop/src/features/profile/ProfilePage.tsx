import { useEffect } from "react";
import { PublicProfileToggle, type ProfileDraft } from "./ProfileModals";
import type { FocusCardControls } from "../share/useFocusCard";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import { ProfileEmbedsSection } from "./ProfileEmbedsSection";

export type ProfilePageProps = {
  isSupabaseEnabled: boolean;
  isSignedIn: boolean;
  displayName: string;
  avatarUrl: string;
  draft: ProfileDraft;
  onDraftChange?: (updater: Partial<ProfileDraft>) => void;
  onSaveProfile?: () => void;
  isSavingProfile?: boolean;
  publicId: string | null;
  focusSeconds7d: number;
  dailyProductivity: readonly DailyProductivityPoint[] | null;
  card: FocusCardControls;
  isLeaderboardOptedIn: boolean;
  leaderboardRank: number | null;
  shareMessage: string | null;
  profileMessage: string | null;
  profileError: string | null;
  redesign?: boolean;
  webAccountPreview?: boolean;
  onEditProfile: () => void;
  onCopyProfileLink: () => void;
  onOpenLeaderboard: () => void;
  onSignIn: () => void;
};

export function ProfilePage({
  isSupabaseEnabled,
  isSignedIn,
  displayName,
  draft,
  publicId,
  focusSeconds7d,
  dailyProductivity,
  card,
  isLeaderboardOptedIn,
  leaderboardRank,
  shareMessage,
  profileMessage,
  profileError,
  redesign = false,
  webAccountPreview = false,
  onDraftChange,
  onEditProfile,
  onCopyProfileLink,
  onOpenLeaderboard,
  onSignIn,
}: ProfilePageProps) {
  const { refresh: refreshCard } = card;
  useEffect(() => {
    if (isSignedIn) void refreshCard();
  }, [isSignedIn, refreshCard]);

  const secondaryButtonClassName = "ghost-button profile-btn";

  const profileWindowSection = (
    <section className={`leaderboard-profile-block${redesign ? " profile-card" : ""}`} aria-label="Profile window">
      <div className="profile-window-entry">
        <div className="profile-window-entry__copy">
          <span className="label-mono">Profile</span>
          {profileError ? <p className="capture-recency capture-recency--error">{profileError}</p> : null}
          {profileMessage ? <p className="capture-recency">{profileMessage}</p> : null}
        </div>
        <div className="profile-window-entry__actions">
          <button type="button" className={secondaryButtonClassName} onClick={onEditProfile}>Open profile</button>
        </div>
      </div>

      <div className="profile-window-stack">
        {onDraftChange ? (
          <PublicProfileToggle
            checked={draft.isPublic}
            onChange={(isPublic) => onDraftChange({ isPublic })}
          />
        ) : null}
        <div className="profile-share">
          <div className="profile-share__row profile-share__row--inline" aria-label="Leaderboard participation">
            <span className="label-mono profile-share__rail">Leaderboard</span>
            <span className="profile-share__status">
              {isLeaderboardOptedIn
                ? leaderboardRank !== null
                  ? `On the board · #${leaderboardRank}`
                  : "On the board"
                : "Not on the board — joining is separate from your focus card."}
            </span>
            <button type="button" className={secondaryButtonClassName} onClick={onOpenLeaderboard}>Open leaderboard</button>
          </div>
        </div>
      </div>
    </section>
  );

  const profileStack = (
    <div className={`leaderboard-panel__stack${redesign ? " profile-stack" : ""}`}>
      {profileWindowSection}
      <ProfileEmbedsSection
        card={card}
        dailyProductivity={dailyProductivity}
        displayName={displayName}
        draft={draft}
        focusSeconds7d={focusSeconds7d}
        publicId={publicId}
        redesign={redesign}
        webAccountPreview={webAccountPreview}
        onCopyProfileLink={onCopyProfileLink}
        onEditProfile={onEditProfile}
      />
    </div>
  );

  return (
    <div className={`page profile-page${redesign ? " profile-page--v2" : ""}`}>
      <div className="pg-head">
        <div>
          <h1>Your public profile</h1>
          {redesign ? (
            <p className="profile-page__privacy">
              <span className="profile-page__privacy-tag">Opt-in only</span>
              Just the totals leave your device — daily focus &amp; drift, weekly split. Raw app, site, and window history stays local.
            </p>
          ) : (
            <p className="capture-recency profile-page__privacy">
              Only opt-in aggregates are shared (daily focus/drift totals, weekly split) — raw app, site, window, and session history stays on your device.
            </p>
          )}
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
        profileStack
      )}

      {shareMessage ? <div className="leaderboard-share-toast" role="status">{shareMessage}</div> : null}
    </div>
  );
}
