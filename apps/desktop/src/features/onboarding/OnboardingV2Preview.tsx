import { useEffect } from "react";
import { createPortal } from "react-dom";
import "./onboardingV2Preview.css";

type OnboardingV2PreviewProps = {
  readonly onClose: () => void;
};

const ORIGINAL_ONBOARDING_V2_PREVIEW_URL = "/onboarding-v2-preview-original/Drifty%20Onboarding.dc.html";

export function OnboardingV2Preview({ onClose }: OnboardingV2PreviewProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="onboarding-v2-preview" role="dialog" aria-modal="true" aria-label="Onboarding v2 original preview">
      <iframe
        className="onboarding-v2-preview__frame"
        src={ORIGINAL_ONBOARDING_V2_PREVIEW_URL}
        title="Onboarding v2 original preview"
      />
      <button type="button" className="onboarding-v2-preview__close" onClick={onClose}>
        Close preview
      </button>
    </div>,
    document.body,
  );
}
