import { ActionLabel } from "../../components/ActionLabel";
import { useLocalization } from "../localization/LocalizationContext";
import type { ProviderCredentialRecovery } from "./useProviderKeyPersistence";

/** A connection can work with an in-memory key before its changes are durable. */
export function ProviderCredentialNotice({ recovery }: { readonly recovery?: ProviderCredentialRecovery }) {
  const { t } = useLocalization();
  if (!recovery || (recovery.state !== "error" && !recovery.recovering)) return null;
  return <div className="settings-permission-error" role={recovery.recovering ? "status" : "alert"}>
    <span>{t(recovery.pending ? "settings.ai.credentialUnsaved" : "settings.ai.credentialReadFailed")}</span>{" "}
    <button type="button" className="settings-inline-link" disabled={recovery.recovering}
      aria-busy={recovery.recovering || undefined} onClick={() => void recovery.recover()}>
      <ActionLabel busy={recovery.recovering} busyLabel={t("settings.ai.credentialRecovering")}>
        {t("settings.ai.credentialRecover")}
      </ActionLabel>
    </button>
  </div>;
}
