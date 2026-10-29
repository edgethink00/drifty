import { useEffect, useId, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

import { ActionLabel } from "../../components/ActionLabel";
import { FloatingNoticePortal } from "../../components/FloatingNoticePortal";
import { KeyHint } from "../../components/KeyHint";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useFloatingNotice } from "../../components/useFloatingNotice";
import { useModalSubmitShortcut } from "../../lib/useModalSubmitShortcut";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import "../settings/HistoryDeletionNotice.css";
import { SettingsSelect } from "../settings/SettingsSelect";
import {
  addInviteRecipients,
  emailLocalPart,
  isMultiRecipientPaste,
  isValidInviteEmail,
  MAX_EMAIL_INVITES_PER_SEND,
  planAfterEmailInviteSend,
} from "./teamEmailInviteModel";
import type { TeamEmailInvite } from "./teamTypes";
import type { TeamEmailInviteSendOutcome } from "./useTeamInviteActions";
import "./TeamInviteDialog.css";

type Translate = ReturnType<typeof useLocalization>["t"];

export type TeamInviteLink = { readonly url: string; readonly code: string };

export type TeamInviteDialogProps = {
  readonly teamName: string;
  /** Teams the inviter may invite to; the picker shows only when there are several. */
  readonly teams: readonly { readonly id: string; readonly label: string }[];
  readonly teamId: string | null;
  readonly onTeamChange: (id: string) => void;
  /** The team's live link once it exists. */
  readonly link: TeamInviteLink | null;
  readonly linkState: "creating" | "ready" | "failed";
  readonly onRetryLink: () => void;
  readonly onCopy: (text: string) => void | Promise<unknown>;
  /** Addresses in the field. They live with the page, so a reopened dialog still holds what was not sent. */
  readonly chips: readonly string[];
  readonly onChipsChange: (chips: readonly string[]) => void;
  /** Open email invites, newest first. */
  readonly pending: readonly TeamEmailInvite[];
  readonly onSend: (emails: readonly string[]) => Promise<TeamEmailInviteSendOutcome>;
  readonly canCancel: (invite: TeamEmailInvite) => boolean;
  readonly onCancelInvite: (invite: TeamEmailInvite) => Promise<boolean>;
  readonly formatDay: (iso: string) => string;
  /** Everything went out: the page shows the floating notice after the dialog closes. */
  readonly onSent: (sent: readonly string[], members: readonly string[]) => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onClose: () => void;
};

type Note = { readonly done: string; readonly todo: string };

/** A short list of people: two by name, then "first and n more". */
export function namePeople(people: readonly string[], t: Translate): string {
  if (people.length <= 2) return people.join(", ");
  return t("team.emailInvite.namesMore", { first: people[0]!, count: people.length - 1 });
}

/**
 * Team invite by email (owner decisions 2026-10-29, "P1"): one large field
 * turns typed or pasted addresses into chips, the link stays a split button in
 * the footer with the code in its menu, and pending invites fold into one line.
 * A send that delivers everything closes the dialog; whatever still needs the
 * user stays in the field with one line saying why. Nothing warns while an
 * address is being typed; only a committed chip can turn red.
 */
