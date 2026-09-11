import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AppIconMap, ExcludedAppRule } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { mergeAppIconResults } from "../app-icons/appIconRequests";
import { trackerClient } from "../../lib/api/trackerClient";
import { useLocalization } from "../localization/LocalizationContext";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";
import "./AppExclusionSettingsCard.css";

type RecentAppItem = {
  readonly name: string;
  readonly bundleId: string | null;
  readonly lastSeenAt: string;
  readonly totalSeconds: number;
};

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.7 10.7a3 3 0 0 0 4.1 4.1" />
      <path d="M9.9 5.2A11 11 0 0 1 12 5c6 0 9.5 7 9.5 7a13 13 0 0 1-2.2 3" />
      <path d="M6.6 6.7A13 13 0 0 0 2.5 12S6 19 12 19a10 10 0 0 0 3.9-.8" />
    </svg>
  );
}

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

export function AppExclusionSettingsCard() {
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
        trackerClient.getExcludedAppHistoryCount({ name: app.name, bundleId: app.bundleId }).then(({ count }) => {
          if (count > 0) {
            setHistoryCounts((prev) => ({ ...prev, [app.id]: count }));
          }
        }).catch(() => {});
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
    if (!trimmed) return;
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
      const { count } = await trackerClient.getExcludedAppHistoryCount({ name: trimmed, bundleId });
      if (count > 0) {
        setHistoryCounts((prev) => ({ ...prev, [id]: count }));
      }
    } catch (error) {
      console.error("Failed to exclude app", error);
    }
  }

  async function handleRemoveApp(id: string) {
    try {
      await trackerClient.deleteExcludedApp(id);
      setExcludedApps((prev) => prev.filter((app) => app.id !== id));
      setHistoryCounts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      console.error("Failed to unblock app", error);
    }
  }

  async function handleDeleteHistory(app: ExcludedAppRule) {
    try {
      await trackerClient.deleteExcludedAppHistory({ name: app.name, bundleId: app.bundleId });
      setHistoryCounts((prev) => ({ ...prev, [app.id]: 0 }));
    } catch (error) {
      console.error("Failed to delete excluded app history", error);
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

  const summary = loading
    ? undefined
    : (
      <span className="chip gray">
        {t("settings.privacy.excludedAppsCount", { count: sortedApps.length })}
      </span>
    );

  return (
    <SettingsCollapsibleCard
      searchReveal="privacy-excluded-apps"
      settingId="settings.privacy.excludedApps"
      leading={<EyeOffIcon />}
      subtitle={t("settings.privacy.excludedAppsSubtitle")}
      summary={summary}
      title={t("settings.privacy.excludedAppsTitle")}
    >
      <div
        className="excluded-apps-card"
        onKeyDown={(event) => {
          if (event.key === "Escape" && addPanelOpen) {
            event.stopPropagation();
            handleCloseAddPanel();
          }
        }}
      >
        <p className="excluded-apps-card__desc">{t("settings.privacy.excludedAppsDesc")}</p>

        {!loading ? (
          <>
            <div className="excluded-apps-toolbar">
              {showSearch ? (
                <input
                  ref={searchRef}
                  type="search"
                  className="settings-input excluded-apps-toolbar__search"
                  value={search}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t(addPanelOpen ? "settings.privacy.excludedAppsSearchAdd" : "settings.privacy.excludedAppsSearch")}
                  aria-label={t(addPanelOpen ? "settings.privacy.excludedAppsSearchAdd" : "settings.privacy.excludedAppsSearch")}
                  aria-controls={pickerId}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitSearch();
                    }
                  }}
                />
              ) : <span />}
              {addPanelOpen ? (
                <div className="excluded-apps-toolbar__btn-group">
                  {canAddTyped ? (
                    <button
                      type="button"
                      className="settings-btn settings-btn--primary excluded-apps-toolbar__action"
                      onClick={submitSearch}
                    >
                      {t("settings.privacy.excludedAppsCustomSubmit")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="settings-btn excluded-apps-toolbar__action"
                    onClick={handleCloseAddPanel}
                  >
                    {t("settings.privacy.excludedAppsCancel")}
                  </button>
                </div>
              ) : (
                <button
                  ref={addButtonRef}
                  type="button"
                  className="settings-btn excluded-apps-toolbar__action excluded-apps-toolbar__add"
                  aria-expanded={false}
                  aria-controls={pickerId}
                  onClick={() => void handleOpenAddPanel()}
                >
                  <PlusIcon />
                  {t("settings.privacy.excludedAppsAdd")}
                </button>
              )}
            </div>

            <div
              id={pickerId}
              className="excluded-apps-shell"
              role="region"
              aria-label={t(addPanelOpen ? "settings.privacy.excludedAppsPickerAria" : "settings.privacy.excludedAppsListAria")}
            >
              {addPanelOpen ? (
                filteredRecent.length > 0 || canAddTyped ? (
                  <ul className="excluded-apps-list">
                    {filteredRecent.slice(0, 15).map((item) => (
                      <li key={item.bundleId || item.name} className="excluded-apps-item">
                        <button
                          type="button"
                          className="excluded-apps-item__pick"
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
                        <button
                          type="button"
                          className="excluded-apps-item__pick"
                          onClick={() => void handleAddApp(query)}
                        >
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
                  <p className="excluded-apps-shell__empty">
                    {query ? t("settings.privacy.excludedAppsNoMatches") : t("settings.privacy.excludedAppsNoRecent")}
                  </p>
                )
              ) : visibleApps.length > 0 ? (
                <ul className="excluded-apps-list">
                  {visibleApps.map((app) => (
                    <ExcludedAppRow
                      key={app.id}
                      app={app}
                      count={historyCounts[app.id] ?? 0}
                      iconSrc={iconSrcFor(app, appIcons)}
                      removeLabel={t("settings.privacy.excludedAppsRemove")}
                      removeNamed={t("settings.privacy.excludedAppsRemoveNamed", { name: app.name })}
                      deletePastCount={t("settings.privacy.excludedAppsDeletePastCount", { count: historyCounts[app.id] ?? 0 })}
                      onRemove={() => void handleRemoveApp(app.id)}
                      onDeleteHistory={() => void handleDeleteHistory(app)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="excluded-apps-shell__empty">
                  {query ? t("settings.privacy.excludedAppsNoMatches") : t("settings.privacy.excludedAppsEmpty")}
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>
    </SettingsCollapsibleCard>
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
}: {
  readonly app: ExcludedAppRule;
  readonly count: number;
  readonly iconSrc: string | null;
  readonly removeLabel: string;
  readonly removeNamed: string;
  readonly deletePastCount: string;
  readonly onRemove: () => void;
  readonly onDeleteHistory: () => void;
}) {
  return (
    <li className="excluded-apps-item">
      <div className="excluded-apps-item__identity">
        <AppGlyph appName={app.name} iconSrc={iconSrc} size="sm" />
        <span className="excluded-apps-item__name">{app.name}</span>
      </div>
      <div className="excluded-apps-item__actions">
        {count > 0 ? (
          <button type="button" className="excluded-apps-item__history" onClick={onDeleteHistory}>
            {deletePastCount}
          </button>
        ) : null}
        <button type="button" className="settings-btn excluded-apps-item__unblock" onClick={onRemove} aria-label={removeNamed}>
          {removeLabel}
        </button>
      </div>
    </li>
  );
}
