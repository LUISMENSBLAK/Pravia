import { describe, expect, it, vi } from 'vitest';
import { ComplianceScreeningService } from './complianceScreening.service';

const organizationId = '00000000-0000-4000-8000-000000007001';
const actorId = '00000000-0000-4000-8000-000000007002';
const partyId = '00000000-0000-4000-8000-000000007003';
const all = ['comparecientes.read', 'comparecientes.write', 'compliance.read', 'compliance.write', 'compliance.review', 'compliance.sensitive.read', 'expedientes.read'];
const actor = (permissions: string[], overrides: any = {}) => ({
  id: actorId, email: 'h3-rbac@example.invalid', nombre: 'H3', apellido: 'Synthetic', rol: 'ADMINISTRACION', sessionId: 'h3', organizationId,
  membershipId: '00000000-0000-4000-8000-000000007004', scope: 'GLOBAL', permissions, requiresPasswordChange: false, ...overrides,
}) as any;

describe('CUM-LST-001 · RBAC y object-level authorization', () => {
  it('01 expedientes.read aislado no filtra estado de screening', async () => {
    const db: any = { expediente: { findFirst: vi.fn() } };
    await expect(new ComplianceScreeningService(db).operationStatus(actor(['expedientes.read']), 'exp-foreign')).rejects.toMatchObject({ status: 403, code: 'SCREENING_PERMISSION_DENIED' });
    expect(db.expediente.findFirst).not.toHaveBeenCalled();
  });

  it('02 comparecientes.read sin sensitive no devuelve candidatos', async () => {
    const db: any = { compareciente: { findFirst: vi.fn() }, complianceScreeningResult: { findMany: vi.fn() } };
    await expect(new ComplianceScreeningService(db).current(actor(['comparecientes.read', 'compliance.read']), partyId)).rejects.toMatchObject({ status: 403 });
    expect(db.complianceScreeningResult.findMany).not.toHaveBeenCalled();
  });

  it('03 reconsulta manual sin permisos write queda denegada antes de leer objeto', async () => {
    const db: any = { compareciente: { findFirst: vi.fn() } };
    await expect(new ComplianceScreeningService(db).manualRerun(actor(['comparecientes.read', 'compliance.read', 'compliance.sensitive.read']), partyId, 'retry')).rejects.toMatchObject({ status: 403 });
    expect(db.compareciente.findFirst).not.toHaveBeenCalled();
  });

  it('04 resolución sin compliance.review queda denegada', async () => {
    const db: any = { screeningCandidate: { findFirst: vi.fn() } };
    await expect(new ComplianceScreeningService(db).resolve(actor(['compliance.sensitive.read']), partyId, 'q1', 'c1', 'NO_CORRESPONDE', 'Motivo')).rejects.toMatchObject({ status: 403 });
    expect(db.screeningCandidate.findFirst).not.toHaveBeenCalled();
  });

  it('05 un id válido de otro tenant queda bloqueado por la autoridad backend', async () => {
    const db: any = { compareciente: { findFirst: vi.fn().mockResolvedValue(null) }, complianceScreeningResult: { findMany: vi.fn() } };
    await expect(new ComplianceScreeningService(db).current(actor(all), partyId)).rejects.toMatchObject({ status: 403, code: 'SCREENING_COMPARECIENTE_ACCESS_DENIED' });
    expect(db.compareciente.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: partyId, organization_id: organizationId }) }));
    expect(db.complianceScreeningResult.findMany).not.toHaveBeenCalled();
  });

  it('06 la misma clave FREE de otro usuario no reutiliza ni revela su Query', async () => {
    const foreign = { id: 'free-foreign', owner_user_id: '00000000-0000-4000-8000-000000007099', query_kind: 'FREE', trigger_key: `free:${actorId}:SHARED`, sourceExecutions: [], candidates: [], reports: [], operationSnapshots: [] };
    let own: any;
    const db: any = {
      $transaction: vi.fn(async (callback: any) => callback(db)), $executeRawUnsafe: vi.fn(),
      screeningSource: { findMany: vi.fn().mockResolvedValue([]) }, screeningSourceExecution: { create: vi.fn() }, auditLog: { create: vi.fn() },
      complianceScreeningResult: {
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          if (where.owner_user_id === actorId) return Promise.resolve(own || null);
          return Promise.resolve(foreign);
        }),
        create: vi.fn().mockImplementation(({ data }: any) => { own = { id: 'free-own', created_at: new Date(), sourceExecutions: [], candidates: [], reports: [], operationSnapshots: [], ...data }; return Promise.resolve(own); }),
        update: vi.fn().mockImplementation(({ data }: any) => { Object.assign(own, data); return Promise.resolve(own); }),
      },
    };
    const identity: any = { tipo_persona: 'FISICA', primary_name: 'CONSULTA SINTETICA', aliases: [], birth_date: null, birth_place: null, birth_country: null, nationality: null, curp: null, rfc: null, identification: null, incorporation_date: null, commercial_name: null, commercial_folio: null, corporate_type: null };
    const result = await new ComplianceScreeningService(db).freeSearch(actor(['compliance.write', 'compliance.sensitive.read']), identity, 'shared');
    expect(result.id).toBe('free-own'); expect(result.owner_user_id).toBe(actorId); expect(result.id).not.toBe(foreign.id);
  });
});
