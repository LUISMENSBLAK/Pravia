import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const delegate = () => ({ findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() });
  const db: any = {
    expediente: delegate(), expedienteComplianceState: delegate(), complianceRequirement: delegate(),
    complianceRequirementException: delegate(), expedienteActividad: delegate(), auditLog: delegate(),
    $executeRaw: vi.fn(), $transaction: vi.fn(),
  };
  return { db };
});
vi.mock('../config/prisma', () => ({ default: mocks.db }));

import { ComplianceH7Service, recordComplianceActivityTx } from './complianceH7.service';

const organizationId = '00000000-0000-4000-8000-00000000a701';
const actorId = '00000000-0000-4000-8000-00000000a702';
const expedienteId = '00000000-0000-4000-8000-00000000a703';
const reviewId = '00000000-0000-4000-8000-00000000a704';
const stateId = '00000000-0000-4000-8000-00000000a705';
const requirementId = '00000000-0000-4000-8000-00000000a706';
const actor: any = { id: actorId, organizationId, sessionId: 'session-h7', rol: 'ADMINISTRACION', scope: 'GLOBAL', permissions: ['expedientes.read', 'compliance.read', 'compliance.review', 'compliance.sensitive.read'] };
const state = { id: stateId, organization_id: organizationId, expediente_id: expedienteId, current_review_id: reviewId, state: 'PENDIENTE', pending_count: 1 };
const requirement = { id: requirementId, organization_id: organizationId, expediente_id: expedienteId, state_id: stateId, review_id: reviewId, provider: 'AVI', requirement_key: 'AVI:TEST', label: 'Acuse sintético', status: 'PENDIENTE', deadline: null, blocks_completion: true, missing_action: 'GO_TO_NOTICE' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.$transaction.mockImplementation((work: any) => work(mocks.db));
  mocks.db.$executeRaw.mockResolvedValue(0);
  mocks.db.expediente.findFirst.mockResolvedValue({ id: expedienteId, estatus: 'ENTREGADO' });
  mocks.db.expedienteComplianceState.findFirst.mockResolvedValue(state);
  mocks.db.expedienteComplianceState.update.mockImplementation(async ({ data }: any) => ({ ...state, ...data }));
  mocks.db.complianceRequirement.findFirst.mockResolvedValue(requirement);
  mocks.db.complianceRequirement.findMany.mockResolvedValue([requirement]);
  mocks.db.complianceRequirement.update.mockImplementation(async ({ data }: any) => ({ ...requirement, ...data }));
  mocks.db.complianceRequirementException.findFirst.mockResolvedValue(null);
  mocks.db.complianceRequirementException.create.mockImplementation(async ({ data }: any) => ({ id: 'exception-h7', created_at: new Date('2026-09-05T12:00:00.000Z'), superseded_at: null, ...data }));
  mocks.db.complianceRequirementException.update.mockResolvedValue({});
  mocks.db.auditLog.create.mockResolvedValue({});
  mocks.db.expedienteActividad.createMany.mockResolvedValue({ count: 1 });
});

