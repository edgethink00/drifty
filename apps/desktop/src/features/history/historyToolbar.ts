import type { LocalizationController } from "../localization/LocalizationContext";

/**
 * The History toolbar has one action slot: "Delete history…" at rest and
 * "Delete N selected" while rows are selected. The slot reserves every label it
 * can show, so selecting a row never narrows the search field beside it. Three
 * digits cover any selection made by hand; only a four-digit count widens it.
 * The loading skeleton reserves the same labels so the slot keeps its width when
 * the real toolbar replaces it.
 */
export function historyToolbarActionReserve(t: LocalizationController["t"]): readonly string[] {
  return [t("history.deleteAll"), t("history.deleteSelectedCount", { count: 888 })];
}
