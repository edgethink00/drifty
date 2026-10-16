import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { localeForDisplayLanguage } from "../../lib/formatting";
import type {
  CouponRedemption,
  CouponRedemptionFailureCode,
} from "../billing/billingService";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import "./TrialCouponRedemption.css";

type TrialCouponRedemptionProps = {
  readonly activePromotionEndsAt?: string | null;
  readonly disabled: boolean;
  readonly isSignedIn: boolean;
  readonly loading: boolean;
  readonly redemption: CouponRedemption | null;
  readonly errorCode: CouponRedemptionFailureCode | null;
  readonly onRedeem: (code: string) => void | Promise<void>;
  readonly onSignIn?: () => void;
  /**
   * "row" is the Account plan card row. "panel" is the same control stacked
   * inside the friend invite card's code tab: identical normalisation,
   * validation, errors and applied state, only the wording and layout differ.
   */
  readonly variant?: "row" | "panel";
};

/**
 * Promo code row inside the Account plan card. It is always open: the label
 * and a status line on the left, one joined field (code + Apply) on the right.
 */
export function TrialCouponRedemption({
  activePromotionEndsAt = null,
  disabled,
  isSignedIn,
  loading,
  redemption,
  errorCode,
  onRedeem,
  onSignIn,
  variant = "row",
}: TrialCouponRedemptionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const isPanel = variant === "panel";
  const settingId = isPanel ? "settings.account.friendInviteCodeTitle" : "settings.account.couponTitle";
  const titleText = t(isPanel ? "settings.account.friendInviteCodeTitle" : "settings.account.couponTitle");
  const descriptionText = t(isPanel ? "settings.account.friendInviteCodeDescription" : "settings.account.couponDescription");
  const placeholderText = t(isPanel ? "settings.account.friendInviteCodePlaceholder" : "settings.account.couponPlaceholder");
  const rowClass = isPanel ? "trial-coupon trial-coupon--panel" : "settings-row trial-coupon";
  const inputId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const submittedRef = useRef(false);
  const [code, setCode] = useState("");
  const [localInvalid, setLocalInvalid] = useState(false);
  // A server error describes the code that was sent. Once the user edits the
  // field it no longer applies, so it clears until the next attempt.
  const [editedSinceAttempt, setEditedSinceAttempt] = useState(false);
  const normalizedCode = normalizeCouponCode(code);
  const codeReady = isCouponCodeReady(normalizedCode);

  useEffect(() => {
    if (redemption) setCode("");
  }, [redemption]);

  useEffect(() => {
    setEditedSinceAttempt(false);
  }, [errorCode, loading]);

  // A failed attempt ends that submit; only the submit that succeeds may
  // move focus.
  useEffect(() => {
    if (errorCode) submittedRef.current = false;
  }, [errorCode]);

  // A successful submit removes the field. Move focus to the result so
  // keyboard and screen reader users are not dropped at the top of the page.
  useEffect(() => {
    if (!redemption || !submittedRef.current) return;
    submittedRef.current = false;
    statusRef.current?.focus();
  }, [redemption]);

  // The submit button stays a readable button instead of a faded, disabled
  // twin of the field; an incomplete code is explained after the attempt.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || loading) return;
    if (!codeReady) {
      setLocalInvalid(normalizedCode.length > 0);
      inputRef.current?.focus();
      return;
    }
    setLocalInvalid(false);
    submittedRef.current = true;
    void onRedeem(normalizedCode);
  }

  // The description line doubles as the status line, so errors and results
  // replace it in place instead of pushing the row taller.
  const renderCopy = (
    status: ReactNode,
    tone: "default" | "error" | "success",
    options: {
      readonly live?: "alert" | "status";
      readonly focusTarget?: RefObject<HTMLParagraphElement>;
      readonly labelsField?: boolean;
    } = {},
  ) => (
    <div className="trial-coupon__copy">
      {/* Only the open field has a control to label; other states show the
          title as plain text so no label points at a missing input. */}
      {options.labelsField
        ? <label className="lbl" htmlFor={inputId}>{titleText}</label>
        : <div className="lbl">{titleText}</div>}
      <p
        ref={options.focusTarget}
        id={statusId}
        className={"desc trial-coupon__status trial-coupon__status--" + tone}
        role={options.live}
        tabIndex={options.focusTarget ? -1 : undefined}
      >
        {status}
      </p>
    </div>
  );

  if (!isSignedIn) {
    return (
      <div data-setting-id={settingId} className={rowClass}>
        {renderCopy(t("settings.account.couponSignIn"), "default")}
        {onSignIn ? (
          <div className="ctrl">
            <button type="button" className="settings-btn" onClick={onSignIn}>
              {t("settings.account.signIn")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // One code per account: once a code is applied the field has nothing left
  // to do, so the row reports the result instead.
  const applied = redemption
    ? describeRedemption(redemption, effectiveLanguage, t).message
    : activePromotionEndsAt
      ? t("settings.account.couponActive", { date: formatCouponDate(activePromotionEndsAt, effectiveLanguage) })
      : null;
  if (applied) {
    const alreadyUsed = redemption?.status === "already_redeemed";
    return (
      <div data-setting-id={settingId} className={rowClass + " trial-coupon--applied"}>
        {renderCopy(applied, alreadyUsed ? "default" : "success", { live: redemption ? "status" : undefined, focusTarget: statusRef })}
        {alreadyUsed ? null : (
          <div className="ctrl">
            <span className="status-badge trial-coupon__badge">{t("settings.account.couponApplied")}</span>
          </div>
        )}
      </div>
    );
  }

  const failure = errorCode && !editedSinceAttempt ? describeCouponError(errorCode, t).message
    : localInvalid ? t("settings.account.couponInvalid")
      : null;
  return (
    <form
      data-setting-id={settingId}
      className={rowClass}
      onSubmit={handleSubmit}
      aria-busy={loading}
      noValidate
    >
      {renderCopy(failure ?? descriptionText, failure ? "error" : "default", { live: failure ? "alert" : undefined, labelsField: true })}
      <div className={"trial-coupon__field" + (failure ? " is-invalid" : "")}>
        <input
          ref={inputRef}
          id={inputId}
          className="trial-coupon__input"
          type="text"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setLocalInvalid(false);
            setEditedSinceAttempt(true);
          }}
          placeholder={placeholderText}
          aria-label={t("settings.account.couponInputAria")}
          aria-describedby={statusId}
          aria-invalid={failure ? true : undefined}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          disabled={disabled || loading}
        />
        <button
          type="submit"
          className="trial-coupon__apply"
          data-ready={codeReady || undefined}
          aria-busy={loading || undefined}
          disabled={disabled || loading}
        >
          <span className="trial-coupon__submit-label">{t("settings.account.couponApply")}</span>
          {loading ? <span className="sr-only">{t("settings.account.couponRedeeming")}</span> : null}
        </button>
      </div>
    </form>
  );
}

/**
 * Codes often arrive by chat or email, where dashes turn typographic and
 * CJK keyboards produce full-width letters. Fold those back to the ASCII
 * form the server stores before validating or sending.
 */
function normalizeCouponCode(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63]/gu, "-")
    .replace(/\s+/gu, "")
    .toUpperCase();
}

