import type { MouseEvent } from "react";

import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { AiPrivacyDetails } from "./AiPrivacyReview";
import "./AiPrivacyDetailsModal.css";

/**
 * What an AI request contains, in full: an example request, what each field means and
 * the wording behind each never-sent claim. Opened from the AI data sending group so the
 * settings page stays short; the policy page on drifty.so cannot show this, because the
 * example follows the switches set on this device.
 */
export function AiPrivacyDetailsModal({ onClose }: { readonly onClose: () => void }) {
  const { t } = useLocalization();
  useModalDismiss(onClose);

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className="auth-modal__overlay" onClick={handleOverlayClick}>
      <section
        aria-labelledby="ai-privacy-details-title"
        aria-modal="true"
        className="auth-modal modal-shell ai-privacy-modal"
        data-modal-variant="standard"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("settings.aiPrivacy.detailsClose")} onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="ai-privacy-details-title">{t("settings.aiPrivacy.detailsHeading")}</h2>
            <p>{t("settings.aiPrivacy.detailsDescription")}</p>
          </div>
        </div>
        <div className="ai-privacy-modal__body">
          <AiPrivacyDetails />
        </div>
        <div className="modal-foot">
          <button type="button" className="modal-btn modal-btn--primary" onClick={onClose}>
            {t("settings.aiPrivacy.detailsClose")}
          </button>
        </div>
      </section>
    </div>
  );
}
