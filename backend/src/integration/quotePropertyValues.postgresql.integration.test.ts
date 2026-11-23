import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuoteBudgetService } from '../services/quoteBudget.service';

const target = process.env.QUOTE_PROPERTY_VALUES_QA_DATABASE_URL;
if (target) {
  const parsed = new URL(target);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55521' || parsed.pathname !== '/pravia_client_qa' || parsed.searchParams.get('schema') !== 'pravia_os') throw Error('ISOLATED_PROPERTY_VALUES_QA_DATABASE_REQUIRED');
}
const db = target ? new PrismaClient({ datasources: { db: { url: target } } }) : null;
const org = randomUUID(), user = randomUUID(), member = randomUUID(), quoteId = randomUUID();
const actor = { id: user, organizationId: org, membershipId: member, sessionId: randomUUID(), rol: 'ADMINISTRACION', permissions: ['cotizaciones.read', 'cotizaciones.write'], scope: 'GLOBAL' } as NonNullable<Request['user']>;
const values = { operationValue: '2500000.50', cadastralValue: '1200000.25', propertyTaxAccount: '000019-a/26', predialAmount: '2056.13' };
const save = async (propertyValues: unknown, override = actor) => {
  const quote = await db!.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
  return new QuoteBudgetService(db!).save(override, quoteId, { propertyValues, expectedUpdatedAt: quote.updated_at.toISOString() });
};
describe.runIf(Boolean(target))('Actualización 3 · PostgreSQL físico local', () => {
  beforeAll(async () => {
    await db!.organization.create({ data: { id: org, name: 'SINTÉTICO QA valores de Cotización' } });
    await db!.user.create({ data: { id: user, email: `property-values-${user}@example.test`, password_hash: 'no-login-synthetic', nombre: 'QA', apellido: 'Sintético', rol: 'ADMINISTRACION' } });
    await db!.organizationMembership.create({ data: { id: member, organization_id: org, user_id: user, rol: 'ADMINISTRACION' } });
    await db!.cotizacion.create({ data: { id: quoteId, organization_id: org, user_id: user, estado: 'BORRADOR', updated_at: new Date('2026-11-01T00:00:00Z'), contexto_operacion: 'CONTEXTO QUE SE CONSERVA', total_cliente: '116.00' } });
  });
  afterAll(async () => { await db?.$disconnect(); });
  it('permite NULL y persiste exactamente los cuatro valores sin conceptos ni cobros', async () => {
    const before = await db!.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
    expect([before.valor_operacion, before.valor_catastral, before.cuenta_predial, before.importe_predial]).toEqual([null, null, null, null]);
    await save(values);
    const after = await db!.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
    expect(after.valor_operacion?.toFixed(2)).toBe(values.operationValue); expect(after.valor_catastral?.toFixed(2)).toBe(values.cadastralValue);
    expect(after.cuenta_predial).toBe(values.propertyTaxAccount); expect(after.importe_predial?.toFixed(2)).toBe(values.predialAmount);
    expect(after.total_cliente?.toFixed(2)).toBe('116.00'); expect(after.contexto_operacion).toBe(before.contexto_operacion); expect(after.etapa_contractual).toBe(before.etapa_contractual);
    expect(await db!.cotizacionConcepto.count({ where: { cotizacion_id: quoteId } })).toBe(0);
    expect(await db!.pago.count({ where: { cotizacion_id: quoteId } })).toBe(0);
    expect(await db!.auditLog.count({ where: { organization_id: org, entidad_id: quoteId, accion: 'QUOTE_PROPERTY_VALUES_UPDATED' } })).toBe(1);
  });
  it('conserva omisiones, permite borrar y distingue cero explícito', async () => {
    await save({ predialAmount: '0', propertyTaxAccount: null });
    const after = await db!.cotizacion.findUniqueOrThrow({ where: { id: quoteId } });
    expect(after.valor_operacion?.toFixed(2)).toBe(values.operationValue); expect(after.cuenta_predial).toBeNull(); expect(after.importe_predial?.toFixed(2)).toBe('0.00');
  });
  it('evita pérdida de cambios concurrentes mediante revisión y bloqueo canónicos', async () => {
    await db!.cotizacion.update({ where: { id: quoteId }, data: { updated_at: new Date('2026-11-01T00:00:00Z') } });
    const expected = (await db!.cotizacion.findUniqueOrThrow({ where: { id: quoteId } })).updated_at.toISOString();
    const service = new QuoteBudgetService(db!);
    const results = await Promise.allSettled(['10.11', '20.22'].map((predialAmount) => service.save(actor, quoteId, { propertyValues: { predialAmount }, expectedUpdatedAt: expected })));
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((entry) => entry.status === 'rejected')).toMatchObject({ reason: { code: 'QUOTE_BUDGET_STALE' } });
  });
  it('rechaza cross-tenant, edición de colega y ausencia de permisos', async () => {
    await expect(save(values, { ...actor, organizationId: randomUUID() })).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
    await expect(save(values, { ...actor, rol: 'ABOGADO', id: randomUUID() })).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
    await expect(save(values, { ...actor, permissions: [] })).rejects.toMatchObject({ code: 'QUOTE_BUDGET_WRITE_DENIED' });
  });
  it('PostgreSQL también bloquea negativos aunque se omita el validador HTTP', async () => {
    await expect(db!.cotizacion.update({ where: { id: quoteId }, data: { importe_predial: '-0.01' } })).rejects.toThrow();
    expect((await db!.cotizacion.findUniqueOrThrow({ where: { id: quoteId } })).importe_predial?.isNegative()).toBe(false);
  });
});
