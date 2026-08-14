export interface ProjectCandidate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface ProjectDiscoveryCardProps {
  /** true when no analysis model is connected yet → show connect CTA instead of candidates */
  readonly needsModel: boolean;
  readonly candidates: readonly ProjectCandidate[];
  readonly onAccept: (candidate: ProjectCandidate) => void;
  readonly onAcceptAll?: () => void;
  readonly onDismiss: () => void;
  readonly onConnectModel: () => void;
  readonly busy?: boolean;
}

/**
 * Dashboard activation card for the projects feature.
 *
 * This is a discovery moment, not onboarding: once there are enough days of
 * tracked history, the analysis model proposes candidate projects mined from
 * the user's own activity. If no analysis model is connected yet, the card
 * instead invites connecting one so those suggestions can exist at all.
 *
 * Card layout (never a modal), so it sits inline in the dashboard stack.
 */
export function ProjectDiscoveryCard(props: ProjectDiscoveryCardProps): JSX.Element {
  const {
    needsModel,
    candidates,
    onAccept,
    onAcceptAll,
    onDismiss,
    onConnectModel,
    busy = false,
  } = props;

  // Nothing to activate: no model gap to close and no candidates to review.
  if (!needsModel && candidates.length === 0) {
    return <></>;
  }

  const variant = needsModel ? "connect" : "candidates";

  return (
    <section
      className={`project-discovery-card project-discovery-card--${variant}`}
      aria-label="Project discovery"
      role="status"
    >
      <button
        type="button"
        className="project-discovery-card__dismiss"
        aria-label="Dismiss project discovery"
        onClick={onDismiss}
      >
        ×
      </button>

      {needsModel ? (
        <div className="project-discovery-card__heading">
          <span className="label-mono">Projects</span>
          <strong className="project-discovery-card__title">See your time grouped by project</strong>
          <p className="project-discovery-card__body">
            Connect an analysis model and Drifty will group the apps, sites, and files you already work in
            into the projects you actually care about — no manual setup.
          </p>
          <div className="project-discovery-card__actions">
            <button
              type="button"
              className="app-btn app-btn--primary"
              onClick={onConnectModel}
              disabled={busy}
            >
              Connect analysis model
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="project-discovery-card__heading">
            <span className="label-mono">Projects</span>
            <strong className="project-discovery-card__title">Projects we noticed</strong>
            <p className="project-discovery-card__body">
              Suggested from the last few days of your activity. Add the ones that match how you think about
              your work.
            </p>
          </div>

          <ul className="project-discovery-card__list">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="project-discovery-card__item">
                <div className="project-discovery-card__item-copy">
                  <strong className="project-discovery-card__item-name">{candidate.name}</strong>
                  {/*
                    Editable-looking description: a real field control so it reads as
                    "you'll be able to tweak this", but read-only for now because the
                    discovery contract has no per-field edit handler yet.
                  */}
                  <textarea
                    className="project-discovery-card__item-description"
                    aria-label={`${candidate.name} description`}
                    value={candidate.description}
                    rows={2}
                    readOnly
                  />
                </div>
                <button
                  type="button"
                  className="app-btn app-btn--primary app-btn--compact project-discovery-card__add"
                  aria-label={`Add ${candidate.name}`}
                  onClick={() => onAccept(candidate)}
                  disabled={busy}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>

          {onAcceptAll ? (
            <div className="project-discovery-card__actions">
              <button
                type="button"
                className="app-btn app-btn--secondary"
                onClick={onAcceptAll}
                disabled={busy}
              >
                Add all
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
