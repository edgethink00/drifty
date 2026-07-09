import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";

export interface UserProfile {
  public_id: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  website_url: string;
  github_url: string;
  linkedin_url: string;
  timezone: string;
  is_public: boolean;
  updated_at: string;
}

export interface PublicProfile {
  public_id: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  website_url: string;
  github_url: string;
  linkedin_url: string;
  focus_seconds_7d: number | null;
  rank: number | null;
  updated_at: string;
}

type PublicProfilePeriod = "daily" | "weekly" | "monthly";

export interface ProfileInput {
  display_name: string;
  bio?: string;
  avatar_url?: string;
  website_url?: string;
  github_url?: string;
  linkedin_url?: string;
  timezone?: string;
  is_public?: boolean;
}

export interface ProfileResult<T = undefined> {
  success: boolean;
  error: string | null;
  data?: T;
}

type ProfileClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: unknown;
    }>;
  };
  from: (table: "profiles") => {
    select: (columns: string) => {
      eq: (column: string, value: string | boolean) => {
        maybeSingle: () => Promise<{ data: ProfileRow | null; error: { message: string; code?: string } | null }>;
      };
    };
    upsert: (payload: Record<string, unknown>, options: { onConflict: string }) => {
      select: (columns: string) => {
        single: () => Promise<{ data: ProfileRow | null; error: { message: string } | null }>;
      };
    };
  };
  rpc: (procedure: "get_public_profile", args: { profile_public_id: string; period_name?: PublicProfilePeriod }) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
};

type ProfileRow = {
  public_id?: string | null;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  website_url?: string | null;
  github_url?: string | null;
  linkedin_url?: string | null;
  timezone?: string | null;
  is_public?: boolean | null;
  updated_at?: string | null;
};

type PublicProfileRpcRow = ProfileRow & {
  focus_seconds_7d?: number | string | null;
  rank?: number | string | null;
};

function resolveClient(client?: ProfileClient | null): ProfileClient | null {
  if (client) return client;
  if (!isSupabaseEnabled() || !supabase) return null;
  return supabase as unknown as ProfileClient;
}

export function fallbackDisplayName(email?: string | null) {
  const name = email?.split("@")[0]?.trim();
  return name || "drifty";
}

function normalizeProfile(row: ProfileRow, email?: string | null): UserProfile {
  return {
    public_id: row.public_id ?? "",
    display_name: row.display_name?.trim() || fallbackDisplayName(email),
    bio: row.bio ?? "",
    avatar_url: row.avatar_url ?? "",
    website_url: row.website_url ?? "",
    github_url: row.github_url ?? "",
    linkedin_url: row.linkedin_url ?? "",
    timezone: row.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    // Reflect the row's real visibility; only a missing column (legacy row) defaults to public.
    is_public: row.is_public ?? true,
    updated_at: row.updated_at ?? "",
  };
}

function normalizePublicProfile(row: PublicProfileRpcRow): PublicProfile {
  return {
    public_id: row.public_id ?? "",
    display_name: row.display_name ?? "drifty",
    bio: row.bio ?? "",
    avatar_url: row.avatar_url ?? "",
    website_url: row.website_url ?? "",
    github_url: row.github_url ?? "",
    linkedin_url: row.linkedin_url ?? "",
    focus_seconds_7d: row.focus_seconds_7d === null || row.focus_seconds_7d === undefined ? null : Number(row.focus_seconds_7d),
    rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
    updated_at: row.updated_at ?? "",
  };
}

async function getCurrentUser(client: ProfileClient) {
  const { data, error } = await client.auth.getUser();
  return { user: data.user ?? null, error };
}

export async function fetchOwnProfile(client?: ProfileClient | null): Promise<ProfileResult<UserProfile | null>> {
  const resolvedClient = resolveClient(client);
  if (!resolvedClient) return { success: false, error: "Supabase is not configured" };

  const { user } = await getCurrentUser(resolvedClient);
  if (!user) return { success: false, error: "Not authenticated" };

  try {
    const { data, error } = await resolvedClient
      .from("profiles")
      .select("public_id, display_name, bio, avatar_url, website_url, github_url, linkedin_url, timezone, is_public, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return { success: false, error: error.message };
    if (!data) return { success: true, error: null, data: null };
    return { success: true, error: null, data: normalizeProfile(data, user.email) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveOwnProfile(input: ProfileInput, client?: ProfileClient | null): Promise<ProfileResult<UserProfile>> {
  const resolvedClient = resolveClient(client);
  if (!resolvedClient) return { success: false, error: "Supabase is not configured" };

  const { user } = await getCurrentUser(resolvedClient);
  if (!user) return { success: false, error: "Not authenticated" };

  const displayName = input.display_name.trim() || fallbackDisplayName(user.email);
  const timezone = input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  try {
    const { data, error } = await resolvedClient
      .from("profiles")
      .upsert({
        user_id: user.id,
        display_name: displayName,
        bio: input.bio?.trim() ?? "",
        avatar_url: input.avatar_url?.trim() ?? "",
        website_url: input.website_url?.trim() ?? "",
        github_url: input.github_url?.trim() ?? "",
        linkedin_url: input.linkedin_url?.trim() ?? "",
        timezone,
        // Never force visibility: pass the caller's choice through, and when the caller has no
        // opinion OMIT the column — an upsert then preserves the row's existing value, and a
        // first-time insert falls back to the schema default (true), so freshly created
        // profiles stay public and already-published cards keep working.
        ...(input.is_public === undefined ? {} : { is_public: input.is_public }),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" })
      .select("public_id, display_name, bio, avatar_url, website_url, github_url, linkedin_url, timezone, is_public, updated_at")
      .single();

    if (error || !data) return { success: false, error: error?.message ?? "Unable to save profile" };
    return { success: true, error: null, data: normalizeProfile(data, user.email) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchPublicProfile(
  publicId: string,
  periodOrClient: PublicProfilePeriod | ProfileClient | null = "weekly",
  maybeClient?: ProfileClient | null,
): Promise<ProfileResult<PublicProfile | null>> {
  const period = typeof periodOrClient === "string" ? periodOrClient : "weekly";
  const resolvedClient = resolveClient(typeof periodOrClient === "string" ? maybeClient : periodOrClient);
  if (!resolvedClient) return { success: false, error: "Supabase is not configured" };

  try {
    const { data, error } = await resolvedClient.rpc("get_public_profile", { profile_public_id: publicId, period_name: period });
    if (error) return { success: false, error: error.message };
    const row = data?.[0] as PublicProfileRpcRow | undefined;
    return { success: true, error: null, data: row ? normalizePublicProfile(row) : null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
