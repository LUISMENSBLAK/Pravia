import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, TimingPolicyType } from '@prisma/client';
import type { Request } from 'express';
import { MidBaseSourceService } from '../services/midBaseSource.service';

function isolatedTarget() {
  const raw = process.env.DATABASE_URL || '';
  const url = new URL(raw);
  if (
    process.env.NODE_ENV !== 'test'
    || process.env.G1_PG_TEST_CONFIRMATION !== 'RUN_ISOLATED_G1_POSTGRESQL'
    || raw !== process.env.DIRECT_URL
    || url.hostname !== '127.0.0.1'
    || url.port !== '55477'
    || url.pathname !== '/pravia_g1'
  ) throw new Error('G1 PostgreSQL requires the explicit isolated local target.');
  return raw;
}

const url = isolatedTarget();
const db = new PrismaClient({ datasources: { db: { url } } });
const service = new MidBaseSourceService(db);
const ids = {
  org: randomUUID(), otherOrg: randomUUID(), user: randomUUID(), otherUser: randomUUID(), membership: randomUUID(), otherMembership: randomUUID(),
  prospect: randomUUID(), otherProspect: randomUUID(), prospectTransition: randomUUID(), quoteProspect: randomUUID(), quote: randomUUID(), quoteCreateTransition: randomUUID(), quoteTransition: randomUUID(),
  notary: randomUUID(), document: randomUUID(), notarySource: randomUUID(),
  type: randomUUID(), configuration: randomUUID(), preStage: randomUUID(), signatureStage: randomUUID(), postStage: randomUUID(),
  preMaster: randomUUID(), signatureMaster: randomUUID(), postMaster: randomUUID(), preCase: randomUUID(), postCase: randomUUID(), deliveredCase: randomUUID(),
  preAct: randomUUID(), postAct: randomUUID(), deliveredAct: randomUUID(), preActivity: randomUUID(), postActivity: randomUUID(), deliveredActivity: randomUUID(),
  request: randomUUID(), receipt: randomUUID(), prospectPolicy: randomUUID(), adminPolicy: randomUUID(), prospectInterval: randomUUID(), adminInterval: randomUUID(),
};
const now = new Date('2026-09-05T12:00:00.000Z');
type Actor = NonNullable<Request['user']>;
const actor: Actor = {
  id: ids.user, organizationId: ids.org, membershipId: ids.membership, sessionId: randomUUID(), rol: 'ADMINISTRACION',
  nombre: 'G1', apellido: 'Fixture', email: `g1-${ids.user}@example.test`, scope: 'GLOBAL', requiresPasswordChange: false,
  permissions: ['mi_dia.read', 'prospectos.read', 'cotizaciones.read', 'expedientes.read', 'finanzas.read'],
};

async function snapshot() {
  const [prospects, quotes, cases, transitions, activities, audits, requests, receipts, intervals, policies] = await Promise.all([
    db.prospecto.count(), db.cotizacion.count(), db.expediente.count(),
    db.prospectoTransicion.count().then(async (value) => value + await db.cotizacionTransicion.count()),
    db.expedienteSeguimientoActividad.count(), db.auditLog.count(), db.expedienteSolicitudPago.count(), db.expedienteIngresoReportado.count(),
    db.timingInterval.count(), db.timingPolicyRevision.count(),
  ]);
  const versions = await db.$queryRawUnsafe<Array<{ prospect_version: number; quote_version: number; activity_version: number }>>(`
    SELECT p.version_operativa prospect_version,q.version_operativa quote_version,a.version activity_version
    FROM pravia_os.prospectos p,pravia_os.cotizaciones q,pravia_os.expediente_seguimiento_actividades a
    WHERE p.id='${ids.prospect}'::uuid AND q.id='${ids.quote}'::uuid AND a.id='${ids.preActivity}'::uuid`);
  return { prospects, quotes, cases, transitions, activities, audits, requests, receipts, intervals, policies, versions };
}

