import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runWithActorContext, TenantContextError } from '../auth/actorContext';
import { SHARED_OR_TENANT_MODELS, TENANT_SCOPED_MODELS, tenantIsolationMiddleware } from '../config/tenantPrisma';
import { ExpedienteWorkflowService } from '../services/expedienteWorkflow.service';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorA = {
  userId: '11111111-1111-4111-8111-111111111111', organizationId: ORG_A, membershipId: 'membership-a',
  role: 'DIRECCION' as const, permissions: [], scope: 'GLOBAL' as const, sessionId: 'session-a',
};

const readAllMigrations = () => {
  const root = resolve(process.cwd(), 'prisma/migrations');
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => readFileSync(resolve(root, entry.name, 'migration.sql'), 'utf8'))
    .join('\n');
};

const invoke = (model: string, action: string, args: Record<string, unknown>, next = vi.fn(async (params) => params)) =>
  runWithActorContext(actorA, () => tenantIsolationMiddleware({ model, action, args } as any, next));

describe('frontera tenant canónica', () => {
  it('falla cerrado para toda entidad tenant-owned cuando no existe ActorContext', async () => {
    for (const model of TENANT_SCOPED_MODELS) {
      await expect(tenantIsolationMiddleware({ model, action: 'findMany', args: {} } as any, vi.fn()))
        .rejects.toBeInstanceOf(TenantContextError);
    }
  });

  it('aplica organización antes de leer, buscar, agregar, actualizar y eliminar en todos los dominios', async () => {
    const actions = ['findMany', 'findFirst', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany'];
    for (const model of TENANT_SCOPED_MODELS) {
      for (const action of actions) {
        const next = vi.fn(async (params) => params);
        await invoke(model, action, { where: { archived_at: null } }, next);
        expect(next.mock.calls[0][0].args.where, `${model}.${action}`).toMatchObject({ organization_id: ORG_A });
      }
    }
  });

  it('inyecta ownership en escrituras A y rechaza tenant spoofing B', async () => {
    for (const model of TENANT_SCOPED_MODELS) {
      const createNext = vi.fn(async (params) => params);
      await invoke(model, 'create', { data: { label: 'A' } }, createNext);
      expect(createNext.mock.calls[0][0].args.data, model).toMatchObject({ organization_id: ORG_A });
      await expect(invoke(model, 'create', { data: { organization_id: ORG_B } }))
        .rejects.toMatchObject({ name: 'TenantContextError' });
      await expect(invoke(model, 'update', { where: { id: 'valid-resource-a' }, data: { organization_id: ORG_B } }))
        .rejects.toMatchObject({ name: 'TenantContextError' });
    }
  });

  it('usa IDs válidos de Org B pero los vuelve invisibles para Org A en GET/PATCH/DELETE/search y agregados', async () => {
    const rows = [
      { id: 'valid-a', organization_id: ORG_A, amount: 100 },
      { id: 'valid-b', organization_id: ORG_B, amount: 900 },
    ];
    const execute = vi.fn(async (params: any) => {
      const scoped = rows.filter((row) => row.organization_id === params.args.where.organization_id);
      if (params.action === 'aggregate') return { _sum: { amount: scoped.reduce((sum, row) => sum + row.amount, 0) } };
      return scoped.find((row) => row.id === params.args.where.id) || null;
    });
    expect(await invoke('Expediente', 'findFirst', { where: { id: 'valid-b' } }, execute)).toBeNull();
    expect(await invoke('Documento', 'update', { where: { id: 'valid-b' }, data: { label: 'attempt' } }, execute)).toBeNull();
    expect(await invoke('Compareciente', 'delete', { where: { id: 'valid-b' } }, execute)).toBeNull();
    expect(await invoke('MovimientoFinanciero', 'aggregate', { where: {}, _sum: { amount: true } }, execute))
      .toEqual({ _sum: { amount: 100 } });
  });

  it('rechaza actor spoofing antes de ejecutar una transición sensible', async () => {
    const db = { user: { findUnique: vi.fn() } };
    const service = new ExpedienteWorkflowService(db as any);
    await expect(runWithActorContext(actorA, () => service.ejecutarTransicion({
      expedienteId: 'valid-a', versionActual: 1, actorUserId: 'valid-user-b', nuevoEstatus: 'EN_PROCESO',
    }))).rejects.toBeInstanceOf(TenantContextError);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('acota usuarios y membresías, mientras los catálogos legales permanecen globales', async () => {
    const userNext = vi.fn(async (params) => params);
    const requestedUserScope = { activo: true, organizationMemberships: { some: { status: 'ACTIVE', rol: 'ABOGADO' } } };
    await invoke('User', 'findMany', { where: requestedUserScope }, userNext);
    expect(userNext.mock.calls[0][0].args.where.AND)
      .toEqual([requestedUserScope, { organizationMemberships: { some: { organization_id: ORG_A } } }]);
    const membershipNext = vi.fn(async (params) => params);
    await invoke('OrganizationMembership', 'findMany', { where: {} }, membershipNext);
    expect(membershipNext.mock.calls[0][0].args.where.organization_id).toBe(ORG_A);
    const catalogNext = vi.fn(async (params) => params);
    await invoke('FiscalRuleSet', 'findMany', { where: { activo: true } }, catalogNext);
    expect(catalogNext.mock.calls[0][0].args.where).toEqual({ activo: true });
  });

  it('expone actos canónicos globales y actos privados del tenant sin filtrar identidades de otra organización', async () => {
    const next = vi.fn(async (params) => params);
    await invoke('TipoActo', 'findMany', { where: { activo: true } }, next);
    expect(next.mock.calls[0][0].args.where).toEqual({
      AND: [{ activo: true }, { OR: [{ organization_id: null }, { organization_id: ORG_A }] }],
    });
    const create = vi.fn(async (params) => params);
    await invoke('TipoActo', 'create', { data: { nombre: 'Acto privado' } }, create);
    expect(create.mock.calls[0][0].args.data.organization_id).toBe(ORG_A);

    const update = vi.fn(async (params) => params);
    await invoke('TipoActo', 'update', { where: { id: 'global-or-tenant-act' }, data: { nombre: 'Cambio' } }, update);
    expect(update.mock.calls[0][0].args.where).toEqual({
      AND: [{ id: 'global-or-tenant-act' }, { organization_id: ORG_A }],
    });
  });

  it('la migración valida sin inferir tenant y bloquea relaciones cross-tenant críticas', () => {
    const sql = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260817045000_create_multitenancy_foundation/migration.sql'), 'utf8');
    expect(sql).not.toContain('NEW.organization_id := parent_org');
    expect(sql).toContain('IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;');
    for (const relation of [
      "('expediente_comparecientes','expedientes','expediente_id')",
      "('expediente_comparecientes','comparecientes','compareciente_id')",
      "('expediente_documentos','documentos','documento_id')",
      "('movimientos_financieros','expedientes','expediente_id')",
      "('calculos_isr','expedientes','expediente_id')",
      "('compliance_reviews','expedientes','expediente_id')",
    ]) expect(sql).toContain(relation);
    expect(sql).toContain('CROSS_TENANT_RELATION_DENIED');
  });

  it('mantiene alineados schema, middleware, FKs e índices para cada modelo tenant-owned', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const migrations = readAllMigrations();
    const normalizedMigrations = migrations.replaceAll('"', '').replace(/\s+/g, ' ');
    for (const model of TENANT_SCOPED_MODELS) {
      const block = schema.match(new RegExp(`model\\s+${model}\\s+\\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
      expect(block, `${model} debe existir en Prisma`).not.toBe('');
      expect(block, `${model} debe declarar organization_id`).toMatch(/organization_id\s+String/);
      const table = block.match(/@@map\("([^"]+)"\)/)?.[1];
      expect(table, `${model} debe declarar @@map`).toBeTruthy();
      expect(migrations, `${model}/${table} debe estar en alguna migración tenant`).toContain(String(table));
      const hasGenericTenantIndex = migrations.includes(`'idx_' || table_name || '_organization'`);
      const hasExplicitTenantIndex = normalizedMigrations.includes(`ON pravia_os.${table}(organization_id`)
        || normalizedMigrations.includes(`ON pravia_os.${table} (organization_id`);
      expect(hasGenericTenantIndex || hasExplicitTenantIndex, `${model}/${table} debe indexar organization_id`).toBe(true);
    }
    const schemaTenantModels = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
      .filter(([, name, body]) => /^\s*organization_id\s+/m.test(body) && !['OrganizationMembership', 'AuthSession'].includes(name))
      .map(([, name]) => name)
      .sort();
    expect([...TENANT_SCOPED_MODELS, ...SHARED_OR_TENANT_MODELS].sort()).toEqual(schemaTenantModels);
  });

  it('cubre con constraints todas las relaciones tenant↔tenant y tenant↔usuario', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const migrations = readAllMigrations();
    const normalizedMigrations = migrations.replaceAll('"', '').replace(/\s+/g, ' ');
    const models = new Map<string, { body: string; table: string; tenant: boolean }>();
    for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const [, name, body] = match;
      models.set(name, { body, table: body.match(/@@map\("([^"]+)"\)/)?.[1] || name, tenant: /^\s*organization_id\s+/m.test(body) });
    }
    for (const [name, model] of models) {
      if (!model.tenant || ['OrganizationMembership', 'AuthSession'].includes(name)) continue;
      for (const line of model.body.split('\n')) {
        const relation = line.match(/^\s*\w+\s+(\w+)(?:\?|\[\])?\s+@relation\([^\n]*fields:\s*\[([^\]]+)\]/);
        if (!relation) continue;
        const [, parentName, rawFields] = relation;
        const parent = models.get(parentName);
        if (!parent) continue;
        for (const field of rawFields.split(',').map((item) => item.trim())) {
          if (parentName === 'Organization') continue;
          if (parentName === 'User') {
            const tuple = `('${model.table}','${field}')`;
            const explicitTrigger = new RegExp(`ON\\s+pravia_os\\.${model.table}[\\s\\S]{0,220}enforce_organization_membership\\('${field}'\\)`);
            expect(migrations.includes(tuple) || explicitTrigger.test(migrations), `${model.table}.${field} debe exigir Membership`).toBe(true);
          } else if (SHARED_OR_TENANT_MODELS.has(parentName)) {
            expect(normalizedMigrations).toContain(`FOREIGN KEY (${field}) REFERENCES pravia_os.${parent.table}(id)`);
          } else if (parent.tenant) {
            const tuple = `('${model.table}','${parent.table}','${field}')`;
            const explicitTrigger = new RegExp(`ON\\s+pravia_os\\.${model.table}[\\s\\S]{0,220}enforce_same_organization\\('${parent.table}','${field}'\\)`);
            const compositeFk = normalizedMigrations.includes(
              `FOREIGN KEY (${field}, organization_id) REFERENCES pravia_os.${parent.table}(id, organization_id)`,
            );
            expect(migrations.includes(tuple) || explicitTrigger.test(migrations) || compositeFk, `${model.table}.${field} debe coincidir con ${parent.table}`).toBe(true);
          }
        }
      }
    }
  });

  it('define sin ambigüedad el scope híbrido de plantillas documentales', () => {
    const foundation = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260817045000_create_multitenancy_foundation/migration.sql'), 'utf8');
    expect(foundation).toContain('enforce_document_template_scope');
    expect(foundation).toContain('template.notaria_id');
    expect(foundation).toContain('template_org IS DISTINCT FROM NEW.organization_id');
    expect(foundation).toContain('CROSS_TENANT_DOCUMENT_TEMPLATE_DENIED');
  });
});
