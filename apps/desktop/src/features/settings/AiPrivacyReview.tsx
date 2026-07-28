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

export type ControlField = VisibleField & {
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

export const AI_EXCLUDED_FIELDS: readonly ExcludedField[] = [
  { labelKey: "settings.aiPrivacy.rawTimeline", detailKey: "settings.aiPrivacy.rawTimelineDetail" },
  { labelKey: "settings.aiPrivacy.fullHistory", detailKey: "settings.aiPrivacy.fullHistoryDetail" },
  { labelKey: "settings.aiPrivacy.rawBodies", detailKey: "settings.aiPrivacy.rawBodiesDetail" },
  { labelKey: "settings.aiPrivacy.youtubeDescriptions", detailKey: "settings.aiPrivacy.youtubeDescriptionsDetail" },
  { labelKey: "settings.aiPrivacy.providerKeys", detailKey: "settings.aiPrivacy.providerKeysDetail" },
] as const;

export type AiPrivacyReviewModel = {
  readonly requiredFields: readonly ControlField[];
  readonly optionalFields: readonly ControlField[];
  readonly handleOptionalChange: (key: keyof AiPrivacyRequestOptionalSettings, enabled: boolean) => void;
};

export function useAiPrivacyReviewModel(): AiPrivacyReviewModel {
  const [settings, setSettings] = useState<AiPrivacyRequestSettings>(() => readAiPrivacyRequestSettings());
  const controlFields = useMemo(() => toControlFields(settings), [settings]);
  const requiredFields = useMemo(() => controlFields.filter((field) => field.control === "required"), [controlFields]);
  const optionalFields = useMemo(() => controlFields.filter((field) => field.control === "optional"), [controlFields]);

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
    // saveAiPrivacyRequestSettings dispatches a window event; keep it out of setState updaters (render-phase side effect).
    const nextSettings = updateAiPrivacyRequestOptionalSetting(readAiPrivacyRequestSettings(), key, enabled);
    saveAiPrivacyRequestSettings(nextSettings);
    setSettings(nextSettings);
  };

  return { requiredFields, optionalFields, handleOptionalChange };
}

export function AiPrivacyReview() {
  const { t } = useLocalization();
  const { requiredFields, optionalFields, handleOptionalChange } = useAiPrivacyReviewModel();

  return (
    <section className="ai-privacy-review" aria-label={t("settings.aiPrivacy.reviewAria")}>
      <div className="ai-privacy-review__flow">
        <div className="ai-privacy-review__zone ai-privacy-review__zone--local">
          <ZoneHeader title={t("settings.aiPrivacy.localZoneTitle")} meta={t("settings.aiPrivacy.lockedLocal")} />
          <div className="ai-privacy-review__local-list" role="list" aria-label={t("settings.aiPrivacy.localFieldsAria")}>
            {AI_EXCLUDED_FIELDS.map((field) => (
              <div className="ai-privacy-review__local-item" key={field.labelKey} role="listitem">
                <span className="ai-privacy-review__local-lock" aria-hidden="true" />
                <span className="ai-privacy-review__local-text">
                  <strong>{t(field.labelKey)}</strong>
                  <small>{t(field.detailKey)}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="ai-privacy-review__boundary" aria-hidden="true">
          <span className="ai-privacy-review__boundary-lock" />
        </div>
        <div className="ai-privacy-review__zone ai-privacy-review__zone--sent">
          <ZoneHeader title={t("settings.aiPrivacy.sentZoneTitle")} />
          <div className="ai-privacy-review__tokens" role="list" aria-label={t("settings.aiPrivacy.requiredFieldsAria")}>
            {requiredFields.map((field) => (
              <span className="ai-privacy-review__token" key={field.detailKey} role="listitem">
                <span className="ai-privacy-review__token-label">{t(field.detailKey)}</span>
                <span className="chip gray">{t("common.required")}</span>
              </span>
            ))}
          </div>
          <ZoneHeader spaced title={t("settings.aiPrivacy.optionalContext")} meta={t("settings.aiPrivacy.userControlled")} />
          <div className="ai-privacy-review__list" role="list" aria-label={t("settings.aiPrivacy.optionalFieldsAria")}>
            {optionalFields.map((field) => (
              <OptionalRow field={field} key={field.detailKey} onOptionalChange={handleOptionalChange} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ZoneHeader({ title, meta, spaced = false }: { readonly title: string; readonly meta?: string; readonly spaced?: boolean }) {
  return (
    <div className={`ai-privacy-review__zone-header${spaced ? " ai-privacy-review__zone-header--spaced" : ""}`}>
      <span className="ai-privacy-review__zone-title">{title}</span>
      {meta ? <strong className="chip gray">{meta}</strong> : null}
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

function OptionalRow({
  field,
  onOptionalChange,
}: {
  readonly field: ControlField;
  readonly onOptionalChange?: (key: keyof AiPrivacyRequestOptionalSettings, enabled: boolean) => void;
}) {
  const { t } = useLocalization();
  const detail = t(field.detailKey);
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

export function InfoTooltip({ label, text }: { readonly label: string; readonly text: string }) {
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

export function ControlSwitch({
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
