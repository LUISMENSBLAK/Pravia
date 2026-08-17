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

  // Unexpected server failures are always opaque, including in local/staging
  // environments. Production additionally keeps every upstream 5xx opaque.
  // Technical context belongs in server-side logs, never in the response.
  const hideInternalDetails = status === 500 || (production && status >= 500);
  if (hideInternalDetails) {
    return {
      code: STATUS_CODES[status] || 'INTERNAL_ERROR',
      error: defaultMessage(status),
      correlation_id: correlationId,
    };
  }

  delete source.message;
  delete source.stack;

  return {
    ...source,
    code,
    error,
    correlation_id: correlationId,
  };
}

export function errorLogLevel(status: number) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}
