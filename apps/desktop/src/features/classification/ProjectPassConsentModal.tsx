import { useEffect } from "react";

export interface ProjectPassConsentModalProps {
  readonly open: boolean;
  readonly providerLabel: string;
  readonly includesTitles: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const TITLE_ID = "project-pass-consent-title";
const DESCRIPTION_ID = "project-pass-consent-description";

export function ProjectPassConsentModal({
  open,
  providerLabel,
  includesTitles,
  onConfirm,
  onCancel,
}: ProjectPassConsentModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="auth-modal__overlay" onClick={onCancel}>
      <section
        aria-describedby={DESCRIPTION_ID}
        aria-labelledby={TITLE_ID}
        aria-modal="true"
        className="auth-modal project-pass-consent-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="auth-modal__header">
          <h2 id={TITLE_ID}>Turn on project analysis</h2>
          <p id={DESCRIPTION_ID}>
            Project analysis sorts each day into your projects. To do that it sends a broader summary
            than everyday classification does, so here is exactly what leaves your Mac before you turn it on.
          </p>
        </div>

        <ul
          className="project-pass-consent-modal__points"
          style={{ margin: "0 0 var(--space-5)", paddingLeft: "1.15rem", display: "grid", gap: "var(--space-2)" }}
        >
          <li>
            A compacted 3-minute activity-window summary — app, site, time, duration, plus your
            project descriptions and work profile — is sent to <strong>{providerLabel}</strong>.
          </li>
          <li>
            It never sends your raw history beyond that summary. Full timeline rows and session history
            stay on your Mac, and your existing AI privacy settings still apply.
          </li>
          {includesTitles ? null : (
            <li>Page and video titles are excluded, because you turned off content context.</li>
          )}
        </ul>

        <div
          className="project-pass-consent-modal__actions"
          style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-3)" }}
        >
          <button className="ghost-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="settings-btn" type="button" onClick={onConfirm}>
            Turn on
          </button>
        </div>
      </section>
    </div>
  );
}
