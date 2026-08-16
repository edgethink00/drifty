import { useEffect, useState } from "react";

import {
  readUserWorkProfileSettings,
  saveUserWorkProfileSettings,
  type WorkProfileSettings,
} from "../onboarding/onboardingState";
import { synchronizeLivingSoulDeclaredContextForUser } from "../classification/livingSoul";

export function useWorkProfileSettings(workProfileUserId: string) {
  const [workProfileDraft, setWorkProfileDraft] = useState(() => readUserWorkProfileSettings(workProfileUserId));
  const [workProfileMessage, setWorkProfileMessage] = useState<string | null>(null);

  useEffect(() => {
    const nextWorkProfile = readUserWorkProfileSettings(workProfileUserId);
    setWorkProfileDraft(nextWorkProfile);
    setWorkProfileMessage(null);
  }, [workProfileUserId]);

  const handleSaveWorkProfile = () => {
    const savedState = saveUserWorkProfileSettings(workProfileUserId, workProfileDraft);
    setWorkProfileMessage(
      savedState ? "Work profile saved for future AI classification." : "Choose a role or field before saving.",
    );
    if (!savedState) return;

    void synchronizeLivingSoulDeclaredContextForUser(workProfileUserId, savedState).catch((error) => {
      console.warn("Unable to synchronize Living Soul work context.", error);
    });

    const nextWorkProfile = readUserWorkProfileSettings(workProfileUserId);
    setWorkProfileDraft(nextWorkProfile);
  };

  const handleWorkProfileDraftChange = (value: WorkProfileSettings) => {
    setWorkProfileDraft(value);
    setWorkProfileMessage(null);
  };

  return {
    workProfileDraft,
    workProfileMessage,
    handleSaveWorkProfile,
    handleWorkProfileDraftChange,
  };
}
