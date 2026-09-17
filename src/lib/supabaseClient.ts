import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The anon key is safe to check in: Supabase designs it to be public, since
// Row Level Security (see supabase/schema.sql) — not secrecy of this key —
// is what actually restricts access. Env vars still override these, for
// local dev against a different project or if you rotate later.
const DEFAULT_SUPABASE_URL = "https://uhvykwfykycjvkmtkrkz.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVodnlrd2Z5a3ljanZrbXRrcmt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2MDI2NDIsImV4cCI6MjEwNTE3ODY0Mn0.3T2EUGOAl2isrSdwZ1TYqWHJP5F_buQOiHTKOJb6yZ0";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? DEFAULT_SUPABASE_URL;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? DEFAULT_SUPABASE_ANON_KEY;

export const syncConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = syncConfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
