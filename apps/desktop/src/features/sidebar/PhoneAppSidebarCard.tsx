import { useId } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import type { SidebarCtaPhoneAppState } from "./SidebarCtaSlot";
/*
 * Encodes phoneAppQrUrl("drifty_desktop_sidebar"). Regenerate with
 *   npx qrcode@1.5.4 -t svg -e L -q 2 -d "#111111" -l "#ffffff" -o iphone-app-store-qr-sidebar.svg "<url>"
 * when that link changes, then scan the result before committing it. The
 * shorter link and low error correction give 37 modules with the quiet zone,
 * so 74px keeps every module on two whole pixels.
 */
import sidebarQrUrl from "../../assets/iphone-app-store-qr-sidebar.svg";
import "./PhoneAppSidebarCard.css";

type PhoneAppSidebarCardProps = {
  readonly state: SidebarCtaPhoneAppState;
  /** Opens the larger code with the App Store link, for a phone held farther away. */
  readonly onEnlarge: () => void;
  readonly onDismiss?: () => void;
};

/**
 * Drifty for iPhone in the sidebar slot: the QR code on the left and the
 * app's name with one short hint on the right, nothing more, on the same green
 * tone as the Upgrade card. A computer cannot pre-order or install an iPhone
 * app, so the code the iPhone camera needs is the card itself.
 */
export function PhoneAppSidebarCard({ state, onEnlarge, onDismiss }: PhoneAppSidebarCardProps) {
  const { t } = useLocalization();
  const nameId = useId();
  const dismissLabel = t("sidebar.cta.phoneApp.dismiss");

  return (
    <div className="sidebar-cta-slot-wrap" data-kind="phone-app" data-dismissible={onDismiss ? "true" : undefined}>
      <div
        className="sidebar-cta-slot sidebar-cta-slot--phone-app"
        data-kind="phone-app"
        data-phase={state.phase}
        data-tone={state.tone}
        role="group"
        aria-labelledby={nameId}
      >
        <button
          type="button"
          className="phone-app-card__qr"
          aria-label={t("sidebar.cta.phoneApp.enlarge")}
          title={t("sidebar.cta.phoneApp.enlarge")}
          onClick={onEnlarge}
        >
          <img src={sidebarQrUrl} alt="" width={74} height={74} draggable={false} />
        </button>
        <span className="phone-app-card__copy">
          <strong id={nameId} className="phone-app-card__name">{t("sidebar.cta.phoneApp.name")}</strong>
          <span className="phone-app-card__hint">
            {t(state.phase === "released" ? "sidebar.cta.phoneApp.releasedHint" : "sidebar.cta.phoneApp.preorderHint")}
          </span>
        </span>
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="sidebar-cta-slot__dismiss"
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="m3 3 6 6M9 3 3 9" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
