import { useId } from "react";
import { ExternalLinkIcon } from "../../components/ExternalLinkIcon";
import { KeyHint } from "../../components/KeyHint";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { formatMonthDay } from "./SidebarCtaSlot";
import { IPHONE_APP_RELEASE_DATE, type PhoneAppPhase } from "./phoneAppCtaSlot";
/*
 * Encodes phoneAppStoreUrl("drifty_desktop_qr"). Regenerate with
 *   npx qrcode@1.5.4 -t svg -e M -q 2 -d "#111111" -l "#ffffff" -o iphone-app-store-qr.svg "<url>"
 * when that link changes, then scan the result before committing it.
 */
import appStoreQrUrl from "../../assets/iphone-app-store-qr.svg";
import "./PhoneAppQrDialog.css";

type PhoneAppQrDialogProps = {
  readonly phase: Exclude<PhoneAppPhase, "ended">;
  readonly onClose: () => void;
  readonly onOpenStore: () => void;
  /** Android has no app yet; this opens its waitlist on drifty.so in the browser. */
  readonly onOpenAndroidWaitlist: () => void;
};

/**
 * A computer's browser cannot pre-order or install an iPhone app, so the card
 * hands off to the phone: the QR opens the App Store page on the iPhone. The
 * store page itself stays one click away for anyone who would rather browse.
 * Right under the description, before anyone scans, one line tells Android
 * users their app is in the works and links to the waitlist.
 */
export function PhoneAppQrDialog({ phase, onClose, onOpenStore, onOpenAndroidWaitlist }: PhoneAppQrDialogProps) {
  const { effectiveLanguage, t } = useLocalization();
  const titleId = useId();
  const bodyId = useId();
  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);
  const body = phase === "released"
    ? t("phoneApp.qr.releasedBody")
    : t("phoneApp.qr.preorderBody", { date: formatMonthDay(IPHONE_APP_RELEASE_DATE, effectiveLanguage) });

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        className="auth-modal modal-shell phone-app-qr"
        data-modal-variant="compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("phoneApp.qr.close")} onClick={onClose} />
        <div className="auth-modal__header">
          <h2 id={titleId}>{t("phoneApp.qr.title")}</h2>
          <p id={bodyId}>{body}</p>
          <p className="phone-app-qr__android">
            {t("phoneApp.qr.androidSoon")}{" "}
            <button type="button" className="phone-app-qr__android-link" onClick={onOpenAndroidWaitlist}>
              {t("phoneApp.qr.androidAction")}
              <ExternalLinkIcon className="phone-app-qr__external" />
            </button>
          </p>
        </div>
        <div className="phone-app-qr__code">
          <img src={appStoreQrUrl} alt={t("phoneApp.qr.imageLabel")} width={168} height={168} draggable={false} />
        </div>
        <div className="phone-app-qr__actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onOpenStore}>
            {t("phoneApp.qr.openStore")}
            <ExternalLinkIcon className="phone-app-qr__external" />
          </button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={onClose}>
            {t("phoneApp.qr.done")}
            <KeyHint shortcut="escape" />
          </button>
        </div>
      </section>
    </div>
  );
}
