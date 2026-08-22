import { useMemo } from "react";
import {
  isFeatureNewBadgeAudience,
  isFeatureNewBadgeVisible,
  markFeatureNewBadgeEnabled,
  rememberFeatureNewBadgeAudience,
} from "./featureNewBadges";

export function useFeatureNewBadges(completedAt: string | null | undefined, petEnabled: boolean) {
  const returningUser = isFeatureNewBadgeAudience(completedAt);
  const state = useMemo(() => {
    if (!returningUser) return null;
    const remembered = rememberFeatureNewBadgeAudience();
    return petEnabled ? markFeatureNewBadgeEnabled("pet") : remembered;
  }, [petEnabled, returningUser]);

  return {
    showPet: isFeatureNewBadgeVisible("pet", {
      returningUser,
      state,
    }),
  };
}
