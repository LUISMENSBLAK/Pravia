import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { ArchivoService } from './archivo.service';
import { MiDiaArchiveCardsService } from './miDiaArchiveCards.service';

type Actor = NonNullable<Request['user']>;
const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test',
  nombre: 'QA', apellido: 'Local', rol: 'DIRECCION', scope: 'GLOBAL',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'local', permissions: ['expedientes.read'], requiresPasswordChange: false };

describe('Mi Día Archivo cards use the canonical Archivo overview', () => {
  it('uses Archivo values unchanged with a single read for both visible cards', async () => {
    const overview = vi.fn().mockResolvedValue({ next_numero_escritura: '103', next_folio: '201', libro_tomo: 'I' });
    const source = new MiDiaArchiveCardsService({ overview } as unknown as ArchivoService);
    const result = await source.readVisible(actor, ['NEXT_DEED', 'NEXT_FOLIO']);
    expect(overview).toHaveBeenCalledExactlyOnceWith(actor);
    expect(result).toMatchObject({ NEXT_DEED: { value: '103', href: '/archivo', available: true },
      NEXT_FOLIO: { value: '201', href: '/archivo', available: true } });
  });

  it('shows no configuration data instead of inventing the first number', async () => {
    const overview = vi.fn().mockResolvedValue({ next_numero_escritura: null, next_folio: null });
    const source = new MiDiaArchiveCardsService({ overview } as unknown as ArchivoService);
    expect((await source.readVisible(actor, ['NEXT_DEED'])).NEXT_DEED).toMatchObject({ value: null, available: false });
    expect(await source.readVisible(actor, [])).toEqual({});
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it('does not mislabel the last historical book as the configured current book', async () => {
    const overview = vi.fn().mockResolvedValue({ libro_tomo: 'Histórico I', libro_tomo_configured: false,
      next_folio: '201' });
    const source = new MiDiaArchiveCardsService({ overview } as unknown as ArchivoService);
    const result = await source.readVisible(actor, ['CURRENT_BOOK', 'FOLIOS_LEFT', 'APPENDIX_PENDING']);
    expect(overview).toHaveBeenCalledExactlyOnceWith(actor);
    expect(result.CURRENT_BOOK).toMatchObject({ value: null, available: false,
      message: expect.stringContaining('no tiene configurado') });
    expect(result.FOLIOS_LEFT).toMatchObject({ value: null, available: false,
      message: expect.stringContaining('capacidad final') });
    expect(result.APPENDIX_PENDING).toMatchObject({ value: null, available: false,
      message: expect.stringContaining('cuándo corresponde') });
  });

  it('matches the canonical Archivo current book only when Archivo marks it configured', async () => {
    const overview = vi.fn().mockResolvedValue({ libro_tomo: 'Tomo II', libro_tomo_configured: true });
    const source = new MiDiaArchiveCardsService({ overview } as unknown as ArchivoService);
    expect((await source.readVisible(actor, ['CURRENT_BOOK'])).CURRENT_BOOK).toMatchObject({
      value: 'Tomo II', available: true,
    });
    overview.mockResolvedValue({ libro_tomo: 'Tomo III', libro_tomo_configured: true });
    expect((await source.readVisible(actor, ['CURRENT_BOOK'])).CURRENT_BOOK?.value).toBe('Tomo III');
  });

  it('requires the same source permission as Archivo', async () => {
    const overview = vi.fn();
    const source = new MiDiaArchiveCardsService({ overview } as unknown as ArchivoService);
    await expect(source.readVisible({ ...actor, permissions: [] }, ['NEXT_FOLIO']))
      .rejects.toThrow('MIDIA_ARCHIVE_READ_DENIED');
    expect(overview).not.toHaveBeenCalled();
  });

  it('counts real tenant-local assignments and links each result to its instrument', async () => {
    const overview = vi.fn();
    const assignmentsInRange = vi.fn().mockResolvedValue({ count: 21, records: [{
      id: 'record-1', expediente_id: 'case-1', numero_escritura: '205', folio: 'EXP-001-2026',
      cliente: 'Cliente QA', assigned_at: '2026-10-14T08:30:00.000Z',
    }] });
    const source = new MiDiaArchiveCardsService({ overview, assignmentsInRange } as unknown as ArchivoService);
    const result = await source.readVisible(actor, ['DEEDS_TODAY'], {
      timezone: 'America/Mexico_City', now: new Date('2026-10-14T12:00:00.000Z'), limit: 5,
    });
    expect(overview).not.toHaveBeenCalled();
    expect(assignmentsInRange).toHaveBeenCalledOnce();
    const [readActor, from, to, limit] = assignmentsInRange.mock.calls[0];
    expect(readActor).toBe(actor);
    expect(from.toISOString()).toBe('2026-10-14T06:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-15T06:00:00.000Z');
    expect(limit).toBe(5);
    expect(result.DEEDS_TODAY).toMatchObject({ value: '21', available: true,
      items: [{ numero_escritura: '205', href: '/expedientes/case-1#archivo' }] });
  });

  it('treats no assignments as zero activity, not as an unavailable sequence', async () => {
    const source = new MiDiaArchiveCardsService({ overview: vi.fn(),
      assignmentsInRange: vi.fn().mockResolvedValue({ count: 0, records: [] }) } as unknown as ArchivoService);
    expect((await source.readVisible(actor, ['DEEDS_TODAY'])).DEEDS_TODAY).toMatchObject({
      value: '0', available: true, message: 'No se asignaron escrituras hoy.', items: [],
    });
  });
});
