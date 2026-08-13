import { apiConfig, apiUrl } from './config';

type TokenPayload = Record<string, unknown> | null;

const ACCESS_TOKEN_KEY = 'pravia.access-token';
let refreshInFlight: Promise<string | null> | null = null;
let accessToken: string | null = null;

const extractToken = (payload: TokenPayload): string | null => {
  if (!payload) return null;
  const nested = typeof payload.data === 'object' && payload.data ? payload.data as Record<string, unknown> : null;
  const value = payload.accessToken ?? payload.access_token ?? payload.token ?? nested?.accessToken ?? nested?.access_token ?? nested?.token;
  return typeof value === 'string' && value.length > 0 ? value : null;
};

export const tokenStore = {
  get: () => accessToken,
  set: (token: string, _remember = false) => {
    accessToken = token;
    // Retira versiones anteriores: el access token vive solo en memoria.
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  },
  clear: () => {
    accessToken = null;
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const parseResponse = async (response: Response) => {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  return text ? { message: text } : null;
};

const rawRefresh = async (): Promise<string | null> => {
  const response = await fetch(apiUrl(apiConfig.refreshPath), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    tokenStore.clear();
    throw new ApiError('La sesión terminó.', response.status);
  }

  const payload = await parseResponse(response) as TokenPayload;
  const token = extractToken(payload);
  if (token) {
    tokenStore.set(token);
  }
  return token;
};

export const refreshSession = () => {
  if (!refreshInFlight) {
    refreshInFlight = rawRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
};

type RequestOptions = RequestInit & { retryOnUnauthorized?: boolean };

export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { retryOnUnauthorized = true, headers, ...init } = options;
  const token = tokenStore.get();
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData)) requestHeaders.set('Content-Type', 'application/json');
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);

  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: requestHeaders,
  });

  if (response.status === 401 && retryOnUnauthorized) {
    try {
      await refreshSession();
      return apiRequest<T>(path, { ...options, retryOnUnauthorized: false });
    } catch {
      tokenStore.clear();
    }
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error: unknown }).error)
      : 'No fue posible completar la solicitud.';
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
};

export { extractToken };
