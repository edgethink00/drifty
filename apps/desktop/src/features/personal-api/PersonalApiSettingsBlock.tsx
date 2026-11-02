import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { AnchoredPresence } from "../../components/AnchoredPresence";
import { ModalPresence } from "../../components/ModalPresence";
import { localeForDisplayLanguage } from "../../lib/formatting";
import { canStartCloudTrial, canStartIndividualCheckout } from "../billing/billingEligibility";
import type { BillingEntitlement } from "../billing/billingService";
import { DeviceSyncSetupModal } from "../device-sync/DeviceSyncSetupModal";
import { formatDeviceRelativeTime } from "../device-sync/deviceSyncSummary";
import { useLocalization } from "../localization/LocalizationContext";
import { PersonalApiKeyDeleteDialog } from "./PersonalApiKeyDeleteDialog";
import { PersonalApiKeyDialog } from "./PersonalApiKeyDialog";
import { PersonalApiSyncNotice, type PersonalApiSyncNoticeState } from "./PersonalApiSyncNotice";
import {
  createPersonalApiKeysClient,
  PERSONAL_API_DOCS_URL,
  PERSONAL_API_KEY_LIMIT,
  type PersonalApiKey,
  type PersonalApiKeysClient,
} from "./personalApiKeysClient";
// Keys are listed in the row grammar of Settings › Sync › Your devices.
import "../cloud-devices/CloudDeviceManagementPanel.css";
import "./personalApi.css";

export type PersonalApiSettingsBlockProps = {
  /** The signed-in full account; null while signed out or as a guest. */
  readonly accountId: string | null;
  /** The account's plan; null until it has been read. */
  readonly billingEntitlement: BillingEntitlement | null;
  /** Set when the plan could not be read, so the block can say why New key waits. */
  readonly billingEntitlementError?: string | null;
  readonly onSignIn?: () => void;
  /** Opens the one Pro decision sheet, as Sync's switch does. */
  readonly onUpgradeToPro?: () => void;
  /** Whether this computer sends its records to the cloud copy the API reads. */
  readonly deviceSyncEnabled: boolean;
  /** Whether Sync's consent dialog may turn sync on for this computer right now. */
  readonly deviceSyncCanEnable?: boolean;
  /**
   * Turns this computer's sync on after the person agrees in Sync's consent
   * dialog; resolves whether it is on. Absent where sync is not offered.
   */
  readonly onEnableDeviceSync?: () => Promise<boolean> | boolean;
  /**
   * Whether any computer on the account syncs, asked while this one does not.
   * With none, a key would have nothing to read, so New key turns sync on first.
   * A failed read blocks nothing.
   */
  readonly readAccountSyncing?: () => Promise<boolean>;
  readonly onOpenSyncSettings?: () => void;
  readonly client?: PersonalApiKeysClient;
  /** For tests and previews; defaults to the clock. */
  readonly now?: () => number;
};

type LoadState = "idle" | "loading" | "ready" | "error";
/** A turn-on started from this block: still running, or how it ended. */
type SyncEnableState = "idle" | "pending" | "enabled" | "failed";
type StatusTone = "ok" | "active" | "neutral" | "attention";
type KeyStatus = { readonly label: string; readonly tone: StatusTone; readonly inactive: boolean };

const SCOPE_ORDER = ["summary:read", "activity:read"] as const;
/** A key used within this long reads as in use (accent dot, relative time); older use is muted and dated. */
const RECENT_USE_MS = 7 * 86_400_000;
/** Relative times and expiry move on while Settings stays open. */
const CLOCK_REFRESH_MS = 60_000;
/** New key waits this long at most for the account's computer list, then blocks nothing. */
const ACCOUNT_SYNC_TIMEOUT_MS = 8_000;

/**
 * Settings › Agents, CLI & API › Drifty API (docs/architecture/personal-api.md).
 * A Pro account's keys for reading its synced cloud copy from the owner's own
 * server. The keys themselves live on the server; this lists, creates and
 * deletes them. One row says what the API is and offers the one action that
 * applies; the keys follow as Sync's device rows, each with its use and a
 * ⋯ menu. The address and the keep-it-on-a-server warning belong to the
 * moment a key is revealed, so they live in the new-key dialog and the guide.
 */
