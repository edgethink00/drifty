import type { LocalizationController } from "../localization/LocalizationContext";

import type { RemainingLabel } from "./remainingEstimate";

/** One wording for every remaining-time read in the app. */
export function remainingLabelText(
  label: RemainingLabel | null,
  t: LocalizationController["t"],
): string | null {
  if (!label) return null;
  if (label.kind === "almost") return t("common.remainingAlmost");
  if (label.kind === "underMinute") return t("common.remainingUnderMinute");
  return t("common.remainingMinutes", { minutes: label.minutes });
}
