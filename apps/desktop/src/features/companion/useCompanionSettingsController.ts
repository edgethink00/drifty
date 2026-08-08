import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import type { DriftAlarmCopySettingsValue } from "./driftAlarmCopy";
import { persistDriftAlarmCopy, resolveInitialDriftAlarmCopy } from "./driftAlarmCopyStorage";
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
  PET_MODE_SIZE_STORAGE_KEY,
  PET_MODE_STORAGE_KEY,
  resolveInitialPetModeCoat,
  resolveInitialPetModeEnabled,
  resolveInitialPetModeSize,
  type PetModeCoat,
  type PetModeSize,
} from "../pet-mode/petModeData";

type UseCompanionSettingsControllerResult = {
  readonly driftAlertDelaySeconds: DriftAlertDelaySeconds;
  readonly driftAlertsEnabled: boolean;
  readonly driftAlarmCopy: DriftAlarmCopySettingsValue;
  readonly extremeNudgeEnabled: boolean;
  readonly petModeEnabled: boolean;
  readonly petModeCoat: PetModeCoat;
  readonly petModeSize: PetModeSize;
  readonly handleWatcherPeriodicMaxChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleWatcherPeriodicMinChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly setDriftAlertDelaySeconds: Dispatch<SetStateAction<DriftAlertDelaySeconds>>;
  readonly setDriftAlarmCopy: Dispatch<SetStateAction<DriftAlarmCopySettingsValue>>;
  readonly setDriftAlertsEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setExtremeNudgeEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setPetModeEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setPetModeCoat: Dispatch<SetStateAction<PetModeCoat>>;
  readonly setPetModeSize: Dispatch<SetStateAction<PetModeSize>>;
  readonly setWatcherMode: Dispatch<SetStateAction<WatcherMode>>;
  readonly setWatcherPeekEnabled: Dispatch<SetStateAction<boolean>>;
  readonly watcherMode: WatcherMode;
  readonly watcherPeekEnabled: boolean;
  readonly watcherPeriodicMaxMinutes: number;
  readonly watcherPeriodicMinMinutes: number;
};

export function useCompanionSettingsController(): UseCompanionSettingsControllerResult {
  const [driftAlertsEnabled, setDriftAlertsEnabled] = useState(resolveInitialDriftAlertsEnabled);
  const [driftAlertDelaySeconds, setDriftAlertDelaySeconds] = useState<DriftAlertDelaySeconds>(resolveInitialDriftAlertDelaySeconds);
  const [driftAlarmCopy, setDriftAlarmCopy] = useState(resolveInitialDriftAlarmCopy);
  const [extremeNudgeEnabled, setExtremeNudgeEnabled] = useState(() => resolveInitialDriftAlertsEnabled() && resolveInitialExtremeNudgeEnabled());
  const [petModeEnabled, setPetModeEnabled] = useState(resolveInitialPetModeEnabled);
  const [petModeCoat, setPetModeCoat] = useState<PetModeCoat>(resolveInitialPetModeCoat);
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
    persistDriftAlarmCopy(driftAlarmCopy);
  }, [driftAlarmCopy]);

  useEffect(() => {
    window.localStorage.setItem(EXTREME_NUDGE_STORAGE_KEY, extremeNudgeEnabled ? "1" : "0");
  }, [extremeNudgeEnabled]);

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
    driftAlertDelaySeconds,
    driftAlertsEnabled,
    driftAlarmCopy,
    extremeNudgeEnabled,
    petModeEnabled,
    petModeCoat,
    petModeSize,
    handleWatcherPeriodicMaxChange,
    handleWatcherPeriodicMinChange,
    setDriftAlertDelaySeconds,
    setDriftAlarmCopy,
    setDriftAlertsEnabled,
    setExtremeNudgeEnabled,
    setPetModeEnabled,
    setPetModeCoat,
    setPetModeSize,
    setWatcherMode,
    setWatcherPeekEnabled,
    watcherMode,
    watcherPeekEnabled,
    watcherPeriodicMaxMinutes,
    watcherPeriodicMinMinutes,
  };
}
