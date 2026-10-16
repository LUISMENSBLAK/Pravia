import type { Request } from 'express';
import { miDiaPeriodRange } from '../domain/miDiaPeriod';
import { ArchivoService } from './archivo.service';

type Actor = NonNullable<Request['user']>;
export type ArchiveCardKey = 'NEXT_DEED' | 'NEXT_FOLIO' | 'DEEDS_TODAY'
  | 'CURRENT_BOOK' | 'FOLIOS_LEFT' | 'APPENDIX_PENDING';
export type ArchiveCardResult = { value: string | null; href: '/archivo'; source: 'Archivo';
  available: boolean; message: string | null;
  items?: Array<{ id: string; folio: string; numero_escritura: string; cliente: string | null;
    assigned_at: string; href: string }> };

/** Same read model and sequence authority as Archivo; Mi Día never predicts numbers. */
export class MiDiaArchiveCardsService {
  constructor(private readonly archivo: Pick<ArchivoService, 'overview' | 'assignmentsInRange'>) {}

  async readVisible(actor: Actor, keys: readonly ArchiveCardKey[], options: { timezone?: string; now?: Date; limit?: number; offset?: number } = {}): Promise<Partial<Record<ArchiveCardKey, ArchiveCardResult>>> {
    if (!keys.length) return {};
    if (!actor.permissions.includes('expedientes.read')) throw new Error('MIDIA_ARCHIVE_READ_DENIED');
    const sequenceKeys = keys.filter((key) => key !== 'DEEDS_TODAY' && key !== 'APPENDIX_PENDING');
    const [overview, assigned] = await Promise.all([
      sequenceKeys.length ? this.archivo.overview(actor) : Promise.resolve(null),
      keys.includes('DEEDS_TODAY') ? (() => {
        const { from, to } = miDiaPeriodRange('TODAY', options.timezone, options.now);
        return this.archivo.assignmentsInRange(actor, from, to, options.limit ?? 5, options.offset ?? 0);
      })() : Promise.resolve(null),
    ]);
    const result: Partial<Record<ArchiveCardKey, ArchiveCardResult>> = {};
    for (const key of sequenceKeys) {
      if (key === 'CURRENT_BOOK') {
        const value = overview?.libro_tomo_configured ? overview.libro_tomo : null;
        result[key] = { value, href: '/archivo', source: 'Archivo', available: value !== null,
          message: value === null ? 'Sin información: Archivo no tiene configurado el libro/tomo actual.' : null };
        continue;
      }
      if (key === 'FOLIOS_LEFT') {
        result[key] = { value: null, href: '/archivo', source: 'Archivo', available: false,
          message: 'Sin información: Archivo no tiene un rango o capacidad final configurada para calcular folios restantes.' };
        continue;
      }
      const value = key === 'NEXT_DEED' ? overview?.next_numero_escritura ?? null : overview?.next_folio ?? null;
      result[key] = { value, href: '/archivo', source: 'Archivo', available: value !== null,
        message: value === null ? 'Archivo aún no tiene una asignación desde la cual calcular el siguiente número.' : null };
    }
    if (keys.includes('APPENDIX_PENDING')) result.APPENDIX_PENDING = {
      value: null, href: '/archivo', source: 'Archivo', available: false,
      message: 'Sin información: Archivo no determina canónicamente cuándo corresponde un apéndice por instrumento.',
    };
    if (assigned) result.DEEDS_TODAY = {
      value: String(assigned.count), href: '/archivo', source: 'Archivo', available: true,
      message: assigned.count ? null : 'No se asignaron escrituras hoy.',
      items: assigned.records.filter((record) => record.expediente_id && record.folio && record.numero_escritura)
        .map((record) => ({ id: record.id, folio: record.folio!, numero_escritura: record.numero_escritura!,
          cliente: record.cliente, assigned_at: record.assigned_at,
          href: `/expedientes/${record.expediente_id}#archivo` })),
    };
    return result;
  }
}
