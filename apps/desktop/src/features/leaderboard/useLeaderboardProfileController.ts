import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { buildRollingFocusSeconds, isBrowserHistoryImportSegment, isExcludedSegment, isPassiveSupportedSegment } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { shouldUseLeaderboardPreview } from "../../lib/api/previewData";
import { isPublicProfileLiveOffBoard } from "./publicProfileOffBoard";
import { trackerClient } from "../../lib/api/trackerClient";
import { capturePostHogDailyEvent, capturePostHogEvent, toAnalyticsErrorKind, toCountBucket, toDailyDedupKey, type PostHogEventPropertiesByName } from "../../lib/analytics/posthogClient";

type LeaderboardActionProperties = PostHogEventPropertiesByName["leaderboard_action"];

/** Every reported dimension goes into the key, so a surviving row never
    describes a different occurrence than the one its properties came from. */
function captureLeaderboardActionOncePerDay(properties: LeaderboardActionProperties): void {
  capturePostHogDailyEvent("leaderboard_action", toDailyDedupKey(properties), properties);
}
import { getLogicalDayRange, logicalTodayIsoDate, toErrorMessage } from "../../lib/formatting";
import type { AuthState } from "../auth/AuthContext";
import { buildPublicProfileUrl, copyTextToClipboard, type ProfileDraft } from "../profile/ProfileModals";
import { readImageFileAsDataUrl } from "../profile/profileImage";
import { fallbackDisplayName, fetchOwnProfile, fetchPublicProfile, saveOwnProfile } from "../profile/profileService";
import { useLocalization } from "../localization/LocalizationContext";
import type { PublicProfile, UserProfile } from "../profile/profileService";
import type { ClassificationAvailabilityReason, ClassificationAvailabilityState } from "../classification/classificationAvailability";
import {
  LEADERBOARD_AUTO_PUBLISH_SLOT_MS,
  buildLeaderboardAutoPublishPayloadKey,
  clearLeaderboardAutoPublishRecordsForUser,
  findLeaderboardAutoPublishRecord,
  readLeaderboardAutoPublishRecords,
  shouldSkipLeaderboardAutoPublishPayloadBuild,
  shouldPublishLeaderboardPeriod,
  upsertLeaderboardAutoPublishRecords,
  writeLeaderboardAutoPublishRecords,
  type LeaderboardAutoPublishDecision,
  type LeaderboardAutoPublishRecord,
} from "./leaderboardAutoPublishState";
import { LEADERBOARD_PUBLIC_RESULT_LIMIT } from "./leaderboardConfig";
import { getLeaderboardWindowStartDay } from "./leaderboardWindow";
import {
  DEFAULT_LEADERBOARD_PERIOD,
  LEADERBOARD_PERIODS,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  optOutLeaderboard,
  publishOwnLeaderboardCheckpoint,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type OwnLeaderboardEntry,
} from "./leaderboardService";
import {
  buildLeaderboardCheckpointPayload,
  buildLeaderboardPublishPayloads,
  publishLeaderboardPayloads,
  publishLeaderboardPeriods,
  type LeaderboardPublishPayload,
} from "./leaderboardPublisher";

// The public board only exposes aggregate scores. A light foreground-only poll
// lets scheduled aggregate events appear while the board is open without
// creating a persistent background request stream.
const LEADERBOARD_PUBLIC_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

type UseLeaderboardProfileControllerInput = {
  readonly activeTab: string;
  readonly allowsEffectiveAnonymousAuth: boolean;
  readonly authMetadataAvatarUrl: string;
  /** False while the persisted session is still being restored. */
  readonly isAuthResolved: boolean;
  readonly hasRequiredAccountAuth: boolean;
  readonly isEffectiveAuthRequired: boolean;
  readonly isSupabaseConfigured: boolean;
  /** False while AI-derived totals are unavailable or reconciling after recovery. */
  readonly classificationAssessmentReady?: boolean;
  readonly classificationAvailabilityState?: ClassificationAvailabilityState;
  readonly classificationRecoveryPending?: boolean;
  readonly classificationCatchingUp?: boolean;
  readonly classificationAvailabilityReason?: ClassificationAvailabilityReason;
  readonly showAiClassificationImpact: boolean;
  readonly includeBuiltInHeuristics?: boolean;
  readonly builtInHeuristicsUnavailableSince?: string | null;
  readonly signInAnonymously: AuthState["signInAnonymously"];
  readonly startOfDayMinutes: number;
  readonly user: AuthState["user"];
  readonly onAuthRequired: () => void;
};

type UseLeaderboardProfileControllerResult = {
  readonly activeLeaderboardPeriod: LeaderboardPeriod;
  readonly isLeaderboardOptedIn: boolean;
  /**
   * True once we actually know whether this account is on the board. Until then
   * `isLeaderboardOptedIn` is merely "not known to be joined", which must not be
   * rendered as a confident "not joined".
   */
  readonly isLeaderboardParticipationResolved: boolean;
  readonly isClassificationCatchingUp: boolean;
  readonly isClassificationAssessmentReady: boolean;
  readonly isProfileEditorOpen: boolean;
  readonly leaderboardActionError: string | null;
  readonly leaderboardActionLoading: boolean;
  readonly leaderboardError: string | null;
  readonly leaderboardLoading: boolean;
  readonly leaderboardLocalMetricsStatus: "loading" | "ready" | "error";
  readonly leaderboardStatusMessage: string | null;
  readonly leaderboardStatusTone: "error" | "neutral";
  readonly leaderboardProfileBio: string;
  readonly leaderboardProfileDisplayName: string;
  readonly leaderboardProfileGithubUrl: string;
  readonly leaderboardProfileLinkedinUrl: string;
  readonly leaderboardProfileWebsiteUrl: string;
  readonly leaderboardSegments: ActivitySegment[];
  readonly leaderboardUsesPreviewProfile: boolean;
  readonly leaderboardWindowEndDay: string;
  readonly leaderboardWindowStartDay: string;
  readonly localRollingFocusSeconds: number;
  readonly ownLeaderboardEntry: OwnLeaderboardEntry | null;
  readonly profile: UserProfile | null;
  readonly profileDraft: ProfileDraft;
  readonly profileError: string | null;
  readonly profileLoading: boolean;
  readonly profileMessage: string | null;
  readonly profileReadyUserId: string | null;
  readonly profileSaving: boolean;
  readonly profileShareMessage: string | null;
  /**
   * True whenever the profile page is serving while the user is off the board. The user
   * still chooses whether to unpublish; this only refuses to keep the state invisible.
   */
  readonly publicProfileLiveOffBoard: boolean;
  readonly rows: LeaderboardRow[];
  readonly selectedLeaderboardRow: LeaderboardRow | null;
  readonly selectedProfileError: string | null;
  readonly selectedProfileLoading: boolean;
  readonly selectedPublicProfile: PublicProfile | null;
  readonly totalLeaderboardFocusSeconds: number;
  readonly closeProfileEditor: () => void;
  readonly closeSelectedProfile: () => void;
  readonly handleLeaderboardOptIn: () => Promise<void>;
  readonly handleLeaderboardOptOut: (options?: { readonly makeProfilePrivate?: boolean }) => Promise<void>;
  readonly handleProfilePhotoSelected: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  readonly handleProfileVisibilityChange: (isPublic: boolean) => Promise<boolean>;
  readonly handleSaveProfile: () => Promise<boolean>;
  readonly handleSaveProfileFromModal: () => Promise<void>;
  readonly handleSelectLeaderboardProfile: (row: LeaderboardRow) => Promise<void>;
  readonly handleShareLeaderboardProfile: () => Promise<void>;
  readonly handleViewOwnLeaderboardProfile: () => Promise<void>;
  readonly openProfileEditor: () => void;
  readonly refreshLeaderboardData: () => Promise<void>;
  readonly publishLeaderboardCheckpoint: (
    period: Extract<LeaderboardPeriod, "daily" | "weekly">,
    windowEndDay: string,
  ) => Promise<boolean>;
  readonly syncLeaderboardPublication: (reason: LeaderboardAutoPublishReason, options?: LeaderboardAutoPublishOptions) => Promise<void>;
  readonly removeProfilePhoto: () => void;
  readonly setActiveLeaderboardPeriod: Dispatch<SetStateAction<LeaderboardPeriod>>;
  readonly updateProfileDraft: (updater: Partial<ProfileDraft>) => void;
};

export type LeaderboardAutoPublishReason =
  | "startup"
  | "slot"
  | "focus"
  | "visibility"
  | "day_changed"
  | "classification_updated"
  | "history_deleted";

