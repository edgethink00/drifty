import { useLocalization } from "../localization/LocalizationContext";

type FeatureNewBadgeProps = {
  readonly className?: string;
};

export function FeatureNewBadge({ className }: FeatureNewBadgeProps) {
  const { t } = useLocalization();
  const classes = ["status-badge", "status-badge--new", className].filter(Boolean).join(" ");
  return (
    <span className={classes} aria-hidden="true">{t("common.new")}</span>
  );
}
