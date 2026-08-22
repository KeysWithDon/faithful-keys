import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

function config() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
  return url && key ? { url, key } : null;
}

/** The browser may use only a Supabase publishable/anon key; RLS protects data. */
export function getSupabaseClient() {
  if (typeof window === "undefined") return null;
  if (client !== undefined) return client;
  const settings = config();
  client = settings ? createClient(settings.url, settings.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
  return client;
}

export function isSupabaseConfigured() { return Boolean(config()); }