function isCouponCodeReady(value: string): boolean {
  return value.length >= 8 && value.length <= 64 && /^[A-Z0-9][A-Z0-9-]+$/u.test(value);
}

function describeRedemption(
  redemption: CouponRedemption,
  language: "en" | "ko" | "es",
  t: LocalizationController["t"],
): { readonly error: false; readonly message: string } {
  const date = formatCouponDate(redemption.trialEndsAt, language);
  return {
    error: false,
    message: redemption.status === "already_redeemed"
      ? t("settings.account.couponAlreadyRedeemed", { date })
      : t("settings.account.couponRedeemed", { days: redemption.grantedDays, date }),
  };
}

function describeCouponError(
  code: CouponRedemptionFailureCode,
  t: LocalizationController["t"],
): { readonly error: true; readonly message: string } {
  switch (code) {
    case "coupon_invalid": return { error: true, message: t("settings.account.couponInvalid") };
    case "coupon_inactive": return { error: true, message: t("settings.account.couponInactive") };
    case "coupon_not_started": return { error: true, message: t("settings.account.couponNotStarted") };
    case "coupon_expired": return { error: true, message: t("settings.account.couponExpired") };
    case "coupon_exhausted": return { error: true, message: t("settings.account.couponExhausted") };
    case "coupon_rate_limited": return { error: true, message: t("settings.account.couponRateLimited") };
    case "coupon_already_subscribed": return { error: true, message: t("settings.account.couponSubscribed") };
    case "coupon_own_invite": return { error: true, message: t("settings.account.couponOwnInvite") };
    case "coupon_invite_new_accounts_only": return { error: true, message: t("settings.account.couponInviteNewAccountsOnly") };
    case "full_account_required":
    case "sign_in_required":
      return { error: true, message: t("settings.account.couponSignIn") };
    case "coupon_unavailable": return { error: true, message: t("settings.account.couponUnavailable") };
  }
}

function formatCouponDate(value: string, language: "en" | "ko" | "es"): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleDateString(localeForDisplayLanguage(language), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
