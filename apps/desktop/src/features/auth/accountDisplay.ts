export type AuthMetadataUser = {
  user_metadata?: Record<string, unknown>;
} | null;

export function getAccountDisplayName(email: string | null): string {
  if (!email) return "Account";
  const name = email.split("@")[0]?.trim();
  return name || "Account";
}

export function getAuthMetadataAvatarUrl(user: AuthMetadataUser): string {
  const metadata = user?.user_metadata;
  const picture = typeof metadata?.picture === "string" ? metadata.picture.trim() : "";
  if (picture) return picture;

  const avatarUrl = typeof metadata?.avatar_url === "string" ? metadata.avatar_url.trim() : "";
  return avatarUrl;
}
