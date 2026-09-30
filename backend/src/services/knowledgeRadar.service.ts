import crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { splitLegalArticles } from './knowledge.service';

type Actor = { id: string; organizationId: string };
const ALLOWED_LEGAL_STATUS = new Set(['VIGENTE', 'FUTURA', 'HISTORICA', 'BORRADOR', 'PENDIENTE_VERIFICAR', 'VERSION_ANTICIPADA']);

export class KnowledgeRadarError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

export class KnowledgeRadarService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async detect(actor: Actor, sourceId: string, input: Record<string, unknown>) {
    const source = await this.db.knowledgeSource.findFirst({ where: { id: sourceId, organization_id: actor.organizationId, active: true }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!source) throw new KnowledgeRadarError('La fuente no existe dentro de la organización.', 'KNOW_RADAR_SOURCE_NOT_FOUND', 404);
    const content = String(input.content_text || '').trim();
    const sourceUrl = String(input.source_url || source.source_url || '').trim();
    const legalStatus = String(input.legal_status || 'PENDIENTE_VERIFICAR').toUpperCase();
    if (!content || !sourceUrl || !ALLOWED_LEGAL_STATUS.has(legalStatus)) throw new KnowledgeRadarError('La detección requiere texto, URL oficial y estado jurídico válido.', 'KNOW_RADAR_INPUT_INVALID');
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    const prior = source.versions[0];
    if (prior?.checksum_sha256 === checksum) return { changed: false, version: prior, run: null };
    return this.db.$transaction(async (tx) => {
      const version = await tx.knowledgeSourceVersion.create({ data: {
        organization_id: actor.organizationId, source_id: source.id, version: (prior?.version || 0) + 1,
        label: String(input.label || `Detección ${new Date().toISOString().slice(0, 10)}`).slice(0, 160),
        effective_from: input.effective_from ? new Date(`${String(input.effective_from).slice(0, 10)}T00:00:00Z`) : null,
        verification_status: 'PENDIENTE', legal_status: legalStatus, detected_at: new Date(), review_required: true,
        content_text: content, checksum_sha256: checksum,
        provenance: { source_url: sourceUrl, detected_by: 'NORMATIVE_RADAR', autoactivated: false } as Prisma.InputJsonValue,
        created_by_id: actor.id,
      } });
      await tx.knowledgeArticle.createMany({ data: splitLegalArticles(content).map((article) => ({ ...article, organization_id: actor.organizationId, version_id: version.id })) });
      const run = await tx.knowledgeRadarRun.create({ data: {
        organization_id: actor.organizationId, source_version_id: version.id, source_url: sourceUrl,
        previous_checksum: prior?.checksum_sha256 || null, detected_checksum: checksum,
        diff_summary: { previous_version: prior?.version || null, detected_version: version.version, autoactivated: false } as Prisma.InputJsonValue,
        created_by_id: actor.id,
      } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'KNOWLEDGE_RADAR_DETECTED', entidad: 'KnowledgeRadarRun', entidad_id: run.id, detalles: { source_id: source.id, version_id: version.id, autoactivated: false } } });
      return { changed: true, version, run };
    });
  }

  async registerImpact(actor: Actor, runId: string, input: Record<string, unknown>) {
    const run = await this.db.knowledgeRadarRun.findFirst({ where: { id: runId, organization_id: actor.organizationId } });
    if (!run) throw new KnowledgeRadarError('La detección no existe dentro de la organización.', 'KNOW_RADAR_RUN_NOT_FOUND', 404);
    const entityType = String(input.entity_type || '').trim().slice(0, 80);
    const impactType = String(input.impact_type || '').trim().slice(0, 80);
    const summary = String(input.summary || '').trim().slice(0, 20_000);
    if (!entityType || !impactType || !summary) throw new KnowledgeRadarError('El impacto requiere entidad, tipo y resumen.', 'KNOW_RADAR_IMPACT_INVALID');
    return this.db.knowledgeImpact.create({ data: {
      organization_id: actor.organizationId, radar_run_id: run.id, source_version_id: run.source_version_id,
      entity_type: entityType, entity_id: input.entity_id ? String(input.entity_id) : null, impact_type: impactType, summary,
    } });
  }
}

export const knowledgeRadarService = new KnowledgeRadarService();
