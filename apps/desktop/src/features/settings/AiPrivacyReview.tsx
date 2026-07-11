import { useEffect, useId, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import {
  AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT,
  readAiPrivacyRequestSettings,
  saveAiPrivacyRequestSettings,
  updateAiPrivacyRequestOptionalSetting,
  type AiPrivacyRequestOptionalSettings,
  type AiPrivacyRequestSettings,
} from "./aiPrivacyRequestSettings";

type VisibleField = {
  readonly detailKey: TranslationKey;
  readonly scope: "app" | "site" | "windowTitle" | "content" | "time" | "profile";
  readonly required?: boolean;
  readonly settingKey?: keyof AiPrivacyRequestOptionalSettings;
  readonly helpTextKey?: TranslationKey;
};

type ExcludedField = {
  readonly labelKey: TranslationKey;
  readonly detailKey: TranslationKey;
};

type ControlField = VisibleField & {
  readonly control: "required" | "optional";
  readonly enabled: boolean;
  readonly settingKey?: keyof AiPrivacyRequestOptionalSettings;
};

const AI_VISIBLE_FIELDS: readonly VisibleField[] = [
  { detailKey: "settings.aiPrivacy.appContext", scope: "app", required: true },
  { detailKey: "settings.aiPrivacy.duration", scope: "time", required: true },
  { detailKey: "settings.aiPrivacy.siteDomain", scope: "site", required: true },
  { detailKey: "settings.aiPrivacy.siteUrl", scope: "site", settingKey: "siteUrl" },
  { detailKey: "settings.aiPrivacy.windowTitle", scope: "windowTitle", settingKey: "windowTitle" },
  {
    detailKey: "settings.aiPrivacy.contentContext",
    scope: "content",
    settingKey: "contentContext",
    helpTextKey: "settings.aiPrivacy.contentContextHelp",
  },
  { detailKey: "settings.aiPrivacy.workProfile", scope: "profile", settingKey: "workProfile" },
] as const;

const AI_EXCLUDED_FIELDS: readonly ExcludedField[] = [
  { labelKey: "settings.aiPrivacy.rawTimeline", detailKey: "settings.aiPrivacy.rawTimelineDetail" },
  { labelKey: "settings.aiPrivacy.fullHistory", detailKey: "settings.aiPrivacy.fullHistoryDetail" },
  { labelKey: "settings.aiPrivacy.rawBodies", detailKey: "settings.aiPrivacy.rawBodiesDetail" },
  { labelKey: "settings.aiPrivacy.youtubeDescriptions", detailKey: "settings.aiPrivacy.youtubeDescriptionsDetail" },
  { labelKey: "settings.aiPrivacy.providerKeys", detailKey: "settings.aiPrivacy.providerKeysDetail" },
] as const;

export function AiPrivacyReview() {
  const { t } = useLocalization();
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
    <section className="ai-privacy-review" aria-label={t("settings.aiPrivacy.reviewAria")}>
      <p className="ai-privacy-review__intro">{t("settings.aiPrivacy.intro")}</p>
      <div className="ai-privacy-review__chips" aria-label={t("settings.aiPrivacy.safeguardsAria")}>
        <span className="chip green">{t("settings.aiPrivacy.rawLocal")}</span>
        <span className="chip gray">{t("settings.aiPrivacy.keysLocal")}</span>
        <span className="chip gray">{t("settings.aiPrivacy.optionalControlled")}</span>
      </div>
      <div className="ai-privacy-review__boundary">
        <div className="ai-privacy-review__column">
          <ColumnLabel label={t("settings.aiPrivacy.requiredFields")} meta={t("settings.aiPrivacy.lockedOn")} />
          <div className="ai-privacy-review__list" role="list" aria-label={t("settings.aiPrivacy.requiredFieldsAria")}>
            {requiredFields.map((field) => (
              <ControlRow field={field} key={field.detailKey} />
            ))}
          </div>
          <ColumnLabel label={t("settings.aiPrivacy.optionalContext")} meta={t("settings.aiPrivacy.userControlled")} />
          <div className="ai-privacy-review__list" role="list" aria-label={t("settings.aiPrivacy.optionalFieldsAria")}>
            {optionalFields.map((field) => (
              <ControlRow field={field} key={field.detailKey} onOptionalChange={handleOptionalChange} />
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
    if (field.required) {
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
  return field.settingKey;
}

function ControlRow({
  field,
  onOptionalChange,
}: {
  readonly field: ControlField;
  readonly onOptionalChange?: (key: keyof AiPrivacyRequestOptionalSettings, enabled: boolean) => void;
}) {
  const { t } = useLocalization();
  const detail = t(field.detailKey);
  if (field.control === "required") {
    return (
      <div className="ai-privacy-review__row ai-privacy-review__row--required" role="listitem">
        <span className="ai-privacy-review__row-text">
          <strong>{detail}</strong>
        </span>
        <em>{t("common.required")}</em>
      </div>
    );
  }

  return (
    <div className="ai-privacy-review__row ai-privacy-review__row--optional" role="listitem">
      <span className="ai-privacy-review__row-text">
        <span className="ai-privacy-review__row-heading">
          <strong>{detail}</strong>
          {field.helpTextKey ? <InfoTooltip label={detail} text={t(field.helpTextKey)} /> : null}
        </span>
      </span>
      <ControlSwitch field={field} onOptionalChange={onOptionalChange} />
    </div>
  );
}

function InfoTooltip({ label, text }: { readonly label: string; readonly text: string }) {
  const { t } = useLocalization();
  const reactId = useId();
  const tooltipId = `ai-privacy-${reactId.replace(/:/g, "")}-tooltip`;
  return (
    <span className="ai-privacy-review__help-wrap">
      <button aria-describedby={tooltipId} aria-label={t("settings.aiPrivacy.detailsAria", { label })} className="ai-privacy-review__help" type="button">{t("settings.aiPrivacy.details")}</button>
      <span className="ai-privacy-review__tooltip" id={tooltipId} role="tooltip">{text}</span>
    </span>
  );
}

function ControlSwitch({
  field,
  onOptionalChange,
}: {
  readonly field: ControlField;
  readonly onOptionalChange?: (key: keyof AiPrivacyRequestOptionalSettings, enabled: boolean) => void;
}) {
  const { t } = useLocalization();
  const settingKey = field.settingKey;
  const detail = t(field.detailKey);
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!settingKey || !onOptionalChange) return;
    onOptionalChange(settingKey, event.currentTarget.checked);
  };

  return (
    <label className="ai-privacy-review__switch" aria-label={detail}>
      <input checked={field.enabled} role="switch" type="checkbox" aria-label={detail} onChange={handleChange} />
      <span aria-hidden="true" />
    </label>
  );
}

function LockedLocalColumn() {
  const { t } = useLocalization();
  return (
    <div className="ai-privacy-review__column ai-privacy-review__column--local">
      <ColumnLabel label={t("settings.aiPrivacy.alwaysLocal")} meta={t("settings.aiPrivacy.lockedLocal")} />
      <LockedFieldList />
    </div>
  );
}

function LockedFieldList() {
  const { t } = useLocalization();
  return (
    <div className="ai-privacy-review__locked-list" role="list" aria-label={t("settings.aiPrivacy.localFieldsAria")}>
      {AI_EXCLUDED_FIELDS.map((field) => (
        <div className="ai-privacy-review__locked-row" key={field.labelKey} role="listitem">
          <ExclusionGlyph />
          <span>
            <strong>{t(field.labelKey)}</strong>
            <small>{t(field.detailKey)}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function ExclusionGlyph() {
  return <span className="ai-privacy-exclusion-glyph" aria-hidden="true" />;
}
