import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { KeyHint } from "../../components/KeyHint";
import { useLocalization } from "../localization/LocalizationContext";

/** The longest name the server accepts for a team or organization. */
export const TEAM_NAME_MAX_LENGTH = 120;

export type TeamGeneralDetail = { readonly label: string; readonly value: string };

export type TeamGeneralDanger = {
  readonly key: string;
  readonly title: string;
  readonly hint: string;
  /** The button's own words where they differ from the row's title. */
  readonly action?: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
};

export type TeamGeneralSettingsProps = {
  readonly nameLabel: string;
  readonly name: string;
  /** Saves a new name; null shows the name without a field (the seat may not rename). */
  readonly onRename: ((name: string) => Promise<boolean>) | null;
  /** Read-only facts about the viewer's seat, as a manager's teams and reach. */
  readonly details: readonly TeamGeneralDetail[];
  /** Handing over and deleting for the owner, leaving for anyone else. */
  readonly danger: readonly TeamGeneralDanger[];
};

/**
 * Settings › General (owner question 2026-10-22): the name first, then the
 * danger zone, as Rize's team settings keep Team Name on top and Delete Team
 * last, and as Drifty's own Settings › Account ends in a danger zone.
 */
export function TeamGeneralSettings({ nameLabel, name, onRename, details, danger }: TeamGeneralSettingsProps): JSX.Element {
  const { t } = useLocalization();
  return (
    <div className="team-general">
      <div className="team-form-rows">
        {onRename ? (
          // A saved rename comes back as a new name; the field starts over from it.
          <TeamNameRow key={name} label={nameLabel} name={name} onRename={onRename} />
        ) : (
          <div className="team-form-row">
            <div className="team-form-row__copy"><strong>{nameLabel}</strong></div>
            <div className="team-form-row__control"><span className="team-general__value">{name}</span></div>
          </div>
        )}
        {details.map((detail) => (
          <div key={detail.label} className="team-form-row">
            <div className="team-form-row__copy"><strong>{detail.label}</strong></div>
            <div className="team-form-row__control"><span className="team-general__value">{detail.value}</span></div>
          </div>
        ))}
      </div>
      {danger.length > 0 ? (
        <section className="team-general__danger" aria-labelledby="team-general-danger">
          <span id="team-general-danger" className="label-mono">{t("settings.account.dangerZone")}</span>
          <div className="team-form-rows">
            {danger.map((row) => (
              <div key={row.key} className="team-form-row">
                <div className="team-form-row__copy">
                  <strong>{row.title}</strong>
                  <span>{row.hint}</span>
                </div>
                <div className="team-form-row__control">
                  <button type="button" className="modal-btn modal-btn--danger" disabled={row.disabled} onClick={row.onClick}>
                    {row.action ?? row.title}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TeamNameRow({ label, name, onRename }: { readonly label: string; readonly name: string; readonly onRename: (name: string) => Promise<boolean> }): JSX.Element {
  const { t } = useLocalization();
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const trimmed = draft.trim();
  const changed = trimmed !== name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= TEAM_NAME_MAX_LENGTH;
  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!changed || !valid || busy) return;
    setBusy(true);
    setFailed(false);
    const saved = await onRename(trimmed);
    setBusy(false);
    if (!saved) setFailed(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && changed) {
      // Esc puts the saved name back before it would close anything around the field.
      event.preventDefault();
      event.stopPropagation();
      setDraft(name);
      setFailed(false);
    }
  };
  return (
    // Enter submits the form, as the field's Save button says.
    <form className="team-form-row" onSubmit={(event) => void save(event)}>
      <div className="team-form-row__copy">
        <strong id="team-general-name">{label}</strong>
        {failed ? <span className="team-general__error" role="alert">{t("team.general.saveFailed")}</span> : null}
      </div>
      <div className="team-form-row__control">
        <input
          className="settings-input team-general__name"
          type="text"
          value={draft}
          maxLength={TEAM_NAME_MAX_LENGTH}
          aria-labelledby="team-general-name"
          disabled={busy}
          onChange={(event) => { setDraft(event.target.value); setFailed(false); }}
          onKeyDown={onKeyDown}
        />
        {changed ? (
          <button type="submit" className="modal-btn modal-btn--primary team-general__save" disabled={!valid || busy} aria-busy={busy || undefined}>
            <ActionLabel busy={busy}>{t("team.general.save")}</ActionLabel>
            <KeyHint shortcut="enter" />
          </button>
        ) : null}
      </div>
    </form>
  );
}
