import { useEffect, useState } from "react";

import {
  readUserWorkProfileSettings,
  saveUserWorkProfileSettings,
  type WorkProfileSettings,
} from "../onboarding/onboardingState";
import { synchronizeLivingSoulDeclaredContextForUser } from "../classification/livingSoul";
import { useLocalization } from "../localization/LocalizationContext";

export function useWorkProfileSettings(workProfileUserId: string) {
  const { t } = useLocalization();
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
      savedState ? t("settings.ai.workProfileSaved") : t("settings.ai.workProfileSaveHint"),
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
