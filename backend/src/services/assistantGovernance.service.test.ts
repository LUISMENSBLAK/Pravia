import { describe, expect, it, vi } from 'vitest';
import { AssistantAlertError, AssistantAlertService } from './assistantAlert.service';
import { AssistantMemoryError, AssistantMemoryService } from './assistantMemory.service';
import { KnowledgeRadarError, KnowledgeRadarService } from './knowledgeRadar.service';

const actor = { id: 'user-1', organizationId: 'org-1' };

describe('aprendizaje controlado PRAVIA IA 3.0', () => {
  it.each(['LEGAL', 'FISCAL', 'CUMPLIMIENTO', 'FINANZAS', 'RBAC', 'PLAZO', 'NORMATIVA'])('nunca autoaprueba la categoría %s', async (category) => {
    const created = { id: `memory-${category}`, approval_status: 'PENDING_REVIEW' };
    const tx: any = { memoriaDespacho: { create: vi.fn().mockResolvedValue(created) }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
    const db: any = { $transaction: vi.fn(async (fn) => fn(tx)) };
    const result = await new AssistantMemoryService(db).propose(actor, { category, content: 'Criterio propuesto', scope_type: 'ORGANIZATION', automatic: true });
    expect(result.requires_human_approval).toBe(true);
    expect(tx.memoriaDespacho.create.mock.calls[0][0].data).toMatchObject({ organization_id: 'org-1', approval_status: 'PENDING_REVIEW', approved_by_id: null });
  });

  it('permite preferencia visual automática sólo dentro del usuario y tenant', async () => {
    const tx: any = { memoriaDespacho: { create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'memory-1', ...data })) }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
    const result = await new AssistantMemoryService({ $transaction: vi.fn(async (fn) => fn(tx)) } as any).propose(actor, { category: 'PREFERENCIA', content: 'Vista compacta', scope_type: 'PERSONAL', automatic: true });
    expect(result).toMatchObject({ approval_status: 'APPROVED', organization_id: 'org-1', user_id: 'user-1', last_confirmed_at: expect.any(Date), requires_human_approval: false });
  });

  it('reutiliza exclusivamente memorias aprobadas del usuario o de su Notaría', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'memory-approved', organization_id: 'org-1', approval_status: 'APPROVED' }]);
    const result = await new AssistantMemoryService({ memoriaDespacho: { findMany } } as any).list(actor, { category: 'PREFERENCIA' });
    expect(result).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      organization_id: 'org-1', active: true, approval_status: 'APPROVED', categoria: 'PREFERENCIA',
      OR: [{ user_id: null }, { user_id: 'user-1' }],
    }) }));
  });

  it('aprueba una regla sugerida con confirmación, auditoría y fecha de última confirmación', async () => {
    const current = { id: 'memory-1', organization_id: 'org-1', active: true, last_confirmed_at: null };
    const tx: any = {
      memoriaDespacho: { update: vi.fn().mockImplementation(async ({ data }) => ({ ...current, ...data })) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db: any = {
      memoriaDespacho: { findFirst: vi.fn().mockResolvedValue(current) },
      $transaction: vi.fn(async (fn) => fn(tx)),
    };
    const result = await new AssistantMemoryService(db).decide(actor, current.id, true);
    expect(result).toMatchObject({ approval_status: 'APPROVED', approved_by_id: 'user-1', last_confirmed_at: expect.any(Date), active: true });
    expect(db.memoriaDespacho.findFirst).toHaveBeenCalledWith({ where: { id: current.id, organization_id: 'org-1', active: true } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'AI_MEMORY_APPROVED', organization_id: 'org-1' }) }));
  });

  it('rechaza alcances arbitrarios', async () => {
    await expect(new AssistantMemoryService({} as any).propose(actor, { category: 'PREFERENCIA', content: 'x', scope_type: 'GLOBAL_SUPERUSER' }))
      .rejects.toMatchObject<Partial<AssistantMemoryError>>({ code: 'AI_MEMORY_INVALID' });
  });
});

