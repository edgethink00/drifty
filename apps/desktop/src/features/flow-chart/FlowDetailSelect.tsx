import { FLOW_INTERVAL_OPTIONS, type FlowIntervalMinutes } from "@drifty/domain";
import { SettingsSelect } from "../settings/SettingsSelect";

const FLOW_DETAIL_VALUE_BY_INTERVAL = {
  3: "3",
  4: "4",
  5: "5",
  6: "6",
} as const satisfies Readonly<Record<FlowIntervalMinutes, string>>;

type FlowDetailValue = (typeof FLOW_DETAIL_VALUE_BY_INTERVAL)[FlowIntervalMinutes];

const FLOW_DETAIL_OPTIONS = FLOW_INTERVAL_OPTIONS.map((intervalMinutes) => ({
  value: FLOW_DETAIL_VALUE_BY_INTERVAL[intervalMinutes],
  label: `${intervalMinutes}m`,
}));

function flowIntervalFromDetailValue(value: FlowDetailValue): FlowIntervalMinutes {
  const intervalMinutes = FLOW_INTERVAL_OPTIONS.find(
    (option) => FLOW_DETAIL_VALUE_BY_INTERVAL[option] === value,
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
      value={FLOW_DETAIL_VALUE_BY_INTERVAL[intervalMinutes]}
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
