import { describe, expect, it, vi } from 'vitest';
import { reportingCalendarRanges } from '../domain/reportingCore';
import { ReportingService } from './reporting.service';

const user = (role = 'DIRECCION', permissions = ['reportes.read', 'reportes.global.read', 'reportes.financial.read']) => ({
  id: 'user-1', rol: role, permissions, sessionId: 's1', email: 'test@pravia.mx', nombre: 'Ana', apellido: 'Prueba', requiresPasswordChange: false,
} as any);

const database = () => ({
  honorarioGenerado: { findMany: vi.fn().mockResolvedValue([]) },
  movimientoFinanciero: { findMany: vi.fn().mockResolvedValue([]) },
  metaHonorario: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'meta-1' }),
    update: vi.fn().mockResolvedValue({ id: 'meta-1', activa: false }),
  },
  expediente: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  cotizacion: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _sum: { honorarios_pravia: 0 } }),
  },
  prospecto: { count: vi.fn().mockResolvedValue(0) },
  user: { findMany: vi.fn().mockResolvedValue([]) },
  notaria: { findMany: vi.fn().mockResolvedValue([]) },
} as any);

const fee = (id: string, amount: number, collected: number, options: { lawyer?: string; notaria?: string; due?: Date | null; recognized?: Date } = {}) => ({
  id,
  expediente_id: `exp-${id}`,
  monto: amount,
  fecha_reconocimiento: options.recognized || new Date(),
  fecha_vencimiento: options.due ?? null,
  responsable: { id: options.lawyer || 'u1', nombre: options.lawyer === 'u2' ? 'Luis' : 'Ana', apellido: options.lawyer === 'u2' ? 'Paz' : 'Ruiz' },
  notaria: { id: options.notaria || 'n1', nombre: options.notaria === 'n2' ? 'Notaría 2' : 'Notaría 1' },
  expediente: { id: `exp-${id}`, numero_pravia: `EXP-${id}`, cliente_alias: `Cliente ${id}`, estatus: 'EN_PROCESO', fecha_estimada_firma: null, abogado: { id: options.lawyer || 'u1', nombre: 'Ana', apellido: 'Ruiz' }, notaria: { id: options.notaria || 'n1', nombre: 'Notaría 1' } },
  cotizacion: { id: `quote-${id}`, numero_cotizacion: `COT-${id}`, prospecto: { nombre: `Cliente ${id}` } },
  distribuciones: collected ? [{ monto: collected }] : [],
});

