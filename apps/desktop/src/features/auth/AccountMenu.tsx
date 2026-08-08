import { getAccountDisplayName } from "./accountDisplay";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, SVGProps } from "react";
import { createPortal } from "react-dom";
import { useLocalization } from "../localization/LocalizationContext";

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
      {/* Common 6-tooth gear silhouette — less busy than the Lucide 8-lobe Settings path. */}
      <path d="M10.09 3 L13.91 3 L14.08 5.79 L15.27 6.33 L16.34 7.1 L18.84 5.84 L20.75 9.16 L18.42 10.69 L18.55 12 L18.42 13.31 L20.75 14.84 L18.84 18.16 L16.34 16.9 L15.28 17.67 L14.08 18.21 L13.91 21 L10.09 21 L9.92 18.21 L8.73 17.67 L7.66 16.9 L5.16 18.16 L3.25 14.84 L5.58 13.31 L5.45 12 L5.58 10.69 L3.25 9.16 L5.16 5.84 L7.66 7.1 L8.73 6.33 L9.92 5.79 Z" />
    </svg>
  );
}

function AiIcon() {
  return (
    <svg {...menuIconProps}>
      {/* Optically enlarge the filled sparkle so AI Setting matches sibling icons
          before the shared CSS icon scale is applied. */}
      <path d="M11.5 2.22 13.33 9.05 20.16 11 13.33 12.95 11.5 19.78 9.67 12.95 2.84 11 9.67 9.05Z" fill="currentColor" stroke="none" />
      <path d="M19.67 13.93 20.28 16.25 22.6 16.86 20.28 17.47 19.67 19.78 19.06 17.47 16.75 16.86 19.06 16.25Z" fill="currentColor" stroke="none" />
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

/* Paw print from Phosphor Icons (MIT). Unlike the neighbouring outline
   glyphs this one is a filled shape, so it declares its own viewBox and fill
   instead of reusing `menuIconProps`. */
function PetIcon() {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden focusable={false}>
      <path d="M212,80a28,28,0,1,0,28,28A28,28,0,0,0,212,80Zm0,40a12,12,0,1,1,12-12A12,12,0,0,1,212,120ZM72,108a28,28,0,1,0-28,28A28,28,0,0,0,72,108ZM44,120a12,12,0,1,1,12-12A12,12,0,0,1,44,120ZM92,88A28,28,0,1,0,64,60,28,28,0,0,0,92,88Zm0-40A12,12,0,1,1,80,60,12,12,0,0,1,92,48Zm72,40a28,28,0,1,0-28-28A28,28,0,0,0,164,88Zm0-40a12,12,0,1,1-12,12A12,12,0,0,1,164,48Zm23.12,100.86a35.3,35.3,0,0,1-16.87-21.14,44,44,0,0,0-84.5,0A35.25,35.25,0,0,1,69,148.82,40,40,0,0,0,88,224a39.48,39.48,0,0,0,15.52-3.13,64.09,64.09,0,0,1,48.87,0,40,40,0,0,0,34.73-72ZM168,208a24,24,0,0,1-9.45-1.93,80.14,80.14,0,0,0-61.19,0,24,24,0,0,1-20.71-43.26,51.22,51.22,0,0,0,24.46-30.67,28,28,0,0,1,53.78,0,51.27,51.27,0,0,0,24.53,30.71A24,24,0,0,1,168,208Z" />
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
const SIGNED_OUT_TRIGGER_ARIA_LABEL = "Unknown";

type AccountMenuProps = {
  readonly isOpen: boolean;
  readonly isSidebarCollapsed: boolean;
  readonly userAvatarUrl?: string | null;
  readonly userEmail: string | null;
  readonly isDarkMode: boolean;
  readonly isPetVisible: boolean;
  readonly onToggle: () => void;
  readonly onProfile: () => void;
  /** Profile is a Dev-mode beta surface; hide the item when the gate is off. */
  readonly showProfile?: boolean;
  readonly onAiSetting: () => void;
  readonly onSettings: () => void;
  readonly onToggleTheme: () => void;
  readonly onTogglePet: () => void;
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
  isPetVisible,
  onToggle,
  onProfile,
  showProfile = true,
  onAiSetting,
  onSettings,
  onToggleTheme,
  onTogglePet,
  onCheckForUpdates,
  onFeedback,
  onSignIn,
  onSignOut,
}: AccountMenuProps) {
  const { t } = useLocalization();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const isSignedIn = Boolean(userEmail);
  const displayName = isSignedIn ? getAccountDisplayName(userEmail) : SIGNED_OUT_TRIGGER_LABEL;
  const triggerLabel = isSignedIn ? displayName : SIGNED_OUT_TRIGGER_ARIA_LABEL;
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

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onToggle();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onToggle();
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onToggle]);

  const popover = isOpen && popoverStyle ? createPortal(
    <div
      ref={menuRef}
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
        <span className="account-menu-icon account-menu-icon--settings"><SettingsIcon /></span>
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
      {/* Sits with Dark mode because it is the same kind of control: a quick
          on/off for something visible, flipped often enough that routing the
          user through Settings every time would be the wrong trade. Coat and
          size stay in Settings, where they are chosen once. */}
      <button
        type="button"
        className="account-menu-item"
        onClick={onTogglePet}
        role="menuitemcheckbox"
        aria-checked={isPetVisible}
      >
        <span className="account-menu-icon"><PetIcon /></span>
        <span>{t("settings.pet.show")}</span>
        <span className="account-menu-toggle" data-on={isPetVisible} aria-hidden="true">
          <span className="account-menu-toggle__knob" />
        </span>
      </button>
      <div className="account-menu-separator" role="separator" />
      {showProfile ? (
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
        aria-label={triggerLabel}
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
