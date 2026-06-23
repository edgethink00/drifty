import "./AiSetupPanel.css";
import "./AiPrivacyReviewConcepts.css";

import { AiPrivacyReview } from "./AiPrivacyReview";

export function AiPrivacyReviewConceptsApp() {
  return (
    <main className="privacy-review-concepts" aria-label="Privacy review concept">
      <div className="privacy-review-concepts__shell">
        <header className="privacy-review-concepts__header">
          <h1>Privacy review</h1>
        </header>
        <section className="privacy-review-concepts__stage" aria-label="Selected privacy review concept">
          <AiPrivacyReview />
        </section>
      </div>
    </main>
  );
}
