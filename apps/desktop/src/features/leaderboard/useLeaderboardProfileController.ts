import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { buildRollingFocusSeconds, isBrowserHistoryImportSegment } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { shouldUsePreviewData } from "../../lib/api/previewData";
import { trackerClient } from "../../lib/api/trackerClient";
import { capturePostHogEvent, toAnalyticsErrorKind, toCountBucket } from "../../lib/analytics/posthog";
import { getLogicalDayRange, logicalTodayIsoDate, toErrorMessage } from "../../lib/formatting";
import type { AuthState } from "../auth/AuthContext";
import { buildPublicProfileUrl, copyTextToClipboard, type ProfileDraft } from "../profile/ProfileModals";
import { readImageFileAsDataUrl } from "../profile/profileImage";
import { fallbackDisplayName, fetchOwnProfile, fetchPublicProfile, saveOwnProfile } from "../profile/profileService";
import type { PublicProfile, UserProfile } from "../profile/profileService";
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
import { getLeaderboardWindowStartDay } from "./leaderboardWindow";
import {
  DEFAULT_LEADERBOARD_PERIOD,
  LEADERBOARD_PERIODS,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  optOutLeaderboard,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type OwnLeaderboardEntry,
} from "./leaderboardService";
import {
  buildLeaderboardPublishPayloads,
  publishLeaderboardPayloads,
  publishLeaderboardPeriods,
  type LeaderboardPublishPayload,
} from "./leaderboardPublisher";

type UseLeaderboardProfileControllerInput = {
  readonly activeTab: string;
  readonly allowsEffectiveAnonymousAuth: boolean;
  readonly authMetadataAvatarUrl: string;
  readonly hasRequiredAccountAuth: boolean;
  readonly isEffectiveAuthRequired: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly showAiClassificationImpact: boolean;
  readonly signInAnonymously: AuthState["signInAnonymously"];
  readonly startOfDayMinutes: number;
  readonly user: AuthState["user"];
  readonly onAuthRequired: () => void;
};