describe('H7 exception, access and visible activity', () => {
  it('requires the elevated existing review permission', async () => {
    await expect(ComplianceH7Service.authorizeException({ ...actor, permissions: ['compliance.write'] }, expedienteId, requirementId, { reason: 'Fundamento suficiente', idempotency_key: 'h7-permission' })).rejects.toMatchObject({ code: 'H7_EXCEPTION_PERMISSION_DENIED', status: 403 });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it('requires a substantive reason before opening a transaction', async () => {
    await expect(ComplianceH7Service.authorizeException(actor, expedienteId, requirementId, { reason: 'corto', idempotency_key: 'h7-reason' })).rejects.toMatchObject({ code: 'H7_EXCEPTION_REASON_REQUIRED' });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or inaccessible expediente before touching the requirement', async () => {
    mocks.db.expediente.findFirst.mockResolvedValue(null);
    await expect(ComplianceH7Service.authorizeException(actor, expedienteId, requirementId, { reason: 'Fundamento autorizado válido', idempotency_key: 'h7-cross-tenant' })).rejects.toMatchObject({ code: 'H7_CASE_ACCESS_DENIED', status: 403 });
    expect(mocks.db.complianceRequirement.findFirst).not.toHaveBeenCalled();
  });

  it('preserves the requirement, appends an exception, audits it and writes one EXP-009 activity', async () => {
    const result = await ComplianceH7Service.authorizeException(actor, expedienteId, requirementId, { reason: 'Fundamento autorizado válido', idempotency_key: 'h7-success-key' }, 'correlation-h7');
    expect(result.idempotent).toBe(false);
    expect(mocks.db.complianceRequirement.update).toHaveBeenCalledWith({ where: { id: requirementId }, data: { status: 'NO_APLICA' } });
    expect(mocks.db.complianceRequirementException.create).toHaveBeenCalledWith({ data: expect.objectContaining({ requirement_id: requirementId, resolution: 'NO_APLICA_BY_AUTHORIZED_EXCEPTION', authorized_by_id: actorId, reason: 'Fundamento autorizado válido' }) });
    expect(mocks.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'H7_AUTHORIZE_REQUIREMENT_EXCEPTION', entidad: 'ComplianceRequirementException' }) });
    expect(mocks.db.expedienteActividad.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ expediente_id: expedienteId, seccion_relacionada: 'cumplimiento', idempotency_key: 'h7:exception:exception-h7' })], skipDuplicates: true }));
    expect(mocks.db.complianceRequirement.updateMany).not.toHaveBeenCalled();
  });

  it('supersedes the prior exception without deleting history', async () => {
    mocks.db.complianceRequirementException.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'prior-h7', payload_hash: 'old', superseded_at: null });
    await ComplianceH7Service.authorizeException(actor, expedienteId, requirementId, { reason: 'Nuevo fundamento autorizado', idempotency_key: 'h7-replace-key' });
    expect(mocks.db.complianceRequirementException.update).toHaveBeenCalledWith({ where: { id: 'prior-h7' }, data: { superseded_at: expect.any(Date) } });
    expect(mocks.db.complianceRequirementException.create).toHaveBeenCalledWith({ data: expect.objectContaining({ supersedes_id: 'prior-h7' }) });
  });

  it('returns an exact retry without duplicate audit or visible activity', async () => {
    const first = await ComplianceH7Service.authorizeException(actor, expedienteId, requirementId, { reason: 'Fundamento repetible válido', idempotency_key: 'h7-retry-key' });
    const persisted = first.exception;
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation((work: any) => work(mocks.db)); mocks.db.$executeRaw.mockResolvedValue(0);
    mocks.db.expediente.findFirst.mockResolvedValue({ id: expedienteId }); mocks.db.complianceRequirement.findFirst.mockResolvedValue(requirement); mocks.db.expedienteComplianceState.findFirst.mockResolvedValue(state);
    mocks.db.complianceRequirementException.findFirst.mockResolvedValue(persisted);
    const retry = await ComplianceH7Service.authorizeException(actor, expedienteId, requirementId, { reason: 'Fundamento repetible válido', idempotency_key: 'h7-retry-key' });
    expect(retry.idempotent).toBe(true);
    expect(mocks.db.complianceRequirementException.create).not.toHaveBeenCalled(); expect(mocks.db.auditLog.create).not.toHaveBeenCalled(); expect(mocks.db.expedienteActividad.createMany).not.toHaveBeenCalled();
  });

  it('deduplicates the visible timeline using the EXP-009 unique key', async () => {
    mocks.db.expedienteActividad.createMany.mockResolvedValue({ count: 0 });
    await expect(recordComplianceActivityTx(mocks.db, { organizationId, expedienteId, actorUserId: actorId, action: 'TEST', entity: 'Requirement', entityId: requirementId, title: 'Evento', description: 'Evento visible', idempotencyKey: 'same-key' })).resolves.toBe(false);
    expect(mocks.db.expedienteActividad.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('keeps delivered operational state independent while returning exact canonical counts', async () => {
    mocks.db.complianceRequirement.findMany.mockResolvedValue([{ ...requirement, exceptions: [] }, { ...requirement, id: 'fulfilled', provider: 'DOC', status: 'CUMPLIDO', missing_action: null, exceptions: [] }]);
    const workspace = await ComplianceH7Service.readWorkspace(actor, expedienteId);
    expect(workspace).toMatchObject({ state: 'PENDIENTE', pending_count: 1, actionable_missing_count: 1, operational_status: 'ENTREGADO' });
  });
});
