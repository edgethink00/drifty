import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import type { DriftAlarmCopySettingsValue } from "./driftAlarmCopy";
import { buildDefaultDriftAlarmCopy } from "./driftAlarmCopy";
import {
  persistDriftAlarmCopyOverrides,
  resolveDriftAlarmCopy,
  resolveInitialDriftAlarmCopyOverrides,
  type DriftAlarmCopyOverrides,
} from "./driftAlarmCopyStorage";
import type { DisplayLanguage } from "../localization/languagePreference";
import {
  persistCelebrationsEnabled,
  persistDayReviewEnabled,
  persistMacosNotificationEnabled,
  resolveInitialCelebrationsEnabled,
  resolveInitialDayReviewEnabled,
  resolveInitialMacosNotificationEnabled,
} from "./companionMomentPreferences";
import { persistQuietHours, resolveInitialQuietHours, type QuietHoursSettings } from "./quietHours";
import {
  DRIFT_ALERTS_STORAGE_KEY,
  DRIFT_ALERT_DELAY_STORAGE_KEY,
  EXTREME_NUDGE_STORAGE_KEY,
  resolveInitialDriftAlertDelaySeconds,
  resolveInitialDriftAlertsEnabled,
  resolveInitialExtremeNudgeEnabled,
  type DriftAlertDelaySeconds,
} from "./driftAlarmData";
import {
  DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES,
  WATCHER_MODE_STORAGE_KEY,
  WATCHER_PEEK_STORAGE_KEY,
  WATCHER_PERIODIC_MAX_STORAGE_KEY,
  WATCHER_PERIODIC_MIN_STORAGE_KEY,
  normalizeWatcherPeriodicMinutes,
  resolveInitialWatcherMode,
  resolveInitialWatcherPeekEnabled,
  resolveInitialWatcherPeriodicMinutes,
  type WatcherMode,
} from "./watcherData";
import {
  PET_MODE_COAT_STORAGE_KEY,
  PET_MODE_RUN_BETA_STORAGE_KEY,
  PET_MODE_SIZE_STORAGE_KEY,
  PET_MODE_STORAGE_KEY,
  resolveInitialPetModeCoat,
  resolveInitialPetModeEnabled,
  resolveInitialPetModeRunBetaEnabled,
  resolveInitialPetModeSize,
  type PetModeCoat,
  type PetModeSize,
} from "../pet-mode/petModeData";

type UseCompanionSettingsControllerResult = {
  readonly celebrationsEnabled: boolean;
  readonly dayReviewEnabled: boolean;
  readonly driftAlertDelaySeconds: DriftAlertDelaySeconds;
  readonly driftAlertsEnabled: boolean;
  /** Current-language defaults with the user's edits applied. */
  readonly driftAlarmCopy: DriftAlarmCopySettingsValue;
  /** What the editor shows as "default" for the current language. */
  readonly driftAlarmCopyDefaults: DriftAlarmCopySettingsValue;
  readonly extremeNudgeEnabled: boolean;
  readonly macosNotificationEnabled: boolean;
  readonly petModeEnabled: boolean;
  readonly petModeCoat: PetModeCoat;
  readonly petModeRunBetaEnabled: boolean;
  readonly petModeSize: PetModeSize;
  readonly quietHours: QuietHoursSettings;
  readonly handleWatcherPeriodicMaxChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleWatcherPeriodicMinChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly setCelebrationsEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setDayReviewEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setDriftAlertDelaySeconds: Dispatch<SetStateAction<DriftAlertDelaySeconds>>;
  readonly setDriftAlarmCopyOverrides: Dispatch<SetStateAction<DriftAlarmCopyOverrides>>;
  readonly setDriftAlertsEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setExtremeNudgeEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setMacosNotificationEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setPetModeEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setPetModeCoat: Dispatch<SetStateAction<PetModeCoat>>;
  readonly setPetModeRunBetaEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setPetModeSize: Dispatch<SetStateAction<PetModeSize>>;
  readonly setQuietHours: Dispatch<SetStateAction<QuietHoursSettings>>;
  readonly setWatcherMode: Dispatch<SetStateAction<WatcherMode>>;
  readonly setWatcherPeekEnabled: Dispatch<SetStateAction<boolean>>;
  readonly watcherMode: WatcherMode;
  readonly watcherPeekEnabled: boolean;
  readonly watcherPeriodicMaxMinutes: number;
  readonly watcherPeriodicMinMinutes: number;
};

