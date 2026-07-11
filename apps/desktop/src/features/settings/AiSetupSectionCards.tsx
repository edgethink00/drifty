import type { ReactNode } from "react";

import driftyLogoUrl from "../../assets/drifty-icon.png";
import openRouterLogoUrl from "../../assets/openrouter-logo.png";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { useLocalization } from "../localization/LocalizationContext";

export const AI_SETUP_SECTIONS = [
  { id: "drifty", title: "Drifty" },
  { id: "openrouter", title: "OpenRouter" },
  { id: "custom", title: "Custom endpoint" },
] as const;

export type AiSetupSection = (typeof AI_SETUP_SECTIONS)[number]["id"];

type AiSetupSectionCardProps = {
  readonly section: (typeof AI_SETUP_SECTIONS)[number];
  readonly expanded: boolean;
  readonly children: ReactNode;
  readonly onToggle: (section: AiSetupSection) => void;
};

export function AiSetupSectionCard({
  section,
  expanded,
  children,
  onToggle,
}: AiSetupSectionCardProps) {
  const { t } = useLocalization();
  const panelId = `ai-setup-section-${section.id}`;
  const buttonId = `ai-setup-section-button-${section.id}`;

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
        <BrandMark section={section.id} />
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

function localizedSectionTitle(section: AiSetupSection, fallback: string, t: ReturnType<typeof useLocalization>["t"]): string {
  return section === "custom" ? t("settings.ai.customEndpoint") : fallback;
}

function BrandMark({ section }: { readonly section: AiSetupSection }) {
  switch (section) {
    case "drifty":
      return (
        <span className="ai-setup-brand-mark ai-setup-brand-mark--drifty" aria-hidden="true">
          <img src={driftyLogoUrl} alt="" />
        </span>
      );
    case "openrouter":
      return (
        <span className="ai-setup-brand-mark ai-setup-brand-mark--openrouter" aria-hidden="true">
          <img src={openRouterLogoUrl} alt="" />
        </span>
      );
    case "custom":
      return (
        <span className="ai-setup-brand-mark ai-setup-brand-mark--custom" aria-hidden="true">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M5 6.4h6.8a3.6 3.6 0 0 1 0 7.2H8.2" />
            <path d="M8.2 9.9h6.8" />
            <path d="M8.2 13.6a3.6 3.6 0 0 1 0-7.2h3.6" />
          </svg>
        </span>
      );
    default:
      return assertNever(section);
  }
}

function assertNever(value: never): never {
  throw new AiSetupSectionCardError(String(value));
}

class AiSetupSectionCardError extends Error {
  constructor(readonly section: string) {
    super(`Unhandled AI setup section: ${section}`);
    this.name = "AiSetupSectionCardError";
  }
}
