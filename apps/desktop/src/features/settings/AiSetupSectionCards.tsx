import type { ReactNode } from "react";

import driftyLogoUrl from "../../assets/drifty-icon.png";
import openRouterLogoUrl from "../../assets/openrouter-logo.png";

export const AI_SETUP_SECTIONS = [
  { id: "drifty", title: "Drifty", subtitle: "Use Drifty Cloud or a managed local model" },
  { id: "openrouter", title: "OpenRouter", subtitle: "Use your own key and model routing" },
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
  const panelId = `ai-setup-section-${section.id}`;
  const buttonId = `ai-setup-section-button-${section.id}`;

  return (
    <article className={`ai-setup-choice${expanded ? " is-expanded" : ""}`}>
      <button
        id={buttonId}
        type="button"
        className="ai-setup-choice__toggle"
        aria-label={`${section.title} setup row`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => onToggle(section.id)}
      >
        <BrandMark section={section.id} />
        <span className="ai-setup-choice__copy">
          <span className="ai-setup-choice__title">{section.title}</span>
          <span className="ai-setup-choice__subtitle">{section.subtitle}</span>
        </span>
        <span className="ai-setup-choice__chevron" aria-hidden="true" />
      </button>
      {expanded ? (
        <div id={panelId} className="ai-setup-choice__panel" role="region" aria-labelledby={buttonId}>
          {children}
        </div>
      ) : null}
    </article>
  );
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
