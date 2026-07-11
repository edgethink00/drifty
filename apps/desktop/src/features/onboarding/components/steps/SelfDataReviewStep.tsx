import type { OnboardingFlow } from "../../useOnboardingFlow";
import { useLocalization } from "../../../localization/LocalizationContext";

export function SelfDataReviewStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const maskedApiKey = flow.maskedApiKey?.replace("••••••", "......") ?? null;
  const isByok = flow.isByokSetup;
  const isCustom = flow.isCustomEndpointSetup;
  const reviewIntro = isByok
    ? t("onboarding.data.byokIntro")
    : isCustom
      ? t("onboarding.data.customIntro")
      : t("onboarding.data.localIntro");
  const whereDesc = isByok
    ? t("onboarding.data.byokWhere")
    : isCustom
      ? t("onboarding.data.customWhere")
      : t("onboarding.data.localWhere");
  const whoDesc = isByok
    ? t("onboarding.data.byokWho")
    : isCustom
      ? t("onboarding.data.customWho")
      : t("onboarding.data.localWho");
  const whatDesc = isByok
    ? t("onboarding.data.byokWhat", { maskedKey: maskedApiKey ? ` (${maskedApiKey})` : "" })
    : isCustom
      ? t("onboarding.data.customWhat", { model: flow.customEndpointDraft.model.trim() || t("onboarding.data.yourModel"), endpoint: flow.customEndpointDraft.baseUrl.trim() })
      : t("onboarding.data.localWhat");

  return (
    <>
      <p className="dc-onb-copy dc-onb-copy--wide">{reviewIntro}</p>
      <div className="dc-onb-data-grid">
        <DataCard title={t("onboarding.data.where")} description={whereDesc} />
        <DataCard title={t("onboarding.data.who")} description={whoDesc} />
        <DataCard title={t("onboarding.data.what")} description={whatDesc} />
      </div>
      <p className="dc-onb-muted-note">{t("onboarding.data.changeLater")}</p>
    </>
  );
}

function DataCard({ description, title }: { readonly description: string; readonly title: string }) {
  return (
    <div className="dc-onb-data-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
