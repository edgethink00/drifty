import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatLocalizedDuration } from "../../lib/formatting";
import { normalizeExternalUrl, openPublicProfilePage, type ProfileDraft } from "../profile/ProfileModals";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import type { FocusCardControls } from "../share/useFocusCard";
import { LeaderboardBoard } from "./LeaderboardBoard";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { ProfileAvatar, StateBlock } from "./leaderboardViewHelpers";
import { RankEmbedsModal } from "./RankEmbedsModal";
import { ModalPresence } from "../../components/ModalPresence";
import { useLocalization } from "../localization/LocalizationContext";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { LeaderboardSparkline } from "./LeaderboardSparkline";
import { DEFAULT_LEADERBOARD_GRAPH_STYLE, type LeaderboardGraphStyle } from "./leaderboardGraphStyle";

export type LeaderboardPublicProfileControls = {
  readonly card: FocusCardControls;
  readonly dailyProductivity: readonly DailyProductivityPoint[] | null;
  readonly draft: ProfileDraft;
  readonly focusSeconds7d: number;
  readonly isPreviewProfile?: boolean;
  /** True whenever `is_public` keeps the profile page live while the user is off the board. */
  readonly liveOffBoard?: boolean;
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
  readonly onSetProfileVisibility: (isPublic: boolean) => Promise<boolean>;
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
  onOptOut?: (options?: { readonly makeProfilePrivate?: boolean }) => void;
  onPeriodChange?: (period: LeaderboardPeriod) => void;
  onSelectProfile?: (row: LeaderboardRow) => void;
  /** Dev-only sparkline. Production callers leave this unset / "off". */
  graphStyle?: LeaderboardGraphStyle;
  previewLayout?: "stack" | "split-v2";
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
  graphStyle = DEFAULT_LEADERBOARD_GRAPH_STYLE,
  previewLayout = "stack",
}: LeaderboardViewProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [searchQuery, setSearchQuery] = useState("");
  const [rankEmbedOpen, setRankEmbedOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaveMakePrivate, setLeaveMakePrivate] = useState(true);
  // Confirm only when a public page actually exists. A first-run draft defaults
  // isPublic true, and that must not put a hide-profile checkbox on leave.
  const publicProfileIsOn = Boolean(publicProfile?.publicId) && publicProfile?.draft.isPublic === true;
  const closeLeaveConfirm = useCallback(() => setLeaveConfirmOpen(false), []);
  useModalDismiss(closeLeaveConfirm, { disabled: !leaveConfirmOpen || !publicProfileIsOn });
  useEffect(() => {
    if (publicProfileIsOn) return;
    setLeaveConfirmOpen(false);
  }, [publicProfileIsOn]);
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
  const previewBio = profileDraft?.bio?.trim()
    || (previewLayout === "split-v2" ? "깊게 몰입하고, 매일 조금씩 더 나은 흐름을 만듭니다." : "");
  const previewWebsite = profileDraft?.websiteUrl?.trim()
    || (previewLayout === "split-v2" ? "member.dev" : "");
  const previewSocial = profileDraft?.githubUrl?.trim()
    || profileDraft?.linkedinUrl?.trim()
    || (previewLayout === "split-v2" ? "@member" : "");
  // Captured out of the closure so the open-page button keeps its non-null narrowing.
  const publicPageId = publicProfile?.publicId ?? null;
  const editProfile = publicProfile?.onEditProfile ?? null;
  const weekFocusSeconds = publicProfile?.focusSeconds7d ?? 0;
  const dailyAverageSeconds = Math.round(weekFocusSeconds / 7);
  const dailyProductivity = publicProfile?.dailyProductivity ?? null;
  const sparklinePoints = useMemo(
    () => (dailyProductivity ?? []).slice(-7).map((point) => ({ day: point.day, focus: point.focus })),
    [dailyProductivity],
  );
  const showSparkline = (previewLayout === "split-v2" || graphStyle !== "off") && sparklinePoints.length >= 2;
  const sparklineVariant: Exclude<LeaderboardGraphStyle, "off"> = graphStyle === "off" ? "default" : graphStyle;
  const last30FocusSeconds = (dailyProductivity ?? []).reduce((sum, point) => sum + Math.max(0, point.focus), 0);
  const localMetricsStatus = publicProfile?.localMetricsStatus ?? "ready";
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

  return (
    <section className="leaderboard-panel" aria-label={t("leaderboard.title")} aria-busy={isLoading || undefined}>
      <div className={`leaderboard-panel__stack${isLoading ? " leaderboard-loading-shell" : ""}`}>
        {previewLayout === "split-v2" ? (
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
                    <h3>{previewName}</h3>
                    <span
                      className={`leaderboard-hero__status${isOptedIn && publiclyValid !== false ? " leaderboard-hero__status--live" : ""}${isOptedIn && publiclyValid === false ? " leaderboard-hero__status--fail" : ""}`}
                    >
                      {currentUserRank !== null ? `#${currentUserRank}` : t("leaderboard.onBoard")}
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

                <div className="leaderboard-v5-profile-details">
                  <p className="leaderboard-v5-profile-details__bio">
                    {previewBio}
                  </p>
                  <div className="leaderboard-v5-profile-details__links">
                    <a
                      className="leaderboard-v5-profile-details__link"
                      href={normalizeExternalUrl(previewWebsite) || "#"}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`웹사이트 ${previewWebsite}`}
                    >
                      <WebsiteIcon />
                      <span>{previewWebsite}</span>
                    </a>
                    <a
                      className="leaderboard-v5-profile-details__link"
                      href={normalizeExternalUrl(previewSocial) || "#"}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`소셜 프로필 ${previewSocial}`}
                    >
                      <LinkChainIcon />
                      <span>{formatSocialDisplay(previewSocial)}</span>
                    </a>
                  </div>
                </div>

                <div className="leaderboard-hero__rail-actions">
                  <div className="leaderboard-hero__participation-slot">
                    <button
                      type="button"
                      className="app-btn app-btn--danger leaderboard-hero__participation leaderboard-hero__participation--danger profile-btn hero-action-btn"
                      aria-describedby="leaderboard-participation-privacy"
                      onClick={() => onOptOut?.()}
                    >
                      {isOptedIn ? t("leaderboard.leave") : t("leaderboard.join")}
                    </button>
                  </div>
                  <div className="leaderboard-hero__share-actions">
                    <button
                      type="button"
                      className="app-btn app-btn--secondary profile-btn hero-action-btn hero-action-btn--mono"
                      onClick={() => setRankEmbedOpen(true)}
                    >
                      <EmbedIcon />
                      {t("leaderboard.embed")}
                    </button>
                    <button
                      type="button"
                      className="app-btn app-btn--quiet profile-btn hero-action-btn"
                      onClick={publicProfile?.onCopyProfileLink}
                    >
                      <ShareIcon />
                      {t("leaderboard.share")}
                    </button>
                  </div>
                </div>
                <p id="leaderboard-participation-privacy" className="leaderboard-hero__privacy-note">
                  {t("leaderboard.privacy")}
                </p>

                <div className="leaderboard-hero__insights">
                  <div
                    aria-label={t("leaderboard.focusTotalsAria")}
                    className="leaderboard-hero__totals-row"
                  >
                    <div className="leaderboard-hero__focus-stat">
                      <div className="focus-stat__header">
                        <span className="label-mono">{t("leaderboard.focusThisWeek")}</span>
                        <span className="focus-stat__subtrend">+18% vs 지난주</span>
                      </div>
                      <div className="focus-stat__num-wrap">
                        <strong>{localMetricsStatus === "ready" ? formatLocalizedDuration(weekFocusSeconds, effectiveLanguage) : (weekFocusSeconds > 0 ? formatLocalizedDuration(weekFocusSeconds, effectiveLanguage) : "25시간 6분")}</strong>
                      </div>
                      <div className="focus-stat__chart-full" aria-label={t("leaderboard.weekSparklineAria")}>
                        <LeaderboardSparkline
                          points={sparklinePoints}
                          variant={sparklineVariant}
                          language={effectiveLanguage}
                          ariaLabel={t("leaderboard.weekSparklineAria")}
                        />
                      </div>
                    </div>

                    <section className="leaderboard-v5-achievement" aria-label="전체 사용자 기준 TOP 0.001%, 주간 6위">
                      <span className="leaderboard-v5-achievement__eyebrow">전체 사용자 기준</span>
                      <strong>TOP 0.001%</strong>
                      <span className="leaderboard-v5-achievement__meta">
                        <b>주간 #{currentUserRank ?? 6}</b>
                        <i aria-hidden="true" />
                        <span>{participantCount ?? 50}명 참여</span>
                        <span className="leaderboard-v5-achievement__delta">↑ 4계단</span>
                      </span>
                    </section>

                    <div className="leaderboard-hero__focus-stat">
                      <span className="label-mono">{t("leaderboard.dailyAverage")}</span>
                      <strong>{localMetricsStatus === "ready" ? formatLocalizedDuration(dailyAverageSeconds, effectiveLanguage) : (dailyAverageSeconds > 0 ? formatLocalizedDuration(dailyAverageSeconds, effectiveLanguage) : "3시간 35분")}</strong>
                    </div>

                    <div className="leaderboard-hero__focus-stat">
                      <span className="label-mono">{t("leaderboard.lastThirtyDays")}</span>
                      <strong>{dailyProductivity !== null ? formatLocalizedDuration(last30FocusSeconds, effectiveLanguage) : "131시간 4분"}</strong>
                    </div>

                    <div className="leaderboard-hero__focus-stat leaderboard-v5-streak">
                      <span className="label-mono">연속 집중</span>
                      <strong>12일</strong>
                    </div>
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
        ) : (
          <>
        <section className="leaderboard-profile-block" aria-label={t("leaderboard.participationAria")} aria-hidden={isLoading || undefined}>
          <section
            className="leaderboard-hero"
            aria-label={t("leaderboard.yourParticipationAria")}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", alignItems: "stretch" }}
          >
            <div className="leaderboard-hero__summary-row">
              <div
                className="leaderboard-hero__identity-row"
              >
                {isLoading ? (
                  <>
                    <span
                      className="leaderboard-hero__avatar leaderboard-loading-shell__bone"
                      style={{ width: 69, height: 69, borderRadius: 16, flex: "0 0 auto" }}
                    />
                    <span className="leaderboard-loading-shell__identity-copy">
                      <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__rank" />
                      <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__name" />
                    </span>
                  </>
                ) : (
                  <>
                    <ProfileAvatar
                      className="leaderboard-hero__avatar"
                      name={previewName}
                      src={profileAvatarUrl || null}
                      style={{ width: 69, height: 69, borderRadius: 16, fontSize: "1.5rem", flex: "0 0 auto" }}
                    />
                    <div style={{ display: "grid", gap: "0.28rem", minWidth: 0 }}>
                      <span
                        className={`leaderboard-hero__status${isOptedIn && publiclyValid !== false ? " leaderboard-hero__status--live" : ""}${isOptedIn && publiclyValid === false ? " leaderboard-hero__status--fail" : ""}${isParticipationResolved ? "" : " leaderboard-hero__status--pending"}`}
                        style={{ justifySelf: "start" }}
                      >
                        {!isParticipationResolved
                          ? t("leaderboard.checkingStatus")
                          : isOptedIn
                            ? publiclyValid === false
                              ? t("leaderboard.validationFailed")
                              : currentUserRank !== null
                                ? `#${currentUserRank}`
                                : t("leaderboard.onBoard")
                            : t("leaderboard.notOnBoard")}
                      </span>
                      <h3 style={{ margin: 0, lineHeight: 1.15, fontSize: "1.15rem", whiteSpace: "normal" }}>{previewName}</h3>
                    </div>
                    {editProfile ? (
                      <button
                        type="button"
                        className="leaderboard-profile-edit-button"
                        aria-label={t("leaderboard.editProfileAria")}
                        onClick={editProfile}
                        style={{ margin: 0, flex: "0 0 auto" }}
                      >
                        <PencilIcon />
                      </button>
                    ) : null}
                  </>
                )}
              </div>
              {publicProfile || isLoading ? (
                <>
                  <div
                    aria-label={t("leaderboard.focusTotalsAria")}
                    className={!isLoading && showSparkline ? "leaderboard-hero__totals-row leaderboard-hero__totals-row--sparkline" : "leaderboard-hero__totals-row"}
                  >
                    {isLoading ? (
                      <>
                        <HeroStat label={t("leaderboard.focusThisWeek")} value="" accent loading />
                        <HeroStat label={t("leaderboard.dailyAverage")} value="" loading />
                        <HeroStat label={t("leaderboard.lastThirtyDays")} value="" loading />
                      </>
                    ) : (
                      <>
                        <HeroStat
                          label={t("leaderboard.focusThisWeek")}
                          value={localMetricsStatus === "ready" ? formatLocalizedDuration(weekFocusSeconds, effectiveLanguage) : "—"}
                          accent
                          className={showSparkline ? "leaderboard-hero__focus-stat--sparkline" : undefined}
                        >
                          {showSparkline ? (
                            <LeaderboardSparkline
                              points={sparklinePoints}
                              variant={sparklineVariant}
                              language={effectiveLanguage}
                              ariaLabel={t("leaderboard.weekSparklineAria")}
                            />
                          ) : null}
                        </HeroStat>
                        <HeroStat label={t("leaderboard.dailyAverage")} value={localMetricsStatus === "ready" ? formatLocalizedDuration(dailyAverageSeconds, effectiveLanguage) : "—"} />
                        <HeroStat label={t("leaderboard.lastThirtyDays")} value={dailyProductivity !== null ? formatLocalizedDuration(last30FocusSeconds, effectiveLanguage) : "—"} />
                      </>
                    )}
                  </div>
                  {!isLoading && localMetricsStatusMessage ? (
                    <p className="sr-only" role="status" aria-live="polite">{localMetricsStatusMessage}</p>
                  ) : null}
                </>
              ) : null}
            </div>

            <div
              className="leaderboard-hero__action-row"
              style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}
            >
              <div className="leaderboard-hero__participation-group">
                <div className="leaderboard-hero__participation-slot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: 0 }}>
                  {!isParticipationResolved ? (
                    // Participation is still unknown, so the slot holds its footprint
                    // rather than naming an action that may be the wrong one.
                    <span
                      className="leaderboard-hero__participation-placeholder"
                      role="status"
                      aria-label={t("leaderboard.checkingParticipationAria")}
                    />
                  ) : isLoading ? (
                    <button
                      type="button"
                      className={isOptedIn
                        ? "app-btn app-btn--danger leaderboard-hero__participation leaderboard-hero__participation--danger profile-btn hero-action-btn"
                        : "app-btn app-btn--primary leaderboard-hero__participation leaderboard-hero__participation--join profile-btn hero-action-btn"}
                      aria-describedby="leaderboard-participation-privacy"
                      disabled
                    >
                      {isOptedIn ? t("leaderboard.leave") : t("leaderboard.join")}
                    </button>
                  ) : isOptedIn ? (
                    <button
                      type="button"
                      className="app-btn app-btn--danger leaderboard-hero__participation leaderboard-hero__participation--danger profile-btn hero-action-btn"
                      aria-describedby="leaderboard-participation-privacy"
                      onClick={() => {
                        if (publicProfileIsOn) {
                          setLeaveMakePrivate(true);
                          setLeaveConfirmOpen(true);
                          return;
                        }
                        onOptOut?.();
                      }}
                      disabled={isActionLoading || !onOptOut}
                    >
                      {isActionLoading ? t("leaderboard.leaving") : t("leaderboard.leave")}
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
                      disabled={isActionLoading || (isSignedIn ? !onOptIn : !onSignIn)}
                    >
                      {isActionLoading ? t("leaderboard.joining") : t("leaderboard.join")}
                    </button>
                  )}
                </div>
                <p id="leaderboard-participation-privacy" className="leaderboard-hero__privacy-note">
                  {t("leaderboard.privacy")}
                </p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                {isLoading ? (
                  publicProfile ? (
                    <>
                      <button type="button" className="app-btn app-btn--secondary profile-btn hero-action-btn hero-action-btn--mono" disabled>
                        <EmbedIcon />
                        {t("leaderboard.embed")}
                      </button>
                      {!isParticipationResolved ? (
                        <span className="leaderboard-hero__participation-placeholder leaderboard-hero__participation-placeholder--share" aria-hidden="true" />
                      ) : isOptedIn ? (
                        <button type="button" className="app-btn app-btn--quiet profile-btn hero-action-btn" disabled>
                          <ShareIcon />
                          {t("leaderboard.share")}
                        </button>
                      ) : null}
                      {socialPills.map((pill) => (
                        <span key={pill.key} className="app-btn app-btn--quiet profile-btn hero-action-btn" style={{ textDecoration: "none" }}>
                          {pill.icon}
                          {pill.label}
                        </span>
                      ))}
                    </>
                  ) : null
                ) : publicProfile ? (
                  <>
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
                    ) : isOptedIn ? (
                      <button type="button" className="app-btn app-btn--quiet profile-btn hero-action-btn" onClick={publicProfile.onCopyProfileLink}>
                        <ShareIcon />
                        {t("leaderboard.share")}
                      </button>
                    ) : null}
                  </>
                ) : null}
                {!isLoading && socialPills.map((pill) => (
                  <a key={pill.key} href={pill.href} target="_blank" rel="noreferrer" className="app-btn app-btn--quiet profile-btn hero-action-btn" style={{ textDecoration: "none" }}>
                    {pill.icon}
                    {pill.label}
                  </a>
                ))}
              </div>
            </div>
          </section>
          {!isLoading && actionError ? <p className="capture-recency capture-recency--error" role="status">{actionError}</p> : null}
          {!isLoading && !isOptedIn && isCatchingUp && !actionError ? (
            <p className="capture-recency" role="status">{t("leaderboard.catchingUpNotice")}</p>
          ) : null}
          {!isLoading && !isOptedIn && publicProfile?.liveOffBoard && publicProfile.isPreviewProfile !== true ? (
            <div className="leaderboard-public-profile__notice" role="status">
              <p className="capture-recency">{t("leaderboard.publicProfileOffBoard")}</p>
              <div className="leaderboard-public-profile__notice-actions">
                <button
                  type="button"
                  className="app-btn app-btn--secondary app-btn--compact"
                  onClick={() => void publicProfile.onSetProfileVisibility(false)}
                  disabled={publicProfile.profileSaving}
                >
                  {t("leaderboard.makeProfilePrivate")}
                </button>
                {publicPageId ? (
                  <button
                    type="button"
                    className="app-btn app-btn--quiet app-btn--compact"
                    onClick={() => void openPublicProfilePage(publicPageId)}
                  >
                    {t("profile.editor.openPublicPage")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {!isLoading && (publicProfile?.profileError || publicProfile?.profileMessage) ? (
            <div className="leaderboard-public-profile__messages">
              {publicProfile.profileError ? <p className="capture-recency capture-recency--error">{publicProfile.profileError}</p> : null}
              {publicProfile.profileMessage ? <p className="capture-recency">{publicProfile.profileMessage}</p> : null}
            </div>
          ) : null}
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
          </>
        )}
        {!isLoading && publicProfile?.shareMessage ? <div className="leaderboard-share-toast" role="status">{publicProfile.shareMessage}</div> : null}
      </div>

      <ModalPresence>
        {leaveConfirmOpen && publicProfileIsOn ? (
        <div className="auth-modal__overlay" onClick={() => setLeaveConfirmOpen(false)}>
          <section
            className="auth-modal modal-shell leaderboard-leave-dialog"
            data-modal-variant="compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leaderboard-leave-title"
            aria-describedby="leaderboard-leave-body"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-head__copy">
                <h2 id="leaderboard-leave-title">{t("leaderboard.leaveConfirmTitle")}</h2>
                <p id="leaderboard-leave-body">{t("leaderboard.leaveConfirmBody")}</p>
              </div>
            </div>
            <label className="leaderboard-leave-check">
              <input
                className="leaderboard-leave-check__input"
                type="checkbox"
                checked={leaveMakePrivate}
                onChange={(event) => setLeaveMakePrivate(event.target.checked)}
              />
              <span className="leaderboard-leave-check__copy">{t("leaderboard.leaveMakePrivate")}</span>
            </label>
            <div className="modal-foot">
              <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setLeaveConfirmOpen(false)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                onClick={() => {
                  setLeaveConfirmOpen(false);
                  onOptOut?.({ makeProfilePrivate: leaveMakePrivate });
                }}
              >
                {t("leaderboard.leave")}
              </button>
            </div>
          </section>
        </div>
      ) : !isLoading && publicProfile && rankEmbedOpen ? (
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

function HeroStat({
  label,
  value,
  accent = false,
  loading = false,
  children,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
  readonly loading?: boolean;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  const color = accent ? "var(--accent-strong)" : "var(--text)";
  return (
    <div className={["leaderboard-hero__focus-stat", className].filter(Boolean).join(" ")} style={{ display: "grid", gap: "0.4rem" }}>
      <span className="label-mono" style={{ fontSize: "0.56rem", color: accent ? "var(--accent-strong)" : undefined }}>{label}</span>
      <strong style={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1, color, whiteSpace: "nowrap" }}>
        {loading ? (
          <span className="leaderboard-loading-shell__stat-value">
            <span className="leaderboard-loading-shell__bone" />
          </span>
        ) : value}
      </strong>
      {children}
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

function formatSocialDisplay(raw: string): string {
  const stripped = raw.replace(/^https?:\/\//, "").replace(/^(github\.com\/|linkedin\.com\/in\/)/, "").replace(/\/$/, "");
  return stripped.startsWith("@") ? stripped : `@${stripped}`;
}

function LinkChainIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 12.5 6 15a4 4 0 0 0 5.7 5.7l3-3" />
      <path d="m15.5 11.5 2.5-2.5a4 4 0 0 0-5.7-5.7l-3 3" />
      <path d="m8.5 15.5 7-7" />
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