beforeAll(async () => {
  await db.organization.createMany({ data: [{ id: ids.org, name: 'G1 fixture' }, { id: ids.otherOrg, name: 'G1 other tenant' }] });
  await db.user.createMany({ data: [
    { id: ids.user, email: actor.email, password_hash: 'not-a-login-secret', nombre: 'G1', apellido: 'Fixture', rol: 'ADMINISTRACION', requires_password_change: false },
    { id: ids.otherUser, email: `g1-${ids.otherUser}@example.test`, password_hash: 'not-a-login-secret', nombre: 'Other', apellido: 'Tenant', rol: 'ABOGADO', requires_password_change: false },
  ] });
  await db.organizationMembership.createMany({ data: [
    { id: ids.membership, organization_id: ids.org, user_id: ids.user, rol: 'ADMINISTRACION' },
    { id: ids.otherMembership, organization_id: ids.otherOrg, user_id: ids.otherUser, rol: 'ABOGADO' },
  ] });
  await db.prospecto.createMany({ data: [
    { id: ids.prospect, organization_id: ids.org, nombre: 'Fixture G1', user_id: ids.user },
    { id: ids.quoteProspect, organization_id: ids.org, nombre: 'Quote origin G1', user_id: ids.user },
    { id: ids.otherProspect, organization_id: ids.otherOrg, nombre: 'Invisible G1', user_id: ids.otherUser },
  ] });
  await db.$transaction(async (tx) => {
    await tx.prospectoTransicion.create({ data: {
      id: ids.prospectTransition, organization_id: ids.org, prospecto_id: ids.prospect, actor_id: ids.user,
      etapa_anterior: 'LISTO_PARA_SOLICITAR', etapa_nueva: 'EN_ESPERA_COTIZACION', hito_intermedio: 'SOLICITUD_ENVIADA_NOTARIA', effective_at: new Date('2026-09-04T00:00:00Z'),
      recorded_at: new Date('2026-09-04T00:00:00Z'), accion: 'REGISTRAR_ENVIO', procedencia: 'CONFIRMACION_HUMANA', evidencia: {}, version: 1,
      idempotency_key: `g1-prospect-${ids.prospect}`, payload_hash: 'a'.repeat(64),
    } });
    await tx.prospecto.update({ where: { id: ids.prospect }, data: { etapa_contractual: 'EN_ESPERA_COTIZACION', version_operativa: 1, transicion_actual_id: ids.prospectTransition } });
  });
  await db.notaria.create({ data: { id: ids.notary, organization_id: ids.org, nombre: 'Notaría G1' } });
  await db.documento.create({ data: {
    id: ids.document, organization_id: ids.org, nombre_original: 'g1-source.pdf', nombre_interno: `g1-${ids.document}.pdf`, tipo: 'PRO001_NOTARY_SOURCE',
    storage_key: `g1/${ids.document}.pdf`, mime_type: 'application/pdf', size_bytes: 1, checksum_sha256: 'e'.repeat(64), estatus: 'VIGENTE', subido_por_id: ids.user,
  } });
  await db.prospectoFuenteNotarial.create({ data: {
    id: ids.notarySource, organization_id: ids.org, prospecto_id: ids.quoteProspect, documento_id: ids.document, notaria_id: ids.notary, actor_id: ids.user,
    version: 1, received_at: new Date('2026-09-02T00:00:00Z'), recorded_at: new Date('2026-09-02T00:00:00Z'), origen: 'CARGA_HUMANA', motivo: 'Fixture contractual G1',
    idempotency_key: `g1-source-${ids.notarySource}`, payload_hash: 'f'.repeat(64),
  } });
  await db.cotizacion.create({ data: { id: ids.quote, organization_id: ids.org, user_id: ids.user, prospecto_id: ids.quoteProspect, notaria_id: ids.notary, fuente_notarial_id: ids.notarySource } });
  await db.$transaction(async (tx) => {
    await tx.cotizacionTransicion.create({ data: {
      id: ids.quoteCreateTransition, organization_id: ids.org, cotizacion_id: ids.quote, actor_id: ids.user, etapa_anterior: null, etapa_nueva: 'BORRADOR',
      effective_at: new Date('2026-09-02T00:00:00Z'), recorded_at: new Date('2026-09-02T00:00:00Z'), accion: 'CREAR', procedencia: 'CONVERSION_PRO001',
      evidencia: {}, version: 1, idempotency_key: `g1-quote-create-${ids.quote}`, payload_hash: 'b'.repeat(64), cambia_etapa: true,
    } });
    await tx.cotizacion.update({ where: { id: ids.quote }, data: { estado: 'BORRADOR', etapa_contractual: 'BORRADOR', version_operativa: 1, transicion_actual_id: ids.quoteCreateTransition } });
  });
  await db.$transaction(async (tx) => {
    await tx.cotizacionTransicion.create({ data: {
      id: ids.quoteTransition, organization_id: ids.org, cotizacion_id: ids.quote, actor_id: ids.user, etapa_anterior: 'BORRADOR', etapa_nueva: 'ENVIADA_CLIENTE',
      effective_at: new Date('2026-09-03T00:00:00Z'), recorded_at: new Date('2026-09-03T00:00:00Z'), accion: 'ENVIAR_CLIENTE', procedencia: 'CONFIRMACION_HUMANA',
      canal: 'EMAIL', destinatario: 'fixture@example.test', evidencia: {}, version: 2, idempotency_key: `g1-quote-send-${ids.quote}`, payload_hash: 'c'.repeat(64), cambia_etapa: true,
    } });
    await tx.cotizacion.update({ where: { id: ids.quote }, data: { estado: 'ENVIADA_CLIENTE', etapa_contractual: 'ENVIADA_CLIENTE', version_operativa: 2, transicion_actual_id: ids.quoteTransition, fecha_enviada_cliente: new Date('2026-09-03T00:00:00Z') } });
  });

  await db.tipoActo.create({ data: { id: ids.type, organization_id: ids.org, nombre: 'Acto G1' } });
  await db.configuracionActo.create({ data: { id: ids.configuration, organization_id: ids.org, tipo_acto_id: ids.type, revision: 1, requiere_revision: false, creado_por_id: ids.user, actualizado_por_id: ids.user } });
  await db.configuracionEtapa.createMany({ data: [
    { id: ids.preStage, organization_id: ids.org, configuracion_id: ids.configuration, nombre: 'Prefirma', orden: 1 },
    { id: ids.signatureStage, organization_id: ids.org, configuracion_id: ids.configuration, nombre: 'Firma', orden: 2 },
    { id: ids.postStage, organization_id: ids.org, configuracion_id: ids.configuration, nombre: 'Postfirma', orden: 3 },
  ] });
  await db.configuracionActividad.createMany({ data: [
    { id: ids.preMaster, organization_id: ids.org, etapa_id: ids.preStage, nombre: 'Integrar', duracion_estimada: 2, tipo_dias: 'NATURALES', responsable_rol: 'ABOGADO' },
    { id: ids.signatureMaster, organization_id: ids.org, etapa_id: ids.signatureStage, nombre: 'Firmar', duracion_estimada: 1, tipo_dias: 'NATURALES', responsable_rol: 'ABOGADO' },
    { id: ids.postMaster, organization_id: ids.org, etapa_id: ids.postStage, nombre: 'Registrar', duracion_estimada: 3, tipo_dias: 'NATURALES', responsable_rol: 'GESTORIA' },
  ] });
  await db.expediente.createMany({ data: [
    { id: ids.preCase, organization_id: ids.org, numero_pravia: `EXP-G1-${ids.preCase.slice(0, 8)}`, abogado_id: ids.user, creador_id: ids.user, tipo_acto_id: ids.type, estatus: 'FIRMA_PROGRAMADA', fecha_estimada_firma: new Date('2026-09-10T00:00:00Z') },
    { id: ids.postCase, organization_id: ids.org, numero_pravia: `EXP-G1-${ids.postCase.slice(0, 8)}`, abogado_id: ids.user, creador_id: ids.user, tipo_acto_id: ids.type, estatus: 'POST_FIRMA', fecha_real_firma: new Date('2026-09-04T00:00:00Z') },
    { id: ids.deliveredCase, organization_id: ids.org, numero_pravia: `EXP-G1-${ids.deliveredCase.slice(0, 8)}`, abogado_id: ids.user, creador_id: ids.user, tipo_acto_id: ids.type, estatus: 'ENTREGADO', fecha_real_firma: new Date('2026-09-03T00:00:00Z'), fecha_entrega_cliente: new Date('2026-09-05T00:00:00Z') },
  ] });
  await db.expedienteActo.createMany({ data: [
    { id: ids.preAct, organization_id: ids.org, expediente_id: ids.preCase, tipo_acto_id: ids.type, origen: 'ADICIONAL', created_by: ids.user },
    { id: ids.postAct, organization_id: ids.org, expediente_id: ids.postCase, tipo_acto_id: ids.type, origen: 'ADICIONAL', created_by: ids.user },
    { id: ids.deliveredAct, organization_id: ids.org, expediente_id: ids.deliveredCase, tipo_acto_id: ids.type, origen: 'ADICIONAL', created_by: ids.user },
  ] });
  const operational = (id: string, caseId: string, actId: string, masterId: string, stageId: string, stage: string, order: number) => ({
    id, organization_id: ids.org, expediente_id: caseId, expediente_acto_id: actId, tipo_acto_id: ids.type, configuracion_acto_id: ids.configuration,
    configuracion_revision: 1, etapa_maestra_id: stageId, actividad_maestra_id: masterId, etapa_nombre_snapshot: stage, etapa_orden_snapshot: order,
    actividad_nombre_snapshot: stage === 'Postfirma' ? 'Registrar' : 'Integrar', duracion_estimada: stage === 'Postfirma' ? 3 : 2,
    tipo_dias: 'NATURALES' as const, margen_seguridad: 1, responsable_rol_snapshot: stage === 'Postfirma' ? 'GESTORIA' as const : 'ABOGADO' as const,
    responsable_id: ids.user, responsable_default_id: ids.user, resolucion_fuente: 'GENERAL', estado: 'EN_PROCESO' as const,
    primera_fecha_inicio: new Date('2026-09-03T00:00:00Z'),
  });
  await db.expedienteSeguimientoActividad.createMany({ data: [
    operational(ids.preActivity, ids.preCase, ids.preAct, ids.preMaster, ids.preStage, 'Prefirma', 1),
    operational(ids.postActivity, ids.postCase, ids.postAct, ids.postMaster, ids.postStage, 'Postfirma', 3),
    operational(ids.deliveredActivity, ids.deliveredCase, ids.deliveredAct, ids.postMaster, ids.postStage, 'Postfirma', 3),
  ] });
  await db.expedienteSolicitudPago.create({ data: { id: ids.request, organization_id: ids.org, expediente_id: ids.preCase, via: 'DOCUMENTO_EXTERNO', concepto: 'Derechos', importe: 100, creado_por_id: ids.user, created_at: new Date('2026-09-04T00:00:00Z'), idempotency_key: `g1-request-${ids.request}` } });
  await db.expedienteIngresoReportado.create({ data: { id: ids.receipt, organization_id: ids.org, expediente_id: ids.preCase, reportado_por_id: ids.user, created_at: new Date('2026-09-04T01:00:00Z'), idempotency_key: `g1-receipt-${ids.receipt}` } });
  await db.timingPolicyRevision.createMany({ data: [
    { id: ids.prospectPolicy, organization_id: ids.org, domain: 'COMMERCIAL', policy_type: TimingPolicyType.PROSPECT_NOTARY_WAIT, revision: 1, duration: 24, unit: 'HOURS', calendar_semantics: 'ELAPSED_UTC', provenance: { source: 'G1 fixture' }, created_by_id: ids.user, created_at: new Date('2026-09-01T00:00:00Z'), published_at: new Date('2026-09-01T00:00:00Z'), idempotency_key: `g1-policy-${ids.prospectPolicy}`, payload_hash: 'c'.repeat(64) },
    { id: ids.adminPolicy, organization_id: ids.org, domain: 'ADMINISTRATIVE', policy_type: TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, revision: 1, duration: 48, unit: 'HOURS', calendar_semantics: 'ELAPSED_UTC', provenance: { source: 'G1 fixture' }, created_by_id: ids.user, created_at: new Date('2026-09-01T00:00:00Z'), published_at: new Date('2026-09-01T00:00:00Z'), idempotency_key: `g1-policy-${ids.adminPolicy}`, payload_hash: 'd'.repeat(64) },
  ] });
  await db.timingInterval.createMany({ data: [
    { id: ids.prospectInterval, organization_id: ids.org, policy_type: TimingPolicyType.PROSPECT_NOTARY_WAIT, calculation_status: 'CALCULABLE', policy_revision_id: ids.prospectPolicy, prospecto_id: ids.prospect, opened_transition_id: ids.prospectTransition, opened_at: new Date('2026-09-04T00:00:00Z'), provenance: { source: 'PRO-001' } },
    { id: ids.adminInterval, organization_id: ids.org, policy_type: TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, calculation_status: 'CALCULABLE', policy_revision_id: ids.adminPolicy, payment_request_id: ids.request, opened_at: new Date('2026-09-04T00:00:00Z'), provenance: { source: 'EXP-008' } },
  ] });
});

