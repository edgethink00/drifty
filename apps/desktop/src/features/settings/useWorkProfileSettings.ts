import { useCallback, useEffect, useRef, useState } from "react";

import {
  readUserWorkProfileSettings,
  saveUserWorkProfileSettings,
  type WorkProfileSettings,
} from "../onboarding/onboardingState";
import { synchronizeLivingSoulDeclaredContextForUser } from "../classification/livingSoul";
import { useLocalization } from "../localization/LocalizationContext";

export function useWorkProfileSettings(workProfileUserId: string) {
  const { t } = useLocalization();
  const [savedWorkProfile, setSavedWorkProfile] = useState(() => readUserWorkProfileSettings(workProfileUserId));
  const [workProfileDraft, setWorkProfileDraft] = useState(savedWorkProfile);
  const [workProfileMessage, setWorkProfileMessage] = useState<string | null>(null);
  const [memorySnapshotVersion, setMemorySnapshotVersion] = useState(0);
  const [workProfileSaving, setWorkProfileSaving] = useState(false);
  // Saving is async, so a slow Soul write must not publish its result into a
  // different account's settings view, or into an unmounted panel.
  const activeUserIdRef = useRef(workProfileUserId);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);

  useEffect(() => {
    activeUserIdRef.current = workProfileUserId;
  }, [workProfileUserId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const nextWorkProfile = readUserWorkProfileSettings(workProfileUserId);
    setSavedWorkProfile(nextWorkProfile);
    setWorkProfileDraft(nextWorkProfile);
    setWorkProfileMessage(null);
    setMemorySnapshotVersion(0);
  }, [workProfileUserId]);

  const handleSaveWorkProfile = useCallback(async () => {
    // A second click while the first save is still syncing would issue a
    // duplicate Soul write. The button is disabled for the same window, so
    // this guard is a safety net rather than a silent drop of user intent.
    if (savingRef.current) return;
    const targetUserId = workProfileUserId;
    savingRef.current = true;
    setWorkProfileSaving(true);
    const savedState = saveUserWorkProfileSettings(targetUserId, workProfileDraft);
    setWorkProfileMessage(
      savedState ? t("settings.ai.workProfileSaved") : t("settings.ai.workProfileSaveHint"),
    );
    if (!savedState) {
      savingRef.current = false;
      setWorkProfileSaving(false);
      return;
    }

    const nextWorkProfile = readUserWorkProfileSettings(targetUserId);
    setSavedWorkProfile(nextWorkProfile);
    setWorkProfileDraft(nextWorkProfile);

    try {
      await synchronizeLivingSoulDeclaredContextForUser(targetUserId, savedState);
      if (!mountedRef.current || activeUserIdRef.current !== targetUserId) return;
      setMemorySnapshotVersion((current) => current + 1);
    } catch (error) {
      console.warn("Unable to synchronize Living Soul work context.", error);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setWorkProfileSaving(false);
    }
  }, [t, workProfileDraft, workProfileUserId]);

  const handleWorkProfileDraftChange = (value: WorkProfileSettings) => {
    setWorkProfileDraft(value);
    setWorkProfileMessage(null);
  };

  return {
    savedWorkProfile,
    workProfileDraft,
    workProfileMessage,
    workProfileSaving,
    memorySnapshotVersion,
    handleSaveWorkProfile,
    handleWorkProfileDraftChange,
  };
}
