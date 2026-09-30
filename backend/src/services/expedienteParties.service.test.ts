import { describe, expect, it, vi } from 'vitest';
import { ExpedientePartiesService } from './expedienteParties.service';

const actor: any = {
  id: 'user-1', organizationId: 'org-1', sessionId: 'session-1', rol: 'ADMINISTRACION',
  permissions: ['expedientes.read', 'expedientes.write', 'comparecientes.read', 'comparecientes.write'], scope: 'ALL_OBJECTS',
};
const now = new Date('2026-08-26T12:00:00.000Z');
const act = (id = 'act-1', type = 'type-1') => ({ id, organization_id: 'org-1', expediente_id: 'exp-1', tipo_acto_id: type, porcentaje_objeto: 100, estatus: 'ACTIVO', removed_at: null, tipo_acto: { id: type, nombre: 'Compraventa' } });
const party = (id = 'party-1') => ({ id, organization_id: 'org-1', tipo_persona: 'FISICA', nombre_busqueda: 'PERSONA ÚNICA', personaFisica: { nombre_completo_calculado: 'Persona Única' }, personaMoral: null });
const relation = (overrides: Record<string, unknown> = {}) => ({
  id: 'relation-1', organization_id: 'org-1', expediente_id: 'exp-1', expediente_acto_id: 'act-1', compareciente_id: 'party-1', caracter_id: 'role-1',
  forma_comparecencia: 'PROPIO_DERECHO', participacion_porcentaje: null, estatus: 'ACTIVO', archived_at: null,
  expedienteActo: act(), compareciente: party(), caracter: { id: 'role-1', clave: 'COMPRADOR', nombre: 'Comprador' }, representacionesComoRepresentante: [],
  ...overrides,
});

function database(input: {
  accessible?: boolean; current?: any; duplicate?: boolean; prior?: any; protected?: number;
  immutable?: boolean; artifacts?: any[]; actFound?: boolean; partyFound?: boolean; representedFound?: boolean;
} = {}) {
  const current = input.current === undefined ? relation() : input.current;
  let created: any = null;
  const tx: any = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    expediente: {
      findFirst: vi.fn().mockImplementation(async ({ select }: any) => {
        if (input.accessible === false) return null;
        if (select && !select._count && !select.version) return { id: 'exp-1' };
        return { id: 'exp-1', estatus: input.immutable ? 'FIRMADO' : 'EN_PROCESO', version: 3, updated_at: now, _count: { expedienteDocumentos: input.protected || 0, requisitos_docs: 0, calculosISR: 0 } };
      }),
      update: vi.fn().mockResolvedValue({ version: 4 }),
    },
    expedienteActo: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => input.actFound === false || where.organization_id !== 'org-1' || !['act-1', 'act-2'].includes(where.id) ? null : act(where.id, where.id === 'act-2' ? 'type-2' : 'type-1')),
      findMany: vi.fn().mockResolvedValue([act()]),
    },
    compareciente: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where.organization_id !== 'org-1') return null;
        if (where.id === 'represented-1') return input.representedFound === false ? null : party('represented-1');
        return input.partyFound === false ? null : party(where.id || 'party-1');
      }),
      findMany: vi.fn().mockResolvedValue([party()]),
    },
    tipoActoCaracterCompareciente: { findFirst: vi.fn().mockResolvedValue({ caracter: { id: 'role-1', nombre: 'Comprador' } }) },
    caracterCompareciente: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'tenant-role-1', ...data })),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, organization_id: 'org-1', clave: 'CUSTOM_ROLE', nombre: 'ALBACEA', descripcion: null, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    caracterRepresentacion: { findFirst: vi.fn().mockResolvedValue({ id: 'rep-role-1' }), findMany: vi.fn().mockResolvedValue([]) },
    catalogoArtefacto: { findMany: vi.fn().mockImplementation(async () => input.artifacts || []) },
    expedienteCompareciente: {
      findFirst: vi.fn().mockImplementation(async ({ where, include, select }: any) => {
        if (where.OR) return input.prior || null;
        if (where.id) return current && where.id === current.id ? current : created && where.id === created.id ? created : null;
        if (select?.id && where.expediente_acto_id) return input.duplicate ? { id: 'duplicate-1' } : null;
        if (where.compareciente_id === 'represented-1') return null;
        return include && created ? created : null;
      }),
      findMany: vi.fn().mockResolvedValue(current ? [current] : []),
      create: vi.fn().mockImplementation(async ({ data }: any) => (created = relation({ id: 'relation-new', expedienteActo: act(data.expediente_acto_id), compareciente: party(data.compareciente_id), ...data }))),
      update: vi.fn().mockImplementation(async ({ data }: any) => (created = { ...current, ...data })),
    },
    expedienteRepresentacion: {
      findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 0 }), create: vi.fn().mockResolvedValue({ id: 'representation-1' }), update: vi.fn(),
    },
    expedienteActividad: { create: vi.fn().mockResolvedValue({ id: 'activity-1' }) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    domainEventOutbox: { create: vi.fn().mockResolvedValue({ id: 'event-1' }) },
  };
  const prisma: any = { ...tx, $transaction: vi.fn(async (callback: any) => callback(tx)) };
  return { prisma, tx };
}

