import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const db: any = {
    tipoActo: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    configuracionActo: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    configuracionEtapa: { findFirst: vi.fn(), findMany: vi.fn(), aggregate: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    configuracionActividad: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    configuracionDependencia: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    configuracionExcepcion: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    catalogoInstitucion: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    catalogoCarpeta: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    catalogoArtefacto: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    catalogoArtefactoVersion: { findFirst: vi.fn(), create: vi.fn() },
    catalogoArtefactoActo: { deleteMany: vi.fn(), createMany: vi.fn() },
    catalogoArtefactoRegla: { deleteMany: vi.fn(), createMany: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    notaria: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    caracterCompareciente: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, uploadFile: vi.fn(), deleteFile: vi.fn(), getSignedUrl: vi.fn() };
});

vi.mock('../config/prisma', () => ({ default: mocks.db }));
vi.mock('./supabase.service', () => ({ uploadFile: mocks.uploadFile, deleteFile: mocks.deleteFile, getSignedUrl: mocks.getSignedUrl }));

import { permissionsForRole, roleHasPermission } from '../auth/permissions';
import { requirePermission } from '../middleware/auth.middleware';
import {
  actsAndTimesService,
  catalogActMetrics,
  configurationComplete,
  dependencyGraphHasCycle,
  redactPrivateArtifactData,
  resolveActivityTiming,
  templatesAndFormatsService,
} from './configurationCatalog.service';

const actor = {
  id: '11111111-1111-4111-8111-111111111111', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sessionId: 'session-a', rol: 'DIRECCION', permissions: [],
} as any;

