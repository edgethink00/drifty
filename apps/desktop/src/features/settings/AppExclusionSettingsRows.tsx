import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  EXCLUDED_SITE_RULE_PREFIX,
  isExcludedSiteRule,
  normalizeExcludedSite,
  type AppIconMap,
  type ExcludedAppRule,
} from "@drifty/domain";
import { ActionLabel } from "../../components/ActionLabel";
import { AnchoredPresence } from "../../components/AnchoredPresence";
import { AppGlyph } from "../../components/AppGlyph";
import { ModalPresence } from "../../components/ModalPresence";
import { describeActionError, type DescribedActionError } from "../../lib/actionErrors";
import { mergeAppIconResults } from "../app-icons/appIconRequests";
import { trackerClient } from "../../lib/api/trackerClient";
import { useLocalization } from "../localization/LocalizationContext";
import { ExcludedAppHistoryConfirmation } from "./ExcludedAppHistoryConfirmation";
import "./AppExclusionSettingsRows.css";

type ItemKind = "app" | "site";

/** Something the add picker offers: a recently used app or a site already recorded. */
type Candidate = {
  readonly kind: ItemKind;
  readonly name: string;
  readonly bundleId: string | null;
};

const PICKER_GROUP_LIMIT = 10;

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
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

function kindOf(rule: ExcludedAppRule): ItemKind {
  return isExcludedSiteRule(rule) ? "site" : "app";
}

/** A site rule's past records are found by its domain; an app's by its name and bundle ID. */
function historyQuery(rule: ExcludedAppRule): { name: string; bundleId?: string | null; siteDomain?: string | null } {
  if (isExcludedSiteRule(rule)) return { name: rule.name, bundleId: null, siteDomain: rule.name };
  return { name: rule.name, bundleId: rule.bundleId };
}

/** Whether an excluded rule already covers a candidate of the same kind. */
function covers(rule: ExcludedAppRule, item: Candidate): boolean {
  if (kindOf(rule) !== item.kind) return false;
  if (item.kind === "site") return rule.name === item.name;
  if (rule.bundleId && item.bundleId) return rule.bundleId === item.bundleId;
  return rule.name.localeCompare(item.name, undefined, { sensitivity: "accent" }) === 0;
}

function compareName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * The "apps and sites not to record" setting: one label row whose items are
 * chips, and a search field beside the title that finds both. Apps and sites
 * are kept out of history the same way (time stays counted; names, titles and
 * addresses are not kept), so they share a list. Like Dayflow's, the search is
 * there from the start instead of behind an Add button; its candidates open
 * in a panel under it and leave the list in place. Text that names a site
 * (example.com or a pasted address) is added as that site; any other text as
 * an app name.
 */
