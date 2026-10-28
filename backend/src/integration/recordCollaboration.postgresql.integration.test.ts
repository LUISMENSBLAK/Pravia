import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { permissionsForRole } from '../auth/permissions';
import { cotizacionObjectWhere, cotizacionReadWhere, prospectoObjectWhere, prospectoReadWhere } from '../services/objectAccess.service';
import { expedienteAccessWhere, expedienteReadWhere } from '../middleware/auth.middleware';
import { RecordCollaborationService } from '../services/recordCollaboration.service';
import { ExpedienteActivityService } from '../services/expedienteActivity.service';
import { ExpedienteBudgetService } from '../services/expedienteBudget.service';

const url = process.env.COLLAB_FOLIO_DATABASE_URL || '';
const local = /^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/postgres\?schema=pravia_os$/.test(url);
const db = local ? new PrismaClient({ datasources: { db: { url } } }) : null;
const service = db ? new RecordCollaborationService(db) : null;
const orgA = randomUUID();
const orgB = randomUUID();
const director = randomUUID();
const lawyer = randomUUID();
const outsider = randomUUID();
const prospect = randomUUID();
const quote = randomUUID();
const caseId = randomUUID();
const actor = (id: string, organizationId: string, rol: 'DIRECCION' | 'ABOGADO') => ({
  id, organizationId, rol, permissions: permissionsForRole(rol), sessionId: randomUUID(),
}) as any;

