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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
  type SVGProps,
} from "react";
import { createPortal } from "react-dom";
import { AppGlyph } from "../../components/AppGlyph";
import { ANCHORED_CARD_GAP, getViewportSafeAnchoredPosition, isAnchorOutsideViewport } from "../../components/anchoredCardPosition";
import { SiteFavicon } from "../../components/SiteFavicon";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import type { DisplayLanguage } from "../localization/languagePreference";

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
  readonly id: string;
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
  }[];
  readonly hiddenIdentityCount?: number;
  readonly hasMixedProject?: boolean;
  readonly hasMixedCategory: boolean;
  readonly hasMixedProductivity: boolean;
  readonly detailLabel?: string | null;
  readonly durationSeconds?: number;
  readonly deviceLabels?: readonly string[];
};

type WeekActivityInspectorProps = {
  readonly event: ActivityInspectorEvent;
  readonly segments: readonly ActivitySegment[];
  readonly appIcons: AppIconMap;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly anchorElement: HTMLElement;
  readonly actionsDisabledReason?: string | null;
  readonly classificationOptions?: ClassificationOptions;
  readonly projectOptions?: readonly ActivityInspectorProjectOption[];
  readonly initialView?: ActivityInspectorView;
  readonly regroupedBlockCount?: number;
  readonly onClose: (restoreFocus?: boolean) => void;
  readonly onSaveValues?: ActivityInspectorSaveHandler;
  readonly onAssignProject?: (
    segments: readonly ActivitySegment[],
    projectId: string | null,
  ) => Promise<void>;
  readonly onClassify?: (
    segments: readonly ActivitySegment[],
    category: ActivityCategory,
    productivity: ProductivityLabel,
  ) => Promise<void>;
  readonly onDelete?: (segmentIds: readonly string[]) => Promise<void>;
};

type InspectorValues = {
  readonly projectId: string | null;
  readonly category: ActivityCategory;
  readonly productivity: ProductivityLabel;
};

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

function calculateAnchoredLayout(anchorElement: HTMLElement, cardElement: HTMLDivElement | null): AnchoredCardLayout {
  const anchorRect = anchorElement.getBoundingClientRect();
  const measuredHeight = cardElement?.getBoundingClientRect().height ?? 0;
  const height = measuredHeight > 0
    ? measuredHeight
    : Math.min(280, (typeof window === "undefined" ? 280 : window.innerHeight) - 32);
  const position = getViewportSafeAnchoredPosition(anchorRect, INSPECTOR_WIDTH_PX, height);
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
): AnchoredCardLayout {
  const onAnchorUnavailableRef = useRef(onAnchorUnavailable);
  onAnchorUnavailableRef.current = onAnchorUnavailable;
  const [layout, setLayout] = useState<AnchoredCardLayout>(() => calculateAnchoredLayout(anchorElement, null));

  const updateLayout = useCallback(() => {
    if (!anchorElement.isConnected) {
      onAnchorUnavailableRef.current();
      return;
    }
    const anchorRect = anchorElement.getBoundingClientRect();
    if (isAnchorOutsideViewport(anchorRect)) {
      onAnchorUnavailableRef.current();
      return;
    }
    const next = calculateAnchoredLayout(anchorElement, cardRef.current);
    setLayout((current) => (
      current.side === next.side
      && current.height === next.height
      && current.style.left === next.style.left
      && current.style.top === next.style.top
        ? current
        : next
    ));
  }, [anchorElement, cardRef]);

  useLayoutEffect(() => updateLayout(), [layoutKey, updateLayout]);

  useEffect(() => {
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updateLayout) : null;
    observer?.observe(anchorElement);
    if (cardRef.current) observer?.observe(cardRef.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
    };
  }, [anchorElement, cardRef, updateLayout]);

  return layout;
}

function calculateHoverBridgeStyle(
  anchorElement: HTMLElement,
  layout: AnchoredCardLayout,
): CSSProperties {
  const anchorRect = anchorElement.getBoundingClientRect();
  const cardLeft = Number(layout.style.left ?? 0);
  const cardTop = Number(layout.style.top ?? 0);
  const bridgeTop = Math.min(anchorRect.top, cardTop);
  const bridgeBottom = Math.max(anchorRect.bottom, cardTop + layout.height);
  const left = layout.side === "right" ? anchorRect.right : cardLeft + INSPECTOR_WIDTH_PX;
  const width = layout.side === "right"
    ? cardLeft - anchorRect.right
    : anchorRect.left - left;
  return {
    left,
    top: bridgeTop,
    width: Math.max(0, Math.min(ANCHORED_CARD_GAP, width)),
    // Week blocks can be taller than the preview. Cover the full vertical
    // union so moving sideways from any point on the source block cannot hit
    // a neighboring calendar event before reaching the portaled card.
    height: Math.max(0, bridgeBottom - bridgeTop),
  };
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
    const labelWidth = Number.parseFloat(triggerStyle.getPropertyValue("--inspector-attribute-label-width")) || 60;
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
  const identity = event.identities[0] ?? null;
  const iconSrc = identityIconSrc(event, appIcons);
  return identity?.siteDomain
    ? <SiteFavicon domain={identity.siteDomain} size={20} fallbackIconSrc={iconSrc} />
    : <AppGlyph appName={identity?.label ?? event.appName} iconSrc={iconSrc} size="sm" />;
}

