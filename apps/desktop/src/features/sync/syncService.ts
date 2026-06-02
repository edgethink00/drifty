import { supabase, isSupabaseEnabled } from "../../lib/supabase/client";

export interface UserSettings {
  theme: "light" | "dark";
}

export interface PlanItemData {
  id: string;
  title: string;
  estimate: string;
  completed: boolean;
  source: "Quick add" | "Pinned";
  sort_order: number;
}

export interface SyncPayload {
  settings?: UserSettings;
  plan_items?: PlanItemData[];
}

export interface SyncResult {
  success: boolean;
  error: string | null;
  data?: {
    settings: UserSettings | null;
    plan_items: PlanItemData[] | null;
    last_synced_at: string | null;
  };
}

export async function syncToServer(payload: SyncPayload): Promise<SyncResult> {
  if (!isSupabaseEnabled() || !supabase) {
    return { success: false, error: "Supabase is not configured" };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    if (payload.settings) {
      await supabase.from("user_settings").upsert({
        user_id: user.id,
        theme: payload.settings.theme,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    }

    if (payload.plan_items) {
      const rows = payload.plan_items.map((item) => ({
        user_id: user.id,
        id: item.id,
        title: item.title,
        estimate: item.estimate,
        completed: item.completed,
        source: item.source,
        sort_order: item.sort_order,
        updated_at: new Date().toISOString(),
      }));

      await supabase.from("plan_items").upsert(rows, { onConflict: "user_id,id" });
    }

    return { success: true, error: null };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function syncFromServer(): Promise<SyncResult> {
  if (!isSupabaseEnabled() || !supabase) {
    return { success: false, error: "Supabase is not configured" };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const [settingsRes, plansRes] = await Promise.all([
      supabase.from("user_settings").select("theme, updated_at").eq("user_id", user.id).single(),
      supabase.from("plan_items").select("id, title, estimate, completed, source, sort_order, updated_at").eq("user_id", user.id).order("sort_order", { ascending: true }),
    ]);

    const settings = settingsRes.error
      ? null
      : { theme: settingsRes.data?.theme as "light" | "dark" };

    const plan_items = plansRes.error
      ? null
      : (plansRes.data ?? []).map((row) => ({
          id: row.id,
          title: row.title,
          estimate: row.estimate,
          completed: row.completed,
          source: row.source as "Quick add" | "Pinned",
          sort_order: row.sort_order,
        }));

    return {
      success: true,
      error: null,
      data: {
        settings,
        plan_items,
        last_synced_at: settingsRes.data?.updated_at ?? null,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseEnabled() || !supabase) {
    return { ok: false, message: "Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY." };
  }

  try {
    const { error } = await supabase.from("user_settings").select("count", { count: "exact", head: true });
    if (error) {
      return { ok: false, message: `Connection failed: ${error.message}` };
    }
    return { ok: true, message: "Connected to Supabase successfully." };
  } catch (err) {
    return { ok: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
