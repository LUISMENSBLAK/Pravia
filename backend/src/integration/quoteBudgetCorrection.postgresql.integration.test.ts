import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuoteBudgetService } from '../services/quoteBudget.service';

const databaseUrl = process.env.QUOTE_BUDGET_CORRECTION_DATABASE_URL;
const db = databaseUrl ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;
const ids = { organization: randomUUID(), user: randomUUID(), prospect: randomUUID(), quote: randomUUID() };
type Actor = NonNullable<Request['user']>;
const actor: Actor = {
  id: ids.user, organizationId: ids.organization, membershipId: randomUUID(), sessionId: randomUUID(),
  rol: 'ADMINISTRACION', nombre: 'Presupuesto', apellido: 'QA', email: `budget-${ids.user}@example.test`,
  scope: 'GLOBAL', requiresPasswordChange: false, permissions: ['cotizaciones.read', 'cotizaciones.write'],
};

describe.runIf(Boolean(databaseUrl))('Presupuesto canónico · PostgreSQL local aislado', () => {
  beforeAll(async () => {
    if (!db) throw new Error('Base QA no configurada.');
    const [{ name }] = await db.$queryRaw<Array<{ name: string }>>`
      SELECT current_database() AS name`;
    expect(name).toBe('pravia_six_corr_qa');
    await db.organization.create({ data: { id: ids.organization, name: 'Presupuesto QA aislado' } });
    await db.user.create({ data: { id: ids.user, email: actor.email, password_hash: 'synthetic-no-login', nombre: actor.nombre,
      apellido: actor.apellido, rol: 'ADMINISTRACION', activo: true, requires_password_change: false } });
    await db.organizationMembership.create({ data: { id: actor.membershipId, organization_id: ids.organization,
      user_id: ids.user, rol: 'ADMINISTRACION', status: 'ACTIVE' } });
    await db.prospecto.create({ data: { id: ids.prospect, organization_id: ids.organization, user_id: ids.user, nombre: 'Prospecto QA presupuesto' } });
    await db.cotizacion.create({ data: { id: ids.quote, organization_id: ids.organization, user_id: ids.user,
      prospecto_id: ids.prospect, estado: 'BORRADOR', numero_cotizacion: `COT-QA-${ids.quote}` } });
  });

  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { organization_id: ids.organization, entidad: 'Cotizacion', entidad_id: ids.quote } });
    await db.cotizacion.deleteMany({ where: { id: ids.quote, organization_id: ids.organization } });
    await db.prospecto.deleteMany({ where: { id: ids.prospect, organization_id: ids.organization } });
    await db.organizationMembership.deleteMany({ where: { organization_id: ids.organization, user_id: ids.user } });
    await db.user.delete({ where: { id: ids.user } });
    await db.organization.delete({ where: { id: ids.organization } });
    await db.$disconnect();
  });

  it('deriva IVA, persiste otros gastos y mantiene igualdad total/partidas tras recarga', async () => {
    if (!db) throw new Error('Base QA no configurada.');
    const service = new QuoteBudgetService(db);
    const before = await db.cotizacion.findUniqueOrThrow({ where: { id: ids.quote } });
    const concepts = [
      { concepto: 'Honorarios', categoria: 'HONORARIOS', importe: '50000.00' },
      { concepto: 'Impuestos y derechos', categoria: 'IMPUESTOS_DERECHOS', importe: '20000.00' },
      { concepto: 'Otro gasto configurado', categoria: 'OTRO_GASTO', importe: '1500.00', tratamiento_iva: 'GRAVADO', iva_tasa: '0.16',
        regla_fiscal_fuente: 'Política fiscal QA aprobada', regla_fiscal_version: 'qa-v1' },
    ];
    expect((await service.preview(actor, ids.quote, concepts)).totals).toMatchObject({
      honorarios: '50000.00', iva_honorarios: '8000.00', impuestos_derechos: '20000.00',
      otros_gastos: '1500.00', iva_otros_gastos: '240.00', total: '79740.00', requires_review: false,
    });
    await service.save(actor, ids.quote, { concepts, expectedUpdatedAt: before.updated_at.toISOString(), operationContext: 'QA local' });
    const persisted = await db.cotizacion.findUniqueOrThrow({ where: { id: ids.quote }, include: { conceptos: { orderBy: { orden: 'asc' } } } });
    expect(persisted.total_cliente?.toFixed(2)).toBe('79740.00');
    expect(persisted.conceptos).toHaveLength(4);
    expect(persisted.conceptos.find((row) => row.categoria === 'IVA_HONORARIOS')).toMatchObject({ origen: 'DERIVADO' });
    expect(persisted.conceptos.find((row) => row.categoria === 'OTRO_GASTO')).toMatchObject({
      tratamiento_iva: 'GRAVADO', regla_fiscal_fuente: 'Política fiscal QA aprobada', regla_fiscal_version: 'qa-v1',
    });
    expect(persisted.conceptos.reduce((sum, row) => sum + Number(row.importe), 0)).toBe(79500);
  });

  it('rechaza IVA manual, revisión obsoleta y acceso de otra organización sin escribir', async () => {
    if (!db) throw new Error('Base QA no configurada.');
    const service = new QuoteBudgetService(db);
    const current = await db.cotizacion.findUniqueOrThrow({ where: { id: ids.quote } });
    const input = { concepts: [{ concepto: 'Honorarios', categoria: 'HONORARIOS', importe: '100.00' }], expectedUpdatedAt: current.updated_at.toISOString() };
    await expect(service.save({ ...actor, organizationId: randomUUID() }, ids.quote, input)).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
    await expect(service.save(actor, ids.quote, { ...input, concepts: [{ concepto: 'IVA manual', categoria: 'IVA_HONORARIOS', importe: '16.00' }] })).rejects.toMatchObject({ code: 'EXP007_MANUAL_VAT_DENIED' });
    await expect(service.save(actor, ids.quote, { ...input, expectedUpdatedAt: new Date(0).toISOString() })).rejects.toMatchObject({ code: 'QUOTE_BUDGET_STALE' });
    expect(await db.cotizacionConcepto.count({ where: { cotizacion_id: ids.quote } })).toBe(4);
  });

});
