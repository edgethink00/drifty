import type { DisplayLanguage } from "../localization/languageCatalog";
import { localeForDisplayLanguage } from "../../lib/formatting";
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PageTabs, pageTabId } from "../../components/PageTabs";
import driftyWordmarkUrl from "../../assets/drifty-wordmark-trim.png";
import type { CouponRedemption, CouponRedemptionFailureCode, FriendInviteResult } from "../billing/billingService";
import { createFriendInvite } from "../billing/billingService";
import { useLocalization } from "../localization/LocalizationContext";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import { TrialCouponRedemption } from "./TrialCouponRedemption";
import { canEnterFriendCode, storeCreatedFriendInvite, useFriendInvite } from "./friendInviteStore";
import "../../styles/page-tabs.css";
import "./FriendInviteCard.css";

const GIFT_SITE_ORIGIN = "https://drifty.so";
const COPIED_RESET_MS = 2_000;
const TAB_PREFIX = "friend-invite";

type FriendInviteTab = "invite" | "friends" | "code";

/** The existing drifty.so gift page reads the code from the fragment. */
export function buildFriendInviteUrl(code: string, language: DisplayLanguage): string {
  return GIFT_SITE_ORIGIN + (language === "ko" ? "/ko" : "") + "/gift/#pass=" + encodeURIComponent(code);
}

/** The Promo code redemption, shared with the plan card row. */
export type FriendInviteCodeEntry = {
  readonly activePromotionEndsAt: string | null;
  readonly disabled: boolean;
  readonly isSignedIn: boolean;
  readonly loading: boolean;
  readonly redemption: CouponRedemption | null;
  readonly errorCode: CouponRedemptionFailureCode | null;
  readonly onRedeem: (code: string) => void | Promise<void>;
  readonly onSignIn?: () => void;
};

type FriendInviteCardProps = {
  /** Identifies the signed-in account; the cached invite never crosses accounts. */
  readonly accountKey: string;
  readonly loadInvite: () => Promise<FriendInviteResult>;
  readonly createInvite?: () => Promise<FriendInviteResult>;
  /** Present only where a code can be redeemed; the code tab also needs the
   *  account to be inside its 14-day new-account window. */
  readonly codeEntry?: FriendInviteCodeEntry | null;
  readonly copyText?: (text: string) => Promise<void>;
};

/**
 * Friend invite card in Settings > Account, in the common refer-a-friend
 * format: headline, Invite / Friends / Code tabs, the gift pass the friend
 * receives, three steps and the invite link with Copy. Hidden until the server
 * reports an invite, so a disabled rollout or failed read shows nothing.
 */
