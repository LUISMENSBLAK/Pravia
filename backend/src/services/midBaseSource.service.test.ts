import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MidBaseSourceService } from './midBaseSource.service';

const fixedNow = new Date('2026-09-05T12:00:00.000Z');
const org = '10000000-0000-4000-8000-000000000001';
type Actor = NonNullable<Request['user']>;
const actor = (overrides: Partial<Actor> = {}): Actor => ({
  id: '20000000-0000-4000-8000-000000000001', organizationId: org, membershipId: '30000000-0000-4000-8000-000000000001',
  sessionId: '40000000-0000-4000-8000-000000000001', rol: 'ADMINISTRACION', nombre: 'Admin', apellido: 'Prueba', email: 'admin@example.test',
  scope: 'GLOBAL', requiresPasswordChange: false, permissions: ['mi_dia.read', 'prospectos.read', 'cotizaciones.read', 'expedientes.read', 'finanzas.read'], ...overrides,
});

const prospect = (id: string, stage: any, transition: any) => ({
  id, organization_id: org, user_id: actor().id, etapa_contractual: stage, transicion_actual: transition, fuentes_notariales: [],
});
const quote = (id: string, stage: any) => ({
  id, organization_id: org, user_id: actor().id, prospecto_id: 'p-known', etapa_contractual: stage,
  fecha_aceptacion_cliente: stage === 'ACEPTO_ANTICIPO' ? new Date('2026-09-03T10:00:00Z') : null,
  fecha_conversion_expediente: null,
  transicion_actual: { id: `transition-${id}`, effective_at: new Date('2026-09-02T10:00:00Z'), accion: stage, procedencia: 'CONFIRMACION_HUMANA' },
  expediente: null,
});
const caseRow = (id: string, status: any, signed = false, delivered = false) => ({
  id, organization_id: org, estatus: status, fecha_estimada_firma: new Date('2026-09-10T12:00:00Z'),
  fecha_real_firma: signed ? new Date('2026-09-04T12:00:00Z') : null,
  fecha_entrega_cliente: delivered ? new Date('2026-09-05T10:00:00Z') : null,
  abogado_id: actor().id, gestor_id: null,
});
const activity = (id: string, caseId: string, stage: string, order: number) => ({
  id, organization_id: org, expediente_id: caseId, expediente_acto_id: `act-${caseId}`, tipo_acto_id: 'type',
  configuracion_acto_id: 'cfg', configuracion_revision: 3, etapa_maestra_id: `stage-${order}`, actividad_maestra_id: `master-${id}`,
  etapa_nombre_snapshot: stage, etapa_orden_snapshot: order, actividad_nombre_snapshot: id, actividad_descripcion_snapshot: null,
  duracion_estimada: 2, tipo_dias: 'NATURALES', margen_seguridad: 1, responsable_rol_snapshot: 'ABOGADO', responsable_default_id: actor().id,
  responsable_id: actor().id, aplica_por_defecto: true, excepcion_maestra_id: null, excepciones_coincidentes: null, resolucion_fuente: 'GENERAL',
  excepcion_operativa: null, estado: 'EN_PROCESO', version: 1, en_alcance: true, requiere_revision: false, motivo_revision: null,
  primera_fecha_inicio: new Date('2026-09-03T12:00:00Z'), fecha_completada_actual: null, created_at: fixedNow, updated_at: fixedNow,
});

function database() {
  return {
    prospecto: { findMany: vi.fn() }, cotizacion: { findMany: vi.fn() }, expediente: { findMany: vi.fn() },
    timingInterval: { findMany: vi.fn() }, timingPolicyRevision: { findMany: vi.fn() }, cotizacionTransicion: { findMany: vi.fn() },
    expedienteSeguimientoActividad: { findMany: vi.fn() }, expedienteSeguimientoDependencia: { findMany: vi.fn() },
    expedienteSolicitudPago: { findMany: vi.fn() }, expedienteIngresoReportado: { findMany: vi.fn() },
    auditLog: { create: vi.fn() }, expedienteActividad: { create: vi.fn() },
  };
}

