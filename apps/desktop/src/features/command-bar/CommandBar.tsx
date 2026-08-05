import { useRef } from "react";
import { commandBarTabs, type TabId } from "../../app/navigation";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";

export interface CommandBarProps {
  readonly includeProjects: boolean;
  readonly onDismiss: () => void;
  readonly onNavigate: (tabId: TabId) => void;
}

export function CommandBar({ includeProjects, onDismiss, onNavigate }: CommandBarProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-command-search]" });

  return (
    <div className="cmd-overlay" onClick={onDismiss}>
      <div
        ref={dialogRef}
        aria-label="Command palette"
        aria-modal="true"
        className="cmd-box modal-shell"
        data-modal-variant="utility"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="cmd-input-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input aria-label="Search commands" data-command-search placeholder="Type a command or search…" />
          <span className="esc-key">esc</span>
        </div>
        <div className="cmd-section-label">Navigate</div>
        {commandBarTabs.filter((item) => includeProjects || item.id !== "projects").map((item) => (
          <button key={item.id} className="cmd-item" onClick={() => onNavigate(item.id)}>
            <span className="cmd-label">{item.label}</span>
            <span className="cmd-sub">{item.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
