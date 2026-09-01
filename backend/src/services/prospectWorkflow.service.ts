import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { Prisma, PrismaClient, ProspectoEtapaContractual as Stage } from '@prisma/client';
import { prospectoObjectWhere } from './objectAccess.service';
import { fileExists } from '../storage/storage.service';
import { normalizeProspectName, prospectServiceByCode, prospectStageByCode } from '../domain/prospectCatalog';
import { allowedProspectActions, assertProspectFields, assertProspectReplay, assertProspectVersion, failProspect,
  nextProspectStage, PROSPECT_ACTIONS, PROSPECT_CONTRACT_STAGES, ProspectAction, prospectEffectiveAt,
  prospectHash, prospectJson, prospectKey, prospectWait, stageLabel } from '../domain/prospectWorkflow';
import { initializeQuoteContractInTransaction } from './cotizacionWorkflow.service';

type Actor = NonNullable<Request['user']>;
type Db = PrismaClient | Prisma.TransactionClient;
const docSelect = { id: true, nombre_original: true, tipo: true, mime_type: true, fecha_carga: true, size_bytes: true } as const;
const detailInclude = {
  atendido_por: { select: { id: true, nombre: true } }, etapa_operativa: true, servicio_catalogo: true,
  notaria: { select: { id: true, nombre: true, correo_general: true } },
  cotizacion: { select: { id: true, estado: true, numero_cotizacion: true } },
  transicion_actual: true,
} as const;
const trim = (value: unknown, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const permission = (actor: Actor, name: string) => {
  if (!actor?.id || !actor.organizationId) failProspect(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
  if (!(actor.permissions as string[]).includes(name)) failProspect(403, 'PERMISSION_DENIED', 'No tienes permiso para realizar esta acción.');
};
const newDataFields = ['nombre', 'telefono', 'email', 'necesidad', 'prioridad', 'servicio_catalogo_codigo', 'tiene_predial', 'tiene_antecedente'];
const actionFields = ['action', 'expectedVersion', 'idempotencyKey', 'confirm', 'effectiveAt', 'channel', 'recipient', 'evidence', 'content', 'attachmentIds', 'documentId', 'reason'];

/** Single PRO-001 authority. Notes, uploads and technical audit never implicitly advance stages. */
export class ProspectWorkflowService {
  constructor(private readonly prisma: PrismaClient, private readonly exists = fileExists) {}

  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:pro001:${key}`}))`);
  }
  private async prospect(db: Db, actor: Actor, id: string) {
    permission(actor, 'prospectos.read');
    const row = await db.prospecto.findFirst({ where: { id, archived_at: null, ...prospectoObjectWhere(actor) }, include: detailInclude });
    if (!row) return failProspect(404, 'PRO001_NOT_FOUND', 'No se encontró el prospecto o no tienes acceso.');
    return row;
  }
  private async notary(db: Db, actor: Actor, id: string | null) {
    permission(actor, 'notarias.read');
    if (!id) return failProspect(400, 'PRO001_NOTARY_REQUIRED', 'Selecciona una notaría en los datos del prospecto.');
    const row = await db.notaria.findFirst({ where: { id, organization_id: actor.organizationId, activa: true, archived_at: null } });
    if (!row) return failProspect(404, 'PRO001_NOTARY_DENIED', 'La notaría seleccionada no está disponible.');
    return row;
  }
  private async document(db: Db, actor: Actor, prospectId: string, id: string, canonicalSource = false) {
    permission(actor, 'documentos.read');
    const row = await db.documento.findFirst({ where: { id, organization_id: actor.organizationId, estatus: { not: 'RECHAZADO' },
      OR: [{ prospecto_id: prospectId }, { prospectoVinculos: { some: { prospecto_id: prospectId, organization_id: actor.organizationId, estatus: 'ACTIVO' } } },
        ...(canonicalSource ? [{ fuentesNotarialesProspecto: { some: { prospecto_id: prospectId, organization_id: actor.organizationId } } }] : [])] } });
    if (!row || !row.storage_key?.trim() || !(await this.exists(row.storage_key))) return failProspect(409, 'PRO001_DOCUMENT_UNAVAILABLE', 'El archivo seleccionado no está disponible o no pertenece a este prospecto.');
    return row;
  }
  private async audit(tx: Prisma.TransactionClient, actor: Actor, id: string, action: string, before: unknown, after: unknown, eventId?: string) {
    await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: `PRO001_${action}`,
      entidad: 'Prospecto', entidad_id: id, session_id: actor.sessionId ?? null, event_id: eventId ?? null,
      valores_anteriores: prospectJson(before), valores_nuevos: prospectJson(after), detalles: { source: 'PRO-001' } } });
  }
  private async event(tx: Prisma.TransactionClient, actor: Actor, p: { id: string; etapa_contractual: Stage | null; version_operativa: number }, input: {
    action: string; next: Stage; effectiveAt: Date; recordedAt: Date; key: string; hash: string; evidence: unknown;
  }) {
    const event = await tx.prospectoTransicion.create({ data: {
      organization_id: actor.organizationId, prospecto_id: p.id, actor_id: actor.id,
      etapa_anterior: p.etapa_contractual, etapa_nueva: input.next,
      hito_intermedio: input.action === 'REGISTRAR_ENVIO' ? Stage.SOLICITUD_ENVIADA_NOTARIA : null,
      effective_at: input.effectiveAt, recorded_at: input.recordedAt, accion: input.action,
      procedencia: input.action === 'CREAR' ? 'CREACION_CANONICA' : 'CONFIRMACION_HUMANA',
      evidencia: prospectJson(input.evidence), version: p.version_operativa + 1, idempotency_key: input.key, payload_hash: input.hash,
    } });
    await tx.prospecto.update({ where: { id: p.id, organization_id: actor.organizationId }, data: {
      etapa_contractual: input.next, transicion_actual_id: event.id, version_operativa: p.version_operativa + 1,
    } });
    await this.audit(tx, actor, p.id, input.action, { stage: p.etapa_contractual, version: p.version_operativa },
      { stage: input.next, version: p.version_operativa + 1, effectiveAt: input.effectiveAt }, event.id);
    return event;
  }
  private async folio(tx: Prisma.TransactionClient, kind: 'PRO' | 'COT', date: Date) {
    const year = date.getFullYear();
    // Folios are globally unique in the existing schema; do not tenant-filter this numeric reservation.
    await this.lock(tx, `folio:${kind}:${year}`);
    const rows = kind === 'PRO'
      ? await tx.$queryRaw<Array<{ folio: string | null }>>(Prisma.sql`SELECT folio FROM pravia_os.prospectos WHERE folio LIKE ${`PRO-%-${year}`}`)
      : await tx.$queryRaw<Array<{ folio: string | null }>>(Prisma.sql`SELECT numero_cotizacion AS folio FROM pravia_os.cotizaciones WHERE numero_cotizacion LIKE ${`COT-%-${year}`} OR numero_cotizacion LIKE ${`COT-${year}-%`}`);
    const next = rows.reduce((max, row) => {
      const match = row.folio?.match(new RegExp(`^${kind}-(\\d+)-${year}$`)) ?? row.folio?.match(new RegExp(`^${kind}-${year}-(\\d+)$`));
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0) + 1;
    return `${kind}-${String(next).padStart(4, '0')}-${year}`;
  }
  private cleanData(raw: Record<string, any>) {
    const data: any = {};
    if (raw.nombre !== undefined) {
      data.nombre = normalizeProspectName(raw.nombre);
      if (!data.nombre || data.nombre.length > 300) failProspect(400, 'PROSPECT_NAME_REQUIRED', 'Indica un nombre válido para abrir la ficha.');
    }
    for (const key of ['telefono', 'email', 'necesidad']) if (raw[key] !== undefined) data[key] = trim(raw[key]) || null;
    if (raw.prioridad !== undefined) {
      if (!['BAJA','MEDIA','ALTA'].includes(raw.prioridad)) failProspect(400, 'INVALID_PROSPECT_PRIORITY', 'Selecciona una prioridad válida.');
      data.prioridad = raw.prioridad;
    }
    for (const key of ['tiene_predial', 'tiene_antecedente']) if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'boolean') failProspect(400, 'INVALID_PROSPECT_DOCUMENT_FLAGS', 'Revisa los indicadores de documentación.');
      data[key] = raw[key];
    }
    if (raw.servicio_catalogo_codigo) {
      const service = prospectServiceByCode(raw.servicio_catalogo_codigo);
      if (!service) failProspect(400, 'INVALID_PROSPECT_SERVICE', 'Selecciona un servicio válido.');
      data.servicio_catalogo_codigo = service!.code; data.tipo_acto = service!.label;
    }
    return data;
  }
  async create(actor: Actor, raw: Record<string, unknown>, idempotencyKey: unknown) {
    permission(actor, 'prospectos.write');
    assertProspectFields(raw, newDataFields);
    const data = this.cleanData(raw);
    if (!data.nombre) failProspect(400, 'PROSPECT_NAME_REQUIRED', 'Indica el nombre para abrir la ficha.');
    const key = prospectKey(idempotencyKey), hash = prospectHash({ data, actor: actor.id });
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `create:${actor.organizationId}:${key}`);
      const previous = await tx.prospecto.findFirst({ where: { organization_id: actor.organizationId, creation_key: key } });
      if (previous) {
        if (previous.creation_hash !== hash) failProspect(409, 'PRO001_KEY_REUSED', 'Ese intento de creación ya se utilizó con otros datos.');
        return { prospecto: await this.prospect(tx, actor, previous.id), idempotent: true };
      }
      const now = new Date();
      const p = await tx.prospecto.create({ data: { ...data, id: randomUUID(), organization_id: actor.organizationId,
        user_id: actor.id, estado: 'NUEVO', folio: await this.folio(tx, 'PRO', now), creation_key: key, creation_hash: hash } });
      await this.event(tx, actor, p, { action: 'CREAR', next: Stage.NUEVO, effectiveAt: now, recordedAt: now, key, hash, evidence: { createdByActor: true } });
      return { prospecto: await this.prospect(tx, actor, p.id), idempotent: false };
    });
  }
  async update(actor: Actor, id: string, raw: Record<string, unknown>) {
    permission(actor, 'prospectos.write');
    assertProspectFields(raw, [...newDataFields, 'expectedVersion', 'notaria_id', 'responsable_id', 'etapa_operativa_codigo']);
    const data = this.cleanData(raw);
    if (raw.etapa_operativa_codigo) {
      const stage = prospectStageByCode(raw.etapa_operativa_codigo);
      if (!stage) failProspect(400, 'INVALID_PROSPECT_STAGE', 'Selecciona una etapa documental válida.');
      data.etapa_operativa_codigo = stage!.code;
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${actor.organizationId}:${id}`);
      const p = await this.prospect(tx, actor, id);
      assertProspectVersion(raw.expectedVersion, p.version_operativa);
      if (raw.notaria_id !== undefined && raw.notaria_id !== p.notaria_id) {
        if (['EN_ESPERA_COTIZACION', 'COTIZACION_RECIBIDA', 'CONVERTIDO_COTIZACION'].includes(p.etapa_contractual ?? '')) failProspect(409, 'PRO001_NOTARY_FROZEN', 'La notaría ya forma parte de un envío confirmado y no puede cambiarse desde esta ficha.');
        const notary = await this.notary(tx, actor, String(raw.notaria_id)); data.notaria_id = notary.id;
      }
      if (raw.responsable_id !== undefined && raw.responsable_id !== p.user_id) {
        if (!['DIRECCION', 'ADMINISTRACION'].includes(actor.rol)) failProspect(403, 'PRO001_ASSIGNMENT_DENIED', 'No tienes permiso para reasignar este prospecto.');
        const member = await tx.organizationMembership.findFirst({ where: { organization_id: actor.organizationId,
          user_id: String(raw.responsable_id), status: 'ACTIVE', user: { activo: true } } });
        if (!member) failProspect(400, 'PRO001_ASSIGNEE_INVALID', 'Selecciona un responsable activo de la organización.');
        data.user_id = member!.user_id;
      }
      const result = await tx.prospecto.update({ where: { id, organization_id: actor.organizationId }, data: { ...data, version_operativa: { increment: 1 } }, include: detailInclude });
      await this.audit(tx, actor, id, 'EDITAR_FICHA', Object.fromEntries(Object.keys(data).map((key) => [key, (p as any)[key]])), data);
      return result;
    });
  }
  async read(actor: Actor, id: string) {
    const p = await this.prospect(this.prisma, actor, id);
    const canDocs = actor.permissions.includes('documentos.read');
    const [events, sources, notaries, responsibles] = await Promise.all([
      this.prisma.prospectoTransicion.findMany({ where: { organization_id: actor.organizationId, prospecto_id: id }, orderBy: { version: 'asc' }, include: { actor: { select: { user: { select: { nombre: true, apellido: true } } } } } }),
      canDocs ? this.prisma.prospectoFuenteNotarial.findMany({ where: { organization_id: actor.organizationId, prospecto_id: id }, orderBy: { version: 'desc' }, include: { documento: { select: docSelect }, notaria: { select: { id: true, nombre: true } } } }) : [],
      actor.permissions.includes('notarias.read') ? this.prisma.notaria.findMany({ where: { organization_id: actor.organizationId, activa: true, archived_at: null }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }) : [],
      ['DIRECCION','ADMINISTRACION'].includes(actor.rol) ? this.prisma.organizationMembership.findMany({ where: { organization_id: actor.organizationId, status: 'ACTIVE', user: { activo: true } }, select: { user: { select: { id: true, nombre: true, apellido: true } } } }) : [],
    ]);
    const actions = actor.permissions.includes('prospectos.write') ? allowedProspectActions(p.etapa_contractual, Boolean(p.cotizacion)).filter((a) => a !== 'CONVERTIR' || actor.permissions.includes('cotizaciones.write')) : [];
    return { stage: p.etapa_contractual, stageLabel: stageLabel(p.etapa_contractual), stageEnteredAt: p.transicion_actual?.effective_at ?? null,
      knowledge: p.transicion_actual ? 'KNOWN' : 'UNKNOWN_LEGACY', version: p.version_operativa, folio: p.folio,
      wait: prospectWait(p.etapa_contractual), stages: PROSPECT_CONTRACT_STAGES,
      actions: actions.map((code) => ({ code, label: PROSPECT_ACTIONS[code] })),
      notaria: actor.permissions.includes('notarias.read') ? p.notaria : null, notaries, responsibles: responsibles.map((m) => m.user),
      source: sources[0] ?? null, sourceHistory: sources, canReadSource: canDocs, quote: p.cotizacion,
      events: events.map((e) => ({ id: e.id, previous: e.etapa_anterior, next: e.etapa_nueva, via: e.hito_intermedio,
        previousLabel: stageLabel(e.etapa_anterior), nextLabel: stageLabel(e.etapa_nueva), viaLabel: e.hito_intermedio ? stageLabel(e.hito_intermedio) : null,
        effectiveAt: e.effective_at, recordedAt: e.recorded_at, actor: [e.actor.user.nombre,e.actor.user.apellido].filter(Boolean).join(' '),
        actionLabel: e.accion === 'CREAR' ? 'Prospecto creado' : PROSPECT_ACTIONS[e.accion as ProspectAction],
        provenanceLabel: e.procedencia === 'CREACION_CANONICA' ? 'Creación registrada' : 'Confirmado por una persona' })),
      legacy: { substate: p.estado, documentaryStage: p.etapa_operativa_codigo },
    };
  }
  async prepare(actor: Actor, id: string, raw: Record<string, unknown>) {
    permission(actor, 'prospectos.write');
    assertProspectFields(raw, ['expectedVersion', 'attachmentIds']);
    const p = await this.prospect(this.prisma, actor, id);
    assertProspectVersion(raw.expectedVersion, p.version_operativa);
    if (p.etapa_contractual !== Stage.LISTO_PARA_SOLICITAR) failProspect(409, 'PRO001_NOT_READY', 'Confirma primero que la información está lista para solicitar cotización.');
    const notary = await this.notary(this.prisma, actor, p.notaria_id);
    const ids = this.attachmentIds(raw.attachmentIds);
    const docs = await Promise.all(ids.map((docId) => this.document(this.prisma, actor, id, docId)));
    return { preparedOnly: true, deliveryConfirmedByProvider: false, version: p.version_operativa, attachmentIds: ids,
      recipient: notary.correo_general || '', subject: `Solicitud de cotización — ${p.tipo_acto || 'Acto por precisar'}`,
      content: `Buen día, ${notary.nombre}.\n\nSolicitamos cotización para ${p.tipo_acto || 'el acto por precisar'}.\nSolicitante: ${p.nombre}.\nContacto: ${p.email || p.telefono || 'Por precisar'}.\n\n${p.necesidad || ''}\n\nDocumentos seleccionados:\n${docs.length ? docs.map((d) => `- ${d.nombre_original}`).join('\n') : 'Sin adjuntos seleccionados.'}\n\nQuedamos atentos.\nPRAVIA`,
    };
  }
  private attachmentIds(value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 50 || value.some((v) => typeof v !== 'string')) failProspect(400, 'PRO001_ATTACHMENTS_INVALID', 'Revisa los documentos seleccionados.');
    return [...new Set(value as string[])].sort();
  }
  async act(actor: Actor, id: string, raw: Record<string, unknown>) {
    permission(actor, 'prospectos.write');
    assertProspectFields(raw, actionFields);
    const action = raw.action as ProspectAction;
    if (!Object.prototype.hasOwnProperty.call(PROSPECT_ACTIONS, action)) failProspect(400, 'PRO001_ACTION_INVALID', 'Selecciona una acción válida.');
    if (raw.confirm !== true) failProspect(400, 'PRO001_CONFIRM_REQUIRED', 'Revisa y confirma la acción antes de continuar.');
    if (action === 'CONVERTIR') permission(actor, 'cotizaciones.write');
    const key = prospectKey(raw.idempotencyKey), hash = prospectHash({ ...raw, actor: actor.id });
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `${actor.organizationId}:${id}`);
      const p = await this.prospect(tx, actor, id);
      const replayWhere = { organization_id: actor.organizationId, prospecto_id: id, idempotency_key: key };
      const existingEvent = await tx.prospectoTransicion.findFirst({ where: replayWhere });
      const existingSource = await tx.prospectoFuenteNotarial.findFirst({ where: replayWhere });
      if (existingEvent || existingSource) {
        assertProspectReplay((existingEvent || existingSource)!, hash, actor.id);
        return { idempotent: true, eventId: existingEvent?.id ?? null, quoteId: p.cotizacion?.id ?? null };
      }
      assertProspectVersion(raw.expectedVersion, p.version_operativa);
      const next = nextProspectStage(p.etapa_contractual, action, Boolean(p.cotizacion));
      const recordedAt = new Date();
      const effectiveAt = prospectEffectiveAt(raw.effectiveAt, recordedAt, p.transicion_actual?.effective_at ?? null,
        action === 'REGISTRAR_ENVIO' || action === 'REGISTRAR_RECEPCION');
      let evidence: Record<string, unknown> = { reason: trim(raw.reason) || 'Confirmación explícita del actor' };
      let quoteId: string | null = null;
      if (action === 'REGISTRAR_ENVIO') {
        const notary = await this.notary(tx, actor, p.notaria_id);
        if (!trim(raw.channel) || !trim(raw.recipient) || !trim(raw.evidence) || !trim(raw.content)) failProspect(400, 'PRO001_SEND_EVIDENCE_REQUIRED', 'Indica canal, destinatario, contenido revisado y evidencia del envío realizado.');
        const ids = this.attachmentIds(raw.attachmentIds);
        await Promise.all(ids.map((docId) => this.document(tx, actor, id, docId)));
        evidence = { notaryId: notary.id, channel: trim(raw.channel, 100), recipient: trim(raw.recipient, 300),
          evidence: trim(raw.evidence), content: trim(raw.content, 20000), attachmentIds: ids, deliveryConfirmedByProvider: false };
      }
      if (action === 'REGISTRAR_RECEPCION' || action === 'SUSTITUIR_FUENTE') {
        permission(actor, 'documentos.write');
        const notary = await this.notary(tx, actor, p.notaria_id);
        const document = await this.document(tx, actor, id, String(raw.documentId || ''));
        const previous = await tx.prospectoFuenteNotarial.findFirst({ where: { organization_id: actor.organizationId, prospecto_id: id }, orderBy: { version: 'desc' } });
        if ((action === 'REGISTRAR_RECEPCION' && previous) || (action === 'SUSTITUIR_FUENTE' && !previous)) failProspect(409, 'PRO001_SOURCE_CHANGED', 'La fuente cambió. Actualiza la ficha.');
        if (action === 'SUSTITUIR_FUENTE' && !trim(raw.reason)) failProspect(400, 'PRO001_REASON_REQUIRED', 'Indica el motivo de sustitución.');
        const duplicate = await tx.prospectoFuenteNotarial.findFirst({ where: { organization_id: actor.organizationId, prospecto_id: id,
          OR: [{ documento_id: document.id }, ...(document.checksum_sha256 ? [{ documento: { checksum_sha256: document.checksum_sha256 } }] : [])] } });
        if (duplicate) failProspect(409, 'PRO001_SOURCE_DUPLICATE', 'Ese archivo ya forma parte de la historia de la fuente notarial.');
        const source = await tx.prospectoFuenteNotarial.create({ data: { organization_id: actor.organizationId, prospecto_id: id,
          documento_id: document.id, notaria_id: notary.id, actor_id: actor.id, version: (previous?.version ?? 0) + 1,
          received_at: previous?.received_at ?? effectiveAt, recorded_at: recordedAt, origen: 'NOTARIA_CONFIRMADA_POR_USUARIO',
          motivo: trim(raw.reason) || 'Recepción notarial confirmada', sustituye_id: previous?.id ?? null, idempotency_key: key, payload_hash: hash } });
        evidence = { sourceId: source.id, documentId: document.id, notaryId: notary.id, firstReceivedAt: source.received_at };
        if (action === 'SUSTITUIR_FUENTE') {
          await tx.prospecto.update({ where: { id, organization_id: actor.organizationId }, data: { version_operativa: { increment: 1 } } });
          await this.audit(tx, actor, id, action, { sourceId: previous!.id, receivedAt: previous!.received_at }, evidence);
          return { idempotent: false, eventId: null, sourceId: source.id, quoteId: null };
        }
      }
      if (action === 'CONVERTIR') {
        const source = await tx.prospectoFuenteNotarial.findFirst({ where: { organization_id: actor.organizationId, prospecto_id: id }, orderBy: { version: 'desc' } });
        if (!source) return failProspect(409, 'PRO001_SOURCE_REQUIRED', 'Registra primero la cotización recibida de Notaría.');
        await this.notary(tx, actor, source.notaria_id);
        await this.document(tx, actor, id, source.documento_id, true);
        const quote = await tx.cotizacion.create({ data: { organization_id: actor.organizationId, prospecto_id: id, user_id: p.user_id,
          notaria_id: source.notaria_id, fuente_notarial_id: source.id, numero_cotizacion: await this.folio(tx, 'COT', recordedAt),
          estado: 'BORRADOR', fecha_presupuesto_recibido: source.received_at } });
        await tx.cotizacionDocumento.create({ data: { organization_id: actor.organizationId, cotizacion_id: quote.id,
          documento_id: source.documento_id, tipo_vinculo: 'COTIZACION_NOTARIA', creado_por_id: actor.id, estatus: 'ACTIVO' } });
        await initializeQuoteContractInTransaction(tx, actor, quote, {
          effectiveAt: recordedAt,
          idempotencyKey: `cot001:${key}`,
          sourceId: source.id,
          prospectId: id,
        });
        quoteId = quote.id; evidence = { quoteId, sourceId: source.id };
      }
      const event = await this.event(tx, actor, p, { action, next, effectiveAt, recordedAt, key, hash, evidence });
      return { idempotent: false, eventId: event.id, quoteId };
    }, { timeout: 15000, maxWait: 10000 });
  }
}
