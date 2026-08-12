export interface ErrorEnvelope {
  code: string;
  error: string;
  correlation_id: string;
  [key: string]: unknown;
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'AUTH_REQUIRED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'UPSTREAM_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

const defaultMessage = (status: number) => status >= 500
  ? 'No fue posible completar la solicitud. Intenta de nuevo.'
  : 'La solicitud no pudo procesarse.';

export function normalizeErrorBody(
  body: unknown,
  status: number,
  correlationId: string,
  production = false,
): ErrorEnvelope {
  const source: Record<string, unknown> = body && typeof body === 'object' && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>) }
    : { error: typeof body === 'string' ? body : undefined };

  const error = typeof source.error === 'string' && source.error.trim()
    ? source.error.trim()
    : typeof source.message === 'string' && source.message.trim()
      ? source.message.trim()
      : defaultMessage(status);
  const code = typeof source.code === 'string' && source.code.trim()
    ? source.code.trim()
    : STATUS_CODES[status] || `HTTP_${status}`;

  delete source.message;
  delete source.stack;
  if (production && status >= 500) delete source.detail;

  return {
    ...source,
    code,
    error: production && status >= 500 ? defaultMessage(status) : error,
    correlation_id: correlationId,
  };
}

export function errorLogLevel(status: number) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}
