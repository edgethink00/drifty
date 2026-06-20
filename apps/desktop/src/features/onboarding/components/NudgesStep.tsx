import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

type NudgesStepProps = {
  driftAlarmEnabled: boolean;
  extremeNudgeEnabled: boolean;
  onDriftAlarmChange: (enabled: boolean) => void;
  onExtremeNudgeChange: (enabled: boolean) => void;
};

export function NudgesStep({
  driftAlarmEnabled,
  extremeNudgeEnabled,
  onDriftAlarmChange,
  onExtremeNudgeChange,
}: NudgesStepProps) {
  const [extremeConfirmOpen, setExtremeConfirmOpen] = useState(false);

  useEffect(() => {
    if (extremeConfirmOpen && extremeNudgeEnabled) setExtremeConfirmOpen(false);
  }, [extremeConfirmOpen, extremeNudgeEnabled]);

  function handleExtremeToggle() {
    if (extremeNudgeEnabled) {
      onExtremeNudgeChange(false);
      return;
    }
    setExtremeConfirmOpen(true);
  }

  function handleDriftAlarmToggle() {
    const nextEnabled = !driftAlarmEnabled;
    onDriftAlarmChange(nextEnabled);
    if (!nextEnabled && extremeNudgeEnabled) onExtremeNudgeChange(false);
  }

  function confirmExtremeNudge() {
    if (!driftAlarmEnabled) onDriftAlarmChange(true);
    onExtremeNudgeChange(true);
    setExtremeConfirmOpen(false);
  }

  return (
    <>
      <p className="onb-step-desc onb-nudges-copy">Choose your drift nudge strength.</p>
      <ul className="onb-perms onb-nudges" aria-label="Drift alert settings">
        <li className="onb-perms__row onb-nudge-row">
          <div className="onb-perms__info">
            <span className="onb-perms__name">Drift alarm</span>
            <span className="onb-perms__desc">Gentle alert after sustained drift.</span>
          </div>
          <div className="onb-perms__control">
            <NudgeToggle
              enabled={driftAlarmEnabled}
              label="Drift alarm"
              onToggle={handleDriftAlarmToggle}
            />
          </div>
        </li>
        <li
          className={`onb-perms__row onb-nudge-row onb-nudge-row--extreme${
            extremeNudgeEnabled ? " onb-nudge-row--selected" : ""
          }`}
        >
          <div className="onb-perms__info">
            <span className="onb-perms__name">
              Extreme nudge <span className="onb-status-pill onb-status-pill--beta">Beta</span>
            </span>
            <span className="onb-perms__desc">Closes the distracting tab or app when repeated drift is detected.</span>
          </div>
          <div className="onb-perms__control">
            <NudgeToggle
              enabled={extremeNudgeEnabled}
              label="Extreme nudge"
              tone="extreme"
              onToggle={handleExtremeToggle}
            />
          </div>
        </li>
      </ul>
      {extremeConfirmOpen ? (
        <ExtremeNudgeConfirmPortal
          onCancel={() => setExtremeConfirmOpen(false)}
          onConfirm={confirmExtremeNudge}
        />
      ) : null}
    </>
  );
}

function ExtremeNudgeConfirmPortal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = <ExtremeNudgeConfirmDialog onCancel={onCancel} onConfirm={onConfirm} />;
  const portalRoot = typeof document === "undefined"
    ? null
    : document.querySelector<HTMLElement>(".onboarding-screen");
  return portalRoot ? createPortal(dialog, portalRoot) : dialog;
}

function ExtremeNudgeConfirmDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelButtonRef.current?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusableButtons = [cancelButtonRef.current, confirmButtonRef.current].filter(
        (button): button is HTMLButtonElement => button !== null && !button.disabled,
      );
      const firstButton = focusableButtons[0];
      const lastButton = focusableButtons[focusableButtons.length - 1];
      if (!firstButton || !lastButton) return;

      if (event.shiftKey && document.activeElement === firstButton) {
        event.preventDefault();
        lastButton.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === lastButton) {
        event.preventDefault();
        firstButton.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedElement?.focus({ preventScroll: true });
    };
  }, [onCancel]);

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onCancel();
  }

  return (
    <div className="onb-confirm-backdrop" onMouseDown={handleBackdropMouseDown}>
      <section
        className="onb-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="onb-extreme-confirm-title"
        aria-describedby="onb-extreme-confirm-desc"
      >
        <div className="onb-confirm-dialog__mark" aria-hidden="true">
          <ScissorsIcon />
        </div>
        <div className="onb-confirm-dialog__eyebrow">Extreme nudge</div>
        <h2 className="onb-confirm-dialog__title" id="onb-extreme-confirm-title">
          Let Drifty close drift?
        </h2>
        <p className="onb-confirm-dialog__desc" id="onb-extreme-confirm-desc">
          When repeated drift is detected, Drifty can close the distracting browser tab or quit the distracting app.
          This is more direct than a warning.
        </p>
        <div className="onb-confirm-dialog__actions">
          <button type="button" className="onb-button onb-button--ghost" onClick={onCancel} ref={cancelButtonRef}>
            Keep off
          </button>
          <button
            type="button"
            className="onb-button onb-button--primary"
            onClick={onConfirm}
            ref={confirmButtonRef}
          >
            Allow closing
          </button>
        </div>
      </section>
    </div>
  );
}

function NudgeToggle({
  enabled,
  label,
  tone = "default",
  onToggle,
}: {
  enabled: boolean;
  label: string;
  tone?: "default" | "extreme";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`onb-toggle onb-toggle--${tone}${enabled ? " onb-toggle--on" : ""}`}
      aria-label={label}
      aria-pressed={enabled}
      onClick={onToggle}
    >
      <span className="onb-toggle__track" aria-hidden="true">
        <span className="onb-toggle__thumb" />
      </span>
      <span className="onb-toggle__label">{enabled ? "On" : "Off"}</span>
    </button>
  );
}

function ScissorsIcon() {
  return (
    <svg className="onb-confirm-dialog__icon" viewBox="0 0 24 24" fill="none" focusable="false">
      <circle cx="6.25" cy="6.25" r="2.65" />
      <circle cx="6.25" cy="17.75" r="2.65" />
      <path d="M8.2 8.2 19 19" />
      <path d="M8.2 15.8 19 5" />
      <path d="M12.2 12h4.2" />
    </svg>
  );
}
