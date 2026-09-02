import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithActorContext } from '../auth/actorContext';
import { ComparecienteService } from './compareciente.service';
import { ComplianceDocumentService } from './complianceDocument.service';

vi.mock('./supabase.service', () => ({ uploadFile: vi.fn().mockResolvedValue(undefined), deleteFile: vi.fn().mockResolvedValue(undefined) }));

const organizationId = '10000000-0000-4000-8000-000000000001';
const otherOrganizationId = '20000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const comparecienteId = '10000000-0000-4000-8000-000000000003';
const otherComparecienteId = '10000000-0000-4000-8000-000000000009';

const actorContext = {
  userId: actorId, organizationId, membershipId: '10000000-0000-4000-8000-000000000004',
  role: 'DIRECCION' as const, permissions: [], scope: 'GLOBAL' as const, sessionId: 'session-h2-post-upload',
};

type RequirementInput = { id: string; organizationId?: string; comparecienteId?: string; expectedType?: string; requiresSigned?: boolean; requiresHuman?: boolean; authorized?: boolean };

function fixture(inputs: RequirementInput[]) {
  let document: any;
  let link: any;
  let auditSequence = 0;
  const evidence: any[] = [];
  const requirements = inputs.map((input) => ({
    id: input.id, organization_id: input.organizationId || organizationId,
    expediente_id: `expediente-${input.id}`, review_id: `review-${input.id}`, state_id: `state-${input.id}`,
    target_compareciente_id: input.comparecienteId || comparecienteId, is_documental: true, status: 'PENDIENTE',
    requires_signed_document: Boolean(input.requiresSigned), requires_human_validation: input.requiresHuman !== false,
    source_snapshot: { definition: { source: 'COMPARECIENTE', expected_document_type: input.expectedType || 'IDENTIFICACION' } },
    state: { current_review_id: `review-${input.id}` }, evidence: [] as any[],
    created_at: new Date('2026-09-01T00:00:00.000Z'), deadline: null, authorized: input.authorized !== false,
  }));

  const tx: any = {
    documento: { create: vi.fn().mockImplementation(({ data }) => {
      document = {
        id: 'document-1', organization_id: organizationId, storage_key: data.storage_key,
        size_bytes: data.size_bytes, fecha_carga: new Date('2026-09-01T00:00:00.000Z'), mime_type: data.mime_type,
        checksum_sha256: null, tipo: data.tipo, estatus: data.estatus,
      };
      return document;
    }) },
    comparecienteDocumento: {
      create: vi.fn().mockImplementation(({ data }) => { link = { id: 'link-1', organization_id: organizationId, ...data }; return link; }),
      findFirst: vi.fn().mockImplementation(({ where }) => !link || !document ? null
        : where.organization_id === organizationId && where.compareciente_id === link.compareciente_id && where.documento_id === document.id
          ? { ...link, documento: document } : null),
    },
    complianceRequirement: {
      findMany: vi.fn().mockImplementation(({ where }) => {
        if (where.state_id) return requirements
          .filter((item) => item.organization_id === where.organization_id && item.state_id === where.state_id && item.review_id === where.review_id)
          .map((item) => ({ status: item.status, deadline: item.deadline }));
        return requirements.filter((item) => item.organization_id === where.organization_id
          && item.target_compareciente_id === where.target_compareciente_id && item.authorized
          && !['CUMPLIDO', 'NO_APLICA'].includes(item.status));
      }),
      findFirst: vi.fn().mockImplementation(({ where }) => {
        const item = requirements.find((candidate) => candidate.id === where.id && candidate.organization_id === where.organization_id);
        return item ? { ...item, evidence: evidence.filter((row) => row.requirement_id === item.id && row.estatus === 'ACTIVO') } : null;
      }),
      update: vi.fn().mockImplementation(({ where, data }) => { const item = requirements.find((candidate) => candidate.id === where.id)!; Object.assign(item, data); return item; }),
    },
    complianceEvidence: {
      createMany: vi.fn().mockImplementation(({ data }) => {
        let count = 0;
        for (const row of data) {
          const duplicate = evidence.some((item) => item.organization_id === row.organization_id && item.requirement_id === row.requirement_id
            && item.documento_id === row.documento_id && item.document_version === row.document_version && item.estatus === 'ACTIVO');
          if (!duplicate) { evidence.push({ id: `evidence-${evidence.length + 1}`, estatus: 'ACTIVO', ...row }); count += 1; }
        }
        return { count };
      }),
      findFirst: vi.fn().mockImplementation(({ where }) => evidence.find((item) => item.organization_id === where.organization_id
        && item.requirement_id === where.requirement_id && item.documento_id === where.documento_id
        && item.document_version === where.document_version && item.estatus === where.estatus) || null),
      findMany: vi.fn().mockImplementation(({ where }) => evidence.filter((item) => item.organization_id === where.organization_id
        && item.requirement_id === where.requirement_id && item.estatus === where.estatus)),
    },
    expedienteComplianceState: { update: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockImplementation(() => ({ id: `audit-${++auditSequence}` })) },
  };
  const prisma: any = {
    compareciente: { findFirst: vi.fn().mockImplementation(({ where }) => ({ id: where.id })) },
    user: { findFirst: vi.fn().mockResolvedValue({ id: actorId }) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { tx, prisma, evidence, requirements };
}

async function canonicalUpload(prisma: any, targetComparecienteId = comparecienteId) {
  const service = new ComparecienteService(prisma);
  return runWithActorContext(actorContext, () => service.agregarDocumentoMaster({
    comparecienteId: targetComparecienteId, userId: actorId, buffer: Buffer.from('pdf-bytes'),
    fileName: 'identificacion.pdf', mimeType: 'application/pdf', categoria: 'IDENTIFICACION',
  }));
}

describe('H2 post-upload Compareciente evidence synchronization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('links an existing requirement through the canonical upload path without a manual sync call', async () => {
    const state = fixture([{ id: 'q1' }]);
    expect(state.evidence).toHaveLength(0);
    await canonicalUpload(state.prisma);
    expect(state.evidence).toHaveLength(1);
    expect(state.requirements[0].status).toBe('EN_PROCESO');
    expect(state.evidence[0]).toMatchObject({
      requirement_id: 'q1', target_compareciente_id: comparecienteId, source: 'COMPARECIENTE',
      document_state: 'CANONICAL', validation_status: 'AUTO_LINKED',
    });
    expect(state.evidence[0]).not.toHaveProperty('validated_by_id');
    expect(state.evidence[0]).not.toHaveProperty('validated_at');
    expect(state.tx.auditLog.create.mock.calls.map(([call]: any[]) => call.data.accion)).toContain('AUTO_LINK_COMPLIANCE_DOCUMENT_EVIDENCE');
  });

  it('keeps DB-backed identity idempotent when the public internal sync is retried', async () => {
    const state = fixture([{ id: 'q1' }]);
    await canonicalUpload(state.prisma);
    const version = state.evidence[0].document_version;
    const auditCount = state.tx.auditLog.create.mock.calls.length;
    await ComplianceDocumentService.syncEligibleComparecienteEvidenceTx(state.tx, {
      id: actorId, organizationId, rol: 'DIRECCION', sessionId: actorContext.sessionId,
    }, { comparecienteId, documentId: 'document-1' });
    expect(state.evidence).toHaveLength(1);
    expect(state.evidence[0].document_version).toBe(version);
    expect(state.tx.auditLog.create).toHaveBeenCalledTimes(auditCount);
  });

  it('links one canonical document to every eligible requirement without duplicating bytes', async () => {
    const state = fixture([{ id: 'q1' }, { id: 'q2' }]);
    await canonicalUpload(state.prisma);
    expect(state.evidence.map((item) => item.requirement_id)).toEqual(['q1', 'q2']);
    expect(state.tx.documento.create).toHaveBeenCalledTimes(1);
  });

  it('does not cross Compareciente, tenant, or unauthorized expediente scope', async () => {
    const state = fixture([
      { id: 'wrong-party', comparecienteId },
      { id: 'wrong-tenant', organizationId: otherOrganizationId, comparecienteId: otherComparecienteId },
      { id: 'unauthorized-case', comparecienteId: otherComparecienteId, authorized: false },
    ]);
    await canonicalUpload(state.prisma, otherComparecienteId);
    expect(state.evidence).toHaveLength(0);
    const scope = state.tx.complianceRequirement.findMany.mock.calls[0][0].where;
    expect(scope).toMatchObject({
      organization_id: organizationId, target_compareciente_id: otherComparecienteId,
      expediente: { comparecientes: { some: { organization_id: organizationId, compareciente_id: otherComparecienteId, estatus: 'ACTIVO' } } },
    });
  });

  it('auto-links an unsigned candidate without satisfying or human-validating a signed requirement', async () => {
    const state = fixture([{ id: 'signed', requiresSigned: true, requiresHuman: true }]);
    await canonicalUpload(state.prisma);
    expect(state.evidence).toHaveLength(1);
    expect(state.evidence[0].document_state).toBe('CANONICAL');
    expect(state.evidence[0].validation_status).toBe('AUTO_LINKED');
    expect(state.requirements[0].status).toBe('EN_PROCESO');
  });
});
