import { useMemo, useState, type ReactNode } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { formatLocalizedDuration } from "../../lib/formatting";
import { buildPublicProfileUrl, normalizeExternalUrl, type ProfileDraft } from "../profile/ProfileModals";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import { ShareCardModal } from "../share/ShareCardModal";
import type { ShareCardTheme } from "../share/shareCardSvg";
import type { FocusCardControls } from "../share/useFocusCard";
import { LeaderboardBoard } from "./LeaderboardBoard";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { ProfileAvatar, StateBlock } from "./leaderboardViewHelpers";
import { RankEmbedsModal } from "./RankEmbedsModal";
import { buildLeaderboardShareCard, leaderboardShareStoryIds } from "./leaderboardShareCard";
import { ModalPresence } from "../../components/ModalPresence";
import { useLocalization } from "../localization/LocalizationContext";
import { LeaderboardSparkline } from "./LeaderboardSparkline";
import { formatPreciseTopPercentile, getPreciseTopPercentile } from "./leaderboardStanding";
import { trailingFocusStreakDays, weekOverWeekDeltaPercent } from "./leaderboardRailMetrics";

export type LeaderboardPublicProfileControls = {
  readonly card: FocusCardControls;
  readonly dailyProductivity: readonly DailyProductivityPoint[] | null;
  readonly draft: ProfileDraft;
  readonly focusSeconds7d: number;
  readonly isPreviewProfile?: boolean;
  readonly localMetricsStatus?: "loading" | "ready" | "error";
  readonly profileError: string | null;
  readonly profileLoading: boolean;
  readonly profileMessage: string | null;
  readonly profileSaving: boolean;
  readonly publicId: string | null;
  readonly shareMessage: string | null;
  readonly onCopyProfileLink: () => void;
  readonly onEditProfile: () => void;
  readonly onEnsureProfile: () => Promise<boolean>;
  /** What the Share card sheet needs beyond the rail's own data; Share stays hidden without it. */
  readonly shareCard?: LeaderboardShareCardContext;
};

export type LeaderboardShareCardContext = {
  readonly accountScope: string | null;
  /** Same key the dashboard sheet uses, so both share one live-rank cache entry. */
  readonly comparisonWindowKey: string;
  readonly theme: ShareCardTheme;
  /** Logical today; the leaderboard windows end on this day. */
  readonly windowEndDay: string;
  readonly onJoinLeaderboard: () => Promise<void>;
};

export type LeaderboardViewProps = {
  isSupabaseEnabled: boolean;
  isSignedIn: boolean;
  isLoading?: boolean;
  error?: string | null;
  isOptedIn: boolean;
  /**
   * False while participation is still unknown (e.g. session restore). The
   * participation controls hold their space instead of asserting "not joined".
   */
  isParticipationResolved?: boolean;
  ownRank?: number | null;
  ownParticipantCount?: number | null;
  publiclyValid?: boolean | null;
  activePeriod?: LeaderboardPeriod;
  leaderboard?: LeaderboardRow[];
  ownFocusSeconds?: number | null;
  totalFocusSeconds7d?: number;
  profileDisplayName?: string | null;
  email?: string | null;
  isActionLoading?: boolean;
  isCatchingUp?: boolean;
  actionError?: string | null;
  publicProfile?: LeaderboardPublicProfileControls;
  statusMessage?: string | null;
  statusTone?: "error" | "neutral";
  onOptIn?: () => void;
  onSignIn?: () => void;
  onOptOut?: () => void;
  onPeriodChange?: (period: LeaderboardPeriod) => void;
  onSelectProfile?: (row: LeaderboardRow) => void;
  /** Dev-only sparkline. Production callers leave this unset / "off". */
};

