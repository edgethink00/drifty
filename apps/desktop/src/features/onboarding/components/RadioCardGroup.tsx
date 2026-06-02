type Option = {
  value: string;
  label: string;
};

type Props = {
  options: ReadonlyArray<Option>;
  value: string | null;
  onChange: (value: string) => void;
  groupLabel: string;
};

export function RadioCardGroup({ options, value, onChange, groupLabel }: Props) {
  return (
    <div className="onb-radio-cards" role="radiogroup" aria-label={groupLabel}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            type="button"
            key={option.value}
            className={`onb-radio-card${selected ? " onb-radio-card--selected" : ""}`}
            onClick={() => onChange(option.value)}
            role="radio"
            aria-checked={selected}
          >
            <span className="onb-radio-card__radio" aria-hidden="true" />
            <span className="onb-radio-card__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
