import {
  activityTimeBounds,
  classifyActivityDetailed,
  isRemoteDeviceSegment,
  type ActivityCardDetailIdentity,
  type ActivityCardDetailRun,
  type ActivityCategory,
  type ActivitySegment,
  type AppIconMap,
  type ClassificationOptions,
  type ExclusionSource,
  type ProductivityLabel,
} from "@drifty/domain";
import { useCategoryChoices, useProductivityChoices, useDeletedCategories } from "../settings/categoryCustomizationStore";
import type { CategoryEditorTarget } from "../categories/categoryEditorModel";
import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type SVGProps,
} from "react";
import { createPortal } from "react-dom";
import { AppGlyph } from "../../components/AppGlyph";
import { getViewportSafeAnchoredPosition, isAnchorOutsideViewport } from "../../components/anchoredCardPosition";
import { SiteFavicon } from "../../components/SiteFavicon";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDayLabel } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedExcludedIdentityLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import type { DisplayLanguage } from "../localization/languagePreference";
import { buildActivityDevices, type ActivityDeviceSource } from "../device-sync/deviceTimelineLabels";
import { DeviceSourceIcon } from "../device-sync/DeviceSourceIcon";
import { describeActionError, type DescribedActionError } from "../../lib/actionErrors";
import { ActionLabel } from "../../components/ActionLabel";
import { ActivityLabelRow } from "../activity-labels/ActivityLabelCard";
import type { ActivityInspectorLabel } from "../activity-labels/activityInspectorLabel";
import { activityEvidenceSelectionForStretch, type ActivityEvidenceSelection } from "../screen-context/activityEvidenceSelection";
import { localeForDisplayLanguage } from "../../lib/formatting";
import { ScreenEvidenceContext } from "../screen-context/ScreenEvidenceContext";
import { ActivityScreenEvidenceModal } from "../screen-context/ActivityScreenEvidenceModal";
import { ActivityScreenPreview, type ScreenReplaySeek, type ScreenReplayState } from "../screen-context/ActivityScreenPreview";
import { SCREEN_PREVIEW_MODE } from "../screen-context/screenRecordingVariant";
import { useActivityInspection, type ActivityLogStretch } from "./ActivityInspectionContext";
import { ActivityPanelFooter } from "./ActivityPanelFooter";
import { useActivityDeleteStyle } from "./activityDeleteStyle";
import { ActivityDetailLog, ActivityLogMeta } from "./ActivityDetailLog";
import "./activity-inspection.css";

const INSPECTOR_WIDTH_PX = 304;
const MAX_VISIBLE_ACTIVITY_ROWS = 4;
const PICKER_VIEWPORT_INSET_PX = 12;
const PICKER_TRIGGER_GAP_PX = 4;

export type ActivityInspectorAttribute = "project" | "category" | "productivity";
export type ActivityInspectorView = "overview" | ActivityInspectorAttribute | "delete";

export type ActivityInspectorSegmentValues = {
  readonly segment: ActivitySegment;
  readonly projectId: string | null;
  readonly category: ActivityCategory;
  readonly productivity: ProductivityLabel;
};

export type ActivityInspectorSaveHandler = (
  field: ActivityInspectorAttribute,
  values: readonly ActivityInspectorSegmentValues[],
) => Promise<void>;

export type ActivityInspectorProjectOption = {
  readonly id: string | null;
  readonly name: string;
  readonly color: string;
};

export type ActivityInspectorEvent = {
  readonly screenEvidenceSelection?: ActivityEvidenceSelection | null;
  readonly screenEvidenceOptions?: readonly {
    readonly id: string;
    readonly label: string;
    readonly selection: ActivityEvidenceSelection;
  }[];
  readonly id: string;
  readonly day?: string;
  readonly surface?: "flow" | "week";
  readonly segmentIds: readonly string[];
  readonly appName: string;
  readonly projectId?: string | null;
  readonly projectName?: string | null;
  readonly projectColor?: string | null;
  readonly projectAssignments?: readonly {
    readonly segmentId: string;
    readonly projectId: string | null;
  }[];
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
    readonly seconds?: number;
    readonly exclusionSource?: ExclusionSource | null;
    readonly sourceSegmentIds?: readonly string[];
    readonly devices?: readonly ActivityDeviceSource[];
  }[];
  readonly hiddenIdentityCount?: number;
  readonly hasMixedProject?: boolean;
  readonly hasMixedCategory: boolean;
  readonly hasMixedProductivity: boolean;
  readonly detailLabel?: string | null;
  readonly durationSeconds?: number;
  readonly hasPartialSourceActivity?: boolean;
  readonly devices?: readonly ActivityDeviceSource[];
};

type WeekActivityInspectorProps = {
  readonly event: ActivityInspectorEvent;
  readonly segments: readonly ActivitySegment[];
  /** Available source rows for the panel log; never a mutation target. */
  readonly screenEvidenceSegments?: readonly ActivitySegment[];
  readonly appIcons: AppIconMap;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly anchorElement: HTMLElement;
  readonly actionsDisabledReason?: string | null;
  readonly classificationOptions?: ClassificationOptions;
  readonly projectOptions?: readonly ActivityInspectorProjectOption[];
  readonly initialView?: ActivityInspectorView;
  readonly regroupedBlockCount?: number;
  readonly onClose: (restoreFocus?: boolean) => void;
  readonly anchorRefreshing?: boolean;
  readonly onSaveValues?: ActivityInspectorSaveHandler;
  readonly onAssignProject?: (
    segments: readonly ActivitySegment[],
    projectId: string | null,
  ) => Promise<void>;
  /** Opens the category editor on the picked attribute; the inspector closes first. */
  readonly onEditCategories?: (target: CategoryEditorTarget) => void;
  readonly onClassify?: (
    segments: readonly ActivitySegment[],
    category: ActivityCategory,
    productivity: ProductivityLabel,
  ) => Promise<void>;
  readonly onDelete?: (segmentIds: readonly string[]) => Promise<void>;
  /** The block's work name, resolved live by the caller so edits show at once. */
  readonly activityLabel?: ActivityInspectorLabel | null;
  /** The controller's time-ordered log of a stretch; the panel's "log" body shows it. */
  readonly detailLog?: (startMs: number, endMs: number, segmentIds: readonly string[]) => {
    readonly runs: readonly ActivityCardDetailRun[];
    readonly recordedSeconds: number;
    /** The stretch's apps and sites, most time first; its icons match its log. */
    readonly identities?: readonly ActivityCardDetailIdentity[];
  };
  /** The block as drawn (Day card, Week block) that the log describes; otherwise its name's blocks. */
  readonly logStretch?: ActivityLogStretch;
};

type InspectorValues = {
  readonly projectId: string | null;
  readonly category: ActivityCategory;
  readonly productivity: ProductivityLabel;
};

function shouldShowProjectAttribute(
  projectOptions: readonly ActivityInspectorProjectOption[],
  projectId: string | null,
  hasMixedProject: boolean,
): boolean {
  // A null-id option is only the “No project” sentinel. Keep historical or
  // mixed assignments explainable even when their project is no longer active.
  return projectOptions.some((project) => project.id !== null)
    || projectId !== null
    || hasMixedProject;
}

type SegmentInspectorValues = ActivityInspectorSegmentValues;

type SavedDirectChange = {
  readonly field: ActivityInspectorAttribute;
  readonly fieldLabel: string;
  readonly previousValues: InspectorValues;
  readonly nextValues: InspectorValues;
  readonly previousSegmentValues: readonly SegmentInspectorValues[];
  readonly changedSegmentIds: readonly string[];
  readonly nextValueLabel: string;
  readonly sourceChanged: boolean;
};

type PickerOption = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
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

function ChevronIcon({ direction = "right" }: { readonly direction?: "down" | "left" | "right" }) {
  const path = direction === "left"
    ? "m14.5 6-6 6 6 6"
    : direction === "down"
      ? "m6 9 6 6 6-6"
      : "m9.5 6 6 6-6 6";
  return <svg {...iconProps}><path d={path} /></svg>;
}

function CheckIcon() {
  return <svg {...iconProps}><path d="m5.5 12.5 4 4 9-9" /></svg>;
}

function TrashIcon() {
  return <svg {...iconProps}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12h9.4l.8-12M10 10.5v5M14 10.5v5" /></svg>;
}

type AnchoredCardLayout = {
  readonly style: CSSProperties;
  readonly side: "left" | "right";
  readonly height: number;
};

function calculateAnchoredLayout(anchorElement: HTMLElement, cardElement: HTMLDivElement | null, avoidElement?: HTMLElement | null): AnchoredCardLayout {
  const anchorRect = anchorElement.getBoundingClientRect();
  const measuredHeight = cardElement?.getBoundingClientRect().height ?? 0;
  const height = measuredHeight > 0
    ? measuredHeight
    : Math.min(280, (typeof window === "undefined" ? 280 : window.innerHeight) - 32);
  const position = getViewportSafeAnchoredPosition(anchorRect, INSPECTOR_WIDTH_PX, height, avoidElement?.getBoundingClientRect());
  return {
    style: { left: position.left, top: position.top, width: INSPECTOR_WIDTH_PX },
    side: position.side,
    height,
  };
}

