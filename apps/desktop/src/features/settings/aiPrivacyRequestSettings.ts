export const AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY = "drifty.aiPrivacyRequestSettings.v1";
export const AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT = "drifty:ai-privacy-request-settings-changed";
export const AI_PRIVACY_REQUEST_SETTINGS_VERSION = 1;

export type AiPrivacyRequestOptionalSettings = {
  readonly siteUrl: boolean;
  readonly title: boolean;
  readonly workProfile: boolean;
};

export type AiPrivacyRequestSettings = {
  readonly version: typeof AI_PRIVACY_REQUEST_SETTINGS_VERSION;
  readonly optional: AiPrivacyRequestOptionalSettings;
};

export const DEFAULT_AI_PRIVACY_REQUEST_SETTINGS: AiPrivacyRequestSettings = {
  version: AI_PRIVACY_REQUEST_SETTINGS_VERSION,
  optional: {
    siteUrl: true,
    title: true,
    workProfile: true,
  },
};

export function readAiPrivacyRequestSettings(): AiPrivacyRequestSettings {
  const storage = browserLocalStorage();
  if (!storage) return DEFAULT_AI_PRIVACY_REQUEST_SETTINGS;
  const rawValue = storage.getItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY);
  if (!rawValue) return DEFAULT_AI_PRIVACY_REQUEST_SETTINGS;

  try {
    const parsed: unknown = JSON.parse(rawValue);
    return parseAiPrivacyRequestSettings(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) return DEFAULT_AI_PRIVACY_REQUEST_SETTINGS;
    if (error instanceof Error) return DEFAULT_AI_PRIVACY_REQUEST_SETTINGS;
    return DEFAULT_AI_PRIVACY_REQUEST_SETTINGS;
  }
}

export function saveAiPrivacyRequestSettings(settings: AiPrivacyRequestSettings): void {
  const storage = browserLocalStorage();
  if (!storage) return;
  storage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT));
}

export function updateAiPrivacyRequestOptionalSetting(
  settings: AiPrivacyRequestSettings,
  key: keyof AiPrivacyRequestOptionalSettings,
  enabled: boolean,
): AiPrivacyRequestSettings {
  return {
    version: AI_PRIVACY_REQUEST_SETTINGS_VERSION,
    optional: {
      ...settings.optional,
      [key]: enabled,
    },
  };
}

function parseAiPrivacyRequestSettings(value: unknown): AiPrivacyRequestSettings {
  if (!isRecord(value)) return DEFAULT_AI_PRIVACY_REQUEST_SETTINGS;
  if (value.version !== AI_PRIVACY_REQUEST_SETTINGS_VERSION) return DEFAULT_AI_PRIVACY_REQUEST_SETTINGS;
  if (!isRecord(value.optional)) return DEFAULT_AI_PRIVACY_REQUEST_SETTINGS;

  return {
    version: AI_PRIVACY_REQUEST_SETTINGS_VERSION,
    optional: {
      siteUrl: booleanOrDefault(value.optional.siteUrl, DEFAULT_AI_PRIVACY_REQUEST_SETTINGS.optional.siteUrl),
      title: booleanOrDefault(value.optional.title, DEFAULT_AI_PRIVACY_REQUEST_SETTINGS.optional.title),
      workProfile: booleanOrDefault(value.optional.workProfile, DEFAULT_AI_PRIVACY_REQUEST_SETTINGS.optional.workProfile),
    },
  };
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function browserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
