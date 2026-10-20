import type { ReactNode } from "react";

import { aiProviderBrandMark, type AiProviderBrandKind } from "./AiProviderBrandMark";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { useLocalization } from "../localization/LocalizationContext";

export const AI_SETUP_SECTIONS = [
  { id: "drifty", title: "Drifty" },
  { id: "openrouter", title: "OpenRouter" },
  { id: "custom", title: "Custom endpoint" },
] as const;

export type AiSetupSection = (typeof AI_SETUP_SECTIONS)[number]["id"];

type AiSetupSectionCardProps<Id extends string> = {
  readonly section: { readonly id: Id; readonly title: string };
  readonly brand?: AiProviderBrandKind;
  readonly idPrefix?: string;
  readonly expanded: boolean;
  readonly children: ReactNode;
  readonly onToggle: (section: Id) => void;
};

export function AiSetupSectionCard<Id extends string>({
  section,
  brand,
  idPrefix = "ai-setup",
  expanded,
  children,
  onToggle,
}: AiSetupSectionCardProps<Id>) {
  const { t } = useLocalization();
  const panelId = `${idPrefix}-section-${section.id}`;
  const buttonId = `${idPrefix}-section-button-${section.id}`;

  return (
    <article className={`ai-setup-choice${expanded ? " is-expanded" : ""}`}>
      <button
        id={buttonId}
        type="button"
        className="ai-setup-choice__toggle"
        aria-label={t("settings.ai.setupRowAria", { provider: localizedSectionTitle(section.id, section.title, t) })}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => onToggle(section.id)}
      >
        {aiProviderBrandMark(brand ?? (section.id as AiSetupSection))}
        <span className="ai-setup-choice__copy">
          <span className="ai-setup-choice__title">{localizedSectionTitle(section.id, section.title, t)}</span>
        </span>
        <span className="ai-setup-choice__chevron" aria-hidden="true" />
      </button>
      <CollapsiblePanel contentClassName="ai-setup-choice__panel" expanded={expanded} id={panelId} labelledBy={buttonId}>
        {children}
      </CollapsiblePanel>
    </article>
  );
}

function localizedSectionTitle(section: string, fallback: string, t: ReturnType<typeof useLocalization>["t"]): string {
  return section === "custom" ? t("settings.ai.customEndpoint") : fallback;
}

/** The existing Classification connection section, shared by both task tabs. */
export function AiSetupConnectionDetails({ ariaLabel, children }: { readonly ariaLabel: string; readonly children: ReactNode }) {
  const { t } = useLocalization();
  return <>
    <h4 className="ai-setup-provider-heading">{t("settings.ai.connectionDetails")}</h4>
    <div className="ai-setup-choices" role="group" aria-label={ariaLabel}>{children}</div>
  </>;
}