function ActivityInspectorHeader({
  event,
  appIcons,
  titleId,
  closeDisabled = false,
  onClose,
}: {
  readonly event: ActivityInspectorEvent;
  readonly appIcons: AppIconMap;
  readonly titleId: string;
  readonly closeDisabled?: boolean;
  readonly onClose: () => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const identityCount = event.identities.length + (event.hiddenIdentityCount ?? 0);
  const primaryIdentity = event.identities[0] ?? null;
  const title = event.surface === "week" && primaryIdentity && identityCount >= 3
    ? t("dashboard.week.inspector.activitySummaryTitle", {
        activity: primaryIdentity.label,
        count: identityCount - 1,
      })
    : event.appName;
  return (
    <header className="week-activity-inspector__header">
      <span className="week-activity-inspector__identity" aria-hidden="true">
        <InspectorIdentityIcon event={event} appIcons={appIcons} />
      </span>
      <div className="week-activity-inspector__heading">
        <strong id={titleId} title={event.appName}>{title}</strong>
        {event.detailLabel ? (
          <span className="week-activity-inspector__context" title={event.detailLabel}>{event.detailLabel}</span>
        ) : null}
        <span className="week-activity-inspector__time">
          {event.startLabel}–{event.endLabel}
          {event.durationSeconds !== undefined
            ? ` · ${formatLocalizedCompactDurationFromSeconds(event.durationSeconds, effectiveLanguage)}`
            : ""}
        </span>
      </div>
      <button
        type="button"
        className="week-activity-inspector__icon-button"
        aria-label={t("dashboard.week.inspector.close")}
        onClick={onClose}
        disabled={closeDisabled}
      >
        <CloseIcon />
      </button>
    </header>
  );
}

function AttributeChip({ color, label }: { readonly color: string; readonly label: string }) {
  return (
    <span
      className="week-activity-inspector__chip"
      style={{ "--inspector-chip-color": color } as CSSProperties & Record<"--inspector-chip-color", string>}
    >
      <i aria-hidden="true" />
      <span>{label}</span>
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
  readonly triggerRef?: (element: HTMLButtonElement | null) => void;
  readonly onToggle?: (field: ActivityInspectorAttribute, trigger: HTMLButtonElement) => void;
}) {
  const { t } = useLocalization();
  const displayedValue = mixed
    ? `${valueLabel} · ${t("dashboard.week.inspector.dominant")}`
    : valueLabel;
  return (
    <div className="week-activity-inspector__attribute">
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
        <span className="week-activity-inspector__attribute-label">{label}</span>
        <AttributeChip color={color} label={valueLabel} />
        <span className="week-activity-inspector__attribute-chevron" aria-hidden="true"><ChevronIcon direction="down" /></span>
      </button>
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
    </div>,
    document.body,
  );
}

// Sub-minute shares would round to "0"/"1m"; the breakdown is exactly where those
// thin runner-ups matter, so keep seconds visible below one minute.
function formatActivityShareDuration(totalSeconds: number, language: DisplayLanguage): string {
  if (totalSeconds < 60) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    return language === "ko" ? `${seconds}초` : `${seconds}s`;
  }
  return formatLocalizedCompactDurationFromSeconds(totalSeconds, language);
}

function ActivityBreakdown({ event, appIcons }: { readonly event: ActivityInspectorEvent; readonly appIcons: AppIconMap }) {
  const { effectiveLanguage, t } = useLocalization();
  if (event.identities.length === 0) return null;
  // A flow cell paints one winner; only list its composition when something else shared it.
  const isFlowComposition = event.surface === "flow";
  if (isFlowComposition && event.identities.length < 2) return null;
  if (!isFlowComposition && event.surface !== "week") return null;
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
        const isDominant = isFlowComposition && index === 0;
        const rowLabel = isDominant
          ? `${identity.label} · ${t("dashboard.week.inspector.dominant")}`
          : identity.label;
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
                : <AppGlyph appName={identity.label} iconSrc={iconSrc} size="sm" />}
            </span>
            <span title={rowLabel}>{rowLabel}</span>
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

