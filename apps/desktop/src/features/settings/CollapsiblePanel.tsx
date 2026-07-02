import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import "./CollapsiblePanel.css";

type CollapsiblePanelProps = {
  readonly id: string;
  readonly expanded: boolean;
  readonly labelledBy: string;
  readonly contentClassName?: string;
  readonly children: ReactNode;
};

/**
 * Animated expand/collapse container shared by settings cards. Content mounts
 * lazily on first expand and stays mounted afterwards so the height animation
 * works both ways; while collapsed the panel is hidden from the accessibility
 * tree and from pointer/keyboard interaction (visibility handled in CSS).
 */
export function CollapsiblePanel({ id, expanded, labelledBy, contentClassName, children }: CollapsiblePanelProps) {
  const [hasExpanded, setHasExpanded] = useState(expanded);

  useEffect(() => {
    if (expanded) setHasExpanded(true);
  }, [expanded]);

  return (
    <div aria-hidden={expanded ? undefined : true} className={`collapsible-panel${expanded ? " is-expanded" : ""}`}>
      <div className="collapsible-panel__inner">
        {hasExpanded ? (
          <div aria-labelledby={labelledBy} className={contentClassName} id={id} role="region">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
