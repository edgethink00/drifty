import {
  CATEGORY_ORDER,
  PRODUCTIVITY_ORDER,
  classifyActivityDetailed,
  isRemoteDeviceSegment,
  type ActivityCategory,
  type ActivitySegment,
  type AppIconMap,
  type ClassificationOptions,
  type ProductivityLabel,
} from "@drifty/domain";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type SVGProps } from "react";
import { createPortal } from "react-dom";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import { getViewportSafeHoverPosition } from "../../components/hoverCardPosition";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";

const INSPECTOR_WIDTH_PX = 332;

type InspectorView = "overview" | "classification" | "delete";

export type ActivityInspectorEvent = {
  readonly id: string;
  readonly segmentIds: readonly string[];
  readonly appName: string;
  readonly category: ActivityCategory;
  readonly productivity: ProductivityLabel;
  readonly startLabel: string;
  readonly endLabel: string;
  readonly identities: readonly {
    readonly id: string;
    readonly label: string;
    readonly appName: string;
    readonly bundleId: string | null;
    readonly siteDomain: string | null;
  }[];
  readonly hasMixedCategory: boolean;
  readonly hasMixedProductivity: boolean;
};

type WeekActivityInspectorProps = {
  readonly event: ActivityInspectorEvent;
  readonly segments: readonly ActivitySegment[];
  readonly appIcons: AppIconMap;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly pointer: { readonly x: number; readonly y: number };
  readonly fallbackRect?: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;
  readonly actionsDisabledReason?: string | null;
  readonly classificationOptions?: ClassificationOptions;
  readonly onClose: () => void;
  readonly onClassify?: (
    segments: readonly ActivitySegment[],
    category: ActivityCategory,
    productivity: ProductivityLabel,
  ) => Promise<void>;
  readonly onDelete?: (segmentIds: readonly string[]) => Promise<void>;
};

const iconProps: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

function CloseIcon() {
  return <svg {...iconProps}><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></svg>;
}

