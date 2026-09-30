import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  tipoActo: { findFirst: vi.fn() },
  catalogoArtefactoVersion: { findFirst: vi.fn() },
  projectTemplateAssignment: { findUnique: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../config/prisma', () => ({ default: db }));

import { projectTemplateAssignmentService } from './projectTemplateAssignment.service';

const actor: any = { id: '10000000-0000-4000-8000-000000000001', organizationId: '20000000-0000-4000-8000-000000000001', sessionId: 'session' };
const input = { actId: '30000000-0000-4000-8000-000000000001', artifactId: '40000000-0000-4000-8000-000000000001', versionId: '50000000-0000-4000-8000-000000000001' };

describe('asignación estructurada de machote Project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.tipoActo.findFirst.mockResolvedValue({ id: input.actId, nombre: 'Compraventa A' });
    db.catalogoArtefactoVersion.findFirst.mockResolvedValue({ id: input.versionId, artefacto_id: input.artifactId, organization_id: actor.organizationId, artifact: {}, artefacto: { id: input.artifactId } });
  });

  it('resuelve sólo por organization + act_id y nunca por nombre', async () => {
    db.projectTemplateAssignment.findUnique.mockResolvedValue({ active: true, artefacto_id: input.artifactId, version_id: input.versionId, artefacto: { activo: true }, version: { activa: true, storage_key: 'private/template.docx', artefacto_id: input.artifactId, organization_id: actor.organizationId }, tipoActo: { id: input.actId, nombre: 'Nombre similar' } });
    await expect(projectTemplateAssignmentService.resolve(actor, input.actId)).resolves.toMatchObject({ version_id: input.versionId });
    expect(db.projectTemplateAssignment.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { organization_id_tipo_acto_id: { organization_id: actor.organizationId, tipo_acto_id: input.actId } } }));
  });

  it('rechaza asignación inexistente sin fallback genérico', async () => {
    db.projectTemplateAssignment.findUnique.mockResolvedValue(null);
    await expect(projectTemplateAssignmentService.resolve(actor, input.actId)).rejects.toMatchObject({ code: 'PROJECT_TEMPLATE_NOT_CONFIGURED', status: 409 });
  });

  it('obliga a elegir Cancelar o Reemplazar cuando ya existe otro machote', async () => {
    const tx: any = { $executeRaw: vi.fn(), projectTemplateAssignment: { findUnique: vi.fn().mockResolvedValue({ id: 'old', active: true, artefacto_id: 'old-artifact', version_id: 'old-version', artefacto: { nombre: 'Machote anterior' }, version: { version: 3 } }) } };
    db.$transaction.mockImplementation((callback: any) => callback(tx));
    await expect(projectTemplateAssignmentService.assign(actor, input)).rejects.toMatchObject({ code: 'PROJECT_TEMPLATE_CONFLICT', status: 409 });
  });

  it('reemplaza atómicamente y conserva auditoría cuando se autoriza', async () => {
    const tx: any = {
      $executeRaw: vi.fn(),
      projectTemplateAssignment: {
        findUnique: vi.fn().mockResolvedValue({ id: 'old', active: true, artefacto_id: 'old-artifact', version_id: 'old-version', artefacto: { nombre: 'Machote anterior' }, version: { version: 3 } }),
        upsert: vi.fn().mockResolvedValue({ id: 'assignment-1', ...input }),
      },
      catalogoArtefactoActo: { upsert: vi.fn() }, catalogoArtefactoDestino: { upsert: vi.fn() }, auditLog: { create: vi.fn() },
    };
    db.$transaction.mockImplementation((callback: any) => callback(tx));
    const result = await projectTemplateAssignmentService.assign(actor, { ...input, replace: true });
    expect(result).toMatchObject({ replaced: true, idempotent: false });
    expect(tx.projectTemplateAssignment.upsert).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'PROJECT_TEMPLATE_ASSIGNMENT_REPLACED' }) });
  });
});
