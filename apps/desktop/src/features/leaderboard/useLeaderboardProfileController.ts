import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { buildRollingFocusSeconds } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { shouldUsePreviewData } from "../../lib/api/previewData";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange, logicalTodayIsoDate, toErrorMessage } from "../../lib/formatting";
import type { AuthState } from "../auth/AuthContext";
import { buildPublicProfileUrl, copyTextToClipboard, readImageFileAsDataUrl, type ProfileDraft } from "../profile/ProfileModals";
import { fallbackDisplayName, fetchOwnProfile, fetchPublicProfile, saveOwnProfile } from "../profile/profileService";
import type { PublicProfile, UserProfile } from "../profile/profileService";
import { getLeaderboardWindowStartDay } from "./leaderboardWindow";
import {
  DEFAULT_LEADERBOARD_PERIOD,
  LEADERBOARD_PERIODS,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  optOutLeaderboard,
  publishOwnFocusTotal,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type OwnLeaderboardEntry,
} from "./leaderboardService";

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
  readonly handleSaveProfileFromModal: () => Promise<void>;
  readonly handleSelectLeaderboardProfile: (row: LeaderboardRow) => Promise<void>;
  readonly handleShareLeaderboardProfile: () => Promise<void>;
  readonly handleViewOwnLeaderboardProfile: () => Promise<void>;
  readonly openProfileEditor: () => void;
  readonly refreshLeaderboardData: () => Promise<void>;
  readonly removeProfilePhoto: () => void;
  readonly setActiveLeaderboardPeriod: Dispatch<SetStateAction<LeaderboardPeriod>>;
  readonly updateProfileDraft: (updater: Partial<ProfileDraft>) => void;
};