export type LeaderboardAutoPublishOptions = {
  readonly bypassSlotGate?: boolean;
  readonly refreshAfter?: boolean;
};

type LeaderboardOptInCache = {
  readonly userScopeKey: string;
  readonly optedIn: boolean;
};

type LeaderboardLocalMetricsRequest = {
  readonly scopeKey: string;
  readonly promise: Promise<ActivitySegment[]>;
};

type LeaderboardAutoPublishPrepared = {
  readonly allPayloads: readonly LeaderboardPublishPayload[];
  readonly payloads: readonly LeaderboardPublishPayload[];
  readonly segmentCount: number;
  readonly decisions: readonly LeaderboardAutoPublishDecision[];
};

type LeaderboardOptInConfirmation = {
  readonly optedIn: boolean;
  readonly failed: boolean;
  readonly entries: readonly OwnLeaderboardEntry[];
};

function profileDraftFromProfile(
  profile: UserProfile | null,
  authenticatedUser: AuthState["user"] | null | undefined,
  authMetadataAvatarUrl: string,
): ProfileDraft {
  return {
    displayName: profile?.display_name
      ?? fallbackDisplayName(authenticatedUser?.email, authenticatedUser?.id, authenticatedUser?.user_metadata),
    bio: profile?.bio ?? "",
    avatarUrl: profile?.avatar_url || authMetadataAvatarUrl,
    websiteUrl: profile?.website_url ?? "",
    githubUrl: profile?.github_url ?? "",
    linkedinUrl: profile?.linkedin_url ?? "",
    // Real server value — the user's visibility choice must survive edits and saves.
    isPublic: profile?.is_public ?? true,
  };
}

function emptyProfileDraft(
  authenticatedUser: AuthState["user"] | null | undefined,
  authMetadataAvatarUrl: string,
): ProfileDraft {
  return {
    // Stay empty before auth resolves. The profile writer can then derive a
    // real account fallback instead of persisting a branded placeholder.
    displayName: authenticatedUser
      ? fallbackDisplayName(authenticatedUser.email, authenticatedUser.id, authenticatedUser.user_metadata)
      : "",
    bio: "",
    avatarUrl: authMetadataAvatarUrl,
    websiteUrl: "",
    githubUrl: "",
    linkedinUrl: "",
    // First-time profiles default to public (matches the profiles.is_public column default).
    isPublic: true,
  };
}

function getLeaderboardUserScopeKey(authenticatedUser: AuthState["user"] | null | undefined) {
  return authenticatedUser ? authenticatedUser.id ?? authenticatedUser.email ?? "authenticated" : "signed-out";
}

function buildAutoPublishRecords({
  currentRecords,
  userScopeKey,
  payloads,
  publishedAt,
  success,
}: {
  readonly currentRecords: readonly LeaderboardAutoPublishRecord[];
  readonly userScopeKey: string;
  readonly payloads: readonly LeaderboardPublishPayload[];
  readonly publishedAt: string;
  readonly success: boolean;
}) {
  const nextRecords = payloads.map((payload) => {
    const currentRecord = findLeaderboardAutoPublishRecord(currentRecords, userScopeKey, payload.period);
    return {
      userScopeKey,
      period: payload.period,
      payloadKey: success ? payload.payloadKey : currentRecord?.payloadKey ?? payload.payloadKey,
      lastAttemptAt: publishedAt,
      lastSuccessAt: success ? publishedAt : currentRecord?.lastSuccessAt ?? null,
      lastErrorAt: success ? null : publishedAt,
    } satisfies LeaderboardAutoPublishRecord;
  });
  return upsertLeaderboardAutoPublishRecords(currentRecords, nextRecords);
}

function buildRemoteAutoPublishRecord(
  userScopeKey: string,
  entry: OwnLeaderboardEntry,
): LeaderboardAutoPublishRecord | null {
  const updatedAt = Date.parse(entry.updated_at);
  if (!Number.isFinite(updatedAt) || entry.opted_in !== true) return null;

  return {
    userScopeKey,
    period: entry.period,
    payloadKey: buildLeaderboardAutoPublishPayloadKey({
      profileDisplayName: entry.display_name,
      period: entry.period,
      focusSeconds: entry.focus_seconds,
      windowStartDay: entry.window_start_date,
      windowEndDay: entry.window_end_date,
      timezone: entry.timezone,
    }),
    lastAttemptAt: entry.updated_at,
    lastSuccessAt: entry.updated_at,
    lastErrorAt: null,
  };
}

function seedMissingAutoPublishRecordsFromRemoteEntries({
  currentRecords,
  userScopeKey,
  entries,
}: {
  readonly currentRecords: readonly LeaderboardAutoPublishRecord[];
  readonly userScopeKey: string;
  readonly entries: readonly OwnLeaderboardEntry[];
}) {
  const nextRecords = entries.flatMap((entry) => {
    if (findLeaderboardAutoPublishRecord(currentRecords, userScopeKey, entry.period)) return [];
    const record = buildRemoteAutoPublishRecord(userScopeKey, entry);
    return record ? [record] : [];
  });

  return nextRecords.length === 0 ? currentRecords : upsertLeaderboardAutoPublishRecords(currentRecords, nextRecords);
}

function selectAutoPublishPayloads({
  payloads,
  records,
  userScopeKey,
  now,
  bypassSlotGate,
}: {
  readonly payloads: readonly LeaderboardPublishPayload[];
  readonly records: readonly LeaderboardAutoPublishRecord[];
  readonly userScopeKey: string;
  readonly now: Date;
  readonly bypassSlotGate: boolean;
}): Pick<LeaderboardAutoPublishPrepared, "payloads" | "decisions"> | null {
  const decisions = payloads.map((payload) => ({
    payload,
    decision: shouldPublishLeaderboardPeriod({
      record: findLeaderboardAutoPublishRecord(records, userScopeKey, payload.period),
      payloadKey: payload.payloadKey,
      now,
      bypassSlotGate,
    }),
  }));

  if (decisions.some((item) => item.decision.reason === "failure_backoff")) return null;

  const selected = decisions.filter((item) => item.decision.shouldPublish);

  if (selected.length === 0) return null;

  return {
    payloads: selected.map((item) => item.payload),
    decisions: selected.map((item) => item.decision),
  };
}


export type LeaderboardGateBlockedReason = "checking" | "catching_up" | "quota_exceeded" | "paused";

function resolveLeaderboardBlockedReason(input: {
  readonly availabilityState?: ClassificationAvailabilityState;
  readonly availabilityReason?: ClassificationAvailabilityReason;
  readonly catchingUp: boolean;
}): LeaderboardGateBlockedReason {
  if (input.availabilityReason === "cloud_quota_exceeded") return "quota_exceeded";
  if (input.catchingUp) return "catching_up";
  if (input.availabilityState === "checking") return "checking";
  return "paused";
}

function getAssessmentBlockedErrorMessage(
  reason: "checking" | "catching_up" | "quota_exceeded" | "paused",
  context: "join" | "pre_publish",
): string {
  if (reason === "quota_exceeded") {
    return context === "join"
      ? "Daily AI classification limit reached. You can join the leaderboard once your quota resets or after upgrading to Pro."
      : "Daily AI classification limit reached before focus totals were published. You can publish once your quota resets or after upgrading to Pro.";
  }
  if (reason === "catching_up") {
    return context === "join"
      ? "AI is catching up on recent activity. You can join the leaderboard once catch-up is complete."
      : "AI is catching up on recent activity. Please try again once catch-up completes.";
  }
  if (reason === "checking") {
    return "AI connection is being verified. Please try joining again in a moment.";
  }
  return context === "join"
    ? "AI classification is paused. Reconnect AI before joining the leaderboard."
    : "AI classification paused before your focus totals were published. Reconnect AI and try again.";
}

