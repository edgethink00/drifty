import { useSettingsSearch } from "./SettingsSearchContext";
import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";

import { CollapsiblePanel } from "./CollapsiblePanel";
import "./SettingsCollapsibleCard.css";

type SettingsCollapsibleCardProps = {
  readonly title: string;
  readonly searchReveal?: string;
  readonly settingId?: string;
  readonly leading?: ReactNode;
  readonly subtitle?: string;
  readonly summary?: ReactNode;
  readonly defaultExpanded?: boolean;
  /**
   * "row" folds inside a settings card as its next row, with the row's type,
   * padding and divider; "card" (the default) stands on its own.
   */
  readonly variant?: "card" | "row";
  readonly children: ReactNode;
};

export function SettingsCollapsibleCard({
  title,
  leading,
  searchReveal,
  settingId,
  subtitle,
  summary,
  defaultExpanded = false,
  variant = "card",
  children,
}: SettingsCollapsibleCardProps) {
  const { request } = useSettingsSearch();
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => {
    if (searchReveal && request?.entry.reveal === searchReveal) setExpanded(true);
  }, [request, searchReveal]);
  const reactId = useId().replace(/:/g, "");
  const panelId = `settings-collapsible-${reactId}-panel`;
  const buttonId = `settings-collapsible-${reactId}-button`;

  return (
    <section data-setting-id={settingId} className={`settings-collapsible-card${variant === "row" ? " settings-collapsible-card--row" : ""}${expanded ? " is-expanded" : ""}${leading ? " settings-collapsible-card--has-leading" : ""}`}>
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className="settings-collapsible-card__toggle"
        id={buttonId}
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        {leading ? <span className="settings-collapsible-card__leading" aria-hidden="true">{leading}</span> : null}
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