function representativeDb() {
  const db = database();
  db.prospecto.findMany.mockResolvedValue([
    prospect('p-known', 'EN_ESPERA_COTIZACION', { id: 'pt1', effective_at: new Date('2026-09-04T00:00:00Z'), accion: 'REGISTRAR_ENVIO', procedencia: 'CONFIRMACION_HUMANA' }),
    prospect('p-legacy', 'RECABANDO_INFORMACION', null),
  ]);
  db.cotizacion.findMany.mockResolvedValue([quote('q-sent', 'ENVIADA_CLIENTE'), quote('q-suspended', 'SUSPENDIDA'), quote('q-accepted', 'ACEPTO_ANTICIPO')]);
  db.expediente.findMany.mockResolvedValue([caseRow('case-pre', 'FIRMA_PROGRAMADA'), caseRow('case-post', 'POST_FIRMA', true), caseRow('case-delivered', 'ENTREGADO', true, true)]);
  db.cotizacionTransicion.findMany.mockResolvedValue([{ cotizacion_id: 'q-sent', effective_at: new Date('2026-09-01T10:00:00Z'), procedencia: 'CONFIRMACION_HUMANA' }]);
  db.expedienteSeguimientoActividad.findMany.mockResolvedValue([
    activity('pre-work', 'case-pre', 'Prefirma', 1), activity('pre-blocker', 'case-pre', 'Firma', 2),
    activity('post-work', 'case-post', 'Postfirma', 3), activity('delivered-work', 'case-delivered', 'Postfirma', 3),
  ]);
  db.expedienteSeguimientoDependencia.findMany.mockResolvedValue([{ id: 'dep', organization_id: org, expediente_id: 'case-pre', actividad_id: 'pre-blocker', depende_actividad_id: 'pre-work', dependencia_maestra_id: null, excepcion_dependencia_maestra_id: null, bloqueante: true, created_at: fixedNow }]);
  db.expedienteSolicitudPago.findMany.mockResolvedValue([{ id: 'payment', organization_id: org, expediente_id: 'case-pre', creado_por_id: actor().id, created_at: new Date('2026-09-04T00:00:00Z'), fecha_limite: null }]);
  db.expedienteIngresoReportado.findMany.mockResolvedValue([{ id: 'receipt', organization_id: org, expediente_id: 'case-pre', reportado_por_id: actor().id, created_at: new Date('2026-09-04T01:00:00Z') }]);
  const intervals = [
    { id: 'i-prospect', organization_id: org, policy_type: 'PROSPECT_NOTARY_WAIT', calculation_status: 'CALCULABLE', policy_revision_id: 'r1', prospecto_id: 'p-known', payment_request_id: null, receipt_report_id: null, opened_at: new Date('2026-09-04T00:00:00Z'), closed_at: null, provenance: { source: 'PRO-001' } },
    { id: 'i-payment', organization_id: org, policy_type: 'ADMIN_PAYMENT_REQUEST_PENDING', calculation_status: 'CALCULABLE', policy_revision_id: 'r-admin', prospecto_id: null, payment_request_id: 'payment', receipt_report_id: null, opened_at: new Date('2026-09-04T00:00:00Z'), closed_at: null, provenance: { source: 'EXP-008' } },
  ];
  db.timingInterval.findMany.mockResolvedValueOnce([intervals[0]]).mockResolvedValueOnce([intervals[1]]);
  db.timingPolicyRevision.findMany.mockResolvedValue([
    { id: 'r1', revision: 1, duration: 24, unit: 'HOURS', calendar_semantics: 'ELAPSED_UTC', domain: 'COMMERCIAL', policy_type: 'PROSPECT_NOTARY_WAIT', provenance: { source: 'agreement' }, created_by_id: actor().id, created_at: fixedNow, published_at: fixedNow, superseded_at: null },
    { id: 'r-admin', revision: 7, duration: 48, unit: 'HOURS', calendar_semantics: 'ELAPSED_UTC', domain: 'ADMINISTRATIVE', policy_type: 'ADMIN_PAYMENT_REQUEST_PENDING', provenance: { source: 'agreement' }, created_by_id: actor().id, created_at: fixedNow, published_at: fixedNow, superseded_at: null },
  ]);
  return db;
}

