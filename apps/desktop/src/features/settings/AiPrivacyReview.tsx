import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import {
  AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT,
  readAiPrivacyRequestSettings,
  saveAiPrivacyRequestSettings,
  updateAiPrivacyRequestOptionalSetting,
  type AiPrivacyRequestOptionalSettings,
  type AiPrivacyRequestSettings,
} from "./aiPrivacyRequestSettings";

type VisibleField = {
  readonly label: string;
  readonly detail: string;
  readonly scope: "app" | "site" | "title" | "time" | "profile";
};

type ExcludedField = {
  readonly label: string;
  readonly detail: string;
};

type ControlField = VisibleField & {
  readonly control: "required" | "optional";
  readonly enabled: boolean;
  readonly settingKey?: keyof AiPrivacyRequestOptionalSettings;
};

const AI_VISIBLE_FIELDS: readonly VisibleField[] = [
  { label: "App context", detail: "App name and basic app context", scope: "app" },
  { label: "Duration", detail: "Activity duration", scope: "time" },
  { label: "Site domain", detail: "Browser or site domain", scope: "site" },
  { label: "Site URL", detail: "Site URL", scope: "site" },
  { label: "Window title", detail: "Page title or window title", scope: "title" },
  { label: "Work profile", detail: "Your saved work profile", scope: "profile" },
] as const;

const AI_EXCLUDED_FIELDS: readonly ExcludedField[] = [
  { label: "Raw timeline rows", detail: "No full activity row upload" },
  { label: "Full session history", detail: "No replayable day history" },
  { label: "Provider API keys", detail: "Stored locally, never sent as samples" },
] as const;

const REQUIRED_FIELD_LABELS = new Set(["App context", "Duration", "Site domain"]);

export function AiPrivacyReview() {
  const [settings, setSettings] = useState<AiPrivacyRequestSettings>(() => readAiPrivacyRequestSettings());
  const controlFields = useMemo(() => toControlFields(settings), [settings]);
  const requiredFields = controlFields.filter((field) => field.control === "required");
  const optionalFields = controlFields.filter((field) => field.control === "optional");

  useEffect(() => {
    const syncSettings = () => setSettings(readAiPrivacyRequestSettings());
    window.addEventListener("storage", syncSettings);
    window.addEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, syncSettings);
    return () => {
      window.removeEventListener("storage", syncSettings);
      window.removeEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, syncSettings);
    };
  }, []);

  const handleOptionalChange = (key: keyof AiPrivacyRequestOptionalSettings, enabled: boolean) => {
    setSettings((current) => {
      const nextSettings = updateAiPrivacyRequestOptionalSetting(current, key, enabled);
      saveAiPrivacyRequestSettings(nextSettings);
      return nextSettings;
    });
  };

  return (
    <section className="ai-privacy-review" aria-label="AI privacy review">
      <div className="ai-privacy-review__boundary">
        <div className="ai-privacy-review__column">
          <ColumnLabel label="Required for classification" meta="Locked on" />
          <div className="ai-privacy-review__list" role="list" aria-label="Required AI classification fields">
            {requiredFields.map((field) => (
              <ControlRow field={field} key={field.label} />
            ))}
          </div>
          <ColumnLabel label="Optional context" meta="User controlled" />
          <div className="ai-privacy-review__list" role="list" aria-label="Optional AI classification fields">
            {optionalFields.map((field) => (
              <ControlRow field={field} key={field.label} onOptionalChange={handleOptionalChange} />
            ))}
          </div>
        </div>
        <LockedLocalColumn />
      </div>
    </section>
  );
}

function ColumnLabel({ label, meta }: { readonly label: string; readonly meta: string }) {
  return (
    <div className="ai-privacy-review__label">
      <span>{label}</span>
      <strong>{meta}</strong>
    </div>
  );
}

function toControlFields(settings: AiPrivacyRequestSettings): readonly ControlField[] {
  return AI_VISIBLE_FIELDS.map((field) => {
    if (REQUIRED_FIELD_LABELS.has(field.label)) {
      return {
        ...field,
        control: "required",
        enabled: true,
      };
    }

    return {
      ...field,
      control: "optional",
      enabled: optionalSettingEnabled(settings, field),
      settingKey: optionalSettingKey(field),
    };
  });
}

function optionalSettingEnabled(settings: AiPrivacyRequestSettings, field: VisibleField): boolean {
  const key = optionalSettingKey(field);
  return key ? settings.optional[key] : true;
}

function optionalSettingKey(field: VisibleField): keyof AiPrivacyRequestOptionalSettings | undefined {
  if (field.label === "Site URL") return "siteUrl";
  if (field.scope === "title") return "title";
  if (field.scope === "profile") return "workProfile";
  return undefined;
}

function ControlRow({
  field,
  onOptionalChange,
}: {
  readonly field: ControlField;
  readonly onOptionalChange?: (key: keyof AiPrivacyRequestOptionalSettings, enabled: boolean) => void;
}) {
  if (field.control === "required") {
    return (
      <div className="ai-privacy-review__row ai-privacy-review__row--required" role="listitem">
        <span>
          <strong>{field.detail}</strong>
        </span>
        <em>Required</em>
      </div>
    );
  }

  return (
    <label className="ai-privacy-review__row ai-privacy-review__row--optional" role="listitem">
      <span>
        <strong>{field.detail}</strong>
      </span>
      <ControlSwitch field={field} onOptionalChange={onOptionalChange} />
    </label>
  );
}

function ControlSwitch({
  field,
  onOptionalChange,
}: {
  readonly field: ControlField;
  readonly onOptionalChange?: (key: keyof AiPrivacyRequestOptionalSettings, enabled: boolean) => void;
}) {
  const settingKey = field.settingKey;
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!settingKey || !onOptionalChange) return;
    onOptionalChange(settingKey, event.currentTarget.checked);
  };

  return (
    <span className="ai-privacy-review__switch">
      <input checked={field.enabled} role="switch" type="checkbox" aria-label={field.detail} onChange={handleChange} />
      <span aria-hidden="true" />
    </span>
  );
}

function LockedLocalColumn() {
  return (
    <div className="ai-privacy-review__column ai-privacy-review__column--local">
      <ColumnLabel label="Always local" meta="Locked local" />
      <LockedFieldList />
    </div>
  );
}

function LockedFieldList() {
  return (
    <div className="ai-privacy-review__locked-list" role="list" aria-label="Fields kept local">
      {AI_EXCLUDED_FIELDS.map((field) => (
        <div className="ai-privacy-review__locked-row" key={field.label} role="listitem">
          <ExclusionGlyph />
          <span>
            <strong>{field.label}</strong>
            <small>{field.detail}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function ExclusionGlyph() {
  return <span className="ai-privacy-exclusion-glyph" aria-hidden="true" />;
}
