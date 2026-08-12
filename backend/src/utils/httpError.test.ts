import { describe, expect, it } from 'vitest';
import { errorLogLevel, normalizeErrorBody } from './httpError';

describe('normalizeErrorBody', () => {
  it('conserva el código funcional y agrega trazabilidad', () => {
    expect(normalizeErrorBody({ code: 'QUOTE_LOCKED', error: 'Cotización bloqueada.' }, 409, 'corr-1')).toEqual({
      code: 'QUOTE_LOCKED',
      error: 'Cotización bloqueada.',
      correlation_id: 'corr-1',
    });
  });

  it('normaliza respuestas incompletas', () => {
    expect(normalizeErrorBody({ detail: 'Campo requerido' }, 422, 'corr-2')).toMatchObject({
      code: 'VALIDATION_ERROR',
      error: 'La solicitud no pudo procesarse.',
      detail: 'Campo requerido',
      correlation_id: 'corr-2',
    });
  });

  it('oculta detalles internos en producción', () => {
    const result = normalizeErrorBody({ error: 'password=secreto', detail: 'stack interno', stack: 'trace' }, 500, 'corr-3', true);
    expect(result).toEqual({
      code: 'INTERNAL_ERROR',
      error: 'No fue posible completar la solicitud. Intenta de nuevo.',
      correlation_id: 'corr-3',
    });
  });

  it('clasifica el nivel de bitácora por estado', () => {
    expect(errorLogLevel(200)).toBe('info');
    expect(errorLogLevel(404)).toBe('warn');
    expect(errorLogLevel(503)).toBe('error');
  });
});
