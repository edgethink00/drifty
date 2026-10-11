import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AppIconMap, ExcludedAppRule } from "@drifty/domain";
import { ActionLabel } from "../../components/ActionLabel";
import { AppGlyph } from "../../components/AppGlyph";
import { ModalPresence } from "../../components/ModalPresence";
import { describeActionError, type DescribedActionError } from "../../lib/actionErrors";
import { mergeAppIconResults } from "../app-icons/appIconRequests";
import { trackerClient } from "../../lib/api/trackerClient";
import { useLocalization } from "../localization/LocalizationContext";
import { ExcludedAppHistoryConfirmation } from "./ExcludedAppHistoryConfirmation";
import "./AppExclusionSettingsRows.css";

type RecentAppItem = {
  readonly name: string;
  readonly bundleId: string | null;
  readonly lastSeenAt: string;
  readonly totalSeconds: number;
};

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function iconSrcFor(app: { name: string; bundleId?: string | null }, icons: AppIconMap): string | null {
  const key = app.bundleId?.trim() || app.name;
  return icons[key] ?? icons[app.name] ?? null;
}

function sameApp(
  a: { name: string; bundleId?: string | null },
  b: { name: string; bundleId?: string | null },
): boolean {
  if (a.bundleId && b.bundleId) return a.bundleId === b.bundleId;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "accent" }) === 0;
}

function compareName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * The rows of the "apps not to record" setting. They are direct children of a
 * `.settings-block`, so the list, the picker and the add button read as ordinary
 * settings rows instead of a card of their own.
 */
