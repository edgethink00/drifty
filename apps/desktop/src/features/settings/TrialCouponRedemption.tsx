import { useEffect, useId, useState, type FormEvent } from "react";
import type {
  CouponRedemption,
  CouponRedemptionFailureCode,
} from "../billing/billingService";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import "./TrialCouponRedemption.css";

type TrialCouponRedemptionProps = {
  readonly disabled: boolean;
  readonly isSignedIn: boolean;
  readonly loading: boolean;
  readonly redemption: CouponRedemption | null;
  readonly errorCode: CouponRedemptionFailureCode | null;
  readonly onRedeem: (code: string) => void | Promise<void>;
};

export function TrialCouponRedemption({
  disabled,
  isSignedIn,
  loading,
  redemption,
  errorCode,
  onRedeem,
}: TrialCouponRedemptionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const inputId = useId();
  const feedbackId = useId();
  const [code, setCode] = useState("");
  const normalizedCode = normalizeCouponCode(code);
  const codeReady = isCouponCodeReady(normalizedCode);

  useEffect(() => {
    if (redemption) setCode("");
  }, [redemption]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || loading || !codeReady) return;
    void onRedeem(normalizedCode);
  }

  const feedback = redemption
    ? describeRedemption(redemption, effectiveLanguage, t)
    : errorCode
      ? describeCouponError(errorCode, t)
      : null;

  return (
    <div className="settings-row settings-row--coupon">
      <div className="trial-coupon-form__layout">
        <div className="trial-coupon-form__copy">
          <label className="lbl" htmlFor={inputId}>{t("settings.account.couponTitle")}</label>
          <div className="desc">
            {isSignedIn ? t("settings.account.couponDescription") : t("settings.account.couponSignIn")}
          </div>
        </div>
        <form className="trial-coupon-form" onSubmit={handleSubmit} aria-busy={loading}>
          <div className="trial-coupon-form__controls">
            <input
              id={inputId}
              className="settings-input trial-coupon-form__input"
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder={t("settings.account.couponPlaceholder")}
              aria-label={t("settings.account.couponInputAria")}
              aria-describedby={feedback ? feedbackId : undefined}
              aria-invalid={errorCode ? true : undefined}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={64}
              disabled={disabled || loading}
            />
            <button
              type="submit"
              className="settings-btn trial-coupon-form__submit"
              disabled={disabled || loading || !codeReady}
            >
              {loading ? t("settings.account.couponRedeeming") : t("settings.account.couponRedeem")}
            </button>
          </div>
          {feedback ? (
            <p
              id={feedbackId}
              className={`trial-coupon-form__feedback${feedback.error ? " trial-coupon-form__feedback--error" : " trial-coupon-form__feedback--success"}`}
              role={feedback.error ? "alert" : "status"}
            >
              {feedback.message}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}

function normalizeCouponCode(value: string): string {
  return value.replace(/\s+/gu, "").trim().toUpperCase();
}

function isCouponCodeReady(value: string): boolean {
  return value.length >= 8 && value.length <= 64 && /^[A-Z0-9][A-Z0-9-]+$/u.test(value);
}

function describeRedemption(
  redemption: CouponRedemption,
  language: "en" | "ko",
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
    case "full_account_required":
    case "sign_in_required":
      return { error: true, message: t("settings.account.couponSignIn") };
    case "coupon_unavailable": return { error: true, message: t("settings.account.couponUnavailable") };
  }
}

function formatCouponDate(value: string, language: "en" | "ko"): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleDateString(language === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