const activity = (patch: Record<string, unknown> = {}) => ({
  id: 'activity-a', duracion_estimada: 15, tipo_dias: 'HABILES', margen_seguridad: 3,
  excepciones: [], ...patch,
});
const artifactFile = { buffer: Buffer.from('archivo'), originalname: 'machote.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 7 } as Express.Multer.File;

const permissionResult = (permissions: any[], required: any) => {
  const req = { user: { permissions } } as any;
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as any;
  const next = vi.fn();
  requirePermission(required)(req, response, next);
  return { response, next };
};

describe('CFG-001 forensic behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(async (callback: any) => callback(mocks.db));
    mocks.db.auditLog.create.mockResolvedValue({ id: 'audit' });
    mocks.deleteFile.mockResolvedValue(undefined);
  });

  it('no considera completa una configuración vacía, inactiva o pendiente de revisión', () => {
    expect(configurationComplete(null)).toBe(false);
    expect(configurationComplete({ activa: true, requiere_revision: false, etapas: [] })).toBe(false);
    expect(configurationComplete({ activa: true, requiere_revision: true, etapas: [{ activa: true, actividades: [{ activa: true, nombre: 'A', duracion_estimada: 0, margen_seguridad: 0, tipo_dias: 'HABILES' }] }] })).toBe(false);
  });

  it('considera completa sólo la configuración revisada con actividad válida en cada etapa activa', () => {
    expect(configurationComplete({ activa: true, requiere_revision: false, etapas: [{ activa: true, actividades: [{ activa: true, nombre: 'A', duracion_estimada: 0, margen_seguridad: 0, tipo_dias: 'NATURALES' }] }, { activa: false, actividades: [] }] })).toBe(true);
  });

  it('calcula los cuatro KPI sin expedientes ni números hardcodeados', () => {
    const data = [
      { complete: true, edited: true, configuration: { requiere_revision: false } },
      { complete: false, edited: false, configuration: { requiere_revision: false } },
      { complete: true, edited: false, configuration: { requiere_revision: true } },
    ];
    expect(catalogActMetrics(data)).toEqual({ total: 3, complete: 2, edited: 1, pending: 2 });
  });

  it('determina editado por revisión funcional y no por updatedAt técnico', async () => {
    const timestamp = new Date('2026-08-25T00:00:00Z');
    mocks.db.tipoActo.findMany.mockResolvedValue([{ id: 'act-a', organization_id: null, nombre: 'Compraventa', descripcion: null, activo: true, created_at: timestamp, updated_at: new Date('2026-08-26'), configuracionesOperativas: [{ revision: 1, activa: true, requiere_revision: true, etapas: [], created_at: timestamp, updated_at: new Date('2026-08-26') }] }]);
    const result = await actsAndTimesService.list(actor);
    expect(result.metrics.edited).toBe(0);
  });

  it('acepta paralelismo y bloquea ciclos directos, transitivos y autorreferencias', () => {
    expect(dependencyGraphHasCycle([{ actividad_id: 'C', depende_actividad_id: 'A' }, { actividad_id: 'C', depende_actividad_id: 'B' }, { actividad_id: 'D', depende_actividad_id: 'C' }])).toBe(false);
    expect(dependencyGraphHasCycle([{ actividad_id: 'A', depende_actividad_id: 'B' }, { actividad_id: 'B', depende_actividad_id: 'A' }])).toBe(true);
    expect(dependencyGraphHasCycle([{ actividad_id: 'A', depende_actividad_id: 'B' }, { actividad_id: 'B', depende_actividad_id: 'C' }, { actividad_id: 'C', depende_actividad_id: 'A' }])).toBe(true);
    expect(dependencyGraphHasCycle([{ actividad_id: 'A', depende_actividad_id: 'A' }])).toBe(true);
  });

  it('resuelve general, institución, notaría y jurisdicción e ignora excepciones inactivas', () => {
    const configured = activity({ excepciones: [
      { id: 'inactive', activa: false, selector_tipo: 'INSTITUCION', institucion_id: 'bank-a', duracion: 99, tipo_dias: 'NATURALES', margen_seguridad: 9 },
      { id: 'bank', activa: true, selector_tipo: 'INSTITUCION', institucion_id: 'bank-a', duracion: 3, tipo_dias: 'HABILES', margen_seguridad: 1 },
      { id: 'notary', activa: true, selector_tipo: 'NOTARIA', notaria_id: 'notary-a', duracion: 4, tipo_dias: 'NATURALES', margen_seguridad: 2 },
      { id: 'state', activa: true, selector_tipo: 'JURISDICCION', jurisdiccion: 'Nuevo León', duracion: 5, tipo_dias: 'HABILES', margen_seguridad: 0 },
    ] });
    expect(resolveActivityTiming(configured, {})).toMatchObject({ source: 'GENERAL', duration: 15 });
    expect(resolveActivityTiming(configured, { type: 'INSTITUCION', id: 'bank-a' })).toMatchObject({ source: 'EXCEPTION', duration: 3 });
    expect(resolveActivityTiming(configured, { type: 'NOTARIA', id: 'notary-a' })).toMatchObject({ source: 'EXCEPTION', duration: 4 });
    expect(resolveActivityTiming(configured, { type: 'JURISDICCION', id: 'nuevo leon' })).toMatchObject({ source: 'EXCEPTION', duration: 5 });
    expect(resolveActivityTiming(configured, { type: 'INSTITUCION', id: 'other' })).toMatchObject({ source: 'GENERAL', duration: 15 });
  });

  it('mantiene la resolución a un selector sin inventar precedencia combinada', () => {
    expect(resolveActivityTiming(activity({ excepciones: [{ activa: true, selector_tipo: 'NOTARIA', notaria_id: 'n1', duracion: 2, tipo_dias: 'HABILES', margen_seguridad: 0 }] }), { type: 'INSTITUCION', id: 'b1' })).toMatchObject({ source: 'GENERAL' });
  });

  it('bloquea dependencias adicionales que apuntan a la misma actividad', async () => {
    mocks.db.configuracionActividad.findFirst.mockResolvedValue({ id: 'activity-a', etapa: { configuracion_id: 'config-a' } });
    await expect(actsAndTimesService.createException(actor, 'activity-a', { selector_tipo: 'JURISDICCION', jurisdiccion: 'Nayarit', duracion: 1, tipo_dias: 'HABILES', dependency_ids: ['activity-a'] }))
      .rejects.toMatchObject({ code: 'EXCEPTION_DEPENDENCY_SELF_REFERENCE' });
  });

  it('no permite asignar como responsable por defecto a un usuario ajeno a la organización', async () => {
    mocks.db.configuracionEtapa.findFirst.mockResolvedValue({ id: 'stage-a', configuracion_id: 'config-a' });
    mocks.db.organizationMembership.findFirst.mockResolvedValue(null);
    await expect(actsAndTimesService.createActivity(actor, 'stage-a', { nombre: 'Firma', duracion_estimada: 1, tipo_dias: 'HABILES', responsable_usuario_id: 'user-org-b' }))
      .rejects.toMatchObject({ code: 'DEFAULT_RESPONSIBLE_OUTSIDE_TENANT' });
  });

  it('audita before/after al cambiar duración y margen de una actividad', async () => {
    const before = { id: 'activity-a', nombre: 'Firma', duracion_estimada: 10, margen_seguridad: 1, responsable_rol: null, responsable_usuario_id: null, etapa: { configuracion_id: 'config-a' } };
    const after = { ...before, duracion_estimada: 12, margen_seguridad: 2 };
    mocks.db.configuracionActividad.findFirst.mockResolvedValue(before);
    mocks.db.configuracionActividad.update.mockResolvedValue(after);
    mocks.db.configuracionActo.update.mockResolvedValue({});
    await actsAndTimesService.updateActivity(actor, 'activity-a', { duracion_estimada: 12, margen_seguridad: 2 });
    expect(mocks.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'CFG_ACTIVITY_UPDATED', valores_anteriores: expect.objectContaining({ duracion_estimada: 10, margen_seguridad: 1 }), valores_nuevos: expect.objectContaining({ duracion_estimada: 12, margen_seguridad: 2 }) }) });
  });

  it('audita el conjunto anterior y nuevo de dependencias', async () => {
    mocks.db.configuracionActividad.findFirst.mockResolvedValue({ id: 'C', etapa: { configuracion_id: 'config-a' }, dependencias: [{ depende_actividad_id: 'A' }] });
    mocks.db.configuracionActividad.findMany.mockResolvedValue([{ id: 'A' }, { id: 'B' }]);
    mocks.db.configuracionDependencia.findMany.mockResolvedValue([]);
    mocks.db.configuracionDependencia.deleteMany.mockResolvedValue({ count: 1 });
    mocks.db.configuracionDependencia.createMany.mockResolvedValue({ count: 2 });
    mocks.db.configuracionActo.update.mockResolvedValue({});
    await actsAndTimesService.setDependencies(actor, 'C', { dependency_ids: ['A', 'B'] });
    expect(mocks.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'CFG_DEPENDENCIES_UPDATED', valores_anteriores: ['A'], valores_nuevos: ['A', 'B'] }) });
  });

  it('audita estado y valores before/after de una excepción', async () => {
    const before = { id: 'exception-a', duracion: 5, tipo_dias: 'HABILES', margen_seguridad: 1, activa: true, dependencias_adicionales: [], actividad: { etapa: { configuracion_id: 'config-a' } } };
    const after = { ...before, duracion: 7, activa: false };
    mocks.db.configuracionExcepcion.findFirst.mockResolvedValue(before);
    mocks.db.configuracionExcepcion.update.mockResolvedValue(after);
    mocks.db.configuracionActo.update.mockResolvedValue({});
    await actsAndTimesService.updateException(actor, 'exception-a', { duracion: 7, activa: false });
    expect(mocks.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'CFG_EXCEPTION_UPDATED', valores_anteriores: expect.objectContaining({ duracion: 5, activa: true }), valores_nuevos: expect.objectContaining({ duracion: 7, activa: false }) }) });
  });

  it('un acto nuevo nace con ownership de la organización activa', async () => {
    mocks.db.tipoActo.findFirst.mockResolvedValue(null); mocks.db.tipoActo.findUnique.mockResolvedValue(null);
    mocks.db.tipoActo.create.mockResolvedValue({ id: 'act-new', organization_id: actor.organizationId, nombre: 'Acto privado', descripcion: null, activo: true });
    mocks.db.configuracionActo.create.mockResolvedValue({ id: 'config-new', revision: 1, etapas: [] });
    await actsAndTimesService.create(actor, { nombre: 'Acto privado' });
    expect(mocks.db.tipoActo.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: actor.organizationId }) }));
  });

  it('editar un acto canónico global guarda override tenant y no muta la identidad compartida', async () => {
    mocks.db.tipoActo.findFirst.mockResolvedValue({ id: 'act-global', organization_id: null, nombre: 'Compraventa', descripcion: null, activo: true, configuracionesOperativas: [{ id: 'config-a', revision: 1, activa: true, requiere_revision: true, etapas: [] }] });
    mocks.db.configuracionActo.update.mockResolvedValue({ id: 'config-a', revision: 2 });
    await actsAndTimesService.update(actor, 'act-global', { nombre: 'Compraventa local' });
    expect(mocks.db.tipoActo.update).not.toHaveBeenCalled();
    expect(mocks.db.configuracionActo.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ nombre_personalizado: 'Compraventa local', revision: { increment: 1 } }) }));
  });

  it('el backend RBAC separa lectura de administración en CFG-001 y CFG-002', () => {
    expect(roleHasPermission('CONSULTA', 'configuracion.catalogos.read')).toBe(true);
    expect(roleHasPermission('CONSULTA', 'configuracion.actos_tiempos.manage')).toBe(false);
    expect(roleHasPermission('CONSULTA', 'configuracion.plantillas_formatos.manage')).toBe(false);
    expect(roleHasPermission('ADMINISTRACION', 'configuracion.actos_tiempos.manage')).toBe(true);
    expect(roleHasPermission('ADMINISTRACION', 'configuracion.plantillas_formatos.manage')).toBe(true);
  });

  it('aplica la matriz RBAC real a lectura, alta, edición y desactivación de CFG-001', () => {
    const operations = [
      ['read', 'configuracion.catalogos.read'],
      ['create', 'configuracion.actos_tiempos.manage'],
      ['update', 'configuracion.actos_tiempos.manage'],
      ['disable', 'configuracion.actos_tiempos.manage'],
    ] as const;
    for (const [, permission] of operations) {
      expect(permissionResult(permissionsForRole('DIRECCION'), permission).next).toHaveBeenCalledOnce();
      expect(permissionResult(permissionsForRole('ADMINISTRACION'), permission).next).toHaveBeenCalledOnce();
    }
    expect(permissionResult(permissionsForRole('CONSULTA'), operations[0][1]).next).toHaveBeenCalledOnce();
    for (const [, permission] of operations.slice(1)) {
      const denied = permissionResult(permissionsForRole('CONSULTA'), permission);
      expect(denied.next).not.toHaveBeenCalled();
      expect(denied.response.status).toHaveBeenCalledWith(403);
    }
  });
});

