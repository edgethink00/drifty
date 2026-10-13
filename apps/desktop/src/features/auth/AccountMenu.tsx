import { PetIcon } from "../../components/PetIcon";
import { getAccountDisplayName } from "./accountDisplay";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, SVGProps } from "react";
import { createPortal } from "react-dom";
import { AnchoredPresence } from "../../components/AnchoredPresence";
import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";
import { FeatureNewBadge } from "../discovery/FeatureNewBadge";
import { BUILD_INFO } from "../../buildInfo";
import "./AccountMenuTracker.css";

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

function LanguageIcon() {
  return (
    <svg {...menuIconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 12h16.8M12 3c2.2 2.4 3.4 5.4 3.4 9s-1.2 6.6-3.4 9M12 3C9.8 5.4 8.6 8.4 8.6 12s1.2 6.6 3.4 9" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg {...menuIconProps}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...menuIconProps}>
      <path d="m5 12 4.2 4.2L19 6.5" />
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

function InviteFriendsIcon() {
  return (
    <svg {...menuIconProps}>
      <rect x="3.6" y="8.2" width="16.8" height="4" rx="1" />
      <path d="M12 8.2V20.4" />
      <path d="M18.8 12.2v6.2a2 2 0 0 1-2 2H7.2a2 2 0 0 1-2-2v-6.2" />
      <path d="M7.6 8.2a2.4 2.4 0 0 1 0-4.8C10.1 3.4 12 8.2 12 8.2s1.9-4.8 4.4-4.8a2.4 2.4 0 0 1 0 4.8" />
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

/** Same glyphs as the sidebar tracker toggle; CSS picks one from `data-state`. */
function TrackerActionIcon() {
  return (
    <svg className="account-tracker-action-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <g className="account-tracker-action-icon--pause">
        <rect x="2.9" y="2" width="2.2" height="8" rx="1.1" />
        <rect x="6.9" y="2" width="2.2" height="8" rx="1.1" />
      </g>
      <path className="account-tracker-action-icon--play" d="M3.6 2.6c0-.62.68-1 1.2-.67l4.7 3.4c.47.33.47 1.02 0 1.34l-4.7 3.4a.8.8 0 0 1-1.2-.67Z" />
      <rect className="account-tracker-action-icon--stop" x="3" y="3" width="6" height="6" rx="1" />
    </svg>
  );
}

/**
 * Tracking that needs the user: paused (by the user or because recording
 * stopped), "attention" (the tracker failed to start or stopped on its own),
 * or "setup" (the app cannot reach the tracker). Null while recording, idle,
 * replaying, or still loading.
 */
export type AccountTrackerAttention = "paused" | "attention" | "setup";

/**
 * The live tracker card, handed to the account menu. `state` keeps the
 * sidebar control vocabulary: "pause" means tracking is running (the action
 * pauses it), "resume" means it is stopped, "replay" a dashboard replay, and
 * "unavailable" means it cannot run.
 */
export type AccountMenuTrackerSummary = {
  readonly state: string;
  readonly attention: AccountTrackerAttention | null;
  /**
   * Badge the avatar with the attention state. The sidebar card above the
   * account row normally carries it, so the app sets this only where no card
   * shows it: the collapsed rail, and a browser build with no tracker to set up.
   */
  readonly markRow: boolean;
  readonly statusLabel: string;
  readonly appLabel: string;
  /** Spoken summary: status, app, site, today's total, last capture. */
  readonly description: string;
  readonly actionLabel: string;
  readonly actionDisabled: boolean;
  /** A pause request is in flight. */
  readonly busy?: boolean;
  readonly onAction: () => void;
  /** Opens the tracker permissions while the app cannot reach the tracker. */
  readonly onSetup?: () => void;
};

/** The sidebar tracker card's 24px pause/resume control, now in the menu block. */
function TrackerControl({ tracker }: { tracker: AccountMenuTrackerSummary }) {
  if (tracker.state === "unavailable") return null;
  return (
    <button
      type="button"
      className="account-tracker-control"
      role="menuitem"
      data-state={tracker.state}
      onClick={tracker.onAction}
      disabled={tracker.actionDisabled}
      aria-busy={tracker.busy || undefined}
      aria-label={tracker.actionLabel}
      title={tracker.actionLabel}
    >
      <TrackerActionIcon />
    </button>
  );
}

function PausedGlyph() {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <rect x="1.7" y="1.5" width="1.6" height="5" rx="0.5" />
      <rect x="4.7" y="1.5" width="1.6" height="5" rx="0.5" />
    </svg>
  );
}

function AlertGlyph() {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <rect x="3.15" y="1.2" width="1.7" height="3.7" rx="0.7" />
      <circle cx="4" cy="6.35" r="0.95" />
    </svg>
  );
}

/**
 * Status is carried by shape as well as colour: a live dot while recording, a
 * red dot while stopped, "!" when the tracker needs attention or setup. The
 * pause glyph marks only the avatar badge on the collapsed rail; the menu
 * block keeps the sidebar card's red dot while paused (owner choice).
 */
function TrackerStatusMark({
  state,
  attention,
  className = "",
}: {
  state: string;
  attention: AccountTrackerAttention | null;
  className?: string;
}) {
  if (attention === "attention" || attention === "setup") {
    return <span className={`account-status-mark account-status-mark--alert ${className}`} aria-hidden="true"><AlertGlyph /></span>;
  }
  if (attention === "paused") {
    return <span className={`account-status-mark account-status-mark--paused ${className}`} aria-hidden="true"><PausedGlyph /></span>;
  }
  return <span className={`account-tracker-dot ${className}`} data-state={state} aria-hidden="true" />;
}

export const ACCOUNT_POPOVER_EXPANDED_EDGE_OFFSET_PX = 6;

export const ACCOUNT_POPOVER_EXPANDED_GAP_PX = 5;

export const ACCOUNT_POPOVER_COLLAPSED_GAP_PX = 10;

export const ACCOUNT_POPOVER_COLLAPSED_WIDTH = "14rem";

export const ACCOUNT_POPOVER_MIN_WIDTH_PX = 244;

export function collapsedAccountPopoverLeftPx(
  railRight: number,
  gapPx: number = ACCOUNT_POPOVER_COLLAPSED_GAP_PX,
): number {
  return railRight + gapPx;
}

type AccountMenuProps = {
  readonly isOpen: boolean;
  readonly isSidebarCollapsed: boolean;
  readonly userAvatarUrl?: string | null;
  readonly userEmail: string | null;
  readonly isDarkMode: boolean;
  readonly isPetVisible: boolean;
  readonly showPetNewBadge?: boolean;
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
  /** Present only while friend invites are open for this account. */
  readonly onInviteFriends?: () => void;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
  readonly tracker?: AccountMenuTrackerSummary | null;
};

export function AccountMenu({
  isOpen,
  isSidebarCollapsed,
  userAvatarUrl,
  userEmail,
  isDarkMode,
  isPetVisible,
  showPetNewBadge = false,
  onToggle,
  onProfile,
  showProfile = true,
  onAiSetting,
  onSettings,
  onToggleTheme,
  onTogglePet,
  onCheckForUpdates,
  onFeedback,
  onInviteFriends,
  onSignIn,
  onSignOut,
  tracker = null,
}: AccountMenuProps) {
  const { effectiveLanguage, setDisplayLanguage, t } = useLocalization();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const languageButtonRef = useRef<HTMLButtonElement | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const isSignedIn = Boolean(userEmail);
  // "Unknown" (English) for signed-out users is an owner decision; see the
  // "account.guest" entry in docs/product-decisions.md before changing it.
  const displayName = isSignedIn ? getAccountDisplayName(userEmail) : t("account.guest");
  const triggerLabel = displayName;
  const trimmedUserAvatarUrl = userAvatarUrl?.trim();
  const shouldShowUserAvatar = isSignedIn && Boolean(trimmedUserAvatarUrl);

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    if (isSidebarCollapsed) {
      const rail = trigger.closest(".sidebar");
      const railRight = rail?.getBoundingClientRect().right ?? rect.right;
      setPopoverStyle({
        position: "fixed",
        left: collapsedAccountPopoverLeftPx(railRight),
        bottom: window.innerHeight - rect.bottom,
        width: ACCOUNT_POPOVER_COLLAPSED_WIDTH,
      });
      return;
    }

    setPopoverStyle({
        position: "fixed",
        left: rect.left - ACCOUNT_POPOVER_EXPANDED_EDGE_OFFSET_PX,
        bottom: window.innerHeight - rect.top + ACCOUNT_POPOVER_EXPANDED_GAP_PX,
        width: Math.max(ACCOUNT_POPOVER_MIN_WIDTH_PX, rect.width + ACCOUNT_POPOVER_EXPANDED_EDGE_OFFSET_PX * 2),
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
    const rail = triggerRef.current?.closest(".sidebar");
    const resizeObserver = typeof ResizeObserver === "function" && rail
      ? new ResizeObserver(() => updatePopoverPosition())
      : null;
    if (rail && resizeObserver) resizeObserver.observe(rail);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
      resizeObserver?.disconnect();
    };
  }, [isOpen, updatePopoverPosition]);

  useEffect(() => {
    if (isOpen) return;
    setIsLanguageMenuOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isLanguageMenuOpen) return;
    languageMenuRef.current
      ?.querySelector<HTMLElement>(`[role="menuitemradio"][aria-checked="true"]`)
      ?.focus();
  }, [isLanguageMenuOpen]);

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

  const selectLanguage = (language: DisplayLanguage) => {
    setDisplayLanguage(language);
    setIsLanguageMenuOpen(false);
    onToggle();
  };

  const handleLanguageMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      setIsLanguageMenuOpen(false);
      languageButtonRef.current?.focus();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = Array.from(languageMenuRef.current?.querySelectorAll<HTMLElement>(`[role="menuitemradio"]`) ?? []);
    if (options.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const activeIndex = options.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : event.key === "ArrowDown"
          ? (activeIndex + 1 + options.length) % options.length
          : (activeIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus();
  };

  const currentLanguageLabel = effectiveLanguage === "ko"
    ? t("settings.general.languageKorean")
    : t("settings.general.languageEnglish");

  const avatarMark = (
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
  );
  // The sidebar tracker card lives in the menu as one block, directly above
  // Log out: the menu opens upward from the account row, so this is the spot
  // nearest the pointer and where the card used to sit. Log out stays last.
  const trackerBlock = tracker ? (
    tracker.attention === "setup" && tracker.onSetup ? (
      <button
        type="button"
        className="account-menu-tracker-block account-menu-tracker-block--setup"
        data-state={tracker.state}
        role="menuitem"
        onClick={tracker.onSetup}
      >
        <span className="account-menu-icon">
          <TrackerStatusMark state={tracker.state} attention={tracker.attention} />
        </span>
        <span className="account-menu-tracker-copy">
          <span className="account-menu-tracker-copy__label">{tracker.statusLabel}</span>
          <span className="account-menu-tracker-copy__app">{tracker.appLabel}</span>
        </span>
        <span className="account-menu-language-chevron" aria-hidden="true"><ChevronRightIcon /></span>
      </button>
    ) : (
      <div
        className="account-menu-tracker-block"
        data-state={tracker.state}
        data-attention={tracker.attention ?? undefined}
        role="group"
        aria-label={tracker.description}
      >
        <span className="account-menu-icon">
          <TrackerStatusMark state={tracker.state} attention={tracker.attention === "paused" ? null : tracker.attention} />
        </span>
        <span className="account-menu-tracker-copy">
          <span className="account-menu-tracker-copy__label">{tracker.statusLabel}</span>
          <span className="account-menu-tracker-copy__app">{tracker.appLabel}</span>
        </span>
        <TrackerControl tracker={tracker} />
      </div>
    )
  ) : null;

  // The boundary sits inside the portal because the exit pose is applied through
  // a descendant selector; one left behind in the sidebar never reaches this menu.
  const popover = createPortal(
    <AnchoredPresence>{isOpen && popoverStyle ? (
    <div
      ref={menuRef}
      className={isSidebarCollapsed ? "account-popover account-popover--collapsed" : "account-popover"}
      data-sidebar-guide-anchor="account"
      style={popoverStyle}
      role="menu"
      aria-label={t("account.menu")}
    >
      <div className="account-menu-version">v{BUILD_INFO.version}</div>
      <button type="button" className="account-menu-item" onClick={onSettings} role="menuitem">
        <span className="account-menu-icon account-menu-icon--settings"><SettingsIcon /></span>
        <span>{t("common.settings")}</span>
      </button>
      <button type="button" className="account-menu-item" onClick={onAiSetting} role="menuitem">
        <span className="account-menu-icon"><AiIcon /></span>
        <span>{t("account.aiSettings")}</span>
      </button>
      <div className="account-menu-separator" role="separator" />
      <div className="account-menu-language">
        <button
          ref={languageButtonRef}
          type="button"
          className="account-menu-item account-menu-item--language"
          onClick={() => setIsLanguageMenuOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight") return;
            event.preventDefault();
            setIsLanguageMenuOpen(true);
          }}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={isLanguageMenuOpen}
          data-open={isLanguageMenuOpen}
        >
          <span className="account-menu-icon"><LanguageIcon /></span>
          <span>{t("settings.general.language")}</span>
          <span className="account-menu-language-value">{currentLanguageLabel}</span>
          <span className="account-menu-language-chevron" aria-hidden="true"><ChevronRightIcon /></span>
        </button>
        {isLanguageMenuOpen ? (
          <div
            ref={languageMenuRef}
            className="account-menu-language-submenu"
            role="menu"
            aria-label={t("settings.general.language")}
            onKeyDown={handleLanguageMenuKeyDown}
          >
            <button
              type="button"
              className="account-menu-item account-menu-language-option"
              role="menuitemradio"
              aria-checked={effectiveLanguage === "en"}
              onClick={() => selectLanguage("en")}
            >
              <span>{t("settings.general.languageEnglish")}</span>
              <span className="account-menu-language-check" aria-hidden="true"><CheckIcon /></span>
            </button>
            <button
              type="button"
              className="account-menu-item account-menu-language-option"
              role="menuitemradio"
              aria-checked={effectiveLanguage === "ko"}
              onClick={() => selectLanguage("ko")}
            >
              <span>{t("settings.general.languageKorean")}</span>
              <span className="account-menu-language-check" aria-hidden="true"><CheckIcon /></span>
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="account-menu-item"
        onClick={onToggleTheme}
        role="menuitemcheckbox"
        aria-checked={isDarkMode}
      >
        <span className="account-menu-icon">{isDarkMode ? <MoonIcon /> : <SunIcon />}</span>
        <span>{t("account.darkMode")}</span>
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
        {showPetNewBadge ? <FeatureNewBadge /> : null}
        <span className="account-menu-toggle" data-on={isPetVisible} aria-hidden="true">
          <span className="account-menu-toggle__knob" />
        </span>
      </button>
      <div className="account-menu-separator" role="separator" />
      {showProfile ? (
        <button type="button" className="account-menu-item" onClick={onProfile} role="menuitem">
          <span className="account-menu-icon"><ProfileIcon /></span>
          <span>{t("account.myProfile")}</span>
        </button>
      ) : null}
      {isSignedIn && onInviteFriends ? (
        <button type="button" className="account-menu-item" onClick={onInviteFriends} role="menuitem">
          <span className="account-menu-icon"><InviteFriendsIcon /></span>
          <span>{t("account.inviteFriends")}</span>
        </button>
      ) : null}
      <button type="button" className="account-menu-item" onClick={onCheckForUpdates} role="menuitem">
        <span className="account-menu-icon"><UpdateIcon /></span>
        <span>{t("account.checkForUpdates")}</span>
      </button>
      <button type="button" className="account-menu-item" onClick={onFeedback} role="menuitem">
        <span className="account-menu-icon"><FeedbackIcon /></span>
        <span>{t("account.sendFeedback")}</span>
      </button>
      {/* The tracker block's fill sets it apart from the items above and
          from Log out, so it stands in for the separator there (owner
          choice, 2026-10-07). Without it, Log out keeps its separator. */}
      {trackerBlock}
      {isSignedIn ? (
        <>
          {trackerBlock ? null : <div className="account-menu-separator" role="separator" />}
          <button type="button" className="account-menu-item account-menu-item--danger" onClick={onSignOut} role="menuitem">
            <span className="account-menu-icon"><LogoutIcon /></span>
            <span>{t("account.logOut")}</span>
          </button>
        </>
      ) : (
        <>
          {trackerBlock ? null : <div className="account-menu-separator" role="separator" />}
          <button type="button" className="account-menu-item" onClick={onSignIn} role="menuitem">
            <span className="account-menu-icon"><SignInIcon /></span>
            <span>{t("account.signIn")}</span>
          </button>
        </>
      )}
    </div>
    ) : null}</AnchoredPresence>,
    document.body,
  );

  // The closed row keeps the account's plain layout. Paused and broken
  // tracking speak through the sidebar card above it; the avatar badge stands
  // in only where that card is hidden. A recording tracker never marks the
  // row: a green avatar dot reads as "online".
  const rowAttention = tracker?.markRow ? tracker.attention : null;
  const attentionText = rowAttention === "setup"
    ? t("tracker.setupNeededShort")
    : rowAttention === "attention"
      ? t("tracker.needsAttentionShort")
      : rowAttention === "paused"
        ? t("tracker.pausedShort")
        : null;
  // The badge's words describe the button; its name stays the account name.
  const attentionId = useId();

  return (
    <div className="account-menu-shell">
      {popover}
      <button
        ref={triggerRef}
        type="button"
        className="account-trigger"
        onClick={onToggle}
        aria-label={triggerLabel}
        aria-describedby={attentionText ? attentionId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {rowAttention && tracker ? (
          <span className="account-avatar-wrap">
            {avatarMark}
            <TrackerStatusMark state={tracker.state} attention={rowAttention} className="account-avatar-status" />
          </span>
        ) : avatarMark}
        <span className="account-trigger__copy">
          <strong>{displayName}</strong>
          {attentionText ? (
            <span id={attentionId} className="sr-only account-trigger__attention" data-attention={rowAttention ?? undefined}>
              {attentionText}
            </span>
          ) : null}
        </span>
        <span className="account-trigger__chevrons" aria-hidden="true">
          <span className="account-trigger__chevron-mark account-trigger__chevron-mark--up" />
          <span className="account-trigger__chevron-mark account-trigger__chevron-mark--down" />
        </span>
      </button>
    </div>
  );
}
