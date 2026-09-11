import type { ManagedLocalAiStatus } from "../../../settings/managedLocalAiClient";
import { managedLocalAiProgressText, managedLocalAiProgressValue } from "../../../settings/managedLocalAiProgressText";
import { remainingLabelText } from "../../../loading/remainingEstimateCopy";
import { useRemainingEstimate } from "../../../loading/useRemainingEstimate";
import { useLocalization } from "../../../localization/LocalizationContext";

/**
 * The managed model download is the longest wait in onboarding — gigabytes over
 * an unknown connection — and it used to be represented by a spinner plus a
 * percentage buried in a button label. A real bar with the transferred size and
 * a rough remaining time is what turns "is this stuck?" into a wait someone can
 * plan around.
 */
export function ManagedModelDownloadProgress({ status }: { readonly status: ManagedLocalAiStatus | null }) {
  const { t } = useLocalization();
  const installing = status?.state === "installing";
  const progress = installing ? status.progress : null;
  const value = managedLocalAiProgressValue(progress);
  const remaining = useRemainingEstimate({
    enabled: installing,
    resetKey: status?.selectedModelId ?? "",
    value,
  });

  if (!installing) return null;

  const percent = Math.min(100, Math.max(0, Math.round(progress?.percent ?? 0)));
  const sizeText = managedLocalAiProgressText(progress);
  const remainingCopy = remainingLabelText(remaining, t);

  return (
    <div className="dc-onb-download">
      <div
        className="dc-onb-download__track"
        role="progressbar"
        aria-label={t("onboarding.connection.downloading")}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(progress ? { "aria-valuenow": percent } : {})}
      >
        <span
          className={progress ? "dc-onb-download__fill" : "dc-onb-download__fill dc-onb-download__fill--indeterminate"}
          style={progress ? { width: `${percent}%` } : undefined}
        />
      </div>
      {progress ? (
        // The bar already carries the value for assistive tech; repeating the same
        // numbers as live text would only make the announcement noisier.
        <div className="dc-onb-download__meta" aria-hidden="true">
          <span className="dc-onb-download__percent">{percent}%</span>
          {sizeText ? <span>{sizeText}</span> : null}
          {remainingCopy ? <span>{remainingCopy}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