describe('CFG-002 forensic behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(async (callback: any) => callback(mocks.db));
    mocks.db.auditLog.create.mockResolvedValue({ id: 'audit' });
    mocks.deleteFile.mockResolvedValue(undefined);
    mocks.db.notaria.findFirst.mockResolvedValue({ id: 'notary-a', nombre: 'Notaría A' });
    mocks.db.catalogoInstitucion.findFirst.mockResolvedValue({ id: 'bank-a', nombre: 'Banco A', tipo: 'BANCO' });
  });

  it('bloquea Plantilla con propietario banco antes de tocar Storage', async () => {
    await expect(templatesAndFormatsService.createArtifact(actor, { tipo: 'PLANTILLA', propietario_tipo: 'INSTITUCION', institucion_id: 'bank-a' }, artifactFile))
      .rejects.toMatchObject({ code: 'BANK_TEMPLATE_FORBIDDEN' });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it('separa físicamente carpetas de Plantillas y Formatos en cada consulta', async () => {
    mocks.db.catalogoCarpeta.findMany.mockResolvedValue([]); mocks.db.catalogoArtefacto.findMany.mockResolvedValue([]);
    await templatesAndFormatsService.explorer(actor, 'NOTARIA', 'notary-a', 'PLANTILLA');
    expect(mocks.db.catalogoCarpeta.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tipo: 'PLANTILLA', organization_id: actor.organizationId }) }));
    expect(mocks.db.catalogoArtefacto.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tipo: 'PLANTILLA', organization_id: actor.organizationId }) }));
  });

  it('rechaza parent inexistente o de otro tenant/tipo', async () => {
    mocks.db.catalogoCarpeta.findFirst.mockResolvedValue(null);
    await expect(templatesAndFormatsService.createFolder(actor, { propietario_tipo: 'NOTARIA', tipo: 'PLANTILLA', notaria_id: 'notary-a', parent_id: 'folder-org-b', nombre: 'Hijas' }))
      .rejects.toMatchObject({ code: 'FOLDER_OWNER_MISMATCH' });
  });

  it('detecta un ciclo incluso si encuentra datos corruptos durante el breadcrumb', async () => {
    const c = { id: 'c', nombre: 'C', parent_id: 'b', tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: 'notary-a', institucion_id: null };
    const b = { ...c, id: 'b', nombre: 'B', parent_id: 'c' };
    mocks.db.catalogoCarpeta.findFirst.mockResolvedValueOnce(c).mockResolvedValueOnce(c).mockResolvedValueOnce(b).mockResolvedValueOnce(c);
    mocks.db.catalogoCarpeta.findMany.mockResolvedValue([]); mocks.db.catalogoArtefacto.findMany.mockResolvedValue([]);
    await expect(templatesAndFormatsService.explorer(actor, 'NOTARIA', 'notary-a', 'FORMATO', 'c')).rejects.toMatchObject({ code: 'FOLDER_HIERARCHY_CYCLE' });
  });

  it('produce breadcrumb root/A/B/C en orden navegable', async () => {
    const c = { id: 'c', nombre: 'C', parent_id: 'b', tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: 'notary-a', institucion_id: null };
    const b = { ...c, id: 'b', nombre: 'B', parent_id: 'a' }; const a = { ...c, id: 'a', nombre: 'A', parent_id: null };
    mocks.db.catalogoCarpeta.findFirst.mockResolvedValueOnce(c).mockResolvedValueOnce(c).mockResolvedValueOnce(b).mockResolvedValueOnce(a);
    mocks.db.catalogoCarpeta.findMany.mockResolvedValue([]); mocks.db.catalogoArtefacto.findMany.mockResolvedValue([]);
    const result = await templatesAndFormatsService.explorer(actor, 'NOTARIA', 'notary-a', 'FORMATO', 'c');
    expect(result.breadcrumbs.map((item) => item.name)).toEqual(['A', 'B', 'C']);
  });

  it('preserva v1/v2 y crea v3 con un blob nuevo sin duplicar la regla maestra', async () => {
    mocks.db.catalogoArtefacto.findFirst.mockResolvedValue({ id: 'artifact-a', versiones: [{ version: 2 }] });
    mocks.uploadFile.mockResolvedValue(undefined);
    mocks.db.catalogoArtefactoVersion.create.mockImplementation(async ({ data }: any) => ({ id: 'v3', ...data }));
    mocks.db.catalogoArtefacto.update.mockResolvedValue({});
    const result = await templatesAndFormatsService.addVersion(actor, 'artifact-a', {}, artifactFile);
    expect(result.version).toBe(3);
    expect(result.storage_key).toContain(`organizations/${actor.organizationId}/catalogos/plantillas-formatos/`);
    expect(mocks.db.catalogoArtefacto.create).not.toHaveBeenCalled();
    expect(mocks.db.catalogoArtefactoVersion.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'CFG_ARTIFACT_VERSION_CREATED', valores_nuevos: expect.objectContaining({ storage_key: '[PRIVATE]', version: 3 }) }) });
  });

  it('audita el upload inicial sin exponer el storage key anidado', async () => {
    mocks.db.tipoActo.findMany.mockResolvedValue([{ id: 'A' }]); mocks.uploadFile.mockResolvedValue(undefined);
    mocks.db.catalogoArtefacto.create.mockImplementation(async ({ data }: any) => ({ id: 'artifact-a', ...data, versiones: [{ id: 'v1', ...data.versiones.create, storage_key: 'private/v1' }], actos: [{ tipo_acto_id: 'A' }], reglas: [] }));
    await templatesAndFormatsService.createArtifact(actor, { tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: 'notary-a', nombre: 'Formato', act_ids: ['A'], rules: [] }, artifactFile);
    const auditCall = mocks.db.auditLog.create.mock.calls.at(-1)?.[0]?.data;
    expect(auditCall.accion).toBe('CFG_ARTIFACT_CREATED');
    expect(auditCall.valores_nuevos.versiones[0].storage_key).toBe('[PRIVATE]');
  });

  it('niega URL firmada cross-tenant aunque se conozca el ID exacto', async () => {
    mocks.db.catalogoArtefactoVersion.findFirst.mockResolvedValue(null);
    await expect(templatesAndFormatsService.signedUrl(actor, 'version-org-b')).rejects.toMatchObject({ code: 'ARTIFACT_VERSION_NOT_FOUND' });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
    expect(mocks.db.catalogoArtefactoVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: actor.organizationId }) }));
  });

  it('la auditoría recursiva no conserva storage keys ni URLs en versiones anidadas', () => {
    const redacted = redactPrivateArtifactData({ storage_key: 'secret/root', versiones: [{ storage_key: 'secret/v1', url: 'signed' }], nombre: 'Machote' });
    expect(redacted).toEqual({ storage_key: '[PRIVATE]', versiones: [{ storage_key: '[PRIVATE]', url: '[PRIVATE]' }], nombre: 'Machote' });
  });

  it('elimina sólo la relación B de un artifact multi-act, sin borrar A/C, blob ni versión', async () => {
    const before = { id: 'artifact-a', nombre: 'Machote', descripcion: null, activo: true, actos: [{ tipo_acto_id: 'A' }, { tipo_acto_id: 'B' }, { tipo_acto_id: 'C' }], reglas: [{ multiplicidad: 'EXPEDIENTE', obligatoria: false }], versiones: [{ id: 'v1', storage_key: 'private' }] };
    mocks.db.catalogoArtefacto.findFirst.mockResolvedValue(before);
    mocks.db.tipoActo.findMany.mockResolvedValue([{ id: 'A' }, { id: 'C' }]);
    mocks.db.catalogoArtefacto.update.mockResolvedValue(before);
    mocks.db.catalogoArtefacto.findUniqueOrThrow.mockResolvedValue({ ...before, activo: false, actos: [{ tipo_acto_id: 'A' }, { tipo_acto_id: 'C' }], reglas: [{ multiplicidad: 'COMPARECIENTE', obligatoria: true }] });
    await templatesAndFormatsService.updateArtifact(actor, 'artifact-a', { act_ids: ['A', 'C'], activo: false, rules: [{ multiplicidad: 'COMPARECIENTE', obligatoria: true }] });
    expect(mocks.db.catalogoArtefactoActo.createMany).toHaveBeenCalledWith({ data: [{ organization_id: actor.organizationId, artefacto_id: 'artifact-a', tipo_acto_id: 'A' }, { organization_id: actor.organizationId, artefacto_id: 'artifact-a', tipo_acto_id: 'C' }] });
    expect(mocks.db.catalogoArtefactoVersion.create).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'CFG_ARTIFACT_UPDATED', valores_anteriores: expect.objectContaining({ activo: true, actos: [{ tipo_acto_id: 'A' }, { tipo_acto_id: 'B' }, { tipo_acto_id: 'C' }], reglas: [{ multiplicidad: 'EXPEDIENTE', obligatoria: false }] }), valores_nuevos: expect.objectContaining({ activo: false, actos: [{ tipo_acto_id: 'A' }, { tipo_acto_id: 'C' }], reglas: [{ multiplicidad: 'COMPARECIENTE', obligatoria: true }] }) }) });
  });

  it('compensa el blob si falla la transacción de alta', async () => {
    mocks.db.tipoActo.findMany.mockResolvedValue([{ id: 'A' }]); mocks.uploadFile.mockResolvedValue(undefined);
    mocks.db.$transaction.mockRejectedValue(new Error('db failed'));
    await expect(templatesAndFormatsService.createArtifact(actor, { tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: 'notary-a', nombre: 'Formato', act_ids: ['A'], rules: [] }, artifactFile)).rejects.toThrow('db failed');
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
  });

  it('aplica RBAC real a upload, edición, versionado, desactivación y URL firmada', () => {
    const managedOperations = ['upload', 'update', 'version', 'disable'];
    for (const operation of managedOperations) {
      const admin = permissionResult(permissionsForRole('ADMINISTRACION'), 'configuracion.plantillas_formatos.manage');
      expect(admin.next, operation).toHaveBeenCalledOnce();
      const readOnly = permissionResult(permissionsForRole('CONSULTA'), 'configuracion.plantillas_formatos.manage');
      expect(readOnly.next, operation).not.toHaveBeenCalled();
      expect(readOnly.response.status, operation).toHaveBeenCalledWith(403);
    }
    expect(permissionResult(permissionsForRole('CONSULTA'), 'configuracion.catalogos.read').next).toHaveBeenCalledOnce();
    const noPermission = permissionResult([], 'configuracion.catalogos.read');
    expect(noPermission.next).not.toHaveBeenCalled();
    expect(noPermission.response.status).toHaveBeenCalledWith(403);
  });
});
