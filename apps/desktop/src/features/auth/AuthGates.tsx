import logoUrl from "../../assets/drifty-icon.png";

export function AuthConfigurationGate() {
  return (
    <main className="auth-gate" aria-label="Authentication configuration required">
      <div className="auth-card auth-card--blocking">
        <div className="auth-card__brand">Drifty</div>
        <h2>Authentication setup required</h2>
        <p>Required auth mode needs Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before beta deploys.</p>
      </div>
    </main>
  );
}

export function AuthRequiredGate({ onSignIn }: { onSignIn: () => void }) {
  return (
    <main className="auth-gate" aria-label="Sign in required">
      <div className="auth-card auth-card--blocking auth-card--required">
        <div className="auth-card__brand auth-card__brand--symbol">
          <img className="auth-card__brand-logo" src={logoUrl} alt="Drifty" />
        </div>
        <h2>Sign in to use Drifty</h2>
        <div className="auth-card__actions auth-card__actions--required">
          <button type="button" className="app-btn app-btn--primary auth-card__action" onClick={onSignIn}>Sign in</button>
        </div>
      </div>
    </main>
  );
}

export function AuthLoadingGate() {
  return (
    <main className="auth-gate auth-gate--loading" aria-busy="true" aria-label="Loading saved Drifty session">
      <span className="auth-gate__pulse">drifty loading…</span>
    </main>
  );
}
