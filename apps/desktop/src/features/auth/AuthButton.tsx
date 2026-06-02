import { useAuth } from "./AuthContext";

export function AuthButton({ onOpenAuth }: { onOpenAuth: () => void }) {
  const { user, status, signOut, isEnabled } = useAuth();

  if (!isEnabled) {
    return (
      <button
        type="button"
        className="ghost-button"
        disabled
        title="Supabase not configured"
      >
        Cloud off
      </button>
    );
  }

  if (status === "loading") {
    return (
      <button type="button" className="ghost-button" disabled>
        …
      </button>
    );
  }

  if (user) {
    return (
      <div className="auth-button__signed-in">
        <span className="auth-button__email" title={user.email ?? ""}>
          {user.email ?? "User"}
        </span>
        <button type="button" className="ghost-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="ghost-button" onClick={onOpenAuth}>
      Sign in
    </button>
  );
}
