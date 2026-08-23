/**
 * "Исправить в GymApp" deep link.
 *
 * HealthOS is read-only on `gym_*`, so when a set looks wrong there it links
 * here instead of editing: `<GymApp>/?session=<uuid>`. The same id arrives as
 * Telegram's `start_param` when the app is opened from a mini-app link
 * (`t.me/<bot>/<app>?startapp=session_<uuid>`).
 *
 * Nothing here grants access. The id only selects what to open; whether the
 * session exists and belongs to the caller is decided by the backend
 * (`GET /api/session?session_id=…`, owner-scoped), and the screen is reached
 * only after authentication.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SESSION_PARAM = 'session';

/** Telegram's start_param allows [A-Za-z0-9_-], so the id may be prefixed. */
const TELEGRAM_PREFIX = 'session_';

/** A syntactically valid session id, lower-cased, or null. */
export function normalizeSessionId(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const candidate = text.startsWith(TELEGRAM_PREFIX)
    ? text.slice(TELEGRAM_PREFIX.length)
    : text;
  return UUID_RE.test(candidate) ? candidate.toLowerCase() : null;
}

/**
 * @param search `window.location.search`
 * @param startParam `Telegram.WebApp.initDataUnsafe.start_param`
 */
export function readSessionDeeplink(search: unknown, startParam?: unknown): string | null {
  let fromQuery: string | null = null;
  try {
    fromQuery = normalizeSessionId(new URLSearchParams(String(search ?? '')).get(SESSION_PARAM));
  } catch {
    fromQuery = null;
  }
  return fromQuery || normalizeSessionId(startParam);
}

/**
 * The same href without `?session=`, so a later refresh does not reopen the
 * deep link. Returns the input unchanged when it cannot be parsed.
 */
export function stripSessionParam(href: unknown): string {
  const text = String(href ?? '');
  try {
    const url = new URL(text);
    if (!url.searchParams.has(SESSION_PARAM)) return text;
    url.searchParams.delete(SESSION_PARAM);
    return url.toString();
  } catch {
    return text;
  }
}