const link = (overrides: Record<string, unknown> = {}) => ({
  operation: 'LINK' as const, expediente_acto_id: 'act-1', compareciente_id: 'party-1', caracter_id: 'role-1', forma_comparecencia: 'PROPIO_DERECHO' as const, ...overrides,
});

describe('EXP-003 relaciones compareciente–acto', () => {
  it('vincula una persona maestra existente sin crear ni duplicar identidad', async () => {
    const { prisma, tx } = database({ current: null });
    const service = new ExpedientePartiesService(prisma);
    const preview = await service.preview(actor, 'exp-1', link());
    await service.apply(actor, 'exp-1', { ...link(), idempotency_key: 'link-1', preview_fingerprint: preview.fingerprint });
    expect(tx.expedienteCompareciente.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization_id: 'org-1', expediente_acto_id: 'act-1', compareciente_id: 'party-1' }) }));
    expect(tx.compareciente.create).toBeUndefined();
  });

  it('permite la misma persona en otro acto y conserva una sola identidad maestra', async () => {
    const { prisma, tx } = database({ current: null });
    const service = new ExpedientePartiesService(prisma);
    const command = link({ expediente_acto_id: 'act-2', caracter_id: 'role-2' });
    tx.tipoActoCaracterCompareciente.findFirst.mockResolvedValue({ caracter: { id: 'role-2', nombre: 'Fideicomitente' } });
    const preview = await service.preview(actor, 'exp-1', command);
    expect(preview.proposed).toMatchObject({ expediente_acto_id: 'act-2', compareciente_id: 'party-1', caracter_id: 'role-2' });
    expect(tx.compareciente.findFirst).toHaveBeenCalled();
    expect(tx.compareciente.create).toBeUndefined();
  });

  it('bloquea únicamente el duplicado operacional exactamente idéntico', async () => {
    const { prisma } = database({ current: null, duplicate: true });
    await expect(new ExpedientePartiesService(prisma).preview(actor, 'exp-1', link())).rejects.toMatchObject({ code: 'EXPEDIENTE_PARTY_DUPLICATE_RELATION', status: 409 });
  });

  it('mantiene participación opcional y valida precisión dentro de 0..100', async () => {
    const { prisma } = database({ current: null });
    const service = new ExpedientePartiesService(prisma);
    await expect(service.preview(actor, 'exp-1', link({ participacion_porcentaje: null }))).resolves.toMatchObject({ proposed: { participacion_porcentaje: null } });
    await expect(service.preview(actor, 'exp-1', link({ participacion_porcentaje: 33.333333 }))).resolves.toMatchObject({ proposed: { participacion_porcentaje: 33.333333 } });
    await expect(service.preview(actor, 'exp-1', link({ participacion_porcentaje: 101 }))).rejects.toMatchObject({ code: 'EXPEDIENTE_PARTY_PARTICIPATION_INVALID' });
  });

  it('expone la inconsistencia 50% transmitente vs 100% adquirente sin autocompletar', async () => {
    const seller = relation({ id: 'seller', compareciente_id: 'seller-party', compareciente: party('seller-party'), caracter: { id: 'seller-role', clave: 'VENDEDOR', nombre: 'Vendedor' }, participacion_porcentaje: 50 });
    const buyer = relation({ id: 'buyer', compareciente_id: 'buyer-party', compareciente: party('buyer-party'), caracter: { id: 'buyer-role', clave: 'COMPRADOR', nombre: 'Comprador' }, participacion_porcentaje: 100 });
    const { prisma, tx } = database({ current: null });
    tx.expedienteCompareciente.findMany.mockResolvedValue([seller, buyer]);
    const result = await new ExpedientePartiesService(prisma).list(actor, 'exp-1');
    expect(result.validations[0]).toMatchObject({ object_percentage: 100, transmitter_total: 50, acquirer_total: 100, consistent: false });
    expect(result.validations[0].warnings.join(' ')).toContain('no completará porcentajes faltantes');
    expect(seller.participacion_porcentaje).toBe(50);
  });

  it('muestra y retira la advertencia de persona moral según una representación física real', async () => {
    const moralParty = { ...party('moral-party'), tipo_persona: 'MORAL', nombre_busqueda: 'SOCIEDAD QA', personaFisica: null, personaMoral: { razon_social: 'SOCIEDAD QA' } };
    const moral = relation({ id: 'moral-link', compareciente_id: moralParty.id, compareciente: moralParty, caracter: { id: 'buyer-role', clave: 'COMPRADOR', nombre: 'Comprador' }, participacion_porcentaje: 100 });
    const db = database({ current: null });
    db.tx.expedienteCompareciente.findMany.mockResolvedValue([moral]);
    const missing = await new ExpedientePartiesService(db.prisma).list(actor, 'exp-1');
    expect(missing.validations[0].warnings).toContain('PERSONA MORAL SIN REPRESENTANTE VINCULADO.');

    const representative = relation({
      id: 'representative-link', compareciente_id: 'physical-representative', compareciente: party('physical-representative'),
      caracter: { id: 'rep-role', clave: 'APODERADO_COMPRADOR', nombre: 'Apoderado del comprador' },
      representacionesComoRepresentante: [{ representado_compareciente_id: moralParty.id, representado: moralParty }],
    });
    db.tx.expedienteCompareciente.findMany.mockResolvedValue([moral, representative]);
    const linked = await new ExpedientePartiesService(db.prisma).list(actor, 'exp-1');
    expect(linked.validations[0].warnings).not.toContain('PERSONA MORAL SIN REPRESENTANTE VINCULADO.');
  });

  it('reutiliza representación existente y bloquea persona representada ajena', async () => {
    const command = link({ forma_comparecencia: 'EN_REPRESENTACION_PERSONA_MORAL', representation: { representado_compareciente_id: 'represented-1', cargo_o_caracter_descripcion: 'Apoderado general' } });
    const allowed = database({ current: null });
    const preview = await new ExpedientePartiesService(allowed.prisma).preview(actor, 'exp-1', command as any);
    await new ExpedientePartiesService(allowed.prisma).apply(actor, 'exp-1', { ...command, idempotency_key: 'representation-1', preview_fingerprint: preview.fingerprint } as any);
    expect(allowed.tx.expedienteRepresentacion.create).toHaveBeenCalled();
    const denied = database({ current: null, representedFound: false });
    await expect(new ExpedientePartiesService(denied.prisma).preview(actor, 'exp-1', command as any)).rejects.toMatchObject({ code: 'EXPEDIENTE_PARTY_REPRESENTED_ACCESS_DENIED', status: 403 });
  });

  it('no exige persona representada para carácter institucional u otra comparecencia', async () => {
    for (const forma_comparecencia of ['CARACTER_INSTITUCIONAL', 'OTRO'] as const) {
      const { prisma } = database({ current: null });
      await expect(new ExpedientePartiesService(prisma).preview(actor, 'exp-1', link({ forma_comparecencia })))
        .resolves.toMatchObject({ proposed: { forma_comparecencia, representation: null } });
    }
  });

  it('crea un rol reutilizable limitado a la Notaría y lo audita', async () => {
    const { prisma, tx } = database({ current: null });
    const result = await new ExpedientePartiesService(prisma).createTenantRole(actor, 'exp-1', {
      expediente_acto_id: 'act-1', nombre: 'albacea', descripcion: 'Interviene en sucesión',
    });
    expect(result).toMatchObject({ created: true, reusable_within_tenant: true, role: { id: 'tenant-role-1', organization_id: 'org-1', nombre: 'ALBACEA' } });
    expect(tx.caracterCompareciente.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organization_id: 'org-1', nombre: 'ALBACEA', activo: true }) });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'CREATE_TENANT_PARTY_ROLE', organization_id: 'org-1' }) }));
  });

  it('reutiliza idempotentemente un rol tenant existente sin update unique incompatible con el scope', async () => {
    const { prisma, tx } = database({ current: null });
    tx.caracterCompareciente.findFirst.mockResolvedValue({
      id: 'tenant-role-1', organization_id: 'org-1', clave: 'CUSTOM_ROLE', nombre: 'ALBACEA', descripcion: 'Anterior', activo: true,
    });
    const result = await new ExpedientePartiesService(prisma).createTenantRole(actor, 'exp-1', {
      expediente_acto_id: 'act-1', nombre: 'albacea', descripcion: 'Actualizada',
    });
    expect(result).toMatchObject({ created: false, role: { id: 'tenant-role-1', organization_id: 'org-1', nombre: 'ALBACEA', descripcion: 'Actualizada', activo: true } });
    expect(tx.caracterCompareciente.updateMany).toHaveBeenCalledWith({
      where: { id: 'tenant-role-1', organization_id: 'org-1' },
      data: { activo: true, descripcion: 'Actualizada' },
    });
    expect(tx.caracterCompareciente.create).not.toHaveBeenCalled();
  });

  it('permite usar el rol propio en cualquier acto del mismo tenant y rechaza uno ajeno', async () => {
    const allowed = database({ current: null });
    allowed.tx.tipoActoCaracterCompareciente.findFirst.mockResolvedValue(null);
    allowed.tx.caracterCompareciente.findFirst.mockResolvedValue({ id: 'tenant-role-1', nombre: 'Albacea' });
    await expect(new ExpedientePartiesService(allowed.prisma).preview(actor, 'exp-1', link({ caracter_id: 'tenant-role-1' })))
      .resolves.toMatchObject({ proposed: { caracter_id: 'tenant-role-1' } });

    const denied = database({ current: null });
    denied.tx.tipoActoCaracterCompareciente.findFirst.mockResolvedValue(null);
    denied.tx.caracterCompareciente.findFirst.mockResolvedValue(null);
    await expect(new ExpedientePartiesService(denied.prisma).preview(actor, 'exp-1', link({ caracter_id: 'foreign-role' })))
      .rejects.toMatchObject({ code: 'EXPEDIENTE_PARTY_CHARACTER_NOT_ALLOWED', status: 409 });
  });

  it.each([
    ['expediente', database({ accessible: false }), 'EXPEDIENTE_ACCESS_DENIED'],
    ['acto', database({ current: null, actFound: false }), 'EXPEDIENTE_PARTY_ACT_ACCESS_DENIED'],
    ['persona', database({ current: null, partyFound: false }), 'EXPEDIENTE_PARTY_MASTER_ACCESS_DENIED'],
  ])('bloquea IDOR por %s', async (_object, db, code) => {
    await expect(new ExpedientePartiesService(db.prisma).preview(actor, 'exp-1', link())).rejects.toMatchObject({ code, status: 403 });
  });

  it('bloquea IDOR de relación con un ID válido no accesible', async () => {
    const { prisma } = database({ current: null });
    await expect(new ExpedientePartiesService(prisma).preview(actor, 'exp-1', { operation: 'UNLINK', relation_id: 'foreign-relation', reason: 'No corresponde' })).rejects.toMatchObject({ code: 'EXPEDIENTE_PARTY_RELATION_ACCESS_DENIED', status: 403 });
  });

  it('rechaza preview obsoleto antes de mutar', async () => {
    const { prisma, tx } = database({ current: null });
    await expect(new ExpedientePartiesService(prisma).apply(actor, 'exp-1', { ...link(), idempotency_key: 'stale-1', preview_fingerprint: 'obsolete' })).rejects.toMatchObject({ code: 'EXPEDIENTE_PARTY_PREVIEW_STALE', status: 409 });
    expect(tx.expedienteCompareciente.create).not.toHaveBeenCalled();
  });

  it('exige confirmación humana cuando CFG-002 deja trabajo protegido aplicable', async () => {
    const cfgCurrent = [{ id: 'artifact-1', nombre: 'Formato protegido', reglas: [{ tipo_persona: null, caracter_compareciente_id: 'role-1' }] }];
    const { prisma, tx } = database({ protected: 1, artifacts: cfgCurrent });
    tx.catalogoArtefacto.findMany.mockImplementation(async ({ where }: any) => where.actos.some.tipo_acto_id === 'type-1' ? cfgCurrent : []);
    tx.tipoActoCaracterCompareciente.findFirst.mockResolvedValue({ caracter: { id: 'role-2', nombre: 'Representante' } });
    const service = new ExpedientePartiesService(prisma);
    const command = { operation: 'UPDATE' as const, relation_id: 'relation-1', expediente_acto_id: 'act-2', compareciente_id: 'party-1', caracter_id: 'role-2', forma_comparecencia: 'PROPIO_DERECHO' as const };
    const preview = await service.preview(actor, 'exp-1', command);
    expect(preview.classification).toBe('REVIEW_REQUIRED');
    await expect(service.apply(actor, 'exp-1', { ...command, idempotency_key: 'review-1', preview_fingerprint: preview.fingerprint })).rejects.toMatchObject({ code: 'EXPEDIENTE_PARTY_CONFIRMATION_REQUIRED' });
  });

  it('desvincula sólo la relación solicitada, conserva maestro y audita', async () => {
    const { prisma, tx } = database();
    const service = new ExpedientePartiesService(prisma);
    const command = { operation: 'UNLINK' as const, relation_id: 'relation-1', reason: 'Ya no participa en este acto' };
    const preview = await service.preview(actor, 'exp-1', command);
    await service.apply(actor, 'exp-1', { ...command, idempotency_key: 'unlink-1', preview_fingerprint: preview.fingerprint });
    expect(tx.expedienteCompareciente.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'relation-1' }, data: expect.objectContaining({ estatus: 'INACTIVO', unlink_idempotency_key: 'unlink-1' }) }));
    expect(tx.compareciente.delete).toBeUndefined();
    expect(tx.expedienteCompareciente.delete).toBeUndefined();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'UNLINK_EXPEDIENTE_PARTY' }) }));
    expect(tx.domainEventOutbox.create).toHaveBeenCalled();
  });

  it('devuelve el resultado previo al repetir una clave idempotente', async () => {
    const prior = relation({ idempotency_key: 'same-key' });
    const { prisma, tx } = database({ prior });
    const result = await new ExpedientePartiesService(prisma).apply(actor, 'exp-1', { ...link(), idempotency_key: 'same-key', preview_fingerprint: 'ignored' });
    expect(result).toMatchObject({ relation: prior, idempotent: true });
    expect(tx.expedienteCompareciente.create).not.toHaveBeenCalled();
  });
});