afterAll(async () => db.$disconnect());

describe('G1 MID-BASE · prueba física PostgreSQL read-only', () => {
  it('ejecuta las cinco fuentes repetidamente con cero mutaciones', async () => {
    const before = await snapshot();
    const first = await service.read(actor, { now, limit: 100 });
    const second = await service.read(actor, { now, limit: 100 });
    const after = await snapshot();
    expect(second).toEqual(first);
    expect(after).toEqual(before);
    expect(new Set(first.rows.map((row) => row.sourceKind))).toEqual(new Set(['PROSPECT', 'QUOTE', 'PRE_SIGNATURE', 'POST_SIGNATURE', 'ADMINISTRATION']));
    expect(first.rows.some((row) => row.objectId === ids.otherProspect)).toBe(false);
    expect(first.rows.some((row) => row.objectId === ids.deliveredCase)).toBe(false);
  });

  it('mantiene fechas, policy pinning y semántica de espera canónicas', async () => {
    const result = await service.read(actor, { now });
    expect(result.rows.find((row) => row.objectId === ids.prospect)).toMatchObject({ waitingOn: 'NOTARY', effectiveAt: new Date('2026-09-04T00:00:00Z'), time: { policyRevisionId: ids.prospectPolicy, policyRevision: 1, calculationState: 'CALCULABLE' } });
    expect(result.rows.find((row) => row.objectId === ids.quote)).toMatchObject({ waitingOn: 'CLIENT', firstSentAt: new Date('2026-09-03T00:00:00Z'), internalUrgency: null });
    expect(result.rows.find((row) => row.objectId === ids.receipt)).toMatchObject({ sourceKind: 'ADMINISTRATION', time: { calculationState: 'UNKNOWN_LEGACY', overdue: null } });
  });
});
