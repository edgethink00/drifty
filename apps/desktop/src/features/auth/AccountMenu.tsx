import { getAccountDisplayName } from "./accountDisplay";
import desktopPackage from "../../../package.json";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

export const ACCOUNT_POPOVER_EXPANDED_EDGE_OFFSET_PX = 6;

export const ACCOUNT_POPOVER_EXPANDED_GAP_PX = 5;

export const ACCOUNT_POPOVER_COLLAPSED_GAP_PX = 10;

export const ACCOUNT_POPOVER_COLLAPSED_WIDTH = "14rem";

const ACCOUNT_MENU_VERSION_LABEL = "Version";
const ACCOUNT_MENU_VERSION_VALUE = desktopPackage.version;

type AccountMenuProps = {
  readonly isOpen: boolean;
  readonly isSidebarCollapsed: boolean;
  readonly userAvatarUrl?: string | null;
  readonly userEmail: string | null;
  readonly onToggle: () => void;
  readonly onAiSetting: () => void;
  readonly onSettings: () => void;
  readonly onFeedback: () => void;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
};

export function AccountMenu({
  isOpen,
  isSidebarCollapsed,
  userAvatarUrl,
  userEmail,
  onToggle,
  onAiSetting,
  onSettings,
  onFeedback,
  onSignIn,
  onSignOut,
}: AccountMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const isSignedIn = Boolean(userEmail);
  const displayName = isSignedIn ? getAccountDisplayName(userEmail) : "Account";
  const trimmedUserAvatarUrl = userAvatarUrl?.trim();

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    if (isSidebarCollapsed) {
      setPopoverStyle({
        position: "fixed",
        left: rect.right + ACCOUNT_POPOVER_COLLAPSED_GAP_PX,
        bottom: window.innerHeight - rect.bottom,
        width: ACCOUNT_POPOVER_COLLAPSED_WIDTH,
      });
      return;
    }

    setPopoverStyle({
      position: "fixed",
      left: rect.left - ACCOUNT_POPOVER_EXPANDED_EDGE_OFFSET_PX,
      bottom: window.innerHeight - rect.top + ACCOUNT_POPOVER_EXPANDED_GAP_PX,
      width: rect.width + ACCOUNT_POPOVER_EXPANDED_EDGE_OFFSET_PX * 2,
    });
  }, [isSidebarCollapsed]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverStyle(null);
      return;
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen, updatePopoverPosition]);

  const popover = isOpen && popoverStyle ? createPortal(
    <div
      className={isSidebarCollapsed ? "account-popover account-popover--collapsed" : "account-popover"}
      style={popoverStyle}
      role="menu"
      aria-label="Account menu"
    >
      <div className="account-menu-version" aria-label={`Drifty ${ACCOUNT_MENU_VERSION_LABEL} ${ACCOUNT_MENU_VERSION_VALUE}`}>
        <span>{ACCOUNT_MENU_VERSION_LABEL}</span>
        <span className="account-menu-version__value">{ACCOUNT_MENU_VERSION_VALUE}</span>
      </div>
      {userEmail ? <div className="account-popover__email" title={userEmail}>{userEmail}</div> : null}
      <div className="account-menu-separator account-menu-separator--account" role="separator" />
      <button type="button" className="account-menu-item" onClick={onAiSetting} role="menuitem">
        <span className="account-menu-icon" aria-hidden="true">✦</span>
        <span>AI Setting</span>
      </button>
      <button type="button" className="account-menu-item" onClick={onSettings} role="menuitem">
        <span className="account-menu-icon" aria-hidden="true">⚙</span>
        <span>Settings</span>
      </button>
      <button type="button" className="account-menu-item" onClick={onFeedback} role="menuitem">
        <span className="account-menu-icon" aria-hidden="true">✉</span>
        <span>Send feedback</span>
      </button>
      {isSignedIn ? (
        <>
          <div className="account-menu-separator" role="separator" />
          <button type="button" className="account-menu-item account-menu-item--danger" onClick={onSignOut} role="menuitem">
            <span className="account-menu-icon" aria-hidden="true">↪</span>
            <span>Log out</span>
          </button>
        </>
      ) : (
        <>
          <div className="account-menu-separator" role="separator" />
          <button type="button" className="account-menu-item" onClick={onSignIn} role="menuitem">
            <span className="account-menu-icon" aria-hidden="true">↗</span>
            <span>Sign in</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="account-menu-shell">
      {popover}
      <button
        ref={triggerRef}
        type="button"
        className="account-trigger"
        onClick={onToggle}
        aria-label={displayName}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="account-avatar">{trimmedUserAvatarUrl ? <img src={trimmedUserAvatarUrl} alt="" aria-hidden="true" /> : displayName.charAt(0).toUpperCase()}</span>
        <span className="account-trigger__copy">
          <strong>{displayName}</strong>
        </span>
        <span className="account-trigger__chevrons" aria-hidden="true">
          <span className="account-trigger__chevron-mark account-trigger__chevron-mark--up" />
          <span className="account-trigger__chevron-mark account-trigger__chevron-mark--down" />
        </span>
      </button>
    </div>
  );
}