describe('G1 MID-BASE · fuentes canónicas integradas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requiere permiso Mi Día y no lo sustituye con permisos de dominio', async () => {
    const db = representativeDb();
    await expect(new MidBaseSourceService(db as unknown as PrismaClient).read(actor({ permissions: ['prospectos.read'] }))).rejects.toMatchObject({ status: 403 });
  });

  it('journeys 1-8 exponen hechos sin ranking, mezcla financiera ni fecha updated_at', async () => {
    const db = representativeDb();
    const result = await new MidBaseSourceService(db as unknown as PrismaClient).read(actor(), { now: fixedNow, limit: 50 });
    const known = result.rows.find((row) => row.objectId === 'p-known')!;
    const legacy = result.rows.find((row) => row.objectId === 'p-legacy')!;
    const sent: any = result.rows.find((row) => row.objectId === 'q-sent')!;
    expect(known).toMatchObject({ sourceKind: 'PROSPECT', waitingOn: 'NOTARY', effectiveAt: new Date('2026-09-04T00:00:00Z'), time: { calculationState: 'CALCULABLE', policyRevision: 1 } });
    expect(legacy).toMatchObject({ stageDateKnowledge: 'UNKNOWN_LEGACY', effectiveAt: null, time: { calculationState: 'UNKNOWN_LEGACY', openedAt: null, overdue: null } });
    expect(sent).toMatchObject({ sourceKind: 'QUOTE', waitingOn: 'CLIENT', firstSentAt: new Date('2026-09-01T10:00:00Z'), internalUrgency: null });
    expect(result.rows.filter((row) => row.sourceKind === 'PRE_SIGNATURE').map((row) => row.objectId)).toEqual(['case-pre', 'case-pre']);
    expect(result.rows.filter((row) => row.sourceKind === 'POST_SIGNATURE').map((row) => row.objectId)).toEqual(['case-post']);
    expect(result.rows.some((row) => row.objectId === 'case-delivered')).toBe(false);
    expect(result.rows.filter((row) => row.sourceKind === 'ADMINISTRATION')).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/priorityRank|priorityScore|globalUrgency|myDayOrder|cum-pag/i);
  });

  it('SUSPENDIDA es histórica no activa; aceptación es hito COT-001, no pago EXP-008', async () => {
    const result = await new MidBaseSourceService(representativeDb() as unknown as PrismaClient).read(actor(), { now: fixedNow });
    expect(result.rows.find((row) => row.objectId === 'q-suspended')).toMatchObject({ active: false, waitingOn: 'NONE' });
    expect(result.rows.find((row) => row.objectId === 'q-accepted')).toMatchObject({ commercialMilestoneAt: new Date('2026-09-03T10:00:00Z'), provenance: { source: 'COT-001' } });
  });

  it('consume el workflow sustituto sin generar hechos activos de espera de Notaría', async () => {
    const db = database();
    db.prospecto.findMany.mockResolvedValue([
      prospect('p-integration', 'EN_INTEGRACION', { id: 'pt-new-1', effective_at: new Date('2026-09-04T00:00:00Z'), accion: 'COMENZAR_INTEGRACION', procedencia: 'CONFIRMACION_HUMANA' }),
      prospect('p-ready', 'LISTO_PARA_COTIZAR', { id: 'pt-new-2', effective_at: new Date('2026-09-04T01:00:00Z'), accion: 'MARCAR_LISTO_PARA_COTIZAR', procedencia: 'CONFIRMACION_HUMANA' }),
    ]);
    db.cotizacion.findMany.mockResolvedValue([]);
    db.expediente.findMany.mockResolvedValue([]);
    db.timingInterval.findMany.mockResolvedValue([
      { id: 'i-new-1', organization_id: org, policy_type: 'PROSPECT_INFO_COLLECTION', calculation_status: 'NOT_CONFIGURED', policy_revision_id: null, prospecto_id: 'p-integration', payment_request_id: null, receipt_report_id: null, opened_at: new Date('2026-09-04T00:00:00Z'), closed_at: null, provenance: { source: 'CORRECCION_001' } },
      { id: 'i-new-2', organization_id: org, policy_type: 'PROSPECT_READY_TO_REQUEST', calculation_status: 'NOT_CONFIGURED', policy_revision_id: null, prospecto_id: 'p-ready', payment_request_id: null, receipt_report_id: null, opened_at: new Date('2026-09-04T01:00:00Z'), closed_at: null, provenance: { source: 'CORRECCION_001' } },
    ]);
    const result = await new MidBaseSourceService(db as unknown as PrismaClient).read(actor(), { now: fixedNow });
    expect(result.rows.find((row) => row.objectId === 'p-integration')).toMatchObject({ waitingOn: 'CLIENT', notaryFact: 'NOT_APPLICABLE' });
    expect(result.rows.find((row) => row.objectId === 'p-ready')).toMatchObject({ waitingOn: 'OFFICE', notaryFact: 'NOT_APPLICABLE' });
    expect(result.rows.some((row) => row.waitingOn === 'NOTARY')).toBe(false);
  });

  it('clasifica como UNKNOWN_LEGACY una etapa histórica con transición pero sin intervalo G0-C', async () => {
    const db = representativeDb();
    db.timingInterval.findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const result = await new MidBaseSourceService(db as unknown as PrismaClient).read(actor(), { now: fixedNow });
    expect(result.rows.find((row) => row.objectId === 'p-known')).toMatchObject({
      stageDateKnowledge: 'KNOWN',
      time: {
        calculationState: 'UNKNOWN_LEGACY',
        openedAt: null,
        dueAt: null,
        overdue: null,
        provenance: { reason: 'INTERVAL_PRECEDES_G0C_OR_MISSING' },
      },
    });
  });

  it('conteos se derivan exactamente de las filas visibles', async () => {
    const result = await new MidBaseSourceService(representativeDb() as unknown as PrismaClient).read(actor(), { now: fixedNow });
    for (const [kind, count] of Object.entries(result.counts)) expect(count).toBe(result.rows.filter((row) => row.sourceKind === kind).length);
  });

  it('aplica tenant y object-level filters backend en las cinco fuentes', async () => {
    const db = representativeDb();
    await new MidBaseSourceService(db as unknown as PrismaClient).read(actor({ rol: 'ABOGADO' }), { now: fixedNow });
    expect(db.prospecto.findMany.mock.calls[0][0].where).toMatchObject({ organization_id: org, user_id: actor().id });
    expect(db.cotizacion.findMany.mock.calls[0][0].where).toMatchObject({ organization_id: org, user_id: actor().id });
    expect(db.expediente.findMany.mock.calls[0][0].where).toMatchObject({ organization_id: org, OR: [{ abogado_id: actor().id }, { creador_id: actor().id }] });
    expect(db.expedienteSolicitudPago.findMany.mock.calls[0][0].where).toMatchObject({ organization_id: org, expediente_id: { in: ['case-pre', 'case-post', 'case-delivered'] } });
    expect(db.expedienteIngresoReportado.findMany.mock.calls[0][0].where).toMatchObject({ organization_id: org, expediente_id: { in: ['case-pre', 'case-post', 'case-delivered'] } });
  });

  it('sin permiso de dominio omite esa categoría y no consulta su tabla', async () => {
    const db = representativeDb();
    const permissions = ['mi_dia.read', 'expedientes.read'] as Actor['permissions'];
    const result = await new MidBaseSourceService(db as unknown as PrismaClient).read(actor({ permissions }), { now: fixedNow });
    expect(db.prospecto.findMany).not.toHaveBeenCalled();
    expect(db.cotizacion.findMany).not.toHaveBeenCalled();
    expect(db.expedienteSolicitudPago.findMany).not.toHaveBeenCalled();
    expect(result.rows.every((row) => ['PRE_SIGNATURE', 'POST_SIGNATURE'].includes(row.sourceKind))).toBe(true);
  });

  it('lectura repetida con reloj fijo es determinista y realiza cero writes', async () => {
    const db = representativeDb();
    const service = new MidBaseSourceService(db as unknown as PrismaClient);
    const first = await service.read(actor(), { now: fixedNow });
    db.timingInterval.findMany.mockReset().mockResolvedValueOnce([
      { id: 'i-prospect', organization_id: org, policy_type: 'PROSPECT_NOTARY_WAIT', calculation_status: 'CALCULABLE', policy_revision_id: 'r1', prospecto_id: 'p-known', payment_request_id: null, receipt_report_id: null, opened_at: new Date('2026-09-04T00:00:00Z'), closed_at: null, provenance: { source: 'PRO-001' } },
    ]).mockResolvedValueOnce([
      { id: 'i-payment', organization_id: org, policy_type: 'ADMIN_PAYMENT_REQUEST_PENDING', calculation_status: 'CALCULABLE', policy_revision_id: 'r-admin', prospecto_id: null, payment_request_id: 'payment', receipt_report_id: null, opened_at: new Date('2026-09-04T00:00:00Z'), closed_at: null, provenance: { source: 'EXP-008' } },
    ]);
    const second = await service.read(actor(), { now: fixedNow });
    expect(second).toEqual(first);
    expect(db.auditLog.create).not.toHaveBeenCalled();
    expect(db.expedienteActividad.create).not.toHaveBeenCalled();
    expect(Object.keys(db).every((key) => !['create', 'update', 'upsert', 'delete'].includes(key))).toBe(true);
  });

  it('lecturas concurrentes con reloj fijo son deterministas y permanecen read-only', async () => {
    const firstDb = representativeDb();
    const secondDb = representativeDb();
    const [first, second] = await Promise.all([
      new MidBaseSourceService(firstDb as unknown as PrismaClient).read(actor(), { now: fixedNow }),
      new MidBaseSourceService(secondDb as unknown as PrismaClient).read(actor(), { now: fixedNow }),
    ]);
    expect(second).toEqual(first);
    for (const db of [firstDb, secondDb]) {
      expect(db.auditLog.create).not.toHaveBeenCalled();
      expect(db.expedienteActividad.create).not.toHaveBeenCalled();
    }
  });

  it('usa consultas batch constantes y evita N+1 por responsable, actividad o policy', async () => {
    const db = representativeDb();
    await new MidBaseSourceService(db as unknown as PrismaClient).read(actor(), { now: fixedNow });
    expect(db.expedienteSeguimientoActividad.findMany).toHaveBeenCalledTimes(1);
    expect(db.expedienteSeguimientoDependencia.findMany).toHaveBeenCalledTimes(1);
    expect(db.timingPolicyRevision.findMany).toHaveBeenCalledTimes(1);
    expect(db.timingInterval.findMany).toHaveBeenCalledTimes(2);
  });

  it('limita cada master a un máximo validado de 250', async () => {
    const db = representativeDb();
    await new MidBaseSourceService(db as unknown as PrismaClient).read(actor(), { now: fixedNow, limit: 999 });
    expect(db.prospecto.findMany.mock.calls[0][0].take).toBe(250);
    expect(db.cotizacion.findMany.mock.calls[0][0].take).toBe(250);
    expect(db.expediente.findMany.mock.calls[0][0].take).toBe(250);
  });
});