export function useCompanionSettingsController({
  language,
}: {
  readonly language: DisplayLanguage;
}): UseCompanionSettingsControllerResult {
  const [driftAlertsEnabled, setDriftAlertsEnabled] = useState(resolveInitialDriftAlertsEnabled);
  const [driftAlertDelaySeconds, setDriftAlertDelaySeconds] = useState<DriftAlertDelaySeconds>(resolveInitialDriftAlertDelaySeconds);
  const [driftAlarmCopyOverrides, setDriftAlarmCopyOverrides] = useState(resolveInitialDriftAlarmCopyOverrides);
  const driftAlarmCopyDefaults = useMemo(() => buildDefaultDriftAlarmCopy(language), [language]);
  const driftAlarmCopy = useMemo(
    () => resolveDriftAlarmCopy(driftAlarmCopyOverrides, language),
    [driftAlarmCopyOverrides, language],
  );
  const [extremeNudgeEnabled, setExtremeNudgeEnabled] = useState(() => resolveInitialDriftAlertsEnabled() && resolveInitialExtremeNudgeEnabled());
  const [macosNotificationEnabled, setMacosNotificationEnabled] = useState(resolveInitialMacosNotificationEnabled);
  const [celebrationsEnabled, setCelebrationsEnabled] = useState(resolveInitialCelebrationsEnabled);
  const [dayReviewEnabled, setDayReviewEnabled] = useState(resolveInitialDayReviewEnabled);
  const [quietHours, setQuietHours] = useState<QuietHoursSettings>(resolveInitialQuietHours);
  const [petModeEnabled, setPetModeEnabled] = useState(resolveInitialPetModeEnabled);
  const [petModeCoat, setPetModeCoat] = useState<PetModeCoat>(resolveInitialPetModeCoat);
  const [petModeRunBetaEnabled, setPetModeRunBetaEnabled] = useState(resolveInitialPetModeRunBetaEnabled);
  const [petModeSize, setPetModeSize] = useState<PetModeSize>(resolveInitialPetModeSize);
  const [watcherPeekEnabled, setWatcherPeekEnabled] = useState(resolveInitialWatcherPeekEnabled);
  const [watcherMode, setWatcherMode] = useState<WatcherMode>(resolveInitialWatcherMode);
  const [watcherPeriodicMinMinutes, setWatcherPeriodicMinMinutes] = useState(() => resolveInitialWatcherPeriodicMinutes("min"));
  const [watcherPeriodicMaxMinutes, setWatcherPeriodicMaxMinutes] = useState(() => resolveInitialWatcherPeriodicMinutes("max"));

  const handleWatcherPeriodicMinChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = normalizeWatcherPeriodicMinutes(event.target.value, DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES.min);
    setWatcherPeriodicMinMinutes(nextValue);
    setWatcherPeriodicMaxMinutes((currentValue) => Math.max(currentValue, nextValue));
  }, []);

  const handleWatcherPeriodicMaxChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = normalizeWatcherPeriodicMinutes(event.target.value, DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES.max);
    setWatcherPeriodicMaxMinutes(Math.max(nextValue, watcherPeriodicMinMinutes));
  }, [watcherPeriodicMinMinutes]);

  useEffect(() => {
    window.localStorage.setItem(DRIFT_ALERTS_STORAGE_KEY, driftAlertsEnabled ? "1" : "0");
  }, [driftAlertsEnabled]);

  useEffect(() => {
    if (!driftAlertsEnabled && extremeNudgeEnabled) setExtremeNudgeEnabled(false);
  }, [driftAlertsEnabled, extremeNudgeEnabled]);

  useEffect(() => {
    window.localStorage.setItem(DRIFT_ALERT_DELAY_STORAGE_KEY, String(driftAlertDelaySeconds));
  }, [driftAlertDelaySeconds]);

  useEffect(() => {
    persistDriftAlarmCopyOverrides(driftAlarmCopyOverrides);
  }, [driftAlarmCopyOverrides]);

  useEffect(() => {
    window.localStorage.setItem(EXTREME_NUDGE_STORAGE_KEY, extremeNudgeEnabled ? "1" : "0");
  }, [extremeNudgeEnabled]);

  useEffect(() => {
    persistMacosNotificationEnabled(macosNotificationEnabled);
  }, [macosNotificationEnabled]);

  useEffect(() => {
    persistCelebrationsEnabled(celebrationsEnabled);
  }, [celebrationsEnabled]);

  useEffect(() => {
    persistDayReviewEnabled(dayReviewEnabled);
  }, [dayReviewEnabled]);

  useEffect(() => {
    persistQuietHours(quietHours);
  }, [quietHours]);

  useEffect(() => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, petModeEnabled ? "1" : "0");
  }, [petModeEnabled]);

  // The pet webview reads this key on mount and via `storage`, so persisting
  // it is the whole cross-window handoff. Writing it unconditionally keeps a
  // coat chosen while the pet is off applied the next time it appears.
  useEffect(() => {
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, petModeCoat);
  }, [petModeCoat]);

  useEffect(() => {
    window.localStorage.setItem(PET_MODE_RUN_BETA_STORAGE_KEY, petModeRunBetaEnabled ? "1" : "0");
  }, [petModeRunBetaEnabled]);

  useEffect(() => {
    window.localStorage.setItem(PET_MODE_SIZE_STORAGE_KEY, String(petModeSize));
  }, [petModeSize]);

  useEffect(() => {
    window.localStorage.setItem(WATCHER_PEEK_STORAGE_KEY, watcherPeekEnabled ? "1" : "0");
  }, [watcherPeekEnabled]);

  useEffect(() => {
    window.localStorage.setItem(WATCHER_MODE_STORAGE_KEY, watcherMode);
  }, [watcherMode]);

  useEffect(() => {
    window.localStorage.setItem(WATCHER_PERIODIC_MIN_STORAGE_KEY, String(watcherPeriodicMinMinutes));
  }, [watcherPeriodicMinMinutes]);

  useEffect(() => {
    window.localStorage.setItem(WATCHER_PERIODIC_MAX_STORAGE_KEY, String(watcherPeriodicMaxMinutes));
  }, [watcherPeriodicMaxMinutes]);

  useEffect(() => {
    if (watcherPeriodicMaxMinutes < watcherPeriodicMinMinutes) setWatcherPeriodicMaxMinutes(watcherPeriodicMinMinutes);
  }, [watcherPeriodicMaxMinutes, watcherPeriodicMinMinutes]);

  return {
    celebrationsEnabled,
    dayReviewEnabled,
    driftAlertDelaySeconds,
    driftAlertsEnabled,
    driftAlarmCopy,
    driftAlarmCopyDefaults,
    extremeNudgeEnabled,
    macosNotificationEnabled,
    petModeEnabled,
    petModeCoat,
    petModeRunBetaEnabled,
    petModeSize,
    quietHours,
    handleWatcherPeriodicMaxChange,
    handleWatcherPeriodicMinChange,
    setCelebrationsEnabled,
    setDayReviewEnabled,
    setDriftAlertDelaySeconds,
    setDriftAlarmCopyOverrides,
    setDriftAlertsEnabled,
    setExtremeNudgeEnabled,
    setMacosNotificationEnabled,
    setPetModeEnabled,
    setPetModeCoat,
    setPetModeRunBetaEnabled,
    setPetModeSize,
    setQuietHours,
    setWatcherMode,
    setWatcherPeekEnabled,
    watcherMode,
    watcherPeekEnabled,
    watcherPeriodicMaxMinutes,
    watcherPeriodicMinMinutes,
  };
}
