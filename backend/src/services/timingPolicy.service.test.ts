import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Request } from 'express';
import { TimingCalculationStatus, TimingPolicyType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  timingPolicyRevision: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock('../config/prisma', () => ({ default: database }));

import { calculateTimingReadModel, TIMING_POLICY_DEFINITIONS, timingPolicyService } from './timingPolicy.service';

type Actor = NonNullable<Request['user']>;
const actor = (organizationId = '10000000-0000-4000-8000-000000000001', permissions = ['configuracion.catalogos.read', 'configuracion.actos_tiempos.manage']): Actor => ({
  id: '20000000-0000-4000-8000-000000000001', organizationId, membershipId: '30000000-0000-4000-8000-000000000001', sessionId: '40000000-0000-4000-8000-000000000001',
  rol: 'ADMINISTRACION', nombre: 'Admin', apellido: 'Prueba', email: 'admin@example.test', scope: 'GLOBAL', requiresPasswordChange: false, permissions,
});
const revision = (value = 1) => ({
  id: `50000000-0000-4000-8000-00000000000${value}`, organization_id: actor().organizationId, domain: 'COMMERCIAL', policy_type: TimingPolicyType.PROSPECT_INFO_COLLECTION,
  revision: value, duration: value === 1 ? 24 : 48, unit: 'HOURS', calendar_semantics: 'ELAPSED_UTC', provenance: { source: 'Acuerdo interno' }, created_by_id: actor().id,
  created_at: new Date('2026-08-31T12:00:00Z'), published_at: new Date('2026-08-31T12:00:00Z'), superseded_at: null, idempotency_key: `key-${value}`, payload_hash: 'a'.repeat(64),
});

describe('G0-C · políticas temporales cerradas y versionadas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.$transaction.mockImplementation(async (callback: (tx: typeof database) => unknown) => callback(database));
  });

  it('expone exactamente tres políticas comerciales y dos administrativas', () => {
    expect(TIMING_POLICY_DEFINITIONS).toHaveLength(5);
    expect(TIMING_POLICY_DEFINITIONS.filter((item) => item.domain === 'COMMERCIAL')).toHaveLength(3);
    expect(TIMING_POLICY_DEFINITIONS.filter((item) => item.domain === 'ADMINISTRATIVE')).toHaveLength(2);
    expect(new Set(TIMING_POLICY_DEFINITIONS.map((item) => item.type)).size).toBe(5);
  });

  it('organización sin políticas permanece válida y no recibe defaults', async () => {
    database.timingPolicyRevision.findMany.mockResolvedValue([]);
    const result = await timingPolicyService.list(actor());
    expect(result).toHaveLength(5);
    expect(result.every((item) => item.status === 'NOT_CONFIGURED' && item.current === null && item.history.length === 0)).toBe(true);
  });

  it('lectura y publicación respetan RBAC', async () => {
    await expect(timingPolicyService.list(actor(actor().organizationId, []))).rejects.toMatchObject({ status: 403 });
    await expect(timingPolicyService.publish(actor(actor().organizationId, ['configuracion.catalogos.read']), {})).rejects.toMatchObject({ status: 403 });
  });

  it('deriva organization del actor y rechaza mass assignment', async () => {
    await expect(timingPolicyService.publish(actor(), {
      organizationId: '10000000-0000-4000-8000-000000000099', policyType: TimingPolicyType.PROSPECT_INFO_COLLECTION,
      duration: 24, unit: 'HOURS', calendarSemantics: 'ELAPSED_UTC', provenance: 'Acuerdo', idempotencyKey: 'key',
    })).rejects.toMatchObject({ code: 'TIMING_POLICY_FIELDS_INVALID' });
  });

  it('no permite policy incompleta, duración cero ni semántica inventada', async () => {
    const base = { policyType: TimingPolicyType.PROSPECT_INFO_COLLECTION, duration: 24, unit: 'HOURS', calendarSemantics: 'ELAPSED_UTC', provenance: 'Acuerdo', idempotencyKey: 'key' };
    await expect(timingPolicyService.publish(actor(), { ...base, duration: 0 })).rejects.toMatchObject({ code: 'TIMING_POLICY_DURATION_INVALID' });
    await expect(timingPolicyService.publish(actor(), { ...base, calendarSemantics: 'BUSINESS_DAYS' })).rejects.toMatchObject({ code: 'TIMING_POLICY_CALENDAR_INVALID' });
    await expect(timingPolicyService.publish(actor(), { ...base, provenance: '' })).rejects.toMatchObject({ code: 'TIMING_POLICY_PROVENANCE_REQUIRED' });
  });

  it('publica primera revisión, con tenant, actor y doble auditoría canónica', async () => {
    const created = revision(1);
    database.timingPolicyRevision.findFirst.mockResolvedValue(null);
    database.timingPolicyRevision.create.mockResolvedValue(created);
    const result = await timingPolicyService.publish(actor(), {
      policyType: TimingPolicyType.PROSPECT_INFO_COLLECTION, duration: 24, unit: 'HOURS', calendarSemantics: 'ELAPSED_UTC', provenance: 'Acuerdo interno', idempotencyKey: 'key-1',
    });
    expect(result).toMatchObject({ idempotent: false, revision: { revision: 1, duration: 24 } });
    expect(database.timingPolicyRevision.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: actor().organizationId, created_by_id: actor().id, revision: 1 }) }));
    expect(database.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it('retry idéntico devuelve la revisión sin crearla ni auditarla otra vez', async () => {
    const payload = { policyType: TimingPolicyType.PROSPECT_INFO_COLLECTION, domain: 'COMMERCIAL', duration: 24, unit: 'HOURS', calendarSemantics: 'ELAPSED_UTC', provenance: 'Acuerdo interno' };
    const existing = { ...revision(1), payload_hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
    database.timingPolicyRevision.findFirst.mockResolvedValue(existing);
    const result = await timingPolicyService.publish(actor(), {
      policyType: TimingPolicyType.PROSPECT_INFO_COLLECTION, duration: 24, unit: 'HOURS', calendarSemantics: 'ELAPSED_UTC', provenance: 'Acuerdo interno', idempotencyKey: 'key-1',
    });
    expect(result.idempotent).toBe(true);
    expect(database.timingPolicyRevision.create).not.toHaveBeenCalled();
    expect(database.auditLog.create).not.toHaveBeenCalled();
  });

  it('publicación nueva sustituye current y crea la revisión consecutiva', async () => {
    const old = revision(1); const next = { ...revision(2), domain: old.domain, policy_type: old.policy_type };
    database.timingPolicyRevision.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(old);
    database.timingPolicyRevision.create.mockResolvedValue(next);
    const result = await timingPolicyService.publish(actor(), {
      policyType: TimingPolicyType.PROSPECT_INFO_COLLECTION, duration: 48, unit: 'HOURS', calendarSemantics: 'ELAPSED_UTC', provenance: 'Nuevo acuerdo', idempotencyKey: 'key-2',
    });
    expect(database.timingPolicyRevision.update).toHaveBeenCalledWith({ where: { id: old.id }, data: { superseded_at: expect.any(Date) } });
    expect(result.revision?.revision).toBe(2);
  });
});