function remoteDeviceLabels(
  event: ActivityInspectorEvent,
  segments: readonly ActivitySegment[],
  deviceLabelById?: ReadonlyMap<string, string>,
): string[] {
  const labels = new Set(event.deviceLabels ?? []);
  for (const segment of segments) {
    if (!isRemoteDeviceSegment(segment)) continue;
    labels.add(deviceLabelById?.get(segment.deviceId ?? "") ?? "Synced Mac");
  }
  return [...labels];
}

function ActivityInspectorBody({
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
}: {
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
  readonly expandedAttribute?: ActivityInspectorAttribute | null;
  readonly triggerRefs?: RefObject<Partial<Record<ActivityInspectorAttribute, HTMLButtonElement | null>>>;
  readonly canAssignProject?: boolean;
  readonly canClassify?: boolean;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly savedChange?: SavedDirectChange | null;
  readonly onToggleAttribute?: (field: ActivityInspectorAttribute, trigger: HTMLButtonElement) => void;
  readonly onUndo?: () => void;
  readonly onDelete?: () => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
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
    : currentProject?.name ?? event.projectName ?? t("dashboard.week.inspector.noProject");
  const projectColor = values.projectId === null
    ? PRODUCTIVITY_COLORS.neutral
    : currentProject?.color ?? event.projectColor ?? PRODUCTIVITY_COLORS.neutral;
  const devices = remoteDeviceLabels(event, segments, deviceLabelById);

  const rows: readonly {
    field: ActivityInspectorAttribute;
    label: string;
    valueLabel: string;
    color: string;
    mixed: boolean;
  }[] = [
    {
      field: "project",
      label: t("common.project"),
      valueLabel: projectLabel,
      color: projectColor,
      mixed: Boolean(event.hasMixedProject) && values.projectId === (event.projectId ?? null),
    },
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
  const hasMixedValues = rows.some((row) => row.mixed);

  return (
    <>
      {regroupedBlockCount > 1 ? (
        <div className="week-activity-inspector__regroup-notice" role="status">
          {t("dashboard.week.inspector.regroupedBlocks", { count: regroupedBlockCount })}
        </div>
      ) : null}
      <div className="week-activity-inspector__attributes" id={descriptionId}>
        {hasMixedValues ? (
          <p className="week-activity-inspector__mixed-summary">
            {t("dashboard.week.inspector.dominantValuesSummary")}
          </p>
        ) : null}
        {rows.map((row) => (
          <DirectAttributeRow
            key={row.field}
            {...row}
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

      {devices.length > 0 ? (
        <div className="week-activity-inspector__devices">
          {devices.map((device) => (
            <span className="week-activity-inspector__device-chip" key={device}>
              {effectiveLanguage === "ko" && device === "Synced Mac" ? "동기화된 Mac" : device}
            </span>
          ))}
        </div>
      ) : null}

      <ActivityBreakdown event={event} appIcons={appIcons} />

      {actionsDisabledReason ? (
        <p className="week-activity-inspector__notice" role="note">{actionsDisabledReason}</p>
      ) : null}
      {error ? <p className="week-activity-inspector__error" role="alert">{error}</p> : null}

      <div className="week-activity-inspector__actions week-activity-inspector__actions--destructive">
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
      </div>
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
  restoreFocusOnDismiss = false,
  actionsDisabledReason,
  classificationOptions,
  projectOptions = [],
  canAssignProject = false,
  canClassify = false,
  onDismiss,
  onOpenAttribute,
  onRequestDelete,
  onPointerEnter,
  onPointerLeave,
  onFocusEnter,
  onFocusLeave,
}: {
  readonly event: ActivityInspectorEvent;
  readonly segments: readonly ActivitySegment[];
  readonly appIcons: AppIconMap;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly anchorElement: HTMLElement;
  readonly descriptionTarget?: HTMLElement;
  readonly restoreFocusOnDismiss?: boolean;
  readonly actionsDisabledReason: string | null;
  readonly classificationOptions?: ClassificationOptions;
  readonly projectOptions?: readonly ActivityInspectorProjectOption[];
  readonly canAssignProject?: boolean;
  readonly canClassify?: boolean;
  readonly onDismiss: () => void;
  readonly onOpenAttribute?: (field: ActivityInspectorAttribute) => void;
  readonly onRequestDelete?: () => void;
  readonly onPointerEnter?: () => void;
  readonly onPointerLeave?: () => void;
  readonly onFocusEnter?: () => void;
  readonly onFocusLeave?: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const layout = useAnchoredCardLayout(anchorElement, previewRef, event.id, onDismiss);
  const hoverBridgeStyle = calculateHoverBridgeStyle(anchorElement, layout);
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
      if (!descriptionIds.includes(descriptionId)) focusTarget.setAttribute("aria-describedby", [...descriptionIds, descriptionId].join(" "));
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
        .filter((descriptionIdValue) => descriptionIdValue && descriptionIdValue !== descriptionId);
      if (remainingIds.length === 0) focusTarget.removeAttribute("aria-describedby");
      else focusTarget.setAttribute("aria-describedby", remainingIds.join(" "));
    };
  }, [descriptionId, dismissWithFocusRestore, focusTarget]);

  return createPortal(
    <>
      <div
        className="week-activity-inspector__hover-bridge"
        style={hoverBridgeStyle}
        aria-hidden="true"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      />
      <div
        id={dialogId}
        ref={previewRef}
        className="week-activity-inspector week-activity-inspector--preview"
        style={layout.style}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-mode="peek"
        data-side={layout.side}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocusCapture={onFocusEnter}
        onBlurCapture={(focusEvent) => {
          if (!focusEvent.currentTarget.contains(focusEvent.relatedTarget)) onFocusLeave?.();
        }}
      >
        <ActivityInspectorHeader event={event} appIcons={appIcons} titleId={titleId} onClose={dismissWithFocusRestore} />
        <ActivityInspectorBody
          event={event}
          values={values}
          segments={segments}
          appIcons={appIcons}
          deviceLabelById={deviceLabelById}
          projectOptions={projectOptions}
          actionsDisabledReason={actionsDisabledReason}
          classificationOptions={classificationOptions}
          descriptionId={descriptionId}
          canAssignProject={canAssignProject}
          canClassify={canClassify}
          onToggleAttribute={onOpenAttribute
            ? (field) => onOpenAttribute(field)
            : undefined}
          onDelete={onRequestDelete}
        />
      </div>
    </>,
    document.body,
  );
}

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
  regroupedBlockCount = 1,
  onClose,
  onSaveValues,
  onAssignProject,
  onClassify,
  onDelete,
}: WeekActivityInspectorProps) {
  const { t } = useLocalization();
  const targetSegmentsRef = useRef(segments);
  const targetSegments = targetSegmentsRef.current;
  const [view, setView] = useState<ActivityInspectorView>(initialView);
  const [values, setValues] = useState<InspectorValues>({
    projectId: event.projectId ?? null,
    category: event.category,
    productivity: event.productivity,
  });
  const [segmentValues, setSegmentValues] = useState<readonly SegmentInspectorValues[]>(() => (
    buildSegmentInspectorValues(event, targetSegments, classificationOptions)
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedChange, setSavedChange] = useState<SavedDirectChange | null>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Partial<Record<ActivityInspectorAttribute, HTMLButtonElement | null>>>({});
  const [pickerTrigger, setPickerTrigger] = useState<{
    readonly field: ActivityInspectorAttribute;
    readonly element: HTMLButtonElement;
  } | null>(null);
  const layout = useAnchoredCardLayout(
    anchorElement,
    inspectorRef,
    `${event.id}:${view}:${error ?? ""}:${savedChange?.nextValueLabel ?? ""}`,
    () => onClose(false),
  );
  const count = targetSegments.length;
  const canMutate = !actionsDisabledReason && count > 0;
  const expandedAttribute = view === "project" || view === "category" || view === "productivity" ? view : null;
  const selectedProject = projectOptions.find((project) => project.id === values.projectId) ?? null;
  const displayedEvent: ActivityInspectorEvent = {
    ...event,
    projectId: values.projectId,
    projectName: values.projectId === null ? null : selectedProject?.name ?? event.projectName,
    projectColor: values.projectId === null ? null : selectedProject?.color ?? event.projectColor,
    hasMixedProject: new Set(segmentValues.map((item) => item.projectId ?? "__no_project__")).size > 1,
    hasMixedCategory: new Set(segmentValues.map((item) => item.category)).size > 1,
    hasMixedProductivity: new Set(segmentValues.map((item) => item.productivity)).size > 1,
  };

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
      return CATEGORY_ORDER
        .filter((category) => category !== "unknown")
        .map((category) => ({
          key: category,
          label: localizedCategoryLabel(category, t),
          color: CATEGORY_COLORS[category],
        }));
    }
    if (expandedAttribute === "productivity") {
      return PRODUCTIVITY_ORDER.map((productivity) => ({
        key: productivity,
        label: localizedProductivityLabel(productivity, t),
        color: PRODUCTIVITY_COLORS[productivity],
      }));
    }
    return [];
  }, [expandedAttribute, projectOptions, t]);

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
    const element = expandedAttribute ? triggerRefs.current[expandedAttribute] ?? null : null;
    setPickerTrigger((current) => {
      if (!expandedAttribute || !element) return null;
      if (current?.field === expandedAttribute && current.element === element) return current;
      return { field: expandedAttribute, element };
    });
  }, [expandedAttribute]);

  const focusTrigger = useCallback((field: ActivityInspectorAttribute) => {
    window.requestAnimationFrame(() => triggerRefs.current[field]?.focus({ preventScroll: true }));
  }, []);

  const closePicker = useCallback(() => {
    if (!expandedAttribute || busy) return;
    const field = expandedAttribute;
    setView("overview");
    focusTrigger(field);
  }, [busy, expandedAttribute, focusTrigger]);

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (view === "delete") {
      inspectorRef.current?.querySelector<HTMLButtonElement>(".week-activity-inspector__footer .app-btn--secondary")?.focus();
      return;
    }
    if (expandedAttribute) return;
    inspectorRef.current?.focus();
  }, [expandedAttribute, view]);

  useEffect(() => {
    const handlePointerDown = (pointerEvent: PointerEvent) => {
      if (busy || !(pointerEvent.target instanceof Node)) return;
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
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, closePicker, expandedAttribute, onClose]);

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
      setError(caught instanceof Error ? caught.message : t("dashboard.week.inspector.saveError"));
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
      setError(caught instanceof Error ? caught.message : t("dashboard.week.inspector.saveError"));
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
      setError(caught instanceof Error ? caught.message : t("dashboard.week.inspector.deleteError"));
      setBusy(false);
      window.requestAnimationFrame(() => {
        inspectorRef.current?.querySelector<HTMLButtonElement>(".week-activity-inspector__footer .app-btn--danger")?.focus();
      });
    }
  };

  return createPortal(
    <div
      ref={inspectorRef}
      className="week-activity-inspector"
      style={layout.style}
      role="dialog"
      aria-modal="false"
      tabIndex={-1}
      aria-labelledby="week-activity-inspector-title"
      aria-describedby="week-activity-inspector-description"
      data-view={view}
      data-mode="pinned"
      data-side={layout.side}
    >
      {view !== "delete" ? (
        <ActivityInspectorHeader
          event={displayedEvent}
          appIcons={appIcons}
          titleId="week-activity-inspector-title"
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
            <span>{event.startLabel}–{event.endLabel}</span>
          </div>
          <button type="button" className="week-activity-inspector__icon-button" aria-label={t("dashboard.week.inspector.close")} onClick={close} disabled={busy}>
            <CloseIcon />
          </button>
        </header>
      )}

      {view !== "delete" ? (
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
          expandedAttribute={expandedAttribute}
          triggerRefs={triggerRefs}
          canAssignProject={Boolean(onSaveValues || onAssignProject)}
          canClassify={Boolean(onSaveValues || onClassify)}
          busy={busy}
          error={error}
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
        />
      ) : null}

      {view === "delete" ? (
        <div className="week-activity-inspector__confirmation" id="week-activity-inspector-description">
          <div className="week-activity-inspector__danger-mark" aria-hidden="true"><TrashIcon /></div>
          <strong>{count > 1 ? t("dashboard.week.inspector.deleteActivities", { count }) : t("dashboard.week.inspector.delete")}</strong>
          <p>{t("dashboard.week.inspector.deleteWarning", {
            records: count > 1
              ? t("dashboard.week.inspector.activities", { count })
              : t("dashboard.week.inspector.oneActivity"),
          })}</p>
          {actionsDisabledReason ? <p className="week-activity-inspector__notice" role="note">{actionsDisabledReason}</p> : null}
          {error ? <p className="week-activity-inspector__error" role="alert">{error}</p> : null}
          <footer className="week-activity-inspector__footer">
            <button type="button" className="app-btn app-btn--secondary" onClick={() => setView("overview")} disabled={busy}>{t("common.cancel")}</button>
            <button type="button" className="app-btn app-btn--danger" onClick={() => void deleteActivity()} disabled={!canMutate || !onDelete || busy}>
              {busy
                ? t("common.deleting")
                : count > 1
                  ? t("dashboard.week.inspector.deleteActivities", { count })
                  : t("dashboard.week.inspector.delete")}
            </button>
          </footer>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
