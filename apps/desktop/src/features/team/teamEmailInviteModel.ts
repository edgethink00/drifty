import type { TeamEmailInviteResult } from "./teamTypes";

/**
 * Email invite input and the decision after a send (owner decisions
 * 2026-10-29). Addresses become chips as they are committed; only a committed
 * chip can be wrong, so nothing warns while an address is still being typed.
 * A send that delivers everything closes the dialog and leaves a floating
 * notice; anything that still needs the user stays in the field with one line
 * saying why.
 */

/** Stricter than the server's check, so an address the app accepts always passes there too. */
const EMAIL_ADDRESS_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/u;
const MAX_EMAIL_LENGTH = 320;
/** At most this many addresses go out in one send, as the team-invites function allows. */
export const MAX_EMAIL_INVITES_PER_SEND = 20;

export function isValidInviteEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_ADDRESS_PATTERN.test(value);
}

/**
 * The addresses in typed or pasted text. "Hana Kim <hana@company.com>" yields
 * the address inside the brackets, and commas, semicolons, spaces and line
 * breaks separate entries, as a mail app's copied recipients do.
 */
export function parseInviteRecipients(text: string): string[] {
  // A display name before a bracketed address is dropped with its brackets; entries keep their order.
  return Array.from(text.matchAll(/[^<>,;\n@]*<([^<>\s]*)>|[^\s,;<>]+/gu), (match) => (match[1] ?? match[0]).trim()).filter(Boolean);
}

/** Adds the addresses in text after the existing chips, skipping repeats regardless of case. */
export function addInviteRecipients(chips: readonly string[], text: string): string[] {
  const seen = new Set(chips.map((chip) => chip.toLowerCase()));
  const next = [...chips];
  for (const part of parseInviteRecipients(text)) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(part);
  }
  return next;
}

/** True when pasted text holds more than one entry, so it should become chips at once. */
export function isMultiRecipientPaste(text: string): boolean {
  return /[\s,;<]/u.test(text.trim());
}

export type EmailInviteSendPlan = {
  /** Close the dialog and show the floating notice. */
  readonly close: boolean;
  /** Addresses that stay in the field: undelivered ones, then the invalid chips. */
  readonly keep: readonly string[];
  /** Mailed now or moments ago. */
  readonly sent: readonly string[];
  readonly members: readonly string[];
  readonly failed: readonly string[];
  /** Held back by the team's daily limit. */
  readonly limited: readonly string[];
  readonly invalid: readonly string[];
};

/**
 * What the dialog does after a send. invalid holds the committed chips that
 * were not sent because their format is wrong.
 */
export function planAfterEmailInviteSend(results: readonly TeamEmailInviteResult[], invalid: readonly string[]): EmailInviteSendPlan {
  const pick = (...outcomes: TeamEmailInviteResult["outcome"][]) => results.filter((result) => outcomes.includes(result.outcome)).map((result) => result.email);
  const sent = pick("sent", "again", "recent");
  const members = pick("member");
  const failed = pick("failed");
  const limited = pick("limited");
  const keep = [...failed, ...limited, ...invalid];
  return { close: keep.length === 0 && sent.length > 0, keep, sent, members, failed, limited, invalid };
}

/** The local part of an address, for naming people in a short note. */
export function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}
