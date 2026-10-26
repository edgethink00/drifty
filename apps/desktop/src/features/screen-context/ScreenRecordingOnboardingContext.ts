import { createContext } from "react";
import type { ScreenContextClient } from "./screenContextClient";

/**
 * Onboarding's optional screen recording row. Choosing it is remembered here and
 * saved as on once onboarding starts tracking; without a choice recording stays off.
 */
export type ScreenRecordingOnboardingChoice = {
  readonly client: ScreenContextClient;
  readonly chosen: boolean;
  readonly choose: () => void;
};
export const ScreenRecordingOnboardingContext = createContext<ScreenRecordingOnboardingChoice | null>(null);
