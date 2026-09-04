import logoUrl from "../../assets/drifty-icon.png";
import markUrl from "../../assets/drifty-mark.svg";
import { useLocalization } from "../localization/LocalizationContext";

export function AuthConfigurationGate() {
  const { t } = useLocalization();

  return (
    <main className="auth-gate" aria-label={t("auth.gate.configurationAria")}>
      <div className="auth-card auth-card--blocking">
        <div className="auth-card__brand">Drifty</div>
        <h2>{t("auth.gate.configurationTitle")}</h2>
        <p>{t("auth.gate.configurationDetail")}</p>
      </div>
    </main>
  );
}

export function AuthRequiredGate({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useLocalization();

  return (
    <main className="auth-gate" aria-label={t("auth.gate.requiredAria")}>
      <div className="auth-card auth-card--blocking auth-card--required">
        <div className="auth-card__brand auth-card__brand--symbol">
          <img className="auth-card__brand-logo" src={logoUrl} alt="Drifty" />
        </div>
        <h2>{t("auth.gate.requiredTitle")}</h2>
        <div className="auth-card__actions auth-card__actions--required">
          <button type="button" className="app-btn app-btn--primary auth-card__action" onClick={onSignIn}>{t("auth.gate.signIn")}</button>
        </div>
      </div>
    </main>
  );
}

export function AuthLoadingGate() {
  const { t } = useLocalization();

  return (
    <>
      <span className="boot-sr-only" role="status" aria-live="polite">{t("auth.gate.loadingStatus")}</span>
      <main className="auth-gate auth-gate--loading" aria-busy="true" aria-label={t("auth.gate.loadingAria")}>
        <div className="boot-window-drag-strip" data-tauri-drag-region aria-hidden="true" />
        <div className="boot-loading__content" aria-hidden="true">
          <img className="boot-loading__mark" src={markUrl} alt="" />
          <span className="boot-loading">{t("auth.gate.loadingVisual")}</span>
        </div>
      </main>
    </>
  );
}