describe('G0-C · cálculo determinista con reloj controlado', () => {
  const openedAt = new Date('2026-08-31T00:00:00Z');
  const interval = (calculation_status = TimingCalculationStatus.CALCULABLE, closed_at: Date | null = null) => ({
    calculation_status, opened_at: openedAt, closed_at, provenance: { source: 'TEST' },
  });
  const policy = { ...revision(1), duration: 24, unit: 'HOURS', calendar_semantics: 'ELAPSED_UTC' };

  it('antes de dueAt no está vencido y no sufre drift de zona horaria', () => {
    const result = calculateTimingReadModel(TimingPolicyType.PROSPECT_INFO_COLLECTION, 'source', interval(), policy, new Date('2026-08-31T23:59:59Z'));
    expect(result).toMatchObject({ calculationStatus: 'CALCULABLE', overdue: false });
    expect(result.dueAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('después de dueAt está vencido', () => {
    expect(calculateTimingReadModel(TimingPolicyType.PROSPECT_INFO_COLLECTION, 'source', interval(), policy, new Date('2026-09-01T00:00:00.001Z')).overdue).toBe(true);
  });

  it('cerrado deja de ser vencido sin perder dueAt', () => {
    const result = calculateTimingReadModel(TimingPolicyType.PROSPECT_INFO_COLLECTION, 'source', interval('CALCULABLE', new Date('2026-08-31T12:00:00Z')), policy, new Date('2026-09-02T00:00:00Z'));
    expect(result).toMatchObject({ overdue: false, closedAt: new Date('2026-08-31T12:00:00Z') });
    expect(result.dueAt).not.toBeNull();
  });

  it.each([TimingCalculationStatus.NOT_CONFIGURED, TimingCalculationStatus.UNKNOWN_LEGACY, TimingCalculationStatus.NOT_APPLICABLE])('%s conserva overdue y dueAt nulos', (status) => {
    const result = calculateTimingReadModel(TimingPolicyType.PROSPECT_INFO_COLLECTION, 'source', interval(status), null, new Date('2026-09-10T00:00:00Z'));
    expect(result).toMatchObject({ calculationStatus: status, dueAt: null, overdue: null });
  });
});

describe('G0-C · contrato de persistencia e integración', () => {
  const root = resolve(process.cwd(), '..');
  const schema = readFileSync(resolve(root, 'backend/prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(resolve(root, 'backend/prisma/migrations/20260831040000_create_g0c_configurable_timing_policies/migration.sql'), 'utf8');
  const prospect = readFileSync(resolve(root, 'backend/src/services/prospectWorkflow.service.ts'), 'utf8');
  const finance = readFileSync(resolve(root, 'backend/src/services/expedienteFinance.service.ts'), 'utf8');

  it('migración es aditiva, posterior a G0-B y no contiene seeds/backfill temporal', () => {
    expect(migration).not.toMatch(/INSERT INTO\s+"timing_policy_revisions"/i);
    expect(migration).not.toMatch(/INSERT INTO\s+"timing_intervals"/i);
    expect(migration).not.toMatch(/UPDATE\s+"(?:prospectos|cotizaciones|expedientes|expediente_solicitudes_pago|expediente_ingresos_reportados)"/i);
    expect(migration).not.toContain('20260831030000_create_cot001_source_prerequisites');
  });

  it('DB impide dos current, referencias cross-tenant y borrado de revisiones', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "uq_timing_policy_current"');
    expect(migration).toContain('FOREIGN KEY ("policy_revision_id", "organization_id", "policy_type")');
    expect(migration).toContain('G0C_USED_POLICY_REVISION_DELETE_BLOCKED');
    expect(migration).toContain('G0C_POLICY_REVISION_IMMUTABLE');
    expect(migration).toContain("payment.pagado_at IS DISTINCT FROM NEW.closed_at");
    expect(migration).toContain("payment.anulado_at IS DISTINCT FROM NEW.closed_at");
    expect(migration).toContain("receipt.aplicado_at IS DISTINCT FROM NEW.closed_at");
    expect(migration).toContain("receipt.anulado_at IS DISTINCT FROM NEW.closed_at");
    expect(migration).toContain('CREATE TRIGGER g0c_interval_fact_integrity AFTER INSERT OR UPDATE');
    expect(migration).not.toContain('DEFERRABLE INITIALLY DEFERRED');
  });

  it('snapshot y business fact se ejecutan dentro de las transacciones canónicas', () => {
    expect(prospect).toContain('applyProspectTimingTransition(tx, actor.organizationId');
    expect(finance).toContain('openPaymentRequestTiming(tx, actor.organizationId');
    expect(finance).toContain('openReceiptApplicationTiming(tx, actor.organizationId');
    expect(finance).toContain('closePaymentRequestTiming(tx, actor.organizationId');
    expect(finance).toContain('closeReceiptApplicationTiming(tx, actor.organizationId');
  });

  it('fecha_limite y ACEPTO_ANTICIPO no son fuentes temporales administrativas', () => {
    expect(finance).not.toMatch(/openPaymentRequestTiming\([^\n]*fecha_limite/);
    expect(finance).not.toMatch(/openReceiptApplicationTiming\([^\n]*fecha_limite/);
    expect(`${schema}\n${migration}`).not.toContain('QUOTE_CLIENT_WAIT_POLICY');
    expect(`${schema}\n${migration}`).not.toContain('QUOTE_DRAFT_SEND_POLICY');
  });
});