function useAnchoredCardLayout(
  anchorElement: HTMLElement,
  cardRef: RefObject<HTMLDivElement | null>,
  layoutKey: string,
  onAnchorUnavailable: () => void,
  anchorRefreshing = false,
  avoidElement?: HTMLElement | null,
  enabled = true,
): AnchoredCardLayout {
  const onAnchorUnavailableRef = useRef(onAnchorUnavailable);
  onAnchorUnavailableRef.current = onAnchorUnavailable;
  const unavailableFrameRef = useRef<number | null>(null);
  const [layout, setLayout] = useState<AnchoredCardLayout>(() => calculateAnchoredLayout(anchorElement, null, avoidElement));

  const cancelUnavailableCheck = useCallback(() => {
    if (unavailableFrameRef.current === null) return;
    window.cancelAnimationFrame(unavailableFrameRef.current);
    unavailableFrameRef.current = null;
  }, []);

  const updateLayout = useCallback(() => {
    if (!enabled) return;
    if (!anchorElement.isConnected) {
      // Reclassification can replace the block in this commit. Let the parent
      // reconnect its source records before treating it as a removed activity.
      if (!anchorRefreshing && unavailableFrameRef.current === null) {
        unavailableFrameRef.current = window.requestAnimationFrame(() => {
          unavailableFrameRef.current = null;
          if (!anchorElement.isConnected) onAnchorUnavailableRef.current();
        });
      }
      return;
    }
    cancelUnavailableCheck();
    const anchorRect = anchorElement.getBoundingClientRect();
    if (isAnchorOutsideViewport(anchorRect)) {
      onAnchorUnavailableRef.current();
      return;
    }
    const next = calculateAnchoredLayout(anchorElement, cardRef.current, avoidElement);
    setLayout((current) => (
      current.side === next.side
      && current.height === next.height
      && current.style.left === next.style.left
      && current.style.top === next.style.top
        ? current
        : next
    ));
  }, [anchorElement, anchorRefreshing, avoidElement, cancelUnavailableCheck, cardRef, enabled]);

  useLayoutEffect(() => {
    updateLayout();
    return cancelUnavailableCheck;
  }, [cancelUnavailableCheck, layoutKey, updateLayout]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updateLayout) : null;
    observer?.observe(anchorElement);
    if (avoidElement) observer?.observe(avoidElement);
    if (cardRef.current) observer?.observe(cardRef.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
    };
  }, [anchorElement, avoidElement, cardRef, enabled, updateLayout]);

  return layout;
}

type DirectPickerLayout = {
  readonly style: CSSProperties;
  readonly placement: "down" | "up";
  readonly positioned: boolean;
  readonly scrollable: boolean;
};

const INITIAL_PICKER_LAYOUT: DirectPickerLayout = {
  style: { left: -9999, top: -9999, width: 210, maxHeight: 0 },
  placement: "down",
  positioned: false,
  scrollable: false,
};

function useDirectPickerLayout(
  triggerElement: HTMLButtonElement,
  pickerRef: MutableRefObject<HTMLDivElement | null>,
  layoutKey: string,
  onAnchorUnavailable: () => void,
): DirectPickerLayout {
  const [layout, setLayout] = useState<DirectPickerLayout>(INITIAL_PICKER_LAYOUT);
  const onAnchorUnavailableRef = useRef(onAnchorUnavailable);
  onAnchorUnavailableRef.current = onAnchorUnavailable;

  const updateLayout = useCallback(() => {
    const picker = pickerRef.current;
    if (!triggerElement.isConnected || !picker) {
      if (!triggerElement.isConnected) onAnchorUnavailableRef.current();
      return;
    }

    const triggerRect = triggerElement.getBoundingClientRect();
    if (isAnchorOutsideViewport(triggerRect)) {
      onAnchorUnavailableRef.current();
      return;
    }

    const valueRect = triggerElement.querySelector<HTMLElement>(".week-activity-inspector__chip")?.getBoundingClientRect();
    const triggerStyle = getComputedStyle(triggerElement);
    // Read the resolved first grid track, not the custom property: the property
    // carries an unresolved token (a rem length), so parsing it directly would
    // anchor the picker at a few pixels from the trigger's left edge.
    const labelWidth = Number.parseFloat(triggerStyle.gridTemplateColumns) || 60;
    const columnGap = Number.parseFloat(triggerStyle.columnGap) || 7;
    const paddingLeft = Number.parseFloat(triggerStyle.paddingLeft) || 7;
    const paddingRight = Number.parseFloat(triggerStyle.paddingRight) || 7;
    const maxViewportWidth = Math.max(0, window.innerWidth - PICKER_VIEWPORT_INSET_PX * 2);
    const maxViewportHeight = Math.max(0, window.innerHeight - PICKER_VIEWPORT_INSET_PX * 2);
    if (maxViewportWidth === 0 || maxViewportHeight === 0) return;

    const wantedLeft = valueRect && valueRect.width > 0
      ? valueRect.left
      : triggerRect.left + paddingLeft + labelWidth + columnGap;
    const anchoredWidth = Math.max(0, triggerRect.right - paddingRight - wantedLeft);
    const width = Math.min(maxViewportWidth, Math.max(210, Math.min(286, anchoredWidth)));
    const left = Math.max(
      PICKER_VIEWPORT_INSET_PX,
      Math.min(wantedLeft, window.innerWidth - PICKER_VIEWPORT_INSET_PX - width),
    );
    // Measure without the previous viewport cap. The picker is a two-row grid,
    // so measuring while max-height is 0 (or capped for a shorter field) can
    // collapse the option row and report only the header height.
    const previousMaxHeight = picker.style.maxHeight;
    let naturalHeight = 0;
    try {
      picker.style.maxHeight = "none";
      naturalHeight = Math.ceil(picker.scrollHeight);
    } finally {
      picker.style.maxHeight = previousMaxHeight;
    }
    const preferredHeight = Math.min(naturalHeight, maxViewportHeight);
    const spaceBelow = Math.max(
      0,
      window.innerHeight - PICKER_VIEWPORT_INSET_PX - triggerRect.bottom - PICKER_TRIGGER_GAP_PX,
    );
    const spaceAbove = Math.max(
      0,
      triggerRect.top - PICKER_VIEWPORT_INSET_PX - PICKER_TRIGGER_GAP_PX,
    );
    const placement = spaceBelow >= preferredHeight || spaceBelow >= spaceAbove ? "down" : "up";
    const availableHeight = placement === "down" ? spaceBelow : spaceAbove;
    const renderedHeight = Math.max(0, Math.floor(Math.min(preferredHeight, availableHeight)));
    const wantedTop = placement === "down"
      ? triggerRect.bottom + PICKER_TRIGGER_GAP_PX
      : triggerRect.top - PICKER_TRIGGER_GAP_PX - renderedHeight;
    const top = Math.max(
      PICKER_VIEWPORT_INSET_PX,
      Math.min(wantedTop, window.innerHeight - PICKER_VIEWPORT_INSET_PX - renderedHeight),
    );

    setLayout({
      style: {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(width),
        maxHeight: renderedHeight,
      },
      placement,
      positioned: true,
      scrollable: naturalHeight > renderedHeight + 1,
    });
  }, [pickerRef, triggerElement]);

  useLayoutEffect(() => updateLayout(), [layoutKey, updateLayout]);

  useEffect(() => {
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updateLayout) : null;
    observer?.observe(triggerElement);
    if (pickerRef.current) observer?.observe(pickerRef.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
    };
  }, [pickerRef, triggerElement, updateLayout]);

  return layout;
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

function buildSegmentInspectorValues(
  event: ActivityInspectorEvent,
  segments: readonly ActivitySegment[],
  classificationOptions?: ClassificationOptions,
): readonly SegmentInspectorValues[] {
  const projectBySegmentId = new Map(
    event.projectAssignments?.map((assignment) => [assignment.segmentId, assignment.projectId] as const) ?? [],
  );
  return segments.map((segment) => {
    const classification = classifyActivityDetailed(segment, classificationOptions);
    return {
      segment,
      projectId: projectBySegmentId.has(segment.id)
        ? projectBySegmentId.get(segment.id) ?? null
        : event.projectId ?? null,
      category: classification.category,
      productivity: classification.productivity,
    };
  });
}

function identityIconSrc(event: ActivityInspectorEvent, appIcons: AppIconMap): string | null {
  const identity = event.identities[0] ?? null;
  if (!identity) return null;
  return appIcons[identity.bundleId ?? identity.appName] ?? appIcons[identity.appName] ?? null;
}

function InspectorIdentityIcon({ event, appIcons }: { readonly event: ActivityInspectorEvent; readonly appIcons: AppIconMap }) {
  const { t } = useLocalization();
  const identity = event.identities[0] ?? null;
  const iconSrc = identityIconSrc(event, appIcons);
  const glyphName = identity
    ? localizedExcludedIdentityLabel(identity, t) || identity.appName || event.appName
    : event.appName;
  return identity?.siteDomain
    ? <SiteFavicon domain={identity.siteDomain} size={20} fallbackIconSrc={iconSrc} />
    : <AppGlyph appName={glyphName} iconSrc={iconSrc} size="sm" />;
}

function ActivityDeviceSources({ devices }: { readonly devices: readonly ActivityDeviceSource[] }) {
  const { t } = useLocalization();
  return (
    <>
      {devices.map((device) => {
        const platformLabel = device.platform === "macos" ? "macOS" : device.platform === "windows" ? "Windows" : null;
        const label = platformLabel ? `${device.label} · ${platformLabel}` : device.label;
        return (
          <span className="week-activity-inspector__device-source" key={device.id ?? "local"}
            title={label} data-platform={device.platform}>
            <DeviceSourceIcon label={platformLabel ?? t("settings.cloudDevices.device")} />
            <span>{device.label}</span>
          </span>
        );
      })}
    </>
  );
}