describe.runIf(local)('COL27–COL35 · colaboradores en PostgreSQL local', () => {
  beforeAll(async () => {
    await db!.organization.createMany({ data: [{ id: orgA, name: 'Colaboración QA A' }, { id: orgB, name: 'Colaboración QA B' }] });
    await db!.user.createMany({ data: [
      { id: director, email: `director-${director}@qa.invalid`, nombre: 'Directora', apellido: 'QA', password_hash: 'QA_ONLY', rol: 'DIRECCION' },
      { id: lawyer, email: `lawyer-${lawyer}@qa.invalid`, nombre: 'Abogada', apellido: 'QA', password_hash: 'QA_ONLY', rol: 'ABOGADO' },
      { id: outsider, email: `outsider-${outsider}@qa.invalid`, nombre: 'Externa', apellido: 'QA', password_hash: 'QA_ONLY', rol: 'ABOGADO' },
    ] });
    await db!.organizationMembership.createMany({ data: [
      { organization_id: orgA, user_id: director, rol: 'DIRECCION' },
      { organization_id: orgA, user_id: lawyer, rol: 'ABOGADO' },
      { organization_id: orgB, user_id: outsider, rol: 'ABOGADO' },
    ] });
    await db!.prospecto.create({ data: { id: prospect, organization_id: orgA, nombre: 'Prospecto sintético de colaboración', user_id: director } });
    await db!.cotizacion.create({ data: { id: quote, organization_id: orgA, user_id: director, numero_cotizacion: `COT-QA-${quote}` } });
    await db!.expediente.create({ data: { id: caseId, organization_id: orgA, numero_pravia: `EXP-QA-${caseId}`, abogado_id: director, creador_id: director } });
  });
  afterAll(async () => {
    await db!.recordCollaboration.deleteMany({ where: { organization_id: orgA } });
    await db!.auditLog.deleteMany({ where: { organization_id: orgA, entidad_id: { in: [prospect, quote, caseId] } } });
    await db!.expediente.deleteMany({ where: { id: caseId } });
    await db!.cotizacion.deleteMany({ where: { id: quote } });
    await db!.prospecto.deleteMany({ where: { id: prospect } });
    await db!.organizationMembership.deleteMany({ where: { organization_id: { in: [orgA, orgB] } } });
    await db!.user.deleteMany({ where: { id: { in: [director, lawyer, outsider] } } });
    await db!.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db!.$disconnect();
  });

  it('comparte lectura pero deniega edición antes de asignar', async () => {
    const viewer = actor(lawyer, orgA, 'ABOGADO');
    expect(await db!.prospecto.findFirst({ where: { id: prospect, ...prospectoReadWhere(viewer) }, select: { id: true } })).toBeTruthy();
    expect(await db!.prospecto.findFirst({ where: { id: prospect, ...prospectoObjectWhere(viewer) }, select: { id: true } })).toBeNull();
  });

  it('mantiene Prospecto, Cotización y Expediente fuera de la lectura del otro tenant', async () => {
    const otherTenant = actor(outsider, orgB, 'ABOGADO');
    expect(await db!.prospecto.findFirst({ where: { id: prospect, ...prospectoReadWhere(otherTenant) }, select: { id: true } })).toBeNull();
    expect(await db!.cotizacion.findFirst({ where: { id: quote, ...cotizacionReadWhere(otherTenant) }, select: { id: true } })).toBeNull();
    expect(await db!.expediente.findFirst({ where: { id: caseId, ...expedienteReadWhere(otherTenant) }, select: { id: true } })).toBeNull();
  });

  it('permite leer actividad y previsualizar presupuesto a un colega no asignado, sin abrir otro tenant', async () => {
    const viewer = actor(lawyer, orgA, 'ABOGADO');
    const outsiderActor = actor(outsider, orgB, 'ABOGADO');
    const activity = new ExpedienteActivityService(db!);
    const budget = new ExpedienteBudgetService(db!);
    expect((await activity.list(viewer, caseId, {})).data).toEqual([]);
    expect((await budget.preview(viewer, caseId, [{ concepto: 'Honorarios QA', categoria: 'HONORARIOS', importe: '100.00' }])).totals.honorarios).toBe('100.00');
    await expect(activity.list(outsiderActor, caseId, {})).rejects.toMatchObject({ status: 403 });
    await expect(budget.preview(outsiderActor, caseId, [{ concepto: 'Honorarios QA', categoria: 'HONORARIOS', importe: '100.00' }])).rejects.toMatchObject({ status: 403 });
  });

  it('deniega autoasignación y usuarios de otra notaría', async () => {
    await expect(service!.assign(actor(lawyer, orgA, 'ABOGADO'), 'prospecto', prospect, lawyer))
      .rejects.toMatchObject({ code: 'COLLAB_ASSIGNMENT_DENIED' });
    await expect(service!.assign(actor(director, orgA, 'DIRECCION'), 'prospecto', prospect, outsider))
      .rejects.toMatchObject({ code: 'COLLAB_MEMBER_INELIGIBLE' });
    await expect(service!.list(actor(outsider, orgB, 'ABOGADO'), 'prospecto', prospect))
      .rejects.toMatchObject({ code: 'COLLAB_TARGET_NOT_FOUND' });
  });

  it('asigna una sola vez, audita y revoca la edición tras la baja', async () => {
    const manager = actor(director, orgA, 'DIRECCION');
    const viewer = actor(lawyer, orgA, 'ABOGADO');
    const first = await service!.assign(manager, 'prospecto', prospect, lawyer);
    const second = await service!.assign(manager, 'prospecto', prospect, lawyer);
    expect(first.idempotent).toBe(false);
    expect(second).toEqual({ id: first.id, idempotent: true });
    expect(await db!.prospecto.findFirst({ where: { id: prospect, ...prospectoObjectWhere(viewer) }, select: { id: true } })).toBeTruthy();
    expect((await service!.list(viewer, 'prospecto', prospect)).map((item) => item.user_id)).toEqual([lawyer]);
    await service!.revoke(manager, 'prospecto', prospect, lawyer);
    expect(await db!.prospecto.findFirst({ where: { id: prospect, ...prospectoObjectWhere(viewer) }, select: { id: true } })).toBeNull();
    expect(await service!.list(viewer, 'prospecto', prospect)).toEqual([]);
    expect(await db!.auditLog.count({ where: { organization_id: orgA, entidad_id: prospect, accion: { in: ['COLLABORATOR_ASSIGNED', 'COLLABORATOR_REVOKED'] } } })).toBe(2);
  });

  it('aplica la misma separación lectura/escritura a Cotizaciones y Expedientes', async () => {
    const manager = actor(director, orgA, 'DIRECCION');
    const viewer = actor(lawyer, orgA, 'ABOGADO');
    expect(await db!.cotizacion.findFirst({ where: { id: quote, ...cotizacionReadWhere(viewer) }, select: { id: true } })).toBeTruthy();
    expect(await db!.cotizacion.findFirst({ where: { id: quote, ...cotizacionObjectWhere(viewer) }, select: { id: true } })).toBeNull();
    expect(await db!.expediente.findFirst({ where: { id: caseId, ...expedienteReadWhere(viewer) }, select: { id: true } })).toBeTruthy();
    expect(await db!.expediente.findFirst({ where: { id: caseId, ...expedienteAccessWhere(viewer) }, select: { id: true } })).toBeNull();
    await service!.assign(manager, 'cotizacion', quote, lawyer);
    await service!.assign(manager, 'expediente', caseId, lawyer);
    expect(await db!.cotizacion.findFirst({ where: { id: quote, ...cotizacionObjectWhere(viewer) }, select: { id: true } })).toBeTruthy();
    expect(await db!.expediente.findFirst({ where: { id: caseId, ...expedienteAccessWhere(viewer) }, select: { id: true } })).toBeTruthy();
    await service!.revoke(manager, 'cotizacion', quote, lawyer);
    await service!.revoke(manager, 'expediente', caseId, lawyer);
    expect(await db!.cotizacion.findFirst({ where: { id: quote, ...cotizacionObjectWhere(viewer) }, select: { id: true } })).toBeNull();
    expect(await db!.expediente.findFirst({ where: { id: caseId, ...expedienteAccessWhere(viewer) }, select: { id: true } })).toBeNull();
  });
});