describe('ReportingService', () => {
  it('impone scope propio al abogado y no acepta ampliar abogado_id', () => {
    const service = new ReportingService(database());
    const ctx = service.context(user('ABOGADO', ['reportes.read', 'reportes.financial.read']), { abogado_id: 'otro' });
    expect(ctx.scope).toMatchObject({ mode: 'PROPIO', lawyerId: 'user-1', financial: true });
  });

  it('impide que un usuario sin alcance global amplíe la notaría y no expone su catálogo', async () => {
    const db = database();
    const service = new ReportingService(db);
    const scopedUser = user('CONSULTA', ['reportes.read']);
    const ctx = service.context(scopedUser, { notaria_id: 'n2' });
    expect(ctx.scope.notariaId).toBeUndefined();
    const catalogs = await service.catalogs(scopedUser);
    expect(catalogs.notarias).toEqual([]);
    expect(db.notaria.findMany).not.toHaveBeenCalled();
  });

  it('mantiene al usuario operativo sin importes si no tiene permiso financiero', async () => {
    const db = database();
    const result = await new ReportingService(db).finance(user('CONSULTA', ['reportes.read']), {});
    expect(result).toMatchObject({ restricted: true, scope: { mode: 'OPERATIVO', financial: false } });
    expect(db.honorarioGenerado.findMany).not.toHaveBeenCalled();
  });

  it('no filtra importes indirectos desde resumen, abogados, firmas ni potenciales sin permiso financiero', async () => {
    const scopedUser = user('CONSULTA', ['reportes.read', 'expedientes.read', 'agenda.read']);
    const summaryDb = database();
    summaryDb.expediente.findMany.mockResolvedValue([{ id: 'e1', honorariosGenerados: [{ monto: 120_000 }] }]);
    summaryDb.cotizacion.findMany.mockResolvedValue([{ id: 'q1', total_cliente: 250_000, fecha_aceptacion_cliente: null }]);
    const summary = await new ReportingService(summaryDb).summary(scopedUser, {});
    expect(summary.operations).toMatchObject({ honorarios_programados_semana: null, importe_cotizado: null });

    const lawyerDb = database();
    lawyerDb.user.findMany.mockResolvedValue([{ id: 'u1', nombre: 'Ana', apellido: 'Ruiz' }]);
    const lawyers = await new ReportingService(lawyerDb).lawyers(scopedUser, {});
    expect(lawyers.rows[0]).toMatchObject({ honorarios_generados: null, honorarios_cobrados: null, honorarios_semana: null, honorarios_mes: null });

    const signatureDb = database();
    signatureDb.expediente.findMany.mockResolvedValue([{ id: 'e1', numero_pravia: 'EXP-1', cliente_alias: 'Cliente', fecha_estimada_firma: new Date(Date.now() + 86_400_000), fecha_real_firma: null, abogado: { id: 'u1', nombre: 'Ana', apellido: 'Ruiz' }, honorariosGenerados: [{ monto: 120_000 }] }]);
    const signatures = await new ReportingService(signatureDb).signatures(scopedUser, {});
    expect(signatures.metrics.honorarios_programados_mes).toBeNull();
    expect(signatures.rows[0]?.honorarios).toBeNull();

    const potentialDb = database();
    const potential = await new ReportingService(potentialDb).potentialClients(scopedUser, {});
    expect(potential).toMatchObject({ restricted: true, rows: [] });
    expect(potentialDb.cotizacion.findMany).not.toHaveBeenCalled();
  });

  it('calcula 390K generados, 312K cobrados y 78K por cobrar sin sumar terceros', async () => {
    const db = database();
    db.honorarioGenerado.findMany.mockResolvedValue([fee('1', 390_000, 312_000)]);
    db.movimientoFinanciero.findMany.mockResolvedValue([{
      naturaleza: 'INGRESO', monto: 810_000, estatus: 'APLICADO', distribuciones: [
        { monto: 312_000, categoria: { naturaleza: 'DESPACHO' } },
        { monto: 498_000, categoria: { naturaleza: 'TERCERO' } },
      ],
    }]);
    const service = new ReportingService(db);
    const result = await service.canonicalFinancials(service.context(user(), {}));
    expect(result).toMatchObject({ honorarios_generados: 390_000, honorarios_cobrados: 312_000, honorarios_por_cobrar: 78_000, fondos_terceros: 498_000 });
  });

  it('filtra abogado y notaría en las consultas del subconjunto', async () => {
    const db = database();
    const service = new ReportingService(db);
    await service.collections(user(), { abogado_id: 'u2', notaria_id: 'n2' });
    expect(db.honorarioGenerado.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ responsable_id: 'u2', notaria_id: 'n2' }) }));
    expect(db.movimientoFinanciero.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ responsable_id: 'u2', notaria_id: 'n2' }) }));
  });

  it('sólo marca vencido con fecha fiable y conserva la ecuación de cobranza', async () => {
    const db = database();
    db.honorarioGenerado.findMany.mockResolvedValue([
      fee('1', 100_000, 40_000, { due: new Date('2020-01-01') }),
      fee('2', 50_000, 0, { due: null }),
    ]);
    const result = await new ReportingService(db).collections(user(), { periodo: 'ESTE_ANO' });
    expect(result.totals).toMatchObject({ generated: 150_000, collected: 40_000, pending: 110_000, overdue: 60_000 });
    expect(result.rows?.find((row) => row.id === '2')).toMatchObject({ overdue: false });
  });

  it('separa futuras programadas, pasadas sin confirmar y realizadas explícitas', async () => {
    const db = database();
    const now = new Date();
    const week = reportingCalendarRanges('America/Mexico_City', now).week;
    const completedPrevious = new Date(week.from.getTime() - 2 * 86_400_000);
    const future = new Date(now.getTime() + 60 * 60_000);
    const pastUnconfirmed = new Date(now.getTime() - 24 * 60 * 60_000);
    db.expediente.findMany.mockResolvedValue([
      { id: 'done', numero_pravia: 'EXP-DONE', cliente_alias: 'A', fecha_estimada_firma: completedPrevious, fecha_real_firma: completedPrevious, abogado: { id: 'u1', nombre: 'Ana', apellido: 'Ruiz' }, honorariosGenerados: [{ monto: 100_000 }] },
      { id: 'future', numero_pravia: 'EXP-FUTURE', cliente_alias: 'B', fecha_estimada_firma: future, fecha_real_firma: null, abogado: { id: 'u1', nombre: 'Ana', apellido: 'Ruiz' }, honorariosGenerados: [{ monto: 50_000 }] },
      { id: 'past', numero_pravia: 'EXP-PAST', cliente_alias: 'C', fecha_estimada_firma: pastUnconfirmed, fecha_real_firma: null, abogado: { id: 'u1', nombre: 'Ana', apellido: 'Ruiz' }, honorariosGenerados: [{ monto: 25_000 }] },
    ]);
    const result = await new ReportingService(db).signatures(user(), {});
    expect(result.metrics.realizadas_semana_anterior).toBe(1);
    expect(result.metrics.atrasadas_sin_confirmar).toBe(1);
    expect(result.rows.find((row) => row.id === 'future')?.estado).toBe('PROGRAMADA');
    expect(result.rows.find((row) => row.id === 'past')?.estado).toBe('ATRASADA_SIN_CONFIRMAR');
    expect(result.rows.find((row) => row.id === 'done')?.estado).toBe('REALIZADA');
  });

  it('calcula honorarios semanales y mensuales con ventanas temporales independientes', async () => {
    const db = database();
    const { week, month } = reportingCalendarRanges('America/Mexico_City');
    const inWeek = new Date(week.from.getTime() + 60 * 60_000);
    const inMonthOutsideWeek = new Date(month.from.getTime() + 24 * 60 * 60_000);
    const priorMonth = new Date(month.from.getTime() - 24 * 60 * 60_000);
    const yearFees = [
      fee('week', 80_000, 0, { recognized: inWeek }),
      fee('month', 120_000, 0, { recognized: inMonthOutsideWeek }),
      fee('prior', 300_000, 0, { recognized: priorMonth }),
    ];
    db.user.findMany.mockResolvedValue([{ id: 'u1', nombre: 'Ana', apellido: 'Ruiz' }]);
    db.honorarioGenerado.findMany.mockImplementation(({ where }: any) => {
      const from = where.fecha_reconocimiento?.gte?.getTime();
      return Promise.resolve(from === month.from.getTime() ? yearFees.slice(0, 2) : yearFees);
    });
    const result = await new ReportingService(db).lawyers(user(), { periodo: 'ESTE_ANO' });
    expect(result.rows[0]).toMatchObject({ honorarios_generados: 500_000, honorarios_semana: 80_000, honorarios_mes: 200_000 });
    expect(result.rows[0]?.honorarios_semana).not.toBe(result.rows[0]?.honorarios_mes);
  });

  it('presenta porcentaje y monto restante por abogado y deja Sin meta cuando no existe', async () => {
    const db = database();
    db.user.findMany.mockResolvedValue([{ id: 'u1', nombre: 'Ana', apellido: 'Ruiz' }, { id: 'u2', nombre: 'Luis', apellido: 'Paz' }]);
    db.honorarioGenerado.findMany.mockResolvedValue([fee('1', 350_000, 300_000)]);
    db.metaHonorario.findMany.mockResolvedValue([{ usuario_id: 'u1', importe: 500_000, base: 'GENERADOS', activa: true }]);
    const result = await new ReportingService(db).lawyers(user(), {});
    expect(result.rows.find((row) => row.id === 'u1')?.goal).toMatchObject({ cumplimiento: 70, pendiente: 150_000 });
    expect(result.rows.find((row) => row.id === 'u2')?.goal).toBeNull();
  });

  it('80/20 usa sólo distribución DESPACHO vinculada, soporta pagos parciales, ordena descendente y limita a veinte', async () => {
    const db = database();
    const movement = (id: string, amount: number, linked = true) => ({
      id: `mov-${id}-${amount}`,
      expediente_id: linked ? `exp-${id}` : null,
      expediente: linked ? fee(id, 0, 0).expediente : null,
      distribuciones: [{ monto: amount, honorarioGenerado: linked ? { expediente_id: `exp-${id}` } : null }],
    });
    db.movimientoFinanciero.findMany.mockResolvedValue([
      movement('A', 120), movement('A', 80), movement('B', 150), movement('C', 50), movement('SIN-VINCULO', 90, false),
      ...Array.from({ length: 21 }, (_, index) => movement(`X${index}`, 49 - index)),
    ]);
    db.honorarioGenerado.findMany.mockResolvedValue([
      fee('A', 10, 7), fee('B', 9_000, 50), fee('C', 50, 0), fee('SIN-MOVIMIENTO', 99_000, 0),
      ...Array.from({ length: 21 }, (_, index) => fee(`X${index}`, 49 - index, 0)),
    ]);
    const result = await new ReportingService(db).eightyTwenty(user(), {});
    expect(result.rows?.slice(0, 3).map((row) => row.expediente)).toEqual(['EXP-A', 'EXP-B', 'EXP-C']);
    expect(result.rows).toHaveLength(20);
    expect(result.rows?.[0]).toMatchObject({ honorarios: 10, importe_computable: 200, cobrado_honorarios_acumulado: 7, pending: 3 });
    expect(result.rows?.some((row) => row.expediente === 'EXP-SIN-MOVIMIENTO')).toBe(false);
    expect(result.unclassified_amount).toBe(90);
    expect(result.source).toContain('MovimientoDistribucion de naturaleza DESPACHO');
    expect(db.movimientoFinanciero.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ naturaleza: 'INGRESO' }),
      select: expect.objectContaining({ distribuciones: expect.objectContaining({ where: { categoria: { naturaleza: 'DESPACHO' } } }) }),
    }));
  });

  it('80/20 no consulta ni expone movimientos sin permiso financiero', async () => {
    const db = database();
    const result = await new ReportingService(db).eightyTwenty(user('CONSULTA', ['reportes.read', 'expedientes.read']), {});
    expect(result).toMatchObject({ restricted: true });
    expect(db.movimientoFinanciero.findMany).not.toHaveBeenCalled();
  });

  it('clientes potenciales excluye aceptadas/convertidas y ordena el potencial legítimo', async () => {
    const db = database();
    const base = { numero_cotizacion: 'COT-1', created_at: new Date('2026-08-01'), total_cliente: 100_000, prospecto: { id: 'p1', nombre: 'Cliente', tipo_acto: 'Compraventa' }, creada_por: { id: 'u1', nombre: 'Ana', apellido: 'Ruiz' }, notaria: { id: 'n1', nombre: 'Notaría 1' } };
    db.cotizacion.findMany.mockResolvedValue([
      { ...base, id: 'q1', estado: 'ENVIADA_CLIENTE', honorarios_pravia: 75_000, fecha_aceptacion_cliente: null, expediente: null },
      { ...base, id: 'q2', estado: 'ACEPTADA', honorarios_pravia: 90_000, fecha_aceptacion_cliente: new Date(), expediente: { id: 'e2' } },
      { ...base, id: 'q3', estado: 'EN_NEGOCIACION', honorarios_pravia: 95_000, fecha_aceptacion_cliente: null, expediente: null },
    ]);
    db.cotizacion.count.mockResolvedValue(2);
    db.cotizacion.aggregate.mockResolvedValue({ _sum: { honorarios_pravia: 170_000 } });
    const result = await new ReportingService(db).potentialClients(user(), { periodo: 'PERSONALIZADO', fecha_desde: '2026-08-01', fecha_hasta: '2026-08-31' });
    expect(result.rows.map((row) => row.id)).toEqual(['q3', 'q1']);
    expect(result.metrics).toEqual({ total: 2, honorarios: 170_000 });
    expect(result.meta).toMatchObject({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    expect(result.rows[0]).toMatchObject({ fecha_cotizacion: new Date('2026-08-01'), honorarios: 95_000 });
    expect(result.rows[0]).not.toHaveProperty('prioridad');
    expect(result.rows[0]).not.toHaveProperty('dias_abierta');
    expect(db.cotizacion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ fecha_aceptacion_cliente: null, expediente: null }) }));
    expect(db.honorarioGenerado.findMany).not.toHaveBeenCalled();
  });

  it('crea metas históricas sólo con permiso administrativo y base explícita', async () => {
    const db = database();
    const service = new ReportingService(db);
    await expect(service.createTarget(user('ABOGADO', ['reportes.read']), { periodo_inicio: '2026-08-01', periodo_fin: '2026-08-31', importe: 100_000 })).rejects.toThrow('autorización');
    await service.createTarget(user('DIRECCION', ['reportes.read', 'reportes.targets.manage']), { alcance: 'ABOGADO', usuario_id: 'u1', periodo_inicio: '2026-08-01', periodo_fin: '2026-08-31', importe: 100_000, base: 'COBRADOS' });
    expect(db.metaHonorario.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ alcance: 'ABOGADO', usuario_id: 'u1', importe: 100_000, base: 'COBRADOS', creada_por_id: 'user-1' }) }));
  });

  it('revalida permiso al modificar y cerrar metas sin reescribir históricas cerradas', async () => {
    const db = database();
    const service = new ReportingService(db);
    const manager = user('DIRECCION', ['reportes.read', 'reportes.targets.manage']);
    await expect(service.updateTarget(user('CONSULTA', ['reportes.read']), 'meta-1', { importe: 2 })).rejects.toThrow('autorización');
    const active = { id: 'meta-1', activa: true, alcance: 'DESPACHO', usuario_id: null, periodo_inicio: new Date('2026-08-01'), periodo_fin: new Date('2026-08-31'), importe: 100_000, moneda: 'MXN', base: 'GENERADOS' };
    db.metaHonorario.findUnique.mockResolvedValue(active);
    await service.updateTarget(manager, 'meta-1', { importe: 120_000 });
    await service.closeTarget(manager, 'meta-1');
    expect(db.metaHonorario.update).toHaveBeenLastCalledWith({ where: { id: 'meta-1' }, data: { activa: false } });
    db.metaHonorario.findUnique.mockResolvedValue({ ...active, activa: false });
    await expect(service.updateTarget(manager, 'meta-1', { importe: 130_000 })).rejects.toThrow('histórica cerrada');
  });
});
