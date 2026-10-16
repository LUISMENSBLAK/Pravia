import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { MiDiaFinanceCardsService } from './miDiaFinanceCards.service';

type Actor = NonNullable<Request['user']>;
const actor: Actor = { id: '11111111-1111-4111-8111-111111111111', email: 'finance-qa@example.test',
  nombre: 'QA', apellido: 'Local', rol: 'DIRECCION', scope: 'GLOBAL',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'local', permissions: ['finanzas.read'], requiresPasswordChange: false };

const setup = () => {
  const count = vi.fn().mockResolvedValue(2);
  const aggregate = vi.fn().mockResolvedValue({ _sum: { monto: { toFixed: () => '350.50' } } });
  const findMany = vi.fn().mockResolvedValue([{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', folio: 'MOV-2026-000001',
    concepto: 'Anticipo recibido', monto: { toFixed: () => '150.50' },
    fecha_movimiento: new Date('2026-10-14T12:00:00.000Z') }]);
  return { count, aggregate, findMany, service: new MiDiaFinanceCardsService({
    movimientoFinanciero: { count, aggregate, findMany },
  } as unknown as PrismaClient) };
};

const feeSetup = () => {
  const count = vi.fn().mockResolvedValue(2);
  const aggregate = vi.fn().mockResolvedValue({ _sum: { subtotal_honorarios: { toFixed: () => '450.00' } } });
  const findMany = vi.fn().mockResolvedValue([{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    numero_pravia: 'EXP-0042-2026', cliente_alias: 'Cliente QA',
    fecha_estimada_firma: new Date('2026-10-14T12:00:00.000Z'), fecha_real_firma: null,
    presupuesto: { subtotal_honorarios: { toFixed: () => '200.00' } } }]);
  return { count, aggregate, findMany, service: new MiDiaFinanceCardsService({
    expediente: { count, findMany }, expedientePresupuesto: { aggregate },
  } as unknown as PrismaClient) };
};

const paymentSetup = () => {
  const count = vi.fn().mockResolvedValue(1);
  const aggregate = vi.fn().mockResolvedValue({ _sum: { importe: { toFixed: () => '500.00' } } });
  const findMany = vi.fn().mockResolvedValue([{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    expediente_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', concepto: 'Pago a gestor',
    importe: { toFixed: () => '500.00' }, created_at: new Date('2026-10-14T12:00:00.000Z'),
    pagado_at: null, expediente: { numero_pravia: 'EXP-0042-2026' } }]);
  return { count, aggregate, findMany, service: new MiDiaFinanceCardsService({
    expedienteSolicitudPago: { count, aggregate, findMany },
  } as unknown as PrismaClient) };
};

const receivableSetup = () => {
  const findMany = vi.fn().mockResolvedValue([
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', monto: 500,
      fecha_vencimiento: new Date('2026-10-14T12:00:00.000Z'),
      expediente: { numero_pravia: 'EXP-0042-2026', cliente_alias: 'Cliente QA' },
      cotizacion: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', numero_cotizacion: 'COT-0001-2026', prospecto: null },
      distribuciones: [{ monto: 200 }] },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', monto: 100,
      fecha_vencimiento: new Date('2026-10-15T12:00:00.000Z'), expediente: null,
      cotizacion: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', numero_cotizacion: 'COT-0002-2026', prospecto: null },
      distribuciones: [{ monto: 100 }] },
  ]);
  return { findMany, service: new MiDiaFinanceCardsService({
    honorarioGenerado: { findMany },
  } as unknown as PrismaClient) };
};