function ActivityInspectorHeader({
  event,
  appIcons,
  titleId,
  segments,
  deviceLabelById,
  closeDisabled = false,
  readOnly = false,
  panel = false,
  onClose,
}: {
  readonly event: ActivityInspectorEvent;
  readonly appIcons: AppIconMap;
  readonly titleId: string;
  readonly segments: readonly ActivitySegment[];
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly closeDisabled?: boolean;
  readonly readOnly?: boolean;
  readonly panel?: boolean;
  readonly onClose: () => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const devices = event.devices?.length ? event.devices : buildActivityDevices(
    segments, deviceLabelById, t("dashboard.week.inspector.thisMac"), t("dashboard.week.inspector.syncedMac"),
  );
  const identityCount = event.identities.length + (event.hiddenIdentityCount ?? 0);
  const primaryIdentity = event.identities[0] ?? null;
  const primaryLabel = primaryIdentity
    ? localizedExcludedIdentityLabel(primaryIdentity, t) || event.appName
    : event.appName;
  const title = panel && primaryIdentity
    ? (primaryIdentity.exclusionSource
        ? localizedExcludedIdentityLabel(primaryIdentity, t)
        : primaryIdentity.siteDomain || primaryIdentity.appName || primaryLabel)
    : event.surface === "week" && primaryIdentity && identityCount >= 3
    ? t("dashboard.week.inspector.activitySummaryTitle", {
        activity: primaryLabel,
        count: identityCount - 1,
      })
    : (event.appName.trim() || primaryLabel);
  return (
    <header className="week-activity-inspector__header">
      <span className="week-activity-inspector__identity" aria-hidden="true">
        <InspectorIdentityIcon event={event} appIcons={appIcons} />
      </span>
      <div className="week-activity-inspector__heading">
        {panel
          ? <h3 id={titleId}>{title}</h3>
          : <strong id={titleId} title={event.appName.trim() || primaryLabel}>{title}</strong>}
        {!panel && event.detailLabel ? (
          <span className="week-activity-inspector__context" title={event.detailLabel}>{event.detailLabel}</span>
        ) : null}
        {panel && event.day ? (
          <span className="week-activity-inspector__date">{formatLocalizedDayLabel(event.day, effectiveLanguage)}</span>
        ) : null}
        <span className="week-activity-inspector__time">
          {/* Each part stays whole; a narrow title row wraps only between them. */}
          {[
            `${event.startLabel}–${event.endLabel}`,
            event.durationSeconds !== undefined
              ? formatLocalizedCompactDurationFromSeconds(event.durationSeconds, effectiveLanguage)
              : null,
          ].filter((part): part is string => Boolean(part)).map((part, index, parts) => (
            // The dot stays with the part before it, so a wrapped line never starts with it.
            <Fragment key={index}>
              {index > 0 ? " " : null}
              <span className="week-activity-inspector__time-part">{part}{index < parts.length - 1 ? " ·" : null}</span>
            </Fragment>
          ))}
        </span>
      </div>
      {panel ? null : readOnly ? (
        <span className="week-activity-inspector__icon-button" aria-hidden="true"><CloseIcon /></span>
      ) : (
        <button
          type="button"
          className="week-activity-inspector__icon-button"
          aria-label={t("dashboard.week.inspector.close")}
          onClick={onClose}
          disabled={closeDisabled}
        >
          <CloseIcon />
        </button>
      )}
      {devices.length > 0 ? (
        <div className="week-activity-inspector__devices">
          <ActivityDeviceSources devices={devices} />
        </div>
      ) : null}
    </header>
  );
}

function AttributeChip({
  color,
  label,
  more,
  hint,
}: {
  readonly color: string;
  readonly label: string;
  /** Mixed records: a short "and others" mark after the dominant value. */
  readonly more?: string;
  readonly hint?: string;
}) {
  return (
    <span
      className="week-activity-inspector__chip"
      style={{ "--inspector-chip-color": color } as CSSProperties & Record<"--inspector-chip-color", string>}
      title={hint}
    >
      <i aria-hidden="true" />
      <span>{label}</span>
      {/* The space is where a wrapped panel chip may break before the mark;
          the floating chip is a flex row, which drops it. */}
      {more ? <>{" "}<span className="week-activity-inspector__chip-more">{more}</span></> : null}
    </span>
  );
}

function DirectAttributeRow({
  field,
  label,
  valueLabel,
  color,
  mixed,
  recordCount,
  expanded,
  disabled,
  triggerRef,
  readOnly = false,
  onToggle,
}: {
  readonly field: ActivityInspectorAttribute;
  readonly label: string;
  readonly valueLabel: string;
  readonly color: string;
  readonly mixed: boolean;
  readonly recordCount: number;
  readonly expanded: boolean;
  readonly disabled: boolean;
  readonly readOnly?: boolean;
  readonly triggerRef?: (element: HTMLButtonElement | null) => void;
  readonly onToggle?: (field: ActivityInspectorAttribute, trigger: HTMLButtonElement) => void;
}) {
  const { t } = useLocalization();
  const displayedValue = mixed
    ? `${valueLabel} · ${t("dashboard.week.inspector.dominant")}`
    : valueLabel;
  const content = (
    <>
      <span className="week-activity-inspector__attribute-label">{label}</span>
      <AttributeChip
        color={color}
        label={valueLabel}
        more={mixed ? t("dashboard.week.inspector.mixedMore") : undefined}
        hint={mixed ? t("dashboard.week.inspector.dominantValuesSummary") : undefined}
      />
      <span className="week-activity-inspector__attribute-chevron" aria-hidden="true"><ChevronIcon direction="down" /></span>
    </>
  );
  return (
    <div className="week-activity-inspector__attribute">
      {readOnly ? (
        <div className="week-activity-inspector__attribute-trigger">{content}</div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="week-activity-inspector__attribute-trigger"
          aria-label={t("dashboard.week.inspector.changeAttribute", {
            attribute: label,
            value: displayedValue,
            scope: recordCount > 1 ? t("dashboard.week.inspector.allActivitiesScope", { count: recordCount }) : "",
          })}
          aria-haspopup="listbox"
          aria-expanded={expanded}
          disabled={disabled || !onToggle}
          onClick={(clickEvent) => onToggle?.(field, clickEvent.currentTarget)}
        >
          {content}
        </button>
      )}
    </div>
  );
}

function DirectAttributePicker({
  field,
  fieldLabel,
  triggerElement,
  options,
  selectedKey,
  recordCount,
  busy,
  pickerRef,
  onClose,
  onSelect,
  onManage,
}: {
  readonly field: ActivityInspectorAttribute;
  readonly fieldLabel: string;
  readonly triggerElement: HTMLButtonElement;
  readonly options: readonly PickerOption[];
  readonly selectedKey: string;
  readonly recordCount: number;
  readonly busy: boolean;
  readonly pickerRef: MutableRefObject<HTMLDivElement | null>;
  readonly onClose: () => void;
  readonly onSelect: (key: string) => void;
  /** Manage the definitions this picker lists, in the category editor. */
  readonly onManage?: () => void;
}) {
  const { t } = useLocalization();
  const layout = useDirectPickerLayout(
    triggerElement,
    pickerRef,
    `${field}:${options.length}:${selectedKey}`,
    onClose,
  );

  useEffect(() => {
    const selected = pickerRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
      ?? pickerRef.current?.querySelector<HTMLButtonElement>('[role="option"]');
    const optionList = selected?.closest<HTMLElement>(".week-activity-inspector__picker-options");
    if (!selected || !optionList) return;
    const optionTop = selected.offsetTop - optionList.offsetTop;
    optionList.scrollTop = Math.max(0, optionTop - (optionList.clientHeight - selected.offsetHeight) / 2);
    selected.focus({ preventScroll: true });
  }, [field, layout.positioned, options.length, pickerRef, selectedKey]);

  const moveOptionFocus = (current: HTMLButtonElement, key: string) => {
    const buttons = Array.from(pickerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const currentIndex = buttons.indexOf(current);
    if (currentIndex < 0 || buttons.length === 0) return;
    let nextIndex = currentIndex;
    if (key === "ArrowDown") nextIndex = (currentIndex + 1) % buttons.length;
    else if (key === "ArrowUp") nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    else if (key === "Home") nextIndex = 0;
    else if (key === "End") nextIndex = buttons.length - 1;
    else return;
    buttons[nextIndex]?.focus({ preventScroll: true });
  };

  return createPortal(
    <div
      ref={(element) => { pickerRef.current = element; }}
      className="week-activity-inspector__picker"
      style={layout.style}
      data-field={field}
      data-placement={layout.placement}
      data-positioned={layout.positioned}
      data-scrollable={layout.scrollable}
    >
      <div className="week-activity-inspector__picker-head">
        <strong>{t("dashboard.week.inspector.selectAttribute", { attribute: fieldLabel })}</strong>
        <span>
          {recordCount > 1
            ? t("dashboard.week.inspector.appliesImmediately", { count: recordCount })
            : t("dashboard.week.inspector.savesImmediately")}
        </span>
      </div>
      <div className="week-activity-inspector__picker-options" role="listbox" aria-label={t("dashboard.week.inspector.selectAttribute", { attribute: fieldLabel })}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            role="option"
            aria-selected={option.key === selectedKey}
            tabIndex={option.key === selectedKey ? 0 : -1}
            disabled={busy}
            onClick={() => onSelect(option.key)}
            onKeyDown={(keyEvent) => {
              if (keyEvent.key === "Escape") {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                onClose();
                return;
              }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(keyEvent.key)) return;
              keyEvent.preventDefault();
              moveOptionFocus(keyEvent.currentTarget, keyEvent.key);
            }}
          >
            <AttributeChip color={option.color} label={option.label} />
            {option.key === selectedKey ? <CheckIcon /> : <span aria-hidden="true" />}
          </button>
        ))}
      </div>
      {onManage ? (
        <div className="week-activity-inspector__picker-foot">
          <button type="button" className="week-activity-inspector__picker-manage" aria-haspopup="dialog" disabled={busy} onClick={onManage}>
            <span>{t("categoryEditor.manageGroup", { group: fieldLabel })}</span>
            <ChevronIcon direction="right" />
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

// Sub-minute shares would round to "0"/"1m"; the breakdown is exactly where those
// thin runner-ups matter, so keep seconds visible below one minute.
function formatActivityShareDuration(totalSeconds: number, language: DisplayLanguage): string {
  if (totalSeconds < 60) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    return language === "ko" ? `${seconds}초` : language === "es" ? `${seconds} s` : `${seconds}s`;
  }
  return formatLocalizedCompactDurationFromSeconds(totalSeconds, language);
}

function ActivityBreakdown({ event, appIcons, segments, deviceLabelById }: {
  readonly event: ActivityInspectorEvent;
  readonly appIcons: AppIconMap;
  readonly segments: readonly ActivitySegment[];
  readonly deviceLabelById?: ReadonlyMap<string, string>;
}) {
  const { effectiveLanguage, t } = useLocalization();
  if (event.identities.length === 0) return null;
  // A flow cell paints one winner; only list its composition when something else shared it.
  const isFlowComposition = event.surface === "flow";
  if (isFlowComposition && event.identities.length < 2) return null;
  if (!isFlowComposition && event.surface !== "week") return null;
  const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
  const includeLocalDevice = (deviceLabelById?.size ?? 0) > 0
    || Boolean(event.devices?.some((device) => device.id))
    || segments.some((segment) => segment.deviceId);
  const visibleIdentities = event.identities.slice(0, MAX_VISIBLE_ACTIVITY_ROWS);
  const additionalIdentityCount = Math.max(0, event.identities.length - visibleIdentities.length)
    + Math.max(0, event.hiddenIdentityCount ?? 0);
  const totalIdentityCount = visibleIdentities.length + additionalIdentityCount;
  return (
    <div
      className="week-activity-inspector__activity-list"
      role="list"
      aria-label={t("dashboard.week.inspector.constituentActivities", { count: totalIdentityCount })}
    >
      {visibleIdentities.map((identity, index) => {
        const iconSrc = appIcons[identity.bundleId ?? identity.appName] ?? appIcons[identity.appName] ?? null;
        const devices = identity.devices ?? buildActivityDevices(
          (identity.sourceSegmentIds ?? []).flatMap((id) => {
            const segment = segmentsById.get(id);
            return segment ? [segment] : [];
          }),
          deviceLabelById, t("dashboard.week.inspector.thisMac"), t("dashboard.week.inspector.syncedMac"),
          includeLocalDevice,
        );
        const isDominant = isFlowComposition && index === 0;
        const identityLabel = localizedExcludedIdentityLabel(identity, t);
        const rowLabel = isDominant
          ? `${identityLabel} · ${t("dashboard.week.inspector.dominant")}`
          : identityLabel;
        return (
          <div
            className={isDominant
              ? "week-activity-inspector__activity-row week-activity-inspector__activity-row--dominant"
              : "week-activity-inspector__activity-row"}
            role="listitem"
            key={identity.id}
          >
            <span className="usage-identity-icon usage-identity-icon--sm" aria-hidden="true">
              {identity.siteDomain
                ? <SiteFavicon domain={identity.siteDomain} size={18} fallbackIconSrc={iconSrc} />
                : <AppGlyph appName={identity.appName || identityLabel} iconSrc={iconSrc} size="sm" />}
            </span>
            <span className="week-activity-inspector__activity-identity">
              <span title={rowLabel}>{rowLabel}</span>
              {devices.length > 0 ? (
                <span className="week-activity-inspector__activity-devices"><ActivityDeviceSources devices={devices} /></span>
              ) : null}
            </span>
            {identity.seconds !== undefined
              ? <strong>{formatActivityShareDuration(identity.seconds, effectiveLanguage)}</strong>
              : null}
          </div>
        );
      })}
      {additionalIdentityCount > 0 ? (
        <div className="week-activity-inspector__activity-more" role="listitem">
          {t("dashboard.week.inspector.additionalActivities", { count: additionalIdentityCount })}
        </div>
      ) : null}
    </div>
  );
}

function ActivityInspectorBody({
  readOnly = false,
  event,
  values,
  segments,
  appIcons,
  deviceLabelById,
  projectOptions,
  actionsDisabledReason,
  classificationOptions,
  mixedOverride,
  regroupedBlockCount = 1,
  descriptionId,
  workRow = null,
  showActions = true,
  expandedAttribute,
  triggerRefs,
  canAssignProject = false,
  canClassify = false,
  busy,
  error,
  savedChange,
  onToggleAttribute,
  onUndo,
  onDelete,
  breakdown,
}: {
  readonly readOnly?: boolean;
  readonly event: ActivityInspectorEvent;
  readonly values: InspectorValues;
  readonly segments: readonly ActivitySegment[];
  readonly appIcons: AppIconMap;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly projectOptions: readonly ActivityInspectorProjectOption[];
  readonly actionsDisabledReason: string | null;
  readonly classificationOptions?: ClassificationOptions;
  readonly mixedOverride?: { readonly hasMixedCategory: boolean; readonly hasMixedProductivity: boolean };
  readonly regroupedBlockCount?: number;
  readonly descriptionId: string;
  /** Day cards: the work block's name, shown as the first attribute row. */
  readonly workRow?: ReactNode;
  /** Panel placements other than the end of the content render the actions themselves. */
  readonly showActions?: boolean;
  readonly expandedAttribute?: ActivityInspectorAttribute | null;
  readonly triggerRefs?: RefObject<Partial<Record<ActivityInspectorAttribute, HTMLButtonElement | null>>>;
  readonly canAssignProject?: boolean;
  readonly canClassify?: boolean;
  readonly busy?: boolean;
  readonly error?: DescribedActionError | null;
  readonly savedChange?: SavedDirectChange | null;
  readonly onToggleAttribute?: (field: ActivityInspectorAttribute, trigger: HTMLButtonElement) => void;
  readonly onUndo?: () => void;
  readonly onDelete?: () => void;
  /** Replaces the app list (the panel's time-ordered log). */
  readonly breakdown?: ReactNode;
}) {
  const { t } = useLocalization();
  const count = segments.length;
  const canMutate = !actionsDisabledReason && count > 0;
  const computedMixed = useMemo(
    () => mixedClassificationLabels(event, segments, classificationOptions),
    [classificationOptions, event, segments],
  );
  const mixed = mixedOverride ?? computedMixed;
  const currentProject = projectOptions.find((project) => project.id === values.projectId) ?? null;
  const projectLabel = values.projectId === null
    ? t("dashboard.week.inspector.noProject")
    : currentProject?.name ?? event.projectName ?? t("dashboard.week.inspector.unavailableProject");
  const projectColor = values.projectId === null
    ? PRODUCTIVITY_COLORS.neutral
    : currentProject?.color ?? event.projectColor ?? PRODUCTIVITY_COLORS.neutral;
  const showProjectAttribute = shouldShowProjectAttribute(
    projectOptions,
    values.projectId,
    Boolean(event.hasMixedProject),
  );

  const rows: readonly {
    field: ActivityInspectorAttribute;
    label: string;
    valueLabel: string;
    color: string;
    mixed: boolean;
  }[] = [
    ...(showProjectAttribute ? [{
      field: "project",
      label: t("common.project"),
      valueLabel: projectLabel,
      color: projectColor,
      mixed: Boolean(event.hasMixedProject) && values.projectId === (event.projectId ?? null),
    } as const] : []),
    {
      field: "category",
      label: t("common.category"),
      valueLabel: localizedCategoryLabel(values.category, t),
      color: CATEGORY_COLORS[values.category],
      mixed: mixed.hasMixedCategory && values.category === event.category,
    },
    {
      field: "productivity",
      label: t("common.productivity"),
      valueLabel: localizedProductivityLabel(values.productivity, t),
      color: PRODUCTIVITY_COLORS[values.productivity],
      mixed: mixed.hasMixedProductivity && values.productivity === event.productivity,
    },
  ];
  return (
    <>
      {regroupedBlockCount > 1 ? (
        <div className="week-activity-inspector__regroup-notice" role="status">
          {t("dashboard.week.inspector.regroupedBlocks", { count: regroupedBlockCount })}
        </div>
      ) : null}
      <div className="week-activity-inspector__attributes" id={descriptionId}>
        {workRow}
        {event.hasPartialSourceActivity ? (
          <p className="week-activity-inspector__scope-note">
            {t("dashboard.week.inspector.sourceActivityScope")}
          </p>
        ) : null}
        {rows.map((row) => (
          <DirectAttributeRow
            key={row.field}
            {...row}
            readOnly={readOnly}
            recordCount={count}
            expanded={expandedAttribute === row.field}
            disabled={
              !canMutate
              || Boolean(busy)
              || (row.field === "project" ? !canAssignProject : !canClassify)
            }
            triggerRef={triggerRefs
              ? (element) => {
                  if (triggerRefs.current) triggerRefs.current[row.field] = element;
                }
              : undefined}
            onToggle={onToggleAttribute}
          />
        ))}
      </div>

      {savedChange ? (
        <div className="week-activity-inspector__save-feedback" role="status">
          <span title={`${savedChange.fieldLabel}: ${savedChange.nextValueLabel}`}>
            {savedChange.fieldLabel} · {savedChange.nextValueLabel} · {count > 1
              ? t("dashboard.week.inspector.activitiesSaved", { count })
              : t("dashboard.week.inspector.saved")}
            {savedChange.sourceChanged ? ` · ${t("dashboard.week.inspector.manualClassification")}` : ""}
          </span>
          <button
            type="button"
            aria-label={t("dashboard.week.inspector.undoChange", { attribute: savedChange.fieldLabel })}
            disabled={busy}
            onClick={onUndo}
          >
            {t("dashboard.week.inspector.undo")}
          </button>
        </div>
      ) : null}

      {breakdown === undefined
        ? <ActivityBreakdown event={event} appIcons={appIcons} segments={segments} deviceLabelById={deviceLabelById} />
        : breakdown}

      {actionsDisabledReason && actionsDisabledReason !== t("dashboard.week.remoteEditBlocked") ? (
        <p className="week-activity-inspector__notice" role="note">{actionsDisabledReason}</p>
      ) : null}
      {error ? <p className="week-activity-inspector__error" role="alert" title={error.detail ?? undefined}>{error.message}{error.detail ? <span className="sr-only"> {error.detail}</span> : null}</p> : null}

      {showActions ? <div className="week-activity-inspector__actions week-activity-inspector__actions--destructive">
        {readOnly ? (
          <div className="week-activity-inspector__action week-activity-inspector__action--danger">
            <span className="week-activity-inspector__action-icon"><TrashIcon /></span>
            <span><strong>{count > 1
              ? t("dashboard.week.inspector.deleteActivities", { count })
              : t("dashboard.week.inspector.delete")}</strong></span>
            <ChevronIcon />
          </div>
        ) : (
          <button
            type="button"
            className="week-activity-inspector__action week-activity-inspector__action--danger"
            onClick={onDelete}
            disabled={!canMutate || !onDelete || Boolean(busy)}
          >
            <span className="week-activity-inspector__action-icon"><TrashIcon /></span>
            <span>
              <strong>
                {count > 1
                  ? t("dashboard.week.inspector.deleteActivities", { count })
                  : t("dashboard.week.inspector.delete")}
              </strong>
            </span>
            <ChevronIcon />
          </button>
        )}
      </div> : null}
    </>
  );
}

export function resolveActivityActionsDisabledReason(
  event: ActivityInspectorEvent,
  segments: readonly ActivitySegment[],
  activityActionsEnabled: boolean,
  t: ReturnType<typeof useLocalization>["t"],
): string | null {
  if (segments.length !== event.segmentIds.length) return t("dashboard.week.someRecordsMissing");
  if (segments.some(isRemoteDeviceSegment)) return t("dashboard.week.remoteEditBlocked");
  if (!activityActionsEnabled) return t("dashboard.week.previewEditBlocked");
  return null;
}

export function ActivityInspectorPreview({
  event,
  segments,
  appIcons,
  deviceLabelById,
  anchorElement,
  descriptionTarget,
  avoidElement,
  restoreFocusOnDismiss = false,
  actionsDisabledReason,
  classificationOptions,
  projectOptions = [],
  activityLabel = null,
  onDismiss,
}: {
  readonly event: ActivityInspectorEvent;
  readonly segments: readonly ActivitySegment[];
  readonly appIcons: AppIconMap;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly anchorElement: HTMLElement;
  readonly descriptionTarget?: HTMLElement;
  /** Keep this neighboring column visible, even when the popup flips. */
  readonly avoidElement?: HTMLElement | null;
  readonly restoreFocusOnDismiss?: boolean;
  readonly actionsDisabledReason: string | null;
  readonly classificationOptions?: ClassificationOptions;
  readonly projectOptions?: readonly ActivityInspectorProjectOption[];
  readonly activityLabel?: ActivityInspectorLabel | null;
  readonly onDismiss: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const showProjectAttribute = shouldShowProjectAttribute(
    projectOptions,
    event.projectId ?? null,
    Boolean(event.hasMixedProject),
  );
  const layout = useAnchoredCardLayout(
    anchorElement,
    previewRef,
    `${event.id}:${showProjectAttribute ? "project" : "no-project"}:${activityLabel?.display?.title ?? ""}`,
    onDismiss,
    false,
    avoidElement,
  );
  const dialogId = `activity-inspector-preview-${event.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const values: InspectorValues = {
    projectId: event.projectId ?? null,
    category: event.category,
    productivity: event.productivity,
  };
  const focusTarget = descriptionTarget ?? (anchorElement.matches("button, [tabindex]")
    ? anchorElement
    : anchorElement.querySelector<HTMLElement>("button, [tabindex]"));

  const dismissWithFocusRestore = useCallback(() => {
    const shouldRestoreFocus = Boolean(
      focusTarget?.isConnected
      && (restoreFocusOnDismiss || previewRef.current?.contains(document.activeElement)),
    );
    onDismiss();
    if (!shouldRestoreFocus || !focusTarget) return;
    window.setTimeout(() => {
      if (!focusTarget.isConnected) return;
      const activeElement = document.activeElement;
      if (activeElement && activeElement !== document.body && activeElement !== focusTarget && activeElement.isConnected) return;
      focusTarget.dataset.activityPreviewFocusSuppressed = "true";
      focusTarget.focus();
      if (focusTarget.dataset.activityPreviewFocusSuppressed === "true") {
        delete focusTarget.dataset.activityPreviewFocusSuppressed;
      }
    }, 0);
  }, [focusTarget, onDismiss, restoreFocusOnDismiss]);

  useEffect(() => {
    if (focusTarget) {
      const descriptionIds = (focusTarget.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      if (!descriptionIds.includes(dialogId)) focusTarget.setAttribute("aria-describedby", [...descriptionIds, dialogId].join(" "));
    }
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape" || keyEvent.defaultPrevented) return;
      keyEvent.preventDefault();
      dismissWithFocusRestore();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (!focusTarget) return;
      const remainingIds = (focusTarget.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter((descriptionIdValue) => descriptionIdValue && descriptionIdValue !== dialogId);
      if (remainingIds.length === 0) focusTarget.removeAttribute("aria-describedby");
      else focusTarget.setAttribute("aria-describedby", remainingIds.join(" "));
    };
  }, [dialogId, dismissWithFocusRestore, focusTarget]);

  return createPortal(
    <>
      <div
        id={dialogId}
        ref={previewRef}
        className="week-activity-inspector week-activity-inspector--preview"
        style={layout.style}
        role="tooltip"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-mode="peek"
        data-side={layout.side}
      >
        <ActivityInspectorHeader readOnly event={event} appIcons={appIcons} titleId={titleId}
          segments={segments} deviceLabelById={deviceLabelById} onClose={dismissWithFocusRestore} />
        <ActivityInspectorBody
          readOnly
          event={event}
          values={values}
          segments={segments}
          appIcons={appIcons}
          deviceLabelById={deviceLabelById}
          projectOptions={projectOptions}
          actionsDisabledReason={actionsDisabledReason}
          classificationOptions={classificationOptions}
          descriptionId={descriptionId}
          workRow={<ActivityLabelRow label={activityLabel} />}
        />
      </div>
    </>,
    document.body,
  );
}

type PanelManageActionsProps = {
  readonly deleteLabel: string;
  readonly canDelete: boolean;
  readonly disabled: boolean;
  readonly onDelete?: () => void;
};

export function WeekActivityInspector({
  event,
  segments,
  appIcons,
  deviceLabelById,
  anchorElement,
  actionsDisabledReason = null,
  classificationOptions,
  projectOptions = [],
  initialView = "overview",
  anchorRefreshing = false,
  regroupedBlockCount = 1,
  onClose,
  onSaveValues,
  onAssignProject,
  onClassify,
  onDelete,
  activityLabel = null,
  onEditCategories,
  detailLog,
  logStretch: drawnStretch,
  screenEvidenceSegments,
}: WeekActivityInspectorProps) {
  const { effectiveLanguage, t } = useLocalization();
  const screenContext=useContext(ScreenEvidenceContext);
  const [evidenceOpen,setEvidenceOpen]=useState(false);
  const [evidenceRecordId,setEvidenceRecordId]=useState<string|null>(null);
  // The replay in the detail and the viewer hand their place to each other, and the Details lines
  // below the replay play from their own first screen.
  const [evidenceAutoplay,setEvidenceAutoplay]=useState(false);
  const [evidenceResumeId,setEvidenceResumeId]=useState<string|null>(null);
  const [replayState,setReplayState]=useState<ScreenReplayState|null>(null);
  const [replaySeek,setReplaySeek]=useState<ScreenReplaySeek|null>(null);
  const replaySeekCount=useRef(0);
  const evidenceButton=useRef<HTMLButtonElement|null>(null);
  const closeEvidence=useCallback(()=>{
    setEvidenceOpen(false);
    window.requestAnimationFrame(()=>evidenceButton.current?.focus({preventScroll:true}));
  },[]);
  const inspection = useActivityInspection();
  const { presentation, panelElement, panelActive, registerSelection } = inspection;
  const isPanel = presentation === "panel";
  // The panel leads with the block's name, then its activities in time order; delete and its
  // confirmation live in the panel's bottom bar.
  const logMode = isPanel && Boolean(detailLog);
  const evidenceOptions = logMode ? [] : event.screenEvidenceOptions ?? [];
  const [evidenceOptionId, setEvidenceOptionId] = useState<string | null>(null);
  const evidenceOption = evidenceOptions.find(option => option.id === evidenceOptionId) ?? evidenceOptions[0];
  const deleteStyle = useActivityDeleteStyle();
  // Every Dev candidate but "Question in the panel" asks in the bottom bar.
  const confirmInFooter = isPanel && deleteStyle !== "panel";
  const [keyboardOpened] = useState(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement
      && (active === anchorElement || anchorElement.contains(active))
      && active.matches(":focus-visible");
  });
  const initialPanelFocusHandled = useRef(false);
  const targetSegmentsRef = useRef(segments);
  const targetSegments = targetSegmentsRef.current;
  // The stretch the log describes: the named block (every member of a merged Week block), or
  // an unnamed selection's own records.
  const logStretch = useMemo(() => {
    if (!logMode) return null;
    if (drawnStretch) return drawnStretch;
    const blocks = activityLabel ? (activityLabel.members?.length ? activityLabel.members : [activityLabel.block]) : [];
    if (blocks.length > 0) {
      return {
        startMs: Math.min(...blocks.map((block) => block.startMs)),
        endMs: Math.max(...blocks.map((block) => block.endMs)),
        segmentIds: [...new Set(blocks.flatMap((block) => block.segmentIds))],
      };
    }
    const bounds = targetSegments.map(activityTimeBounds).filter((bound) => Number.isFinite(bound.start) && bound.end > bound.start);
    if (bounds.length === 0) return null;
    return {
      startMs: Math.min(...bounds.map((bound) => bound.start)),
      endMs: Math.max(...bounds.map((bound) => bound.end)),
      segmentIds: event.segmentIds,
    };
  }, [activityLabel, drawnStretch, event.segmentIds, logMode, targetSegments]);
  const screenEvidenceSelection = useMemo(() => {
    if (!logMode) return evidenceOption?.selection ?? event.screenEvidenceSelection ?? null;
    if (!logStretch || !screenEvidenceSegments) return null;
    const selected = new Set(logStretch.segmentIds);
    return activityEvidenceSelectionForStretch(screenEvidenceSegments.filter(segment => selected.has(segment.id)),
      logStretch.startMs, logStretch.endMs);
  }, [evidenceOption?.selection, event.screenEvidenceSelection, logMode, logStretch, screenEvidenceSegments]);
  const evidenceAppNames = useMemo(() => {
    if (event.surface !== "week" || logMode) return [];
    const selected = new Set(screenEvidenceSelection?.recordIds ?? []);
    return [...new Set((screenEvidenceSegments ?? targetSegments)
      .filter(segment => selected.has(segment.id))
      .map(segment => segment.appName.trim()).filter(Boolean))];
  }, [event.surface, logMode, screenEvidenceSelection, screenEvidenceSegments, targetSegments]);
  const log = useMemo(
    () => logStretch && detailLog ? detailLog(logStretch.startMs, logStretch.endMs, logStretch.segmentIds) : null,
    [detailLog, logStretch],
  );
  const [view, setView] = useState<ActivityInspectorView>(initialView);
  // Switching the Dev candidate mid-question starts the new one from its first press.
  const askedDeleteStyle = useRef(deleteStyle);
  useEffect(() => {
    if (askedDeleteStyle.current === deleteStyle) return;
    askedDeleteStyle.current = deleteStyle;
    setError(null);
    setView((current) => (current === "delete" ? "overview" : current));
  }, [deleteStyle]);
  const [values, setValues] = useState<InspectorValues>({
    projectId: event.projectId ?? null,
    category: event.category,
    productivity: event.productivity,
  });
  const [segmentValues, setSegmentValues] = useState<readonly SegmentInspectorValues[]>(() => (
    buildSegmentInspectorValues(event, targetSegments, classificationOptions)
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DescribedActionError | null>(null);
  const [savedChange, setSavedChange] = useState<SavedDirectChange | null>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Partial<Record<ActivityInspectorAttribute, HTMLButtonElement | null>>>({});
  const [pickerTrigger, setPickerTrigger] = useState<{
    readonly field: ActivityInspectorAttribute;
    readonly element: HTMLButtonElement;
  } | null>(null);
  const hasMixedProject = new Set(segmentValues.map((item) => item.projectId ?? "__no_project__")).size > 1
    || (Boolean(event.hasMixedProject) && savedChange?.field !== "project");
  const showProjectAttribute = shouldShowProjectAttribute(projectOptions, values.projectId, hasMixedProject);
  const layout = useAnchoredCardLayout(
    anchorElement,
    inspectorRef,
    `${event.id}:${view}:${error ?? ""}:${savedChange?.nextValueLabel ?? ""}:${showProjectAttribute ? "project" : "no-project"}`,
    () => onClose(false),
    anchorRefreshing,
    undefined,
    !isPanel,
  );
  const count = targetSegments.length;
  const canMutate = !actionsDisabledReason && count > 0;
  const deleteLabel = count > 1
    ? t("dashboard.week.inspector.deleteActivities", { count })
    : t("dashboard.week.inspector.delete");
  const deleteRecords = count > 1 ? t("dashboard.week.inspector.activities", { count }) : t("dashboard.week.inspector.oneActivity");
  const manageActions: PanelManageActionsProps = {
    deleteLabel,
    canDelete: canMutate && Boolean(onDelete) && !busy,
    disabled: busy,
    onDelete: onDelete ? () => {
      setError(null);
      setView("delete");
    } : undefined,
  };
  const expandedAttribute = view === "category"
    || view === "productivity"
    || (view === "project" && showProjectAttribute)
    ? view
    : null;
  const selectedProject = projectOptions.find((project) => project.id === values.projectId) ?? null;
  const displayedEvent: ActivityInspectorEvent = {
    ...event,
    projectId: values.projectId,
    projectName: values.projectId === null ? null : selectedProject?.name ?? event.projectName,
    projectColor: values.projectId === null ? null : selectedProject?.color ?? event.projectColor,
    hasMixedProject,
    hasMixedCategory: new Set(segmentValues.map((item) => item.category)).size > 1,
    hasMixedProductivity: new Set(segmentValues.map((item) => item.productivity)).size > 1,
  };

  const deletedCategories = useDeletedCategories();
  const categoryChoices = useCategoryChoices();
  const productivityChoices = useProductivityChoices();
  const pickerOptions = useMemo<readonly PickerOption[]>(() => {
    if (expandedAttribute === "project") {
      const options = projectOptions.some((project) => project.id === null)
        ? projectOptions
        : [...projectOptions, { id: null, name: t("dashboard.week.inspector.noProject"), color: PRODUCTIVITY_COLORS.neutral }];
      return options.map((project) => ({
        key: project.id ?? "__no_project__",
        label: project.name,
        color: project.color,
      }));
    }
    if (expandedAttribute === "category") {
      return categoryChoices
        .filter((category) => category !== "unknown" && (!deletedCategories.has(category) || category === values.category))
        .map((category) => ({
          key: category,
          label: localizedCategoryLabel(category, t),
          color: CATEGORY_COLORS[category],
        }));
    }
    if (expandedAttribute === "productivity") {
      return productivityChoices.map((productivity) => ({
        key: productivity,
        label: localizedProductivityLabel(productivity, t),
        color: PRODUCTIVITY_COLORS[productivity],
      }));
    }
    return [];
  }, [categoryChoices, productivityChoices, deletedCategories, expandedAttribute, projectOptions, t, values.category]);

  const selectedPickerKey = expandedAttribute === "project"
    ? values.projectId ?? "__no_project__"
    : expandedAttribute === "category"
      ? values.category
      : values.productivity;
  const expandedFieldLabel = expandedAttribute === "project"
    ? t("common.project")
    : expandedAttribute === "category"
      ? t("common.category")
      : t("common.productivity");

  useEffect(() => {
    const nextValues = {
      projectId: event.projectId ?? null,
      category: event.category,
      productivity: event.productivity,
    };
    setValues((current) => (
      current.projectId === nextValues.projectId
      && current.category === nextValues.category
      && current.productivity === nextValues.productivity
        ? current
        : nextValues
    ));
  }, [event.category, event.productivity, event.projectId]);

  useLayoutEffect(() => {
    if (view !== "project" || showProjectAttribute) return;
    setPickerTrigger(null);
    setView("overview");
  }, [showProjectAttribute, view]);

  useLayoutEffect(() => {
    const element = expandedAttribute ? triggerRefs.current[expandedAttribute] ?? null : null;
    setPickerTrigger((current) => {
      if (!expandedAttribute || !element) return null;
      if (current?.field === expandedAttribute && current.element === element) return current;
      return { field: expandedAttribute, element };
    });
  }, [expandedAttribute, panelElement]);

  const focusTrigger = useCallback((field: ActivityInspectorAttribute) => {
    window.requestAnimationFrame(() => {
      const target = triggerRefs.current[field] ?? inspectorRef.current;
      target?.focus({ preventScroll: true });
    });
  }, []);

  const closePicker = useCallback(() => {
    if (!expandedAttribute || busy) return;
    const field = expandedAttribute;
    setView("overview");
    focusTrigger(field);
  }, [busy, expandedAttribute, focusTrigger]);

  const close = useCallback(() => {
    if (busy) return;
    if (isPanel) onClose(false);
    else onClose();
    if (!isPanel || !anchorElement.isConnected) return;
    const trigger = anchorElement.matches("button, [tabindex]")
      ? anchorElement
      : anchorElement.querySelector<HTMLElement>("button, [tabindex]");
    if (!trigger) return;
    // Keep returning to an offscreen source from scrolling the chart back.
    trigger.dataset.activityPreviewFocusSuppressed = "true";
    trigger.focus({ preventScroll: true });
    delete trigger.dataset.activityPreviewFocusSuppressed;
  }, [anchorElement, busy, isPanel, onClose]);

  // The provider must retain one registration across edits, saves and reanchors.
  // The callback always sees the latest busy guard and parent close handler.
  const closeRef = useRef(close);
  closeRef.current = close;
  // A layout effect, so the side column learns that this activity left in the same commit that
  // removes it: a passive cleanup let one frame show the column with neither the activity nor
  // its summary, which read as a blink on the way back.
  useLayoutEffect(() => {
    if (!isPanel) return;
    return registerSelection(() => closeRef.current());
  }, [isPanel, registerSelection]);

  useLayoutEffect(() => {
    if (!isPanel || !panelActive || !panelElement || !inspectorRef.current || initialPanelFocusHandled.current) return;
    initialPanelFocusHandled.current = true;
    if (keyboardOpened) inspectorRef.current.focus({ preventScroll: true });
  }, [isPanel, keyboardOpened, panelActive, panelElement]);

  useEffect(() => {
    if(evidenceOpen)return;
    if (view === "delete") {
      inspectorRef.current?.querySelector<HTMLButtonElement>("[data-delete-cancel]")?.focus();
      return;
    }
    if (expandedAttribute || isPanel) return;
    inspectorRef.current?.focus();
  }, [expandedAttribute, isPanel, panelElement, view, evidenceOpen]);

  useEffect(() => {
    if(evidenceOpen)return;
    const handlePointerDown = (pointerEvent: PointerEvent) => {
      if (isPanel || busy || !(pointerEvent.target instanceof Node)) return;
      if (inspectorRef.current?.contains(pointerEvent.target) || pickerRef.current?.contains(pointerEvent.target)) return;
      if (pointerEvent.target instanceof Element && pointerEvent.target.closest('[data-activity-inspector-trigger="true"]')) return;
      onClose(false);
    };
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape" || keyEvent.defaultPrevented || busy) return;
      keyEvent.preventDefault();
      if (expandedAttribute) {
        closePicker();
        return;
      }
      // Beside the chart, Escape steps back from a pending delete before it
      // leaves the activity.
      if (isPanel && view === "delete") {
        setError(null);
        setView("overview");
        return;
      }
      close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, close, closePicker, expandedAttribute, isPanel, onClose, view, evidenceOpen]);

  const persistSegmentValues = useCallback(async (
    field: ActivityInspectorAttribute,
    nextSegmentValues: readonly SegmentInspectorValues[],
  ) => {
    if (onSaveValues) {
      await onSaveValues(field, nextSegmentValues);
      return;
    }
    if (field === "project") {
      const groups = new Map<string, { readonly projectId: string | null; readonly segments: ActivitySegment[] }>();
      for (const item of nextSegmentValues) {
        const key = item.projectId ?? "__no_project__";
        const group = groups.get(key) ?? { projectId: item.projectId, segments: [] };
        group.segments.push(item.segment);
        groups.set(key, group);
      }
      for (const group of groups.values()) await onAssignProject!(group.segments, group.projectId);
      return;
    }

    const groups = new Map<string, { readonly category: ActivityCategory; readonly productivity: ProductivityLabel; readonly segments: ActivitySegment[] }>();
    for (const item of nextSegmentValues) {
      const key = `${item.category}:${item.productivity}`;
      const group = groups.get(key) ?? { category: item.category, productivity: item.productivity, segments: [] };
      group.segments.push(item.segment);
      groups.set(key, group);
    }
    for (const group of groups.values()) await onClassify!(group.segments, group.category, group.productivity);
  }, [onAssignProject, onClassify, onSaveValues]);

  const saveValues = useCallback(async (
    field: ActivityInspectorAttribute,
    nextValues: InspectorValues,
    nextValueLabel: string,
    previousValues: InspectorValues = values,
  ) => {
    if (!canMutate || busy) return false;
    const previousSegmentValues = segmentValues;
    const nextSegmentValues = previousSegmentValues.map((item) => ({
      ...item,
      ...(field === "project"
        ? { projectId: nextValues.projectId }
        : field === "category"
          ? { category: nextValues.category }
          : { productivity: nextValues.productivity }),
    }));
    const changedSegmentValues = nextSegmentValues.filter((item, index) => {
      const previous = previousSegmentValues[index]!;
      return field === "project"
        ? item.projectId !== previous.projectId
        : field === "category"
          ? item.category !== previous.category
          : item.productivity !== previous.productivity;
    });
    if (changedSegmentValues.length === 0) {
      setView("overview");
      focusTrigger(field);
      return false;
    }
    if (!onSaveValues && ((field === "project" && !onAssignProject) || (field !== "project" && !onClassify))) return false;

    setValues(nextValues);
    setSegmentValues(nextSegmentValues);
    setView("overview");
    setBusy(true);
    setError(null);
    try {
      await persistSegmentValues(field, changedSegmentValues);
      setSavedChange({
        field,
        fieldLabel: field === "project" ? t("common.project") : field === "category" ? t("common.category") : t("common.productivity"),
        previousValues,
        nextValues,
        previousSegmentValues,
        changedSegmentIds: changedSegmentValues.map((item) => item.segment.id),
        nextValueLabel,
        sourceChanged: field === "category" || field === "productivity",
      });
      setBusy(false);
      focusTrigger(field);
      return true;
    } catch (caught) {
      setValues(previousValues);
      setSegmentValues(previousSegmentValues);
      setError(describeActionError(caught, t("dashboard.week.inspector.saveError")));
      setBusy(false);
      focusTrigger(field);
      return false;
    }
  }, [busy, canMutate, focusTrigger, onAssignProject, onClassify, onSaveValues, persistSegmentValues, segmentValues, t, values]);

  const selectOption = useCallback((key: string) => {
    if (!expandedAttribute || busy) return;
    if (expandedAttribute === "project") {
      const projectId = key === "__no_project__" ? null : key;
      const project = projectOptions.find((option) => option.id === projectId) ?? null;
      void saveValues(
        "project",
        { ...values, projectId },
        project?.name ?? t("dashboard.week.inspector.noProject"),
      );
      return;
    }
    if (expandedAttribute === "category") {
      const category = key as ActivityCategory;
      void saveValues("category", { ...values, category }, localizedCategoryLabel(category, t));
      return;
    }
    const productivity = key as ProductivityLabel;
    void saveValues("productivity", { ...values, productivity }, localizedProductivityLabel(productivity, t));
  }, [busy, expandedAttribute, projectOptions, saveValues, t, values]);

  const undoChange = useCallback(async () => {
    if (!savedChange || busy || !canMutate) return;
    const change = savedChange;
    setBusy(true);
    setError(null);
    try {
      const changedSegmentIds = new Set(change.changedSegmentIds);
      await persistSegmentValues(
        change.field,
        change.previousSegmentValues.filter((item) => changedSegmentIds.has(item.segment.id)),
      );
      setValues(change.previousValues);
      setSegmentValues(change.previousSegmentValues);
      setSavedChange(null);
      setBusy(false);
      focusTrigger(change.field);
    } catch (caught) {
      setError(describeActionError(caught, t("dashboard.week.inspector.saveError")));
      setBusy(false);
      focusTrigger(change.field);
    }
  }, [busy, canMutate, focusTrigger, persistSegmentValues, savedChange, t]);

  const deleteActivity = async () => {
    if (!canMutate || !onDelete || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(targetSegments.map((segment) => segment.id));
      setSavedChange(null);
      onClose();
    } catch (caught) {
      setError(describeActionError(caught, t("dashboard.week.inspector.deleteError")));
      setBusy(false);
      window.requestAnimationFrame(() => {
        inspectorRef.current?.querySelector<HTMLButtonElement>("[data-delete-confirm]")?.focus();
      });
    }
  };

  const evidenceWindows = screenEvidenceSelection?.windows;
  const evidenceClock = (ms: number) => new Date(ms).toLocaleTimeString(localeForDisplayLanguage(effectiveLanguage), {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const evidenceApps = evidenceAppNames.slice(0, 2).join(" + ");
  const evidenceName = evidenceOption?.label ?? (evidenceAppNames.length > 2
    ? t("dashboard.week.inspector.activitySummaryTitle", { activity: evidenceApps, count: evidenceAppNames.length - 2 })
    : evidenceApps || event.appName);
  const evidenceActivityLabel = logMode && logStretch
    ? `${activityLabel?.display?.title ?? event.appName} · ${new Date(logStretch.startMs).toLocaleTimeString(localeForDisplayLanguage(effectiveLanguage), { hour: "2-digit", minute: "2-digit" })}–${new Date(logStretch.endMs).toLocaleTimeString(localeForDisplayLanguage(effectiveLanguage), { hour: "2-digit", minute: "2-digit" })}`
    : event.surface === "week" && evidenceWindows?.length
      ? `${evidenceName} · ${evidenceClock(evidenceWindows[0][0])}–${evidenceClock(evidenceWindows[evidenceWindows.length - 1][1])}`
    : `${event.detailLabel ? `${event.detailLabel} — ${evidenceOption?.label ?? event.appName}` : evidenceOption?.label ?? event.appName} · ${event.startLabel}–${event.endLabel}`;
  if(evidenceOpen&&screenContext&&screenEvidenceSelection) {
    return createPortal(<ActivityScreenEvidenceModal client={screenContext} selection={screenEvidenceSelection}
      activityLabel={evidenceActivityLabel} initialRecordId={evidenceRecordId} initialPlaying={evidenceAutoplay} onRecordChange={setEvidenceResumeId}
      onClose={closeEvidence} onInvalidated={()=>onClose(false)}/>,document.body);
  }
  const portalTarget = isPanel ? panelElement : document.body;
  if (!portalTarget) return null;

  return createPortal(
    <div
      ref={inspectorRef}
      className={`week-activity-inspector${isPanel ? " week-activity-inspector--panel" : ""}`}
      style={isPanel ? { width: "100%" } : layout.style}
      role={isPanel ? "region" : "dialog"}
      aria-modal={isPanel ? undefined : "false"}
      tabIndex={-1}
      aria-label={isPanel ? t("dashboard.activityDetail.title") : undefined}
      aria-labelledby={isPanel ? undefined : "week-activity-inspector-title"}
      aria-describedby="week-activity-inspector-description"
      data-view={view}
      data-mode="pinned"
      data-side={isPanel ? undefined : layout.side}
      data-presentation={presentation}
      data-actions={isPanel ? "footer" : undefined}
    >
      {logMode ? (
        <div className="activity-log-head">
          {!activityLabel?.display ? (
            <strong className="activity-log-head__app">
              {displayedEvent.identities[0] ? localizedExcludedIdentityLabel(displayedEvent.identities[0], t) : displayedEvent.appName}
            </strong>
          ) : null}
          <ActivityLabelRow
            label={activityLabel}
            editable
            disabled={busy}
            hideOtherCards
            meta={logStretch ? (
              <ActivityLogMeta
                startMs={logStretch.startMs}
                endMs={logStretch.endMs}
                recordedSeconds={log?.recordedSeconds ?? 0}
                // A Day card opens the panel through one chart cell; the icons follow the card's
                // stretch the log describes, not that cell.
                identities={log?.identities ?? displayedEvent.identities}
                appIcons={appIcons}
              />
            ) : null}
          />
        </div>
      ) : view !== "delete" || isPanel ? (
        // In the panel the confirmation keeps the activity's own header, so the
        // reader still sees what will be deleted and has one way back.
        <ActivityInspectorHeader
          panel={isPanel}
          event={displayedEvent}
          appIcons={appIcons}
          titleId="week-activity-inspector-title"
          segments={segments}
          deviceLabelById={deviceLabelById}
          closeDisabled={busy}
          onClose={close}
        />
      ) : (
        <header className="week-activity-inspector__header">
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
          <div className="week-activity-inspector__heading">
            <strong id="week-activity-inspector-title">{t("dashboard.week.inspector.deleteTitle")}</strong>
            <span>{isPanel && event.day ? `${formatLocalizedDayLabel(event.day, effectiveLanguage)} · ` : ""}{event.startLabel}–{event.endLabel}</span>
          </div>
          <button type="button" className="week-activity-inspector__icon-button" aria-label={t("dashboard.week.inspector.close")} onClick={close} disabled={busy}>
            <CloseIcon />
          </button>
        </header>
      )}

      {(view!=="delete"||confirmInFooter)&&screenContext?.isDesktop()&&screenEvidenceSelection&&<>
        {evidenceOptions.length > 0 && (evidenceOptions.length > 1 || event.identities.length > 1) && <label className="week-activity-inspector__evidence-source">
          {t("screenContext.activitySource")}
          <select value={evidenceOption?.id ?? ""} disabled={busy} onChange={event => setEvidenceOptionId(event.target.value)}>
            {evidenceOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>}
        <ActivityScreenPreview client={screenContext} selection={screenEvidenceSelection} mode={SCREEN_PREVIEW_MODE} buttonRef={evidenceButton}
          lines={log?.runs} seek={replaySeek} initialRecordId={evidenceResumeId} onReplayState={setReplayState}
          onOpen={(recordId,options)=>{setEvidenceRecordId(recordId);setEvidenceResumeId(recordId);setEvidenceAutoplay(Boolean(options?.playing));setPickerTrigger(null);setView("overview");setEvidenceOpen(true);}}/>
      </>}
      {view !== "delete" || confirmInFooter ? (
        <ActivityInspectorBody
          event={displayedEvent}
          values={values}
          segments={targetSegments}
          appIcons={appIcons}
          deviceLabelById={deviceLabelById}
          projectOptions={projectOptions}
          actionsDisabledReason={actionsDisabledReason}
          classificationOptions={classificationOptions}
          regroupedBlockCount={regroupedBlockCount}
          mixedOverride={{
            hasMixedCategory: new Set(segmentValues.map((item) => item.category)).size > 1,
            hasMixedProductivity: new Set(segmentValues.map((item) => item.productivity)).size > 1,
          }}
          descriptionId="week-activity-inspector-description"
          workRow={logMode ? null : <ActivityLabelRow label={activityLabel} editable disabled={busy} />}
          breakdown={logMode ? <ActivityDetailLog runs={log?.runs ?? []} replay={replayState ? {
            ...replayState,
            onSeek: (run) => { replaySeekCount.current += 1; setReplaySeek({ startMs: run.startMs, endMs: run.endMs, nonce: replaySeekCount.current }); },
          } : undefined} /> : undefined}
          showActions={!isPanel}
          expandedAttribute={expandedAttribute}
          triggerRefs={triggerRefs}
          canAssignProject={Boolean(onSaveValues || onAssignProject)}
          canClassify={Boolean(onSaveValues || onClassify)}
          busy={busy}
          error={confirmInFooter && view === "delete" ? null : error}
          savedChange={savedChange}
          onToggleAttribute={(field, trigger) => {
            setError(null);
            const nextView = view === field ? "overview" : field;
            setPickerTrigger(nextView === field ? { field, element: trigger } : null);
            setView(nextView);
          }}
          onUndo={() => void undoChange()}
          onDelete={onDelete ? () => setView("delete") : undefined}
        />
      ) : null}


      {view === "delete" && !confirmInFooter ? (
        <div className="week-activity-inspector__confirmation" id="week-activity-inspector-description">
          <div className="week-activity-inspector__danger-mark" aria-hidden="true"><TrashIcon /></div>
          {/* The panel keeps the activity header above, so the question leads
              and the final button names the action without another ellipsis. */}
          <strong>{isPanel ? t("dashboard.week.inspector.deleteTitle") : deleteLabel}</strong>
          <p>{t("dashboard.week.inspector.deleteWarning", {
            records: count > 1
              ? t("dashboard.week.inspector.activities", { count })
              : t("dashboard.week.inspector.oneActivity"),
          })}</p>
          {actionsDisabledReason && actionsDisabledReason !== t("dashboard.week.remoteEditBlocked") ? <p className="week-activity-inspector__notice" role="note">{actionsDisabledReason}</p> : null}
          {error ? <p className="week-activity-inspector__error" role="alert" title={error.detail ?? undefined}>{error.message}{error.detail ? <span className="sr-only"> {error.detail}</span> : null}</p> : null}
          <footer className="week-activity-inspector__footer">
            <button type="button" className="app-btn app-btn--secondary" data-delete-cancel onClick={() => setView("overview")} disabled={busy}>{t("common.cancel")}</button>
            <button type="button" className="app-btn app-btn--danger" data-delete-confirm onClick={() => void deleteActivity()} disabled={!canMutate || !onDelete || busy} aria-busy={busy}>
              <ActionLabel busy={busy} busyLabel={t("common.deleting")}>
                {isPanel ? t("common.delete") : deleteLabel}
              </ActionLabel>
            </button>
          </footer>
        </div>
      ) : null}

      {isPanel ? (
        <ActivityPanelFooter
          {...manageActions}
          deleteStyle={deleteStyle}
          deletion={onDelete ? {
            pending: view === "delete",
            records: deleteRecords,
            error: view === "delete" ? error : null,
            busy,
            confirmDisabled: !canMutate || !onDelete || busy,
            onCancel: () => {
              setError(null);
              setView("overview");
            },
            onConfirm: () => void deleteActivity(),
          } : null}
        />
      ) : null}

      {expandedAttribute && pickerTrigger?.field === expandedAttribute ? (
        <DirectAttributePicker
          field={expandedAttribute}
          fieldLabel={expandedFieldLabel}
          triggerElement={pickerTrigger.element}
          options={pickerOptions}
          selectedKey={selectedPickerKey}
          recordCount={count}
          busy={busy}
          pickerRef={pickerRef}
          onClose={closePicker}
          onSelect={selectOption}
          onManage={onEditCategories ? () => {
            const target: CategoryEditorTarget = expandedAttribute === "project"
              ? { group: "project", key: values.projectId ?? undefined }
              : expandedAttribute === "category"
                ? { group: "category", key: values.category }
                : { group: "productivity", key: values.productivity };
            // The editor is a dialog; the inspector card does not wait under it.
            onClose(false);
            onEditCategories(target);
          } : undefined}
        />
      ) : null}
    </div>,
    portalTarget,
  );
}
