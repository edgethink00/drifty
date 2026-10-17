import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";

type Benefit = {
  readonly id: "cloud" | "projects" | "sync" | "setup" | "looks";
  readonly label: TranslationKey;
  /** The Cloud model behind the benefit, by generation. */
  readonly model?: string;
};

/**
 * Model names are proper nouns, so they are not translated. They name the
 * generation of the production routes (2026-10-10: classification on Claude
 * Haiku 5.5, project analysis on GPT-6 Luna), which holds while the tier inside
 * a generation changes. A route change to another generation must update them.
 */
const BENEFITS: readonly Benefit[] = [
  { id: "cloud", label: "billing.proSheet.value.cloudTitle", model: "Claude 5.5" },
  { id: "projects", label: "billing.proSheet.value.projectsTitle", model: "GPT-6" },
  { id: "sync", label: "billing.proSheet.plus.sync" },
  { id: "setup", label: "billing.proSheet.plus.setup" },
];

function Tick() {
  return (
    <svg className="pro-sheet-value__tick" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.2 8.4 6.4 11.4 12.8 4.6" />
    </svg>
  );
}

/**
 * What Pro adds, in the pricing-page form (Claude, Cursor, Dayflow): a lead line,
 * then a thin tick and one short line per benefit, the model in bold. No icon
 * tiles and no row dividers. Every line maps to a shipped Pro entitlement.
 */
export function ProSheetValue({ looksLineKey = "billing.proSheet.plus.coats" }: {
  /** The Pro looks line: coats and accent colors everywhere, plus every app Dock icon on macOS. */
  readonly looksLineKey?: TranslationKey;
}) {
  const { t } = useLocalization();
  const benefits: readonly Benefit[] = [...BENEFITS, { id: "looks", label: looksLineKey }];
  return (
    <div className="pro-sheet-value">
      <p className="pro-sheet-value__lead">{t("billing.proSheet.lead")}</p>
      <ul aria-label={t("billing.proSheet.benefitsAria")}>
        {benefits.map((benefit) => (
          <li key={benefit.id}>
            <Tick />
            <span>
              {t(benefit.label)}
              {benefit.model ? <> <span className="pro-sheet-value__sep" aria-hidden="true">·</span> <strong>{benefit.model}</strong></> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

