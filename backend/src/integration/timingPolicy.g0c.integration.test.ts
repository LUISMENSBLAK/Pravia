import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { PrismaClient, TimingPolicyType } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithActorContext } from '../auth/actorContext';
import prisma from '../config/prisma';
import { ProspectWorkflowService } from '../services/prospectWorkflow.service';
import {
  closePaymentRequestTiming,
  closeReceiptApplicationTiming,
  openPaymentRequestTiming,
  openReceiptApplicationTiming,
  timingPolicyService,
  timingSourceService,
} from '../services/timingPolicy.service';

const url = process.env.G0C_DATABASE_URL ?? 'postgresql://postgres:test@127.0.0.1:55443/pravia_g0c?schema=pravia_os';
const db = new PrismaClient({ datasources: { db: { url } } });
type Actor = NonNullable<Request['user']>;
const actor = (n: number): Actor => ({
  id: `20000000-0000-4000-8000-00000000000${n}`, organizationId: `10000000-0000-4000-8000-00000000000${n}`,
  membershipId: `30000000-0000-4000-8000-00000000000${n}`, sessionId: randomUUID(), rol: 'ADMINISTRACION',
  nombre: 'G0-C', apellido: `Actor ${n}`, email: `g0c-${n}@example.test`, scope: 'GLOBAL', requiresPasswordChange: false,
  permissions: ['configuracion.catalogos.read', 'configuracion.actos_tiempos.manage', 'prospectos.read', 'prospectos.write', 'cotizaciones.read', 'cotizaciones.write', 'notarias.read', 'documentos.read', 'documentos.write', 'expedientes.read', 'expedientes.write', 'finanzas.read', 'finanzas.write', 'finanzas.validate'],
});
const a = actor(1), b = actor(2);
const run = <T>(who: Actor, callback: () => T) => runWithActorContext({
  userId: who.id, organizationId: who.organizationId, membershipId: who.membershipId, sessionId: who.sessionId,
  role: who.rol, permissions: who.permissions, scope: who.scope,
}, callback);
const publish = (type: TimingPolicyType, duration: number, who = a, key = randomUUID()) => run(who, () => timingPolicyService.publish(who, {
  policyType: type, duration, unit: 'HOURS', calendarSemantics: 'ELAPSED_UTC', provenance: `Prueba aislada ${type}`, idempotencyKey: key,
}));

