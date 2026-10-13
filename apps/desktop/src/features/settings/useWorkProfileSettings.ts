import { useCallback, useEffect, useRef, useState } from "react";

import {
  readUserWorkProfileSettings,
  saveUserWorkProfileSettings,
  summarizeWorkProfileSettings,
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

  // Resolves true once the profile is stored locally for the account still on
  // screen, so the editor can close; false keeps it open.
  const handleSaveWorkProfile = useCallback(async (): Promise<boolean> => {
    // A second click while the first save is still syncing would issue a
    // duplicate Soul write. The button is disabled for the same window, so
    // this guard is a safety net rather than a silent drop of user intent.
    if (savingRef.current) return false;
    const targetUserId = workProfileUserId;
    savingRef.current = true;
    setWorkProfileSaving(true);
    const savedState = saveUserWorkProfileSettings(targetUserId, workProfileDraft);
    if (!savedState) {
      // A filled draft is refused only when no completed onboarding record
      // exists (a settings save must not mint one), so name that cause rather
      // than asking for activities the user already chose.
      setWorkProfileMessage(t(summarizeWorkProfileSettings(workProfileDraft)
        ? "settings.ai.workProfileNeedsSetup"
        : "settings.ai.workProfileSaveHint"));
      savingRef.current = false;
      setWorkProfileSaving(false);
      return false;
    }
    setWorkProfileMessage(null);

    const nextWorkProfile = readUserWorkProfileSettings(targetUserId);
    setSavedWorkProfile(nextWorkProfile);
    setWorkProfileDraft(nextWorkProfile);

    try {
      await synchronizeLivingSoulDeclaredContextForUser(targetUserId, savedState);
      if (mountedRef.current && activeUserIdRef.current === targetUserId) {
        setMemorySnapshotVersion((current) => current + 1);
      }
    } catch (error) {
      console.warn("Unable to synchronize Living Soul work context.", error);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setWorkProfileSaving(false);
    }
    return activeUserIdRef.current === targetUserId;
  }, [t, workProfileDraft, workProfileUserId]);

  const handleWorkProfileDraftChange = (value: WorkProfileSettings) => {
    setWorkProfileDraft(value);
    setWorkProfileMessage(null);
  };

  // Editing always starts from, and cancelling returns to, the saved profile.
  const resetWorkProfileDraft = useCallback(() => {
    setWorkProfileDraft(savedWorkProfile);
    setWorkProfileMessage(null);
  }, [savedWorkProfile]);

  return {
    savedWorkProfile,
    workProfileDraft,
    workProfileMessage,
    workProfileSaving,
    memorySnapshotVersion,
    handleSaveWorkProfile,
    handleWorkProfileDraftChange,
    resetWorkProfileDraft,
  };
}
