import { useEffect, useState, type CSSProperties } from "react";

import { useLocalization } from "../localization/LocalizationContext";
import { readChatCloudStatus, type ChatCloudCredits, type ChatCloudStatus } from "./chatCloudClient";
import { CHAT_COPY, chatLanguage } from "./chatCopy";
import "./ChatCreditsRow.css";

type CloudInvoke = Parameters<typeof readChatCloudStatus>[0];

/** The part of a read the row draws, kept per account on this computer. */
type RememberedCredits = {
  readonly available: boolean;
  readonly plan: string;
  readonly credits: ChatCloudCredits;
};

const STORAGE_PREFIX = "drifty.chatCredits.v1:";
const remembered = new Map<string, RememberedCredits>();

function recall(accountKey: string | null): RememberedCredits | null {
  if (!accountKey) return null;
  const inMemory = remembered.get(accountKey);
  if (inMemory) return inMemory;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + accountKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RememberedCredits> | null;
    const credits = value?.credits;
    if (!value || typeof value.available !== "boolean" || typeof value.plan !== "string" || !credits
      || typeof credits.remaining !== "number" || typeof credits.granted !== "number"
      || (credits.renewsAt !== null && typeof credits.renewsAt !== "string")) return null;
    const read = { available: value.available, plan: value.plan, credits: { remaining: credits.remaining, granted: credits.granted, renewsAt: credits.renewsAt } };
    remembered.set(accountKey, read);
    return read;
  } catch {
    return null;
  }
}

function remember(accountKey: string | null, read: RememberedCredits): void {
  if (!accountKey) return;
  remembered.set(accountKey, read);
  try {
    window.localStorage.setItem(STORAGE_PREFIX + accountKey, JSON.stringify(read));
  } catch {
    // Kept for this app session only.
  }
}

export function resetChatCreditsRowForTests(): void {
  remembered.clear();
}

type RowState =
  | { readonly kind: "loading" }
  | { readonly kind: "read"; readonly read: RememberedCredits }
  | { readonly kind: "message"; readonly status: Exclude<ChatCloudStatus, { kind: "ready" }> };

/**
 * Settings › Account row for Drifty Cloud chat credits, like Raycast's AI
 * credits and Claude's usage bar: what is left out of the period's grant on
 * one line, a bar across the card, and one line on what happens next (a trial
 * grant does not refill, a plan refills on its billing day).
 *
 * Nothing in it animates. The account's last read is kept on this computer,
 * so the row opens with numbers and a fresh read replaces them in place; a
 * read that cannot reach Drifty Cloud leaves them as they were. Only the very
 * first read for an account shows the row empty, at its final size.
 */
export function ChatCreditsRow({ invoke, accountKey = null, expectCredits = true }: {
  readonly invoke?: CloudInvoke;
  /** The signed-in account's id; keys the remembered read. */
  readonly accountKey?: string | null;
  /** Whether the plan is known to carry credits, so the first read keeps room for the bar. */
  readonly expectCredits?: boolean;
}) {
  const { effectiveLanguage } = useLocalization();
  const copy = CHAT_COPY[chatLanguage(effectiveLanguage)];
  const [state, setState] = useState<RowState>(() => {
    const read = recall(accountKey);
    return read ? { kind: "read", read } : { kind: "loading" };
  });

  useEffect(() => {
    let cancelled = false;
    void readChatCloudStatus(invoke).then((next) => {
      if (cancelled) return;
      if (next.kind === "ready") {
        const read = { available: next.available, plan: next.plan, credits: next.credits };
        remember(accountKey, read);
        setState({ kind: "read", read });
        return;
      }
      // A connection problem keeps the last numbers rather than swapping them for an error.
      setState((current) => (next.kind === "unavailable" && current.kind === "read" ? current : { kind: "message", status: next }));
    });
    return () => { cancelled = true; };
  }, [accountKey, invoke]);

  const read = state.kind === "read" ? state.read : null;
  const ready = read?.available ? read : null;
  const showMeter = ready !== null || (state.kind === "loading" && expectCredits);
  const remaining = ready?.credits.remaining ?? 0;
  const granted = ready?.credits.granted ?? 0;
  const renewsAt = ready?.credits.renewsAt ?? null;
  const share = granted > 0 ? Math.max(0, Math.min(1, remaining / granted)) : 0;
  const description = state.kind === "loading"
    ? null
    : state.kind === "message"
      ? state.status.kind === "sign_in_required" || state.status.kind === "full_account_required"
        ? copy.cloudSignIn
        : copy.cloudUnavailable
      : !ready
        ? copy.cloudPlanRequired
        : remaining <= 0
          ? copy.cloudErrorExhausted(renewsAt)
          : renewsAt
            ? copy.creditsAccountRenews(granted, renewsAt)
            : ready.plan === "trialing"
              ? copy.creditsAccountTrial
              : copy.creditsAccountDetail;

  return (
    <div
      data-setting-id="settings.account.chatCredits"
      className={"settings-row chat-credits-row" + (showMeter ? " has-meter" : "")}
      aria-busy={state.kind === "loading" || undefined}
    >
      <div className="lbl">{copy.creditsAccountTitle}</div>
      {showMeter ? (
        <>
          <span className="chat-credits-row__count">{ready ? copy.creditsAccountCount(remaining, granted) : null}</span>
          <span
            className={"chat-credits-row__bar" + (ready && share < 0.1 ? " is-low" : "")}
            role={ready ? "meter" : undefined}
            aria-label={ready ? copy.creditsAccountTitle : undefined}
            aria-valuemin={ready ? 0 : undefined}
            aria-valuemax={ready ? granted : undefined}
            aria-valuenow={ready ? remaining : undefined}
            style={{ "--chat-credits-share": (share * 100).toFixed(1) + "%" } as CSSProperties}
          >
            <span />
          </span>
        </>
      ) : null}
      <div className="desc">{description ?? "\u00a0"}</div>
    </div>
  );
}