describe.runIf(process.env.G0C_RUN_ISOLATED === '1')('G0-C PostgreSQL aislado · policies, snapshots y business facts', () => {
  beforeAll(async () => {
    const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(database.name).toBe('pravia_g0c');
    expect(await db.timingPolicyRevision.count()).toBe(0);
    expect(await db.timingInterval.count()).toBe(0);
  });
  afterAll(async () => { await Promise.all([db.$disconnect(), prisma.$disconnect()]); });

  it('baseline legacy preserva conteos y no inventa revisions, starts, dueAt ni overdue', async () => {
    expect(await db.organization.count()).toBe(2);
    expect(await db.prospecto.count()).toBe(11);
    expect(await db.cotizacion.count()).toBe(2);
    expect(await db.expediente.count()).toBe(2);
    expect(await db.documento.count()).toBe(11);
    const policies = await run(a, () => timingPolicyService.list(a));
    expect(policies).toHaveLength(5);
    expect(policies.every((item) => item.status === 'NOT_CONFIGURED')).toBe(true);
  });

  it('primera revisión, retry, nueva revisión e inmutabilidad histórica', async () => {
    const key = randomUUID();
    const first = await publish(TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, 24, a, key);
    const retry = await publish(TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, 24, a, key);
    expect(retry).toMatchObject({ idempotent: true, revision: { id: first.revision?.id } });
    const second = await publish(TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, 48);
    expect(second.revision?.revision).toBe(2);
    const rows = await db.timingPolicyRevision.findMany({ where: { organization_id: a.organizationId, policy_type: TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING }, orderBy: { revision: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((item) => item.superseded_at === null)).toHaveLength(1);
    await expect(db.timingPolicyRevision.update({ where: { id: rows[0].id }, data: { duration: 99 } })).rejects.toThrow();
    await expect(db.timingPolicyRevision.delete({ where: { id: rows[0].id } })).rejects.toThrow();
  });

  it('publicaciones concurrentes quedan serializadas con un solo current', async () => {
    const results = await Promise.all([publish(TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, 60), publish(TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, 72)]);
    expect(new Set(results.map((item) => item.revision?.revision)).size).toBe(2);
    const current = await db.timingPolicyRevision.findMany({ where: { organization_id: a.organizationId, policy_type: TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, superseded_at: null } });
    expect(current).toHaveLength(1);
  });

  it('R1/R2 quedan fijadas al abrir; sin policy permanece NOT_CONFIGURED tras publicar', async () => {
    const expedienteId = '70000000-0000-4000-8000-000000000001';
    const current = await db.timingPolicyRevision.findFirstOrThrow({ where: { organization_id: a.organizationId, policy_type: TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, superseded_at: null } });
    const firstRequest = await db.$transaction(async (tx) => {
      const row = await tx.expedienteSolicitudPago.create({ data: { organization_id: a.organizationId, expediente_id: expedienteId, via: 'INTERNA', concepto: 'Solicitud R1', importe: 100, creado_por_id: a.id, idempotency_key: randomUUID() } });
      await openPaymentRequestTiming(tx, a.organizationId, { sourceId: row.id, openedAt: row.created_at }); return row;
    });
    const firstInterval = await db.timingInterval.findFirstOrThrow({ where: { payment_request_id: firstRequest.id } });
    expect(firstInterval.policy_revision_id).toBe(current.id);

    const next = await publish(TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, 96);
    const secondRequest = await db.$transaction(async (tx) => {
      const row = await tx.expedienteSolicitudPago.create({ data: { organization_id: a.organizationId, expediente_id: expedienteId, via: 'INTERNA', concepto: 'Solicitud R2', importe: 200, creado_por_id: a.id, idempotency_key: randomUUID() } });
      await openPaymentRequestTiming(tx, a.organizationId, { sourceId: row.id, openedAt: row.created_at }); return row;
    });
    expect((await db.timingInterval.findFirstOrThrow({ where: { payment_request_id: firstRequest.id } })).policy_revision_id).toBe(current.id);
    expect((await db.timingInterval.findFirstOrThrow({ where: { payment_request_id: secondRequest.id } })).policy_revision_id).toBe(next.revision?.id);

    const firstReceipt = await db.$transaction(async (tx) => {
      const row = await tx.expedienteIngresoReportado.create({ data: { organization_id: a.organizationId, expediente_id: expedienteId, reportado_por_id: a.id, idempotency_key: randomUUID() } });
      await openReceiptApplicationTiming(tx, a.organizationId, { sourceId: row.id, openedAt: row.created_at }); return row;
    });
    expect(await db.timingInterval.findFirstOrThrow({ where: { receipt_report_id: firstReceipt.id } })).toMatchObject({ calculation_status: 'NOT_CONFIGURED', policy_revision_id: null });
    await publish(TimingPolicyType.ADMIN_RECEIPT_PENDING_APPLICATION, 12);
    expect(await db.timingInterval.findFirstOrThrow({ where: { receipt_report_id: firstReceipt.id } })).toMatchObject({ calculation_status: 'NOT_CONFIGURED', policy_revision_id: null });
  });

  it('serializa la carrera entre apertura de intervalo y publicación sin mezclar revisiones', async () => {
    const expedienteId = '70000000-0000-4000-8000-000000000001';
    const before = await db.timingPolicyRevision.findFirstOrThrow({ where: {
      organization_id: a.organizationId,
      policy_type: TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING,
      superseded_at: null,
    } });
    const [, request] = await Promise.all([
      publish(TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, before.duration + 1),
      db.$transaction(async (tx) => {
        const row = await tx.expedienteSolicitudPago.create({ data: {
          organization_id: a.organizationId, expediente_id: expedienteId, via: 'INTERNA',
          concepto: 'Carrera apertura/publicación', importe: 1, creado_por_id: a.id, idempotency_key: randomUUID(),
        } });
        await openPaymentRequestTiming(tx, a.organizationId, { sourceId: row.id, openedAt: row.created_at });
        return row;
      }),
    ]);
    const after = await db.timingPolicyRevision.findFirstOrThrow({ where: {
      organization_id: a.organizationId,
      policy_type: TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING,
      superseded_at: null,
    } });
    const interval = await db.timingInterval.findFirstOrThrow({ where: { payment_request_id: request.id } });
    expect([before.id, after.id]).toContain(interval.policy_revision_id);
    expect(await db.timingPolicyRevision.count({ where: {
      id: interval.policy_revision_id ?? undefined,
      organization_id: interval.organization_id,
      policy_type: interval.policy_type,
    } })).toBe(1);
    expect(await db.timingPolicyRevision.count({ where: {
      organization_id: a.organizationId,
      policy_type: TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING,
      superseded_at: null,
    } })).toBe(1);
  });

  it('A1/A2 cierran con hechos EXP-008 exactos, revierten timestamps falsos y separan fecha_limite', async () => {
    const expedienteId = '70000000-0000-4000-8000-000000000001';
    const category = await db.categoriaFinanciera.create({ data: { organization_id: a.organizationId, clave: `G0C-${randomUUID()}`, nombre: 'Categoría sintética G0-C', naturaleza: 'OTRO', direccion: 'EGRESO' } });
    const account = await db.cuentaFinanciera.create({ data: { organization_id: a.organizationId, institucion: `G0C-${randomUUID()}`, alias: `G0C-${randomUUID()}`, tipo: 'PRUEBA', creada_por_id: a.id } });
    const movement = async (amount: number, nature: 'INGRESO' | 'EGRESO') => db.movimientoFinanciero.create({ data: {
      organization_id: a.organizationId, expediente_id: expedienteId, tipo_movimiento: nature === 'EGRESO' ? 'EGRESO_TERCEROS' : 'ABONO', naturaleza: nature,
      categoria: category.clave, concepto: 'Movimiento sintético G0-C', monto: amount, estatus: 'APLICADO', capturado_por_id: a.id, aplicado_por_id: a.id,
      fecha_aplicacion: new Date('2026-09-01T11:00:00Z'), cuenta_id: account.id, idempotency_key: `G0C:${randomUUID()}`,
    } });
    const request = await db.$transaction(async (tx) => {
      const row = await tx.expedienteSolicitudPago.create({ data: { organization_id: a.organizationId, expediente_id: expedienteId, via: 'INTERNA', concepto: 'Con fecha externa', importe: 300, fecha_limite: new Date('2030-01-01T00:00:00Z'), creado_por_id: a.id, idempotency_key: randomUUID() } });
      await openPaymentRequestTiming(tx, a.organizationId, { sourceId: row.id, openedAt: row.created_at }); return row;
    });
    const interval = await db.timingInterval.findFirstOrThrow({ where: { payment_request_id: request.id } });
    expect(interval.opened_at).toEqual(request.created_at);
    expect(interval.opened_at).not.toEqual(request.fecha_limite);
    const paidAt = new Date('2026-09-01T12:00:00Z');
    const expense = await movement(300, 'EGRESO');
    await db.$transaction(async (tx) => { await tx.expedienteSolicitudPago.update({ where: { id: request.id }, data: { estado: 'PAGADA', categoria_id: category.id, cuenta_id: account.id, movimiento_id: expense.id, pagado_por_id: a.id, pagado_at: paidAt } }); await closePaymentRequestTiming(tx, a.organizationId, request.id, paidAt); });
    expect((await db.timingInterval.findFirstOrThrow({ where: { payment_request_id: request.id } })).closed_at).toEqual(paidAt);

    const receipt = await db.$transaction(async (tx) => {
      const row = await tx.expedienteIngresoReportado.create({ data: { organization_id: a.organizationId, expediente_id: expedienteId, reportado_por_id: a.id, idempotency_key: randomUUID() } });
      await openReceiptApplicationTiming(tx, a.organizationId, { sourceId: row.id, openedAt: row.created_at }); return row;
    });
    const appliedAt = new Date('2026-09-01T13:00:00Z');
    const income = await movement(400, 'INGRESO');
    await db.$transaction(async (tx) => { await tx.expedienteIngresoReportado.update({ where: { id: receipt.id }, data: { estado: 'APLICADO', monto_validado: 400, honorarios_aplicados: 400, impuestos_derechos_aplicados: 0, movimiento_id: income.id, aplicado_por_id: a.id, aplicado_at: appliedAt } }); await closeReceiptApplicationTiming(tx, a.organizationId, receipt.id, appliedAt); });
    expect((await db.timingInterval.findFirstOrThrow({ where: { receipt_report_id: receipt.id } })).closed_at).toEqual(appliedAt);

    const [voidRequest, voidReceipt] = await db.$transaction(async (tx) => {
      const pendingRequest = await tx.expedienteSolicitudPago.create({ data: { organization_id: a.organizationId, expediente_id: expedienteId, via: 'INTERNA', concepto: 'Anulación A1', importe: 10, creado_por_id: a.id, idempotency_key: randomUUID() } });
      await openPaymentRequestTiming(tx, a.organizationId, { sourceId: pendingRequest.id, openedAt: pendingRequest.created_at });
      const pendingReceipt = await tx.expedienteIngresoReportado.create({ data: { organization_id: a.organizationId, expediente_id: expedienteId, reportado_por_id: a.id, idempotency_key: randomUUID() } });
      await openReceiptApplicationTiming(tx, a.organizationId, { sourceId: pendingReceipt.id, openedAt: pendingReceipt.created_at });
      return [pendingRequest, pendingReceipt];
    });
    const voidedAt = new Date('2026-09-01T14:00:00Z');
    await db.$transaction(async (tx) => {
      await tx.expedienteSolicitudPago.update({ where: { id: voidRequest.id }, data: { estado: 'ANULADA', anulado_por_id: a.id, anulado_at: voidedAt, motivo_anulacion: 'Fixture' } });
      await closePaymentRequestTiming(tx, a.organizationId, voidRequest.id, voidedAt);
      await tx.expedienteIngresoReportado.update({ where: { id: voidReceipt.id }, data: { estado: 'ANULADO', anulado_por_id: a.id, anulado_at: voidedAt, motivo_anulacion: 'Fixture' } });
      await closeReceiptApplicationTiming(tx, a.organizationId, voidReceipt.id, voidedAt);
    });
    expect((await db.timingInterval.findFirstOrThrow({ where: { payment_request_id: voidRequest.id } })).closed_at).toEqual(voidedAt);
    expect((await db.timingInterval.findFirstOrThrow({ where: { receipt_report_id: voidReceipt.id } })).closed_at).toEqual(voidedAt);

    const forgedRequest = await db.$transaction(async (tx) => {
      const row = await tx.expedienteSolicitudPago.create({ data: { organization_id: a.organizationId, expediente_id: expedienteId, via: 'INTERNA', concepto: 'Rollback por timestamp falso', importe: 25, creado_por_id: a.id, idempotency_key: randomUUID() } });
      await openPaymentRequestTiming(tx, a.organizationId, { sourceId: row.id, openedAt: row.created_at });
      return row;
    });
    const forgedExpense = await movement(25, 'EGRESO');
    const actualPaidAt = new Date('2026-09-01T15:00:00Z');
    const forgedClosedAt = new Date('2026-09-01T15:05:00Z');
    await expect(db.$transaction(async (tx) => {
      await tx.expedienteSolicitudPago.update({ where: { id: forgedRequest.id }, data: { estado: 'PAGADA', categoria_id: category.id, cuenta_id: account.id, movimiento_id: forgedExpense.id, pagado_por_id: a.id, pagado_at: actualPaidAt } });
      await closePaymentRequestTiming(tx, a.organizationId, forgedRequest.id, forgedClosedAt);
    })).rejects.toThrow();
    expect(await db.expedienteSolicitudPago.findUniqueOrThrow({ where: { id: forgedRequest.id } })).toMatchObject({ estado: 'PENDIENTE', pagado_at: null });
    expect((await db.timingInterval.findFirstOrThrow({ where: { payment_request_id: forgedRequest.id } })).closed_at).toBeNull();
  });

  it('C1/C2/C3 abren y cierran sólo con los hechos efectivos G0-A; prepare no cierra', async () => {
    await Promise.all([
      publish(TimingPolicyType.PROSPECT_INFO_COLLECTION, 24),
      publish(TimingPolicyType.PROSPECT_READY_TO_REQUEST, 24),
      publish(TimingPolicyType.PROSPECT_NOTARY_WAIT, 48),
    ]);
    const service = new ProspectWorkflowService(prisma, async () => true);
    const created = await run(a, () => service.create(a, { nombre: 'Prospecto G0-C' }, randomUUID()));
    await run(a, () => service.update(a, created.prospecto.id, { expectedVersion: created.prospecto.version_operativa, notaria_id: '40000000-0000-4000-8000-000000000001' }));
    const act = async (action: string, extra: Record<string, unknown> = {}) => {
      const current = await db.prospecto.findUniqueOrThrow({ where: { id: created.prospecto.id } });
      return run(a, () => service.act(a, current.id, { action, expectedVersion: current.version_operativa, confirm: true, idempotencyKey: randomUUID(), ...extra }));
    };
    await act('RECABAR');
    expect(await db.timingInterval.findFirst({ where: { prospecto_id: created.prospecto.id, policy_type: TimingPolicyType.PROSPECT_INFO_COLLECTION, closed_at: null } })).not.toBeNull();
    await act('MARCAR_LISTO');
    expect((await db.timingInterval.findFirstOrThrow({ where: { prospecto_id: created.prospecto.id, policy_type: TimingPolicyType.PROSPECT_INFO_COLLECTION } })).closed_at).not.toBeNull();
    const ready = await db.prospecto.findUniqueOrThrow({ where: { id: created.prospecto.id } });
    await run(a, () => service.prepare(a, ready.id, { expectedVersion: ready.version_operativa, attachmentIds: [] }));
    expect((await db.timingInterval.findFirstOrThrow({ where: { prospecto_id: ready.id, policy_type: TimingPolicyType.PROSPECT_READY_TO_REQUEST } })).closed_at).toBeNull();
    const sentAt = new Date().toISOString();
    await act('REGISTRAR_ENVIO', { effectiveAt: sentAt, channel: 'Correo electrónico', recipient: 'notaria@example.test', evidence: 'Envío efectivo', content: 'Solicitud', attachmentIds: [] });
    expect((await db.timingInterval.findFirstOrThrow({ where: { prospecto_id: ready.id, policy_type: TimingPolicyType.PROSPECT_READY_TO_REQUEST } })).closed_at?.toISOString()).toBe(sentAt);
    expect((await db.timingInterval.findFirstOrThrow({ where: { prospecto_id: ready.id, policy_type: TimingPolicyType.PROSPECT_NOTARY_WAIT } })).opened_at.toISOString()).toBe(sentAt);
    const document = await db.documento.create({ data: { organization_id: a.organizationId, prospecto_id: ready.id, subido_por_id: a.id, tipo: 'OTRO', nombre_original: 'Cotización.pdf', nombre_interno: randomUUID(), storage_key: `g0c/${randomUUID()}`, mime_type: 'application/pdf', size_bytes: 100 } });
    const receivedAt = new Date().toISOString();
    await act('REGISTRAR_RECEPCION', { documentId: document.id, effectiveAt: receivedAt });
    expect((await db.timingInterval.findFirstOrThrow({ where: { prospecto_id: ready.id, policy_type: TimingPolicyType.PROSPECT_NOTARY_WAIT } })).closed_at?.toISOString()).toBe(receivedAt);
    expect(await db.timingInterval.count({ where: { prospecto_id: ready.id } })).toBe(3);
  });

  it('read API conserva overdue tri-state y bloquea cross-tenant IDOR', async () => {
    const request = await db.expedienteSolicitudPago.findFirstOrThrow({ where: { organization_id: a.organizationId } });
    const own = await run(a, () => timingSourceService.read(a, TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, request.id, new Date('2035-01-01T00:00:00Z')));
    expect(['CALCULABLE', 'NOT_CONFIGURED']).toContain(own?.calculationStatus);
    await expect(run(b, () => timingSourceService.read(b, TimingPolicyType.ADMIN_PAYMENT_REQUEST_PENDING, request.id))).rejects.toMatchObject({ status: 404 });
  });
});
