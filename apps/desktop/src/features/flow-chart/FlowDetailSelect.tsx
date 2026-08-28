import { FLOW_INTERVAL_OPTIONS, type FlowIntervalMinutes } from "@drifty/domain";
import { SettingsSelect } from "../settings/SettingsSelect";

const FLOW_DETAIL_COPY_BY_INTERVAL = {
  3: { value: "3", description: "More detail" },
  4: { value: "4", description: "Balanced" },
  5: { value: "5", description: "Less detail" },
  6: { value: "6", description: "Least detail" },
} as const satisfies Readonly<Record<FlowIntervalMinutes, { readonly value: string; readonly description: string }>>;

type FlowDetailValue = (typeof FLOW_DETAIL_COPY_BY_INTERVAL)[FlowIntervalMinutes]["value"];

const FLOW_DETAIL_OPTIONS = FLOW_INTERVAL_OPTIONS.map((intervalMinutes) => {
  const copy = FLOW_DETAIL_COPY_BY_INTERVAL[intervalMinutes];
  return {
    value: copy.value,
    label: `${intervalMinutes} min · ${copy.description}`,
  };
});

function flowIntervalFromDetailValue(value: FlowDetailValue): FlowIntervalMinutes {
  const intervalMinutes = FLOW_INTERVAL_OPTIONS.find(
    (option) => FLOW_DETAIL_COPY_BY_INTERVAL[option].value === value,
  );
  if (intervalMinutes === undefined) throw new Error(`Unsupported Flow detail value: ${value}`);
  return intervalMinutes;
}

/** Shared timeline-density control used by every surface built on the Flow grid. */
export function FlowDetailSelect({
  intervalMinutes,
  onIntervalChange,
}: {
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly onIntervalChange: (intervalMinutes: FlowIntervalMinutes) => void;
}) {
  return (
    <SettingsSelect
      ariaLabel="Flow detail"
      className="flow-detail-select"
      value={FLOW_DETAIL_COPY_BY_INTERVAL[intervalMinutes].value}
      options={FLOW_DETAIL_OPTIONS}
      onChange={(value) => onIntervalChange(flowIntervalFromDetailValue(value))}
      triggerVisual={<FlowDetailIcon />}
    />
  );
}

function FlowDetailIcon() {
  return (
    <svg className="flow-detail-select__icon" viewBox="0 0 18 6" fill="currentColor">
      <circle cx="3" cy="3" r="1.25" />
      <circle cx="9" cy="3" r="1.25" />
      <circle cx="15" cy="3" r="1.25" />
    </svg>
  );
}
