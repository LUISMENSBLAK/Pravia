import { describe, expect, it, vi } from 'vitest';
import { ComplianceScreeningService, ScreeningError } from './complianceScreening.service';

const organizationId = '00000000-0000-4000-8000-000000006001';
const actorId = '00000000-0000-4000-8000-000000006002';
const comparecienteId = '00000000-0000-4000-8000-000000006003';
const permissions = ['comparecientes.read', 'comparecientes.write', 'compliance.read', 'compliance.write', 'compliance.review', 'compliance.sensitive.read', 'documentos.write', 'compliance.rules.read', 'compliance.rules.manage'];
const actor: any = { id: actorId, email: 'h3-service@example.invalid', nombre: 'H3', apellido: 'Synthetic', rol: 'ADMINISTRACION', sessionId: 'h3', organizationId, membershipId: '00000000-0000-4000-8000-000000006004', scope: 'GLOBAL', permissions, requiresPasswordChange: false };

const baseQuery = (overrides: any = {}) => ({
  id: '00000000-0000-4000-8000-000000006005', organization_id: organizationId, compareciente_id: comparecienteId,
  query_kind: 'MASTER', contract_version: 'CUM-LST-001', execution_state: 'SUCCEEDED', created_at: new Date('2026-09-01T10:00:00Z'),
  query_snapshot: { primary_name: 'PERSONA SINTETICA' }, sourceExecutions: [], candidates: [], reports: [], operationSnapshots: [], ...overrides,
});

const access = { compareciente: { findFirst: vi.fn().mockResolvedValue({ id: comparecienteId }) } };

describe('CUM-LST-001 · servicio canónico', () => {
  it('01 deriva current de la Query más reciente sin mutar historia', async () => {
    const q2 = baseQuery({ id: 'q2', created_at: new Date('2026-09-01T12:00:00Z') });
    const q1 = baseQuery({ id: 'q1', created_at: new Date('2026-09-01T11:00:00Z'), execution_state: 'ERROR' });
    const db: any = { ...access, complianceScreeningResult: { findMany: vi.fn().mockResolvedValue([q2, q1]) } };
    const result = await new ComplianceScreeningService(db).current(actor, comparecienteId);
    expect(result.current.id).toBe('q2'); expect(result.history.map((query: any) => query.id)).toEqual(['q2', 'q1']);
    expect(result.history[1].human_status).toBe('No fue posible completar la consulta');
  });

  it.each([
    ['NOT_CONFIGURED', [], 'Fuente no configurada'],
    ['ERROR', [], 'No fue posible completar la consulta'],
    ['RUNNING', [], 'Consulta en proceso'],
    ['SUCCEEDED', [], 'Sin posibles coincidencias'],
  ])('02-05 presenta %s sin convertir fallos en resultado limpio', async (state, candidates, label) => {
    const query = baseQuery({ execution_state: state, candidates });
    const db: any = { ...access, complianceScreeningResult: { findMany: vi.fn().mockResolvedValue([query]) } };
    const result = await new ComplianceScreeningService(db).current(actor, comparecienteId);
    expect(result.current.human_status).toBe(label);
  });

  it('06 conserva tres decisiones humanas como estados de presentación distintos', async () => {
    const statuses = ['NO_CORRESPONDE', 'REVISION_ADICIONAL', 'COINCIDENCIA_CONFIRMADA'];
    const labels: string[] = [];
    for (const decision of statuses) {
      const query = baseQuery({ candidates: [{ resolutions: [{ decision }] }] });
      const db: any = { ...access, complianceScreeningResult: { findMany: vi.fn().mockResolvedValue([query]) } };
      labels.push((await new ComplianceScreeningService(db).current(actor, comparecienteId)).current.human_status);
    }
    expect(labels).toEqual(['No corresponde', 'Posible coincidencia · revisión adicional', 'Coincidencia confirmada']);
  });

  it('07 consulta FREE persiste sólo Query/evidencia y ownership del actor', async () => {
    let created: any;
    const db: any = {
      $transaction: vi.fn(async (callback: any) => callback(db)), $executeRawUnsafe: vi.fn(),
      screeningSource: { findMany: vi.fn().mockResolvedValue([]) }, screeningSourceExecution: { create: vi.fn() }, auditLog: { create: vi.fn() },
      complianceScreeningResult: {
        findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(created && (!where.owner_user_id || where.owner_user_id === created.owner_user_id) ? created : null)),
        create: vi.fn().mockImplementation(({ data }: any) => { created = { id: 'free-q1', created_at: new Date(), sourceExecutions: [], candidates: [], reports: [], operationSnapshots: [], ...data }; return Promise.resolve(created); }),
        update: vi.fn().mockImplementation(({ data }: any) => { Object.assign(created, data); return Promise.resolve(created); }),
      },
      compareciente: { create: vi.fn() }, expediente: { create: vi.fn() },
    };
    const identity: any = { tipo_persona: 'FISICA', primary_name: 'PERSONA LIBRE SINTETICA', aliases: [], birth_date: null, birth_place: null, birth_country: null, nationality: null, curp: null, rfc: null, identification: null, incorporation_date: null, commercial_name: null, commercial_folio: null, corporate_type: null };
    const result = await new ComplianceScreeningService(db).freeSearch(actor, identity, 'free-1');
    expect(result).toMatchObject({ id: 'free-q1', query_kind: 'FREE', owner_user_id: actorId, execution_state: 'NOT_CONFIGURED' });
    expect(result.compareciente_id).toBeUndefined();
    expect(db.compareciente.create).not.toHaveBeenCalled(); expect(db.expediente.create).not.toHaveBeenCalled();
  });

  it('08 no activa una SourceVersion cuando el adapter real no está configurado', async () => {
    const db: any = { screeningSourceVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'v1', organization_id: organizationId, source_id: 's1', status: 'DRAFT', adapter_key: 'OFFICIAL_NOT_CONFIGURED', source: {} }) } };
    await expect(new ComplianceScreeningService(db).activateSourceVersion(actor, 's1', 'v1')).rejects.toMatchObject<Partial<ScreeningError>>({ status: 409, code: 'SCREENING_PROVIDER_NOT_CONFIGURED' });
  });
});
