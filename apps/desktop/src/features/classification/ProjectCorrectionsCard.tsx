import type { ActivityCategory, AiReviewEvent, ProductivityLabel } from "@drifty/domain";
import { categoryLabel, productivityLabel } from "../../lib/activityLabels";
import "./project-corrections.css";

export interface ProjectCorrectionsCardProps {
  readonly events: readonly AiReviewEvent[];
  readonly onRevert: (id: number) => void;
  readonly busy?: boolean;
}

function labelFor(category: ActivityCategory | null | undefined, productivity: ProductivityLabel | null | undefined): string {
  const categoryText = category ? categoryLabel(category) : "—";
  const productivityText = productivity ? productivityLabel(productivity) : "—";
  return `${categoryText} · ${productivityText}`;
}

/**
 * Shows the corrections the heavy project pass applied to per-segment
 * classifications (source `ai_review`), each with a Revert. Trust surface: the
 * user can see and undo any day-context adjustment. Renders nothing when there
 * are no active (non-reverted) corrections.
 */
export function ProjectCorrectionsCard({ events, onRevert, busy = false }: ProjectCorrectionsCardProps) {
  const active = events.filter((event) => !event.revertedAt);
  if (active.length === 0) return null;

  return (
    <section className="corrections-card" aria-label="Intelligence classification adjustments">
      <div className="corrections-card__head">
        <h3>Intelligence adjustments</h3>
        <p>The analysis model corrected {active.length} classification{active.length === 1 ? "" : "s"} using whole-day context.</p>
      </div>
      <div className="corrections-list-shell">
        <ul className="corrections-list">
          {active.map((event) => (
            <li key={event.id} className="corrections-item">
              <div className="corrections-item__body">
                <div className="corrections-item__change">
                  <span className="corrections-item__from">{labelFor(event.prevCategory, event.prevProductivity)}</span>
                  <span className="corrections-item__arrow" aria-hidden="true">→</span>
                  <span className="corrections-item__to">{labelFor(event.newCategory, event.newProductivity)}</span>
                </div>
                {event.reason ? <p className="corrections-item__reason">{event.reason}</p> : null}
              </div>
              <button type="button" className="app-btn app-btn--quiet app-btn--compact corrections-item__revert" onClick={() => onRevert(event.id)} disabled={busy}>
                Revert
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
