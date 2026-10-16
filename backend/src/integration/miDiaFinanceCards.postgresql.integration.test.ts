import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { MiDiaFinanceCardsService, type FinanceCardKey } from '../services/miDiaFinanceCards.service';
import { FinancialMovementService } from '../services/financialMovement.service';
import { ExpedienteFinanceService } from '../services/expedienteFinance.service';
import { miDiaDashboardScope } from '../services/miDiaDashboardScope';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.MIDIA_QA === '1' && (process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510' || parsed.pathname !== '/pravia_qa'
  || parsed.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('Mi Día Finanzas integration requires isolated local PostgreSQL.');
}
const db = new PrismaClient({ datasources: { db: { url: target } } });
type Actor = NonNullable<Request['user']>;
afterAll(async () => db.$disconnect());

describe.runIf(process.env.MIDIA_QA === '1')('Mi Día Finanzas · physical PostgreSQL', () => {
  it('reconciles scheduled collection with real applied distributions, OWN, tenant and rollback', async () => {
    const ids = { org: randomUUID(), otherOrg: randomUUID(), owner: randomUUID(), peer: randomUUID(),
      foreign: randomUUID(), ownQuote: randomUUID(), paidQuote: randomUUID(), peerQuote: randomUUID(),
      foreignQuote: randomUUID(), ownVersion: randomUUID(), paidVersion: randomUUID(),
      peerVersion: randomUUID(), foreignVersion: randomUUID(), ownFee: randomUUID(), paidFee: randomUUID(),
      peerFee: randomUUID(), foreignFee: randomUUID(), category: randomUUID(), applied: randomUUID(),
      draft: randomUUID() };
    const actor: Actor = { id: ids.owner, email: 'collection-qa@example.test', nombre: 'QA', apellido: 'Local',
      rol: 'DIRECCION', scope: 'GLOBAL', organizationId: ids.org, membershipId: randomUUID(), sessionId: randomUUID(),
      permissions: ['finanzas.read'], requiresPasswordChange: false };
    const now = new Date('2026-10-14T12:00:00.000Z');
    const rollback = new Error('MI_DIA_COLLECTION_ROLLBACK');
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [{ id: ids.org, name: 'Cobro programado QA' },
          { id: ids.otherOrg, name: 'Cobro ajeno QA' }] });
        await tx.user.createMany({ data: [ids.owner, ids.peer, ids.foreign].map((id) => ({ id,
          nombre: 'Cobro', apellido: 'QA', email: `collection-${id}@example.test`,
          password_hash: 'synthetic-only', rol: 'DIRECCION' })) });
        await tx.organizationMembership.createMany({ data: [
          { organization_id: ids.org, user_id: ids.owner, rol: 'DIRECCION' },
          { organization_id: ids.org, user_id: ids.peer, rol: 'ABOGADO' },
          { organization_id: ids.otherOrg, user_id: ids.foreign, rol: 'DIRECCION' },
        ] });
        await tx.cotizacion.createMany({ data: [
          { id: ids.ownQuote, organization_id: ids.org, user_id: ids.owner, numero_cotizacion: `COT-QA-${ids.ownQuote}` },
          { id: ids.paidQuote, organization_id: ids.org, user_id: ids.owner, numero_cotizacion: `COT-QA-${ids.paidQuote}` },
          { id: ids.peerQuote, organization_id: ids.org, user_id: ids.peer, numero_cotizacion: `COT-QA-${ids.peerQuote}` },
          { id: ids.foreignQuote, organization_id: ids.otherOrg, user_id: ids.foreign,
            numero_cotizacion: `COT-QA-${ids.foreignQuote}` },
        ] });
        await tx.cotizacionVersion.createMany({ data: [
          { id: ids.ownVersion, organization_id: ids.org, cotizacion_id: ids.ownQuote,
            version: 1, total_cliente: 500, total_notaria: 0, honorarios_pravia: 500 },
          { id: ids.paidVersion, organization_id: ids.org, cotizacion_id: ids.paidQuote,
            version: 1, total_cliente: 100, total_notaria: 0, honorarios_pravia: 100 },
          { id: ids.peerVersion, organization_id: ids.org, cotizacion_id: ids.peerQuote,
            version: 1, total_cliente: 300, total_notaria: 0, honorarios_pravia: 300 },
          { id: ids.foreignVersion, organization_id: ids.otherOrg, cotizacion_id: ids.foreignQuote,
            version: 1, total_cliente: 9000, total_notaria: 0, honorarios_pravia: 9000 },
        ] });
        await tx.honorarioGenerado.createMany({ data: [
          { id: ids.ownFee, organization_id: ids.org, clave_origen: `QA-${ids.ownFee}`,
            cotizacion_id: ids.ownQuote, cotizacion_version_id: ids.ownVersion,
            responsable_id: ids.owner, reconocido_por_id: ids.owner, monto: 500, fecha_vencimiento: now },
          { id: ids.paidFee, organization_id: ids.org, clave_origen: `QA-${ids.paidFee}`,
            cotizacion_id: ids.paidQuote, cotizacion_version_id: ids.paidVersion,
            responsable_id: ids.owner, reconocido_por_id: ids.owner, monto: 100, fecha_vencimiento: now },
          { id: ids.peerFee, organization_id: ids.org, clave_origen: `QA-${ids.peerFee}`,
            cotizacion_id: ids.peerQuote, cotizacion_version_id: ids.peerVersion,
            responsable_id: ids.peer, reconocido_por_id: ids.peer, monto: 300, fecha_vencimiento: now },
          { id: ids.foreignFee, organization_id: ids.otherOrg, clave_origen: `QA-${ids.foreignFee}`,
            cotizacion_id: ids.foreignQuote, cotizacion_version_id: ids.foreignVersion,
            responsable_id: ids.foreign, reconocido_por_id: ids.foreign, monto: 9000, fecha_vencimiento: now },
        ] });
        await tx.categoriaFinanciera.create({ data: { id: ids.category, organization_id: ids.org,
          clave: `QA-${ids.category}`, nombre: 'Cobro QA', naturaleza: 'DESPACHO' } });
        await tx.movimientoFinanciero.createMany({ data: [
          { id: ids.applied, organization_id: ids.org, capturado_por_id: ids.owner, naturaleza: 'INGRESO',
            tipo_movimiento: 'ABONO', categoria: 'QA', concepto: 'Cobro aplicado', monto: 300,
            estatus: 'APLICADO', fecha_movimiento: now },
          { id: ids.draft, organization_id: ids.org, capturado_por_id: ids.owner, naturaleza: 'INGRESO',
            tipo_movimiento: 'ABONO', categoria: 'QA', concepto: 'Cobro no aplicado', monto: 100,
            estatus: 'BORRADOR', fecha_movimiento: now },
        ] });
        await tx.movimientoDistribucion.createMany({ data: [
          { organization_id: ids.org, movimiento_id: ids.applied, categoria_id: ids.category,
            honorario_generado_id: ids.ownFee, monto: 200 },
          { organization_id: ids.org, movimiento_id: ids.applied, categoria_id: ids.category,
            honorario_generado_id: ids.paidFee, monto: 100 },
          { organization_id: ids.org, movimiento_id: ids.draft, categoria_id: ids.category,
            honorario_generado_id: ids.ownFee, monto: 100 },
        ] });
        const service = new MiDiaFinanceCardsService(tx as unknown as PrismaClient);
        const options = { timezone: 'America/Mexico_City', now, period: 'MONTH' as const, limit: 1 };
        const all = await service.read(actor, 'COLLECTION_SCHEDULED', { ...options, scope: 'ORGANIZATION' });
        expect(all).toMatchObject({ count: 2, amount: '600.00' });
        expect(all.items).toHaveLength(1);
        const own = await service.read(actor, 'COLLECTION_SCHEDULED', { ...options, scope: 'OWN',
          requestedUserId: ids.peer });
        expect(own).toMatchObject({ count: 1, amount: '300.00' });
        expect(own.items[0].href).toBe(`/cotizaciones/${ids.ownQuote}`);
        const foreign = await service.read({ ...actor, organizationId: ids.otherOrg, id: ids.foreign },
          'COLLECTION_SCHEDULED', { ...options, scope: 'ORGANIZATION' });
        expect(foreign).toMatchObject({ count: 1, amount: '9000.00' });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await db.honorarioGenerado.count({ where: { id: ids.ownFee } })).toBe(0);
  });
  it('counts actual received money by local day, responsible/object scope and tenant, then rolls back', async () => {
    const ids = { org: randomUUID(), otherOrg: randomUUID(), owner: randomUUID(), peer: randomUUID(), foreign: randomUUID(),
      ownCase: randomUUID(), peerCase: randomUUID(), otherCase: randomUUID(), direct: randomUUID(), caseIncome: randomUUID(),
      peerIncome: randomUUID(), foreignIncome: randomUUID(), draft: randomUUID(), expense: randomUUID(),
      expenseProof: randomUUID(), oldIncome: randomUUID(), dueOwn: randomUUID(), duePeer: randomUUID(),
      paidNoProof: randomUUID(), paidProof: randomUUID(), dueForeign: randomUUID(), proofDocument: randomUUID(),
      category: randomUUID(), account: randomUUID() };
    const actor: Actor = { id: ids.owner, email: 'finance-qa@example.test', nombre: 'Finanzas', apellido: 'QA',
      rol: 'DIRECCION', scope: 'GLOBAL', organizationId: ids.org, membershipId: randomUUID(), sessionId: randomUUID(),
      permissions: ['finanzas.read'], requiresPasswordChange: false };
    const rollback = new Error('MI_DIA_FINANCE_ROLLBACK');
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [{ id: ids.org, name: 'Mi Día Finanzas QA' },
          { id: ids.otherOrg, name: 'Mi Día Finanzas ajena QA' }] });
        await tx.user.createMany({ data: [ids.owner, ids.peer, ids.foreign].map((id) => ({ id, nombre: 'Finanzas',
          apellido: 'QA', email: `finance-${id}@example.test`, password_hash: 'synthetic-only', rol: 'DIRECCION' })) });
        await tx.organizationMembership.createMany({ data: [
          { organization_id: ids.org, user_id: ids.owner, rol: 'DIRECCION' },
          { organization_id: ids.org, user_id: ids.peer, rol: 'ABOGADO' },
          { organization_id: ids.otherOrg, user_id: ids.foreign, rol: 'DIRECCION' },
        ] });
        await tx.expediente.createMany({ data: [
          { id: ids.ownCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.ownCase}`,
            abogado_id: ids.owner, creador_id: ids.owner, fecha_estimada_firma: new Date('2026-10-14T12:00:00.000Z') },
          { id: ids.peerCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.peerCase}`,
            abogado_id: ids.peer, creador_id: ids.peer, fecha_estimada_firma: new Date('2026-10-12T12:00:00.000Z'),
            fecha_real_firma: new Date('2026-10-13T12:00:00.000Z') },
          { id: ids.otherCase, organization_id: ids.otherOrg, numero_pravia: `EXP-QA-${ids.otherCase}`,
            abogado_id: ids.foreign, creador_id: ids.foreign, fecha_estimada_firma: new Date('2026-10-14T12:00:00.000Z') },
        ] });
        await tx.expedientePresupuesto.createMany({ data: [
          { organization_id: ids.org, expediente_id: ids.ownCase, subtotal_honorarios: 1000,
            total: 1000, creado_por_id: ids.owner, actualizado_por_id: ids.owner },
          { organization_id: ids.org, expediente_id: ids.peerCase, subtotal_honorarios: 2000,
            total: 2000, creado_por_id: ids.peer, actualizado_por_id: ids.peer },
          { organization_id: ids.otherOrg, expediente_id: ids.otherCase, subtotal_honorarios: 9000,
            total: 9000, creado_por_id: ids.foreign, actualizado_por_id: ids.foreign },
        ] });
        const today = new Date('2026-10-14T12:00:00.000Z');
        const prior = new Date('2026-10-13T12:00:00.000Z');
        const make = (id: string, organization_id: string, captured: string, monto: number,
          extras: Record<string, unknown> = {}) => ({ id, organization_id, capturado_por_id: captured,
          naturaleza: 'INGRESO' as const, tipo_movimiento: 'ABONO' as const,
          categoria: 'QA', concepto: 'Cobro sintético', monto, estatus: 'APLICADO' as const,
          fecha_movimiento: today, ...extras });
        await tx.movimientoFinanciero.createMany({ data: [
          make(ids.direct, ids.org, ids.owner, 100, { responsable_id: ids.owner }),
          make(ids.caseIncome, ids.org, ids.owner, 200, { expediente_id: ids.ownCase }),
          make(ids.peerIncome, ids.org, ids.peer, 300, { expediente_id: ids.peerCase }),
          make(ids.foreignIncome, ids.otherOrg, ids.foreign, 900, { expediente_id: ids.otherCase }),
          make(ids.draft, ids.org, ids.owner, 800, { estatus: 'BORRADOR' }),
          make(ids.expense, ids.org, ids.owner, 700, { naturaleza: 'EGRESO', tipo_movimiento: 'EGRESO_TERCEROS', expediente_id: ids.ownCase }),
          make(ids.expenseProof, ids.org, ids.peer, 400, { naturaleza: 'EGRESO', tipo_movimiento: 'EGRESO_TERCEROS', expediente_id: ids.peerCase }),
          make(ids.oldIncome, ids.org, ids.owner, 500, { fecha_movimiento: prior }),
        ] });
        await tx.categoriaFinanciera.create({ data: { id: ids.category, organization_id: ids.org,
          clave: `QA-${ids.category}`, nombre: 'Pago QA', naturaleza: 'EGRESO_DESPACHO' } });
        await tx.cuentaFinanciera.create({ data: { id: ids.account, organization_id: ids.org,
          institucion: 'Banco QA', alias: 'Temporal', tipo: 'BANCARIA', creada_por_id: ids.owner } });
        await tx.expedienteSolicitudPago.createMany({ data: [
          { id: ids.dueOwn, organization_id: ids.org, expediente_id: ids.ownCase,
            via: 'INTERNA', estado: 'PENDIENTE', concepto: 'Pago propio pendiente', importe: 500,
            creado_por_id: ids.owner, idempotency_key: ids.dueOwn },
          { id: ids.duePeer, organization_id: ids.org, expediente_id: ids.peerCase,
            via: 'INTERNA', estado: 'PENDIENTE', concepto: 'Pago ajeno pendiente', importe: 300,
            creado_por_id: ids.peer, idempotency_key: ids.duePeer },
          { id: ids.paidNoProof, organization_id: ids.org, expediente_id: ids.ownCase,
            via: 'INTERNA', estado: 'PAGADA', concepto: 'Pago sin evidencia', importe: 700,
            creado_por_id: ids.owner, pagado_por_id: ids.owner, pagado_at: today,
            categoria_id: ids.category, cuenta_id: ids.account,
            movimiento_id: ids.expense, idempotency_key: ids.paidNoProof },
          { id: ids.paidProof, organization_id: ids.org, expediente_id: ids.peerCase,
            via: 'INTERNA', estado: 'PAGADA', concepto: 'Pago con evidencia', importe: 400,
            creado_por_id: ids.peer, pagado_por_id: ids.peer, pagado_at: today,
            categoria_id: ids.category, cuenta_id: ids.account,
            movimiento_id: ids.expenseProof, idempotency_key: ids.paidProof },
          { id: ids.dueForeign, organization_id: ids.otherOrg, expediente_id: ids.otherCase,
            via: 'INTERNA', estado: 'PENDIENTE', concepto: 'Pago otro tenant', importe: 9000,
            creado_por_id: ids.foreign, idempotency_key: ids.dueForeign },
        ] });
        await tx.documento.create({ data: { id: ids.proofDocument, organization_id: ids.org,
          nombre_original: 'proof-qa.pdf', nombre_interno: `proof-${ids.proofDocument}.pdf`, tipo: 'COMPROBANTE_PAGO',
          storage_key: `qa/${ids.proofDocument}`, mime_type: 'application/pdf', size_bytes: 1,
          estatus: 'VIGENTE', subido_por_id: ids.peer, expediente_id: ids.peerCase } });
        await tx.expedienteFinanzaDocumento.create({ data: { organization_id: ids.org,
          expediente_id: ids.peerCase, solicitud_pago_id: ids.paidProof, documento_id: ids.proofDocument,
          movimiento_id: ids.expenseProof,
          tipo: 'COMPROBANTE_PAGO', vinculado_por_id: ids.peer, idempotency_key: ids.proofDocument } });
        const service = new MiDiaFinanceCardsService(tx as unknown as PrismaClient);
        const options = { timezone: 'America/Mexico_City', now: today, limit: 1 };
        const organization = await service.read(actor, 'COLLECTED_TODAY', { ...options, scope: 'ORGANIZATION' });
        expect(organization).toMatchObject({ count: 3, amount: '600.00' });
        expect(organization.items).toHaveLength(1);
        const own = await service.read(actor, 'COLLECTED_TODAY', { ...options, scope: 'OWN',
          requestedUserId: ids.peer, limit: 5 });
        expect(own).toMatchObject({ count: 2, amount: '300.00' });
        expect(own.items.map((item) => item.id).sort()).toEqual([ids.direct, ids.caseIncome].sort());
        const selected = await service.read(actor, 'INCOME_COLLECTED', { ...options, scope: 'ORGANIZATION',
          requestedUserId: ids.peer, period: 'MONTH' });
        expect(selected).toMatchObject({ count: 1, amount: '300.00' });
        expect(selected.items[0].id).toBe(ids.peerIncome);
        const ledger = new FinancialMovementService(tx as unknown as PrismaClient);
        const exact = await ledger.list({ organization_id: ids.org, movimiento_id: ids.direct,
          fecha_desde: '2000-01-01', fecha_hasta: '2000-01-02' });
        expect(exact.items.map((item) => item.id)).toEqual([ids.direct]);
        const crossTenant = await ledger.list({ organization_id: ids.otherOrg, movimiento_id: ids.direct });
        expect(crossTenant.items).toEqual([]);
        const other = await service.read({ ...actor, organizationId: ids.otherOrg, id: ids.foreign }, 'COLLECTED_TODAY',
          { ...options, scope: 'ORGANIZATION' });
        expect(other).toMatchObject({ count: 1, amount: '900.00' });
        const scheduled = await service.read(actor, 'FEES_SCHEDULED_SIGN', { ...options, scope: 'ORGANIZATION', period: 'MONTH' });
        expect(scheduled).toMatchObject({ count: 1, amount: '1000.00' });
        expect(scheduled.items[0].href).toBe(`/expedientes/${ids.ownCase}#finanzas`);
        const signed = await service.read(actor, 'FEES_SIGNED', { ...options, scope: 'ORGANIZATION', period: 'MONTH' });
        expect(signed).toMatchObject({ count: 1, amount: '2000.00' });
        const signedOwn = await service.read(actor, 'FEES_SIGNED', { ...options, scope: 'OWN',
          requestedUserId: ids.peer, period: 'MONTH' });
        expect(signedOwn).toMatchObject({ count: 0, amount: '0.00' });
        const production = await service.read(actor, 'PRODUCTION_VALUE', { ...options,
          scope: 'ORGANIZATION', period: 'MONTH' });
        expect(production).toMatchObject({ count: 1, amount: '2000.00' });
        expect(production.items[0].id).toBe(ids.peerCase);
        const productionOwner = await service.read(actor, 'PRODUCTION_VALUE', { ...options,
          scope: 'OWN', requestedUserId: ids.peer, period: 'YEAR' });
        expect(productionOwner).toMatchObject({ count: 0, amount: '0.00' });
        const productionPeer = await service.read(actor, 'PRODUCTION_VALUE', { ...options,
          scope: 'ORGANIZATION', requestedUserId: ids.peer, period: 'YEAR' });
        expect(productionPeer).toMatchObject({ count: 1, amount: '2000.00' });
        expect(await service.read(actor, 'ADVANCES_PENDING', { ...options, scope: 'ORGANIZATION' }))
          .toMatchObject({ available: false, items: [] });
        const scheduledForeign = await service.read({ ...actor, organizationId: ids.otherOrg, id: ids.foreign },
          'FEES_SCHEDULED_SIGN', { ...options, scope: 'ORGANIZATION', period: 'MONTH' });
        expect(scheduledForeign).toMatchObject({ count: 1, amount: '9000.00' });
        const due = await service.read(actor, 'PAYMENTS_DUE', { ...options, scope: 'ORGANIZATION' });
        expect(due).toMatchObject({ count: 2, amount: '800.00' });
        const dueOwn = await service.read(actor, 'PAYMENTS_DUE', { ...options, scope: 'OWN', requestedUserId: ids.peer });
        expect(dueOwn).toMatchObject({ count: 1, amount: '500.00' });
        expect(dueOwn.items[0].href).toBe(`/expedientes/${ids.ownCase}?payment_request_id=${ids.dueOwn}#finanzas`);
        const unproven = await service.read(actor, 'PAYMENTS_UNPROVEN', { ...options, scope: 'ORGANIZATION' });
        expect(unproven).toMatchObject({ count: 1, amount: '700.00' });
        expect(unproven.items[0].id).toBe(ids.paidNoProof);
        const foreignDue = await service.read({ ...actor, organizationId: ids.otherOrg, id: ids.foreign },
          'PAYMENTS_DUE', { ...options, scope: 'ORGANIZATION' });
        expect(foreignDue).toMatchObject({ count: 1, amount: '9000.00' });
        const thirdPartyCategory = randomUUID();
        const foreignThirdPartyCategory = randomUUID();
        const thirdPartyExpense = randomUUID();
        const draftThirdParty = randomUUID();
        await tx.categoriaFinanciera.createMany({ data: [
          { id: thirdPartyCategory, organization_id: ids.org, clave: `QA-${thirdPartyCategory}`,
            nombre: 'Recursos de tercero QA', naturaleza: 'TERCERO' },
          { id: foreignThirdPartyCategory, organization_id: ids.otherOrg, clave: `QA-${foreignThirdPartyCategory}`,
            nombre: 'Recursos ajenos QA', naturaleza: 'TERCERO' },
        ] });
        await tx.movimientoFinanciero.createMany({ data: [
          make(thirdPartyExpense, ids.org, ids.owner, 100, { naturaleza: 'EGRESO',
            tipo_movimiento: 'EGRESO_TERCEROS', expediente_id: ids.ownCase }),
          make(draftThirdParty, ids.org, ids.owner, 1000, { estatus: 'BORRADOR', expediente_id: ids.ownCase }),
        ] });
        await tx.movimientoDistribucion.createMany({ data: [
          { organization_id: ids.org, movimiento_id: ids.caseIncome, categoria_id: thirdPartyCategory, monto: 200 },
          { organization_id: ids.org, movimiento_id: ids.peerIncome, categoria_id: thirdPartyCategory, monto: 300 },
          { organization_id: ids.org, movimiento_id: ids.expense, categoria_id: ids.category, monto: 700 },
          { organization_id: ids.org, movimiento_id: ids.expenseProof, categoria_id: ids.category, monto: 400 },
          { organization_id: ids.org, movimiento_id: thirdPartyExpense, categoria_id: thirdPartyCategory, monto: 100 },
          { organization_id: ids.org, movimiento_id: draftThirdParty, categoria_id: thirdPartyCategory, monto: 1000 },
          { organization_id: ids.otherOrg, movimiento_id: ids.foreignIncome,
            categoria_id: foreignThirdPartyCategory, monto: 900 },
        ] });
        const sourceRows = await tx.movimientoFinanciero.findMany({ where: { organization_id: ids.org,
          expediente_id: { not: null }, estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] } },
          select: { id: true, expediente_id: true, distribuciones: { select: {
            monto: true, categoria: { select: { naturaleza: true } },
          } } } });
        expect(sourceRows.find((row) => row.id === ids.caseIncome)?.distribuciones[0]?.categoria.naturaleza)
          .toBe('TERCERO');
        expect(String(sourceRows.find((row) => row.id === ids.caseIncome)?.distribuciones[0]?.monto)).toBe('200');
        expect(sourceRows.map((row) => [row.id, row.expediente_id])).toContainEqual([ids.caseIncome, ids.ownCase]);
        const scopedRows = await tx.movimientoFinanciero.findMany({ where: { organization_id: ids.org,
          expediente_id: { not: null }, estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] },
          expediente: { is: miDiaDashboardScope(actor, undefined, 'ORGANIZATION').financialCaseWhere } },
          select: { id: true } });
        expect(scopedRows.map((row) => row.id)).toContain(ids.caseIncome);
        const selectedRow = await tx.movimientoFinanciero.findFirstOrThrow({ where: { id: ids.caseIncome },
          select: { naturaleza: true, expediente_id: true, expediente: { select: { numero_pravia: true } },
            distribuciones: { select: { monto: true, categoria: { select: { naturaleza: true } } } } } });
        expect(selectedRow).toMatchObject({ naturaleza: 'INGRESO', expediente_id: ids.ownCase,
          expediente: { numero_pravia: `EXP-QA-${ids.ownCase}` } });
        const resources = await service.read(actor, 'CLIENT_RESOURCES', { ...options, scope: 'ORGANIZATION' });
        expect(resources).toMatchObject({ count: 2, amount: '400.00' });
        expect(resources.items).toHaveLength(1);
        expect(resources.items[0]).toMatchObject(resources.items[0].id === ids.ownCase
          ? { amount: '100.00', href: `/expedientes/${ids.ownCase}#finanzas` }
          : { amount: '300.00', href: `/expedientes/${ids.peerCase}#finanzas` });
        const ownResources = await service.read(actor, 'CLIENT_RESOURCES', { ...options, scope: 'OWN',
          requestedUserId: ids.peer });
        expect(ownResources).toMatchObject({ count: 1, amount: '100.00' });
        const foreignResources = await service.read({ ...actor, organizationId: ids.otherOrg, id: ids.foreign },
          'CLIENT_RESOURCES', { ...options, scope: 'ORGANIZATION' });
        expect(foreignResources).toMatchObject({ count: 1, amount: '900.00' });
        const ownCfdi = randomUUID();
        const peerCfdi = randomUUID();
        const draftCfdi = randomUUID();
        const foreignCfdi = randomUUID();
        const alreadyCovered = randomUUID();
        const ownRepApplication = randomUUID();
        const peerRepApplication = randomUUID();
        const draftRepApplication = randomUUID();
        const foreignRepApplication = randomUUID();
        const coveredApplication = randomUUID();
        const xmlByCfdi = new Map([[ownCfdi, randomUUID()], [peerCfdi, randomUUID()],
          [foreignCfdi, randomUUID()], [alreadyCovered, randomUUID()]]);
        await tx.documento.createMany({ data: [...xmlByCfdi].map(([cfdiId, documentId]) => ({
          id: documentId, organization_id: cfdiId === foreignCfdi ? ids.otherOrg : ids.org,
          nombre_original: `cfdi-${cfdiId}.xml`, nombre_interno: `cfdi-${cfdiId}.xml`,
          tipo: 'CFDI_XML', storage_key: `qa/${documentId}`, mime_type: 'application/xml',
          size_bytes: 1, estatus: 'VIGENTE', subido_por_id: cfdiId === foreignCfdi ? ids.foreign
            : cfdiId === peerCfdi ? ids.peer : ids.owner,
        })) });
        const cfdi = (id: string, organization_id: string, creator: string, expediente_id: string,
          estado: string, amount: number) => ({ id, organization_id, direccion: 'EMITIDO', tipo: 'I',
          estado, source: estado === 'PREFACTURA' ? 'LOCAL_DRAFT' : 'MANUAL_XML',
          uuid_fiscal: estado === 'PREFACTURA' ? null : randomUUID(),
          xml_documento_id: xmlByCfdi.get(id) ?? null, expediente_id,
          emisor_rfc: 'AAA010101AAA', emisor_nombre: 'Notaría QA', receptor_rfc: 'XAXX010101000',
          receptor_nombre: 'Cliente QA', subtotal: amount, total: amount, saldo: amount,
          draft_payload: {}, idempotency_key: `qa-${id}`, created_by_id: creator });
        await tx.documentoCfdi.createMany({ data: [
          cfdi(ownCfdi, ids.org, ids.owner, ids.ownCase, 'VIGENTE', 200),
          cfdi(peerCfdi, ids.org, ids.peer, ids.peerCase, 'TIMBRADO', 300),
          cfdi(draftCfdi, ids.org, ids.owner, ids.ownCase, 'PREFACTURA', 100),
          cfdi(foreignCfdi, ids.otherOrg, ids.foreign, ids.otherCase, 'VIGENTE', 900),
          cfdi(alreadyCovered, ids.org, ids.owner, ids.ownCase, 'VIGENTE', 200),
        ] });
        await tx.documentoCfdi.updateMany({ where: { id: { in: [ownCfdi, peerCfdi, draftCfdi,
          foreignCfdi, alreadyCovered] } }, data: { metodo_pago: 'PPD' } });
        await tx.aplicacionPagoCfdi.createMany({ data: [
          { id: ownRepApplication, organization_id: ids.org, cfdi_id: ownCfdi, movimiento_id: ids.caseIncome,
            monto_aplicado: 80, idempotency_key: `qa-${ownRepApplication}`, created_by_id: ids.owner },
          { id: peerRepApplication, organization_id: ids.org, cfdi_id: peerCfdi, movimiento_id: ids.peerIncome,
            monto_aplicado: 120, idempotency_key: `qa-${peerRepApplication}`, created_by_id: ids.peer },
          { id: draftRepApplication, organization_id: ids.org, cfdi_id: draftCfdi, movimiento_id: ids.caseIncome,
            monto_aplicado: 30, idempotency_key: `qa-${draftRepApplication}`, created_by_id: ids.owner },
          { id: foreignRepApplication, organization_id: ids.otherOrg, cfdi_id: foreignCfdi,
            movimiento_id: ids.foreignIncome, monto_aplicado: 900,
            idempotency_key: `qa-${foreignRepApplication}`, created_by_id: ids.foreign },
          { id: coveredApplication, organization_id: ids.org, cfdi_id: alreadyCovered,
            movimiento_id: ids.caseIncome, monto_aplicado: 50, rep_cfdi_id: randomUUID(),
            idempotency_key: `qa-${coveredApplication}`, created_by_id: ids.owner },
        ] });
        const rep = await service.read(actor, 'REP_PENDING', { ...options, scope: 'ORGANIZATION' });
        expect(rep).toMatchObject({ count: 2, amount: '200.00' });
        const repOwn = await service.read(actor, 'REP_PENDING', { ...options, scope: 'OWN',
          requestedUserId: ids.peer });
        expect(repOwn).toMatchObject({ count: 1, amount: '80.00' });
        expect(repOwn.items[0].href).toBe(`/finanzas?view=facturacion&cfdi_id=${ownCfdi}`);
        const repForeign = await service.read({ ...actor, organizationId: ids.otherOrg, id: ids.foreign },
          'REP_PENDING', { ...options, scope: 'ORGANIZATION' });
        expect(repForeign).toMatchObject({ count: 1, amount: '900.00' });
        const ownInvoiceIncome = randomUUID();
        const peerInvoiceIncome = randomUUID();
        const foreignInvoiceIncome = randomUUID();
        const character = await tx.caracterCompareciente.findFirst({ select: { id: true } });
        expect(character).toBeTruthy();
        const ownParty = await tx.compareciente.create({ data: { organization_id: ids.org,
          nombre_busqueda: 'Cliente factura propia QA', creado_por_id: ids.owner } });
        const peerParty = await tx.compareciente.create({ data: { organization_id: ids.org,
          nombre_busqueda: 'Cliente factura par QA', creado_por_id: ids.peer } });
        const foreignParty = await tx.compareciente.create({ data: { organization_id: ids.otherOrg,
          nombre_busqueda: 'Cliente factura ajena QA', creado_por_id: ids.foreign } });
        const ownLink = await tx.expedienteCompareciente.create({ data: { organization_id: ids.org,
          expediente_id: ids.ownCase, compareciente_id: ownParty.id,
          caracter_id: character!.id, creado_por_id: ids.owner } });
        const peerLink = await tx.expedienteCompareciente.create({ data: { organization_id: ids.org,
          expediente_id: ids.peerCase, compareciente_id: peerParty.id,
          caracter_id: character!.id, creado_por_id: ids.peer } });
        const foreignLink = await tx.expedienteCompareciente.create({ data: { organization_id: ids.otherOrg,
          expediente_id: ids.otherCase, compareciente_id: foreignParty.id,
          caracter_id: character!.id, creado_por_id: ids.foreign } });
        await tx.expedienteIngresoReportado.createMany({ data: [
          { id: ownInvoiceIncome, organization_id: ids.org, expediente_id: ids.ownCase,
            reportado_por_id: ids.owner, idempotency_key: ownInvoiceIncome, monto_reportado: 500,
            factura_estado: 'PENDIENTE', forma_pago: 'TRANSFERENCIA',
            facturar_a_vinculo_id: ownLink.id, facturar_a_compareciente_id: ownParty.id },
          { id: peerInvoiceIncome, organization_id: ids.org, expediente_id: ids.peerCase,
            reportado_por_id: ids.peer, idempotency_key: peerInvoiceIncome, monto_reportado: 300,
            factura_estado: 'PENDIENTE', forma_pago: 'TRANSFERENCIA',
            facturar_a_vinculo_id: peerLink.id, facturar_a_compareciente_id: peerParty.id },
          { id: foreignInvoiceIncome, organization_id: ids.otherOrg, expediente_id: ids.otherCase,
            reportado_por_id: ids.foreign, idempotency_key: foreignInvoiceIncome, monto_reportado: 1000,
            factura_estado: 'PENDIENTE', forma_pago: 'TRANSFERENCIA',
            facturar_a_vinculo_id: foreignLink.id, facturar_a_compareciente_id: foreignParty.id },
        ] });
        await tx.documentoCfdi.updateMany({ where: { id: { in: [ownCfdi, draftCfdi] } },
          data: { ingreso_reportado_id: ownInvoiceIncome } });
        await tx.documentoCfdi.update({ where: { id: foreignCfdi },
          data: { ingreso_reportado_id: foreignInvoiceIncome } });
        const invoices = await service.read(actor, 'INVOICES_PENDING', { ...options, scope: 'ORGANIZATION' });
        expect(invoices).toMatchObject({ count: 2, amount: '500.00' });
        const ownInvoices = await service.read(actor, 'INVOICES_PENDING', { ...options,
          scope: 'OWN', requestedUserId: ids.peer });
        expect(ownInvoices).toMatchObject({ count: 1, amount: '200.00' });
        expect(ownInvoices.items[0].href).toBe(`/finanzas?view=facturacion&income_id=${ownInvoiceIncome}`);
        const invoiceSource = new ExpedienteFinanceService(tx as unknown as PrismaClient);
        expect((await invoiceSource.listInvoices(actor, '', ownInvoiceIncome)).items.map((item) => item.id))
          .toEqual([ownInvoiceIncome]);
        expect((await invoiceSource.listInvoices({ ...actor, organizationId: ids.otherOrg, id: ids.foreign },
          '', ownInvoiceIncome)).items).toEqual([]);
        const foreignInvoices = await service.read({ ...actor, organizationId: ids.otherOrg, id: ids.foreign },
          'INVOICES_PENDING', { ...options, scope: 'ORGANIZATION' });
        expect(foreignInvoices).toMatchObject({ count: 1, amount: '100.00' });
        const entityId = randomUUID();
        const foreignEntityId = randomUUID();
        const foreignDraftId = randomUUID();
        await tx.entidadFiscalCfdi.createMany({ data: [
          { id: entityId, organization_id: ids.org, razon_social: 'Notaría QA', rfc: 'AAA010101AAA',
            regimen_fiscal: '601', codigo_postal: '12345', created_by_id: ids.owner },
          { id: foreignEntityId, organization_id: ids.otherOrg, razon_social: 'Notaría ajena QA',
            rfc: 'BBB010101BBB', regimen_fiscal: '601', codigo_postal: '12345', created_by_id: ids.foreign },
        ] });
        const concepts = [{ clave_prod_serv: '84111506', clave_unidad: 'E48', objeto_impuesto: '02',
          descripcion: 'Honorarios QA', cantidad: '1', valor_unitario: '100.00' }];
        await tx.documentoCfdi.update({ where: { id: draftCfdi }, data: {
          entidad_fiscal_id: entityId, receptor_regimen: '616', receptor_codigo_postal: '12345',
          uso_cfdi: 'G03', metodo_pago: 'PPD', forma_pago: '99', draft_payload: { concepts },
        } });
        await tx.documentoCfdi.create({ data: { id: foreignDraftId, organization_id: ids.otherOrg,
          direccion: 'EMITIDO', tipo: 'I', estado: 'PREFACTURA', entidad_fiscal_id: foreignEntityId,
          expediente_id: ids.otherCase, emisor_rfc: 'BBB010101BBB', emisor_nombre: 'Notaría ajena QA',
          receptor_rfc: 'XAXX010101000', receptor_nombre: 'Cliente ajeno QA', receptor_regimen: '616',
          receptor_codigo_postal: '12345', uso_cfdi: 'G03', metodo_pago: 'PPD', forma_pago: '99',
          subtotal: 150, total: 150, saldo: 150, draft_payload: { concepts },
          idempotency_key: `qa-${foreignDraftId}`, created_by_id: ids.foreign,
        } });
        const drafts = await service.read(actor, 'CFDI_TO_STAMP', { ...options, scope: 'ORGANIZATION' });
        expect(drafts).toMatchObject({ count: 1, amount: '100.00' });
        expect(drafts.items[0].concepto).toContain('PAC no certificado');
        const ownDrafts = await service.read(actor, 'CFDI_TO_STAMP', { ...options,
          scope: 'OWN', requestedUserId: ids.peer });
        expect(ownDrafts).toMatchObject({ count: 1, amount: '100.00' });
        const foreignDrafts = await service.read({ ...actor, organizationId: ids.otherOrg, id: ids.foreign },
          'CFDI_TO_STAMP', { ...options, scope: 'ORGANIZATION' });
        expect(foreignDrafts).toMatchObject({ count: 1, amount: '150.00' });
        // The dashboard may show only one row, but every KPI must reconcile
        // against its complete canonical detail, including exact money cents.
        const financialKeys: FinanceCardKey[] = ['INCOME_COLLECTED', 'COLLECTED_TODAY',
          'COLLECTION_SCHEDULED', 'FEES_SCHEDULED_SIGN', 'FEES_SIGNED', 'PRODUCTION_VALUE',
          'PAYMENTS_DUE', 'PAYMENTS_UNPROVEN', 'CLIENT_RESOURCES', 'REP_PENDING',
          'INVOICES_PENDING', 'CFDI_TO_STAMP'];
        for (const key of financialKeys) {
          const bounded = await service.read(actor, key, { ...options, scope: 'ORGANIZATION', limit: 1 });
          const full = await service.read(actor, key, { ...options, scope: 'ORGANIZATION', limit: 100 });
          expect(bounded.count, `${key}: bounded KPI count`).toBe(full.count);
          expect(bounded.amount, `${key}: bounded KPI amount`).toBe(full.amount);
          expect(bounded.items.length, `${key}: bounded rows`).toBeLessThanOrEqual(1);
          expect(full.items.length, `${key}: complete detail count`).toBe(full.count);
          const detailCents = full.items.reduce((sum, item) => sum
            + BigInt(new Prisma.Decimal(item.amount).mul(100).toFixed(0)), 0n);
          expect(detailCents, `${key}: detail monetary reconciliation`).toBe(
            BigInt(new Prisma.Decimal(full.amount).mul(100).toFixed(0)));
        }
        const appliedIncome = await tx.movimientoFinanciero.findMany({ where: {
          organization_id: ids.org, naturaleza: 'INGRESO', estatus: 'APLICADO',
          fecha_movimiento: today,
        }, select: { id: true, monto: true } });
        const collectedToday = await service.read(actor, 'COLLECTED_TODAY', {
          ...options, scope: 'ORGANIZATION', limit: 100,
        });
        expect(appliedIncome.map((row) => row.id).sort()).toEqual(collectedToday.items.map((row) => row.id).sort());
        expect(appliedIncome.reduce((sum, row) => sum.plus(row.monto), new Prisma.Decimal(0)).toFixed(2))
          .toBe(collectedToday.amount);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await db.movimientoFinanciero.count({ where: { id: ids.direct } })).toBe(0);
    expect(await db.expedienteSolicitudPago.count({ where: { id: ids.dueOwn } })).toBe(0);
  });
});