export function PersonalApiSettingsBlock({
  accountId,
  billingEntitlement,
  billingEntitlementError = null,
  onSignIn,
  onUpgradeToPro,
  deviceSyncEnabled,
  deviceSyncCanEnable = false,
  onEnableDeviceSync,
  readAccountSyncing,
  onOpenSyncSettings,
  client: providedClient,
  now = Date.now,
}: PersonalApiSettingsBlockProps): JSX.Element {
  const { t, effectiveLanguage } = useLocalization();
  const [client] = useState(() => providedClient ?? createPersonalApiKeysClient());
  const [keys, setKeys] = useState<readonly PersonalApiKey[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PersonalApiKey | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [syncConsentOpen, setSyncConsentOpen] = useState(false);
  const [syncEnable, setSyncEnable] = useState<SyncEnableState>("idle");
  // null until read, and after a failed read: unknown never blocks a key.
  const [accountSyncing, setAccountSyncing] = useState<boolean | null>(null);
  // While the list is read New key waits, so it never offers a key and then turns into "turn on sync first".
  const [accountSyncPending, setAccountSyncPending] = useState(false);
  const readAccountSyncingRef = useRef(readAccountSyncing);
  readAccountSyncingRef.current = readAccountSyncing;
  const accountSyncRun = useRef(0);
  // Set when the consent dialog was opened to make a key, so the key's dialog follows a successful turn-on.
  const createAfterSync = useRef(false);
  // New key keeps its name when sync must come first; the line beside it says why, also to screen readers.
  const syncNoticeId = useId();
  const [, setClockTick] = useState(0);
  const loadRun = useRef(0);
  const blockRef = useRef<HTMLDivElement>(null);
  // Where the deleted row stood, so focus can move to its neighbour instead of the page.
  const refocusAfterDelete = useRef<number | null>(null);

  const load = useCallback(async () => {
    const run = ++loadRun.current;
    if (!accountId) {
      setKeys([]);
      setLoadState("idle");
      return;
    }
    setLoadState("loading");
    try {
      const next = await client.list(accountId);
      if (run !== loadRun.current) return;
      setKeys(next);
      setLoadState("ready");
    } catch {
      if (run !== loadRun.current) return;
      setLoadState("error");
    }
  }, [accountId, client]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), CLOCK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  // A failure is forgotten once sync is on, however it got there; a success once it is off again.
  useEffect(() => {
    setSyncEnable((current) => (deviceSyncEnabled ? current === "failed" : current === "enabled") ? "idle" : current);
  }, [deviceSyncEnabled]);

  // The deleted row's ⋯ button is gone, so the closing dialog has nothing to
  // return focus to. Hand it to the row that took its place, else to the top
  // row's action (New key, or Upgrade on an ended plan), else to the guide link.
  useEffect(() => {
    const index = refocusAfterDelete.current;
    if (index === null) return;
    refocusAfterDelete.current = null;
    const block = blockRef.current;
    if (!block) return;
    const menus = Array.from(block.querySelectorAll<HTMLButtonElement>(".cloud-device-row__more:not(:disabled)"));
    const target = menus[Math.min(index, menus.length - 1)]
      ?? block.querySelector<HTMLElement>(".personal-api__top button:not(:disabled)")
      ?? block.querySelector<HTMLElement>(".personal-api__docs");
    target?.focus({ preventScroll: true });
  }, [keys]);

  const locale = localeForDisplayLanguage(effectiveLanguage);
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }), [locale]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }), [locale]);
  const nowMs = now();
  // This year's dates drop the year, as the device list's dates do.
  const formatDate = (value: string) => {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return value;
    const sameYear = new Date(time).getFullYear() === new Date(nowMs).getFullYear();
    return (sameYear ? dayFormat : dateFormat).format(new Date(time));
  };

  const confirmDelete = async () => {
    if (!accountId || !pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await client.remove(accountId, pendingDelete.id);
      refocusAfterDelete.current = Math.max(0, keys.findIndex((key) => key.id === pendingDelete.id));
      setKeys((current) => current.filter((key) => key.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  };

  const enableSync = async () => {
    if (!onEnableDeviceSync) return;
    setSyncEnable("pending");
    let enabled = false;
    try {
      enabled = await onEnableDeviceSync();
    } catch {
      enabled = false;
    }
    setSyncEnable(enabled ? "enabled" : "failed");
    const thenCreate = createAfterSync.current;
    createAfterSync.current = false;
    if (enabled && thenCreate) setCreating(true);
  };

  // This computer being past the three-computer limit locks its own sync and
  // cloud AI only; the server lets the account's keys work while the account
  // has an active trial, Pro or an organization seat (withCloudDeviceAccess
  // marks the limit only on such an account).
  const deviceLimited = billingEntitlement !== null && (
    billingEntitlement.lockedReason === "device_limit_reached"
    || (billingEntitlement.deviceAccess?.allowed === false && billingEntitlement.deviceAccess.reason === "device_limit_reached")
  );
  const proAccess = billingEntitlement === null
    ? "unknown"
    : billingEntitlement.canUseApp || billingEntitlement.lockedReason === "device_limit_reached" ? "active" : "locked";
  const isPro = proAccess === "active";

  // Only needed while this computer does not sync: then whether the key has
  // anything to read depends on the account's other computers.
  const checkAccountSync = Boolean(accountId) && isPro && !deviceSyncEnabled && Boolean(readAccountSyncing);
  useEffect(() => {
    const run = ++accountSyncRun.current;
    setAccountSyncing(null);
    const read = readAccountSyncingRef.current;
    if (!checkAccountSync || !read) {
      setAccountSyncPending(false);
      return;
    }
    setAccountSyncPending(true);
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("account sync check timed out")), ACCOUNT_SYNC_TIMEOUT_MS);
    });
    const settle = (syncing: boolean | null) => {
      if (run !== accountSyncRun.current) return;
      setAccountSyncing(syncing);
      setAccountSyncPending(false);
    };
    Promise.race([read(), timeout]).then(settle, () => settle(null)).finally(() => window.clearTimeout(timer));
    return () => window.clearTimeout(timer);
  }, [checkAccountSync, accountId]);

  const upgradeAction = proAccess === "locked" && onUpgradeToPro && billingEntitlement
    && billingEntitlement.entitlementOwner !== "organization" && canStartIndividualCheckout(billingEntitlement)
    ? {
      label: canStartCloudTrial(billingEntitlement) ? t("billing.trialActivation.start") : t("billing.plan.proCta"),
      onClick: onUpgradeToPro,
    }
    : null;
  // No computer on the account syncs: a key would read nothing, so sync comes first.
  const needsSync = Boolean(accountId) && isPro && !deviceSyncEnabled && accountSyncing === false;
  const underKeyLimit = loadState === "ready" && keys.length < PERSONAL_API_KEY_LIMIT;
  const canCreate = Boolean(accountId) && isPro && underKeyLimit && !needsSync && !accountSyncPending;
  const hasKeys = keys.length > 0;
  const showEmptySlot = !hasKeys && Boolean(accountId) && isPro && loadState === "ready";
  const showList = hasKeys || showEmptySlot;
  // Whether this computer's records reach the API, said beside the keys and when a key is shown.
  const syncNotice: PersonalApiSyncNoticeState | null = !accountId || !isPro
    ? null
    : deviceLimited
      ? accountSyncing === false ? "none-limit" : "limit"
      : syncEnable === "pending"
        ? "turning-on"
        : !deviceSyncEnabled
          ? syncEnable === "failed"
            ? "failed"
            : accountSyncPending
              ? null
              : accountSyncing === false ? "none" : accountSyncing === true ? "off-others" : "off"
          : syncEnable === "enabled" ? "on-now" : null;
  const canTurnOnSync = Boolean(onEnableDeviceSync) && deviceSyncCanEnable;
  const openSyncConsent = canTurnOnSync
    ? () => {
      createAfterSync.current = false;
      setSyncConsentOpen(true);
    }
    : undefined;
  // When the main button already turns sync on, the line offers no second way; when it cannot, the line points to Sync.
  const syncFirst = needsSync && canTurnOnSync;
  const noticeTurnOn = needsSync ? undefined : openSyncConsent;
  const noticeOpenSync = syncFirst ? undefined : onOpenSyncSettings;

  let note: string | null = null;
  let action: JSX.Element | null = null;
  if (!accountId) {
    note = t("settings.developer.api.signInNeeded");
    action = onSignIn ? <button type="button" className="settings-btn" onClick={onSignIn}>{t("settings.account.signIn")}</button> : null;
  } else if (proAccess === "locked") {
    note = t("settings.developer.api.proNeeded");
    action = upgradeAction
      ? <button type="button" className="settings-btn settings-btn--primary" onClick={upgradeAction.onClick}>{upgradeAction.label}</button>
      : null;
  } else {
    if (proAccess === "unknown") {
      note = t(billingEntitlementError ? "settings.developer.api.planCheckFailed" : "settings.developer.api.planChecking");
    } else if (loadState === "ready" && keys.length >= PERSONAL_API_KEY_LIMIT) {
      // New key is disabled at the limit; say why here, since its dialog cannot open.
      note = t("settings.developer.api.dialog.errorLimit");
    } else if (accountSyncPending && loadState !== "loading") {
      // While the keys load, their own line already says New key is waiting.
      note = t("settings.developer.api.syncChecking");
    }
    // With no computer syncing, the same New key asks to turn sync on first and then opens the key's dialog.
    action = (
      <button
        type="button"
        className="settings-btn personal-api__new"
        disabled={syncFirst ? !underKeyLimit || syncEnable === "pending" : !canCreate}
        aria-describedby={syncFirst ? syncNoticeId : undefined}
        onClick={() => {
          if (syncFirst) {
            createAfterSync.current = true;
            setSyncConsentOpen(true);
            return;
          }
          // "Sync is on" belongs to a turn-on made with this key showing, not to one made earlier.
          setSyncEnable((current) => current === "enabled" ? "idle" : current);
          setCreating(true);
        }}
      >
        {PLUS_ICON}
        {t("settings.developer.api.create")}
      </button>
    );
  }

  const keyFacts = (key: PersonalApiKey, expired: boolean): string[] => {
    const scopes = SCOPE_ORDER.filter((scope) => key.scopes.includes(scope))
      .map((scope) => t(scope === "summary:read" ? "settings.developer.api.scopeSummary" : "settings.developer.api.scopeActivity"))
      .join(", ");
    const facts = [scopes, t("settings.developer.api.created", { date: formatDate(key.createdAt) })];
    // An expired key says so in its status; one that never expires says that, as GitHub's token list does.
    if (!expired) {
      facts.push(key.expiresAt === null
        ? t("settings.developer.api.noExpiry")
        : t("settings.developer.api.expires", { date: formatDate(key.expiresAt) }));
    }
    return facts;
  };

  const keyStatus = (key: PersonalApiKey, expired: boolean): KeyStatus => {
    if (expired) return { label: t("settings.developer.api.expired"), tone: "neutral", inactive: true };
    // The plan note and upgrade action above already say why; the row says what happened to the key.
    if (proAccess === "locked") return { label: t("settings.developer.api.paused"), tone: "attention", inactive: true };
    const usedAt = key.lastUsedAt ? Date.parse(key.lastUsedAt) : Number.NaN;
    if (!key.lastUsedAt || !Number.isFinite(usedAt)) return { label: t("settings.developer.api.neverUsed"), tone: "neutral", inactive: false };
    if (nowMs - usedAt < RECENT_USE_MS) {
      const when = formatDeviceRelativeTime(key.lastUsedAt, nowMs, effectiveLanguage) ?? formatDate(key.lastUsedAt);
      return { label: t("settings.developer.api.usedAgo", { time: when }), tone: "ok", inactive: false };
    }
    // Older use is a date, with its year when it is not this year's, so it never reads as recent.
    return { label: t("settings.developer.api.usedOn", { date: formatDate(key.lastUsedAt) }), tone: "active", inactive: false };
  };

  return (
    <>
      <div ref={blockRef} data-setting-id="settings.developer.api.title" className="settings-block personal-api">
        <h3>{t("settings.developer.api.title")}</h3>
        <div className={"settings-row settings-row--group-start personal-api__top" + (showList ? "" : " settings-row--group-end")}>
          <div>
            <div className="lbl settings-label-with-badge">
              {t("settings.developer.api.keysLabel")}
              <span className="status-badge">Pro</span>
            </div>
            <div className="desc">
              {t("settings.developer.api.description")}{" "}
              <a className="personal-api__docs" href={PERSONAL_API_DOCS_URL} target="_blank" rel="noreferrer">
                {t("settings.developer.api.docs")}
                {ARROW_ICON}
              </a>
            </div>
            {note ? <div className="desc personal-api__note">{note}</div> : null}
            {accountId && loadState === "loading" && !hasKeys ? (
              <div className="desc personal-api__note" role="status">{t("settings.developer.api.loading")}</div>
            ) : null}
            {loadState === "error" ? (
              <div className="desc developer-note developer-note--warn personal-api__error" role="alert">
                {t("settings.developer.api.loadError")}{" "}
                <button type="button" className="personal-api__inline-action" onClick={() => void load()}>{t("settings.developer.retry")}</button>
              </div>
            ) : null}
            {syncNotice && syncNotice !== "on-now" ? (
              <PersonalApiSyncNotice
                id={syncNoticeId}
                state={syncNotice}
                place="block"
                onTurnOnSync={noticeTurnOn}
                onOpenSyncSettings={noticeOpenSync}
              />
            ) : null}
          </div>
          {action ? <div className="ctrl settings-row__actions developer-row-actions">{action}</div> : null}
        </div>
        {showList ? (
          <div className="settings-row settings-row--group-end personal-api__list-row">
            <ul className="cloud-device-list" aria-label={t("settings.developer.api.keysLabel")}>
              {hasKeys ? keys.map((key) => {
                const expired = key.expiresAt !== null && Date.parse(key.expiresAt) <= nowMs;
                const status = keyStatus(key, expired);
                const facts = keyFacts(key, expired);
                const hint = "drifty_sk_…" + key.hint;
                return (
                  <li key={key.id} className={"cloud-device-row" + (status.inactive ? " is-inactive" : "")}>
                    <span className="cloud-device-row__copy">
                      <span className="cloud-device-row__name" title={key.name}>{key.name}</span>
                      {/* Each fact keeps its words together, so a wrapped line breaks only between facts. */}
                      <span className="cloud-device-row__meta">
                        <code className="personal-api__hint">{hint}</code>
                        {facts.map((fact) => (
                          <span key={fact}>{" "}<span className="personal-api__fact">{"· " + fact}</span></span>
                        ))}
                      </span>
                    </span>
                    <span className={"cloud-device-row__status cloud-device-row__status--" + status.tone}>
                      <span className="cloud-device-row__dot" aria-hidden="true" />
                      {status.label}
                    </span>
                    <PersonalApiKeyRowMenu
                      name={key.name}
                      hint={key.hint}
                      open={openMenuId === key.id}
                      disabled={deleting}
                      onOpenChange={(open) => setOpenMenuId(open ? key.id : null)}
                      onDelete={() => {
                        setDeleteFailed(false);
                        setPendingDelete(key);
                      }}
                    />
                  </li>
                );
              }) : (
                <li className="cloud-device-row personal-api__empty">
                  <span className="cloud-device-row__copy">
                    <span className="cloud-device-row__meta">{t("settings.developer.api.empty")}</span>
                  </span>
                </li>
              )}
            </ul>
          </div>
        ) : null}
      </div>
      <ModalPresence>
        {creating && accountId ? (
          <PersonalApiKeyDialog
            onCreate={async (input) => {
              const created = await client.create(accountId, input);
              setKeys((current) => [created.key, ...current.filter((key) => key.id !== created.key.id)]);
              return created;
            }}
            syncNotice={syncNotice}
            onTurnOnSync={openSyncConsent}
            onClose={() => {
              setCreating(false);
              // "Sync is on" answers the turn-on made while the key was shown; the block needs no such line.
              setSyncEnable((current) => current === "enabled" ? "idle" : current);
            }}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {pendingDelete ? (
          <PersonalApiKeyDeleteDialog
            name={pendingDelete.name}
            deleting={deleting}
            failed={deleteFailed}
            onCancel={() => {
              if (!deleting) setPendingDelete(null);
            }}
            onConfirm={() => void confirmDelete()}
          />
        ) : null}
      </ModalPresence>
      {/* Sync's own consent dialog, opened above a shown key without closing it. */}
      {onEnableDeviceSync ? (
        <DeviceSyncSetupModal
          mode={syncConsentOpen ? "enable" : null}
          canEnable={canTurnOnSync}
          onClose={() => {
            createAfterSync.current = false;
            setSyncConsentOpen(false);
          }}
          onEnable={() => {
            setSyncConsentOpen(false);
            void enableSync();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * A key row's ⋯ menu in the device row's look. Opened from the keyboard it
 * moves focus to its item; Escape and Tab close it and return to the button,
 * and a press outside closes it.
 */
function PersonalApiKeyRowMenu({
  name,
  hint,
  open,
  disabled,
  onOpenChange,
  onDelete,
}: {
  readonly name: string;
  readonly hint: string;
  readonly open: boolean;
  readonly disabled: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDelete: () => void;
}) {
  const { t } = useLocalization();
  const slot = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusItemOnOpen = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  // The last characters tell apart keys that share a name.
  const label = t("settings.developer.api.optionsAria", { name, hint });

  useEffect(() => {
    if (!open) return;
    if (focusItemOnOpen.current) {
      focusItemOnOpen.current = false;
      menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && slot.current?.contains(event.target)) return;
      onOpenChangeRef.current(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next: HTMLElement | undefined;
      switch (event.key) {
        case "Escape":
        case "Tab":
          // Settings has its own Escape; this one only closes the menu.
          event.preventDefault();
          event.stopPropagation();
          onOpenChangeRef.current(false);
          trigger.current?.focus({ preventScroll: true });
          return;
        case "ArrowDown":
          next = items[index < 0 ? 0 : (index + 1) % items.length];
          break;
        case "ArrowUp":
          next = items[index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length];
          break;
        case "Home":
          next = items[0];
          break;
        case "End":
          next = items[items.length - 1];
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      next?.focus({ preventScroll: true });
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) onOpenChangeRef.current(false);
  }, [disabled, open]);

  const toggle = (event: ReactMouseEvent<HTMLButtonElement>) => {
    // A click with no pointer press came from Enter or Space.
    focusItemOnOpen.current = !open && event.detail === 0;
    onOpenChange(!open);
  };

  return (
    <span className="cloud-device-row__menu-slot" ref={slot}>
      <button
        ref={trigger}
        type="button"
        className="cloud-device-row__more"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
      >
        {MORE_ICON}
      </button>
      <AnchoredPresence>{open ? (
        <div ref={menu} className="cloud-device-row__menu" role="menu" aria-label={label}>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={disabled}
            onClick={() => {
              // The menu closes with the choice, so focus returns to its persistent trigger.
              trigger.current?.focus({ preventScroll: true });
              onOpenChange(false);
              onDelete();
            }}
          >
            {t("settings.developer.api.deleteMenu")}
          </button>
        </div>
      ) : null}</AnchoredPresence>
    </span>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

const PLUS_ICON = <svg {...iconProps} strokeWidth={2}><path d="M12 5v14M5 12h14" /></svg>;
const ARROW_ICON = <svg {...iconProps} strokeWidth={2}><path d="M8 16 16 8M9.5 8H16v6.5" /></svg>;
const MORE_ICON = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.4" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.6" cy="12" r="1.7" /></svg>;