export function TeamInviteDialog({
  teamName,
  teams,
  teamId,
  onTeamChange,
  link,
  linkState,
  onRetryLink,
  onCopy,
  chips,
  onChipsChange,
  pending,
  onSend,
  canCancel,
  onCancelInvite,
  formatDay,
  onSent,
  onBusyChange,
  onClose,
}: TeamInviteDialogProps) {
  const { t } = useLocalization();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const noteId = useId();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const overlayDismiss = useOverlayDismiss(onClose, { disabled: sending, keepOpen: chips.length > 0 || draft.trim().length > 0 });

  // What a send would take now: the chips plus an address still being typed.
  const recipients = draft.trim() ? addInviteRecipients(chips, draft) : chips;
  const valid = recipients.filter(isValidInviteEmail);
  const invalidChips = chips.filter((chip) => !isValidInviteEmail(chip));
  const canSend = valid.length > 0 && !sending;

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => { if (draft) setNote(null); }, [draft]);

  const commitDraft = (text: string) => {
    onChipsChange(addInviteRecipients(chips, text));
    setDraft("");
  };

  const send = async () => {
    if (!canSend) return;
    const invalid = recipients.filter((email) => !isValidInviteEmail(email));
    setDraft("");
    onChipsChange(recipients);
    if (valid.length > MAX_EMAIL_INVITES_PER_SEND) {
      setNote({ done: "", todo: t("team.emailInvite.note.tooMany", { count: MAX_EMAIL_INVITES_PER_SEND }) });
      return;
    }
    setSending(true);
    onBusyChange(true);
    let outcome: TeamEmailInviteSendOutcome;
    try {
      outcome = await onSend(valid);
    } finally {
      setSending(false);
      onBusyChange(false);
    }
    if (!outcome.ok) {
      setNote({ done: "", todo: outcome.reason === "forbidden" ? t("team.emailInvite.note.forbidden") : t("team.emailInvite.note.allFailed") });
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    const plan = planAfterEmailInviteSend(outcome.results, invalid);
    if (plan.close) {
      onChipsChange([]);
      onSent(plan.sent, plan.members);
      onClose();
      return;
    }
    onChipsChange(plan.keep);
    const done: string[] = [];
    const todo: string[] = [];
    if (plan.failed.length > 0 && plan.failed.length === outcome.results.length) {
      todo.push(t("team.emailInvite.note.allFailed"));
    } else {
      if (plan.sent.length > 0) done.push(t("team.emailInvite.note.sent", { count: plan.sent.length }));
      if (plan.members.length > 0) done.push(t("team.emailInvite.note.members", { names: namePeople(plan.members.map(emailLocalPart), t) }));
      if (plan.failed.length > 0) todo.push(t("team.emailInvite.note.failed", { count: plan.failed.length }));
    }
    if (plan.limited.length > 0) todo.push(t("team.emailInvite.note.limited"));
    if (plan.invalid.length > 0) todo.push(t("team.emailInvite.note.invalid", { count: plan.invalid.length }));
    setNote({ done: done.join(" · "), todo: todo.join(" · ") });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useModalSubmitShortcut(dialogRef, "modEnter", () => void send(), { disabled: !canSend });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Enter that commits a Hangul syllable belongs to the input method.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") return;
    const separator = event.key === "Enter" || event.key === "," || event.key === ";" || event.key === "Tab" || (event.key === " " && draft.includes("@"));
    if (separator && draft.trim()) {
      event.preventDefault();
      commitDraft(draft);
      return;
    }
    // Plain Enter only ever makes a chip; sending is the button or ⌘/Ctrl+Enter.
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Backspace" && !draft && chips.length > 0) onChipsChange(chips.slice(0, -1));
  };

  const onPaste = (event: ReactClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!isMultiRecipientPaste(text)) return;
    event.preventDefault();
    commitDraft(draft + " " + text);
  };

  const sendLabel = valid.length > 1 ? t("team.emailInvite.sendMany", { count: valid.length }) : t("team.emailInvite.send");

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="auth-modal modal-shell profile-modal team-modal team-invite"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-invite-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("team.invite.close")} onClick={onClose} disabled={sending} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="team-invite-title">{t("team.invite.title", { team: teamName })}</h2>
          </div>
        </div>
        <div className="team-modal__body team-invite__body">
          <div className="team-invite__field">
            <label className="team-invite__label" htmlFor={inputId}>{t("team.emailInvite.emailLabel")}</label>
            <div
              className={"team-invite__box" + (sending ? " is-disabled" : "")}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) { event.preventDefault(); inputRef.current?.focus(); }
              }}
            >
              {chips.map((chip) => {
                const chipValid = isValidInviteEmail(chip);
                return (
                  <span key={chip} className={"team-invite__chip" + (chipValid ? "" : " is-invalid")} title={chipValid ? undefined : t("team.emailInvite.invalidChip")}>
                    {chipValid ? (
                      <span className="team-invite__chip-lead" aria-hidden="true"><PlaneIcon /></span>
                    ) : (
                      <span className="team-invite__chip-lead team-invite__chip-lead--warn" aria-hidden="true">!</span>
                    )}
                    <span className="team-invite__chip-text">{chip}</span>
                    {chipValid ? null : <span className="sr-only">{t("team.emailInvite.invalidChip")}</span>}
                    {sending ? null : (
                      <button type="button" className="team-invite__chip-remove" aria-label={t("team.emailInvite.removeChip", { email: chip })} onClick={() => onChipsChange(chips.filter((entry) => entry !== chip))}>
                        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                      </button>
                    )}
                  </span>
                );
              })}
              <input
                ref={inputRef}
                id={inputId}
                className="team-invite__input"
                type="email"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                placeholder={chips.length > 0 ? "" : t("team.emailInvite.placeholder")}
                value={draft}
                disabled={sending}
                aria-invalid={invalidChips.length > 0 || undefined}
                aria-describedby={note ? noteId : undefined}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={() => { if (draft.trim()) commitDraft(draft); }}
              />
            </div>
            {note ? (
              <p id={noteId} className="team-invite__note" role="status">
                {note.done ? <span>{note.done}</span> : null}
                {note.done && note.todo ? <span aria-hidden="true"> · </span> : null}
                {note.todo ? <span className="team-invite__note-todo">{note.todo}</span> : null}
              </p>
            ) : null}
          </div>
          {teams.length > 1 && teamId ? (
            <div className="team-invite__field">
              <span className="team-invite__label">{t("team.invite.teamLabel")}</span>
              <SettingsSelect
                ariaLabel={t("team.invite.teamLabel")}
                className="projects-status-filter team-invite__team"
                value={teamId}
                options={teams.map((entry) => ({ value: entry.id, label: entry.label }))}
                onChange={onTeamChange}
              />
            </div>
          ) : null}
          <PendingInvites pending={pending} onSend={onSend} canCancel={canCancel} onCancelInvite={onCancelInvite} formatDay={formatDay} />
        </div>
        <div className="modal-foot team-invite__foot">
          <LinkSplitButton link={link} linkState={linkState} onRetryLink={onRetryLink} onCopy={onCopy} />
          <span className="team-invite__spacer" />
          <button type="button" className="modal-btn modal-btn--primary team-invite__send" disabled={!canSend} onClick={() => void send()}>
            <ActionLabel busy={sending} busyLabel={t("team.emailInvite.sending")} reserve={[t("team.emailInvite.sendMany", { count: 20 }), t("team.emailInvite.send")]}>{sendLabel}</ActionLabel>
            <KeyHint shortcut="modEnter" />
          </button>
        </div>
      </section>
    </div>
  );
}

function PlaneIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14 2 7.2 8.8M14 2 9.7 14l-2.5-5.2L2 6.3 14 2Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function LinkIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>;
}

function Chevron() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Shows a confirmation on a button for a moment after a copy. */
function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const show = (key: string, ms = 1800) => {
    setCopied(key);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), ms);
  };
  return { copied, show };
}

/**
 * The link as a secondary path: copy it with the main button; the menu holds
 * only the code. Turning the link off or replacing it lives in Settings ›
 * Members › Invites, for the owner.
 */
function LinkSplitButton({ link, linkState, onRetryLink, onCopy }: {
  readonly link: TeamInviteLink | null;
  readonly linkState: TeamInviteDialogProps["linkState"];
  readonly onRetryLink: () => void;
  readonly onCopy: TeamInviteDialogProps["onCopy"];
}) {
  const { t } = useLocalization();
  const [menuOpen, setMenuOpen] = useState(false);
  const { copied, show } = useCopied();
  const boxRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const frame = requestAnimationFrame(() => itemRef.current?.focus());
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !boxRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [menuOpen]);

  const failed = linkState === "failed" && !link;
  const creating = !link && !failed;
  const copyLink = () => {
    if (failed) { onRetryLink(); return; }
    if (!link) return;
    void onCopy(link.url);
    show("link");
  };
  const copyCode = () => {
    if (!link) return;
    void onCopy(link.code);
    show("code", 900);
    window.setTimeout(() => { setMenuOpen(false); caretRef.current?.focus(); }, 900);
  };

  return (
    <div
      ref={boxRef}
      className="team-invite__split"
      onKeyDown={(event) => {
        // Escape closes the menu first; the dialog stays open.
        if (event.key === "Escape" && menuOpen) {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen(false);
          caretRef.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className={"modal-btn modal-btn--secondary team-invite__split-main" + (failed ? " is-failed" : "")}
        disabled={creating}
        onClick={copyLink}
      >
        <LinkIcon />
        <ActionLabel busy={creating} busyLabel={t("team.emailInvite.linkCreating")} reserve={[t("team.invite.copied"), t("common.retry")]}>
          {copied === "link" ? t("team.invite.copied") : failed ? t("common.retry") : t("team.emailInvite.copyLink")}
        </ActionLabel>
      </button>
      <button
        ref={caretRef}
        type="button"
        className="modal-btn modal-btn--secondary team-invite__split-caret"
        aria-label={t("team.emailInvite.linkOptions")}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={!link}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Chevron />
      </button>
      {menuOpen && link ? (
        <div className="team-invite__menu" role="menu" aria-label={t("team.emailInvite.linkOptions")}>
          <button ref={itemRef} type="button" role="menuitem" onClick={copyCode}>
            {copied === "code" ? t("team.emailInvite.codeCopied") : t("team.emailInvite.copyCode")}
            <code className="team-invite__menu-code">{link.code}</code>
            <span>{t("team.emailInvite.codeHint")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

const PENDING_ROWS_SHOWN = 4;

type RowNote = { readonly text: string; readonly tone: "ok" | "warn" };

export type EmailInviteRowsProps = {
  readonly invites: readonly TeamEmailInvite[];
  readonly onSend: TeamInviteDialogProps["onSend"];
  readonly canCancel: TeamInviteDialogProps["canCancel"];
  readonly onCancelInvite: TeamInviteDialogProps["onCancelInvite"];
  readonly formatDay: TeamInviteDialogProps["formatDay"];
  /** Rows shown before "Show all"; every row when left out. */
  readonly limit?: number;
  /** In Settings › Members the rows take the roster's own row style, like the link above them. */
  readonly variant?: "dialog" | "roster";
};

/** Open email invites with resend and cancel, in the dialog and in Settings › Members › Invites. */
export function EmailInviteRows({ invites, onSend, canCancel, onCancelInvite, formatDay, limit, variant = "dialog" }: EmailInviteRowsProps) {
  const { t } = useLocalization();
  const [all, setAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Readonly<Record<string, RowNote>>>({});
  const shown = limit && !all ? invites.slice(0, limit) : invites;

  const resend = async (invite: TeamEmailInvite) => {
    setBusyId(invite.invite_id);
    const outcome = await onSend([invite.invited_email]);
    setBusyId(null);
    const result = outcome.ok ? outcome.results[0]?.outcome : undefined;
    const rowNote: RowNote = result === "again" || result === "sent"
      ? { text: t("team.emailInvite.resentNow"), tone: "ok" }
      : result === "recent"
        ? { text: t("team.emailInvite.recentNow"), tone: "ok" }
        : result === "limited"
          ? { text: t("team.emailInvite.note.limited"), tone: "warn" }
          : { text: t("team.emailInvite.note.allFailed"), tone: "warn" };
    setNotes((current) => ({ ...current, [invite.invite_id]: rowNote }));
  };

  const cancel = async (invite: TeamEmailInvite) => {
    setBusyId(invite.invite_id);
    await onCancelInvite(invite);
    setBusyId(null);
  };

  const roster = variant === "roster";
  return (
    <>
      <ul className={roster ? "team-set-members team-roster__list" : "team-invite__pending-list"} aria-label={t("team.emailInvite.listAria")}>
        {shown.map((invite) => {
          const rowNote = notes[invite.invite_id];
          const busy = busyId === invite.invite_id;
          const meta = rowNote ? rowNote.text : t("team.emailInvite.sentOn", { date: formatDay(invite.last_sent_at ?? invite.created_at), until: formatDay(invite.expires_at) });
          const buttonClass = roster ? "modal-btn modal-btn--ghost team-set-remove" : "modal-btn modal-btn--ghost team-invite__rowbtn";
          return (
            <li key={invite.invite_id} className={roster ? "team-set-member team-roster__row" : undefined}>
              {roster ? null : <span className="team-invite__avatar" aria-hidden="true">{invite.invited_email.slice(0, 1).toUpperCase()}</span>}
              <span className={roster ? "team-roster__who" : "team-invite__who"}>
                <span className={roster ? "team-set-member__name" : "team-invite__email"}>{invite.invited_email}</span>
                <span className={(roster ? "team-roster__meta" : "team-invite__meta") + (rowNote?.tone === "warn" ? " is-warn" : "")}>{meta}</span>
              </span>
              <button type="button" className={buttonClass} disabled={busy} onClick={() => void resend(invite)}>
                <ActionLabel busy={busy}>{t("team.emailInvite.resend")}</ActionLabel>
              </button>
              {canCancel(invite) ? (
                <button type="button" className={buttonClass + (roster ? "" : " team-invite__rowbtn--quiet")} disabled={busy} aria-label={t("team.emailInvite.cancelAria", { email: invite.invited_email })} onClick={() => void cancel(invite)}>
                  {t("team.emailInvite.cancel")}
                </button>
              ) : roster ? null : <span />}
            </li>
          );
        })}
      </ul>
      {limit && invites.length > limit ? (
        <button type="button" className="team-invite__textbtn" onClick={() => setAll(!all)}>
          {all ? t("team.emailInvite.hide") : t("team.emailInvite.showAll", { count: invites.length })}
        </button>
      ) : null}
    </>
  );
}

/** People invited by email who have not joined, folded into one line until opened. */
function PendingInvites({ pending, ...rows }: Omit<EmailInviteRowsProps, "invites" | "limit"> & { readonly pending: readonly TeamEmailInvite[] }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (pending.length === 0) return null;
  return (
    <div className="team-invite__pending">
      <button type="button" className="team-invite__pending-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
        <span>{t("team.emailInvite.pendingCount", { count: pending.length })}</span>
        <span className="team-invite__pending-more">{open ? t("team.emailInvite.hide") : t("team.emailInvite.show")}</span>
        <Chevron />
      </button>
      {open ? (
        <div id={listId}>
          <EmailInviteRows invites={pending} limit={PENDING_ROWS_SHOWN} {...rows} />
        </div>
      ) : null}
    </div>
  );
}

/** After a send that delivered everything: the app's five-second floating notice. */
export function TeamInviteSentNotice({ sent, members, onDismiss }: { readonly sent: readonly string[]; readonly members: readonly string[]; readonly onDismiss: () => void }) {
  const { t } = useLocalization();
  const floating = useFloatingNotice(onDismiss);
  const className = ["history-deletion-notice", "team-invite-notice", floating.isLeaving ? "is-leaving" : floating.hasEntered ? "is-settled" : "is-entering", floating.isTimerPaused ? "is-paused" : ""].filter(Boolean).join(" ");
  const body = [
    t("team.emailInvite.notice.body", { names: namePeople(sent, t) }),
    members.length > 0 ? t("team.emailInvite.note.members", { names: namePeople(members.map(emailLocalPart), t) }) : "",
  ].filter(Boolean).join(" · ");
  if (typeof document === "undefined") return null;
  return (
    <FloatingNoticePortal>
      <section ref={floating.rootRef} className={className} role="status" aria-atomic="true" aria-label={t("team.emailInvite.notice.title")} {...floating.handlers}>
        <span className="history-deletion-notice__copy">
          <strong>{t("team.emailInvite.notice.title")}</strong>
          <span>{body}</span>
        </span>
        <button className="history-deletion-notice__dismiss" type="button" aria-label={t("team.emailInvite.notice.dismiss")} onClick={floating.requestLeave}>
          <svg className="history-deletion-notice__ring" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
            <circle className="history-deletion-notice__ring-track" cx="14" cy="14" r="11" />
            <circle className="history-deletion-notice__ring-progress" cx="14" cy="14" r="11" />
          </svg>
          <span className="history-deletion-notice__dismiss-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" /></svg></span>
        </button>
        <span className="sr-only" role="timer" aria-label={t("settings.deleteHistory.noticeTimer")} />
      </section>
    </FloatingNoticePortal>
  );
}
