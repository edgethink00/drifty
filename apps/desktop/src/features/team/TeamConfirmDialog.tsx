import { useRef, useState } from "react";

import { ActionLabel } from "../../components/ActionLabel";
import { KeyHint } from "../../components/KeyHint";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalSubmitShortcut } from "../../lib/useModalSubmitShortcut";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { SettingsSelect } from "../settings/SettingsSelect";

/** One choice the action needs, as whom to hand the team to or where a deleted team's people go. */
export type TeamConfirmChoice = {
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string; readonly statusLabel?: string }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
};

export type TeamConfirmDialogProps = {
  readonly title: string;
  /** What changes, one line each. */
  readonly items: readonly string[];
  readonly confirmLabel: string;
  readonly busyLabel: string;
  readonly busy: boolean;
  /** Set after a failed attempt; the dialog stays open on it. */
  readonly error: string | null;
  /** For what cannot be undone at all: typing this (case and outer spaces aside) unlocks the action. */
  readonly typed?: { readonly label: string; readonly target: string };
  readonly choice?: TeamConfirmChoice;
  /** Handing the team over is not destructive; it takes the primary button. */
  readonly tone?: "danger" | "primary";
  /** A third way out, before Cancel: "Don't save" when leaving unsaved edits. */
  readonly secondary?: { readonly label: string; readonly onClick: () => void };
  readonly onCancel: () => void;
  /** Receives what was typed, which the server checks again. */
  readonly onConfirm: (typed: string) => void;
};

/**
 * Leaving a team, removing someone from it and deleting it ask first in a
 * small dialog over Team settings, as leaving the leaderboard and deleting a
 * project do: what changes, then Cancel and the action. Deleting the whole
 * team also asks for its name, as deleting the account asks for the address.
 * Only that typed step finishes on Enter; the others wait for a click.
 */
export function TeamConfirmDialog({ title, items, confirmLabel, busyLabel, busy, error, typed, choice, tone = "danger", secondary, onCancel, onConfirm }: TeamConfirmDialogProps): JSX.Element {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement>(null);
  const [value, setValue] = useState("");
  const matches = !typed || value.trim().toLowerCase() === typed.target.trim().toLowerCase();
  useModalDismiss(onCancel, { disabled: busy });
  const overlayDismiss = useOverlayDismiss(onCancel, { disabled: busy, keepOpen: value.trim().length > 0 });
  useAnchoredDialog(panelRef);
  useModalSubmitShortcut(panelRef, "enter", () => onConfirm(value), { disabled: !typed || !matches || busy });

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={panelRef}
        className="auth-modal modal-shell team-confirm"
        data-modal-variant="compact"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="team-confirm-title"
        aria-describedby="team-confirm-detail"
        data-modal-initial-selector={typed ? "[data-team-confirm-input]" : "[data-team-confirm-cancel]"}
      >
        <div className="auth-modal__header">
          <h2 id="team-confirm-title">{title}</h2>
          {/* One consequence reads as a sentence; several read as a list, as in Leave leaderboard. */}
          {items.length === 1 ? (
            <p id="team-confirm-detail" className="team-confirm__detail">{items[0]}</p>
          ) : (
            <ul id="team-confirm-detail" className="team-confirm__list">
              {items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
          {error && !busy ? <p className="team-confirm__error" role="alert">{error}</p> : null}
        </div>
        {typed ? (
          <label className="team-confirm__typed">
            <span>{typed.label}</span>
            <input
              className="settings-input"
              data-team-confirm-input
              value={value}
              maxLength={120}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        ) : null}
        {choice ? (
          <div className="team-confirm__typed team-confirm__choice">
            <span id="team-confirm-choice">{choice.label}</span>
            <SettingsSelect ariaLabel={choice.label} className="team-confirm__select" value={choice.value} options={choice.options} disabled={busy} onChange={choice.onChange} />
          </div>
        ) : null}
        <div className="team-confirm__actions">
          {secondary ? <button type="button" className="modal-btn modal-btn--ghost team-confirm__secondary" disabled={busy} onClick={secondary.onClick}>{secondary.label}</button> : null}
          <button type="button" className="modal-btn modal-btn--ghost" data-team-confirm-cancel disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
            <KeyHint shortcut="escape" />
          </button>
          <button type="button" className={"modal-btn " + (tone === "primary" ? "modal-btn--primary" : "modal-btn--danger")} disabled={busy || !matches} aria-busy={busy} onClick={() => onConfirm(value)}>
            <ActionLabel busy={busy} busyLabel={busyLabel}>{confirmLabel}</ActionLabel>
            {typed ? <KeyHint shortcut="enter" /> : null}
          </button>
        </div>
      </section>
    </div>
  );
}