describe('Mi Día financial income cards', () => {
  it('reads only applied incoming movements, keeping exact total separate from limited rows', async () => {
    const { count, aggregate, findMany, service } = setup();
    const result = await service.read(actor, 'INCOME_COLLECTED', { scope: 'ORGANIZATION',
      requestedUserId: 'TODOS', period: 'MONTH', timezone: 'America/Mexico_City',
      now: new Date('2026-10-14T12:00:00.000Z'), limit: 1 });
    expect(result).toMatchObject({ count: 2, amount: '350.50', items: [{
      href: '/finanzas?view=movimientos&movimiento_id=cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      amount: '150.50',
    }] });
    expect(findMany.mock.calls[0][0].take).toBe(1);
    const where = count.mock.calls[0][0].where;
    expect(where.organization_id).toBe(actor.organizationId);
    expect(where.naturaleza).toBe('INGRESO');
    expect(where.estatus.in).toEqual(['APLICADO', 'RECIBIDO', 'VALIDADO']);
    expect(where.OR).toBeUndefined();
    expect(aggregate.mock.calls[0][0].where).toEqual(where);
    expect(findMany.mock.calls[0][0].where).toEqual(where);
  });

  it('uses the local-day interval and OWN object boundary, ignoring a forged user', async () => {
    const { count, service } = setup();
    await service.read(actor, 'COLLECTED_TODAY', { scope: 'OWN',
      requestedUserId: '22222222-2222-4222-8222-222222222222', timezone: 'America/Mexico_City',
      now: new Date('2026-10-14T12:00:00.000Z') });
    const where = count.mock.calls[0][0].where;
    expect(where.fecha_movimiento.gte.toISOString()).toBe('2026-10-14T06:00:00.000Z');
    expect(where.fecha_movimiento.lt.toISOString()).toBe('2026-10-15T06:00:00.000Z');
    expect(where.OR[0]).toEqual({ responsable_id: actor.id });
    expect(where.OR[1].expediente.is).toMatchObject({ organization_id: actor.organizationId });
    expect(where.OR[1].expediente.is.OR).toContainEqual({ abogado_id: actor.id });
  });

  it('rejects a reader without financial permission before querying', async () => {
    const { count, service } = setup();
    await expect(service.read({ ...actor, permissions: [] }, 'COLLECTED_TODAY', { scope: 'ORGANIZATION' }))
      .rejects.toThrow('MIDIA_FINANCE_READ_DENIED');
    expect(count).not.toHaveBeenCalled();
  });

  it('returns a verified zero only after successful empty ledger queries', async () => {
    const { count, aggregate, findMany, service } = setup();
    count.mockResolvedValue(0); aggregate.mockResolvedValue({ _sum: { monto: null } }); findMany.mockResolvedValue([]);
    expect(await service.read(actor, 'COLLECTED_TODAY', { scope: 'ORGANIZATION' })).toEqual({
      count: 0, amount: '0.00', items: [],
    });
  });

  it('totals full current expediente fees for scheduled unsigned cases without deducting advances', async () => {
    const { count, aggregate, findMany, service } = feeSetup();
    const result = await service.read(actor, 'FEES_SCHEDULED_SIGN', { scope: 'ORGANIZATION',
      period: 'MONTH', now: new Date('2026-10-14T12:00:00.000Z'), limit: 1 });
    expect(result).toMatchObject({ count: 2, amount: '450.00' });
    expect(result.items[0]).toMatchObject({ amount: '200.00',
      href: '/expedientes/dddddddd-dddd-4ddd-8ddd-dddddddddddd#finanzas' });
    expect(result.items).toHaveLength(1);
    const where = count.mock.calls[0][0].where.AND;
    expect(where[0]).toMatchObject({ organization_id: actor.organizationId, archived_at: null });
    expect(where[1].fecha_real_firma).toBeNull();
    expect(where[1].fecha_estimada_firma).toHaveProperty('gte');
    expect(aggregate.mock.calls[0][0].where).toEqual({ organization_id: actor.organizationId,
      expediente: { is: count.mock.calls[0][0].where } });
    expect(findMany.mock.calls[0][0].take).toBe(1);
  });

  it('counts actual signed dates only and enforces OWN scope', async () => {
    const { count, findMany, service } = feeSetup();
    findMany.mockResolvedValue([{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', numero_pravia: 'EXP-0042-2026',
      cliente_alias: 'Cliente QA', fecha_estimada_firma: null,
      fecha_real_firma: new Date('2026-10-14T12:00:00.000Z'),
      presupuesto: { subtotal_honorarios: { toFixed: () => '200.00' } } }]);
    await service.read(actor, 'FEES_SIGNED', { scope: 'OWN', requestedUserId: 'forged',
      period: 'WEEK', now: new Date('2026-10-14T12:00:00.000Z') });
    const where = count.mock.calls[0][0].where.AND;
    expect(where[0].OR).toContainEqual({ abogado_id: actor.id });
    expect(where[1].fecha_real_firma).toHaveProperty('gte');
    expect(where[1].fecha_estimada_firma).toBeUndefined();
  });

  it('attributes production only to the responsible lawyer and reuses signed-fee sums', async () => {
    const { count, aggregate, findMany, service } = feeSetup();
    count.mockResolvedValueOnce(0);
    findMany.mockResolvedValue([{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', numero_pravia: 'EXP-0042-2026',
      cliente_alias: 'Cliente QA', fecha_real_firma: new Date('2026-10-14T12:00:00.000Z'),
      presupuesto: { subtotal_honorarios: { toFixed: () => '200.00' } } },
    { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', numero_pravia: 'EXP-0043-2026',
      cliente_alias: 'Cliente QA 2', fecha_real_firma: new Date('2026-10-14T13:00:00.000Z'),
      presupuesto: { subtotal_honorarios: { toFixed: () => '250.00' } } }]);
    const result = await service.read(actor, 'PRODUCTION_VALUE', { scope: 'OWN', requestedUserId: 'forged',
      period: 'YEAR', now: new Date('2026-10-14T12:00:00.000Z'), limit: 1 });
    expect(result).toMatchObject({ count: 2, amount: '450.00' });
    expect(result.items[0]).toMatchObject({ amount: '200.00',
      href: '/expedientes/dddddddd-dddd-4ddd-8ddd-dddddddddddd#finanzas' });
    expect(result.items).toHaveLength(1);
    const where = count.mock.calls[1][0].where.AND;
    expect(where[0]).toMatchObject({ organization_id: actor.organizationId });
    expect(where[1]).toEqual({ abogado_id: actor.id });
    expect(where[2].fecha_real_firma).toHaveProperty('gte');
    expect(where[2].fecha_estimada_firma).toBeUndefined();
    expect(count.mock.calls[0][0].where.AND[1].presupuesto).toEqual({ is: null });
    expect(aggregate.mock.calls[0][0].where.expediente.is).toEqual(count.mock.calls[1][0].where);
    expect(findMany.mock.calls[0][0].where).toEqual(count.mock.calls[1][0].where);
    expect(findMany.mock.calls[0][0].take).toBeUndefined();
    expect(result.amount).toBe('450.00');
  });

  it('does not publish a partial production sum when a signed case lacks a budget', async () => {
    const { count, aggregate, service } = feeSetup();
    count.mockResolvedValueOnce(1);
    expect(await service.read(actor, 'PRODUCTION_VALUE', { scope: 'ORGANIZATION', period: 'MONTH' }))
      .toMatchObject({ available: false, message: expect.stringContaining('carecen del presupuesto') });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('does not invent a pending advance when EXP-008 has no required-advance source', async () => {
    const { count, service } = setup();
    expect(await service.read(actor, 'ADVANCES_PENDING', { scope: 'OWN' })).toMatchObject({
      available: false, message: expect.stringContaining('anticipo requerido explícito'), items: [],
    });
    expect(count).not.toHaveBeenCalled();
  });

  it('reads only pending EXP-008 payment requests and links the exact request', async () => {
    const { count, aggregate, findMany, service } = paymentSetup();
    const result = await service.read(actor, 'PAYMENTS_DUE', { scope: 'ORGANIZATION', limit: 1 });
    expect(result).toMatchObject({ count: 1, amount: '500.00', items: [{
      href: '/expedientes/dddddddd-dddd-4ddd-8ddd-dddddddddddd?payment_request_id=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee#finanzas',
    }] });
    const where = count.mock.calls[0][0].where;
    expect(where).toMatchObject({ organization_id: actor.organizationId, estado: 'PENDIENTE',
      expediente: { is: { organization_id: actor.organizationId } } });
    expect(aggregate.mock.calls[0][0].where).toEqual(where);
    expect(findMany.mock.calls[0][0].where).toEqual(where);
  });

  it('flags only paid requests with a movement and without active payment evidence', async () => {
    const { count, findMany, service } = paymentSetup();
    findMany.mockResolvedValue([{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      expediente_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', concepto: 'Pago a gestor',
      importe: { toFixed: () => '500.00' }, created_at: new Date('2026-10-14T12:00:00.000Z'),
      pagado_at: new Date('2026-10-14T13:00:00.000Z'), expediente: { numero_pravia: 'EXP-0042-2026' } }]);
    const result = await service.read(actor, 'PAYMENTS_UNPROVEN', { scope: 'OWN', requestedUserId: 'forged' });
    expect(result.items[0].received_at).toBe('2026-10-14T13:00:00.000Z');
    const where = count.mock.calls[0][0].where;
    expect(where.estado).toBe('PAGADA');
    expect(where.movimiento_id).toEqual({ not: null });
    expect(where.documentos.none).toMatchObject({ estatus: 'ACTIVO', tipo: 'COMPROBANTE_PAGO',
      documento: { estatus: 'VIGENTE' } });
    expect(where.expediente.is.OR).toContainEqual({ abogado_id: actor.id });
  });

  it('subtracts only applied income distributions from recognized fees due in the selected period', async () => {
    const { findMany, service } = receivableSetup();
    const result = await service.read(actor, 'COLLECTION_SCHEDULED', { scope: 'ORGANIZATION',
      period: 'MONTH', now: new Date('2026-10-14T12:00:00.000Z'), limit: 1 });
    expect(result).toMatchObject({ count: 1, amount: '300.00', items: [{ amount: '300.00',
      href: '/cotizaciones/cccccccc-cccc-4ccc-8ccc-cccccccccccc' }] });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ organization_id: actor.organizationId, estado: { not: 'CANCELADO' } });
    expect(where.fecha_vencimiento).toHaveProperty('gte');
    expect(findMany.mock.calls[0][0].select.distribuciones.where.movimiento).toMatchObject({
      organization_id: actor.organizationId, naturaleza: 'INGRESO',
      estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] },
    });
    expect(findMany.mock.calls[0][0].take).toBeUndefined();
  });

  it('limits OWN scheduled collections to the effective user, never a forged selection', async () => {
    const { findMany, service } = receivableSetup();
    await service.read(actor, 'COLLECTION_SCHEDULED', { scope: 'OWN', requestedUserId: 'forged' });
    const where = findMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ responsable_id: actor.id });
    expect(where.OR[1].expediente.is.OR).toContainEqual({ abogado_id: actor.id });
  });

  it('uses only applied third-party allocations to calculate available client resources per case', async () => {
    const { findMany, service } = setup();
    const at = new Date('2026-10-14T12:00:00.000Z');
    const caseOne = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', expediente_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      expediente: { numero_pravia: 'EXP-0001-2026', cliente_alias: 'Cliente uno' }, fecha_movimiento: at,
      categoria: 'QA', monto: 500, naturaleza: 'INGRESO' };
    findMany.mockResolvedValue([
      { ...caseOne, distribuciones: [{ monto: 400, categoria: { naturaleza: 'TERCERO' } },
        { monto: 100, categoria: { naturaleza: 'DESPACHO' } }] },
      { ...caseOne, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', monto: 150, naturaleza: 'EGRESO',
        distribuciones: [{ monto: 150, categoria: { naturaleza: 'TERCERO' } }] },
      { ...caseOne, id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expediente_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expediente: { numero_pravia: 'EXP-0002-2026', cliente_alias: 'Cliente dos' }, monto: 100,
        distribuciones: [{ monto: 100, categoria: { naturaleza: 'TERCERO' } }] },
    ]);
    const result = await service.read(actor, 'CLIENT_RESOURCES', { scope: 'OWN', requestedUserId: 'forged', limit: 1 });
    expect(result).toMatchObject({ count: 2, amount: '350.00', items: [{ folio: 'EXP-0001-2026',
      amount: '250.00', href: '/expedientes/dddddddd-dddd-4ddd-8ddd-dddddddddddd#finanzas' }] });
    const where = findMany.mock.calls[0][0].where;
    expect(where.organization_id).toBe(actor.organizationId);
    expect(where.estatus.in).toEqual(['APLICADO', 'RECIBIDO', 'VALIDADO']);
    expect(where.expediente.is.OR).toContainEqual({ abogado_id: actor.id });
    expect(findMany.mock.calls[0][0].select.distribuciones.select.categoria.select.naturaleza).toBe(true);
  });

  it('counts only real PPD payments lacking REP on stamped issued CFDI', async () => {
    const count = vi.fn().mockResolvedValue(2);
    const aggregate = vi.fn().mockResolvedValue({ _sum: { monto_aplicado: { toFixed: () => '375.00' } } });
    const findMany = vi.fn().mockResolvedValue([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      monto_aplicado: { toFixed: () => '125.00' }, created_at: new Date('2026-10-14T12:00:00.000Z'),
      cfdi: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', serie: 'A', folio: '12', uuid_fiscal: 'fiscal-qa',
        receptor_nombre: 'Cliente QA', expediente: null } }]);
    const service = new MiDiaFinanceCardsService({ aplicacionPagoCfdi: { count, aggregate, findMany } } as unknown as PrismaClient);
    const result = await service.read(actor, 'REP_PENDING', { scope: 'OWN', requestedUserId: 'forged', limit: 1 });
    expect(result).toMatchObject({ count: 2, amount: '375.00', items: [{ folio: 'A12',
      href: '/finanzas?view=facturacion&cfdi_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }] });
    const where = count.mock.calls[0][0].where;
    expect(where).toMatchObject({ organization_id: actor.organizationId, rep_cfdi_id: null,
      cfdi: { is: { organization_id: actor.organizationId, direccion: 'EMITIDO', tipo: 'I',
        metodo_pago: 'PPD', uuid_fiscal: { not: null }, estado: { in: ['VIGENTE', 'TIMBRADO'] } } },
      movimiento: { is: { estatus: { in: ['APLICADO', 'RECIBIDO', 'VALIDADO'] } } } });
    expect(where.cfdi.is.OR[0].expediente.is.OR).toContainEqual({ abogado_id: actor.id });
    expect(where.cfdi.is.OR[1]).toEqual({ expediente_id: null, created_by_id: actor.id });
    expect(aggregate.mock.calls[0][0].where).toEqual(where);
    expect(findMany.mock.calls[0][0].take).toBe(1);
  });

  it('reuses CFDI V2 invoiceable minus issued and reserved amounts instead of a boolean', async () => {
    const decimal = (value: number) => new Prisma.Decimal(value);
    const at = new Date('2026-10-14T12:00:00.000Z');
    const income = (id: string, amount: number, state: string | null, linked: Array<{ estado: string; total: number }>) => ({
      id, concepto_contexto: 'Honorarios QA', monto_reportado: decimal(amount), monto_validado: null,
      factura_estado: state, created_at: at,
      expediente: { numero_pravia: 'EXP-0001-2026', cliente_alias: 'Cliente QA' },
      documentosCfdi: linked.map((item) => ({ estado: item.estado, total: decimal(item.total) })),
    });
    const findMany = vi.fn().mockResolvedValue([
      income('one', 500, 'PENDIENTE', [{ estado: 'TIMBRADO', total: 200 }, { estado: 'PREFACTURA', total: 100 }]),
      income('two', 300, 'PENDIENTE', [{ estado: 'VIGENTE', total: 300 }]),
      income('three', 100, 'PENDIENTE', [{ estado: 'PREFACTURA', total: 100 }]),
      income('four', 250, 'PENDIENTE', []),
    ]);
    const service = new MiDiaFinanceCardsService({ expedienteIngresoReportado: { findMany } } as unknown as PrismaClient);
    const result = await service.read(actor, 'INVOICES_PENDING', { scope: 'OWN', requestedUserId: 'forged', limit: 1 });
    expect(result).toMatchObject({ count: 2, amount: '450.00', items: [{ id: 'one', amount: '200.00',
      href: '/finanzas?view=facturacion&income_id=one' }] });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ organization_id: actor.organizationId, estado: { not: 'ANULADO' },
      factura_estado: 'PENDIENTE' });
    expect(where.expediente.is.OR).toContainEqual({ abogado_id: actor.id });
    expect(findMany.mock.calls[0][0].take).toBeUndefined();
  });

  it('shows only data-complete prefacturas and keeps the PAC warning visible', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      direccion: 'EMITIDO', tipo: 'I', estado: 'PREFACTURA', entidad_fiscal_id: 'entity',
      entidadFiscal: { activa: true }, emisor_rfc: 'AAA010101AAA', receptor_rfc: 'XAXX010101000',
      receptor_nombre: 'Cliente QA', receptor_regimen: '616', receptor_codigo_postal: '12345',
      uso_cfdi: 'G03', metodo_pago: 'PPD', forma_pago: '99', moneda: 'MXN',
      subtotal: new Prisma.Decimal('100.00'), impuestos_trasladados: new Prisma.Decimal('16.00'),
      impuestos_retenidos: new Prisma.Decimal('0.00'), total: new Prisma.Decimal('116.00'),
      draft_payload: { concepts: [{ clave_prod_serv: '84111506', clave_unidad: 'E48', objeto_impuesto: '02',
        descripcion: 'Servicio QA', cantidad: '1', valor_unitario: '100.00' }] },
      serie: 'A', folio: '12', created_at: new Date('2026-10-14T12:00:00.000Z'), expediente: null,
    }]);
    const service = new MiDiaFinanceCardsService({ documentoCfdi: { findMany } } as unknown as PrismaClient);
    const result = await service.read(actor, 'CFDI_TO_STAMP', { scope: 'OWN', requestedUserId: 'forged' });
    expect(result).toMatchObject({ count: 1, amount: '116.00', items: [{ folio: 'A12',
      href: '/finanzas?view=facturacion&cfdi_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }] });
    expect(result.items[0].concepto).toContain('PAC no certificado');
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ organization_id: actor.organizationId, estado: 'PREFACTURA',
      direccion: 'EMITIDO', tipo: 'I' });
    expect(where.OR[0].expediente.is.OR).toContainEqual({ abogado_id: actor.id });
  });
});
