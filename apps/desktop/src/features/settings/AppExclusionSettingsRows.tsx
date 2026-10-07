import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AppIconMap, ExcludedAppRule } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { mergeAppIconResults } from "../app-icons/appIconRequests";
import { trackerClient } from "../../lib/api/trackerClient";
import { useLocalization } from "../localization/LocalizationContext";
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
  const searchRef = useRef<HTMLInputElement>(null);
  const [excludedApps, setExcludedApps] = useState<ExcludedAppRule[]>([]);
  const [historyCounts, setHistoryCounts] = useState<Record<string, number>>({});
  const [appIcons, setAppIcons] = useState<AppIconMap>({});
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [recentApps, setRecentApps] = useState<RecentAppItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(false);
  const [rowPending, setRowPending] = useState<Record<string, "remove" | "delete" | "count">>({});
  const [rowErrors, setRowErrors] = useState<Record<string, "remove" | "delete" | "count">>({});
  const pendingRef = useRef(new Set<string>());
  const addingRef = useRef(false);
  const countVersionsRef = useRef(new Map<string, number>());

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
    setAddError(false);
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

  async function handleAddApp(name: string, bundleId?: string | null) {
    const trimmed = name.trim();
    if (!trimmed || addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    setAddError(false);
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
      setAddError(true);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  async function handleRemoveApp(id: string) {
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
    } catch {
      setRowErrors((current) => ({ ...current, [id]: "remove" }));
    } finally {
      finishRowAction(id);
    }
  }

  async function handleDeleteHistory(app: ExcludedAppRule) {
    if (!beginRowAction(app.id, "delete")) return;
    try {
      await trackerClient.deleteExcludedAppHistory({ name: app.name, bundleId: app.bundleId });
      countVersionsRef.current.set(app.id, (countVersionsRef.current.get(app.id) ?? 0) + 1);
      setHistoryCounts((prev) => ({ ...prev, [app.id]: 0 }));
    } catch {
      setRowErrors((current) => ({ ...current, [app.id]: "delete" }));
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

  function submitSearch() {
    if (!addPanelOpen) return;
    if (filteredRecent.length === 1 && !canAddTyped) {
      const only = filteredRecent[0];
      if (only) void handleAddApp(only.name, only.bundleId);
      return;
    }
    const exactRecent = filteredRecent.find((item) => item.name.toLocaleLowerCase() === queryLower);
    if (exactRecent) {
      void handleAddApp(exactRecent.name, exactRecent.bundleId);
      return;
    }
    if (canAddTyped) void handleAddApp(query);
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
              onChange={(event) => { setSearch(event.currentTarget.value); setAddError(false); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitSearch();
                }
              }}
            />
            {canAddTyped ? (
              <button type="button" disabled={adding} aria-busy={adding} className="settings-btn settings-btn--primary excluded-apps-btn" onClick={submitSearch}>
                {t("settings.privacy.excludedAppsCustomSubmit")}
              </button>
            ) : null}
          </div>
          {adding ? <span className="desc" role="status">{t("settings.privacy.excludedAppsAdding")}</span> : null}
          {addError ? <p className="excluded-apps-error" role="alert">{t("settings.privacy.excludedAppsAddError")}</p> : null}
          {addPanelOpen ? (
            <div id={pickerId} role="region" aria-label={t("settings.privacy.excludedAppsPickerAria")}>
              {filteredRecent.length > 0 || canAddTyped ? (
                <ul className="excluded-apps-list">
                  {filteredRecent.slice(0, 15).map((item) => (
                    <li key={item.bundleId || item.name} className="excluded-apps-item">
                      <button
                        type="button"
                        className="excluded-apps-item__pick"
                        disabled={adding}
                        aria-busy={adding}
                        onClick={() => void handleAddApp(item.name, item.bundleId)}
                      >
                        <span className="excluded-apps-item__identity">
                          <AppGlyph appName={item.name} iconSrc={iconSrcFor(item, appIcons)} size="sm" />
                          <span className="excluded-apps-item__name">{item.name}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {canAddTyped ? (
                    <li className="excluded-apps-item">
                      <button type="button" disabled={adding} aria-busy={adding} className="excluded-apps-item__pick" onClick={() => void handleAddApp(query)}>
                        <span className="excluded-apps-item__identity">
                          <span className="excluded-apps-item__add-glyph" aria-hidden="true">
                            <PlusIcon />
                          </span>
                          <span className="excluded-apps-item__name">{t("settings.privacy.excludedAppsAddNamed", { name: query })}</span>
                        </span>
                      </button>
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
              pendingLabel={rowPending[app.id] ? t(`settings.privacy.excludedAppsPending.${rowPending[app.id]}`) : ""}
              error={rowErrors[app.id] ? t(`settings.privacy.excludedAppsError.${rowErrors[app.id]}`) : null}
              retryCountLabel={rowErrors[app.id] === "count" ? t("common.retry") : null}
              onRetryCount={() => void refreshHistoryCount(app)}
              onRemove={() => void handleRemoveApp(app.id)}
              onDeleteHistory={() => void handleDeleteHistory(app)}
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
  pendingLabel,
  error,
  retryCountLabel,
  onRetryCount,
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
  readonly pendingLabel: string;
  readonly error: string | null;
  readonly retryCountLabel: string | null;
  readonly onRetryCount: () => void;
}) {
  return (
    <div className="settings-row excluded-apps-row">
      <div>
        <div className="excluded-apps-item__identity">
          <AppGlyph appName={app.name} iconSrc={iconSrc} size="sm" />
          <span className="excluded-apps-item__name">{app.name}</span>
        </div>
        {error ? <p className="excluded-apps-error" role="alert">{error}</p> : null}
      </div>
      <div className="ctrl excluded-apps-item__actions">
        {pending ? <span className="desc" role="status">{pendingLabel}</span> : null}
        {retryCountLabel ? <button type="button" className="settings-btn excluded-apps-btn" disabled={Boolean(pending)} onClick={onRetryCount}>{retryCountLabel}</button> : null}
        {count > 0 ? (
          <button type="button" disabled={Boolean(pending)} aria-busy={pending === "delete"} className="excluded-apps-item__history" onClick={onDeleteHistory}>
            {deletePastCount}
          </button>
        ) : null}
        <button type="button" disabled={Boolean(pending)} aria-busy={pending === "remove"} className="settings-btn excluded-apps-btn" onClick={onRemove} aria-label={removeNamed}>
          {removeLabel}
        </button>
      </div>
    </div>
  );
}
