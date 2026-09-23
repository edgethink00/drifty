import { useRef } from "react";

import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";

type DeviceSyncPurgeConfirmationProps = {
  readonly onCancel: () => void;
  readonly onConfirm: () => void | Promise<void>;
};

const TITLE_ID = "device-sync-purge-title";
const DESCRIPTION_ID = "device-sync-purge-description";

export function DeviceSyncPurgeConfirmation({
  onCancel,
  onConfirm,
}: DeviceSyncPurgeConfirmationProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDismiss(onCancel);
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-device-sync-purge-cancel]" });

  return (
    <div
      ref={dialogRef}
      className="history-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      aria-describedby={DESCRIPTION_ID}
      tabIndex={-1}
    >
      <div className="history-confirm__panel modal-shell" data-modal-variant="compact">
        <h2 id={TITLE_ID}>Delete synced cloud data?</h2>
        <p id={DESCRIPTION_ID}>
          This removes the cloud copy and pauses uploads from every connected device. Segments
          already merged on another device stay there. Device sync remains off until you
          explicitly turn it on again.
        </p>
        <div className="history-confirm__actions">
          <button
            type="button"
            className="modal-btn modal-btn--ghost"
            data-device-sync-purge-cancel
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="modal-btn modal-btn--danger"
            onClick={() => void onConfirm()}
          >
            Delete cloud copy
          </button>
        </div>
      </div>
    </div>
  );
}