export function useLeaderboardProfileController({
  activeTab,
  allowsEffectiveAnonymousAuth,
  authMetadataAvatarUrl,
  hasRequiredAccountAuth,
  isAuthResolved,
  isEffectiveAuthRequired,
  isSupabaseConfigured,
  classificationAssessmentReady = true,
  classificationAvailabilityState = "ready",
  classificationRecoveryPending = false,
  classificationCatchingUp = false,
  classificationAvailabilityReason = "ready",
  showAiClassificationImpact,
  includeBuiltInHeuristics,
  builtInHeuristicsUnavailableSince,
  signInAnonymously,
  startOfDayMinutes,
  user,
  onAuthRequired,
}: UseLeaderboardProfileControllerInput): UseLeaderboardProfileControllerResult {
  const { t } = useLocalization();
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [ownLeaderboardEntry, setOwnLeaderboardEntry] = useState<OwnLeaderboardEntry | null>(null);
  const [activeLeaderboardPeriod, setActiveLeaderboardPeriod] = useState<LeaderboardPeriod>(DEFAULT_LEADERBOARD_PERIOD);
  const [leaderboardHasResolvedOnce, setLeaderboardHasResolvedOnce] = useState(false);
  const [leaderboardHasLoadedOnce, setLeaderboardHasLoadedOnce] = useState(false);
  const [leaderboardRefreshing, setLeaderboardRefreshing] = useState(false);
  const [leaderboardActionLoading, setLeaderboardActionLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboardActionError, setLeaderboardActionError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(() => emptyProfileDraft(null, ""));
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileReadyUserId, setProfileReadyUserId] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileShareMessage, setProfileShareMessage] = useState<string | null>(null);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [selectedLeaderboardRow, setSelectedLeaderboardRow] = useState<LeaderboardRow | null>(null);
  const [selectedPublicProfile, setSelectedPublicProfile] = useState<PublicProfile | null>(null);
  const [selectedProfileLoading, setSelectedProfileLoading] = useState(false);
  const [selectedProfileError, setSelectedProfileError] = useState<string | null>(null);
  const selectedProfileRequestRef = useRef(0);
  const [leaderboardSegments, setLeaderboardSegments] = useState<ActivitySegment[]>([]);
  const [leaderboardLocalMetricsStatus, setLeaderboardLocalMetricsStatus] = useState<"loading" | "ready" | "error">("loading");
  const leaderboardRefreshRequestRef = useRef(0);
  const leaderboardLocalMetricsRequestRef = useRef(0);
  const leaderboardLocalMetricsScopeRef = useRef<string | null>(null);
  const leaderboardLocalMetricsInFlightRef = useRef<LeaderboardLocalMetricsRequest | null>(null);
  const leaderboardHasResolvedOnceRef = useRef(false);
  const leaderboardHasLoadedOnceRef = useRef(false);
  const leaderboardOwnEntryScopeRef = useRef<string | null>(null);
  const leaderboardAutoPublishInFlightRef = useRef(false);
  const leaderboardCheckpointPublishInFlightRef = useRef(false);
  const leaderboardManualActionInFlightRef = useRef(false);
  const leaderboardOptInCacheRef = useRef<LeaderboardOptInCache | null>(null);
  const leaderboardAutoPublishDayRef = useRef<string | null>(null);
  const isClassificationCatchingUp = Boolean(
    classificationCatchingUp
    || (
      classificationAvailabilityState === "ready"
      && (classificationRecoveryPending || builtInHeuristicsUnavailableSince !== null)
    ),
  );
  const classificationCatchingUpRef = useRef(isClassificationCatchingUp);
  classificationCatchingUpRef.current = isClassificationCatchingUp;
  const classificationAvailabilityStateRef = useRef(classificationAvailabilityState);
  classificationAvailabilityStateRef.current = classificationAvailabilityState;
  const classificationAvailabilityReasonRef = useRef(classificationAvailabilityReason);
  classificationAvailabilityReasonRef.current = classificationAvailabilityReason;

  useEffect(() => () => {
    selectedProfileRequestRef.current += 1;
  }, []);

  const classificationAssessmentReadyRef = useRef(classificationAssessmentReady);
  const classificationAssessmentRevisionRef = useRef(0);
  if (classificationAssessmentReadyRef.current !== classificationAssessmentReady) {
    classificationAssessmentReadyRef.current = classificationAssessmentReady;
    classificationAssessmentRevisionRef.current += 1;
  }

  useEffect(() => {
    if (classificationAssessmentReady) {
      setLeaderboardActionError((current) => {
        if (current?.includes("catching up") || current?.includes("verified") || current?.includes("limit reached")) {
          return null;
        }
        return current;
      });
    }
  }, [classificationAssessmentReady]);
  const [leaderboardAutoPublishRefreshing, setLeaderboardAutoPublishRefreshing] = useState(false);
  const [leaderboardAutoPublishError, setLeaderboardAutoPublishError] = useState<string | null>(null);

  const leaderboardWindowEndDay = logicalTodayIsoDate(startOfDayMinutes);
  // The profile hero is explicitly labelled "this week". Keep its local range
  // stable while the public board switches between daily, weekly, and monthly.
  const leaderboardWindowStartDay = getLeaderboardWindowStartDay(leaderboardWindowEndDay, "weekly");
  const leaderboardLocalMetricsScopeKey = `${leaderboardWindowStartDay}:${leaderboardWindowEndDay}:${startOfDayMinutes}`;
  const publishableLeaderboardSegments = useMemo<ActivitySegment[]>(
    () => leaderboardSegments.filter((segment: ActivitySegment) => (
      !isBrowserHistoryImportSegment(segment) && !isExcludedSegment(segment) && !isPassiveSupportedSegment(segment)
    )),
    [leaderboardSegments],
  );
  const leaderboardClassificationOptions = useMemo<ClassificationOptions>(
    () => ({
      fallbackCandidates: publishableLeaderboardSegments,
      includeAiClassifications: showAiClassificationImpact,
      includeBuiltInHeuristics,
      builtInHeuristicsUnavailableSince,
    }),
    [builtInHeuristicsUnavailableSince, includeBuiltInHeuristics, publishableLeaderboardSegments, showAiClassificationImpact],
  );
  const localRollingFocusSeconds = useMemo(
    () => leaderboardLocalMetricsStatus === "ready" && leaderboardLocalMetricsScopeRef.current === leaderboardLocalMetricsScopeKey
      ? buildRollingFocusSeconds(publishableLeaderboardSegments, leaderboardWindowStartDay, leaderboardWindowEndDay, leaderboardClassificationOptions, startOfDayMinutes)
      : 0,
    [leaderboardClassificationOptions, leaderboardLocalMetricsScopeKey, leaderboardLocalMetricsStatus, leaderboardWindowEndDay, leaderboardWindowStartDay, publishableLeaderboardSegments, startOfDayMinutes],
  );
  const leaderboardProfileDisplayName = useMemo(
    () => profile?.display_name
      || fallbackDisplayName(user?.email, user?.id, user?.user_metadata),
    [profile?.display_name, user?.email, user?.id, user?.user_metadata],
  );
  const leaderboardUsesPreviewProfile = shouldUseLeaderboardPreview();
  const leaderboardProfileBio = profile?.bio || profileDraft.bio || (leaderboardUsesPreviewProfile ? "Building quiet tools for deeper work." : "");
  const leaderboardProfileWebsiteUrl = profile?.website_url || profileDraft.websiteUrl || (leaderboardUsesPreviewProfile ? "drifty.so/drifty" : "");
  const leaderboardProfileGithubUrl = profile?.github_url || profileDraft.githubUrl || (leaderboardUsesPreviewProfile ? "github.com/edgethink00" : "");
  const leaderboardProfileLinkedinUrl = profile?.linkedin_url || profileDraft.linkedinUrl || (leaderboardUsesPreviewProfile ? "linkedin.com/in/drifty" : "");
  const leaderboardTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const isPolicySignedIn = Boolean(user) && (!isEffectiveAuthRequired || hasRequiredAccountAuth);
  const leaderboardOwnEntryScopeKey = isPolicySignedIn ? getLeaderboardUserScopeKey(user) : "signed-out";
  const scopedOwnLeaderboardEntry = leaderboardOwnEntryScopeRef.current === leaderboardOwnEntryScopeKey ? ownLeaderboardEntry : null;
  const isLeaderboardOptedIn = leaderboardUsesPreviewProfile || scopedOwnLeaderboardEntry?.opted_in === true;
  // Participation is only "known" once the account is settled and this scope's own
  // entry has actually been fetched. While a persisted session is still being
  // restored the scope key is "signed-out" and the own-entry request is skipped,
  // so a joined user would otherwise render as a confident "not joined" and then
  // snap back — the join/share flicker.
  const isLeaderboardParticipationResolved = leaderboardUsesPreviewProfile
    || !isSupabaseConfigured
    || (isAuthResolved && (!isPolicySignedIn || leaderboardOwnEntryScopeRef.current === leaderboardOwnEntryScopeKey));

  const publicProfileLiveOffBoard = isPublicProfileLiveOffBoard({
    isParticipationResolved: isLeaderboardParticipationResolved,
    isOptedIn: isLeaderboardOptedIn,
    isProfileReady: profileReadyUserId !== null && profileReadyUserId === (user?.id ?? null),
    isPublic: profile?.is_public,
  });

  useEffect(() => {
    leaderboardOptInCacheRef.current = null;
  }, [leaderboardOwnEntryScopeKey]);

  useEffect(() => () => {
    leaderboardRefreshRequestRef.current += 1;
    leaderboardLocalMetricsRequestRef.current += 1;
  }, []);

  const refreshLeaderboardLocalMetrics = useCallback(async () => {
    const requestId = ++leaderboardLocalMetricsRequestRef.current;
    const scopeKey = leaderboardLocalMetricsScopeKey;
    const shouldPreserveResolvedMetrics = leaderboardLocalMetricsScopeRef.current === scopeKey;
    if (!shouldPreserveResolvedMetrics) setLeaderboardLocalMetricsStatus("loading");

    let request = leaderboardLocalMetricsInFlightRef.current;
    if (!request || request.scopeKey !== scopeKey) {
      request = {
        scopeKey,
        promise: trackerClient.getTimeline(getLogicalDayRange(
          leaderboardWindowStartDay,
          leaderboardWindowEndDay,
          startOfDayMinutes,
        )),
      };
      leaderboardLocalMetricsInFlightRef.current = request;
    }

    try {
      const segments = await request.promise;
      if (leaderboardLocalMetricsRequestRef.current !== requestId) return;

      setLeaderboardSegments(segments);
      leaderboardLocalMetricsScopeRef.current = scopeKey;
      setLeaderboardLocalMetricsStatus("ready");
    } catch {
      if (leaderboardLocalMetricsRequestRef.current !== requestId) return;
      if (shouldPreserveResolvedMetrics) return;

      leaderboardLocalMetricsScopeRef.current = null;
      setLeaderboardLocalMetricsStatus("error");
    } finally {
      if (leaderboardLocalMetricsInFlightRef.current?.promise === request.promise) {
        leaderboardLocalMetricsInFlightRef.current = null;
      }
    }
  }, [leaderboardLocalMetricsScopeKey, leaderboardWindowEndDay, leaderboardWindowStartDay, startOfDayMinutes]);

  // `origin` decides whether a successful load is worth an event. Most callers are
  // machine-driven (a classification batch finished, an interval elapsed, a publish
  // landed) and a background data refresh is not a person looking at the board, so
  // only an explicit open reports success. Failures always report, once a day per
  // kind, which answers "how many installs hit this" rather than inflating counts.
  const refreshLeaderboardData = useCallback(async (
    authenticatedUser = user,
    origin: "user_open" | "background" = "background",
  ) => {
    const reportLoadFailure = (
      errorKind: ReturnType<typeof toAnalyticsErrorKind>,
      extra: { readonly row_count_bucket?: ReturnType<typeof toCountBucket> } = {},
    ) => {
      captureLeaderboardActionOncePerDay({
        action: "load",
        result: "error",
        period: activeLeaderboardPeriod,
        ...extra,
        error_kind: errorKind,
      });
    };
    const requestId = ++leaderboardRefreshRequestRef.current;
    const hasResolvedLeaderboardState = leaderboardHasResolvedOnceRef.current;
    const shouldPreserveLeaderboardState = leaderboardHasLoadedOnceRef.current;
    const canLoadOwnLeaderboardEntry = Boolean(authenticatedUser) && (!isEffectiveAuthRequired || hasRequiredAccountAuth);
    const authenticatedUserScopeKey = canLoadOwnLeaderboardEntry ? getLeaderboardUserScopeKey(authenticatedUser) : "signed-out";

    if (!isSupabaseConfigured && !shouldUseLeaderboardPreview()) {
      setLeaderboardRows([]);
      setOwnLeaderboardEntry(null);
      setLeaderboardSegments([]);
      leaderboardLocalMetricsRequestRef.current += 1;
      leaderboardLocalMetricsScopeRef.current = null;
      leaderboardLocalMetricsInFlightRef.current = null;
      setLeaderboardLocalMetricsStatus("loading");
      leaderboardOwnEntryScopeRef.current = null;
      leaderboardHasResolvedOnceRef.current = false;
      leaderboardHasLoadedOnceRef.current = false;
      setLeaderboardHasResolvedOnce(false);
      setLeaderboardHasLoadedOnce(false);
      setLeaderboardRefreshing(false);
      setLeaderboardError(null);
      return;
    }

    void refreshLeaderboardLocalMetrics();
    setLeaderboardRefreshing(true);
    if (!hasResolvedLeaderboardState || shouldPreserveLeaderboardState) setLeaderboardError(null);

    try {
      const [globalResult, ownResult] = await Promise.all([
        fetchGlobalLeaderboard(activeLeaderboardPeriod, LEADERBOARD_PUBLIC_RESULT_LIMIT),
        canLoadOwnLeaderboardEntry ? fetchOwnLeaderboardEntry(activeLeaderboardPeriod) : Promise.resolve({ success: true, error: null, data: null }),
      ]);

      if (leaderboardRefreshRequestRef.current !== requestId) return;

      if (!globalResult.success) {
        if (!shouldPreserveLeaderboardState) {
          setLeaderboardRows([]);
          setOwnLeaderboardEntry(null);
          leaderboardOwnEntryScopeRef.current = null;
        }
        leaderboardHasResolvedOnceRef.current = true;
        setLeaderboardHasResolvedOnce(true);
        setLeaderboardError(globalResult.error ?? "Unable to load leaderboard");
        reportLoadFailure(toAnalyticsErrorKind(globalResult.error));
        return;
      }

      if (!ownResult.success) {
        if (!shouldPreserveLeaderboardState) {
          setLeaderboardRows(globalResult.data ?? []);
          setOwnLeaderboardEntry(null);
          leaderboardOwnEntryScopeRef.current = null;
        }
        leaderboardHasResolvedOnceRef.current = true;
        setLeaderboardHasResolvedOnce(true);
        setLeaderboardError(ownResult.error ?? "Unable to load your leaderboard status");
        reportLoadFailure(toAnalyticsErrorKind(ownResult.error), {
          row_count_bucket: toCountBucket((globalResult.data ?? []).length),
        });
        return;
      }

      setLeaderboardRows(globalResult.data ?? []);
      setOwnLeaderboardEntry(ownResult.data ?? null);
      leaderboardOwnEntryScopeRef.current = authenticatedUserScopeKey;
      leaderboardHasResolvedOnceRef.current = true;
      leaderboardHasLoadedOnceRef.current = true;
      setLeaderboardHasResolvedOnce(true);
      setLeaderboardHasLoadedOnce(true);
      setLeaderboardError(null);
      if (origin === "user_open") {
        captureLeaderboardActionOncePerDay({
          action: "load",
          result: "success",
          period: activeLeaderboardPeriod,
          row_count_bucket: toCountBucket((globalResult.data ?? []).length),
        });
      }
    } catch (nextError) {
      if (leaderboardRefreshRequestRef.current !== requestId) return;
      if (!shouldPreserveLeaderboardState) {
        setLeaderboardRows([]);
        setOwnLeaderboardEntry(null);
        leaderboardOwnEntryScopeRef.current = null;
      }
      leaderboardHasResolvedOnceRef.current = true;
      setLeaderboardHasResolvedOnce(true);
      setLeaderboardError(toErrorMessage(nextError));
      reportLoadFailure(toAnalyticsErrorKind(nextError));
    } finally {
      if (leaderboardRefreshRequestRef.current === requestId) setLeaderboardRefreshing(false);
    }
  }, [activeLeaderboardPeriod, hasRequiredAccountAuth, isEffectiveAuthRequired, isSupabaseConfigured, refreshLeaderboardLocalMetrics, user]);

  useEffect(() => {
    if (!isSupabaseConfigured && !shouldUseLeaderboardPreview()) {
      setLeaderboardRows([]);
      setOwnLeaderboardEntry(null);
      setLeaderboardSegments([]);
      leaderboardLocalMetricsRequestRef.current += 1;
      leaderboardLocalMetricsScopeRef.current = null;
      leaderboardLocalMetricsInFlightRef.current = null;
      setLeaderboardLocalMetricsStatus("loading");
      leaderboardOwnEntryScopeRef.current = null;
      leaderboardHasResolvedOnceRef.current = false;
      leaderboardHasLoadedOnceRef.current = false;
      setLeaderboardHasResolvedOnce(false);
      setLeaderboardHasLoadedOnce(false);
      setLeaderboardRefreshing(false);
      setLeaderboardError(null);
      return;
    }

    if (activeTab !== "leaderboard") return;

    void refreshLeaderboardData(undefined, "user_open");
  }, [activeTab, isSupabaseConfigured, refreshLeaderboardData]);

  useEffect(() => {
    if (activeTab !== "leaderboard" || (!isSupabaseConfigured && !shouldUseLeaderboardPreview())) return;

    const intervalId = window.setInterval(() => {
      void refreshLeaderboardData();
    }, LEADERBOARD_PUBLIC_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [activeTab, isSupabaseConfigured, refreshLeaderboardData]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user || (isEffectiveAuthRequired && !hasRequiredAccountAuth)) {
      setProfile(null);
      setProfileDraft(emptyProfileDraft(user, authMetadataAvatarUrl));
      setProfileLoading(false);
      setProfileReadyUserId(user?.id ?? null);
      setProfileError(null);
      setProfileMessage(null);
      return;
    }

    let cancelled = false;
    setProfileLoading(true);
    setProfileReadyUserId(null);
    setProfileError(null);
    void fetchOwnProfile().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setProfile(null);
        setProfileDraft(emptyProfileDraft(user, authMetadataAvatarUrl));
        setProfileError(result.error ?? "Unable to load profile");
      } else {
        const nextProfile = result.data ?? null;
        setProfile(nextProfile);
        setProfileDraft(profileDraftFromProfile(nextProfile, user, authMetadataAvatarUrl));
      }
    }).finally(() => {
      if (!cancelled) {
        setProfileLoading(false);
        setProfileReadyUserId(user.id);
      }
    });

    return () => { cancelled = true; };
  }, [authMetadataAvatarUrl, hasRequiredAccountAuth, isEffectiveAuthRequired, isSupabaseConfigured, user?.email, user?.id]);

  const prepareLeaderboardAutoPublish = useCallback(async (options: LeaderboardAutoPublishOptions): Promise<LeaderboardAutoPublishPrepared | null> => {
    if (profileReadyUserId !== (user?.id ?? null)) return null;

    const profileDisplayName = profile?.display_name.trim();
    if (!profileDisplayName || profileLoading || profileError) return null;

    const payloads = await buildLeaderboardPublishPayloads({
      profileDisplayName,
      leaderboardWindowEndDay,
      timezone: leaderboardTimezone,
      startOfDayMinutes,
      showAiClassificationImpact,
      includeBuiltInHeuristics,
      builtInHeuristicsUnavailableSince,
    });
    const selection = selectAutoPublishPayloads({
      payloads: payloads.payloads,
      records: readLeaderboardAutoPublishRecords(),
      userScopeKey: leaderboardOwnEntryScopeKey,
      now: new Date(),
      bypassSlotGate: options.bypassSlotGate === true,
    });

    if (!selection) return null;
    return {
      allPayloads: payloads.payloads,
      payloads: selection.payloads,
      segmentCount: payloads.segmentCount,
      decisions: selection.decisions,
    };
  }, [builtInHeuristicsUnavailableSince, includeBuiltInHeuristics, leaderboardOwnEntryScopeKey, leaderboardTimezone, leaderboardWindowEndDay, profile?.display_name, profileError, profileLoading, profileReadyUserId, showAiClassificationImpact, startOfDayMinutes, user?.id]);

  const confirmLeaderboardOptInForAutoPublish = useCallback(async (requiresRemoteCheck: boolean) => {
    if (!requiresRemoteCheck && scopedOwnLeaderboardEntry?.opted_in === true) {
      leaderboardOptInCacheRef.current = { userScopeKey: leaderboardOwnEntryScopeKey, optedIn: true };
      return { optedIn: true, failed: false, entries: [] } satisfies LeaderboardOptInConfirmation;
    }

    const cached = leaderboardOptInCacheRef.current;
    if (!requiresRemoteCheck && cached?.userScopeKey === leaderboardOwnEntryScopeKey) {
      return { optedIn: cached.optedIn, failed: false, entries: [] } satisfies LeaderboardOptInConfirmation;
    }

    const results = await Promise.all(LEADERBOARD_PERIODS.map((period) => fetchOwnLeaderboardEntry(period)));
    const failedResult = results.find((result) => !result.success);
    if (failedResult) {
      if (activeTab === "leaderboard") {
        setLeaderboardAutoPublishError(failedResult.error ?? "Unable to confirm leaderboard participation");
      }
      return { optedIn: false, failed: true, entries: [] } satisfies LeaderboardOptInConfirmation;
    }

    const entries = results.flatMap((result) => result.data ? [result.data] : []);
    const optedIn = results.some((result) => result.data?.opted_in === true);
    leaderboardOptInCacheRef.current = { userScopeKey: leaderboardOwnEntryScopeKey, optedIn };
    if (!optedIn) clearLeaderboardAutoPublishRecordsForUser(leaderboardOwnEntryScopeKey);
    return { optedIn, failed: false, entries } satisfies LeaderboardOptInConfirmation;
  }, [activeTab, leaderboardOwnEntryScopeKey, scopedOwnLeaderboardEntry?.opted_in]);

  const publishLeaderboardCheckpoint = useCallback(async (
    period: Extract<LeaderboardPeriod, "daily" | "weekly">,
    windowEndDay: string,
  ): Promise<boolean> => {
    const assessmentRevision = classificationAssessmentRevisionRef.current;
    if (!classificationAssessmentReadyRef.current || !isSupabaseConfigured || shouldUseLeaderboardPreview()) return false;
    if (!isPolicySignedIn || !user || leaderboardOwnEntryScopeKey === "signed-out") return false;
    if (leaderboardManualActionInFlightRef.current || leaderboardCheckpointPublishInFlightRef.current) return false;
    if (profileReadyUserId !== user.id || profileLoading || profileError) return false;

    const profileDisplayName = profile?.display_name.trim();
    if (!profileDisplayName) return false;

    leaderboardCheckpointPublishInFlightRef.current = true;
    try {
      const optInConfirmation = await confirmLeaderboardOptInForAutoPublish(true);
      if (!optInConfirmation.optedIn) return false;

      const payload = await buildLeaderboardCheckpointPayload({
        period,
        profileDisplayName,
        windowEndDay,
        timezone: leaderboardTimezone,
        startOfDayMinutes,
        showAiClassificationImpact,
        includeBuiltInHeuristics,
        builtInHeuristicsUnavailableSince,
      });
      if (!classificationAssessmentReadyRef.current
        || classificationAssessmentRevisionRef.current !== assessmentRevision) return false;
      const result = await publishOwnLeaderboardCheckpoint({
        period,
        focusSeconds: payload.focusSeconds,
        windowStartDay: payload.windowStartDay,
        windowEndDay: payload.windowEndDay,
        timezone: payload.timezone,
      });
      return result.success && result.data === true;
    } catch {
      return false;
    } finally {
      leaderboardCheckpointPublishInFlightRef.current = false;
    }
  }, [builtInHeuristicsUnavailableSince, classificationAssessmentReady, confirmLeaderboardOptInForAutoPublish, includeBuiltInHeuristics, isPolicySignedIn, isSupabaseConfigured, leaderboardOwnEntryScopeKey, leaderboardTimezone, profile?.display_name, profileError, profileLoading, profileReadyUserId, showAiClassificationImpact, startOfDayMinutes, user]);

  const syncLeaderboardPublication = useCallback(async (
    reason: LeaderboardAutoPublishReason,
    options: LeaderboardAutoPublishOptions = {},
  ) => {
    const assessmentRevision = classificationAssessmentRevisionRef.current;
    if (!classificationAssessmentReadyRef.current || !isSupabaseConfigured || shouldUseLeaderboardPreview()) return;
    if (!isPolicySignedIn || !user) return;
    if (leaderboardOwnEntryScopeKey === "signed-out") return;
    if (leaderboardManualActionInFlightRef.current) return;
    if (leaderboardAutoPublishInFlightRef.current) return;
    if (shouldSkipLeaderboardAutoPublishPayloadBuild({
      records: readLeaderboardAutoPublishRecords(),
      userScopeKey: leaderboardOwnEntryScopeKey,
      now: new Date(),
      bypassSlotGate: options.bypassSlotGate === true,
    })) return;

    leaderboardAutoPublishInFlightRef.current = true;
    if (activeTab === "leaderboard") {
      setLeaderboardAutoPublishRefreshing(true);
      setLeaderboardAutoPublishError(null);
    }

    let preparedForFailure: LeaderboardAutoPublishPrepared | null = null;

    try {
      const prepared = await prepareLeaderboardAutoPublish(options);
      if (!prepared
        || !classificationAssessmentReadyRef.current
        || classificationAssessmentRevisionRef.current !== assessmentRevision) return;
      let publishablePrepared = prepared;
      preparedForFailure = publishablePrepared;

      const requiresRemoteCheck = prepared.decisions.some((decision) => decision.requiresRemoteOptInCheck);
      const optInConfirmation = await confirmLeaderboardOptInForAutoPublish(requiresRemoteCheck);
      if (!classificationAssessmentReadyRef.current
        || classificationAssessmentRevisionRef.current !== assessmentRevision) return;
      if (!optInConfirmation.optedIn) {
        if (optInConfirmation.failed) {
          writeLeaderboardAutoPublishRecords(buildAutoPublishRecords({
            currentRecords: readLeaderboardAutoPublishRecords(),
            userScopeKey: leaderboardOwnEntryScopeKey,
            payloads: publishablePrepared.payloads,
            publishedAt: new Date().toISOString(),
            success: false,
          }));
        }
        return;
      }

      if (optInConfirmation.entries.length > 0) {
        const currentRecords = readLeaderboardAutoPublishRecords();
        const seededRecords = seedMissingAutoPublishRecordsFromRemoteEntries({
          currentRecords,
          userScopeKey: leaderboardOwnEntryScopeKey,
          entries: optInConfirmation.entries,
        });
        if (seededRecords !== currentRecords) {
          writeLeaderboardAutoPublishRecords(seededRecords);
        }

        const selection = selectAutoPublishPayloads({
          payloads: prepared.allPayloads,
          records: seededRecords,
          userScopeKey: leaderboardOwnEntryScopeKey,
          now: new Date(),
          bypassSlotGate: options.bypassSlotGate === true,
        });
        if (!selection) return;

        publishablePrepared = {
          ...prepared,
          payloads: selection.payloads,
          decisions: selection.decisions,
        };
        preparedForFailure = publishablePrepared;
      }

      if (!classificationAssessmentReadyRef.current
        || classificationAssessmentRevisionRef.current !== assessmentRevision) return;
      const result = await publishLeaderboardPayloads("auto", publishablePrepared.payloads);
      const publishedAt = new Date().toISOString();
      writeLeaderboardAutoPublishRecords(buildAutoPublishRecords({
        currentRecords: readLeaderboardAutoPublishRecords(),
        userScopeKey: leaderboardOwnEntryScopeKey,
        payloads: publishablePrepared.payloads,
        publishedAt,
        success: result.success,
      }));

      if (!result.success) {
        if (activeTab === "leaderboard") {
          setLeaderboardAutoPublishError(result.error ?? "Unable to update your leaderboard score");
        }
        captureLeaderboardActionOncePerDay({
          action: "publish",
          result: "error",
          period: activeLeaderboardPeriod,
          segment_count_bucket: toCountBucket(publishablePrepared.segmentCount),
          error_kind: toAnalyticsErrorKind(result.error),
        });
        return;
      }

      setLeaderboardAutoPublishError(null);
      // Auto publish already has an hourly slot gate, so this is bounded per day
      // but still repeats. "Did publishing work today" is the whole question.
      captureLeaderboardActionOncePerDay({
        action: "publish",
        result: "success",
        period: activeLeaderboardPeriod,
        segment_count_bucket: toCountBucket(publishablePrepared.segmentCount),
      });

      if (options.refreshAfter === true || activeTab === "leaderboard") {
        await refreshLeaderboardData();
      }
    } catch (nextError) {
      const message = toErrorMessage(nextError);
      if (preparedForFailure) {
        writeLeaderboardAutoPublishRecords(buildAutoPublishRecords({
          currentRecords: readLeaderboardAutoPublishRecords(),
          userScopeKey: leaderboardOwnEntryScopeKey,
          payloads: preparedForFailure.payloads,
          publishedAt: new Date().toISOString(),
          success: false,
        }));
      }
      if (activeTab === "leaderboard") setLeaderboardAutoPublishError(message);
      captureLeaderboardActionOncePerDay({
        action: "publish",
        result: "error",
        period: activeLeaderboardPeriod,
        error_kind: toAnalyticsErrorKind(nextError),
      });
    } finally {
      leaderboardAutoPublishInFlightRef.current = false;
      if (activeTab === "leaderboard") setLeaderboardAutoPublishRefreshing(false);
      void reason;
    }
  }, [
    activeLeaderboardPeriod,
    activeTab,
    classificationAssessmentReady,
    confirmLeaderboardOptInForAutoPublish,
    isPolicySignedIn,
    isSupabaseConfigured,
    leaderboardOwnEntryScopeKey,
    prepareLeaderboardAutoPublish,
    refreshLeaderboardData,
    user,
  ]);

  useEffect(() => {
    // Preview/demo surfaces never publish (syncLeaderboardPublication already
    // no-ops there); skip mounting the recurring timer and listeners entirely.
    if (shouldUseLeaderboardPreview()) return undefined;
    void syncLeaderboardPublication("startup");

    // Fire exactly on hour-slot boundaries rather than every N ms from mount, so
    // the publish moment stays aligned to the same slot the publish gate uses and
    // never leaks sub-hour timing. Re-arm each tick against the wall clock to stay
    // aligned across drift and sleep/wake.
    let slotTimeoutId = 0;
    const scheduleNextSlot = () => {
      const msUntilNextSlot = LEADERBOARD_AUTO_PUBLISH_SLOT_MS - (Date.now() % LEADERBOARD_AUTO_PUBLISH_SLOT_MS);
      slotTimeoutId = window.setTimeout(() => {
        void syncLeaderboardPublication("slot");
        scheduleNextSlot();
      }, msUntilNextSlot);
    };
    scheduleNextSlot();

    function handleFocus() {
      void syncLeaderboardPublication("focus");
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void syncLeaderboardPublication("visibility");
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(slotTimeoutId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncLeaderboardPublication]);

  useEffect(() => {
    if (leaderboardAutoPublishDayRef.current === null) {
      leaderboardAutoPublishDayRef.current = leaderboardWindowEndDay;
      return;
    }
    if (leaderboardAutoPublishDayRef.current === leaderboardWindowEndDay) return;
    leaderboardAutoPublishDayRef.current = leaderboardWindowEndDay;
    void syncLeaderboardPublication("day_changed");
  }, [leaderboardWindowEndDay, syncLeaderboardPublication]);

  const updateProfileDraft = useCallback((updater: Partial<ProfileDraft>) => {
    setProfileDraft((draft) => ({ ...draft, ...updater }));
  }, []);

  const removeProfilePhoto = useCallback(() => {
    setProfileDraft((draft) => ({ ...draft, avatarUrl: "" }));
  }, []);

  const openProfileEditor = useCallback(() => setIsProfileEditorOpen(true), []);
  const closeProfileEditor = useCallback(() => setIsProfileEditorOpen(false), []);

  const closeSelectedProfile = useCallback(() => {
    selectedProfileRequestRef.current += 1;
    setSelectedLeaderboardRow(null);
    setSelectedPublicProfile(null);
    setSelectedProfileError(null);
    setSelectedProfileLoading(false);
  }, []);

  const handleLeaderboardOptIn = useCallback(async () => {
    const assessmentRevision = classificationAssessmentRevisionRef.current;
    setLeaderboardActionLoading(true);
    leaderboardManualActionInFlightRef.current = true;
    setLeaderboardActionError(null);
    setProfileError(null);

    try {
      if (!classificationAssessmentReadyRef.current) {
        const reason = resolveLeaderboardBlockedReason({
          availabilityState: classificationAvailabilityStateRef.current,
          catchingUp: classificationCatchingUpRef.current,
          availabilityReason: classificationAvailabilityReasonRef.current,
        });
        setLeaderboardActionError(getAssessmentBlockedErrorMessage(reason, "join"));
        return;
      }
      if (isEffectiveAuthRequired && !hasRequiredAccountAuth) {
        onAuthRequired();
        setLeaderboardActionError("Sign in with a drifty.so account before joining the beta leaderboard.");
        capturePostHogEvent("leaderboard_action", {
          action: "publish",
          result: "error",
          period: activeLeaderboardPeriod,
          error_kind: "not_authenticated",
        });
        return;
      }

      let authenticatedUser = user;
      if (!user) {
        if (!allowsEffectiveAnonymousAuth) {
          onAuthRequired();
          setLeaderboardActionError("Sign in before joining the beta leaderboard.");
          capturePostHogEvent("leaderboard_action", {
            action: "publish",
            result: "error",
            period: activeLeaderboardPeriod,
            error_kind: "not_authenticated",
          });
          return;
        }

        const anonymousResult = await signInAnonymously();
        if (anonymousResult.error || !anonymousResult.user) {
          setLeaderboardActionError(anonymousResult.error?.message ?? "Unable to join leaderboard without a beta session.");
          capturePostHogEvent("leaderboard_action", {
            action: "publish",
            result: "error",
            period: activeLeaderboardPeriod,
            error_kind: toAnalyticsErrorKind(anonymousResult.error),
          });
          return;
        }
        authenticatedUser = anonymousResult.user;
      }

      if (!authenticatedUser) {
        setLeaderboardActionError("Sign in before joining the beta leaderboard.");
        onAuthRequired();
        return;
      }

      // A fast Join click can beat the profile-loading effect. Re-read only in
      // that unresolved/error state; otherwise reuse the already loaded server
      // profile. The initial React draft must never become canonical identity.
      let joinProfile = profile;
      if (profileReadyUserId !== authenticatedUser.id || profileLoading || profileError) {
        const currentProfileResult = await fetchOwnProfile();
        if (!currentProfileResult.success) {
          setLeaderboardActionError(currentProfileResult.error ?? "Unable to load your public profile");
          if (currentProfileResult.error === "Not authenticated") onAuthRequired();
          capturePostHogEvent("leaderboard_action", {
            action: "publish",
            result: "error",
            period: activeLeaderboardPeriod,
            error_kind: toAnalyticsErrorKind(currentProfileResult.error),
          });
          return;
        }
        joinProfile = currentProfileResult.data ?? null;
      }

      const joinDraft = profileDraftFromProfile(joinProfile, authenticatedUser, authMetadataAvatarUrl);
      const profileResult = await saveOwnProfile({
        display_name: joinDraft.displayName,
        bio: joinDraft.bio,
        avatar_url: joinDraft.avatarUrl,
        website_url: joinDraft.websiteUrl,
        github_url: joinDraft.githubUrl,
        linkedin_url: joinDraft.linkedinUrl,
        timezone: leaderboardTimezone,
        is_public: joinDraft.isPublic,
      });

      if (!profileResult.success || !profileResult.data) {
        setLeaderboardActionError(profileResult.error ?? "Unable to prepare public profile");
        if (profileResult.error === "Not authenticated") onAuthRequired();
        capturePostHogEvent("leaderboard_action", {
          action: "publish",
          result: "error",
          period: activeLeaderboardPeriod,
          error_kind: toAnalyticsErrorKind(profileResult.error),
        });
        return;
      }

      const nextProfile = profileResult.data;
      setProfile(nextProfile);
      setProfileDraft(profileDraftFromProfile(nextProfile, authenticatedUser, authMetadataAvatarUrl));

      if (!classificationAssessmentReadyRef.current
        || classificationAssessmentRevisionRef.current !== assessmentRevision) {
        const reason = resolveLeaderboardBlockedReason({
          availabilityState: classificationAvailabilityStateRef.current,
          catchingUp: classificationCatchingUpRef.current,
          availabilityReason: classificationAvailabilityReasonRef.current,
        });
        setLeaderboardActionError(getAssessmentBlockedErrorMessage(reason, "pre_publish"));
        return;
      }
      const result = await publishLeaderboardPeriods({
        mode: "join",
        profileDisplayName: nextProfile.display_name,
        leaderboardWindowEndDay,
        timezone: leaderboardTimezone,
        startOfDayMinutes,
        showAiClassificationImpact,
        includeBuiltInHeuristics,
        builtInHeuristicsUnavailableSince,
        publicationAllowed: () => classificationAssessmentReadyRef.current
          && classificationAssessmentRevisionRef.current === assessmentRevision,
        publicationBlockedReason: () => resolveLeaderboardBlockedReason({
          availabilityState: classificationAvailabilityStateRef.current,
          catchingUp: classificationCatchingUpRef.current,
          availabilityReason: classificationAvailabilityReasonRef.current,
        }),
      });

      if (!result.success) {
        setLeaderboardActionError(result.error ?? "Unable to join leaderboard");
        if (result.error === "Not authenticated") onAuthRequired();
        capturePostHogEvent("leaderboard_action", {
          action: "publish",
          result: "error",
          period: activeLeaderboardPeriod,
          segment_count_bucket: toCountBucket(result.data?.segmentCount ?? 0),
          error_kind: toAnalyticsErrorKind(result.error),
        });
        return;
      }

      const publishedAt = new Date().toISOString();
      writeLeaderboardAutoPublishRecords(buildAutoPublishRecords({
        currentRecords: readLeaderboardAutoPublishRecords(),
        userScopeKey: getLeaderboardUserScopeKey(authenticatedUser),
        payloads: result.data?.payloads ?? [],
        publishedAt,
        success: true,
      }));
      leaderboardOptInCacheRef.current = { userScopeKey: getLeaderboardUserScopeKey(authenticatedUser), optedIn: true };
      await refreshLeaderboardData(authenticatedUser);
      capturePostHogEvent("leaderboard_action", {
        action: "publish",
        result: "success",
        period: activeLeaderboardPeriod,
        segment_count_bucket: toCountBucket(result.data?.segmentCount ?? 0),
      });
    } catch (nextError) {
      setLeaderboardActionError(toErrorMessage(nextError));
      capturePostHogEvent("leaderboard_action", {
        action: "publish",
        result: "error",
        period: activeLeaderboardPeriod,
        error_kind: toAnalyticsErrorKind(nextError),
      });
    } finally {
      leaderboardManualActionInFlightRef.current = false;
      setLeaderboardActionLoading(false);
    }
  }, [activeLeaderboardPeriod, allowsEffectiveAnonymousAuth, authMetadataAvatarUrl, builtInHeuristicsUnavailableSince, classificationAssessmentReady, hasRequiredAccountAuth, includeBuiltInHeuristics, isEffectiveAuthRequired, leaderboardTimezone, leaderboardWindowEndDay, onAuthRequired, profile, profileError, profileLoading, profileReadyUserId, refreshLeaderboardData, showAiClassificationImpact, signInAnonymously, startOfDayMinutes, user]);

  const handleLeaderboardOptOut = useCallback(async (options?: { readonly makeProfilePrivate?: boolean }) => {
    setLeaderboardActionLoading(true);
    leaderboardManualActionInFlightRef.current = true;
    setLeaderboardActionError(null);
    const makeProfilePrivate = options?.makeProfilePrivate === true;

    try {
      const optOutResults = await Promise.all(LEADERBOARD_PERIODS.map((period) => optOutLeaderboard(period)));
      const result = optOutResults.find((nextResult) => !nextResult.success) ?? optOutResults[0];
      if (!result.success) {
        setLeaderboardActionError(result.error ?? "Unable to leave leaderboard");
        capturePostHogEvent("leaderboard_action", {
          action: "opt_out",
          result: "error",
          period: activeLeaderboardPeriod,
          error_kind: toAnalyticsErrorKind(result.error),
        });
        return;
      }

      leaderboardOwnEntryScopeRef.current = leaderboardOwnEntryScopeKey;
      leaderboardOptInCacheRef.current = { userScopeKey: leaderboardOwnEntryScopeKey, optedIn: false };
      clearLeaderboardAutoPublishRecordsForUser(leaderboardOwnEntryScopeKey);
      setOwnLeaderboardEntry(null);
      await refreshLeaderboardData();
      if (makeProfilePrivate) {
        const nextDraft = { ...profileDraft, isPublic: false };
        setProfileDraft(nextDraft);
        const hidden = await saveOwnProfile({
          display_name: nextDraft.displayName,
          bio: nextDraft.bio,
          avatar_url: nextDraft.avatarUrl,
          website_url: nextDraft.websiteUrl,
          github_url: nextDraft.githubUrl,
          linkedin_url: nextDraft.linkedinUrl,
          timezone: leaderboardTimezone,
          is_public: false,
        });
        if (!hidden.success) {
          setProfileDraft(profileDraft);
          setLeaderboardActionError(t("leaderboard.leaveProfileStillPublic"));
        }
      }
      capturePostHogEvent("leaderboard_action", {
        action: "opt_out",
        result: "success",
        period: activeLeaderboardPeriod,
        profile_made_private: makeProfilePrivate,
      });
    } catch (nextError) {
      setLeaderboardActionError(toErrorMessage(nextError));
      capturePostHogEvent("leaderboard_action", {
        action: "opt_out",
        result: "error",
        period: activeLeaderboardPeriod,
        error_kind: toAnalyticsErrorKind(nextError),
      });
    } finally {
      leaderboardManualActionInFlightRef.current = false;
      setLeaderboardActionLoading(false);
    }
  }, [activeLeaderboardPeriod, leaderboardOwnEntryScopeKey, leaderboardTimezone, profileDraft, refreshLeaderboardData, t]);

  const saveProfileDraft = useCallback(async (nextDraft: ProfileDraft) => {
    setProfileSaving(true);
    setProfileMessage(null);
    setProfileError(null);

    try {
      const result = await saveOwnProfile({
        display_name: nextDraft.displayName,
        bio: nextDraft.bio,
        avatar_url: nextDraft.avatarUrl,
        website_url: nextDraft.websiteUrl,
        github_url: nextDraft.githubUrl,
        linkedin_url: nextDraft.linkedinUrl,
        timezone: leaderboardTimezone,
        is_public: nextDraft.isPublic,
      });

      if (!result.success || !result.data) {
        setProfileError(result.error ?? "Unable to save profile");
        if (result.error === "Not authenticated") onAuthRequired();
        return false;
      }

      setProfile(result.data);
      setProfileDraft(profileDraftFromProfile(result.data, user, authMetadataAvatarUrl));
      setProfileMessage("Profile saved.");
      if (activeTab === "leaderboard") void refreshLeaderboardData();
      return true;
    } catch (nextError) {
      setProfileError(toErrorMessage(nextError));
      return false;
    } finally {
      setProfileSaving(false);
    }
  }, [activeTab, authMetadataAvatarUrl, leaderboardTimezone, onAuthRequired, refreshLeaderboardData, user]);

  const handleSaveProfile = useCallback(async () => saveProfileDraft(profileDraft), [profileDraft, saveProfileDraft]);

  const handleProfileVisibilityChange = useCallback(async (isPublic: boolean) => {
    const previousDraft = profileDraft;
    const nextDraft = { ...previousDraft, isPublic };
    setProfileDraft(nextDraft);
    const saved = await saveProfileDraft(nextDraft);
    if (!saved) setProfileDraft(previousDraft);
    return saved;
  }, [profileDraft, saveProfileDraft]);

  const handleSaveProfileFromModal = useCallback(async () => {
    const saved = await handleSaveProfile();
    if (saved) setIsProfileEditorOpen(false);
  }, [handleSaveProfile]);

  const handleProfilePhotoSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setProfileError("Choose an image file for your profile photo.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setProfileError("Profile photo must be under 2 MB.");
      return;
    }

    try {
      const avatarUrl = await readImageFileAsDataUrl(file);
      setProfileError(null);
      setProfileMessage(null);
      setProfileDraft((draft) => ({ ...draft, avatarUrl }));
    } catch (nextError) {
      setProfileError(toErrorMessage(nextError));
    }
  }, []);

  const handleShareLeaderboardProfile = useCallback(async () => {
    const publicId = profile?.public_id?.trim();
    if (!publicId) {
      setProfileShareMessage("Save or join first to create your public profile link.");
      return;
    }

    try {
      await copyTextToClipboard(buildPublicProfileUrl(publicId));
      setProfileShareMessage("Copied to clipboard.");
      window.setTimeout(() => setProfileShareMessage(null), 2200);
    } catch (nextError) {
      setProfileShareMessage(toErrorMessage(nextError));
    }
  }, [profile?.public_id]);

  const totalLeaderboardFocusSeconds = useMemo(
    () => leaderboardRows.reduce((sum, row) => sum + Math.max(0, row.focus_seconds_7d), 0),
    [leaderboardRows],
  );

  const handleSelectLeaderboardProfile = useCallback(async (row: LeaderboardRow) => {
    const requestId = ++selectedProfileRequestRef.current;
    setSelectedLeaderboardRow(row);
    setSelectedPublicProfile(null);
    setSelectedProfileError(null);

    if (!row.public_id) {
      setSelectedProfileLoading(false);
      return;
    }

    setSelectedProfileLoading(true);
    try {
      const result = await fetchPublicProfile(row.public_id, row.period);
      if (selectedProfileRequestRef.current !== requestId) return;
      if (!result.success) {
        setSelectedProfileError(result.error ?? "Unable to load profile");
        return;
      }
      setSelectedPublicProfile(result.data ?? null);
    } catch (nextError) {
      if (selectedProfileRequestRef.current !== requestId) return;
      setSelectedProfileError(toErrorMessage(nextError));
    } finally {
      if (selectedProfileRequestRef.current === requestId) setSelectedProfileLoading(false);
    }
  }, []);

  const handleViewOwnLeaderboardProfile = useCallback(async () => {
    if (!scopedOwnLeaderboardEntry) return;
    await handleSelectLeaderboardProfile({
      rank: scopedOwnLeaderboardEntry.rank ?? 0,
      public_id: profile?.public_id ?? null,
      display_name: leaderboardProfileDisplayName,
      avatar_url: profile?.avatar_url ?? "",
      period: scopedOwnLeaderboardEntry.period,
      focus_seconds: scopedOwnLeaderboardEntry.focus_seconds,
      focus_seconds_7d: scopedOwnLeaderboardEntry.focus_seconds_7d,
      window_start_date: scopedOwnLeaderboardEntry.window_start_date,
      window_end_date: scopedOwnLeaderboardEntry.window_end_date,
      updated_at: scopedOwnLeaderboardEntry.updated_at,
    });
  }, [handleSelectLeaderboardProfile, leaderboardProfileDisplayName, profile?.avatar_url, profile?.public_id, scopedOwnLeaderboardEntry]);

  const leaderboardBlockingLoading = leaderboardRefreshing && !leaderboardHasResolvedOnce;
  const leaderboardBlockingError = leaderboardHasLoadedOnce ? null : leaderboardError;
  const leaderboardRefreshStatus = leaderboardRefreshing && leaderboardHasResolvedOnce ? t("leaderboard.refreshingBoard") : null;
  const leaderboardAutoPublishStatus = leaderboardAutoPublishRefreshing && activeTab === "leaderboard" ? t("leaderboard.updatingOwnEntry") : null;
  const leaderboardBackgroundError = leaderboardHasLoadedOnce
    ? leaderboardError ?? (activeTab === "leaderboard" ? leaderboardAutoPublishError : null)
    : null;
  const leaderboardStatusMessage = leaderboardBackgroundError ?? leaderboardAutoPublishStatus ?? leaderboardRefreshStatus;
  const leaderboardStatusTone = leaderboardBackgroundError ? "error" : "neutral";

  return {
    activeLeaderboardPeriod,
    isLeaderboardOptedIn,
    isLeaderboardParticipationResolved,
    isClassificationCatchingUp,
    isClassificationAssessmentReady: classificationAssessmentReady,
    isProfileEditorOpen,
    leaderboardActionError,
    leaderboardActionLoading,
    leaderboardError: leaderboardBlockingError,
    leaderboardLoading: leaderboardBlockingLoading,
    leaderboardLocalMetricsStatus,
    leaderboardStatusMessage,
    leaderboardStatusTone,
    leaderboardProfileBio,
    leaderboardProfileDisplayName,
    leaderboardProfileGithubUrl,
    leaderboardProfileLinkedinUrl,
    leaderboardProfileWebsiteUrl,
    leaderboardSegments,
    leaderboardUsesPreviewProfile,
    leaderboardWindowEndDay,
    leaderboardWindowStartDay,
    localRollingFocusSeconds,
    ownLeaderboardEntry: scopedOwnLeaderboardEntry,
    profile,
    profileDraft,
    profileError,
    profileLoading,
    profileMessage,
    profileReadyUserId,
    profileSaving,
    profileShareMessage,
    publicProfileLiveOffBoard,
    rows: leaderboardRows,
    selectedLeaderboardRow,
    selectedProfileError,
    selectedProfileLoading,
    selectedPublicProfile,
    totalLeaderboardFocusSeconds,
    closeProfileEditor,
    closeSelectedProfile,
    handleLeaderboardOptIn,
    handleLeaderboardOptOut,
    handleProfilePhotoSelected,
    handleProfileVisibilityChange,
    handleSaveProfile,
    handleSaveProfileFromModal,
    handleSelectLeaderboardProfile,
    handleShareLeaderboardProfile,
    handleViewOwnLeaderboardProfile,
    openProfileEditor,
    publishLeaderboardCheckpoint,
    refreshLeaderboardData,
    syncLeaderboardPublication,
    removeProfilePhoto,
    setActiveLeaderboardPeriod,
    updateProfileDraft,
  };
}
