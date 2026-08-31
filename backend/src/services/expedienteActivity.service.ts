import { randomUUID } from 'crypto';
import { Prisma, PrismaClient, type ExpedienteActividadCategoria, type TipoActividad } from '@prisma/client';
import type { Request } from 'express';
import { expedienteAccessWhere } from '../middleware/auth.middleware';

type Actor = NonNullable<Request['user']>;
type CategoryFilter = 'TODO' | ExpedienteActividadCategoria;
type ActivityQuery = { category?: unknown; search?: unknown; from?: unknown; to?: unknown; cursor?: unknown; limit?: unknown };
type Db = PrismaClient | Prisma.TransactionClient;

const categories = new Set<CategoryFilter>(['TODO', 'OPERACION', 'DOCUMENTOS', 'FINANZAS', 'SISTEMA']);
const relatedSections = new Set(['resumen', 'actos', 'comparecientes', 'predios', 'documentos', 'seguimiento', 'plantillas', 'presupuesto', 'finanzas', 'isr', 'actividad']);
const relevantSources = new Set(['EXP-001', 'EXP-002', 'EXP-003', 'EXP-004', 'EXP-005', 'EXP-006', 'EXP-007', 'EXP-008', 'EXP-009', 'PRD-001']);
const relevantAuditTitle = /(expediente|acto|comparec|inmueble|predio|document|presupuesto|finanz|ingreso|pago|comprobante|firma|postfirma|entrega|isr|ficha general)/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

export class ExpedienteActivityError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const categoryFor = (item: any): ExpedienteActividadCategoria => {
  const meta = record(item.metadatos);
  if (item.es_nota_manual || item.tipo === 'NOTA') return 'OPERACION';
  if (item.tipo === 'DOCUMENTO') return 'DOCUMENTOS';
  if (item.tipo === 'PAGO' || ['EXP-007', 'EXP-008'].includes(String(meta.source || ''))) return 'FINANZAS';
  if (['EXP-004', 'EXP-006'].includes(String(meta.source || ''))) return 'DOCUMENTOS';
  if (['CAMBIO_ESTATUS', 'CAMBIO_ETAPA', 'SEGUIMIENTO', 'COMPARECIENTE'].includes(item.tipo)
    || ['EXP-001', 'EXP-002', 'EXP-003', 'EXP-005', 'PRD-001'].includes(String(meta.source || ''))) return 'OPERACION';
  return item.categoria || 'SISTEMA';
};

const sectionFor = (item: any, category: ExpedienteActividadCategoria) => {
  if (relatedSections.has(String(item.seccion_relacionada || ''))) return item.seccion_relacionada;
  const meta = record(item.metadatos); const source = String(meta.source || ''); const title = String(item.titulo || '');
  if (item.tipo === 'DOCUMENTO' || ['EXP-004', 'EXP-006'].includes(source)) return source === 'EXP-006' ? 'plantillas' : 'documentos';
  if (source === 'EXP-007') return 'presupuesto';
  if (category === 'FINANZAS') return 'finanzas';
  if (item.tipo === 'SEGUIMIENTO' || source === 'EXP-005' || /firma|postfirma|entrega/i.test(title)) return 'seguimiento';
  if (/comparec/i.test(title)) return 'comparecientes';
  if (/predio|inmueble/i.test(title)) return 'predios';
  if (/acto/i.test(title)) return 'actos';
  if (/isr/i.test(title)) return 'isr';
  return 'resumen';
};

const relevant = (item: any) => {
  if (item.es_nota_manual || item.tipo === 'NOTA') return true;
  if (item.tipo === 'DOCUMENTO' && /(descarga|visualiz|consult|abri[oó])/i.test(`${item.titulo} ${item.descripcion}`)) return false;
  if (['CAMBIO_ESTATUS', 'CAMBIO_ETAPA', 'SEGUIMIENTO', 'DOCUMENTO', 'PAGO', 'COMPARECIENTE'].includes(item.tipo)) return true;
  if (item.tipo !== 'AUDITORIA') return false;
  const source = String(record(item.metadatos).source || '');
  return relevantSources.has(source) || relevantAuditTitle.test(String(item.titulo || ''));
};

