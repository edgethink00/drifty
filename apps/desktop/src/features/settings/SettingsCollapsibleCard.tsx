import { useId, useState } from "react";
import type { ReactNode } from "react";

import { CollapsiblePanel } from "./CollapsiblePanel";
import "./SettingsCollapsibleCard.css";

type SettingsCollapsibleCardProps = {
  readonly title: string;
  readonly subtitle?: string;
  readonly summary?: ReactNode;
  readonly defaultExpanded?: boolean;
  readonly children: ReactNode;
};

export function SettingsCollapsibleCard({
  title,
  subtitle,
  summary,
  defaultExpanded = false,
  children,
}: SettingsCollapsibleCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const reactId = useId().replace(/:/g, "");
  const panelId = `settings-collapsible-${reactId}-panel`;
  const buttonId = `settings-collapsible-${reactId}-button`;

  return (
    <section className={`settings-collapsible-card${expanded ? " is-expanded" : ""}`}>
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className="settings-collapsible-card__toggle"
        id={buttonId}
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="settings-collapsible-card__copy">
          <strong>{title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </span>
        {summary ? <span className="settings-collapsible-card__summary">{summary}</span> : null}
        <span className="settings-collapsible-card__chevron" aria-hidden="true" />
      </button>
      <CollapsiblePanel
        contentClassName="settings-collapsible-card__panel"
        expanded={expanded}
        id={panelId}
        labelledBy={buttonId}
      >
        {children}
      </CollapsiblePanel>
    </section>
  );
}
