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

const fetchWithConnectionError = async (url: string, options: RequestInit) => {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof TypeError) {
      throw new ApiError('Error de conexión. Revisa tu red y vuelve a intentar la carga.', 0, { code: 'NETWORK_ERROR' });
    }
    throw error;
  }
};

export type UploadPolicy = {
  standard_file_max_bytes: number;
  fiscal_file_max_bytes: number;
  catalog_import_file_max_bytes: number;
  archive_file_max_bytes: number;
  batch_total_max_bytes: number;
};
let uploadPolicyInFlight: Promise<UploadPolicy> | null = null;

export const getUploadPolicy = () => {
  if (!uploadPolicyInFlight) {
    uploadPolicyInFlight = apiRequest<UploadPolicy>('/upload-policy').catch((error) => {
      uploadPolicyInFlight = null;
      throw error;
    });
  }
  return uploadPolicyInFlight;
};

const uploadLimitForRequest = (path: string, field: string, policy: UploadPolicy) => {
  if (/^\/finanzas\/facturacion\/(?:manual|proveedores(?:\/|$))/.test(path)) return policy.fiscal_file_max_bytes;
  if (/^\/settings\/catalogs\/artifacts\/import\//.test(path)) return policy.catalog_import_file_max_bytes;
  if (/^\/expedientes\/[^/]+\/documentos\/carga-lote$/.test(path) && field === 'archive') return policy.archive_file_max_bytes;
  return policy.standard_file_max_bytes;
};

const preflightUploadSize = async (path: string, body: FormData) => {
  const files = [...body.entries()].filter((entry): entry is [string, File] => entry[1] instanceof File);
  if (!files.length) return;
  const policy = await getUploadPolicy();
  const tooLarge = files.map(([field, file]) => ({ file, maxBytes: uploadLimitForRequest(path, field, policy) }))
    .find(({ file, maxBytes }) => file.size > maxBytes);
  if (tooLarge) {
    const { maxBytes } = tooLarge;
    const limit = `${maxBytes / (1024 * 1024)} MB`;
    throw new ApiError(`El archivo supera el límite permitido de ${limit}.`, 413, { code: 'UPLOAD_FILE_TOO_LARGE', max_file_size_bytes: maxBytes });
  }
  if (files.length > 1 && files.reduce((total, [, file]) => total + file.size, 0) > policy.batch_total_max_bytes) {
    throw new ApiError(`La carga conjunta supera el límite de ${policy.batch_total_max_bytes / (1024 * 1024)} MB. Divide los documentos en lotes más pequeños.`, 413, {
      code: 'UPLOAD_BATCH_TOO_LARGE', max_batch_size_bytes: policy.batch_total_max_bytes,
    });
  }
};

export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { retryOnUnauthorized = true, headers, ...init } = options;
  if (init.body instanceof FormData) await preflightUploadSize(path, init.body);
  const token = tokenStore.get();
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData)) requestHeaders.set('Content-Type', 'application/json');
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);

  const response = await fetchWithConnectionError(apiUrl(path), {
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

export const apiUploadWithProgress = async <T>(path: string, form: FormData,
  onProgress: (loaded: number, total: number) => void): Promise<T> => {
  await preflightUploadSize(path, form);
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', apiUrl(path));
    request.withCredentials = true;
    request.setRequestHeader('Accept', 'application/json');
    const token = tokenStore.get();
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded, event.total);
    };
    request.onerror = () => reject(new ApiError('No se pudo conectar con el servidor de documentos. El archivo sigue seleccionado para reintentar.', 0));
    request.onload = () => {
      let payload: unknown;
      try { payload = JSON.parse(request.responseText); }
      catch { payload = null; }
      if (request.status < 200 || request.status >= 300) {
        const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        const message = typeof body.error === 'string' ? body.error :
          `No se pudo guardar el archivo. Código de referencia: ${request.getResponseHeader('x-correlation-id') || 'HTTP-' + request.status}.`;
        reject(new ApiError(message, request.status, payload));
        return;
      }
      emitDataChange({ method: 'POST', path, source: 'local' });
      resolve(payload as T);
    };
    request.send(form);
  });
};

export const apiBlobRequest = async (path: string, options: RequestOptions = {}): Promise<Blob> => {
  const { retryOnUnauthorized = true, headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  const token = tokenStore.get();
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);

  const response = await fetchWithConnectionError(apiUrl(path), {
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