function ChevronIcon({ direction = "right" }: { readonly direction?: "left" | "right" }) {
  return <svg {...iconProps}><path d={direction === "left" ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6"} /></svg>;
}

function EditIcon() {
  return <svg {...iconProps}><path d="M4.5 19.5h3.2L18.2 9a2.2 2.2 0 0 0-3.1-3.1L4.5 16.4v3.1Z" /><path d="m13.8 7.2 3.1 3.1" /></svg>;
}

function TrashIcon() {
  return <svg {...iconProps}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12h9.4l.8-12M10 10.5v5M14 10.5v5" /></svg>;
}

function hasUsablePointer(pointer: WeekActivityInspectorProps["pointer"]): boolean {
  return Number.isFinite(pointer.x) && Number.isFinite(pointer.y) && (pointer.x !== 0 || pointer.y !== 0);
}

function inspectorAnchor(pointer: WeekActivityInspectorProps["pointer"], fallbackRect?: WeekActivityInspectorProps["fallbackRect"]): { readonly x: number; readonly y: number } {
  if (hasUsablePointer(pointer)) return pointer;
  if (!fallbackRect) return pointer;
  return {
    x: fallbackRect.left + Math.min(16, fallbackRect.width / 2),
    y: fallbackRect.top + Math.min(16, fallbackRect.height / 2),
  };
}

function inspectorPosition(pointer: WeekActivityInspectorProps["pointer"], fallbackRect: WeekActivityInspectorProps["fallbackRect"], measuredHeight: number): CSSProperties {
  const height = measuredHeight > 0 ? measuredHeight : Math.min(280, (typeof window === "undefined" ? 280 : window.innerHeight) - 32);
  const anchor = inspectorAnchor(pointer, fallbackRect);
  const position = getViewportSafeHoverPosition(anchor.x, anchor.y, INSPECTOR_WIDTH_PX, height);
  return { left: position.left, top: position.top, width: INSPECTOR_WIDTH_PX };
}

function sourceLabel(
  segments: readonly ActivitySegment[],
  t: LocalizationController["t"],
  deviceLabelById?: ReadonlyMap<string, string>,
): string {
  const labels = new Set(segments.map((segment) => (
    isRemoteDeviceSegment(segment)
      ? deviceLabelById?.get(segment.deviceId ?? "") ?? t("dashboard.week.inspector.syncedMac")
      : t("dashboard.week.inspector.thisMac")
  )));
  if (labels.size === 0) return t("dashboard.week.inspector.sourceUnavailable");
  return labels.size === 1 ? Array.from(labels)[0] : t("dashboard.week.inspector.devices", { count: labels.size });
}

function recordCountLabel(count: number, t: LocalizationController["t"]): string {
  return count === 1
    ? t("dashboard.week.inspector.record")
    : t("dashboard.week.inspector.records", { count });
}

function mixedClassificationLabels(
  event: ActivityInspectorEvent,
  segments: readonly ActivitySegment[],
  classificationOptions?: ClassificationOptions,
): { readonly hasMixedCategory: boolean; readonly hasMixedProductivity: boolean } {
  if (segments.length === 0) {
    return {
      hasMixedCategory: event.hasMixedCategory,
      hasMixedProductivity: event.hasMixedProductivity,
    };
  }
  const categories = new Set<ActivityCategory>();
  const productivities = new Set<ProductivityLabel>();
  for (const segment of segments) {
    const classification = classifyActivityDetailed(segment, classificationOptions);
    categories.add(classification.category);
    productivities.add(classification.productivity);
  }
  return {
    hasMixedCategory: categories.size > 1,
    hasMixedProductivity: productivities.size > 1,
  };
}

export function WeekActivityInspector({
  event,
  segments,
  appIcons,
  deviceLabelById,
  pointer,
  fallbackRect,
  actionsDisabledReason = null,
  classificationOptions,
  onClose,
  onClassify,
  onDelete,
}: WeekActivityInspectorProps) {
  const { t } = useLocalization();
  const [view, setView] = useState<InspectorView>("overview");
  const [category, setCategory] = useState<ActivityCategory>(event.category);
  const [productivity, setProductivity] = useState<ProductivityLabel>(event.productivity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const style = useMemo(() => inspectorPosition(pointer, fallbackRect, measuredHeight), [fallbackRect, measuredHeight, pointer]);
  const count = segments.length;
  const canMutate = !actionsDisabledReason && count > 0;
  const mixed = useMemo(
    () => mixedClassificationLabels(event, segments, classificationOptions),
    [classificationOptions, event, segments],
  );
  const hasClassificationChange = category !== event.category || productivity !== event.productivity;
  const primaryIdentity = event.identities[0] ?? null;
  const iconSrc = primaryIdentity
    ? appIcons[primaryIdentity.bundleId ?? primaryIdentity.appName] ?? appIcons[primaryIdentity.appName] ?? null
    : null;

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useLayoutEffect(() => {
    const node = inspectorRef.current;
    if (!node) return;
    const nextHeight = Math.round(node.getBoundingClientRect().height);
    setMeasuredHeight((current) => current === nextHeight ? current : nextHeight);
  }, [actionsDisabledReason, count, error, event.appName, event.endLabel, event.startLabel, mixed.hasMixedCategory, mixed.hasMixedProductivity, view]);

  useEffect(() => {
    if (view === "classification") {
      inspectorRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
      return;
    }
    if (view === "delete") {
      inspectorRef.current?.querySelector<HTMLButtonElement>(".week-activity-inspector__footer .app-btn--secondary")?.focus();
      return;
    }
    inspectorRef.current?.focus();
  }, [view]);

  useEffect(() => {
    const handlePointerDown = (pointerEvent: PointerEvent) => {
      if (busy || !(pointerEvent.target instanceof Node) || inspectorRef.current?.contains(pointerEvent.target)) return;
      onClose();
    };
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape" || busy) return;
      keyEvent.preventDefault();
      onClose();
    };
    const handleViewportChange = (viewportEvent: Event) => {
      if (busy) return;
      if (viewportEvent.type === "scroll" && inspectorRef.current?.contains(viewportEvent.target as Node)) return;
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [busy, onClose]);

  const saveClassification = async () => {
    if (!canMutate || !hasClassificationChange || !onClassify || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onClassify(segments, category, productivity);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("dashboard.week.inspector.saveError"));
      setBusy(false);
    }
  };

  const deleteActivity = async () => {
    if (!canMutate || !onDelete || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(event.segmentIds);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("dashboard.week.inspector.deleteError"));
      setBusy(false);
    }
  };

  const title = view === "classification"
    ? t("dashboard.week.inspector.editTitle")
    : view === "delete"
      ? t("dashboard.week.inspector.deleteTitle")
      : event.appName;

  return createPortal(
    <div
      ref={inspectorRef}
      className="week-activity-inspector"
      style={style}
      role="dialog"
      aria-modal="false"
      tabIndex={-1}
      aria-labelledby="week-activity-inspector-title"
      aria-describedby="week-activity-inspector-description"
      data-view={view}
    >
      <header className="week-activity-inspector__header">
        {view === "overview" ? (
          <span className="week-activity-inspector__identity" aria-hidden="true">
            {primaryIdentity?.siteDomain
              ? <SiteFavicon domain={primaryIdentity.siteDomain} size={20} fallbackIconSrc={iconSrc} />
              : <AppGlyph appName={primaryIdentity?.label ?? event.appName} iconSrc={iconSrc} size="sm" />}
          </span>
        ) : (
          <button
            type="button"
            className="week-activity-inspector__icon-button"
            aria-label={t("dashboard.week.inspector.back")}
            onClick={() => {
              setError(null);
              setView("overview");
            }}
            disabled={busy}
          >
            <ChevronIcon direction="left" />
          </button>
        )}
        <div className="week-activity-inspector__heading">
          <strong id="week-activity-inspector-title">{title}</strong>
          <span>{event.startLabel}–{event.endLabel}</span>
        </div>
        <button
          type="button"
          className="week-activity-inspector__icon-button"
          aria-label={t("dashboard.week.inspector.close")}
          onClick={close}
          disabled={busy}
        >
          <CloseIcon />
        </button>
      </header>

      {view === "overview" ? (
        <>
          <div className="week-activity-inspector__summary" id="week-activity-inspector-description">
            <div>
              <span>{t("common.category")}</span>
              <strong><i style={{ background: CATEGORY_COLORS[event.category] }} />{localizedCategoryLabel(event.category, t)}{mixed.hasMixedCategory ? ` (${t("dashboard.week.inspector.dominant")})` : ""}</strong>
            </div>
            <div>
              <span>{t("common.productivity")}</span>
              <strong><i style={{ background: PRODUCTIVITY_COLORS[event.productivity] }} />{localizedProductivityLabel(event.productivity, t)}{mixed.hasMixedProductivity ? ` (${t("dashboard.week.inspector.dominant")})` : ""}</strong>
            </div>
            <div>
              <span>{t("common.source")}</span>
              <strong>{sourceLabel(segments, t, deviceLabelById)}</strong>
            </div>
            <div>
              <span>{t("common.scope")}</span>
              <strong>{recordCountLabel(count, t)}</strong>
            </div>
          </div>

          {actionsDisabledReason ? (
            <p className="week-activity-inspector__notice" role="note">{actionsDisabledReason}</p>
          ) : null}

          <div className="week-activity-inspector__actions">
            <button
              type="button"
              className="week-activity-inspector__action"
              onClick={() => setView("classification")}
              disabled={!canMutate || !onClassify}
            >
              <span className="week-activity-inspector__action-icon"><EditIcon /></span>
              <span><strong>{t("dashboard.week.inspector.edit")}</strong></span>
              <ChevronIcon />
            </button>
            <button
              type="button"
              className="week-activity-inspector__action week-activity-inspector__action--danger"
              onClick={() => setView("delete")}
              disabled={!canMutate || !onDelete}
            >
              <span className="week-activity-inspector__action-icon"><TrashIcon /></span>
              <span><strong>{t("dashboard.week.inspector.delete")}</strong></span>
              <ChevronIcon />
            </button>
          </div>
        </>
      ) : null}

      {view === "classification" ? (
        <div className="week-activity-inspector__editor" id="week-activity-inspector-description">
          <fieldset>
            <legend>{t("common.category")}</legend>
            <div className="week-activity-inspector__choice-grid">
              {CATEGORY_ORDER.filter((option) => option !== "unknown").map((option) => (
                <label key={option} className={category === option ? "is-selected" : undefined}>
                  <input
                    type="radio"
                    name="week-activity-category"
                    value={option}
                    checked={category === option}
                    onChange={() => setCategory(option)}
                    disabled={busy}
                  />
                  <i style={{ background: CATEGORY_COLORS[option] }} />
                  <span>{localizedCategoryLabel(option, t)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t("common.productivity")}</legend>
            <div className="week-activity-inspector__choice-grid week-activity-inspector__choice-grid--productivity">
              {PRODUCTIVITY_ORDER.map((option) => (
                <label key={option} className={productivity === option ? "is-selected" : undefined}>
                  <input
                    type="radio"
                    name="week-activity-productivity"
                    value={option}
                    checked={productivity === option}
                    onChange={() => setProductivity(option)}
                    disabled={busy}
                  />
                  <i style={{ background: PRODUCTIVITY_COLORS[option] }} />
                  <span>{localizedProductivityLabel(option, t)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error ? <p className="week-activity-inspector__error" role="alert">{error}</p> : null}
          <footer className="week-activity-inspector__footer">
            <button type="button" className="app-btn app-btn--secondary" onClick={() => setView("overview")} disabled={busy}>{t("common.cancel")}</button>
            <button type="button" className="app-btn app-btn--primary" onClick={() => void saveClassification()} disabled={!hasClassificationChange || busy}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </footer>
        </div>
      ) : null}

      {view === "delete" ? (
        <div className="week-activity-inspector__confirmation" id="week-activity-inspector-description">
          <div className="week-activity-inspector__danger-mark" aria-hidden="true"><TrashIcon /></div>
          <p>{t("dashboard.week.inspector.deleteWarning", { records: recordCountLabel(count, t) })}</p>
          {error ? <p className="week-activity-inspector__error" role="alert">{error}</p> : null}
          <footer className="week-activity-inspector__footer">
            <button type="button" className="app-btn app-btn--secondary" onClick={() => setView("overview")} disabled={busy}>{t("common.cancel")}</button>
            <button type="button" className="app-btn app-btn--danger" onClick={() => void deleteActivity()} disabled={busy}>
              {busy
                ? t("common.deleting")
                : count === 1
                  ? t("dashboard.week.inspector.deleteRecord")
                  : t("dashboard.week.inspector.deleteRecords", { count })}
            </button>
          </footer>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