type UseLeaderboardProfileControllerResult = {
  readonly activeLeaderboardPeriod: LeaderboardPeriod;
  readonly isLeaderboardOptedIn: boolean;
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
  readonly rows: LeaderboardRow[];
  readonly selectedLeaderboardRow: LeaderboardRow | null;
  readonly selectedProfileError: string | null;
  readonly selectedProfileLoading: boolean;
  readonly selectedPublicProfile: PublicProfile | null;
  readonly totalLeaderboardFocusSeconds: number;
  readonly closeProfileEditor: () => void;
  readonly closeSelectedProfile: () => void;
  readonly handleLeaderboardOptIn: () => Promise<void>;
  readonly handleLeaderboardOptOut: () => Promise<void>;
  readonly handleProfilePhotoSelected: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  readonly handleProfileVisibilityChange: (isPublic: boolean) => Promise<boolean>;
  readonly handleSaveProfile: () => Promise<boolean>;
  readonly handleSaveProfileFromModal: () => Promise<void>;
  readonly handleSelectLeaderboardProfile: (row: LeaderboardRow) => Promise<void>;
  readonly handleShareLeaderboardProfile: () => Promise<void>;
  readonly handleViewOwnLeaderboardProfile: () => Promise<void>;
  readonly openProfileEditor: () => void;
  readonly refreshLeaderboardData: () => Promise<void>;
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

function profileDraftFromProfile(profile: UserProfile | null, email: string | null | undefined, authMetadataAvatarUrl: string): ProfileDraft {
  return {
    displayName: profile?.display_name ?? fallbackDisplayName(email),
    bio: profile?.bio ?? "",
    avatarUrl: profile?.avatar_url || authMetadataAvatarUrl,
    websiteUrl: profile?.website_url ?? "",
    githubUrl: profile?.github_url ?? "",
    linkedinUrl: profile?.linkedin_url ?? "",
    // Real server value — the user's visibility choice must survive edits and saves.
    isPublic: profile?.is_public ?? true,
  };
}

function emptyProfileDraft(email: string | null | undefined, authMetadataAvatarUrl: string): ProfileDraft {
  return {
    displayName: fallbackDisplayName(email),
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

export function useLeaderboardProfileController({
  activeTab,
  allowsEffectiveAnonymousAuth,
  authMetadataAvatarUrl,
  hasRequiredAccountAuth,
  isEffectiveAuthRequired,
  isSupabaseConfigured,
  showAiClassificationImpact,
  signInAnonymously,
  startOfDayMinutes,
  user,
  onAuthRequired,
}: UseLeaderboardProfileControllerInput): UseLeaderboardProfileControllerResult {
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
  const leaderboardManualActionInFlightRef = useRef(false);
  const leaderboardOptInCacheRef = useRef<LeaderboardOptInCache | null>(null);
  const leaderboardAutoPublishDayRef = useRef<string | null>(null);
  const [leaderboardAutoPublishRefreshing, setLeaderboardAutoPublishRefreshing] = useState(false);
  const [leaderboardAutoPublishError, setLeaderboardAutoPublishError] = useState<string | null>(null);

  const leaderboardWindowEndDay = logicalTodayIsoDate(startOfDayMinutes);
  // The profile hero is explicitly labelled "this week". Keep its local range
  // stable while the public board switches between daily, weekly, and monthly.
  const leaderboardWindowStartDay = getLeaderboardWindowStartDay(leaderboardWindowEndDay, "weekly");
  const leaderboardLocalMetricsScopeKey = `${leaderboardWindowStartDay}:${leaderboardWindowEndDay}:${startOfDayMinutes}`;
  const publishableLeaderboardSegments = useMemo<ActivitySegment[]>(
    () => leaderboardSegments.filter((segment: ActivitySegment) => !isBrowserHistoryImportSegment(segment)),
    [leaderboardSegments],
  );
  const leaderboardClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: publishableLeaderboardSegments, includeAiClassifications: showAiClassificationImpact }),
    [publishableLeaderboardSegments, showAiClassificationImpact],
  );
  const localRollingFocusSeconds = useMemo(
    () => leaderboardLocalMetricsStatus === "ready" && leaderboardLocalMetricsScopeRef.current === leaderboardLocalMetricsScopeKey
      ? buildRollingFocusSeconds(publishableLeaderboardSegments, leaderboardWindowStartDay, leaderboardWindowEndDay, leaderboardClassificationOptions, startOfDayMinutes)
      : 0,
    [leaderboardClassificationOptions, leaderboardLocalMetricsScopeKey, leaderboardLocalMetricsStatus, leaderboardWindowEndDay, leaderboardWindowStartDay, publishableLeaderboardSegments, startOfDayMinutes],
  );
  const leaderboardProfileDisplayName = useMemo(() => profile?.display_name || fallbackDisplayName(user?.email), [profile?.display_name, user?.email]);
  const leaderboardUsesPreviewProfile = shouldUsePreviewData();
  const leaderboardProfileBio = profile?.bio || profileDraft.bio || (leaderboardUsesPreviewProfile ? "Building quiet tools for deeper work." : "");
  const leaderboardProfileWebsiteUrl = profile?.website_url || profileDraft.websiteUrl || (leaderboardUsesPreviewProfile ? "drifty.so/drifty" : "");
  const leaderboardProfileGithubUrl = profile?.github_url || profileDraft.githubUrl || (leaderboardUsesPreviewProfile ? "github.com/edgethink00" : "");
  const leaderboardProfileLinkedinUrl = profile?.linkedin_url || profileDraft.linkedinUrl || (leaderboardUsesPreviewProfile ? "linkedin.com/in/drifty" : "");
  const leaderboardTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const isPolicySignedIn = Boolean(user) && (!isEffectiveAuthRequired || hasRequiredAccountAuth);
  const leaderboardOwnEntryScopeKey = isPolicySignedIn ? getLeaderboardUserScopeKey(user) : "signed-out";
  const scopedOwnLeaderboardEntry = leaderboardOwnEntryScopeRef.current === leaderboardOwnEntryScopeKey ? ownLeaderboardEntry : null;
  const isLeaderboardOptedIn = scopedOwnLeaderboardEntry?.opted_in === true;

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

  const refreshLeaderboardData = useCallback(async (authenticatedUser = user) => {
    const requestId = ++leaderboardRefreshRequestRef.current;
    const hasResolvedLeaderboardState = leaderboardHasResolvedOnceRef.current;
    const shouldPreserveLeaderboardState = leaderboardHasLoadedOnceRef.current;
    const canLoadOwnLeaderboardEntry = Boolean(authenticatedUser) && (!isEffectiveAuthRequired || hasRequiredAccountAuth);
    const authenticatedUserScopeKey = canLoadOwnLeaderboardEntry ? getLeaderboardUserScopeKey(authenticatedUser) : "signed-out";

    if (!isSupabaseConfigured && !shouldUsePreviewData()) {
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
        fetchGlobalLeaderboard(activeLeaderboardPeriod, 100),
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
        capturePostHogEvent("leaderboard_action", {
          action: "load",
          result: "error",
          period: activeLeaderboardPeriod,
          error_kind: toAnalyticsErrorKind(globalResult.error),
        });
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
        capturePostHogEvent("leaderboard_action", {
          action: "load",
          result: "error",
          period: activeLeaderboardPeriod,
          row_count_bucket: toCountBucket((globalResult.data ?? []).length),
          error_kind: toAnalyticsErrorKind(ownResult.error),
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
      capturePostHogEvent("leaderboard_action", {
        action: "load",
        result: "success",
        period: activeLeaderboardPeriod,
        row_count_bucket: toCountBucket((globalResult.data ?? []).length),
      });
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
      capturePostHogEvent("leaderboard_action", {
        action: "load",
        result: "error",
        period: activeLeaderboardPeriod,
        error_kind: toAnalyticsErrorKind(nextError),
      });
    } finally {
      if (leaderboardRefreshRequestRef.current === requestId) setLeaderboardRefreshing(false);
    }
  }, [activeLeaderboardPeriod, hasRequiredAccountAuth, isEffectiveAuthRequired, isSupabaseConfigured, refreshLeaderboardLocalMetrics, user]);

  useEffect(() => {
    if (!isSupabaseConfigured && !shouldUsePreviewData()) {
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

    void refreshLeaderboardData();
  }, [activeTab, isSupabaseConfigured, refreshLeaderboardData]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user || (isEffectiveAuthRequired && !hasRequiredAccountAuth)) {
      setProfile(null);
      setProfileDraft(emptyProfileDraft(user?.email, authMetadataAvatarUrl));
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
        setProfileDraft(emptyProfileDraft(user.email, authMetadataAvatarUrl));
        setProfileError(result.error ?? "Unable to load profile");
      } else {
        const nextProfile = result.data ?? null;
        setProfile(nextProfile);
        setProfileDraft(profileDraftFromProfile(nextProfile, user.email, authMetadataAvatarUrl));
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
  }, [leaderboardOwnEntryScopeKey, leaderboardTimezone, leaderboardWindowEndDay, profile?.display_name, profileError, profileLoading, profileReadyUserId, showAiClassificationImpact, startOfDayMinutes, user?.id]);

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

  const syncLeaderboardPublication = useCallback(async (
    reason: LeaderboardAutoPublishReason,
    options: LeaderboardAutoPublishOptions = {},
  ) => {
    if (!isSupabaseConfigured || shouldUsePreviewData()) return;
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
      if (!prepared) return;
      let publishablePrepared = prepared;
      preparedForFailure = publishablePrepared;

      const requiresRemoteCheck = prepared.decisions.some((decision) => decision.requiresRemoteOptInCheck);
      const optInConfirmation = await confirmLeaderboardOptInForAutoPublish(requiresRemoteCheck);
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
        capturePostHogEvent("leaderboard_action", {
          action: "publish",
          result: "error",
          period: activeLeaderboardPeriod,
          segment_count_bucket: toCountBucket(publishablePrepared.segmentCount),
          error_kind: toAnalyticsErrorKind(result.error),
        });
        return;
      }

      setLeaderboardAutoPublishError(null);
      capturePostHogEvent("leaderboard_action", {
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
      capturePostHogEvent("leaderboard_action", {
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
    if (shouldUsePreviewData()) return undefined;
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
    setSelectedLeaderboardRow(null);
    setSelectedPublicProfile(null);
    setSelectedProfileError(null);
  }, []);

  const handleLeaderboardOptIn = useCallback(async () => {
    setLeaderboardActionLoading(true);
    leaderboardManualActionInFlightRef.current = true;
    setLeaderboardActionError(null);
    setProfileError(null);

    try {
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

      const profileResult = await saveOwnProfile({
        display_name: profileDraft.displayName,
        bio: profileDraft.bio,
        avatar_url: profileDraft.avatarUrl,
        website_url: profileDraft.websiteUrl,
        github_url: profileDraft.githubUrl,
        linkedin_url: profileDraft.linkedinUrl,
        timezone: leaderboardTimezone,
        is_public: profileDraft.isPublic,
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
      setProfileDraft(profileDraftFromProfile(nextProfile, authenticatedUser?.email, authMetadataAvatarUrl));

      const result = await publishLeaderboardPeriods({
        mode: "join",
        profileDisplayName: nextProfile.display_name,
        leaderboardWindowEndDay,
        timezone: leaderboardTimezone,
        startOfDayMinutes,
        showAiClassificationImpact,
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
  }, [allowsEffectiveAnonymousAuth, authMetadataAvatarUrl, hasRequiredAccountAuth, isEffectiveAuthRequired, leaderboardTimezone, leaderboardWindowEndDay, onAuthRequired, profileDraft, refreshLeaderboardData, showAiClassificationImpact, signInAnonymously, startOfDayMinutes, user]);

  const handleLeaderboardOptOut = useCallback(async () => {
    setLeaderboardActionLoading(true);
    leaderboardManualActionInFlightRef.current = true;
    setLeaderboardActionError(null);

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
      capturePostHogEvent("leaderboard_action", {
        action: "opt_out",
        result: "success",
        period: activeLeaderboardPeriod,
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
  }, [leaderboardOwnEntryScopeKey, refreshLeaderboardData]);

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
      setProfileDraft(profileDraftFromProfile(result.data, user?.email, authMetadataAvatarUrl));
      setProfileMessage("Profile saved.");
      if (activeTab === "leaderboard") void refreshLeaderboardData();
      return true;
    } catch (nextError) {
      setProfileError(toErrorMessage(nextError));
      return false;
    } finally {
      setProfileSaving(false);
    }
  }, [activeTab, authMetadataAvatarUrl, leaderboardTimezone, onAuthRequired, refreshLeaderboardData, user?.email]);

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
      if (!result.success) {
        setSelectedProfileError(result.error ?? "Unable to load profile");
        return;
      }
      setSelectedPublicProfile(result.data ?? null);
    } catch (nextError) {
      setSelectedProfileError(toErrorMessage(nextError));
    } finally {
      setSelectedProfileLoading(false);
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
  const leaderboardRefreshStatus = leaderboardRefreshing && leaderboardHasResolvedOnce ? "Refreshing leaderboard" : null;
  const leaderboardAutoPublishStatus = leaderboardAutoPublishRefreshing && activeTab === "leaderboard" ? "Updating your leaderboard" : null;
  const leaderboardBackgroundError = leaderboardHasLoadedOnce
    ? leaderboardError ?? (activeTab === "leaderboard" ? leaderboardAutoPublishError : null)
    : null;
  const leaderboardStatusMessage = leaderboardBackgroundError ?? leaderboardAutoPublishStatus ?? leaderboardRefreshStatus;
  const leaderboardStatusTone = leaderboardBackgroundError ? "error" : "neutral";

  return {
    activeLeaderboardPeriod,
    isLeaderboardOptedIn,
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
    refreshLeaderboardData,
    syncLeaderboardPublication,
    removeProfilePhoto,
    setActiveLeaderboardPeriod,
    updateProfileDraft,
  };
}