export function LeaderboardView({
  isSupabaseEnabled,
  isSignedIn,
  isLoading = false,
  error = null,
  isOptedIn,
  isParticipationResolved = true,
  ownRank = null,
  ownParticipantCount = null,
  publiclyValid = null,
  activePeriod = "weekly",
  leaderboard = [],
  ownFocusSeconds = null,
  totalFocusSeconds7d = 0,
  profileDisplayName = null,
  email = null,
  isActionLoading = false,
  isCatchingUp = false,
  actionError = null,
  publicProfile,
  statusMessage = null,
  statusTone = "neutral",
  onOptIn,
  onSignIn,
  onOptOut,
  onPeriodChange,
  onSelectProfile,
}: LeaderboardViewProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [searchQuery, setSearchQuery] = useState("");
  const [rankEmbedOpen, setRankEmbedOpen] = useState(false);
  const [shareCardOpen, setShareCardOpen] = useState(false);
  const previewName = resolvePublicNamePreview(profileDisplayName, email, effectiveLanguage);
  // Display names are intentionally non-unique. Only the authenticated own-entry
  // RPC rank may associate a public row with this account.
  const matchedOwnRow = ownRank === null
    ? undefined
    : leaderboard.find((row) => row.rank === ownRank);
  const currentUserRank = isOptedIn ? ownRank ?? matchedOwnRow?.rank ?? null : null;
  const trimmedSearchQuery = searchQuery.trim().toLowerCase();
  const profileDraft = publicProfile?.draft ?? null;
  const profileAvatarUrl = profileDraft?.avatarUrl.trim() ?? "";
  const previewBio = profileDraft?.bio?.trim() ?? "";
  const editProfile = publicProfile?.onEditProfile ?? null;
  const weekFocusSeconds = publicProfile?.focusSeconds7d ?? 0;
  const dailyAverageSeconds = Math.round(weekFocusSeconds / 7);
  const dailyProductivity = publicProfile?.dailyProductivity ?? null;
  const sparklinePoints = useMemo(
    () => (dailyProductivity ?? []).slice(-7).map((point) => ({ day: point.day, focus: point.focus })),
    [dailyProductivity],
  );
  const showSparkline = sparklinePoints.length >= 2;
  // A failed join/leave reads in the privacy line beside the button, so the board below never moves.
  const showActionError = !isLoading && Boolean(actionError);
  const last30FocusSeconds = (dailyProductivity ?? []).reduce((sum, point) => sum + Math.max(0, point.focus), 0);
  const localMetricsStatus = publicProfile?.localMetricsStatus ?? "ready";
  // The 30-day series arrives after the tab opens. The split rail keeps the chart's
  // footprint until then so the rows below do not slide down when it lands.
  const sparklinePending = dailyProductivity === null && localMetricsStatus !== "error";
  const localMetricsStatusMessage = localMetricsStatus === "loading"
    ? t("leaderboard.calculatingLocal")
    : localMetricsStatus === "error"
      ? t("leaderboard.localUnavailable")
      : dailyProductivity === null
        ? t("leaderboard.calculatingThirtyDays")
        : null;
  const socialPills = buildSocialPills(profileDraft).map((pill) => pill.key === "website" ? { ...pill, label: t("dashboard.today.website") } : pill);
  const filteredLeaderboard = useMemo(() => {
    if (!trimmedSearchQuery) return leaderboard;
    return leaderboard.filter((row) => row.display_name.toLowerCase().includes(trimmedSearchQuery) || String(row.rank).includes(trimmedSearchQuery));
  }, [leaderboard, trimmedSearchQuery]);
  const shareContext = publicProfile?.shareCard ?? null;
  // The card is assembled only while the sheet is open, from the same daily
  // aggregates the rail charts; it never reads activity rows. If that series is
  // still loading or failed, a ranked member can still share the place card.
  const shareHasRank = isOptedIn && ownRank !== null && publiclyValid !== false;
  const shareHasSeries = dailyProductivity !== null;
  const shareAvailable = shareHasSeries || shareHasRank;
  // Depend on the window end only: the context object also carries callbacks
  // that change with profile state and would rebuild an open card.
  const shareWindowEndDay = shareContext?.windowEndDay ?? null;
  const shareCard = useMemo(() => (
    shareCardOpen && shareWindowEndDay && shareAvailable
      ? buildLeaderboardShareCard({ period: activePeriod, windowEndDay: shareWindowEndDay, dailyProductivity: dailyProductivity ?? [] })
      : null
  ), [activePeriod, dailyProductivity, shareAvailable, shareCardOpen, shareWindowEndDay]);
  const shareStoryIds = useMemo(
    () => (shareCard ? leaderboardShareStoryIds(shareCard, shareHasRank, shareHasSeries) : undefined),
    [shareCard, shareHasRank, shareHasSeries],
  );
  const profileLinkUrl = publicProfile?.publicId && publicProfile.draft.isPublic
    ? buildPublicProfileUrl(publicProfile.publicId)
    : null;

  if (!isSupabaseEnabled) {
    return <section className="leaderboard-panel" aria-label={t("leaderboard.title")}><StateBlock eyebrow={t("leaderboard.syncRequired")} title={t("leaderboard.unavailable")} detail={t("leaderboard.unavailableDetail")} /></section>;
  }
  if (error && !isLoading) {
    return <section className="leaderboard-panel" aria-label={t("leaderboard.title")}><StateBlock eyebrow={t("leaderboard.fetchError")} title={t("leaderboard.loadError")} detail={error} /></section>;
  }

  const resolvedOwnFocusSeconds = ownFocusSeconds
    ?? matchedOwnRow?.focus_seconds
    ?? (activePeriod === "weekly" ? publicProfile?.focusSeconds7d ?? 0 : 0);
  const participantCount = resolveParticipantCount(leaderboard, ownParticipantCount, currentUserRank);
  const publicRankReady = Boolean(publicProfile?.publicId && publicProfile.draft.isPublic && currentUserRank !== null);
  const topPercent = currentUserRank === null ? null : getPreciseTopPercentile(currentUserRank, participantCount);
  const weekDeltaPercent = weekOverWeekDeltaPercent(dailyProductivity);
  const weekDeltaLabel = weekDeltaPercent === null
    ? null
    : `${weekDeltaPercent > 0 ? "+" : ""}${weekDeltaPercent}%`;
  const streakDays = trailingFocusStreakDays(dailyProductivity);
  const weekFocusLabel = localMetricsStatus === "ready"
    ? formatLocalizedDuration(weekFocusSeconds, effectiveLanguage)
    : "—";
  const dailyAverageLabel = localMetricsStatus === "ready"
    ? formatLocalizedDuration(dailyAverageSeconds, effectiveLanguage)
    : "—";
  const numberLocale = effectiveLanguage === "ko" ? "ko-KR" : "en-US";
  const participantCountLabel = participantCount === null ? null : participantCount.toLocaleString(numberLocale);
  const periodRankKey = activePeriod === "daily"
    ? "leaderboard.dailyRank"
    : activePeriod === "monthly"
      ? "leaderboard.monthlyRank"
      : "leaderboard.weeklyRank";
  const last30Label = dailyProductivity !== null
    ? formatLocalizedDuration(last30FocusSeconds, effectiveLanguage)
    : "—";
  const participationStatus = !isParticipationResolved
    ? t("leaderboard.checkingStatus")
    : isOptedIn
      ? publiclyValid === false
        ? t("leaderboard.validationFailed")
        : currentUserRank !== null
          ? `#${currentUserRank}`
          : t("leaderboard.onBoard")
      : t("leaderboard.notOnBoard");
  const railLinks = socialPills.map((pill) => {
    const raw = pill.key === "website"
      ? profileDraft?.websiteUrl ?? ""
      : pill.key === "github"
        ? profileDraft?.githubUrl ?? ""
        : profileDraft?.linkedinUrl ?? "";
    return {
      ...pill,
      label: pill.key === "website"
        ? raw.replace(/^https?:\/\//, "").replace(/\/$/, "")
        : formatSocialDisplay(raw),
    };
  });

  return (
    <section className="leaderboard-panel" aria-label={t("leaderboard.title")} aria-busy={isLoading || undefined}>
      <div className={`leaderboard-panel__stack${isLoading ? " leaderboard-loading-shell" : ""}`}>
        <div className="leaderboard-split lb-v2">
          <section className="leaderboard-profile-block" aria-label={t("leaderboard.participationAria")} aria-hidden={isLoading || undefined}>
            <section className="leaderboard-hero" aria-label={t("leaderboard.yourParticipationAria")}>
              <div className="leaderboard-hero__identity-row">
                <ProfileAvatar
                  className="leaderboard-hero__avatar"
                  name={previewName}
                  src={profileAvatarUrl || null}
                  style={{ width: 96, height: 96, borderRadius: "50%", fontSize: "2rem" }}
                />
                <div className="leaderboard-hero__identity-copy">
                  <h3 title={previewName}>{previewName}</h3>
                  <span
                    className={`leaderboard-hero__status${isOptedIn && publiclyValid !== false ? " leaderboard-hero__status--live" : ""}${isOptedIn && publiclyValid === false ? " leaderboard-hero__status--fail" : ""}${isParticipationResolved ? "" : " leaderboard-hero__status--pending"}`}
                  >
                    {participationStatus}
                  </span>
                </div>
                {editProfile ? (
                  <button
                    type="button"
                    className="leaderboard-profile-edit-button"
                    aria-label={t("leaderboard.editProfileAria")}
                    onClick={editProfile}
                  >
                    <PencilIcon />
                  </button>
                ) : null}
              </div>

              {previewBio || railLinks.length > 0 ? (
                <div className="leaderboard-v5-profile-details">
                  {previewBio ? (
                    <p className="leaderboard-v5-profile-details__bio">
                      {previewBio}
                    </p>
                  ) : null}
                  {railLinks.length > 0 ? (
                    <div className="leaderboard-v5-profile-details__links">
                      {railLinks.map((link) => (
                        <a
                          key={link.key}
                          className="leaderboard-v5-profile-details__link"
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={link.label}
                        >
                          {link.icon}
                          <span>{link.label}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="leaderboard-hero__rail-actions">
                <div className="leaderboard-hero__participation-slot">
                  {!isParticipationResolved ? (
                    <span
                      className="leaderboard-hero__participation-placeholder"
                      role="status"
                      aria-label={t("leaderboard.checkingParticipationAria")}
                    />
                  ) : isOptedIn ? (
                    <button
                      type="button"
                      className="app-btn app-btn--danger leaderboard-hero__participation leaderboard-hero__participation--danger profile-btn hero-action-btn"
                      aria-describedby="leaderboard-participation-privacy"
                      onClick={() => {
                        onOptOut?.();
                      }}
                      disabled={isActionLoading || isLoading || !onOptOut}
                    >
                      <ActionLabel busy={isActionLoading} busyLabel={t("leaderboard.leaving")}>{t("leaderboard.leave")}</ActionLabel>
                    </button>
                  ) : isCatchingUp ? (
                    <button
                      type="button"
                      className="app-btn app-btn--primary leaderboard-hero__participation leaderboard-hero__participation--join profile-btn hero-action-btn"
                      aria-describedby="leaderboard-participation-privacy"
                      title={t("leaderboard.catchingUpTitle")}
                      disabled
                    >
                      {t("leaderboard.catchingUp")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="app-btn app-btn--primary leaderboard-hero__participation leaderboard-hero__participation--join profile-btn hero-action-btn"
                      aria-describedby="leaderboard-participation-privacy"
                      title={t("leaderboard.joinTitle")}
                      onClick={() => (isSignedIn ? onOptIn?.() : onSignIn?.())}
                      disabled={isActionLoading || isLoading || (isSignedIn ? !onOptIn : !onSignIn)}
                    >
                      <ActionLabel busy={isActionLoading} busyLabel={t("leaderboard.joining")}>{t("leaderboard.join")}</ActionLabel>
                    </button>
                  )}
                </div>
                <div className="leaderboard-hero__share-actions">
                  <button
                    type="button"
                    className="app-btn app-btn--secondary profile-btn hero-action-btn hero-action-btn--mono"
                    onClick={() => setRankEmbedOpen(true)}
                    title={!publicRankReady ? t("leaderboard.embedDisabledTitle") : undefined}
                  >
                    <EmbedIcon />
                    {t("leaderboard.embed")}
                  </button>
                  {!isParticipationResolved ? (
                    <span className="leaderboard-hero__participation-placeholder leaderboard-hero__participation-placeholder--share" aria-hidden="true" />
                  ) : isOptedIn && shareContext ? (
                    <button
                      type="button"
                      className="app-btn app-btn--quiet profile-btn hero-action-btn"
                      aria-haspopup="dialog"
                      disabled={!shareAvailable}
                      title={!shareAvailable ? t("leaderboard.calculatingThirtyDays") : undefined}
                      onClick={() => setShareCardOpen(true)}
                    >
                      <ShareIcon />
                      {t("leaderboard.share")}
                    </button>
                  ) : null}
                </div>
              </div>
              {showActionError ? (
                <p key="error" id="leaderboard-participation-privacy" className="leaderboard-hero__privacy-note leaderboard-hero__privacy-note--error" role="alert">
                  {actionError}
                </p>
              ) : (
                <p key="privacy" id="leaderboard-participation-privacy" className="leaderboard-hero__privacy-note">
                  {t("leaderboard.privacy")}
                </p>
              )}
              {!isLoading && !isOptedIn && isCatchingUp && !actionError ? (
                <p className="capture-recency" role="status">{t("leaderboard.catchingUpNotice")}</p>
              ) : null}
              {!isLoading && (publicProfile?.profileError || publicProfile?.profileMessage) ? (
                <div className="leaderboard-public-profile__messages">
                  {publicProfile.profileError ? <p className="capture-recency capture-recency--error">{publicProfile.profileError}</p> : null}
                  {publicProfile.profileMessage ? <p className="capture-recency">{publicProfile.profileMessage}</p> : null}
                </div>
              ) : null}

              <div className="leaderboard-hero__insights">
                <div
                  aria-label={t("leaderboard.focusTotalsAria")}
                  className="leaderboard-hero__totals-row"
                >
                  <div className="leaderboard-hero__focus-stat">
                    <div className="focus-stat__header">
                      <span className="label-mono">{t("leaderboard.focusThisWeek")}</span>
                      {weekDeltaLabel ? (
                        <span className={`focus-stat__subtrend${weekDeltaPercent !== null && weekDeltaPercent < 0 ? " focus-stat__subtrend--down" : ""}`}>
                          {t("leaderboard.vsLastWeek", { delta: weekDeltaLabel })}
                        </span>
                      ) : null}
                    </div>
                    <div className="focus-stat__num-wrap">
                      <strong>{weekFocusLabel}</strong>
                    </div>
                    {showSparkline ? (
                      <div className="focus-stat__chart-full" aria-label={t("leaderboard.weekSparklineAria")}>
                        <LeaderboardSparkline
                          points={sparklinePoints}
                          variant="default"
                          language={effectiveLanguage}
                          ariaLabel={t("leaderboard.weekSparklineAria")}
                        />
                      </div>
                    ) : sparklinePending ? (
                      <div className="focus-stat__chart-full" aria-hidden="true">
                        <div className="leaderboard-sparkline">
                          <span className="leaderboard-sparkline__plot leaderboard-sparkline__plot--pending" />
                          <span className="leaderboard-sparkline__axis">{"\u00A0"}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {topPercent !== null && currentUserRank !== null ? (
                    <section
                      className="leaderboard-v5-achievement"
                      aria-label={`${t("leaderboard.communityStanding")} ${t("leaderboard.topPercent", { percent: formatPreciseTopPercentile(topPercent) })}, ${t(periodRankKey, { rank: String(currentUserRank) })}`}
                    >
                      <span className="leaderboard-v5-achievement__eyebrow">{t("leaderboard.communityStanding")}</span>
                      <strong>{t("leaderboard.topPercent", { percent: formatPreciseTopPercentile(topPercent) })}</strong>
                      <span className="leaderboard-v5-achievement__meta">
                        <b>{t(periodRankKey, { rank: String(currentUserRank) })}</b>
                        {participantCount !== null ? (
                          <>
                            <i aria-hidden="true" />
                            <span>{t("leaderboard.participantCount", { count: participantCountLabel ?? "" })}</span>
                          </>
                        ) : null}
                      </span>
                    </section>
                  ) : isOptedIn && isLoading ? (
                    <section className="leaderboard-v5-achievement" aria-hidden="true">
                      <span className="leaderboard-v5-achievement__eyebrow">{t("leaderboard.communityStanding")}</span>
                      <strong>{"\u00A0"}</strong>
                      <span className="leaderboard-v5-achievement__meta">{"\u00A0"}</span>
                    </section>
                  ) : isOptedIn ? (
                    <section className="leaderboard-v5-achievement" aria-label={t("leaderboard.notRanked")}>
                      <span className="leaderboard-v5-achievement__eyebrow">{t("leaderboard.communityStanding")}</span>
                      <strong>{t("leaderboard.notRanked")}</strong>
                    </section>
                  ) : null}

                  <div className="leaderboard-hero__focus-stat">
                    <span className="label-mono">{t("leaderboard.dailyAverage")}</span>
                    <strong>{dailyAverageLabel}</strong>
                  </div>

                  <div className="leaderboard-hero__focus-stat">
                    <span className="label-mono">{t("leaderboard.lastThirtyDays")}</span>
                    <strong>{last30Label}</strong>
                  </div>

                  {streakDays > 0 ? (
                    <div className="leaderboard-hero__focus-stat leaderboard-v5-streak">
                      <span className="label-mono">{t("leaderboard.focusStreak")}</span>
                      <strong>{t("leaderboard.streakDays", { count: String(streakDays) })}</strong>
                    </div>
                  ) : null}
                  {localMetricsStatusMessage ? (
                    <p className="leaderboard-hero__metrics-status" role="status">{localMetricsStatusMessage}</p>
                  ) : null}
                </div>
              </div>
            </section>
          </section>

          <LeaderboardBoard
            activePeriod={activePeriod}
            currentUserRank={currentUserRank}
            filteredLeaderboard={filteredLeaderboard}
            isLoading={isLoading}
            isOptedIn={isOptedIn}
            leaderboard={leaderboard}
            participantCount={participantCount}
            searchQuery={searchQuery}
            statusMessage={statusMessage}
            statusTone={statusTone}
            topScopeFocusSeconds={totalFocusSeconds7d}
            onPeriodChange={onPeriodChange}
            onSearchQueryChange={setSearchQuery}
            onSelectProfile={onSelectProfile}
          />
        </div>
      </div>

      <ModalPresence>
        {!isLoading && publicProfile && rankEmbedOpen ? (
        <RankEmbedsModal
          avatarUrl={profileAvatarUrl}
          displayName={previewName}
          focusSeconds={resolvedOwnFocusSeconds}
          isProfilePublic={publicProfile.draft.isPublic}
          isRanked={currentUserRank !== null}
          period={activePeriod}
          publicId={publicProfile.publicId}
          rank={currentUserRank}
          onClose={() => setRankEmbedOpen(false)}
        />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {!isLoading && shareCard && shareContext ? (
          <ShareCardModal
            key={`${shareContext.accountScope ?? "signed-out"}:${shareCard.kind}`}
            card={shareCard}
            defaultTheme={shareContext.theme}
            accountScope={shareContext.accountScope}
            comparisonWindowKey={shareContext.comparisonWindowKey}
            storyIds={shareStoryIds}
            profileLinkUrl={profileLinkUrl}
            onJoinLeaderboard={shareContext.onJoinLeaderboard}
            onClose={() => setShareCardOpen(false)}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}

function resolveParticipantCount(rows: readonly LeaderboardRow[], ownParticipantCount: number | null, ownRank: number | null): number | null {
  const reportedCounts = [ownParticipantCount, ...rows.map((row) => row.participant_count)]
    .filter((count): count is number => typeof count === "number" && Number.isFinite(count) && count >= 0);
  if (reportedCounts.length === 0) return null;

  const resolved = Math.max(...reportedCounts);
  const observedMinimum = Math.max(ownRank ?? 0, ...rows.map((row) => row.rank));
  return resolved < observedMinimum ? null : resolved;
}

function resolvePublicNamePreview(profileDisplayName?: string | null, email?: string | null, language: "en" | "ko" = "en") {
  const trimmedName = profileDisplayName?.trim();
  if (trimmedName) return trimmedName;
  const emailPrefix = email?.split("@")[0]?.trim();
  return emailPrefix || (language === "ko" ? "멤버" : "member");
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

function formatSocialDisplay(raw: string): string {
  const stripped = raw.replace(/^https?:\/\//, "").replace(/^(github\.com\/|linkedin\.com\/in\/)/, "").replace(/\/$/, "");
  return stripped.startsWith("@") ? stripped : `@${stripped}`;
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.5-1 1.8-2 3.7-2 3.9 0 4.6 2.6 4.6 5.9V21h-4v-5.3c0-1.3 0-2.9-1.8-2.9s-2 1.4-2 2.8V21H9z" />
    </svg>
  );
}
