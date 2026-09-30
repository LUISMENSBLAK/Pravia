import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';

type Actor = { id: string; organizationId: string };

const NEVER_AUTOMATIC = new Set(['LEGAL', 'FISCAL', 'CUMPLIMIENTO', 'FINANZAS', 'RBAC', 'PLAZO', 'NORMATIVA']);
const ALLOWED_SCOPES = new Set(['PERSONAL', 'TEAM', 'ORGANIZATION', 'ACT', 'BANK', 'JURISDICTION', 'LEGAL', 'INTERNAL', 'VISUAL']);

export class AssistantMemoryError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

export class AssistantMemoryService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async list(actor: Actor, input: { category?: string; scope_type?: string; scope_id?: string } = {}) {
    return this.db.memoriaDespacho.findMany({
      where: {
        organization_id: actor.organizationId,
        active: true,
        approval_status: 'APPROVED',
        ...(input.category ? { categoria: input.category.toUpperCase() } : {}),
        ...(input.scope_type ? { scope_type: input.scope_type.toUpperCase() } : {}),
        ...(input.scope_id ? { scope_id: input.scope_id } : {}),
        OR: [{ user_id: null }, { user_id: actor.id }],
      },
      orderBy: [{ scope_type: 'asc' }, { updated_at: 'desc' }],
      take: 100,
    });
  }

  async propose(actor: Actor, input: Record<string, unknown>) {
    const category = String(input.category || '').trim().toUpperCase().slice(0, 80);
    const content = String(input.content || '').trim().slice(0, 10_000);
    const scopeType = String(input.scope_type || 'PERSONAL').trim().toUpperCase();
    if (!category || !content || !ALLOWED_SCOPES.has(scopeType)) throw new AssistantMemoryError('La memoria requiere categoría, contenido y alcance válidos.', 'AI_MEMORY_INVALID');
    const automatic = input.automatic === true;
    const restricted = NEVER_AUTOMATIC.has(category) || ['LEGAL', 'JURISDICTION'].includes(scopeType);
    const approved = automatic && !restricted;
    const record = await this.db.$transaction(async (tx) => {
      const created = await tx.memoriaDespacho.create({ data: {
        organization_id: actor.organizationId,
        user_id: scopeType === 'PERSONAL' ? actor.id : null,
        categoria: category,
        contenido: content,
        tipo_acto: input.tipo_acto ? String(input.tipo_acto).slice(0, 180) : null,
        institucion: input.institucion ? String(input.institucion).slice(0, 180) : null,
        tags: Array.isArray(input.tags) ? input.tags.slice(0, 20).map(String) : [],
        scope_type: scopeType,
        scope_id: input.scope_id ? String(input.scope_id) : null,
        source_type: automatic ? 'OBSERVED_PREFERENCE' : 'USER_SUGGESTED',
        source_reference: input.source_reference ? String(input.source_reference).slice(0, 500) : null,
        approval_status: approved ? 'APPROVED' : 'PENDING_REVIEW',
        approved_by_id: approved ? actor.id : null,
        approved_at: approved ? new Date() : null,
        last_confirmed_at: approved ? new Date() : null,
        confidence: input.confidence == null ? null : Number(input.confidence),
        created_by_id: actor.id,
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id,
        accion: approved ? 'AI_MEMORY_CREATED' : 'AI_MEMORY_PROPOSED', entidad: 'MemoriaDespacho', entidad_id: created.id,
        detalles: { category, scope_type: scopeType, automatic, restricted, origin: 'PRAVIA_IA' } as Prisma.InputJsonValue,
      } });
      return created;
    });
    return { ...record, requires_human_approval: !approved };
  }

  async decide(actor: Actor, memoryId: string, approved: boolean) {
    const current = await this.db.memoriaDespacho.findFirst({ where: { id: memoryId, organization_id: actor.organizationId, active: true } });
    if (!current) throw new AssistantMemoryError('La memoria no existe dentro de la organización.', 'AI_MEMORY_NOT_FOUND', 404);
    return this.db.$transaction(async (tx) => {
      const updated = await tx.memoriaDespacho.update({ where: { id: memoryId }, data: {
        approval_status: approved ? 'APPROVED' : 'REJECTED', approved_by_id: actor.id, approved_at: new Date(),
        last_confirmed_at: approved ? new Date() : current.last_confirmed_at, active: approved,
      } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: approved ? 'AI_MEMORY_APPROVED' : 'AI_MEMORY_REJECTED', entidad: 'MemoriaDespacho', entidad_id: memoryId, detalles: { origin: 'PRAVIA_IA' } } });
      return updated;
    });
  }
}

export const assistantMemoryService = new AssistantMemoryService();
