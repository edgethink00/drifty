import { formatLocalizedDuration } from "../../lib/formatting";
import { FLOW_INTERVAL_OPTIONS, type FlowIntervalMinutes } from "@drifty/domain";
import { SettingsSelect } from "../settings/SettingsSelect";
import { useLocalization } from "../localization/LocalizationContext";

const FLOW_DETAIL_VALUE_BY_INTERVAL = {
  3: "3",
  4: "4",
  5: "5",
  6: "6",
} as const satisfies Readonly<Record<FlowIntervalMinutes, string>>;

type FlowDetailValue = (typeof FLOW_DETAIL_VALUE_BY_INTERVAL)[FlowIntervalMinutes];

function flowIntervalFromDetailValue(value: FlowDetailValue): FlowIntervalMinutes {
  const intervalMinutes = FLOW_INTERVAL_OPTIONS.find(
    (option) => FLOW_DETAIL_VALUE_BY_INTERVAL[option] === value,
  );
  if (intervalMinutes === undefined) throw new Error(`Unsupported Flow detail value: ${value}`);
  return intervalMinutes;
}

/** Timeline-density control for the adjustable Your Agents grid. */
export function FlowDetailSelect({
  intervalMinutes,
  onIntervalChange,
}: {
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly onIntervalChange: (intervalMinutes: FlowIntervalMinutes) => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const options = FLOW_INTERVAL_OPTIONS.map((optionMinutes) => ({
    value: FLOW_DETAIL_VALUE_BY_INTERVAL[optionMinutes],
    label: formatLocalizedDuration(optionMinutes * 60, effectiveLanguage),
  }));
  return (
    <SettingsSelect
      ariaLabel={t("dashboard.today.flowDetail")}
      className="flow-detail-select"
      value={FLOW_DETAIL_VALUE_BY_INTERVAL[intervalMinutes]}
      options={options}
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
