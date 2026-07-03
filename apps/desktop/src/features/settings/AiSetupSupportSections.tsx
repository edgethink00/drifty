import { useState } from "react";
import type { ReactNode } from "react";

import { AiPrivacyReview } from "./AiPrivacyReview";
import { AiSetupWorkProfileSection } from "./AiSetupWorkProfileSection";
import { CollapsiblePanel } from "./CollapsiblePanel";
import type { WorkProfileSettings } from "../onboarding/onboardingState";

type AiSetupSupportSectionId = "workProfile" | "privacyReview";

type AiSetupSupportSectionsProps = {
  readonly workProfileDraft: WorkProfileSettings;
  readonly workProfileMessage: string | null;
  readonly onSaveWorkProfile: () => void;
  readonly onWorkProfileDraftChange: (value: WorkProfileSettings) => void;
};

export function AiSetupSupportSections({
  workProfileDraft,
  workProfileMessage,
  onSaveWorkProfile,
  onWorkProfileDraftChange,
}: AiSetupSupportSectionsProps) {
  const [expandedSection, setExpandedSection] = useState<AiSetupSupportSectionId | null>(null);

  return (
    <div className="ai-setup-support-list" aria-label="Additional AI setup sections">
      <AiSetupSupportSection
        id="workProfile"
        badge="Work context"
        expanded={expandedSection === "workProfile"}
        subtitle="Role and field from onboarding, editable here."
        title="Work profile"
        onToggle={setExpandedSection}
      >
        <AiSetupWorkProfileSection
          workProfileDraft={workProfileDraft}
          workProfileMessage={workProfileMessage}
          onSaveWorkProfile={onSaveWorkProfile}
          onWorkProfileDraftChange={onWorkProfileDraftChange}
        />
      </AiSetupSupportSection>

      <AiSetupSupportSection
        id="privacyReview"
        expanded={expandedSection === "privacyReview"}
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
  readonly badge?: string;
  readonly children: ReactNode;
  readonly expanded: boolean;
  readonly id: AiSetupSupportSectionId;
  readonly subtitle?: string;
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
        className={`ai-setup-support-section__toggle${badge || subtitle ? "" : " ai-setup-support-section__toggle--bare"}`}
        aria-label={title}
        aria-controls={panelId}
        aria-expanded={expanded}
        onClick={() => onToggle(expanded ? null : id)}
      >
        <span className="ai-setup-support-section__copy">
          <strong>{title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </span>
        {badge ? <span className="chip gray">{badge}</span> : null}
        <span className="ai-setup-support-section__chevron" aria-hidden="true" />
      </button>
      <CollapsiblePanel contentClassName="ai-setup-support-section__panel" expanded={expanded} id={panelId} labelledBy={buttonId}>
        {children}
      </CollapsiblePanel>
    </section>
  );
}
