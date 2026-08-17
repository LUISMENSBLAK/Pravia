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

  it('oculta todos los detalles internos de un error 500 en cualquier entorno', () => {
    const result = normalizeErrorBody({
      error: 'Invalid prisma.expediente.findMany()...',
      detail: 'relation pravia_os.documentos does not exist',
      storage_key: 'organizations/org-b/private/file.pdf',
      entity_id: '22222222-2222-4222-8222-222222222222',
      cause: 'sk-test-do-not-expose',
      meta: { table: 'documentos' },
      stack: 'trace',
    }, 500, 'corr-3');
    expect(result).toEqual({
      code: 'INTERNAL_ERROR',
      error: 'No fue posible completar la solicitud. Intenta de nuevo.',
      correlation_id: 'corr-3',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('prisma');
    expect(serialized).not.toContain('pravia_os');
    expect(serialized).not.toContain('organizations/org-b');
    expect(serialized).not.toContain('22222222-2222-4222-8222-222222222222');
    expect(serialized).not.toContain('sk-test-do-not-expose');
  });

  it('conserva mensajes humanos controlados de errores 4xx', () => {
    expect(normalizeErrorBody({ code: 'QUOTE_LOCKED', error: 'La cotización ya fue convertida.' }, 409, 'corr-4')).toEqual({
      code: 'QUOTE_LOCKED',
      error: 'La cotización ya fue convertida.',
      correlation_id: 'corr-4',
    });
  });

  it('clasifica el nivel de bitácora por estado', () => {
    expect(errorLogLevel(200)).toBe('info');
    expect(errorLogLevel(404)).toBe('warn');
    expect(errorLogLevel(503)).toBe('error');
  });
});
