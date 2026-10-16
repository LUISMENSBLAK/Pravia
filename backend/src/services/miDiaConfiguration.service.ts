import type { Request } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { MI_DIA_CARD_CATALOG, MI_DIA_CONNECTED_CARD_KEYS, miDiaCardByKey, type MiDiaCardDefinition, type MiDiaScope, type MiDiaSize } from '../domain/miDiaCardCatalog';

type Actor = NonNullable<Request['user']>;
type LayoutItem = { key: string; size: MiDiaSize; scope: MiDiaScope; parameters: Record<string, string | number> };
const DEFAULT_KEYS = ['URGENT_TASKS', 'TODAY_AGENDA', 'UPCOMING_SIGNINGS', 'CASES', 'PERSONAL_NOTEBOOK', 'RECEIVABLE'];
const SCOPE_ORDER: MiDiaScope[] = ['OWN', 'TEAM', 'ORGANIZATION'];
const MAX_LAYOUT = 90;

export class MiDiaConfigurationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const scopeRank = (scope: MiDiaScope) => SCOPE_ORDER.indexOf(scope);

function normalizeParameters(card: MiDiaCardDefinition, raw: unknown): LayoutItem['parameters'] {
  const input = asRecord(raw);
  const params: LayoutItem['parameters'] = {};
  if (card.parameters.includes('limit') && input.limit !== undefined) {
    const value = Number(input.limit);
    if (![5, 10, 15].includes(value)) throw new MiDiaConfigurationError(400, 'MIDIA_LIMIT_INVALID', 'La cantidad debe ser 5, 10 o 15.');
    params.limit = value;
  }
  if (card.parameters.includes('window') && input.window !== undefined) {
    const value = Number(input.window);
    if (![3, 7, 15].includes(value)) throw new MiDiaConfigurationError(400, 'MIDIA_WINDOW_INVALID', 'La ventana debe ser 3, 7 o 15 días.');
    params.window = value;
  }
  if (card.parameters.includes('period') && input.period !== undefined) {
    const value = String(input.period);
    const allowedPeriods = card.key === 'PRODUCTION_VALUE' ? ['MONTH', 'YEAR'] : ['TODAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];
    if (!allowedPeriods.includes(value)) throw new MiDiaConfigurationError(400, 'MIDIA_PERIOD_INVALID', 'El periodo no está permitido.');
    params.period = value;
  }
  if (card.parameters.includes('date') && input.date !== undefined) {
    const value = String(input.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new MiDiaConfigurationError(400, 'MIDIA_DATE_INVALID', 'La fecha debe usar AAAA-MM-DD.');
    params.date = value;
  }
  return params;
}

function normalizeLayout(input: unknown, allowed: Map<string, { card: MiDiaCardDefinition; maxScope: MiDiaScope }>): LayoutItem[] {
  const entries = asArray(input);
  if (entries.length > MAX_LAYOUT) throw new MiDiaConfigurationError(400, 'MIDIA_LAYOUT_TOO_LARGE', 'El tablero excede el máximo de tarjetas.');
  const seen = new Set<string>();
  return entries.map((value) => {
    const row = asRecord(value);
    const key = String(row.key ?? '');
    const access = allowed.get(key);
    if (!access) throw new MiDiaConfigurationError(403, 'MIDIA_CARD_DENIED', `La tarjeta ${key || 'desconocida'} no está habilitada para este usuario.`);
    if (seen.has(key)) throw new MiDiaConfigurationError(400, 'MIDIA_CARD_DUPLICATE', 'Una tarjeta no puede repetirse.');
    seen.add(key);
    const size = String(row.size ?? access.card.defaultSize) as MiDiaSize;
    if (!access.card.allowedSizes.includes(size)) throw new MiDiaConfigurationError(400, 'MIDIA_SIZE_INVALID', 'El tamaño no está permitido para la tarjeta.');
    const scope = String(row.scope ?? effectiveScope(access.card, access.maxScope, access.maxScope)) as MiDiaScope;
    if (scope === 'TEAM' || !access.card.allowedScopes.includes(scope) || scopeRank(scope) > scopeRank(access.maxScope)) {
      throw new MiDiaConfigurationError(403, 'MIDIA_SCOPE_DENIED', 'El alcance excede el máximo autorizado.');
    }
    return { key, size, scope, parameters: normalizeParameters(access.card, row.parameters) };
  });
}

function effectiveScope(card: MiDiaCardDefinition, maximum: MiDiaScope, requested: MiDiaScope): MiDiaScope | null {
  // Sin membresía canónica de equipo, TEAM no puede significar toda la notaría.
  const candidates = card.allowedScopes.filter((item) => item !== 'TEAM' && scopeRank(item) <= scopeRank(maximum));
  if (!candidates.length) return null;
  return candidates.includes(requested) ? requested : candidates[candidates.length - 1];
}

export class MiDiaConfigurationService {
  constructor(private readonly db: PrismaClient) {}

  private async resolved(actor: Actor) {
    if (!actor.permissions.includes('mi_dia.read')) {
      throw new MiDiaConfigurationError(403, 'MIDIA_READ_DENIED', 'No tienes permiso para consultar Mi Día.');
    }
    const [tenant, saved, grants] = await Promise.all([
      this.db.miDiaTenantConfig.findUnique({ where: { organization_id: actor.organizationId } }),
      this.db.miDiaUserLayout.findUnique({ where: { organization_id_user_id: { organization_id: actor.organizationId, user_id: actor.id } } }),
      this.db.miDiaCardPermission.findMany({ where: { organization_id: actor.organizationId, user_id: actor.id } }),
    ]);
    const enabled = tenant ? new Set(asArray(tenant.enabled_cards).map(String)) : new Set(MI_DIA_CARD_CATALOG.map((card) => card.key));
    const grantByKey = new Map(grants.map((grant) => [grant.card_key, grant]));
    const allowed = new Map<string, { card: MiDiaCardDefinition; maxScope: MiDiaScope }>();
    for (const card of MI_DIA_CARD_CATALOG) {
      if (!MI_DIA_CONNECTED_CARD_KEYS.has(card.key) || !enabled.has(card.key) || !actor.permissions.includes(card.permission)) continue;
      if (card.key === 'CRITICAL_ALERTS'
        && (!actor.permissions.includes('compliance.read') || !actor.permissions.includes('expedientes.read'))) continue;
      if (card.key === 'FORMATS_TO_SIGN'
        && (!actor.permissions.includes('compliance.read') || !actor.permissions.includes('expedientes.read'))) continue;
      if (card.key === 'CAN_ADVANCE_TODAY'
        && (!actor.permissions.includes('expedientes.read') || !actor.permissions.includes('expedientes.write'))) continue;
      if (card.key === 'USER_LOAD' && !actor.permissions.includes('expedientes.read')) continue;
      const grant = grantByKey.get(card.key);
      if (grant?.enabled === false) continue;
      const rbScope: MiDiaScope = actor.scope === 'GLOBAL' ? 'ORGANIZATION' : 'OWN';
      const granted = grant && SCOPE_ORDER.includes(grant.max_scope as MiDiaScope) ? grant.max_scope as MiDiaScope : rbScope;
      // No team hierarchy is inferred from a role. Until a team membership
      // exists, TEAM cannot increase the object's canonical access.
      const maxScope = granted === 'TEAM' ? 'OWN' : SCOPE_ORDER[Math.min(scopeRank(rbScope), scopeRank(granted))];
      if (effectiveScope(card, maxScope, maxScope)) allowed.set(card.key, { card, maxScope });
    }
    return { tenant, saved, allowed };
  }

  async get(actor: Actor) {
    const { tenant, saved, allowed } = await this.resolved(actor);
    const defaults = tenant ? asArray(tenant.default_layout) : DEFAULT_KEYS.map((key) => ({ key }));
    const fixed = defaults.filter((row) => asRecord(row).fixed === true).map((row) => String(asRecord(row).key));
    const source = saved?.personalized ? asArray(saved.layout) : defaults;
    const visible: LayoutItem[] = [];
    const seen = new Set<string>();
    for (const row of [...source, ...defaults.filter((item) => fixed.includes(String(asRecord(item).key)))]) {
      const raw = asRecord(row);
      const key = String(raw.key ?? '');
      const access = allowed.get(key);
      if (!access || seen.has(key)) continue;
      seen.add(key);
      const size = access.card.allowedSizes.includes(raw.size as MiDiaSize) ? raw.size as MiDiaSize : access.card.defaultSize;
      const requested = SCOPE_ORDER.includes(raw.scope as MiDiaScope) ? raw.scope as MiDiaScope : access.maxScope;
      const scope = effectiveScope(access.card, access.maxScope, requested);
      if (!scope) continue;
      let parameters: LayoutItem['parameters'] = {};
      try { parameters = normalizeParameters(access.card, raw.parameters); } catch { /* legacy parameter invalid: use safe card default */ }
      visible.push({ key, size, scope, parameters });
    }
    const recommended = tenant ? asArray(tenant.recommended_cards).map(String) : DEFAULT_KEYS;
    const tenantAdministration = actor.permissions.includes('mi_dia.configure') ? {
      version: tenant?.version ?? 0,
      catalog: MI_DIA_CARD_CATALOG.filter((card) => MI_DIA_CONNECTED_CARD_KEYS.has(card.key)),
      enabledCards: tenant ? asArray(tenant.enabled_cards).map(String).filter((key) => MI_DIA_CONNECTED_CARD_KEYS.has(key)) : [...MI_DIA_CONNECTED_CARD_KEYS],
      defaultLayout: defaults.map((entry) => {
        const raw = asRecord(entry);
        const card = miDiaCardByKey.get(String(raw.key ?? ''));
        if (!card || !MI_DIA_CONNECTED_CARD_KEYS.has(card.key)) return null;
        let parameters: LayoutItem['parameters'] = {};
        try { parameters = normalizeParameters(card, raw.parameters); } catch { /* legacy invalid: use safe defaults */ }
        return {
          key: card.key,
          size: card.allowedSizes.includes(raw.size as MiDiaSize) ? raw.size as MiDiaSize : card.defaultSize,
          scope: card.allowedScopes.includes(raw.scope as MiDiaScope) && raw.scope !== 'TEAM' ? raw.scope as MiDiaScope :
            card.allowedScopes.includes('ORGANIZATION') ? 'ORGANIZATION' as const : 'OWN' as const,
          parameters, fixed: raw.fixed === true,
        };
      }).filter((entry) => entry !== null),
      recommendedCards: recommended.filter((key) => MI_DIA_CONNECTED_CARD_KEYS.has(key)),
    } : undefined;
    return {
      catalog: [...allowed.values()].map(({ card, maxScope }) => ({ ...card,
        allowedScopes: card.allowedScopes.filter((scope) => scope !== 'TEAM' && scopeRank(scope) <= scopeRank(maxScope)),
        maxScope, recommended: recommended.includes(card.key) })),
      layout: visible.map((item) => ({ ...item, fixed: fixed.includes(item.key) })),
      layoutVersion: saved?.version ?? 0, personalized: saved?.personalized ?? false,
      tenantVersion: tenant?.version ?? 0,
      ...(tenantAdministration ? { tenantAdministration } : {}),
    };
  }

  async saveLayout(actor: Actor, input: Record<string, unknown>) {
    const version = Number(input.version);
    if (!Number.isInteger(version) || version < 0) throw new MiDiaConfigurationError(400, 'MIDIA_VERSION_REQUIRED', 'Envía la versión vigente del tablero.');
    const { tenant, saved, allowed } = await this.resolved(actor);
    const layout = normalizeLayout(input.layout, allowed);
    const fixed = tenant ? asArray(tenant.default_layout).filter((row) => asRecord(row).fixed === true).map((row) => String(asRecord(row).key)) : [];
    if (fixed.some((key) => allowed.has(key) && !layout.some((item) => item.key === key))) {
      throw new MiDiaConfigurationError(409, 'MIDIA_FIXED_CARD_REQUIRED', 'No puedes quitar una tarjeta fijada por la organización.');
    }
    if ((saved?.version ?? 0) !== version) throw new MiDiaConfigurationError(409, 'MIDIA_LAYOUT_CHANGED', 'El tablero cambió en otra pestaña. Recarga antes de guardar.');
    try {
      const row = await this.db.$transaction(async (tx) => {
        const updated = saved ? await tx.miDiaUserLayout.update({ where: { id: saved.id, version }, data: {
          layout: layout as unknown as Prisma.InputJsonValue, personalized: true, version: { increment: 1 },
        } }) : await tx.miDiaUserLayout.create({ data: {
          organization_id: actor.organizationId, user_id: actor.id, layout: layout as unknown as Prisma.InputJsonValue,
          personalized: true,
        } });
        await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id,
          accion: 'PERSONALIZE_MI_DIA', entidad: 'MiDiaUserLayout', entidad_id: updated.id,
          valores_nuevos: { version: updated.version, card_keys: layout.map((item) => item.key) } } });
        return updated;
      });
      return { version: row.version, layout };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2025'].includes(error.code)) {
        throw new MiDiaConfigurationError(409, 'MIDIA_LAYOUT_CHANGED', 'El tablero cambió en otra pestaña. Recarga antes de guardar.');
      }
      throw error;
    }
  }

  async resetLayout(actor: Actor) {
    if (!actor.permissions.includes('mi_dia.read')) {
      throw new MiDiaConfigurationError(403, 'MIDIA_READ_DENIED', 'No tienes permiso para consultar Mi Día.');
    }
    await this.db.$transaction(async (tx) => {
      const removed = await tx.miDiaUserLayout.deleteMany({ where: { organization_id: actor.organizationId, user_id: actor.id } });
      if (removed.count) await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id,
        accion: 'RESET_MI_DIA', entidad: 'MiDiaUserLayout', entidad_id: actor.id,
        valores_nuevos: { reset_to_tenant_default: true } } });
    });
    return this.get(actor);
  }

  async updateTenant(actor: Actor, input: Record<string, unknown>) {
    if (!actor.permissions.includes('mi_dia.configure')) throw new MiDiaConfigurationError(403, 'MIDIA_CONFIG_DENIED', 'No puedes configurar Mi Día.');
    const version = Number(input.version);
    if (!Number.isInteger(version) || version < 0) throw new MiDiaConfigurationError(400, 'MIDIA_VERSION_REQUIRED', 'Envía la versión vigente de la configuración.');
    const enabledKeys = asArray(input.enabled_cards).map(String);
    if (new Set(enabledKeys).size !== enabledKeys.length || enabledKeys.some((key) => !MI_DIA_CONNECTED_CARD_KEYS.has(key))) {
      throw new MiDiaConfigurationError(400, 'MIDIA_ENABLED_INVALID', 'La selección de tarjetas contiene elementos desconocidos o duplicados.');
    }
    const adminAllowed = new Map(MI_DIA_CARD_CATALOG.filter((card) => enabledKeys.includes(card.key)).map((card) => [card.key, { card, maxScope: 'ORGANIZATION' as MiDiaScope }]));
    const layout = normalizeLayout(input.default_layout, adminAllowed);
    const fixedKeys = new Set(asArray(input.fixed_cards).map(String));
    if ([...fixedKeys].some((key) => !layout.some((row) => row.key === key))) throw new MiDiaConfigurationError(400, 'MIDIA_FIXED_INVALID', 'Una tarjeta fijada debe estar en el tablero predeterminado.');
    const recommended = asArray(input.recommended_cards).map(String);
    if (recommended.some((key) => !enabledKeys.includes(key))) throw new MiDiaConfigurationError(400, 'MIDIA_RECOMMENDED_INVALID', 'Las recomendadas deben estar habilitadas.');
    const existing = await this.db.miDiaTenantConfig.findUnique({ where: { organization_id: actor.organizationId } });
    if ((existing?.version ?? 0) !== version) throw new MiDiaConfigurationError(409, 'MIDIA_CONFIG_CHANGED', 'La configuración cambió en otra pestaña.');
    const payload = { enabled_cards: enabledKeys, default_layout: layout.map((row) => ({ ...row, fixed: fixedKeys.has(row.key) })), recommended_cards: recommended };
    try {
      const row = await this.db.$transaction(async (tx) => {
        const updated = existing ? await tx.miDiaTenantConfig.update({ where: { organization_id: actor.organizationId, version }, data: {
          ...payload, version: { increment: 1 },
        } }) : await tx.miDiaTenantConfig.create({ data: { organization_id: actor.organizationId, ...payload } });
        await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id,
          accion: 'CONFIGURE_MI_DIA_TENANT', entidad: 'MiDiaTenantConfig', entidad_id: actor.organizationId,
          valores_nuevos: { version: updated.version, enabled_count: enabledKeys.length, default_count: layout.length } } });
        return updated;
      });
      return { version: row.version };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2025'].includes(error.code)) {
        throw new MiDiaConfigurationError(409, 'MIDIA_CONFIG_CHANGED', 'La configuración cambió en otra pestaña.');
      }
      throw error;
    }
  }

  async setCardPermission(actor: Actor, userId: string, input: Record<string, unknown>) {
    if (!actor.permissions.includes('mi_dia.permissions.manage')) throw new MiDiaConfigurationError(403, 'MIDIA_GRANT_DENIED', 'No puedes cambiar permisos de Mi Día.');
    const key = String(input.card_key ?? '');
    if (!miDiaCardByKey.has(key) || !MI_DIA_CONNECTED_CARD_KEYS.has(key)) throw new MiDiaConfigurationError(400, 'MIDIA_CARD_UNKNOWN', 'La tarjeta no está disponible.');
    const maxScope = String(input.max_scope ?? 'OWN') as MiDiaScope;
    if (!SCOPE_ORDER.includes(maxScope)) throw new MiDiaConfigurationError(400, 'MIDIA_SCOPE_INVALID', 'El alcance no es válido.');
    return this.db.$transaction(async (tx) => {
      const membership = await tx.organizationMembership.findFirst({ where: {
        organization_id: actor.organizationId, user_id: userId, status: 'ACTIVE',
      }, select: { id: true } });
      if (!membership) throw new MiDiaConfigurationError(404, 'MIDIA_USER_NOT_FOUND', 'Usuario no encontrado en esta organización.');
      const row = await tx.miDiaCardPermission.upsert({ where: { organization_id_user_id_card_key: {
        organization_id: actor.organizationId, user_id: userId, card_key: key,
      } }, create: { organization_id: actor.organizationId, user_id: userId, card_key: key,
        enabled: input.enabled === true, max_scope: maxScope }, update: { enabled: input.enabled === true, max_scope: maxScope } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id,
        accion: 'SET_MI_DIA_CARD_PERMISSION', entidad: 'MiDiaCardPermission', entidad_id: row.id,
        valores_nuevos: { target_user_id: userId, card_key: key, enabled: row.enabled, max_scope: row.max_scope } } });
      return row;
    });
  }
}