describe('radar normativo versionado', () => {
  it('no crea versión cuando el hash no cambió', async () => {
    const content = 'Artículo 1. Texto vigente.';
    const crypto = await import('node:crypto');
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    const db: any = { knowledgeSource: { findFirst: vi.fn().mockResolvedValue({ id: 'source-1', source_url: 'https://oficial.test', active: true, versions: [{ id: 'v1', version: 1, checksum_sha256: checksum }] }) } };
    const result = await new KnowledgeRadarService(db).detect(actor, 'source-1', { content_text: content, source_url: 'https://oficial.test' });
    expect(result).toMatchObject({ changed: false, run: null });
  });

  it('crea una nueva versión pendiente, con procedencia, sin activar ni sobrescribir la anterior', async () => {
    const tx: any = {
      knowledgeSourceVersion: { create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'v2', ...data })) },
      knowledgeArticle: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      knowledgeRadarRun: { create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'run-1', ...data })) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db: any = {
      knowledgeSource: { findFirst: vi.fn().mockResolvedValue({ id: 'source-1', source_url: 'https://oficial.test', active: true, versions: [{ id: 'v1', version: 1, checksum_sha256: 'old' }] }) },
      $transaction: vi.fn(async (fn) => fn(tx)),
    };
    const result = await new KnowledgeRadarService(db).detect(actor, 'source-1', { content_text: 'Artículo 1. Texto reformado.', source_url: 'https://oficial.test', legal_status: 'PENDIENTE_VERIFICAR' });
    expect(result.changed).toBe(true);
    expect(tx.knowledgeSourceVersion.create.mock.calls[0][0].data).toMatchObject({ organization_id: 'org-1', version: 2, verification_status: 'PENDIENTE', review_required: true, legal_status: 'PENDIENTE_VERIFICAR', provenance: expect.objectContaining({ autoactivated: false }) });
    expect(tx.knowledgeSourceVersion.update).toBeUndefined();
  });

  it('rechaza fuentes ajenas al tenant y estados jurídicos inventados', async () => {
    const missing = new KnowledgeRadarService({ knowledgeSource: { findFirst: vi.fn().mockResolvedValue(null) } } as any);
    await expect(missing.detect(actor, 'foreign', { content_text: 'texto', source_url: 'https://oficial.test' })).rejects.toMatchObject<Partial<KnowledgeRadarError>>({ code: 'KNOW_RADAR_SOURCE_NOT_FOUND' });
    const invalid = new KnowledgeRadarService({ knowledgeSource: { findFirst: vi.fn().mockResolvedValue({ id: 's', source_url: 'x', active: true, versions: [] }) } } as any);
    await expect(invalid.detect(actor, 's', { content_text: 'texto', source_url: 'x', legal_status: 'AUTOACTIVA' })).rejects.toMatchObject<Partial<KnowledgeRadarError>>({ code: 'KNOW_RADAR_INPUT_INVALID' });
  });
});

describe('Action Center determinístico', () => {
  it('deduplica por organización y clave determinística', async () => {
    const db: any = { assistantAlert: { upsert: vi.fn().mockResolvedValue({ id: 'alert-1' }) } };
    await new AssistantAlertService(db).upsert(actor, { key: 'EXP:1:DOCS', sourceType: 'DOCUMENTS', severity: 'IMPORTANT', title: 'Faltan documentos' });
    expect(db.assistantAlert.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { organization_id_deterministic_key: { organization_id: 'org-1', deterministic_key: 'EXP:1:DOCS' } } }));
  });

  it('excluye alertas financieras 5/3/0 del búho por contrato', async () => {
    const db: any = { assistantAlert: { findMany: vi.fn().mockResolvedValue([]) } };
    await new AssistantAlertService(db).list(actor);
    expect(db.assistantAlert.findMany.mock.calls[0][0].where).toMatchObject({ organization_id: 'org-1', NOT: { source_type: 'FINANCE_COLLECTION_5_3_0' } });
  });

  it('requiere fecha futura al posponer y no permite alertas fuera de alcance', async () => {
    const row = { id: 'alert-1', state: 'OPEN' };
    const service = new AssistantAlertService({ assistantAlert: { findFirst: vi.fn().mockResolvedValue(row) } } as any);
    await expect(service.transition(actor, row.id, 'SNOOZE', new Date('2020-01-01'))).rejects.toMatchObject<Partial<AssistantAlertError>>({ code: 'AI_ALERT_SNOOZE_INVALID' });
    const denied = new AssistantAlertService({ assistantAlert: { findFirst: vi.fn().mockResolvedValue(null) } } as any);
    await expect(denied.transition(actor, 'foreign', 'ACKNOWLEDGE')).rejects.toMatchObject<Partial<AssistantAlertError>>({ code: 'AI_ALERT_NOT_FOUND' });
  });
});
