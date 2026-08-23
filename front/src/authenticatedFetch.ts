export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication is required');
    this.name = 'AuthRequiredError';
  }
}

export interface AuthenticatedFetchDependencies {
  getTelegramInitData: () => string;
  getStandaloneAccessToken: (forceRefresh?: boolean) => Promise<string | null>;
  onStandaloneAuthRequired: () => void;
  fetchImpl?: typeof fetch;
}

/**
 * Attach exactly one server-verifiable identity to a request.
 *
 * Telegram never falls back to bearer auth. Standalone requests retry once
 * after an explicit Supabase refresh, then pause behind the login screen.
 */
export function createAuthenticatedFetch(deps: AuthenticatedFetchDependencies) {
  return async function authenticatedFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const telegramInitData = deps.getTelegramInitData();
    const isTelegram = Boolean(telegramInitData);
    let accessToken = isTelegram ? null : await deps.getStandaloneAccessToken(false);
    if (!isTelegram && !accessToken) {
      deps.onStandaloneAuthRequired();
      throw new AuthRequiredError();
    }

    const send = (token: string | null) => {
      const headers = new Headers(init.headers);
      if (isTelegram) {
        headers.set('X-Telegram-Init-Data', telegramInitData);
        headers.delete('Authorization');
      } else {
        headers.set('Authorization', `Bearer ${token}`);
        headers.delete('X-Telegram-Init-Data');
      }
      return (deps.fetchImpl || fetch)(input, { ...init, headers });
    };

    let response = await send(accessToken);
    if (!isTelegram && response.status === 401) {
      accessToken = await deps.getStandaloneAccessToken(true);
      if (!accessToken) {
        deps.onStandaloneAuthRequired();
        throw new AuthRequiredError();
      }
      response = await send(accessToken);
      if (response.status === 401) {
        deps.onStandaloneAuthRequired();
        throw new AuthRequiredError();
      }
    }
    if (!isTelegram && response.status === 403) {
      deps.onStandaloneAuthRequired();
      throw new AuthRequiredError();
    }
    return response;
  };
}
