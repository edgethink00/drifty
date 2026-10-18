import type { DisplayLanguage } from "../localization/languageCatalog";
import { useMemo, useState } from "react";
import { buildPublicProfileUrl, normalizeExternalUrl, type ProfileDraft } from "../profile/ProfileModals";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import { ShareCardModal } from "../share/ShareCardModal";
import type { ShareCardTheme } from "../share/shareCardSvg";
import type { FocusCardControls } from "../share/useFocusCard";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { StateBlock } from "./leaderboardViewHelpers";
import { RankEmbedsModal } from "./RankEmbedsModal";
import { buildLeaderboardShareCard, leaderboardShareStoryIds } from "./leaderboardShareCard";
import { ModalPresence } from "../../components/ModalPresence";
import { useLocalization } from "../localization/LocalizationContext";
import { trailingFocusStreakDays, weekOverWeekDeltaPercent } from "./leaderboardRailMetrics";
import { LeaderboardScreen, type LeaderboardProfileLink } from "./LeaderboardScreen";

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
  const [rankEmbedOpen, setRankEmbedOpen] = useState(false);
  const [shareCardOpen, setShareCardOpen] = useState(false);
  const previewName = resolvePublicNamePreview(profileDisplayName, email, effectiveLanguage);
  // Display names are intentionally non-unique. Only the authenticated own-entry
  // RPC rank may associate a public row with this account.
  const matchedOwnRow = ownRank === null
    ? undefined
    : leaderboard.find((row) => row.rank === ownRank);
  const currentUserRank = isOptedIn ? ownRank ?? matchedOwnRow?.rank ?? null : null;
  const profileDraft = publicProfile?.draft ?? null;
  const profileAvatarUrl = profileDraft?.avatarUrl.trim() ?? "";
  const previewBio = profileDraft?.bio?.trim() ?? "";
  const weekFocusSeconds = publicProfile?.focusSeconds7d ?? 0;
  const dailyProductivity = publicProfile?.dailyProductivity ?? null;
  // A failed join/leave reads in the profile card (or the leave dialog), so the board below never moves.
  const showActionError = !isLoading && Boolean(actionError);
  const last30FocusSeconds = (dailyProductivity ?? []).reduce((sum, point) => sum + Math.max(0, point.focus), 0);
  const localMetricsStatus = publicProfile?.localMetricsStatus ?? "ready";
  const shareContext = publicProfile?.shareCard ?? null;
  // The card is assembled only while the sheet is open, from the same daily
  // aggregates the profile card charts; it never reads activity rows. If that series is
  // still loading or failed, a ranked member can still share the place card.
  const shareHasRank = isOptedIn && ownRank !== null && publiclyValid !== false;
  const shareHasSeries = dailyProductivity !== null;
  const shareAvailable = shareHasSeries || shareHasRank;
  // Depend on the window end only: the context object also carries callbacks
  // that change with profile state and would rebuild an open card.
  const shareWindowEndDay = shareContext?.windowEndDay ?? null;
  const shareCard = useMemo(() => (
    shareCardOpen && shareWindowEndDay && shareAvailable
      ? buildLeaderboardShareCard({ language: effectiveLanguage, period: activePeriod, windowEndDay: shareWindowEndDay, dailyProductivity: dailyProductivity ?? [] })
      : null
  ), [activePeriod, dailyProductivity, effectiveLanguage, shareAvailable, shareCardOpen, shareWindowEndDay]);
  const shareStoryIds = useMemo(
    () => (shareCard ? leaderboardShareStoryIds(shareCard, shareHasRank, shareHasSeries) : undefined),
    [shareCard, shareHasRank, shareHasSeries],
  );
  const profileLinkUrl = publicProfile?.publicId && publicProfile.draft.isPublic
    ? buildPublicProfileUrl(publicProfile.publicId)
    : null;

  if (!isSupabaseEnabled) {
    return <section className="leaderboard-panel" aria-label={t("leaderboard.title")}><PageTitle title={t("leaderboard.title")} /><StateBlock eyebrow={t("leaderboard.syncRequired")} title={t("leaderboard.unavailable")} detail={t("leaderboard.unavailableDetail")} /></section>;
  }
  if (error && !isLoading) {
    return <section className="leaderboard-panel" aria-label={t("leaderboard.title")}><PageTitle title={t("leaderboard.title")} /><StateBlock eyebrow={t("leaderboard.fetchError")} title={t("leaderboard.loadError")} detail={error} /></section>;
  }

  const resolvedOwnFocusSeconds = ownFocusSeconds
    ?? matchedOwnRow?.focus_seconds
    ?? (activePeriod === "weekly" ? publicProfile?.focusSeconds7d ?? 0 : 0);
  const participantCount = resolveParticipantCount(leaderboard, ownParticipantCount, currentUserRank);
  // One status line beside the period switch. A board refresh says the most; then
  // anything the member has to act on; then quiet progress.
  const profileError = !isLoading ? publicProfile?.profileError ?? null : null;
  const profileMessage = !isLoading ? publicProfile?.profileMessage ?? null : null;
  const validationFailed = isOptedIn && isParticipationResolved && publiclyValid === false;
  const localMetricsMessage = localMetricsStatus === "error"
    ? t("leaderboard.localUnavailable")
    : localMetricsStatus === "loading" ? t("leaderboard.calculatingLocal") : null;
  const status: { readonly text: string; readonly tone: "error" | "neutral" } | null = statusMessage
    ? { text: statusMessage, tone: statusTone }
    : profileError
      ? { text: profileError, tone: "error" }
      : validationFailed
        ? { text: t("leaderboard.validationFailed"), tone: "error" }
        : !isLoading && !isOptedIn && isCatchingUp && !actionError
          ? { text: t("leaderboard.catchingUpNotice"), tone: "neutral" }
          : profileMessage
            ? { text: profileMessage, tone: "neutral" }
            : localMetricsMessage
              ? { text: localMetricsMessage, tone: "neutral" }
              : null;

  return (
    <section className="leaderboard-panel" aria-label={t("leaderboard.title")} aria-busy={isLoading || undefined}>
      <LeaderboardScreen
        activePeriod={activePeriod}
        rows={leaderboard}
        isLoading={isLoading}
        isOptedIn={isOptedIn}
        isParticipationResolved={isParticipationResolved}
        isActionLoading={isActionLoading}
        isCatchingUp={isCatchingUp}
        actionError={showActionError ? actionError : null}
        ownRank={currentUserRank}
        ownFocusSeconds={isOptedIn ? resolvedOwnFocusSeconds : null}
        participantCount={participantCount}
        totalFocusSeconds={totalFocusSeconds7d}
        displayName={previewName}
        avatarUrl={profileAvatarUrl || null}
        bio={previewBio}
        links={buildProfileLinks(profileDraft, t("dashboard.today.website"))}
        weekFocusSeconds={localMetricsStatus === "ready" ? weekFocusSeconds : null}
        weekDeltaPercent={weekOverWeekDeltaPercent(dailyProductivity)}
        streakDays={trailingFocusStreakDays(dailyProductivity)}
        last30Seconds={dailyProductivity !== null ? last30FocusSeconds : null}
        weekPoints={(dailyProductivity ?? []).slice(-7)}
        statusMessage={status?.text ?? null}
        statusTone={status?.tone ?? "neutral"}
        shareState={isOptedIn && shareContext ? (shareAvailable ? "enabled" : "disabled") : "hidden"}
        onShare={() => setShareCardOpen(true)}
        onEmbed={() => setRankEmbedOpen(true)}
        onEditProfile={publicProfile?.onEditProfile ?? null}
        onJoin={isSignedIn ? onOptIn ?? null : onSignIn ?? null}
        onLeave={onOptOut ?? null}
        onPeriodChange={onPeriodChange}
        onSelectProfile={onSelectProfile}
      />

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

function resolvePublicNamePreview(profileDisplayName?: string | null, email?: string | null, language: DisplayLanguage = "en") {
  const trimmedName = profileDisplayName?.trim();
  if (trimmedName) return trimmedName;
  const emailPrefix = email?.split("@")[0]?.trim();
  return emailPrefix || (language === "ko" ? "멤버" : language === "es" ? "Miembro" : "member");
}

/** The profile's website, GitHub and LinkedIn, as icon links labelled with the address a reader would type. */
function buildProfileLinks(draft: ProfileDraft | null, websiteLabel: string): LeaderboardProfileLink[] {
  if (!draft) return [];
  const defs = [
    { key: "website", value: draft.websiteUrl },
    { key: "github", value: draft.githubUrl },
    { key: "linkedin", value: draft.linkedinUrl },
  ] as const;
  const links: LeaderboardProfileLink[] = [];
  for (const def of defs) {
    const href = normalizeExternalUrl(def.value);
    if (!href) continue;
    const label = def.key === "website" ? def.value.replace(/^https?:\/\//, "").replace(/\/$/, "") || websiteLabel : formatSocialDisplay(def.value);
    links.push({ key: def.key, href, label });
  }
  return links;
}

function formatSocialDisplay(raw: string): string {
  const stripped = raw.replace(/^https?:\/\//, "").replace(/^(github\.com\/|linkedin\.com\/in\/)/, "").replace(/\/$/, "");
  return stripped.startsWith("@") ? stripped : `@${stripped}`;
}

/** The shared page header, so the title sits where every other tab puts it even when the board cannot load. */
function PageTitle({ title }: { readonly title: string }) {
  return <header className="pg-head"><h1>{title}</h1></header>;
}
