import { apiConfig, apiUrl } from './config';

type TokenPayload = Record<string, unknown> | null;

const ACCESS_TOKEN_KEY = 'pravia.access-token';
const SESSION_HINT_KEY = 'pravia.session-active';
let refreshInFlight: Promise<string | null> | null = null;
let accessToken: string | null = null;
const authChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('pravia.auth');
const dataChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('pravia.data');

type DataChangeDetail = { method: string; path: string; source: 'local' | 'broadcast' };

const emitDataChange = (detail: DataChangeDetail, broadcast = true) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<DataChangeDetail>('pravia:data-changed', { detail }));
  if (broadcast) dataChannel?.postMessage({ ...detail, source: 'broadcast' });
};

dataChannel?.addEventListener('message', (event: MessageEvent<Partial<DataChangeDetail>>) => {
  if (!event.data?.method || !event.data.path) return;
  emitDataChange({ method: event.data.method, path: event.data.path, source: 'broadcast' }, false);
});

authChannel?.addEventListener('message', (event: MessageEvent<{ type?: string; token?: string | null }>) => {
  if (event.data?.type === 'ACCESS_TOKEN' && typeof event.data.token === 'string' && event.data.token) {
    accessToken = event.data.token;
    sessionStorage.setItem(SESSION_HINT_KEY, '1');
  }
  if (event.data?.type === 'SESSION_CLEARED') {
    accessToken = null;
    sessionStorage.removeItem(SESSION_HINT_KEY);
  }
});

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
    sessionStorage.setItem(SESSION_HINT_KEY, '1');
    authChannel?.postMessage({ type: 'ACCESS_TOKEN', token });
  },
  hasSessionHint: () => sessionStorage.getItem(SESSION_HINT_KEY) === '1',
  clear: () => {
    accessToken = null;
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_HINT_KEY);
    authChannel?.postMessage({ type: 'SESSION_CLEARED' });
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

export const refreshSession = (rejectedToken: string | null = accessToken) => {
  if (!refreshInFlight) {
    const coordinatedRefresh = async () => {
      const refresh = async () => {
        if (accessToken && accessToken !== rejectedToken) return accessToken;
        return rawRefresh();
      };
      const locks = typeof navigator === 'undefined' ? null : navigator.locks;
      return locks ? locks.request('pravia.auth.refresh', refresh) : refresh();
    };
    refreshInFlight = coordinatedRefresh().finally(() => {
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
      await refreshSession(token);
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

  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') emitDataChange({ method, path, source: 'local' });
  return payload as T;
};

export const apiBlobRequest = async (path: string, options: RequestOptions = {}): Promise<Blob> => {
  const { retryOnUnauthorized = true, headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  const token = tokenStore.get();
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);

  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: requestHeaders,
  });

  if (response.status === 401 && retryOnUnauthorized) {
    try {
      await refreshSession(token);
      return apiBlobRequest(path, { ...options, retryOnUnauthorized: false });
    } catch {
      tokenStore.clear();
    }
  }

  if (!response.ok) {
    const payload = await parseResponse(response);
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : 'No fue posible descargar el archivo.';
    throw new ApiError(message, response.status, payload);
  }

  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') emitDataChange({ method, path, source: 'local' });
  return response.blob();
};

export { extractToken };