function profileDraftFromProfile(profile: UserProfile | null, email: string | null | undefined, authMetadataAvatarUrl: string): ProfileDraft {
  return {
    displayName: profile?.display_name ?? fallbackDisplayName(email),
    bio: profile?.bio ?? "",
    avatarUrl: profile?.avatar_url || authMetadataAvatarUrl,
    websiteUrl: profile?.website_url ?? "",
    githubUrl: profile?.github_url ?? "",
    linkedinUrl: profile?.linkedin_url ?? "",
    isPublic: true,
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
    isPublic: true,
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
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
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
  const leaderboardRefreshRequestRef = useRef(0);

  const leaderboardWindowEndDay = logicalTodayIsoDate(startOfDayMinutes);
  const leaderboardWindowStartDay = getLeaderboardWindowStartDay(leaderboardWindowEndDay, activeLeaderboardPeriod);
  const leaderboardClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: leaderboardSegments, includeAiClassifications: showAiClassificationImpact }),
    [leaderboardSegments, showAiClassificationImpact],
  );
  const localRollingFocusSeconds = useMemo(
    () => buildRollingFocusSeconds(leaderboardSegments, leaderboardWindowStartDay, leaderboardWindowEndDay, leaderboardClassificationOptions, startOfDayMinutes),
    [leaderboardClassificationOptions, leaderboardSegments, leaderboardWindowEndDay, leaderboardWindowStartDay, startOfDayMinutes],
  );
  const leaderboardProfileDisplayName = useMemo(() => profile?.display_name || fallbackDisplayName(user?.email), [profile?.display_name, user?.email]);
  const leaderboardUsesPreviewProfile = shouldUsePreviewData();
  const leaderboardProfileBio = profile?.bio || profileDraft.bio || (leaderboardUsesPreviewProfile ? "Building quiet tools for deeper work." : "");
  const leaderboardProfileWebsiteUrl = profile?.website_url || profileDraft.websiteUrl || (leaderboardUsesPreviewProfile ? "drifty.so/drifty" : "");
  const leaderboardProfileGithubUrl = profile?.github_url || profileDraft.githubUrl || (leaderboardUsesPreviewProfile ? "github.com/edgethink00" : "");
  const leaderboardProfileLinkedinUrl = profile?.linkedin_url || profileDraft.linkedinUrl || (leaderboardUsesPreviewProfile ? "linkedin.com/in/drifty" : "");
  const leaderboardTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const isLeaderboardOptedIn = ownLeaderboardEntry?.opted_in === true;

  const refreshLeaderboardData = useCallback(async () => {
    const requestId = ++leaderboardRefreshRequestRef.current;

    if (!isSupabaseConfigured && !shouldUsePreviewData()) {
      setLeaderboardRows([]);
      setOwnLeaderboardEntry(null);
      setLeaderboardSegments([]);
      setLeaderboardLoading(false);
      setLeaderboardError(null);
      return;
    }

    setLeaderboardLoading(true);
    setLeaderboardError(null);

    try {
      const [globalResult, ownResult, leaderboardTimeline] = await Promise.all([
        fetchGlobalLeaderboard(activeLeaderboardPeriod, 100),
        user ? fetchOwnLeaderboardEntry(activeLeaderboardPeriod) : Promise.resolve({ success: true, error: null, data: null }),
        trackerClient.getTimeline(getLogicalDayRange(leaderboardWindowStartDay, leaderboardWindowEndDay, startOfDayMinutes)),
      ]);

      if (leaderboardRefreshRequestRef.current !== requestId) return;

      if (!globalResult.success) {
        setLeaderboardRows([]);
        setOwnLeaderboardEntry(null);
        setLeaderboardSegments([]);
        setLeaderboardError(globalResult.error ?? "Unable to load leaderboard");
        return;
      }

      if (!ownResult.success) {
        setLeaderboardRows(globalResult.data ?? []);
        setOwnLeaderboardEntry(null);
        setLeaderboardSegments(leaderboardTimeline);
        setLeaderboardError(ownResult.error ?? "Unable to load your leaderboard status");
        return;
      }

      setLeaderboardRows(globalResult.data ?? []);
      setOwnLeaderboardEntry(ownResult.data ?? null);
      setLeaderboardSegments(leaderboardTimeline);
    } catch (nextError) {
      if (leaderboardRefreshRequestRef.current !== requestId) return;
      setLeaderboardRows([]);
      setOwnLeaderboardEntry(null);
      setLeaderboardSegments([]);
      setLeaderboardError(toErrorMessage(nextError));
    } finally {
      if (leaderboardRefreshRequestRef.current === requestId) setLeaderboardLoading(false);
    }
  }, [activeLeaderboardPeriod, isSupabaseConfigured, leaderboardWindowEndDay, leaderboardWindowStartDay, startOfDayMinutes, user]);

  useEffect(() => {
    if (!isSupabaseConfigured && !shouldUsePreviewData()) {
      setLeaderboardRows([]);
      setOwnLeaderboardEntry(null);
      setLeaderboardSegments([]);
      setLeaderboardLoading(false);
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

  const updateProfileDraft = useCallback((updater: Partial<ProfileDraft>) => {
    setProfileDraft((draft) => ({ ...draft, ...updater, isPublic: true }));
  }, []);

  const removeProfilePhoto = useCallback(() => {
    setProfileDraft((draft) => ({ ...draft, avatarUrl: "", isPublic: true }));
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
    setLeaderboardActionError(null);
    setProfileError(null);

    try {
      if (isEffectiveAuthRequired && !hasRequiredAccountAuth) {
        onAuthRequired();
        setLeaderboardActionError("Sign in with a drifty.so account before joining the beta leaderboard.");
        return;
      }

      if (!user) {
        if (!allowsEffectiveAnonymousAuth) {
          onAuthRequired();
          setLeaderboardActionError("Sign in before joining the beta leaderboard.");
          return;
        }

        const anonymousResult = await signInAnonymously();
        if (anonymousResult.error || !anonymousResult.user) {
          setLeaderboardActionError(anonymousResult.error?.message ?? "Unable to join leaderboard without a beta session.");
          return;
        }
      }

      const profileResult = await saveOwnProfile({
        display_name: profileDraft.displayName,
        bio: profileDraft.bio,
        avatar_url: profileDraft.avatarUrl,
        website_url: profileDraft.websiteUrl,
        github_url: profileDraft.githubUrl,
        linkedin_url: profileDraft.linkedinUrl,
        timezone: leaderboardTimezone,
        is_public: true,
      });

      if (!profileResult.success || !profileResult.data) {
        setLeaderboardActionError(profileResult.error ?? "Unable to prepare public profile");
        if (profileResult.error === "Not authenticated") onAuthRequired();
        return;
      }

      const nextProfile = profileResult.data;
      setProfile(nextProfile);
      setProfileDraft(profileDraftFromProfile(nextProfile, user?.email, authMetadataAvatarUrl));

      const allPeriodWindowStartDay = getLeaderboardWindowStartDay(leaderboardWindowEndDay, "monthly");
      const allPeriodSegments = await trackerClient.getTimeline(getLogicalDayRange(allPeriodWindowStartDay, leaderboardWindowEndDay, startOfDayMinutes));
      const publishResults = await Promise.all(LEADERBOARD_PERIODS.map((period) => {
        const windowStartDay = getLeaderboardWindowStartDay(leaderboardWindowEndDay, period);
        const focusSeconds = buildRollingFocusSeconds(allPeriodSegments, windowStartDay, leaderboardWindowEndDay, {
          fallbackCandidates: allPeriodSegments,
          includeAiClassifications: showAiClassificationImpact,
        }, startOfDayMinutes);
        return publishOwnFocusTotal({
          profileDisplayName: nextProfile.display_name,
          period,
          focus_seconds: focusSeconds,
          focus_seconds_7d: focusSeconds,
          window_start_date: windowStartDay,
          window_end_date: leaderboardWindowEndDay,
          timezone: leaderboardTimezone,
        });
      }));
      const result = publishResults.find((nextResult) => !nextResult.success) ?? publishResults[0];

      if (!result.success) {
        setLeaderboardActionError(result.error ?? "Unable to join leaderboard");
        if (result.error === "Not authenticated") onAuthRequired();
        return;
      }

      await refreshLeaderboardData();
    } catch (nextError) {
      setLeaderboardActionError(toErrorMessage(nextError));
    } finally {
      setLeaderboardActionLoading(false);
    }
  }, [allowsEffectiveAnonymousAuth, authMetadataAvatarUrl, hasRequiredAccountAuth, isEffectiveAuthRequired, leaderboardTimezone, leaderboardWindowEndDay, onAuthRequired, profileDraft, refreshLeaderboardData, showAiClassificationImpact, signInAnonymously, startOfDayMinutes, user]);

  const handleLeaderboardOptOut = useCallback(async () => {
    setLeaderboardActionLoading(true);
    setLeaderboardActionError(null);

    try {
      const optOutResults = await Promise.all(LEADERBOARD_PERIODS.map((period) => optOutLeaderboard(period)));
      const result = optOutResults.find((nextResult) => !nextResult.success) ?? optOutResults[0];
      if (!result.success) {
        setLeaderboardActionError(result.error ?? "Unable to leave leaderboard");
        return;
      }

      await refreshLeaderboardData();
    } catch (nextError) {
      setLeaderboardActionError(toErrorMessage(nextError));
    } finally {
      setLeaderboardActionLoading(false);
    }
  }, [refreshLeaderboardData]);

  const handleSaveProfile = useCallback(async () => {
    setProfileSaving(true);
    setProfileMessage(null);
    setProfileError(null);

    try {
      const result = await saveOwnProfile({
        display_name: profileDraft.displayName,
        bio: profileDraft.bio,
        avatar_url: profileDraft.avatarUrl,
        website_url: profileDraft.websiteUrl,
        github_url: profileDraft.githubUrl,
        linkedin_url: profileDraft.linkedinUrl,
        timezone: leaderboardTimezone,
        is_public: true,
      });

      if (!result.success || !result.data) {
        setProfileError(result.error ?? "Unable to save profile");
        return false;
      }

      setProfile(result.data);
      setProfileDraft(profileDraftFromProfile(result.data, user?.email, authMetadataAvatarUrl));
      setProfileMessage("Profile saved.");
      if (activeTab === "leaderboard") await refreshLeaderboardData();
      return true;
    } catch (nextError) {
      setProfileError(toErrorMessage(nextError));
      return false;
    } finally {
      setProfileSaving(false);
    }
  }, [activeTab, authMetadataAvatarUrl, leaderboardTimezone, profileDraft, refreshLeaderboardData, user?.email]);

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
      setProfileDraft((draft) => ({ ...draft, avatarUrl, isPublic: true }));
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
    if (!ownLeaderboardEntry) return;
    await handleSelectLeaderboardProfile({
      rank: ownLeaderboardEntry.rank ?? 0,
      public_id: profile?.public_id ?? null,
      display_name: leaderboardProfileDisplayName,
      avatar_url: profile?.avatar_url ?? "",
      period: ownLeaderboardEntry.period,
      focus_seconds: ownLeaderboardEntry.focus_seconds,
      focus_seconds_7d: ownLeaderboardEntry.focus_seconds_7d,
      window_start_date: ownLeaderboardEntry.window_start_date,
      window_end_date: ownLeaderboardEntry.window_end_date,
      updated_at: ownLeaderboardEntry.updated_at,
    });
  }, [handleSelectLeaderboardProfile, leaderboardProfileDisplayName, ownLeaderboardEntry, profile?.avatar_url, profile?.public_id]);

  return {
    activeLeaderboardPeriod,
    isLeaderboardOptedIn,
    isProfileEditorOpen,
    leaderboardActionError,
    leaderboardActionLoading,
    leaderboardError,
    leaderboardLoading,
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
    ownLeaderboardEntry,
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
    handleSaveProfileFromModal,
    handleSelectLeaderboardProfile,
    handleShareLeaderboardProfile,
    handleViewOwnLeaderboardProfile,
    openProfileEditor,
    refreshLeaderboardData,
    removeProfilePhoto,
    setActiveLeaderboardPeriod,
    updateProfileDraft,
  };
}
