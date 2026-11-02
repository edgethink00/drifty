import { useCallback, useRef, useState } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { KeyHint } from "../../components/KeyHint";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useCopyFeedback } from "../../lib/useCopyFeedback";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalSubmitShortcut } from "../../lib/useModalSubmitShortcut";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { CodeValue } from "../settings/DeveloperSettingsSection";
import { SettingsSelect } from "../settings/SettingsSelect";
import {
  PERSONAL_API_BASE_URL,
  PERSONAL_API_KEY_NAME_MAX_LENGTH,
  PersonalApiKeysError,
  type PersonalApiKey,
  type PersonalApiKeyLifetime,
  type PersonalApiScope,
} from "./personalApiKeysClient";
import { PersonalApiSyncNotice, type PersonalApiSyncNoticeState } from "./PersonalApiSyncNotice";
import "./personalApi.css";

type LifetimeOption = "30" | "90" | "365" | "never";

const LIFETIME_OPTIONS: ReadonlyArray<{ readonly value: LifetimeOption; readonly labelKey: TranslationKey }> = [
  { value: "30", labelKey: "settings.developer.api.dialog.expiry30" },
  { value: "90", labelKey: "settings.developer.api.dialog.expiry90" },
  { value: "365", labelKey: "settings.developer.api.dialog.expiry365" },
  { value: "never", labelKey: "settings.developer.api.dialog.expiryNever" },
];

const SCOPE_OPTIONS: ReadonlyArray<{ readonly scope: PersonalApiScope; readonly labelKey: TranslationKey; readonly detailKey: TranslationKey }> = [
  { scope: "summary:read", labelKey: "settings.developer.api.scopeSummary", detailKey: "settings.developer.api.dialog.summaryDetail" },
  { scope: "activity:read", labelKey: "settings.developer.api.scopeActivity", detailKey: "settings.developer.api.dialog.activityDetail" },
];

function lifetimeDays(value: LifetimeOption): PersonalApiKeyLifetime {
  return value === "never" ? null : (Number(value) as 30 | 90 | 365);
}

/** The first request to try, using the scope the key can read. */
export function personalApiExampleCommand(token: string, scopes: readonly PersonalApiScope[], timeZone: string): string {
  const path = scopes.includes("summary:read") ? `summary?tz=${timeZone}` : `activity?tz=${timeZone}&limit=5`;
  return `curl -H "Authorization: Bearer ${token}" "${PERSONAL_API_BASE_URL}/${path}"`;
}

export type PersonalApiKeyDialogProps = {
  readonly onCreate: (input: {
    readonly name: string;
    readonly scopes: readonly PersonalApiScope[];
    readonly expiresInDays: PersonalApiKeyLifetime;
  }) => Promise<{ readonly key: PersonalApiKey; readonly token: string }>;
  readonly onClose: () => void;
  /**
   * Whether this computer's records reach the API, shown with the command to
   * try so an empty answer is not a surprise. Null when nothing needs saying.
   */
  readonly syncNotice?: PersonalApiSyncNoticeState | null;
  /** Opens Sync's consent dialog above this one, so the shown key stays. */
  readonly onTurnOnSync?: () => void;
};

/**
 * A new key's dialog: a name, what it can read and how long it lasts. After
 * the server creates it, the same dialog shows the key, the one time it is
 * ever shown, with a command to try it and, when this computer does not sync,
 * why that command will not show its records.
 */
