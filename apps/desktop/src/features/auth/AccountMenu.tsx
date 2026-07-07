import { getAccountDisplayName } from "./accountDisplay";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, SVGProps } from "react";
import { createPortal } from "react-dom";

const menuIconProps: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

function ProfileIcon() {
  return (
    <svg {...menuIconProps}>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M5.6 19.4c1-3.7 3.4-5.7 6.4-5.7s5.4 2 6.4 5.7" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg {...menuIconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function AiIcon() {
  return (
    <svg {...menuIconProps}>
      <path d="M11.5 3.8 13 9.4 18.6 11 13 12.6 11.5 18.2 10 12.6 4.4 11 10 9.4Z" fill="currentColor" stroke="none" />
      <path d="M18.2 13.4 18.7 15.3 20.6 15.8 18.7 16.3 18.2 18.2 17.7 16.3 15.8 15.8 17.7 15.3Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg {...menuIconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.4v2M12 19.6v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.4 12h2M19.6 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...menuIconProps}>
      <path d="M20.5 13.2A8 8 0 1 1 10.8 3.5a6.3 6.3 0 0 0 9.7 9.7Z" />
    </svg>
  );
}

function UpdateIcon() {
  return (
    <svg {...menuIconProps}>
      <path d="M4.2 12a7.8 7.8 0 0 1 13.2-5.6L20 8.6" />
      <path d="M19.8 12a7.8 7.8 0 0 1-13.2 5.6L4 15.4" />
      <path d="M20 4v4.6h-4.6M4 20v-4.6h4.6" />
    </svg>
  );
}

function FeedbackIcon() {
  return (
    <svg {...menuIconProps}>
      <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.4" />
      <path d="m3.8 6.6 8.2 5.8 8.2-5.8" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg {...menuIconProps}>
      <path d="M14.5 4.2H17a2.3 2.3 0 0 1 2.3 2.3v11a2.3 2.3 0 0 1-2.3 2.3h-2.5" />
      <path d="M9.5 16.5 14 12 9.5 7.5M14 12H3.5" />
    </svg>
  );
}

function SignInIcon() {
  return (
    <svg {...menuIconProps}>
      <path d="M9.5 4.2H7A2.3 2.3 0 0 0 4.7 6.5v11A2.3 2.3 0 0 0 7 19.8h2.5" />
      <path d="M15 16.5 19.5 12 15 7.5M19.5 12H8.5" />
    </svg>
  );
}

export const ACCOUNT_POPOVER_EXPANDED_EDGE_OFFSET_PX = 6;

export const ACCOUNT_POPOVER_EXPANDED_GAP_PX = 5;

export const ACCOUNT_POPOVER_COLLAPSED_GAP_PX = 10;

export const ACCOUNT_POPOVER_COLLAPSED_WIDTH = "14rem";

const SIGNED_OUT_TRIGGER_LABEL = "Unknown";

type AccountMenuProps = {
  readonly isOpen: boolean;
  readonly isSidebarCollapsed: boolean;
  readonly userAvatarUrl?: string | null;
  readonly userEmail: string | null;
  readonly isDarkMode: boolean;
  readonly onToggle: () => void;
  readonly onProfile: () => void;
  readonly onAiSetting: () => void;
  readonly onSettings: () => void;
  readonly onToggleTheme: () => void;
  readonly onCheckForUpdates: () => void;
  readonly onFeedback: () => void;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
};

export function AccountMenu({
  isOpen,
  isSidebarCollapsed,
  userAvatarUrl,
  userEmail,
  isDarkMode,
  onToggle,
  onProfile,
  onAiSetting,
  onSettings,
  onToggleTheme,
  onCheckForUpdates,
  onFeedback,
  onSignIn,
  onSignOut,
}: AccountMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const isSignedIn = Boolean(userEmail);
  const displayName = isSignedIn ? getAccountDisplayName(userEmail) : SIGNED_OUT_TRIGGER_LABEL;
  const trimmedUserAvatarUrl = userAvatarUrl?.trim();
  const shouldShowUserAvatar = isSignedIn && Boolean(trimmedUserAvatarUrl);

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
      <div className="account-popover__account">
        {isSignedIn ? (
          <div className="account-popover__email" title={userEmail ?? undefined}>{userEmail}</div>
        ) : (
          <div className="account-popover__name">Not signed in</div>
        )}
      </div>
      <div className="account-menu-separator account-menu-separator--account" role="separator" />
      <button type="button" className="account-menu-item" onClick={onSettings} role="menuitem">
        <span className="account-menu-icon"><SettingsIcon /></span>
        <span>Settings</span>
      </button>
      <button type="button" className="account-menu-item" onClick={onAiSetting} role="menuitem">
        <span className="account-menu-icon"><AiIcon /></span>
        <span>AI Setting</span>
      </button>
      <button
        type="button"
        className="account-menu-item"
        onClick={onToggleTheme}
        role="menuitemcheckbox"
        aria-checked={isDarkMode}
      >
        <span className="account-menu-icon">{isDarkMode ? <MoonIcon /> : <SunIcon />}</span>
        <span>Dark mode</span>
        <span className="account-menu-toggle" data-on={isDarkMode} aria-hidden="true">
          <span className="account-menu-toggle__knob" />
        </span>
      </button>
      <div className="account-menu-separator" role="separator" />
      {isSignedIn ? (
        <button type="button" className="account-menu-item" onClick={onProfile} role="menuitem">
          <span className="account-menu-icon"><ProfileIcon /></span>
          <span>My profile</span>
        </button>
      ) : null}
      <button type="button" className="account-menu-item" onClick={onCheckForUpdates} role="menuitem">
        <span className="account-menu-icon"><UpdateIcon /></span>
        <span>Check for updates</span>
      </button>
      <button type="button" className="account-menu-item" onClick={onFeedback} role="menuitem">
        <span className="account-menu-icon"><FeedbackIcon /></span>
        <span>Send feedback</span>
      </button>
      {isSignedIn ? (
        <>
          <div className="account-menu-separator" role="separator" />
          <button type="button" className="account-menu-item account-menu-item--danger" onClick={onSignOut} role="menuitem">
            <span className="account-menu-icon"><LogoutIcon /></span>
            <span>Log out</span>
          </button>
        </>
      ) : (
        <>
          <div className="account-menu-separator" role="separator" />
          <button type="button" className="account-menu-item" onClick={onSignIn} role="menuitem">
            <span className="account-menu-icon"><SignInIcon /></span>
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
        <span className={shouldShowUserAvatar ? "account-avatar" : "account-avatar account-avatar--placeholder"}>
          {shouldShowUserAvatar ? (
            <img src={trimmedUserAvatarUrl} alt="" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
              <circle cx="14" cy="10.4" r="3.5" />
              <path d="M7.6 22c1.2-4 3.6-6.1 6.4-6.1s5.2 2.1 6.4 6.1" />
            </svg>
          )}
        </span>
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
