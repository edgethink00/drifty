import { useLocalization } from "../localization/LocalizationContext";

export function DeferredPageImportFallback({ label }: { readonly label: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const localizedLabel = label === "team"
    ? t("team.page.teams")
    : effectiveLanguage === "en"
    ? label
    : label === "classification"
    ? t("nav.classification")
    : label === "projects"
      ? t("nav.projects")
      : label === "trends"
        ? t("nav.trends")
        : label === "history"
          ? t("nav.history")
          : label === "leaderboard"
            ? t("nav.leaderboard")
            : label;
  return (
    <section
      className="page page--loading-skeleton deferred-page-import"
      role="status"
      aria-live="polite"
      aria-label={t("loading.pageAria", { label: localizedLabel })}
    >
      <div className="empty-state">
        <strong>{t("loading.page", { label: localizedLabel })}</strong>
      </div>
    </section>
  );
}
