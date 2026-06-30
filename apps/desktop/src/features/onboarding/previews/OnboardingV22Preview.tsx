import { useEffect } from "react";
// The v2.2 onboarding preview is a self-contained HTML prototype (copied from the
// claude.ai/design "Drifty Onboarding" project and converted to dependency-free
// vanilla JS). We load it verbatim as a string and render it inside a sandboxed
// iframe so the prototype's own styles/scripts stay fully isolated from the app.
import previewHtml from "./onboarding-v2.2-preview.html?raw";
import "./onboarding-v2.2-preview.css";

type OnboardingV22PreviewProps = {
  readonly open: boolean;
  readonly onClose: () => void;
};

export function OnboardingV22Preview({ open, onClose }: OnboardingV22PreviewProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="onboarding-v22-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding v2.2 preview"
      onClick={onClose}
    >
      <div className="onboarding-v22-preview-frame" onClick={(event) => event.stopPropagation()}>
        <div className="onboarding-v22-preview-bar">
          <span className="onboarding-v22-preview-title">Onboarding v2.2 preview</span>
          <button type="button" className="onboarding-v22-preview-close" onClick={onClose} aria-label="Close preview">
            Close
          </button>
        </div>
        <iframe className="onboarding-v22-preview-iframe" title="Onboarding v2.2 preview" srcDoc={previewHtml} />
      </div>
    </div>
  );
}
