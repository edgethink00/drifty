export const AUTH_PASSWORD_POLICY = Object.freeze({
  minLength: 12,
  message: "Use at least 12 characters for your password. Avoid passwords reused from another service.",
});

export function validateAuthPasswordForSignUp(password: string): Error | null {
  if (password.length >= AUTH_PASSWORD_POLICY.minLength) {
    return null;
  }

  return new Error(AUTH_PASSWORD_POLICY.message);
}

function getAuthErrorCode(error: Error): string {
  const codedError = error as Error & { readonly code?: unknown };
  return typeof codedError.code === "string" ? codedError.code.toLowerCase() : "";
}

export function normalizeAuthPasswordError(error: Error | null): Error | null {
  if (!error) return null;

  const code = getAuthErrorCode(error);
  if (code === "weak_password" || /weak password|password should be|password.+least/i.test(error.message)) {
    return new Error(AUTH_PASSWORD_POLICY.message);
  }

  return error;
}
