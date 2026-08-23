import { createClient, type Session } from '@supabase/supabase-js';


const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabasePublishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();

export const STANDALONE_AUTH_REQUIRED_EVENT = 'gym-standalone-auth-required';

export const supabaseAuth = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const getTelegramInitData = (): string =>
  String((window as any).Telegram?.WebApp?.initData || '');

export const isTelegramMode = (): boolean => Boolean(getTelegramInitData());

export async function getStandaloneSession(): Promise<Session | null> {
  if (!supabaseAuth) return null;
  const { data, error } = await supabaseAuth.auth.getSession();
  if (error) return null;
  return data.session;
}

export async function getStandaloneAccessToken(forceRefresh = false): Promise<string | null> {
  if (!supabaseAuth) return null;
  if (forceRefresh) {
    const { data, error } = await supabaseAuth.auth.refreshSession();
    return error ? null : data.session?.access_token || null;
  }

  const session = await getStandaloneSession();
  if (!session) return null;
  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  if (expiresAtMs && expiresAtMs <= Date.now() + 60_000) {
    const { data, error } = await supabaseAuth.auth.refreshSession();
    return error ? null : data.session?.access_token || null;
  }
  return session.access_token;
}

export async function signInStandalone(email: string, password: string): Promise<string | null> {
  if (!supabaseAuth) return 'Supabase Auth не настроен.';
  const { error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  return error ? 'Не удалось войти. Проверь email и пароль HealthOS.' : null;
}

export async function signOutStandalone(): Promise<void> {
  if (supabaseAuth) await supabaseAuth.auth.signOut({ scope: 'local' });
}

export function requireStandaloneSignIn(): void {
  window.dispatchEvent(new CustomEvent(STANDALONE_AUTH_REQUIRED_EVENT));
}