const changeValues = (item: any) => {
  const meta = record(item.metadatos);
  const safe = (value: unknown) => { const source = record(value); const filtered = Object.fromEntries(Object.entries(source).filter(([key]) => !/(^id$|_id$|uuid|version|correlation|token|secret|storage|checksum|hash)/i.test(key))); return Object.keys(filtered).length ? filtered : null; };
  const previous = safe(item.valores_anteriores) || (meta.estado_anterior !== undefined ? { estado: meta.estado_anterior } : null);
  const next = safe(item.valores_nuevos) || (meta.estado_nuevo !== undefined ? { estado: meta.estado_nuevo } : null);
  return { previous, next };
};

export class ExpedienteActivityService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(actor: Actor, expedienteId: string, query: ActivityQuery) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const category = clean(query.category || 'TODO', 20).toUpperCase() as CategoryFilter;
    if (!categories.has(category)) throw new ExpedienteActivityError(400, 'EXP009_CATEGORY_INVALID', 'Selecciona una categoría de actividad válida.');
    const search = clean(query.search, 120);
    const from = this.date(query.from, 'La fecha inicial'); const to = this.date(query.to, 'La fecha final', true);
    if (from && to && from > to) throw new ExpedienteActivityError(400, 'EXP009_DATE_RANGE_INVALID', 'La fecha inicial no puede ser posterior a la fecha final.');
    const limit = Math.min(100, Math.max(10, Number(query.limit) || 30));
    let cursor = clean(query.cursor, 64) || null;
    if (cursor) {
      if (!uuid.test(cursor)) throw new ExpedienteActivityError(400, 'EXP009_CURSOR_INVALID', 'El punto de continuación no es válido.');
      const accessibleCursor = await this.prisma.expedienteActividad.findFirst({ where: { id: cursor, organization_id: actor.organizationId, expediente_id: expedienteId }, select: { id: true } });
      if (!accessibleCursor) throw new ExpedienteActivityError(403, 'EXP009_CURSOR_ACCESS_DENIED', 'No tienes acceso a ese punto de la cronología.');
    }
    const output: any[] = []; let nextCursor: string | null = null; let exhausted = false;
    for (let batch = 0; batch < 10 && output.length < limit && !exhausted; batch += 1) {
      const rows = await this.prisma.expedienteActividad.findMany({
        where: {
          organization_id: actor.organizationId, expediente_id: expedienteId,
          ...(search ? { OR: [{ titulo: { contains: search, mode: 'insensitive' } }, { descripcion: { contains: search, mode: 'insensitive' } }] } : {}),
          ...((from || to) ? { created_at: { gte: from, lte: to } } : {}),
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: 101,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { usuario: { select: { id: true, nombre: true, apellido: true } } },
      });
      exhausted = rows.length <= 100;
      for (const item of rows.slice(0, 100)) {
        cursor = item.id;
        if (!relevant(item)) continue;
        const resolvedCategory = categoryFor(item);
        if (category !== 'TODO' && category !== resolvedCategory) continue;
        const changes = changeValues(item);
        output.push({
          id: item.id, type: item.tipo, category: resolvedCategory, title: item.titulo, description: item.descripcion,
          occurred_at: item.created_at, actor: item.usuario, manual_note: item.es_nota_manual || item.tipo === 'NOTA',
          previous_values: changes.previous, new_values: changes.next, related_section: sectionFor(item, resolvedCategory),
          related_entity: item.entidad_relacionada || null, related_entity_id: item.entidad_relacionada_id || null,
        });
        if (output.length === limit) { nextCursor = item.id; break; }
      }
      if (!exhausted && output.length < limit) nextCursor = cursor;
    }
    return { data: output, next_cursor: nextCursor, filters: { category, search: search || null, from: from?.toISOString() || null, to: to?.toISOString() || null }, canonical_source: 'ExpedienteActividad', technical_audit_source: false };
  }

  async addNote(actor: Actor, expedienteId: string, input: { note?: unknown; idempotency_key?: unknown }) {
    await this.assertExpediente(this.prisma, actor, expedienteId);
    const rawNote = String(input.note || '').trim(); const note = clean(rawNote, 2000); const idempotencyKey = clean(input.idempotency_key, 160);
    if (!note) throw new ExpedienteActivityError(400, 'EXP009_NOTE_REQUIRED', 'Escribe una nota antes de guardarla.');
    if (rawNote.length > 2000) throw new ExpedienteActivityError(400, 'EXP009_NOTE_TOO_LONG', 'La nota no puede exceder 2,000 caracteres.');
    if (idempotencyKey.length < 8) throw new ExpedienteActivityError(400, 'EXP009_IDEMPOTENCY_REQUIRED', 'No pudimos identificar esta operación. Intenta nuevamente.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:exp009-note:${actor.organizationId}:${expedienteId}:${idempotencyKey}`}))`);
      await this.assertExpediente(tx, actor, expedienteId);
      const existing = await tx.expedienteActividad.findFirst({ where: { organization_id: actor.organizationId, expediente_id: expedienteId, idempotency_key: idempotencyKey }, include: { usuario: { select: { id: true, nombre: true, apellido: true } } } });
      if (existing) return { item: this.noteDto(existing), idempotent: true };
      const correlationId = randomUUID();
      const created = await tx.expedienteActividad.create({ data: {
        organization_id: actor.organizationId, expediente_id: expedienteId, usuario_id: actor.id, tipo: 'NOTA', categoria: 'OPERACION',
        titulo: 'Nota operativa', descripcion: note, metadatos: json({ source: 'EXP-009', action: 'MANUAL_NOTE' }),
        seccion_relacionada: 'actividad', entidad_relacionada: 'Expediente', entidad_relacionada_id: expedienteId,
        correlation_id: correlationId, idempotency_key: idempotencyKey, es_nota_manual: true,
      }, include: { usuario: { select: { id: true, nombre: true, apellido: true } } } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'EXP009_ADD_MANUAL_NOTE', entidad: 'ExpedienteActividad', entidad_id: created.id, detalles: json({ expediente_id: expedienteId, activity_id: created.id }), correlation_id: correlationId, session_id: actor.sessionId } });
      await tx.domainEventOutbox.create({ data: { organization_id: actor.organizationId, event_type: 'ExpedienteActivityNoteAdded', aggregate_type: 'Expediente', aggregate_id: expedienteId, actor_user_id: actor.id, correlation_id: correlationId, payload: json({ activity_id: created.id }) } });
      return { item: this.noteDto(created), idempotent: false };
    }, { timeout: 15_000 });
  }

  private noteDto(item: any) { return { id: item.id, type: item.tipo, category: 'OPERACION', title: item.titulo, description: item.descripcion, occurred_at: item.created_at, actor: item.usuario, manual_note: true, previous_values: null, new_values: null, related_section: 'actividad', related_entity: 'Expediente', related_entity_id: item.expediente_id }; }

  private async assertExpediente(db: Db, actor: Actor, expedienteId: string) {
    const expediente = await db.expediente.findFirst({ where: { id: expedienteId, organization_id: actor.organizationId, archived_at: null, ...expedienteAccessWhere(actor) }, select: { id: true } });
    if (!expediente) throw new ExpedienteActivityError(403, 'EXP009_EXPEDIENTE_ACCESS_DENIED', 'No tienes acceso a este expediente.');
    return expediente;
  }

  private date(value: unknown, label: string, endOfDay = false) {
    if (!value) return undefined;
    const source = clean(value, 40); const date = /^\d{4}-\d{2}-\d{2}$/.test(source) ? new Date(`${source}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`) : new Date(source);
    if (Number.isNaN(date.getTime())) throw new ExpedienteActivityError(400, 'EXP009_DATE_INVALID', `${label} no es válida.`);
    return date;
  }
}

export const EXP009_RELEVANT_ACTIVITY_TYPES: TipoActividad[] = ['CAMBIO_ESTATUS', 'CAMBIO_ETAPA', 'SEGUIMIENTO', 'DOCUMENTO', 'PAGO', 'COMPARECIENTE', 'AUDITORIA', 'NOTA'];