export function PersonalApiKeyDialog({ onCreate, onClose, syncNotice = null, onTurnOnSync }: PersonalApiKeyDialogProps): JSX.Element {
  const { t } = useLocalization();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<readonly PersonalApiScope[]>(["summary:read"]);
  const [lifetime, setLifetime] = useState<LifetimeOption>("90");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [created, setCreated] = useState<{ readonly key: PersonalApiKey; readonly token: string } | null>(null);
  const { copiedKey, showCopied, clearCopied } = useCopyFeedback<string>();
  const inFlight = useRef(false);
  const canCreate = !created && !creating && name.trim().length > 0 && scopes.length > 0;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const requestClose = useCallback(() => {
    if (!creating) onClose();
  }, [creating, onClose]);
  useModalDismiss(requestClose, { disabled: creating });
  useAnchoredDialog(dialogRef);
  // A shown key is lost on a stray click, so only the buttons and Escape close it then.
  const overlayDismiss = useOverlayDismiss(requestClose, { disabled: creating, keepOpen: created !== null || name.trim() !== "" });

  const create = async () => {
    if (!canCreate || inFlight.current) return;
    inFlight.current = true;
    setCreating(true);
    setError(null);
    try {
      setCreated(await onCreate({ name: name.trim(), scopes, expiresInDays: lifetimeDays(lifetime) }));
    } catch (nextError) {
      const code = nextError instanceof PersonalApiKeysError ? nextError.code : "failed";
      setError(code === "plan_required"
        ? "settings.developer.api.dialog.errorPlan"
        : code === "key_limit_reached" ? "settings.developer.api.dialog.errorLimit" : "settings.developer.api.dialog.errorFailed");
    } finally {
      setCreating(false);
      inFlight.current = false;
    }
  };
  // One short field: Enter creates, as other one-line forms do.
  useModalSubmitShortcut(dialogRef, "enter", () => void create(), { disabled: !canCreate });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showCopied(value);
    } catch {
      clearCopied();
    }
  };

  const toggleScope = (scope: PersonalApiScope, checked: boolean) => {
    setScopes((current) => SCOPE_OPTIONS.map((option) => option.scope)
      .filter((candidate) => candidate === scope ? checked : current.includes(candidate)));
  };

  const example = created ? personalApiExampleCommand(created.token, created.key.scopes, timeZone) : "";

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="auth-modal modal-shell personal-api-dialog"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-api-dialog-title"
        aria-describedby="personal-api-dialog-lede"
        aria-busy={creating}
        data-modal-initial-selector={created ? "[data-personal-api-done]" : "[data-personal-api-name]"}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("settings.developer.api.dialog.close")} onClick={requestClose} disabled={creating} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="personal-api-dialog-title">
              {t(created ? "settings.developer.api.reveal.title" : "settings.developer.api.dialog.title")}
            </h2>
            <p id="personal-api-dialog-lede">
              {t(created ? "settings.developer.api.reveal.lede" : "settings.developer.api.dialog.lede")}
            </p>
          </div>
        </div>
        {created ? (
          <div className="personal-api-dialog__reveal">
            <div className="personal-api-dialog__token">
              <CodeValue
                value={created.token}
                copied={copiedKey === created.token}
                copyLabel={t("settings.developer.api.copy")}
                copiedLabel={t("settings.developer.api.copied")}
                onCopy={() => void copy(created.token)}
              />
            </div>
            <div className="personal-api-dialog__field">
              <span className="personal-api-dialog__label">{t("settings.developer.api.reveal.try")}</span>
              <div className="personal-api-dialog__example">
                <CodeValue
                  value={example}
                  copied={copiedKey === example}
                  copyLabel={t("settings.developer.api.copy")}
                  copiedLabel={t("settings.developer.api.copied")}
                  onCopy={() => void copy(example)}
                />
              </div>
            </div>
            {syncNotice ? <PersonalApiSyncNotice state={syncNotice} place="reveal" onTurnOnSync={onTurnOnSync} /> : null}
          </div>
        ) : (
          <fieldset className="personal-api-dialog__fields" disabled={creating}>
            <label className="personal-api-dialog__field">
              <span className="personal-api-dialog__label">{t("settings.developer.api.dialog.name")}</span>
              <input
                className="settings-input"
                data-personal-api-name
                value={name}
                maxLength={PERSONAL_API_KEY_NAME_MAX_LENGTH}
                placeholder={t("settings.developer.api.dialog.namePlaceholder")}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="personal-api-dialog__field" role="group" aria-labelledby="personal-api-dialog-scopes">
              <span id="personal-api-dialog-scopes" className="personal-api-dialog__label">{t("settings.developer.api.dialog.permissions")}</span>
              {SCOPE_OPTIONS.map((option) => (
                <label key={option.scope} className="personal-api-dialog__scope">
                  <input
                    type="checkbox"
                    checked={scopes.includes(option.scope)}
                    onChange={(event) => toggleScope(option.scope, event.currentTarget.checked)}
                  />
                  <span>
                    {t(option.labelKey)}
                    <span className="personal-api-dialog__scope-detail">{t(option.detailKey)}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="personal-api-dialog__field">
              <span className="personal-api-dialog__label" id="personal-api-dialog-expiry">{t("settings.developer.api.dialog.expiry")}</span>
              <SettingsSelect
                ariaLabel={t("settings.developer.api.dialog.expiry")}
                className="personal-api-dialog__select"
                value={lifetime}
                options={LIFETIME_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                disabled={creating}
                onChange={setLifetime}
              />
            </div>
          </fieldset>
        )}
        <div className="modal-foot">
          {error ? <p className="modal-foot__note modal-foot__note--error" role="alert">{t(error)}</p> : null}
          {created ? (
            <button type="button" className="modal-btn modal-btn--primary" data-personal-api-done onClick={onClose}>
              {t("settings.developer.api.reveal.done")}
            </button>
          ) : (
            <>
              <button type="button" className="modal-btn modal-btn--ghost" onClick={requestClose} disabled={creating}>
                {t("common.cancel")}<KeyHint shortcut="escape" />
              </button>
              <button type="button" className="modal-btn modal-btn--primary" onClick={() => void create()} disabled={!canCreate} aria-busy={creating}>
                <ActionLabel busy={creating} busyLabel={t("settings.developer.api.dialog.creating")}>{t("settings.developer.api.dialog.create")}</ActionLabel>
                <KeyHint shortcut="enter" />
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
