import { useEffect, useState, type CSSProperties } from "react";
import { formatRoundedDuration } from "../../lib/formatting";
import type { LeaderboardPublicProfileControls } from "../leaderboard/LeaderboardView";
import { ProfileEmbedsModal } from "../profile/ProfileEmbedsModal";
import { ProfileSocialLinks, buildPublicProfileUrl } from "../profile/ProfileModals";
import type { FocusCardDetailFlags } from "../share/focusCardService";

type SocialProfileViewProps = {
  readonly isSignedIn: boolean;
  readonly isSupabaseEnabled: boolean;
  readonly profileDisplayName?: string | null;
  readonly publicProfile?: LeaderboardPublicProfileControls;
  readonly onSignIn: () => void;
};

const DETAIL_SCOPES: ReadonlyArray<{
  readonly key: keyof FocusCardDetailFlags;
  readonly title: string;
  readonly description: string;
}> = [
  {
    key: "shareCategoryBreakdown",
    title: "Category breakdown",
    description: "Optional. Category totals with Focus, Neutral, and Drift. No apps, projects, URLs, or titles.",
  },
  {
    key: "shareHourlyPattern",
    title: "Hourly rhythm",
    description: "Optional. 7-day hourly averages in your local time, never a session timeline.",
  },
];

export function SocialProfileView({
  isSignedIn,
  isSupabaseEnabled,
  profileDisplayName,
  publicProfile,
  onSignIn,
}: SocialProfileViewProps) {
  const [embedsOpen, setEmbedsOpen] = useState(false);
  const [focusSwitchBusy, setFocusSwitchBusy] = useState(false);

  const card = publicProfile?.card;
  const refreshCard = card?.refresh;
  useEffect(() => {
    if (!refreshCard || (!isSignedIn && !publicProfile?.isPreviewProfile)) return;
    void refreshCard();
  }, [isSignedIn, publicProfile?.isPreviewProfile, refreshCard]);

  if (!isSupabaseEnabled) {
    return <SocialAccessState eyebrow="Sync required" title="Social is unavailable" detail="Supabase is not configured for this workspace." />;
  }
  if (!isSignedIn && !publicProfile?.isPreviewProfile) {
    return (
      <SocialAccessState
        eyebrow="Account required"
        title="Create your public presence"
        detail="Sign in to choose what you share and create embeds."
        actionLabel="Sign in"
        onAction={onSignIn}
      />
    );
  }
  if (!publicProfile) {
    return <SocialAccessState eyebrow="Loading" title="Preparing your profile" detail="Checking your current public settings." />;
  }

  const { draft } = publicProfile;
  const displayName = draft.displayName.trim() || profileDisplayName?.trim() || "drifty";
  const profileUrl = publicProfile.publicId ? buildPublicProfileUrl(publicProfile.publicId) : null;
  const focusLive = draft.isPublic && card?.enabled === true;
  const controlsDisabled = publicProfile.profileLoading || publicProfile.profileSaving || publicProfile.isPreviewProfile === true;
  const detailFlags = card?.detailFlags;
  const categoryPreview = card?.previewPayload?.category_breakdown_7d ?? [];
  const hourlyPreview = card?.previewPayload?.hourly_focus_pattern ?? [];
  const dailyPreview = card?.previewPayload?.daily_focus ?? [];
  const detailDisabled = card?.enabled !== true || card.busy || detailFlags === null || publicProfile.isPreviewProfile === true;
  const profileFieldLabels = ["Name"];
  if (draft.avatarUrl.trim()) profileFieldLabels.push("Photo");
  if (draft.bio.trim()) profileFieldLabels.push("Bio");
  if (draft.websiteUrl.trim() || draft.githubUrl.trim() || draft.linkedinUrl.trim()) profileFieldLabels.push("Links");

  const toggleFocus = async (next: boolean) => {
    if (!card || publicProfile.isPreviewProfile) return;
    setFocusSwitchBusy(true);
    try {
      if (!next) {
        await card.disable();
        return;
      }
      if (!publicProfile.publicId) {
        const ready = await publicProfile.onEnsureProfile();
        if (!ready) return;
      }
      await card.enable();
    } finally {
      setFocusSwitchBusy(false);
    }
  };

  return (
    <div className="social-profile-view">
      <section className="social-profile-hero" aria-label="Public profile">
        <div className="social-profile-identity">
          {draft.avatarUrl.trim() ? (
            <img className="social-profile-identity__avatar" src={draft.avatarUrl.trim()} alt="" aria-hidden="true" />
          ) : (
            <span className="social-profile-identity__avatar" aria-hidden="true">{(displayName.charAt(0) || "D").toUpperCase()}</span>
          )}
          <div className="social-profile-identity__copy">
            <div className="social-profile-identity__status-row">
              <span className={`profile-state-pill${draft.isPublic ? " profile-state-pill--on" : ""}`}>
                {draft.isPublic ? "Public" : "Private"}
              </span>
              {publicProfile.publicId ? <span className="label-mono">Link ready</span> : <span className="label-mono">No public link</span>}
            </div>
            <h2>{displayName}</h2>
            <p>{draft.bio.trim() || "Add a short bio to make your public profile feel like yours."}</p>
            <ProfileSocialLinks profile={{ website_url: draft.websiteUrl, github_url: draft.githubUrl, linkedin_url: draft.linkedinUrl }} />
            <button type="button" className="app-btn app-btn--quiet app-btn--compact social-profile-edit" onClick={publicProfile.onEditProfile}>
              <PencilIcon /> Edit profile
            </button>
          </div>
        </div>

        <div className="social-profile-publish">
          <div className="social-profile-publish__heading">
            <div>
              <span className="label-mono">Master visibility</span>
              <strong>Public profile</strong>
            </div>
            <label className="social-switch">
              <input
                type="checkbox"
                role="switch"
                aria-label="Public profile"
                checked={draft.isPublic}
                disabled={controlsDisabled}
                onChange={(event) => void publicProfile.onSetProfileVisibility(event.target.checked)}
              />
              <span aria-hidden="true" />
            </label>
          </div>
          <p>Turn this off to remove your profile and embeds from public responses. Leaderboard participation is separate.</p>
          {profileUrl ? (
            <div className="social-profile-url">
              <span className="social-profile-url__value">{profileUrl}</span>
              <button type="button" className="app-btn app-btn--primary" onClick={publicProfile.onCopyProfileLink}>Copy link</button>
              {draft.isPublic ? <a href={profileUrl} target="_blank" rel="noreferrer" aria-label="Open public profile">↗</a> : null}
            </div>
          ) : (
            <button type="button" className="app-btn app-btn--primary social-profile-setup" disabled={publicProfile.profileSaving} onClick={() => void publicProfile.onEnsureProfile()}>
              {publicProfile.profileSaving ? "Creating…" : "Create public link"}
            </button>
          )}
          <div className="social-profile-publish__actions">
            <button
              type="button"
              className="app-btn app-btn--primary profile-btn hero-action-btn"
              onClick={() => setEmbedsOpen(true)}
            >
              <EmbedIcon />
              Profile embed
            </button>
          </div>
        </div>
      </section>

      <section className="social-public-preview" aria-labelledby="social-public-preview-title">
        <div className="social-public-preview__head">
          <div>
            <span className="label-mono">Visitor view</span>
            <h2 id="social-public-preview-title">Public preview</h2>
          </div>
          <span className={`social-live-state${draft.isPublic ? " social-live-state--on" : ""}`}>
            {draft.isPublic ? "Public" : "Hidden"}
          </span>
        </div>

        {!draft.isPublic ? (
          <p className="social-public-preview__empty">Your profile and every embed are hidden from public responses.</p>
        ) : !focusLive || !card?.previewPayload ? (
          <p className="social-public-preview__empty">Visitors can see your profile details. Turn on Focus summary to add aggregate metrics.</p>
        ) : (
          <div className="social-public-preview__content">
            <div className="social-public-preview__focus">
              <div className="social-public-preview__focus-copy">
                <span className="label-mono">Focus · last 7 days</span>
                <strong>{formatRoundedDuration(card.previewPayload.focus_seconds_7d)}</strong>
                <span>{Math.round(card.previewPayload.focus_share * 100)}% focus share</span>
              </div>
              <dl className="social-public-preview__stats">
                <div><dt>Today</dt><dd>{formatRoundedDuration(card.previewPayload.focus_seconds_today)}</dd></div>
                <div><dt>Neutral</dt><dd>{formatRoundedDuration(card.previewPayload.neutral_seconds_7d)}</dd></div>
                <div><dt>Drift</dt><dd>{formatRoundedDuration(card.previewPayload.drift_seconds_7d)}</dd></div>
              </dl>
              <PublicDailyBars points={dailyPreview} />
            </div>

            {detailFlags?.shareCategoryBreakdown && categoryPreview.length > 0 ? (
              <div className="social-public-preview__module">
                <span className="label-mono">Shared categories</span>
                {categoryPreview.slice(0, 5).map((entry) => (
                  <div key={entry.category} className="social-public-preview__category">
                    <strong>{formatCategory(entry.category)}</strong>
                    <span>F {formatRoundedDuration(entry.focusSeconds)} · N {formatRoundedDuration(entry.neutralSeconds)} · D {formatRoundedDuration(entry.driftSeconds)}</span>
                    <em>{formatRoundedDuration(entry.seconds)}</em>
                  </div>
                ))}
              </div>
            ) : null}

            {detailFlags?.shareHourlyPattern && hourlyPreview.length > 0 ? (
              <div className="social-public-preview__module">
                <span className="label-mono">Shared hourly rhythm</span>
                <PublicHourlyRhythm points={hourlyPreview} />
              </div>
            ) : null}
          </div>
        )}
      </section>

      {publicProfile.profileError || publicProfile.profileMessage || publicProfile.shareMessage ? (
        <div className="social-profile-messages" aria-live="polite">
          {publicProfile.profileError ? <p className="capture-recency capture-recency--error">{publicProfile.profileError}</p> : null}
          {publicProfile.profileMessage ? <p className="capture-recency">{publicProfile.profileMessage}</p> : null}
          {publicProfile.shareMessage ? <p className="capture-recency">{publicProfile.shareMessage}</p> : null}
        </div>
      ) : null}

      <section className="social-section" aria-labelledby="social-sharing-title">
        <div className="social-section__heading">
          <div>
            <span className="label-mono">Privacy controls</span>
            <h2 id="social-sharing-title">What you share</h2>
          </div>
          <p>Public fields and aggregates only. Raw activity stays local.</p>
        </div>

        <div className="social-share-list">
          <div className="social-share-row social-share-row--static">
            <span className="social-share-row__icon"><ProfileIcon /></span>
            <div className="social-share-row__copy">
              <strong>Profile details</strong>
              <p>Only filled fields appear. Remove a field to stop sharing it.</p>
              <div className="social-share-row__chips">{profileFieldLabels.map((label) => <span key={label}>{label}</span>)}</div>
            </div>
            <button type="button" className="app-btn app-btn--quiet app-btn--compact" onClick={publicProfile.onEditProfile}>Edit</button>
          </div>

          <div className="social-share-group">
            <div className="social-share-row">
              <span className="social-share-row__icon"><FocusIcon /></span>
              <div className="social-share-row__copy">
                <div className="social-share-row__title">
                  <strong>Focus summary</strong>
                  <span className={`social-live-state${focusLive ? " social-live-state--on" : ""}`}>
                    {focusLive ? "Live" : card?.enabled === true ? "Hidden" : "Off"}
                  </span>
                </div>
                <p>Today and 7-day Focus, Neutral, Drift, and focus share, plus 30 daily Focus/Drift totals.</p>
                <span className="social-share-row__metric">Last 7 days · {formatRoundedDuration(publicProfile.focusSeconds7d)}</span>
              </div>
              <label className="social-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Focus summary"
                  checked={card?.enabled === true}
                  disabled={!card || card.enabled === null || card.busy || focusSwitchBusy || publicProfile.isPreviewProfile === true}
                  onChange={(event) => void toggleFocus(event.target.checked)}
                />
                <span aria-hidden="true" />
              </label>
            </div>

            <div className={`social-share-details${card?.enabled === true ? " social-share-details--open" : ""}`}>
              <div>
                {DETAIL_SCOPES.map((scope) => (
                  <label key={scope.key} className="social-detail-row">
                    <span>
                      <strong>{scope.title}</strong>
                      <small>{scope.description}</small>
                    </span>
                    <input
                      className="drifty-checkbox"
                      type="checkbox"
                      aria-label={scope.title}
                      checked={detailFlags?.[scope.key] === true}
                      disabled={detailDisabled}
                      onChange={(event) => void card?.setDetailFlag(scope.key, event.target.checked)}
                    />
                  </label>
                ))}
                {categoryPreview.length > 0 ? (
                  <div className="social-category-preview" aria-label="Category aggregate preview">
                    <div className="social-category-preview__head">
                      <span className="label-mono">{detailFlags?.shareCategoryBreakdown ? "Shared aggregate" : "Local preview · not public"}</span>
                      <span>Last 7 days</span>
                    </div>
                    <p className="social-category-preview__note">This preview stays on this computer until you turn on Category breakdown.</p>
                    <div className="social-category-preview__list">
                      {categoryPreview.slice(0, 6).map((entry) => (
                        <div key={entry.category} className="social-category-preview__row">
                          <strong>{formatCategory(entry.category)}</strong>
                          <span className="social-category-preview__mix">
                            <i className="social-category-preview__dot social-category-preview__dot--focus" />F {formatRoundedDuration(entry.focusSeconds)}
                            <i className="social-category-preview__dot" />N {formatRoundedDuration(entry.neutralSeconds)}
                            <i className="social-category-preview__dot social-category-preview__dot--drift" />D {formatRoundedDuration(entry.driftSeconds)}
                          </span>
                          <span>{formatRoundedDuration(entry.seconds)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

        </div>
        {card?.error ? <p className="capture-recency capture-recency--error">{card.error}</p> : null}
      </section>

      {embedsOpen ? (
        <ProfileEmbedsModal
          card={publicProfile.card}
          dailyProductivity={publicProfile.dailyProductivity}
          displayName={displayName}
          draft={draft}
          focusSeconds7d={publicProfile.focusSeconds7d}
          initialFormat="card"
          isProfilePublic={draft.isPublic}
          publicId={publicProfile.publicId}
          onClose={() => setEmbedsOpen(false)}
          onCopyProfileLink={publicProfile.onCopyProfileLink}
          onEditProfile={publicProfile.onEditProfile}
        />
      ) : null}
    </div>
  );
}

function SocialAccessState({ eyebrow, title, detail, actionLabel, onAction }: { eyebrow: string; title: string; detail: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="empty-state leaderboard-state social-access-state">
      <span className="eyebrow">{eyebrow}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {actionLabel && onAction ? <button type="button" className="app-btn app-btn--primary" onClick={onAction}>{actionLabel}</button> : null}
    </div>
  );
}

function PencilIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5 6 14.1 15.9 4.2a2.1 2.1 0 0 1 3 0l.9.9a2.1 2.1 0 0 1 0 3L9.9 18 4.5 19.5Z" /><path d="m14.5 5.6 3.9 3.9" /></svg>;
}

function ProfileIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4" /><path d="M5 20v-.6a5.5 5.5 0 0 1 5.5-5.5h3a5.5 5.5 0 0 1 5.5 5.5v.6" /></svg>;
}

function FocusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>;
}

function EmbedIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8 4 12l4 4M16 8l4 4-4 4M13.5 5 10.5 19" /></svg>;
}

function formatCategory(category: string) {
  return category.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function PublicDailyBars({ points }: { points: readonly { day: string; focus: number; drift: number }[] }) {
  const visiblePoints = points.slice(-30);
  const maxSeconds = Math.max(1, ...visiblePoints.map((point) => Math.max(0, point.focus) + Math.max(0, point.drift)));
  return (
    <div className="social-public-preview__chart" role="img" aria-label="30-day public Focus and Drift trend">
      {visiblePoints.map((point) => (
        <span
          key={point.day}
          className="social-public-preview__bar"
          title={`${point.day}: Focus ${formatRoundedDuration(point.focus)}, Drift ${formatRoundedDuration(point.drift)}`}
          style={{
            "--preview-focus-height": `${Math.round((Math.max(0, point.focus) / maxSeconds) * 100)}%`,
            "--preview-drift-height": `${Math.round((Math.max(0, point.drift) / maxSeconds) * 100)}%`,
          } as CSSProperties}
        >
          <i className="social-public-preview__bar-focus" />
          <i className="social-public-preview__bar-drift" />
        </span>
      ))}
    </div>
  );
}

function PublicHourlyRhythm({ points }: { points: readonly { hour: number; focusSeconds: number }[] }) {
  const maxSeconds = Math.max(1, ...points.map((point) => Math.max(0, point.focusSeconds)));
  return (
    <div className="social-public-preview__hours" role="img" aria-label="Public 7-day hourly Focus averages">
      {points.map((point) => (
        <i
          key={point.hour}
          title={`${point.hour}:00 · ${formatRoundedDuration(point.focusSeconds)} average Focus`}
          style={{ opacity: 0.12 + (Math.max(0, point.focusSeconds) / maxSeconds) * 0.88 }}
        />
      ))}
    </div>
  );
}