export function AppExclusionSettingsRows({ deviceSyncEnabled = false }: { readonly deviceSyncEnabled?: boolean } = {}) {
  const { t } = useLocalization();
  const pickerId = useId();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // Each row's Unblock button, so focus has somewhere to go when the control
  // that held it leaves the list (an unblocked row, a spent "Delete N records").
  const removeButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const searchRef = useRef<HTMLInputElement>(null);
  const [excludedApps, setExcludedApps] = useState<ExcludedAppRule[]>([]);
  const [historyCounts, setHistoryCounts] = useState<Record<string, number>>({});
  const [appIcons, setAppIcons] = useState<AppIconMap>({});
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [recentApps, setRecentApps] = useState<RecentAppItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // The picker entry whose add request is in flight, and the one whose last
  // request failed. Both are keyed like the entries so the state shows on the
  // row the user pressed.
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addErrorKey, setAddErrorKey] = useState<string | null>(null);
  const [rowPending, setRowPending] = useState<Record<string, "remove" | "delete" | "count">>({});
  const [rowErrors, setRowErrors] = useState<Record<string, "remove" | "delete" | "count">>({});
  const pendingRef = useRef(new Set<string>());
  const addingRef = useRef(false);
  const countVersionsRef = useRef(new Map<string, number>());
  const adding = addingKey !== null;
  // Deleting an app's past records asks first; the dialog owns its failure.
  const [historyConfirm, setHistoryConfirm] = useState<{ readonly app: ExcludedAppRule; readonly count: number } | null>(null);
  const [historyConfirmError, setHistoryConfirmError] = useState<DescribedActionError | null>(null);

  function clearRowError(id: string) {
    setRowErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function beginRowAction(id: string, action: "remove" | "delete" | "count") {
    if (pendingRef.current.has(id)) return false;
    pendingRef.current.add(id);
    if (action === "count") countVersionsRef.current.set(id, (countVersionsRef.current.get(id) ?? 0) + 1);
    setRowPending((current) => ({ ...current, [id]: action }));
    clearRowError(id);
    return true;
  }

  function finishRowAction(id: string) {
    pendingRef.current.delete(id);
    setRowPending((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function refreshHistoryCount(app: ExcludedAppRule) {
    if (!beginRowAction(app.id, "count")) return;
    try {
      const { count } = await trackerClient.getExcludedAppHistoryCount({ name: app.name, bundleId: app.bundleId });
      setHistoryCounts((current) => ({ ...current, [app.id]: count }));
    } catch {
      setRowErrors((current) => ({ ...current, [app.id]: "count" }));
    } finally {
      finishRowAction(app.id);
    }
  }

  async function loadApps() {
    try {
      const apps = await trackerClient.getExcludedApps();
      setExcludedApps(apps);
      const identities = apps.map((app) => ({ appName: app.name, bundleId: app.bundleId }));
      if (identities.length > 0) {
        try {
          const icons = await trackerClient.getAppIcons(identities);
          setAppIcons((current) => mergeAppIconResults(current, identities, icons));
        } catch {
          // Ignore icon fetch error
        }
      }
      for (const app of apps) {
        const version = countVersionsRef.current.get(app.id) ?? 0;
        trackerClient.getExcludedAppHistoryCount({ name: app.name, bundleId: app.bundleId }).then(({ count }) => {
          if ((countVersionsRef.current.get(app.id) ?? 0) === version) {
            setHistoryCounts((prev) => ({ ...prev, [app.id]: count }));
          }
        }).catch(() => {
          if ((countVersionsRef.current.get(app.id) ?? 0) === version) {
            setRowErrors((current) => ({ ...current, [app.id]: "count" }));
          }
        });
      }
    } catch {
      // Keep the empty list if the tracker is unavailable.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadApps();
  }, []);

  useEffect(() => {
    const identities = [
      ...excludedApps.map((app) => ({ appName: app.name, bundleId: app.bundleId })),
      ...recentApps.map((app) => ({ appName: app.name, bundleId: app.bundleId })),
    ];
    if (identities.length === 0) return;
    let cancelled = false;
    void trackerClient.getAppIcons(identities).then((icons) => {
      if (!cancelled) setAppIcons((current) => mergeAppIconResults(current, identities, icons));
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [excludedApps, recentApps]);

  async function handleOpenAddPanel() {
    setAddErrorKey(null);
    setSearch("");
    setAddPanelOpen(true);
    try {
      const recents = await trackerClient.getRecentApps({ limit: 50 });
      setRecentApps(recents);
    } catch {
      setRecentApps([]);
    }
  }

  function handleCloseAddPanel() {
    setAddPanelOpen(false);
    setSearch("");
    window.requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  useEffect(() => {
    if (addPanelOpen) searchRef.current?.focus();
  }, [addPanelOpen]);

  async function handleAddApp(name: string, bundleId?: string | null, entryKey?: string) {
    const trimmed = name.trim();
    if (!trimmed || addingRef.current) return;
    addingRef.current = true;
    const key = entryKey ?? pickerKey({ name: trimmed, bundleId });
    setAddingKey(key);
    setAddErrorKey(null);
    const id = bundleId || trimmed;
    const newRule: ExcludedAppRule = {
      id,
      name: trimmed,
      bundleId: bundleId ?? null,
      source: "user",
    };
    try {
      await trackerClient.saveExcludedApp(newRule);
      setExcludedApps((prev) => [newRule, ...prev.filter((app) => app.id !== id && !sameApp(app, newRule))]);
      handleCloseAddPanel();
      // The rule is already saved. A count-query failure retries only the query.
      void refreshHistoryCount(newRule);
    } catch {
      setAddErrorKey(key);
    } finally {
      addingRef.current = false;
      setAddingKey(null);
    }
  }

  async function handleRemoveApp(id: string) {
    const order = visibleApps.map((app) => app.id);
    const neighborId = order[order.indexOf(id) + 1] ?? order[order.indexOf(id) - 1] ?? null;
    const hadFocus = document.activeElement === removeButtonsRef.current.get(id);
    if (!beginRowAction(id, "remove")) return;
    try {
      await trackerClient.deleteExcludedApp(id);
      countVersionsRef.current.set(id, (countVersionsRef.current.get(id) ?? 0) + 1);
      setExcludedApps((prev) => prev.filter((app) => app.id !== id));
      setHistoryCounts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      // The row goes with its button; keep keyboard focus in the list.
      if (hadFocus || document.activeElement === document.body) {
        window.requestAnimationFrame(() => {
          const neighbor = neighborId ? removeButtonsRef.current.get(neighborId) : undefined;
          if (neighbor) neighbor.focus();
          else addButtonRef.current?.focus();
        });
      }
    } catch {
      setRowErrors((current) => ({ ...current, [id]: "remove" }));
    } finally {
      finishRowAction(id);
    }
  }

  async function handleDeleteHistory(app: ExcludedAppRule) {
    if (!beginRowAction(app.id, "delete")) return;
    setHistoryConfirmError(null);
    try {
      await trackerClient.deleteExcludedAppHistory({ name: app.name, bundleId: app.bundleId });
      countVersionsRef.current.set(app.id, (countVersionsRef.current.get(app.id) ?? 0) + 1);
      setHistoryCounts((prev) => ({ ...prev, [app.id]: 0 }));
      setHistoryConfirm(null);
      // The button that opened the confirmation is gone with the records, so
      // focus moves to the same row's Unblock instead of falling to the page.
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active.closest('[role="dialog"]')) removeButtonsRef.current.get(app.id)?.focus();
      });
    } catch (failure) {
      setHistoryConfirmError(describeActionError(failure, t("settings.privacy.excludedAppsError.delete")));
    } finally {
      finishRowAction(app.id);
    }
  }

  const query = search.trim();
  const queryLower = query.toLocaleLowerCase();

  const sortedApps = useMemo(() => {
    const installed = excludedApps.filter((app) => {
      if (app.source === "user") return true;
      const key = app.bundleId?.trim() || app.name;
      return Boolean(appIcons[key] ?? appIcons[app.name]);
    });
    const userApps = installed.filter((app) => app.source === "user");
    const defaultApps = installed
      .filter((app) => app.source !== "user")
      .slice()
      .sort((a, b) => compareName(a.name, b.name));
    return [...userApps, ...defaultApps];
  }, [excludedApps, appIcons]);

  const visibleApps = sortedApps.filter((app) => !queryLower || app.name.toLocaleLowerCase().includes(queryLower));
  const availableRecent = recentApps.filter((item) => !excludedApps.some((app) => sameApp(app, item)));
  const filteredRecent = availableRecent.filter((item) => !queryLower || item.name.toLocaleLowerCase().includes(queryLower));
  const exactMatch = filteredRecent.some((item) => item.name.toLocaleLowerCase() === queryLower)
    || excludedApps.some((app) => app.name.toLocaleLowerCase() === queryLower);
  const canAddTyped = addPanelOpen && query.length > 0 && !exactMatch;
  const showSearch = addPanelOpen || sortedApps.length > 8 || query.length > 0;
  const typedKey = `typed:${queryLower}`;

  function submitSearch() {
    if (!addPanelOpen) return;
    if (filteredRecent.length === 1 && !canAddTyped) {
      const only = filteredRecent[0];
      if (only) void handleAddApp(only.name, only.bundleId, pickerKey(only));
      return;
    }
    const exactRecent = filteredRecent.find((item) => item.name.toLocaleLowerCase() === queryLower);
    if (exactRecent) {
      void handleAddApp(exactRecent.name, exactRecent.bundleId, pickerKey(exactRecent));
      return;
    }
    if (canAddTyped) void handleAddApp(query, null, typedKey);
  }

  function handleEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && addPanelOpen) {
      event.stopPropagation();
      if (!adding) handleCloseAddPanel();
    }
  }

  return (
    <>
      <div className="settings-row" data-setting-id="settings.privacy.excludedApps" onKeyDown={handleEscape}>
        <div>
          <div className="lbl">{t("settings.privacy.excludedAppsTitle")}</div>
          <div className="desc">
            {t("settings.privacy.excludedAppsSubtitle")} {t("settings.privacy.excludedAppsDesc")}
          </div>
          {deviceSyncEnabled ? <div className="desc">{t("settings.privacy.excludedAppsSyncOn")}</div> : null}
        </div>
        {!loading ? (
          <div className="ctrl">
            {addPanelOpen ? (
              <button type="button" className="settings-btn" disabled={adding} onClick={handleCloseAddPanel}>
                {t("settings.privacy.excludedAppsCancel")}
              </button>
            ) : (
              <button
                ref={addButtonRef}
                type="button"
                className="settings-btn excluded-apps-add"
                aria-expanded={false}
                aria-controls={pickerId}
                onClick={() => void handleOpenAddPanel()}
              >
                <PlusIcon />
                {t("settings.privacy.excludedAppsAdd")}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {!loading && showSearch ? (
        <div className="settings-row excluded-apps-find" onKeyDown={handleEscape}>
          <div className="excluded-apps-find__bar">
            <input
              ref={searchRef}
              type="search"
              className="settings-input excluded-apps-find__search"
              value={search}
              disabled={adding}
              autoComplete="off"
              spellCheck={false}
              placeholder={t(addPanelOpen ? "settings.privacy.excludedAppsSearchAdd" : "settings.privacy.excludedAppsSearch")}
              aria-label={t(addPanelOpen ? "settings.privacy.excludedAppsSearchAdd" : "settings.privacy.excludedAppsSearch")}
              aria-controls={pickerId}
              onChange={(event) => { setSearch(event.currentTarget.value); setAddErrorKey(null); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitSearch();
                }
              }}
            />
            {canAddTyped ? (
              <button type="button" disabled={adding} aria-busy={addingKey === typedKey} className="settings-btn settings-btn--primary excluded-apps-btn" onClick={submitSearch}>
                <ActionLabel busy={addingKey === typedKey}>{t("settings.privacy.excludedAppsCustomSubmit")}</ActionLabel>
              </button>
            ) : null}
          </div>
          {addPanelOpen ? (
            <div id={pickerId} role="region" aria-label={t("settings.privacy.excludedAppsPickerAria")}>
              {filteredRecent.length > 0 || canAddTyped ? (
                <ul className="excluded-apps-list">
                  {filteredRecent.slice(0, 15).map((item) => {
                    const key = pickerKey(item);
                    return (
                      <li key={key} className="excluded-apps-item">
                        <PickerEntry
                          busy={addingKey === key}
                          disabled={adding}
                          error={addErrorKey === key ? t("settings.privacy.excludedAppsAddError") : null}
                          onPick={() => void handleAddApp(item.name, item.bundleId, key)}
                        >
                          <AppGlyph appName={item.name} iconSrc={iconSrcFor(item, appIcons)} size="sm" />
                          <span className="excluded-apps-item__name">{item.name}</span>
                        </PickerEntry>
                      </li>
                    );
                  })}
                  {canAddTyped ? (
                    <li className="excluded-apps-item">
                      <PickerEntry
                        busy={addingKey === typedKey}
                        disabled={adding}
                        error={addErrorKey === typedKey ? t("settings.privacy.excludedAppsAddError") : null}
                        onPick={() => void handleAddApp(query, null, typedKey)}
                      >
                        <span className="excluded-apps-item__add-glyph" aria-hidden="true">
                          <PlusIcon />
                        </span>
                        <span className="excluded-apps-item__name">{t("settings.privacy.excludedAppsAddNamed", { name: query })}</span>
                      </PickerEntry>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="excluded-apps-empty">
                  {query ? t("settings.privacy.excludedAppsNoMatches") : t("settings.privacy.excludedAppsNoRecent")}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && !addPanelOpen
        ? visibleApps.map((app) => (
            <ExcludedAppRow
              key={app.id}
              app={app}
              count={historyCounts[app.id] ?? 0}
              iconSrc={iconSrcFor(app, appIcons)}
              removeLabel={t("settings.privacy.excludedAppsRemove")}
              removeNamed={t("settings.privacy.excludedAppsRemoveNamed", { name: app.name })}
              deletePastCount={t("settings.privacy.excludedAppsDeletePastCount", { count: historyCounts[app.id] ?? 0 })}
              pending={rowPending[app.id]}
              error={rowErrors[app.id] ? t(`settings.privacy.excludedAppsError.${rowErrors[app.id]}`) : null}
              retryCountLabel={rowErrors[app.id] === "count" ? t("common.retry") : null}
              onRetryCount={() => void refreshHistoryCount(app)}
              removeButtonRef={(button) => {
                if (button) removeButtonsRef.current.set(app.id, button);
                else removeButtonsRef.current.delete(app.id);
              }}
              onRemove={() => void handleRemoveApp(app.id)}
              onDeleteHistory={() => {
                setHistoryConfirmError(null);
                setHistoryConfirm({ app, count: historyCounts[app.id] ?? 0 });
              }}
            />
          ))
        : null}

      {!loading && !addPanelOpen && visibleApps.length === 0 ? (
        <div className="settings-row excluded-apps-row">
          <div className="desc">
            {query ? t("settings.privacy.excludedAppsNoMatches") : t("settings.privacy.excludedAppsEmpty")}
          </div>
        </div>
      ) : null}

      <ModalPresence>
        {historyConfirm ? (
          <ExcludedAppHistoryConfirmation
            appName={historyConfirm.app.name}
            count={historyConfirm.count}
            deleting={rowPending[historyConfirm.app.id] === "delete"}
            error={historyConfirmError}
            onCancel={() => setHistoryConfirm(null)}
            onConfirm={() => void handleDeleteHistory(historyConfirm.app)}
          />
        ) : null}
      </ModalPresence>
    </>
  );
}

function pickerKey(item: { name: string; bundleId?: string | null }): string {
  return item.bundleId || item.name;
}

/**
 * One candidate in the add picker. Its request state shows on the entry the
 * user pressed: a spinner at the end while saving, and the failure text in the
 * same place afterwards, so the list keeps its height either way.
 */
function PickerEntry({
  busy,
  disabled,
  error,
  onPick,
  children,
}: {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onPick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <>
      <button type="button" className="excluded-apps-item__pick" disabled={disabled} aria-busy={busy} onClick={onPick}>
        <span className="excluded-apps-item__identity">{children}</span>
        {busy ? <span className="action-label__spinner excluded-apps-item__spinner" aria-hidden="true" /> : null}
      </button>
      {error ? <span className="excluded-apps-item__note excluded-apps-item__note--error" role="alert">{error}</span> : null}
    </>
  );
}

function ExcludedAppRow({
  app,
  count,
  iconSrc,
  removeLabel,
  removeNamed,
  deletePastCount,
  onRemove,
  onDeleteHistory,
  pending,
  error,
  retryCountLabel,
  onRetryCount,
  removeButtonRef,
}: {
  readonly app: ExcludedAppRule;
  readonly count: number;
  readonly iconSrc: string | null;
  readonly removeLabel: string;
  readonly removeNamed: string;
  readonly deletePastCount: string;
  readonly onRemove: () => void;
  readonly onDeleteHistory: () => void;
  readonly pending?: "remove" | "delete" | "count";
  readonly error: string | null;
  readonly retryCountLabel: string | null;
  readonly onRetryCount: () => void;
  readonly removeButtonRef: (button: HTMLButtonElement | null) => void;
}) {
  return (
    <div className="settings-row excluded-apps-row">
      <div>
        <div className="excluded-apps-item__identity">
          <AppGlyph appName={app.name} iconSrc={iconSrc} size="sm" />
          <span className="excluded-apps-item__name">{app.name}</span>
        </div>
      </div>
      <div className="ctrl excluded-apps-item__actions">
        {error ? <span className="excluded-apps-item__note excluded-apps-item__note--error" role="alert">{error}</span> : null}
        {retryCountLabel ? (
          <button type="button" className="settings-btn excluded-apps-btn" disabled={Boolean(pending)} aria-busy={pending === "count"} onClick={onRetryCount}>
            <ActionLabel busy={pending === "count"}>{retryCountLabel}</ActionLabel>
          </button>
        ) : null}
        {count > 0 ? (
          <button type="button" disabled={Boolean(pending)} aria-busy={pending === "delete"} className="excluded-apps-item__history" onClick={onDeleteHistory}>
            <ActionLabel busy={pending === "delete"}>{deletePastCount}</ActionLabel>
          </button>
        ) : null}
        <button ref={removeButtonRef} type="button" disabled={Boolean(pending)} aria-busy={pending === "remove"} className="settings-btn excluded-apps-btn" onClick={onRemove} aria-label={removeNamed}>
          <ActionLabel busy={pending === "remove"}>{removeLabel}</ActionLabel>
        </button>
      </div>
    </div>
  );
}