export function ExclusionSettingsRows({ deviceSyncEnabled = false }: { readonly deviceSyncEnabled?: boolean } = {}) {
  const { t } = useLocalization();
  const pickerId = useId();
  const searchWrapRef = useRef<HTMLDivElement>(null);
  // Each item's chip, so focus has somewhere to go when the chip that held it
  // leaves the list, or when its menu and confirmation close.
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const searchRef = useRef<HTMLInputElement>(null);
  const [rules, setRules] = useState<ExcludedAppRule[]>([]);
  const [historyCounts, setHistoryCounts] = useState<Record<string, number>>({});
  const [appIcons, setAppIcons] = useState<AppIconMap>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerOpenRef = useRef(false);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  const [recentApps, setRecentApps] = useState<Candidate[]>([]);
  const [recentSiteItems, setRecentSiteItems] = useState<Candidate[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // The picker entry whose add request is in flight, and the one whose last
  // request failed. Both are keyed like the entries so the state shows on the
  // chip the user pressed.
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addErrorKey, setAddErrorKey] = useState<string | null>(null);
  const [rowPending, setRowPending] = useState<Record<string, "remove" | "delete" | "count">>({});
  const [rowErrors, setRowErrors] = useState<Record<string, "remove" | "delete" | "count">>({});
  const pendingRef = useRef(new Set<string>());
  const addingRef = useRef(false);
  // Set by a successful add; the search takes focus back once it is enabled again.
  const refocusSearchRef = useRef(false);
  const countVersionsRef = useRef(new Map<string, number>());
  const adding = addingKey !== null;
  // Deleting an item's past records asks first; the dialog owns its failure.
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

  async function refreshHistoryCount(rule: ExcludedAppRule) {
    if (!beginRowAction(rule.id, "count")) return;
    try {
      const { count } = await trackerClient.getExcludedAppHistoryCount(historyQuery(rule));
      setHistoryCounts((current) => ({ ...current, [rule.id]: count }));
    } catch {
      setRowErrors((current) => ({ ...current, [rule.id]: "count" }));
    } finally {
      finishRowAction(rule.id);
    }
  }

  async function loadRules() {
    try {
      const loaded = await trackerClient.getExcludedApps();
      setRules(loaded);
      // Only apps have icons to look up. A site's favicon is never fetched: an
      // uncached lookup would send the very address the user is hiding.
      const identities = loaded.filter((rule) => kindOf(rule) === "app").map((rule) => ({ appName: rule.name, bundleId: rule.bundleId }));
      if (identities.length > 0) {
        try {
          const icons = await trackerClient.getAppIcons(identities);
          setAppIcons((current) => mergeAppIconResults(current, identities, icons));
        } catch {
          // Ignore icon fetch error
        }
      }
      for (const rule of loaded) {
        const version = countVersionsRef.current.get(rule.id) ?? 0;
        trackerClient.getExcludedAppHistoryCount(historyQuery(rule)).then(({ count }) => {
          if ((countVersionsRef.current.get(rule.id) ?? 0) === version) {
            setHistoryCounts((prev) => ({ ...prev, [rule.id]: count }));
          }
        }).catch(() => {
          if ((countVersionsRef.current.get(rule.id) ?? 0) === version) {
            setRowErrors((current) => ({ ...current, [rule.id]: "count" }));
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
    // The list loads once when it opens.
    void loadRules();
  }, []);

  useEffect(() => {
    const identities = [
      ...rules.filter((rule) => kindOf(rule) === "app").map((rule) => ({ appName: rule.name, bundleId: rule.bundleId })),
      ...recentApps.map((app) => ({ appName: app.name, bundleId: app.bundleId })),
    ];
    if (identities.length === 0) return undefined;
    let cancelled = false;
    void trackerClient.getAppIcons(identities).then((icons) => {
      if (!cancelled) setAppIcons((current) => mergeAppIconResults(current, identities, icons));
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rules, recentApps]);

  async function openPicker() {
    if (pickerOpenRef.current) return;
    pickerOpenRef.current = true;
    setAddErrorKey(null);
    setPickerOpen(true);
    const [apps, sites] = await Promise.allSettled([trackerClient.getRecentApps({ limit: 50 }), recentSites()]);
    setRecentApps(apps.status === "fulfilled" ? apps.value.map((app) => ({ kind: "app" as const, name: app.name, bundleId: app.bundleId ?? null })) : []);
    setRecentSiteItems(sites.status === "fulfilled" ? sites.value : []);
    setCandidatesLoaded(true);
  }

  function closePicker() {
    pickerOpenRef.current = false;
    setPickerOpen(false);
    setSearch("");
    setAddErrorKey(null);
  }

  // The search keeps focus for the next one after an add. It is disabled while
  // the add runs, so focus waits for the render that enables it; WebKit can
  // paint a frame before that render. Focusing it does not reopen the panel.
  useEffect(() => {
    if (adding || !refocusSearchRef.current) return;
    refocusSearchRef.current = false;
    searchRef.current?.focus();
  }, [adding]);

  // The panel closes when the pointer or keyboard focus leaves the search and
  // its panel. Focus alone cannot tell: WebKit does not focus a clicked button.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const inside = (target: EventTarget | null) => target instanceof Node && Boolean(searchWrapRef.current?.contains(target));
    const handlePointerDown = (event: PointerEvent) => {
      if (!inside(event.target) && !addingRef.current) closePicker();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!inside(event.target) && !addingRef.current) closePicker();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [pickerOpen]);

  async function handleAdd(item: Candidate, entryKey: string) {
    const isSite = item.kind === "site";
    const name = isSite ? normalizeExcludedSite(item.name) ?? "" : item.name.trim();
    if (!name || addingRef.current) return;
    addingRef.current = true;
    setAddingKey(entryKey);
    setAddErrorKey(null);
    const id = isSite ? EXCLUDED_SITE_RULE_PREFIX + name : item.bundleId || name;
    const rule: ExcludedAppRule = { id, name, bundleId: isSite ? null : item.bundleId, source: "user", kind: item.kind };
    try {
      await trackerClient.saveExcludedApp(rule);
      setRules((prev) => [rule, ...prev.filter((existing) => existing.id !== id && !covers(existing, { kind: item.kind, name, bundleId: rule.bundleId ?? null }))]);
      closePicker();
      refocusSearchRef.current = true;
      // The rule is already saved. A count-query failure retries only the query.
      void refreshHistoryCount(rule);
    } catch {
      setAddErrorKey(entryKey);
    } finally {
      addingRef.current = false;
      setAddingKey(null);
    }
  }

  async function handleRemove(id: string) {
    const order = items.map((rule) => rule.id);
    const neighborId = order[order.indexOf(id) + 1] ?? order[order.indexOf(id) - 1] ?? null;
    const hadFocus = document.activeElement === chipRefs.current.get(id);
    if (!beginRowAction(id, "remove")) return;
    try {
      await trackerClient.deleteExcludedApp(id);
      countVersionsRef.current.set(id, (countVersionsRef.current.get(id) ?? 0) + 1);
      setRules((prev) => prev.filter((rule) => rule.id !== id));
      setHistoryCounts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      // The chip goes with the item; keep keyboard focus in the list.
      if (hadFocus || document.activeElement === document.body) {
        window.requestAnimationFrame(() => {
          const neighbor = neighborId ? chipRefs.current.get(neighborId) : undefined;
          if (neighbor) neighbor.focus();
          else searchRef.current?.focus();
        });
      }
    } catch {
      setRowErrors((current) => ({ ...current, [id]: "remove" }));
    } finally {
      finishRowAction(id);
    }
  }

  async function handleDeleteHistory(rule: ExcludedAppRule) {
    if (!beginRowAction(rule.id, "delete")) return;
    setHistoryConfirmError(null);
    try {
      await trackerClient.deleteExcludedAppHistory(historyQuery(rule));
      countVersionsRef.current.set(rule.id, (countVersionsRef.current.get(rule.id) ?? 0) + 1);
      setHistoryCounts((prev) => ({ ...prev, [rule.id]: 0 }));
      setHistoryConfirm(null);
      // The confirmation closes with the records, so focus returns to the
      // item's chip instead of falling to the page.
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active.closest('[role="dialog"]')) chipRefs.current.get(rule.id)?.focus();
      });
    } catch (failure) {
      setHistoryConfirmError(describeActionError(failure, t("settings.privacy.excludedAppsError.delete")));
    } finally {
      finishRowAction(rule.id);
    }
  }

  // Added items first, newest first; then the default apps that are installed here.
  const items = useMemo(() => {
    const userItems = rules.filter((rule) => rule.source === "user");
    const defaults = rules
      .filter((rule) => rule.source !== "user" && kindOf(rule) === "app")
      .filter((rule) => Boolean(appIcons[rule.bundleId?.trim() || rule.name] ?? appIcons[rule.name]))
      .slice()
      .sort((a, b) => compareName(a.name, b.name));
    return [...userItems, ...defaults];
  }, [rules, appIcons]);

  const query = search.trim();
  const queryLower = query.toLocaleLowerCase();
  // Text that names a site is a site; anything else is an app name.
  const typedDomain = normalizeExcludedSite(query);
  const typedItem: Candidate | null = query ? (typedDomain ? { kind: "site", name: typedDomain, bundleId: null } : { kind: "app", name: query, bundleId: null }) : null;
  const notExcluded = (item: Candidate) => !rules.some((rule) => covers(rule, item));
  const matches = (item: Candidate) => !queryLower || item.name.toLocaleLowerCase().includes(typedDomain ?? queryLower);
  const appMatches = recentApps.filter(notExcluded).filter(matches).slice(0, PICKER_GROUP_LIMIT);
  const siteMatches = recentSiteItems.filter(notExcluded).filter(matches).slice(0, PICKER_GROUP_LIMIT);
  const exactMatch = typedItem
    ? [...appMatches, ...siteMatches].find((item) => item.kind === typedItem.kind && item.name.toLocaleLowerCase() === typedItem.name.toLocaleLowerCase()) ?? null
    : null;
  const canAddTyped = pickerOpen && typedItem !== null && exactMatch === null && notExcluded(typedItem);
  const typedKey = typedItem ? `typed:${typedItem.kind}:${typedItem.name.toLocaleLowerCase()}` : "typed:";
  const hasCandidates = appMatches.length > 0 || siteMatches.length > 0 || canAddTyped;

  // Enter takes the entry the text plainly means: an exact match, else the only
  // match, else the text itself when nothing matches. With several matches it
  // waits for a pick, because "kakao" should not become an app of that name
  // while KakaoTalk is right there.
  function submitSearch() {
    if (!pickerOpen) {
      void openPicker();
      return;
    }
    const offered = [...appMatches, ...siteMatches];
    const pick = exactMatch ?? (offered.length === 1 ? offered[0] : null);
    if (pick) {
      void handleAdd(pick, pickerKey(pick));
      return;
    }
    if (offered.length === 0 && canAddTyped && typedItem) void handleAdd(typedItem, typedKey);
  }

  // Escape first clears the text, then closes the panel; either way focus stays in the search.
  function handleEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !pickerOpen || adding) return;
    event.stopPropagation();
    if (search && event.target === searchRef.current) {
      setSearch("");
      setAddErrorKey(null);
      return;
    }
    closePicker();
    searchRef.current?.focus();
  }

  function glyphFor(item: { kind: ItemKind; name: string; bundleId: string | null }) {
    return item.kind === "site"
      ? <ExcludedSiteGlyph domain={item.name} />
      : <AppGlyph appName={item.name} iconSrc={iconSrcFor(item, appIcons)} size="sm" />;
  }

  function pickerGroup(label: string, group: readonly Candidate[]) {
    if (group.length === 0) return null;
    return (
      <div className="excluded-apps-picker__group">
        <p className="excluded-apps-picker__label">{label}</p>
        <ul className="excluded-apps-chips" aria-label={label}>
          {group.map((item) => {
            const key = pickerKey(item);
            return (
              <li key={key}>
                <PickerChip busy={addingKey === key} disabled={adding} failed={addErrorKey === key} onPick={() => void handleAdd(item, key)}>
                  {glyphFor(item)}
                  <span className="excluded-apps-chip__name">{item.name}</span>
                </PickerChip>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <>
      <div className="settings-row excluded-apps-head" data-setting-id="settings.privacy.excludedApps" onKeyDown={handleEscape}>
        <div>
          <div className="lbl">{t("settings.privacy.excludedItemsTitle")}</div>
          <div className="desc">{t("settings.privacy.excludedItemsDesc")}</div>
          {deviceSyncEnabled ? <div className="desc">{t("settings.privacy.excludedAppsSyncOn")}</div> : null}
        </div>
        {!loading ? (
          <div ref={searchWrapRef} className="ctrl excluded-apps-search" onKeyDown={handleEscape}>
            <span className="excluded-apps-search__icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <input
              ref={searchRef}
              type="search"
              className="settings-input excluded-apps-search__input"
              value={search}
              disabled={adding}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("settings.privacy.excludedItemsSearch")}
              aria-label={t("settings.privacy.excludedItemsSearch")}
              aria-expanded={pickerOpen}
              aria-controls={pickerId}
              onClick={() => void openPicker()}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setAddErrorKey(null);
                void openPicker();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitSearch();
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  void openPicker();
                  window.requestAnimationFrame(() => searchWrapRef.current?.querySelector<HTMLButtonElement>(".excluded-apps-search__panel button:not(:disabled)")?.focus());
                }
              }}
            />
            <AnchoredPresence>{pickerOpen ? (
              <div id={pickerId} className="excluded-apps-picker excluded-apps-search__panel" role="region" aria-label={t("settings.privacy.excludedItemsPickerAria")}>
                {pickerGroup(t("settings.privacy.excludedItemsGroupApps"), appMatches)}
                {pickerGroup(t("settings.privacy.excludedItemsGroupSites"), siteMatches)}
                {canAddTyped && typedItem ? (
                  <ul className="excluded-apps-chips">
                    <li>
                      <PickerChip busy={addingKey === typedKey} disabled={adding} failed={addErrorKey === typedKey} onPick={() => void handleAdd(typedItem, typedKey)}>
                        <span className="excluded-apps-chip__add-glyph" aria-hidden="true">
                          <PlusIcon />
                        </span>
                        <span className="excluded-apps-chip__name">
                          {t(typedItem.kind === "site" ? "settings.privacy.excludedItemsAddSite" : "settings.privacy.excludedItemsAddApp", { name: typedItem.name })}
                        </span>
                      </PickerChip>
                    </li>
                  </ul>
                ) : null}
                {candidatesLoaded && !hasCandidates ? (
                  <p className="excluded-apps-empty">
                    {query ? t("settings.privacy.excludedItemsNoMatches") : t("settings.privacy.excludedItemsPickerEmpty")}
                  </p>
                ) : null}
                {addErrorKey ? <p className="excluded-apps-note" role="alert">{t("settings.privacy.excludedAppsAddError")}</p> : null}
              </div>
            ) : null}</AnchoredPresence>
          </div>
        ) : null}
        {!loading && items.length > 0 ? (
          <ul className="excluded-apps-chips" aria-label={t("settings.privacy.excludedItemsTitle")}>
            {items.map((rule) => {
              const count = historyCounts[rule.id] ?? 0;
              return (
                <li key={rule.id}>
                  <ExcludedChip
                    name={rule.name}
                    count={count}
                    icon={glyphFor({ kind: kindOf(rule), name: rule.name, bundleId: rule.bundleId ?? null })}
                    pastCountLabel={t("settings.privacy.excludedAppsPastCount", { count })}
                    removeLabel={t("settings.privacy.excludedAppsRemove")}
                    deletePastLabel={t("settings.privacy.excludedAppsDeletePastCount", { count })}
                    pending={rowPending[rule.id]}
                    chipRef={(button) => {
                      if (button) chipRefs.current.set(rule.id, button);
                      else chipRefs.current.delete(rule.id);
                    }}
                    onRemove={() => void handleRemove(rule.id)}
                    onDeleteHistory={() => {
                      setHistoryConfirmError(null);
                      setHistoryConfirm({ app: rule, count });
                    }}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
        {!loading && items.length === 0 ? (
          <p className="excluded-apps-empty">{t("settings.privacy.excludedItemsEmpty")}</p>
        ) : null}
        {!loading ? items.filter((rule) => rowErrors[rule.id]).map((rule) => (
          <p key={rule.id} className="excluded-apps-note" role="alert">
            <span>{t(`settings.privacy.excludedAppsError.${rowErrors[rule.id]}`)} · {rule.name}</span>
            {rowErrors[rule.id] === "count" ? (
              <button type="button" className="settings-btn excluded-apps-btn" disabled={Boolean(rowPending[rule.id])} aria-busy={rowPending[rule.id] === "count"} onClick={() => void refreshHistoryCount(rule)}>
                <ActionLabel busy={rowPending[rule.id] === "count"}>{t("common.retry")}</ActionLabel>
              </button>
            ) : null}
          </p>
        )) : null}
      </div>

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

/**
 * A lettered mark for a site in this list. It never looks the icon up, because
 * fetching an uncached favicon would send the very address the user is hiding.
 */
function ExcludedSiteGlyph({ domain }: { readonly domain: string }) {
  return (
    <span className="site-favicon site-favicon--fallback" style={{ width: 20, height: 20 }} aria-hidden="true">
      {domain[0]?.toUpperCase() ?? "•"}
    </span>
  );
}

/**
 * Sites already recorded on this computer, by time spent, to pick from. A
 * subdomain is left out when its parent is listed, because the parent's rule
 * already covers it.
 */
async function recentSites(): Promise<Candidate[]> {
  const candidates = await trackerClient.searchClassificationRuleCandidates({ query: "", targetKind: "site" });
  const seen = new Set<string>();
  const sites: Candidate[] = [];
  for (const candidate of candidates) {
    const domain = candidate.targetKind === "site" ? normalizeExcludedSite(candidate.targetValue) : null;
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    sites.push({ kind: "site", name: domain, bundleId: null });
  }
  return sites.filter((site) => !sites.some((other) => site.name.endsWith(`.${other.name}`)));
}

function pickerKey(item: Candidate): string {
  return `${item.kind}:${item.bundleId || item.name}`;
}

/**
 * One candidate in the add picker, shaped like the chips it becomes. Its
 * request state shows on the chip the user pressed: a spinner at the end while
 * saving, and a warning edge after a failure, with the message under the list.
 */
function PickerChip({
  busy,
  disabled,
  failed,
  onPick,
  children,
}: {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly failed: boolean;
  readonly onPick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button type="button" className="excluded-apps-chip" data-failed={failed || undefined} disabled={disabled} aria-busy={busy} onClick={onPick}>
      {children}
      {busy ? <span className="action-label__spinner excluded-apps-chip__spinner" aria-hidden="true" /> : null}
    </button>
  );
}

type ChipMenuPlacement = { readonly block: "below" | "above"; readonly inline: "start" | "end" };

const CHIP_MENU_GAP = 4;
const CHIP_MENU_MARGIN = 8;

const menuIconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function chipMenuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
}

/**
 * One excluded app or site. The whole chip opens a small menu, the same one
 * History rows use: Unblock, and, while past records remain, deleting them. A
 * count on the chip says when there is something left to delete. It carries no
 * ⋮ (owner decision 2026-10-16); the hover and open states mark it as a control.
 */
function ExcludedChip({
  name,
  count,
  icon,
  pastCountLabel,
  removeLabel,
  deletePastLabel,
  pending,
  chipRef,
  onRemove,
  onDeleteHistory,
}: {
  readonly name: string;
  readonly count: number;
  readonly icon: ReactNode;
  readonly pastCountLabel: string;
  readonly removeLabel: string;
  readonly deletePastLabel: string;
  readonly pending?: "remove" | "delete" | "count";
  readonly chipRef: (button: HTMLButtonElement | null) => void;
  readonly onRemove: () => void;
  readonly onDeleteHistory: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<ChipMenuPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Keyboard opening lands on an item; a pointer leaves focus on the chip.
  const focusOnOpen = useRef<"first" | "last" | null>(null);
  const busy = Boolean(pending);

  useEffect(() => {
    if (busy) setOpen(false);
  }, [busy]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const anchor = trigger.getBoundingClientRect();
    // offsetWidth and offsetHeight ignore the entry animation's scale.
    const roomBelow = window.innerHeight - anchor.bottom - CHIP_MENU_GAP - CHIP_MENU_MARGIN;
    const roomAbove = anchor.top - CHIP_MENU_GAP - CHIP_MENU_MARGIN;
    setPlacement({
      block: menu.offsetHeight > roomBelow && roomAbove > roomBelow ? "above" : "below",
      inline: anchor.left + menu.offsetWidth > window.innerWidth - CHIP_MENU_MARGIN ? "end" : "start",
    });
  }, [open]);

  useEffect(() => {
    if (!open || !placement || !focusOnOpen.current) return;
    const items = chipMenuItems(menuRef.current);
    (focusOnOpen.current === "first" ? items[0] : items[items.length - 1])?.focus({ preventScroll: true });
    focusOnOpen.current = null;
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      close();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const items = chipMenuItems(menuRef.current);
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next: HTMLElement | undefined;
      switch (event.key) {
        case "Escape":
        case "Tab":
          event.preventDefault();
          event.stopPropagation();
          close();
          triggerRef.current?.focus({ preventScroll: true });
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
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  // One highlight, like a native menu: the pointer moves focus along with it.
  const followPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true });
  };
  const releasePointerFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && menuRef.current?.contains(active)) active.blur();
  };

  // The chosen item leaves with the menu, so focus returns to the chip first;
  // the list and the confirmation then move it on from there.
  const choose = (action: () => void) => {
    triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
    action();
  };

  return (
    <>
      <button
        ref={(button) => {
          triggerRef.current = button;
          chipRef(button);
        }}
        type="button"
        className="excluded-apps-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        aria-busy={pending === "remove" || pending === "delete"}
        title={name.length > 32 ? name : undefined}
        onClick={(event) => {
          if (open) {
            setOpen(false);
            return;
          }
          // Enter and Space click with a detail of 0.
          focusOnOpen.current = event.detail === 0 ? "first" : null;
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          focusOnOpen.current = event.key === "ArrowDown" ? "first" : "last";
          setOpen(true);
        }}
      >
        {icon}
        <span className="excluded-apps-chip__name">{name}</span>
        {count > 0 ? <span className="excluded-apps-chip__count">{pastCountLabel}</span> : null}
        {pending === "remove" ? <span className="action-label__spinner excluded-apps-chip__spinner" aria-hidden="true" /> : null}
      </button>
      <AnchoredPresence>{open ? (
        <div
          ref={menuRef}
          className="excluded-apps-chip-menu"
          role="menu"
          aria-label={name}
          data-placement={placement?.block ?? "below"}
          data-align={placement?.inline ?? "start"}
          style={placement ? undefined : { visibility: "hidden" }}
          onPointerLeave={releasePointerFocus}
        >
          <button type="button" role="menuitem" tabIndex={-1} onPointerMove={followPointer} onClick={() => choose(onRemove)}>
            <svg {...menuIconProps}><rect x="3" y="7" width="10" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" /></svg>
            {removeLabel}
          </button>
          {count > 0 ? (
            <>
              <div className="excluded-apps-chip-menu__separator" role="separator" />
              <button type="button" role="menuitem" tabIndex={-1} className="danger" onPointerMove={followPointer} onClick={() => choose(onDeleteHistory)}>
                <svg {...menuIconProps}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" /></svg>
                {deletePastLabel}
              </button>
            </>
          ) : null}
        </div>
      ) : null}</AnchoredPresence>
    </>
  );
}