export function FriendInviteCard({ accountKey, loadInvite, createInvite, codeEntry: offeredCodeEntry = null, copyText = writeClipboardText }: FriendInviteCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const titleId = useId();
  const linkId = useId();
  const linkRef = useRef<HTMLInputElement>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountRef = useRef(accountKey);
  accountRef.current = accountKey;
  const creatingRef = useRef(false);
  const invite = useFriendInvite(accountKey, loadInvite);
  // Friend codes are for new accounts, so the tab closes with the window.
  const codeEntry = invite && canEnterFriendCode(invite) ? offeredCodeEntry : null;
  const [tab, setTab] = useState<FriendInviteTab>("invite");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [createState, setCreateState] = useState<"idle" | "creating" | "failed">("idle");

  useEffect(() => {
    setCopyState("idle");
    setCreateState("idle");
    creatingRef.current = false;
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, [accountKey]);

  useEffect(() => {
    accountRef.current = accountKey;
    return () => {
      accountRef.current = "";
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [accountKey]);

  // The code tab disappears where codes cannot be redeemed (e.g. a new
  // subscription), so fall back to Invite rather than an empty panel.
  useEffect(() => {
    if (tab === "code" && !codeEntry) setTab("invite");
  }, [codeEntry, tab]);

  if (!invite || invite.status === "inactive") return null;

  const days = invite.durationDays;
  const url = invite.code ? buildFriendInviteUrl(invite.code, effectiveLanguage) : "";
  const canShare = invite.status === "active" || invite.status === "uncreated";
  const tabs = [
    { id: "invite" as const, label: t("settings.account.friendInviteTabInvite") },
    { id: "friends" as const, label: t("settings.account.friendInviteTabFriends", { count: invite.claimedCount }) },
    ...(codeEntry ? [{ id: "code" as const, label: t("settings.account.friendInviteTabCode") }] : []),
  ];
  const activeTab = tab === "code" && !codeEntry ? "invite" : tab;

  // The link is already in state, so the clipboard write starts inside the
  // click without an intervening await (WebKit rejects late writes).
  function handleCopy() {
    if (!url) return;
    const copyingAccount = accountKey;
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    copyText(url).then(() => {
      if (accountRef.current !== copyingAccount) return;
      setCopyState("copied");
      capturePostHogEvent("billing_action", { action: "friend_invite_copied", result: "success" });
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), COPIED_RESET_MS);
    }, () => {
      if (accountRef.current !== copyingAccount) return;
      setCopyState("failed");
      capturePostHogEvent("billing_action", { action: "friend_invite_copied", result: "error" });
      linkRef.current?.focus();
      linkRef.current?.select();
    });
  }

  async function handleCreate() {
    if (creatingRef.current) return;
    const creatingAccount = accountKey;
    creatingRef.current = true;
    setCreateState("creating");
    try {
      const result = await (createInvite ?? createFriendInvite)();
      if (accountRef.current !== creatingAccount) return;
      if (result.kind !== "ready" || result.invite.status === "uncreated") {
        setCreateState("failed");
        return;
      }
      storeCreatedFriendInvite(creatingAccount, result.invite);
      setCreateState("idle");
    } catch {
      if (accountRef.current === creatingAccount) setCreateState("failed");
    } finally {
      if (accountRef.current === creatingAccount) creatingRef.current = false;
    }
  }

  const copyButton = (
    <button
      type="button"
      className="settings-btn primary friend-invite__copy"
      data-copied={copyState === "copied" || undefined}
      disabled={createState === "creating"}
      aria-busy={createState === "creating" || undefined}
      onClick={invite.status === "uncreated" ? () => { void handleCreate(); } : handleCopy}
    >
      {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
      <span>{invite.status === "uncreated"
        ? t(createState === "creating" ? "settings.account.friendInviteCreating" : "settings.account.friendInviteCreate")
        : copyState === "copied" ? t("settings.account.friendInviteCopied") : t("settings.account.friendInviteCopy")}</span>
    </button>
  );

  return (
    <div data-setting-id="settings.account.friendInviteSection" className="settings-block settings-block--friend-invite">
      <h3>{t("settings.account.friendInviteSection")}</h3>
      <section className="friend-invite" aria-labelledby={titleId}>
        <header className="friend-invite__header">
          <h4 id={titleId} className="friend-invite__headline">{t("settings.account.friendInviteHeadline", { days })}</h4>
          <p className="friend-invite__lede">{t("settings.account.friendInviteLede", { days })}</p>
        </header>
        <div className="friend-invite__tabs">
          <PageTabs
            tabs={tabs}
            activeTab={activeTab}
            onChange={setTab}
            ariaLabel={t("settings.account.friendInviteTabsAria")}
            idPrefix={TAB_PREFIX}
          />
        </div>

        <div
          className={"friend-invite__panel friend-invite__panel--" + activeTab}
          role="tabpanel"
          id={TAB_PREFIX + "-tabpanel-" + activeTab}
          aria-labelledby={pageTabId(TAB_PREFIX, activeTab)}
        >
          {activeTab === "invite" ? (
            <div className="friend-invite__column">
              <GiftPass days={days} />
              <div className="friend-invite__how">
                <h5>{t("settings.account.friendInviteHowTitle")}</h5>
                <ol className="friend-invite__steps">
                  <Step icon={<MegaphoneIcon />} text={t("settings.account.friendInviteStepShare")} />
                  <Step icon={<GiftIcon />} text={t("settings.account.friendInviteStepJoin", { days })} />
                  <Step icon={<FriendsIcon />} text={t("settings.account.friendInviteStepLimit", { max: invite.maxClaims })} />
                </ol>
              </div>
              {canShare ? (
                <div className="friend-invite__link">
                  <label htmlFor={linkId} className="friend-invite__label">{t("settings.account.friendInviteLinkLabel")}</label>
                  <div className="friend-invite__link-row">
                    <div className={"friend-invite__link-field" + (copyState === "failed" ? " is-invalid" : "")}>
                      <LinkIcon />
                      <input
                        ref={linkRef}
                        id={linkId}
                        className="friend-invite__link-input"
                        type="text"
                        value={url}
                        placeholder={t("settings.account.friendInviteUncreated")}
                        readOnly
                        spellCheck={false}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </div>
                    {copyButton}
                  </div>
                  {createState === "failed" ? (
                    <p className="friend-invite__error" role="alert">{t("settings.account.friendInviteCreateFailed")}</p>
                  ) : copyState === "failed" ? (
                    <p className="friend-invite__error" role="alert">{t("settings.account.friendInviteCopyFailed")}</p>
                  ) : invite.expiresAt ? (
                    <p className="friend-invite__link-hint">
                      {t("settings.account.friendInviteFootnote", { date: formatDate(invite.expiresAt, effectiveLanguage) })}
                    </p>
                  ) : null}
                  <span className="sr-only" role="status">{copyState === "copied" ? t("settings.account.friendInviteCopied") : ""}</span>
                </div>
              ) : (
                <p className="friend-invite__closed" role="status">
                  {invite.status === "exhausted"
                    ? t("settings.account.friendInviteExhausted", { max: invite.maxClaims })
                    : t("settings.account.friendInviteExpired")}
                </p>
              )}
            </div>
          ) : activeTab === "friends" ? (
            <div className="friend-invite__column">
              <div className="friend-invite__progress">
                <div className="friend-invite__progress-copy">
                  <span className="friend-invite__label">{t("settings.account.friendInviteProgressTitle")}</span>
                  <span className="friend-invite__progress-count">
                    {t("settings.account.friendInviteProgress", { count: invite.claimedCount, max: invite.maxClaims })}
                  </span>
                </div>
                <div
                  className="friend-invite__meter"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={invite.maxClaims}
                  aria-valuenow={Math.min(invite.claimedCount, invite.maxClaims)}
                  aria-label={t("settings.account.friendInviteProgressTitle")}
                >
                  <span style={{ "--friend-invite-fill": String(Math.min(1, invite.claimedCount / invite.maxClaims)) } as CSSProperties} />
                </div>
              </div>
              {invite.claims.length > 0 ? (
                <ol className="friend-invite__claims">
                  {invite.claims.map((claim, index) => {
                    const number = invite.claims.length - index;
                    return (
                      <li key={claim.claimedAt + ":" + number} className="friend-invite__claim">
                        <span className="friend-invite__marker" aria-hidden="true">{number}</span>
                        <span className="friend-invite__claim-name">{t("settings.account.friendInviteFriendLabel", { number })}</span>
                        <span className="friend-invite__claim-date">
                          {t("settings.account.friendInviteClaimedOn", { date: formatDate(claim.claimedAt, effectiveLanguage) })}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className="friend-invite__empty">
                  <span className="friend-invite__empty-mark" aria-hidden="true"><FriendsIcon /></span>
                  <p className="friend-invite__empty-title">{t("settings.account.friendInviteEmptyTitle")}</p>
                  <p className="friend-invite__empty-body">{t("settings.account.friendInviteEmptyBody")}</p>
                  {canShare ? copyButton : null}
                </div>
              )}
            </div>
          ) : codeEntry ? (
            <div className="friend-invite__column">
              <TrialCouponRedemption
                variant="panel"
                activePromotionEndsAt={codeEntry.activePromotionEndsAt}
                disabled={codeEntry.disabled}
                errorCode={codeEntry.errorCode}
                isSignedIn={codeEntry.isSignedIn}
                loading={codeEntry.loading}
                redemption={codeEntry.redemption}
                onRedeem={codeEntry.onRedeem}
                onSignIn={codeEntry.onSignIn}
              />
            </div>
          ) : null}
        </div>

      </section>
    </div>
  );
}

/** The Pro pass the friend receives on the drifty.so gift page: a cream-to-sage
 *  gift card with everything centred, the wordmark and Pro badge over the
 *  duration and what it includes. */
function GiftPass({ days }: { readonly days: number }) {
  const { t } = useLocalization();
  return (
    <div className="friend-invite__pass" role="img" aria-label={t("settings.account.friendInvitePassAria", { days })}>
      <div className="friend-invite__pass-top" aria-hidden="true">
        <span className="friend-invite__pass-wordmark" style={{ "--friend-invite-wordmark": "url(" + driftyWordmarkUrl + ")" } as CSSProperties} />
        <span className="friend-invite__pass-chip">Pro</span>
      </div>
      <div className="friend-invite__pass-hero" aria-hidden="true">
        <p className="friend-invite__pass-value">
          <strong>{days}</strong>
          <span>{t("settings.account.friendInvitePassUnit")}</span>
        </p>
        <span className="friend-invite__pass-caption">{t("settings.account.friendInvitePassCaption")}</span>
      </div>
    </div>
  );
}

/** One line of the steps, led by a bare line icon as in common referral cards. */
function Step({ icon, text }: { readonly icon: ReactNode; readonly text: string }) {
  return (
    <li className="friend-invite__step">
      <span className="friend-invite__step-icon" aria-hidden="true">{icon}</span>
      <span className="friend-invite__step-text">{emphasize(text)}</span>
    </li>
  );
}

/** Renders **text** spans from a translated string as <strong>. */
function emphasize(text: string): ReactNode {
  const parts = text.split("**");
  if (parts.length < 3) return text;
  return parts.map((part, index) => (index % 2 === 1
    ? <strong key={index}>{part}</strong>
    : <Fragment key={index}>{part}</Fragment>));
}

function formatDate(value: string, language: DisplayLanguage): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleDateString(localeForDisplayLanguage(language), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Line icons on a 24px grid with one 1.7px stroke, so the few icons the card
// uses read as one family. Step icons are Lucide paths (ISC license,
// lucide.dev), the set the Memory surface already draws from.
const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function MegaphoneIcon() {
  return (
    <svg className="friend-invite__icon" {...ICON_PROPS}>
      <path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" />
      <path d="M8 6v8" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg className="friend-invite__icon" {...ICON_PROPS}>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

function FriendsIcon() {
  return (
    <svg className="friend-invite__icon" {...ICON_PROPS}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="friend-invite__link-icon" {...ICON_PROPS}>
      <path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.7 1.7" />
      <path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.7-1.7" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="friend-invite__button-icon" {...ICON_PROPS}>
      <rect x="8.5" y="8.5" width="12.5" height="12.5" rx="2.4" />
      <path d="M15.5 8.5V5.4A2.4 2.4 0 0 0 13.1 3H5.4A2.4 2.4 0 0 0 3 5.4v7.7a2.4 2.4 0 0 0 2.4 2.4h3.1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="friend-invite__button-icon" {...ICON_PROPS}>
      <path d="m4.5 12.5 4.8 4.8L19.5 7" />
    </svg>
  );
}


async function writeClipboardText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable.");
  await navigator.clipboard.writeText(text);
}
