import { useState } from "react";
import type { ReactNode } from "react";

import { AiPrivacyReview } from "./AiPrivacyReview";

type AiSetupSupportSectionId = "workProfile" | "privacyReview";

type AiSetupSupportSectionsProps = {
  readonly workProfileDraft: string;
  readonly workProfileMessage: string | null;
  readonly workProfilePreview: string;
  readonly onSaveWorkProfile: () => void;
  readonly onWorkProfileDraftChange: (value: string) => void;
};

export function AiSetupSupportSections({
  workProfileDraft,
  workProfileMessage,
  workProfilePreview,
  onSaveWorkProfile,
  onWorkProfileDraftChange,
}: AiSetupSupportSectionsProps) {
  const [expandedSection, setExpandedSection] = useState<AiSetupSupportSectionId | null>(null);

  return (
    <div className="ai-setup-support-list" aria-label="Additional AI setup sections">
      <AiSetupSupportSection
        id="workProfile"
        badge="Used in AI prompts"
        expanded={expandedSection === "workProfile"}
        subtitle="Add local work context for ambiguous apps, titles, and domains."
        title="Work profile"
        onToggle={setExpandedSection}
      >
        <WorkProfileSection
          workProfileDraft={workProfileDraft}
          workProfileMessage={workProfileMessage}
          workProfilePreview={workProfilePreview}
          onSaveWorkProfile={onSaveWorkProfile}
          onWorkProfileDraftChange={onWorkProfileDraftChange}
        />
      </AiSetupSupportSection>

      <AiSetupSupportSection
        id="privacyReview"
        badge="No raw cloud timeline"
        expanded={expandedSection === "privacyReview"}
        subtitle="Review the minimized fields AI classification can receive."
        title="Privacy review"
        onToggle={setExpandedSection}
      >
        <AiPrivacyReview />
      </AiSetupSupportSection>
    </div>
  );
}

function AiSetupSupportSection({
  badge,
  children,
  expanded,
  id,
  subtitle,
  title,
  onToggle,
}: {
  readonly badge: string;
  readonly children: ReactNode;
  readonly expanded: boolean;
  readonly id: AiSetupSupportSectionId;
  readonly subtitle: string;
  readonly title: string;
  readonly onToggle: (section: AiSetupSupportSectionId | null) => void;
}) {
  const panelId = `ai-setup-support-${id}`;
  const buttonId = `ai-setup-support-button-${id}`;

  return (
    <section className={`ai-setup-support-section${expanded ? " is-expanded" : ""}`}>
      <button
        id={buttonId}
        type="button"
        className="ai-setup-support-section__toggle"
        aria-controls={panelId}
        aria-expanded={expanded}
        onClick={() => onToggle(expanded ? null : id)}
      >
        <span className="ai-setup-support-section__copy">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </span>
        <span className="chip gray">{badge}</span>
        <span className="ai-setup-support-section__chevron" aria-hidden="true" />
      </button>
      {expanded ? (
        <div id={panelId} className="ai-setup-support-section__panel" role="region" aria-labelledby={buttonId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function WorkProfileSection({
  workProfileDraft,
  workProfileMessage,
  workProfilePreview,
  onSaveWorkProfile,
  onWorkProfileDraftChange,
}: AiSetupSupportSectionsProps) {
  return (
    <section className="ai-setup-personalization" aria-label="AI classification personalization">
      <div className="ai-setup-work-profile-panel">
        <div className="ai-setup-work-profile-panel__preview">
          <span>Current AI lens</span>
          <strong>{workProfilePreview}</strong>
          <p>Used to judge ambiguous titles, domains, and mixed-purpose apps against your real work.</p>
        </div>
        <div className="ai-setup-work-profile-panel__editor">
          <label className="ai-setup-field ai-setup-field--work-profile">
            <span>Edit profile</span>
            <textarea
              className="settings-input ai-setup-work-profile"
              aria-label="Work profile"
              value={workProfileDraft}
              onChange={(event) => onWorkProfileDraftChange(event.target.value)}
              placeholder="Example: iOS app development, launch operations, and customer support"
              rows={2}
            />
          </label>
          <div className="ai-setup-personalization__footer">
            <p role="status">{workProfileMessage ?? "Saved locally and included only in AI classification requests."}</p>
            <button type="button" className="settings-btn" onClick={onSaveWorkProfile}>Save work profile</button>
          </div>
        </div>
      </div>
    </section>
  );
}
