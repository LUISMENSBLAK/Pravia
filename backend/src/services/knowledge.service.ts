import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';

export const INSUFFICIENT_LEGAL_FOUNDATION = 'NO SE LOCALIZÓ FUNDAMENTO SUFICIENTE EN LA BIBLIOTECA JURÍDICA ACTIVA.';

type Actor = { id: string; organizationId: string };
type InventoryRow = {
  inventory_code: string;
  title: string;
  jurisdiction: string;
  authority?: string | null;
  category: string;
  source_url?: string | null;
  applicability?: string | null;
  priority?: string | null;
  ingestion_status: string;
};

export class KnowledgeValidationError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
const allowedIngestion = new Set(['INVENTARIADA', 'PENDIENTE_ORIGINAL', 'PENDIENTE_TEXTO_OFICIAL', 'LISTA_PARA_INGESTA']);

export function normalizeInventoryRow(value: unknown): InventoryRow {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const inventory_code = clean(row.inventory_code ?? row.id ?? row.codigo, 80).toUpperCase();
  const title = clean(row.title ?? row.titulo ?? row.nombre, 500);
  const jurisdiction = clean(row.jurisdiction ?? row.jurisdiccion, 80).toUpperCase();
  const category = clean(row.category ?? row.categoria ?? row.tipo, 120).toUpperCase();
  if (!inventory_code || !title || !jurisdiction || !category) throw new KnowledgeValidationError('KNOW_INVENTORY_ROW_INVALID', 'Cada fuente requiere código, título, jurisdicción y categoría.');
  const rawIngestion = clean(row.ingestion_status ?? row.estado_ingesta ?? 'INVENTARIADA', 80).toUpperCase();
  const ingestion = rawIngestion === 'OBTENER ORIGINAL OFICIAL' ? 'PENDIENTE_ORIGINAL' : rawIngestion === 'OBTENER TEXTO OFICIAL' ? 'PENDIENTE_TEXTO_OFICIAL' : rawIngestion.replace(/ /g, '_');
  return {
    inventory_code, title, jurisdiction, category,
    authority: clean(row.authority ?? row.autoridad, 240) || null,
    source_url: clean(row.source_url ?? row.url, 2_000) || null,
    applicability: clean(row.applicability ?? row.aplicabilidad ?? row.uso_pravia, 20_000) || null,
    priority: clean(row.priority ?? row.prioridad, 12).toUpperCase() || null,
    ingestion_status: allowedIngestion.has(ingestion) ? ingestion : 'INVENTARIADA',
  };
}

export type KnowledgeEvidenceItem = {
  source_id: string;
  inventory_code: string;
  title: string;
  version: number;
  label: string;
  article_fragment: string;
  official_url: string | null;
  validity: { from: string | null; to: string | null };
  jurisdiction: string;
  category: string;
  score: number;
};

export function buildEvidencePacket(items: KnowledgeEvidenceItem[], limit = 8) {
  const evidence = items.slice(0, Math.max(1, Math.min(limit, 20)));
  return {
    status: evidence.length ? 'FOUNDATION_FOUND' : 'INSUFFICIENT_FOUNDATION',
    message: evidence.length ? null : INSUFFICIENT_LEGAL_FOUNDATION,
    evidence,
    internal_reasoning: null,
    disclosure: 'Se muestran conclusión, evidencia, fuente y explicación práctica; no razonamiento interno privado.',
  };
}

export function splitLegalArticles(content: string) {
  const normalized = content.replace(/\r\n?/g, '\n').trim();
  const markers = [...normalized.matchAll(/(?:^|\n)\s*(ART[IÍ]CULO\s+(?:\d+[A-Z]?(?:\s*BIS|\s*TER)?|[ÚU]NICO|PRIMERO|SEGUNDO|TERCERO)[^\n]*)/giu)];
  if (!markers.length) return [{ article_key: 'DOCUMENTO-COMPLETO', heading: 'Documento completo', body: normalized, ordinal: 1, metadata: { generated_from: 'full_text' } }];
  return markers.map((marker, index) => {
    const heading = marker[1].trim(); const start = (marker.index || 0) + marker[0].indexOf(marker[1]); const end = markers[index + 1]?.index ?? normalized.length;
    const token = heading.match(/ART[IÍ]CULO\s+([^\s.,:;]+)/iu)?.[1] || String(index + 1);
    return { article_key: `ART-${token.toUpperCase()}-${index + 1}`, heading, body: normalized.slice(start, end).trim(), ordinal: index + 1, metadata: { generated_from: 'official_text', heading } };
  });
}

export function exactArticleHeadingPattern(query: string) {
  const match = query.match(/\bart[ií]culo\s+(\d+[a-z]?|[úu]nico|primero|segundo|tercero)(?:\s+(bis|ter))?/iu);
  if (!match) return '';
  const article = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffix = match[2] ? `\\s+${match[2].toUpperCase()}` : '';
  const ordinal = /^\d+$/u.test(match[1]) ? '[Oº]?' : '';
  return `^\\s*ART[IÍ]CULO\\s+${article}${ordinal}${suffix}(?:\\s|[.,:;\\-]|$)`;
}

export class KnowledgeService {
  constructor(private db: PrismaClient = prisma) {}

  async listCriteria(actor: Actor, query: Record<string, unknown> = {}) {
    const includeInactive = query.include_inactive === 'true';
    const data = await this.db.knowledgeCriterion.findMany({
      where: { organization_id: actor.organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
    });
    return { data, distinction: 'CRITERIO INTERNO — NO ES NORMA.' };
  }

  async createCriterion(actor: Actor, input: Record<string, unknown>) {
    const code = clean(input.code, 80).toUpperCase();
    const title = clean(input.title, 300);
    const content = clean(input.content, 20_000);
    if (!code || !title || !content) throw new KnowledgeValidationError('KNOW_CRITERION_REQUIRED', 'El criterio requiere código, título y contenido.');
    const scope = input.scope && typeof input.scope === 'object' && !Array.isArray(input.scope)
      ? input.scope as Prisma.InputJsonValue
      : {};
    try {
      return await this.db.$transaction(async (tx) => {
        const created = await tx.knowledgeCriterion.create({ data: {
          id: crypto.randomUUID(), organization_id: actor.organizationId, code, title, content,
          scope, active: input.active !== false, created_by_id: actor.id,
        } });
        await tx.auditLog.create({ data: {
          organization_id: actor.organizationId, user_id: actor.id,
          accion: 'CREAR_CRITERIO_INTERNO_CONOCIMIENTO', entidad: 'KnowledgeCriterion', entidad_id: created.id,
          detalles: { code, distinction: 'CRITERIO_INTERNO_NO_ES_NORMA' },
        } });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new KnowledgeValidationError('KNOW_CRITERION_DUPLICATE', `Ya existe el criterio interno ${code}.`, 409);
      }
      throw error;
    }
  }

  async updateCriterion(actor: Actor, criterionId: string, input: Record<string, unknown>) {
    const current = await this.db.knowledgeCriterion.findFirst({ where: { id: criterionId, organization_id: actor.organizationId } });
    if (!current) throw new KnowledgeValidationError('KNOW_CRITERION_NOT_FOUND', 'El criterio interno no existe dentro de la organización.', 404);
    const title = input.title === undefined ? current.title : clean(input.title, 300);
    const content = input.content === undefined ? current.content : clean(input.content, 20_000);
    if (!title || !content) throw new KnowledgeValidationError('KNOW_CRITERION_REQUIRED', 'El criterio requiere título y contenido.');
    const scope = input.scope === undefined
      ? JSON.parse(JSON.stringify(current.scope)) as Prisma.InputJsonValue
      : input.scope && typeof input.scope === 'object' && !Array.isArray(input.scope) ? input.scope as Prisma.InputJsonValue : {};
    return this.db.$transaction(async (tx) => {
      const updated = await tx.knowledgeCriterion.update({ where: { id: criterionId }, data: {
        title, content, scope,
        ...(input.active === undefined ? {} : { active: Boolean(input.active) }),
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id,
        accion: 'ACTUALIZAR_CRITERIO_INTERNO_CONOCIMIENTO', entidad: 'KnowledgeCriterion', entidad_id: criterionId,
        detalles: { code: current.code, active: updated.active, distinction: 'CRITERIO_INTERNO_NO_ES_NORMA' },
      } });
      return updated;
    });
  }

  async list(actor: Actor, query: Record<string, unknown>) {
    const search = clean(query.search, 200);
    const jurisdiction = clean(query.jurisdiction, 80).toUpperCase();
    const category = clean(query.category, 120).toUpperCase();
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size) || 50));
    const where: Prisma.KnowledgeSourceWhereInput = {
      organization_id: actor.organizationId,
      active: query.include_inactive === 'true' ? undefined : true,
      ...(jurisdiction ? { jurisdiction } : {}),
      ...(category ? { category } : {}),
      ...(search ? { OR: [{ inventory_code: { contains: search, mode: 'insensitive' } }, { title: { contains: search, mode: 'insensitive' } }, { applicability: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const [data, total] = await Promise.all([
      this.db.knowledgeSource.findMany({ where, include: { versions: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: [{ jurisdiction: 'asc' }, { inventory_code: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.db.knowledgeSource.count({ where }),
    ]);
    return { data, pagination: { page, page_size: pageSize, total, pages: Math.ceil(total / pageSize) } };
  }

  async importInventory(actor: Actor, rows: unknown[], expectedCount?: number) {
    if (!Array.isArray(rows) || !rows.length) throw new KnowledgeValidationError('KNOW_INVENTORY_REQUIRED', 'El inventario no contiene filas.');
    const normalized = rows.map(normalizeInventoryRow);
    if (expectedCount !== undefined && normalized.length !== expectedCount) throw new KnowledgeValidationError('KNOW_INVENTORY_COUNT_MISMATCH', `Se esperaban ${expectedCount} fuentes y se recibieron ${normalized.length}.`, 409);
    const duplicate = normalized.find((row, index) => normalized.findIndex((candidate) => candidate.inventory_code === row.inventory_code) !== index);
    if (duplicate) throw new KnowledgeValidationError('KNOW_INVENTORY_DUPLICATE', `El código ${duplicate.inventory_code} está repetido.`);
    return this.db.$transaction(async (tx) => {
      let auditEntityId = '';
      for (const row of normalized) {
        const source = await tx.knowledgeSource.upsert({
          where: { organization_id_inventory_code: { organization_id: actor.organizationId, inventory_code: row.inventory_code } },
          create: { ...row, organization_id: actor.organizationId, created_by_id: actor.id },
          update: { title: row.title, jurisdiction: row.jurisdiction, authority: row.authority, category: row.category, source_url: row.source_url, applicability: row.applicability, priority: row.priority, ingestion_status: row.ingestion_status },
        });
        auditEntityId ||= source.id;
      }
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'IMPORTAR_INVENTARIO_CONOCIMIENTO', entidad: 'KnowledgeSource', entidad_id: auditEntityId, detalles: { rows: normalized.length, expected_count: expectedCount ?? null, checksum: crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex') } } });
      return { imported: normalized.length, expected: expectedCount ?? normalized.length, exact_count: expectedCount === undefined || expectedCount === normalized.length };
    });
  }

  async addVersion(actor: Actor, sourceId: string, input: Record<string, unknown>) {
    const source = await this.db.knowledgeSource.findFirst({ where: { id: sourceId, organization_id: actor.organizationId, active: true } });
    if (!source) throw new KnowledgeValidationError('KNOW_SOURCE_NOT_FOUND', 'La fuente no existe dentro de la organización.', 404);
    const content = clean(input.content_text, 5_000_000);
    const label = clean(input.label, 160);
    if (!content || !label) throw new KnowledgeValidationError('KNOW_VERSION_CONTENT_REQUIRED', 'La versión requiere etiqueta y texto oficial.');
    const latest = await this.db.knowledgeSourceVersion.aggregate({ where: { source_id: sourceId }, _max: { version: true } });
    return this.db.$transaction(async (tx) => {
      const created = await tx.knowledgeSourceVersion.create({ data: {
        organization_id: actor.organizationId, source_id: sourceId, version: (latest._max.version || 0) + 1, label,
        effective_from: input.effective_from ? new Date(`${clean(input.effective_from, 10)}T00:00:00Z`) : null,
        effective_to: input.effective_to ? new Date(`${clean(input.effective_to, 10)}T00:00:00Z`) : null,
        verification_status: 'PENDIENTE', content_text: content,
        checksum_sha256: crypto.createHash('sha256').update(content).digest('hex'),
        provenance: { imported_from: clean(input.imported_from, 500) || 'Carga administrativa', source_url: source.source_url }, created_by_id: actor.id,
      } });
      const articles = splitLegalArticles(content);
      await tx.knowledgeArticle.createMany({ data: articles.map((article) => ({ ...article, organization_id: actor.organizationId, version_id: created.id })) });
      return { ...created, articles_ingested: articles.length };
    });
  }

  async verifyVersion(actor: Actor, sourceId: string, versionId: string, effectiveFrom?: string) {
    return this.db.$transaction(async (tx) => {
      const version = await tx.knowledgeSourceVersion.findFirst({ where: { id: versionId, source_id: sourceId, organization_id: actor.organizationId }, include: { source: true } });
      if (!version?.content_text || !version.source.source_url) throw new KnowledgeValidationError('KNOW_VERSION_NOT_VERIFIABLE', 'La versión necesita texto y URL oficial antes de validarse.', 409);
      const nextEffectiveFrom = effectiveFrom ? new Date(`${effectiveFrom}T00:00:00Z`) : version.effective_from || new Date();
      if (Number.isNaN(nextEffectiveFrom.getTime())) throw new KnowledgeValidationError('KNOW_EFFECTIVE_DATE_INVALID', 'La fecha inicial de vigencia no es válida.');
      const priorEffectiveTo = new Date(nextEffectiveFrom); priorEffectiveTo.setUTCDate(priorEffectiveTo.getUTCDate() - 1);
      await tx.knowledgeSourceVersion.updateMany({
        where: { source_id: sourceId, organization_id: actor.organizationId, verification_status: 'VERIFICADA', id: { not: versionId }, OR: [{ effective_from: null }, { effective_from: { lt: nextEffectiveFrom } }] },
        data: { verification_status: 'SUPERADA', legal_status: 'HISTORICA', effective_to: priorEffectiveTo, review_required: false },
      });
      const now = new Date();
      const future = nextEffectiveFrom > now;
      const updated = await tx.knowledgeSourceVersion.update({ where: { id: versionId }, data: {
        verification_status: 'VERIFICADA', legal_status: future ? 'FUTURA' : 'VIGENTE',
        verified_by_id: actor.id, verified_at: now, effective_from: nextEffectiveFrom,
        activated_at: future ? null : now, review_required: false,
      } });
      await tx.knowledgeSource.update({ where: { id: sourceId }, data: { ingestion_status: 'LISTA_PARA_INGESTA' } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'VERIFICAR_FUENTE_CONOCIMIENTO', entidad: 'KnowledgeSourceVersion', entidad_id: versionId, detalles: { source_id: sourceId, checksum: version.checksum_sha256 } } });
      return updated;
    });
  }

  async retrieve(actor: Actor, input: Record<string, unknown>) {
    const query = clean(input.query, 500);
    if (query.length < 3) throw new KnowledgeValidationError('KNOW_QUERY_REQUIRED', 'Escribe una consulta de al menos tres caracteres.');
    const jurisdiction = clean(input.jurisdiction, 80).toUpperCase();
    const category = clean(input.category, 120).toUpperCase();
    const legalDate = input.legal_date ? new Date(`${clean(input.legal_date, 10)}T12:00:00Z`) : new Date();
    const limit = Math.min(20, Math.max(1, Number(input.limit) || 8));
    const articlePattern = exactArticleHeadingPattern(query);
    const rows = await this.db.$queryRaw<KnowledgeEvidenceItem[]>(Prisma.sql`
      SELECT s.id AS source_id, s.inventory_code, s.title, v.version, v.label,
        left(coalesce(a.body, v.content_text), 1200) AS article_fragment, s.source_url AS official_url,
        jsonb_build_object('from', v.effective_from, 'to', v.effective_to) AS validity,
        s.jurisdiction, s.category,
        (ts_rank_cd(to_tsvector('spanish', coalesce(a.body, v.content_text, '')), websearch_to_tsquery('spanish', ${query})) * 10
          + similarity(s.title, ${query})
          + CASE WHEN ${articlePattern} <> '' AND coalesce(a.heading, '') ~* ${articlePattern} THEN 100 ELSE 0 END
          + CASE WHEN s.inventory_code ILIKE ${`%${query}%`} THEN 3 ELSE 0 END) AS score
      FROM knowledge_sources s
      JOIN knowledge_source_versions v ON v.source_id = s.id AND v.organization_id = s.organization_id
      LEFT JOIN knowledge_articles a ON a.version_id = v.id AND a.organization_id = v.organization_id
      WHERE s.organization_id = ${actor.organizationId}::uuid AND s.active = true
        AND v.verification_status IN ('VERIFICADA', 'SUPERADA')
        AND (v.effective_from IS NULL OR v.effective_from <= ${legalDate})
        AND (v.effective_to IS NULL OR v.effective_to >= ${legalDate})
        AND (${jurisdiction} = '' OR s.jurisdiction = ${jurisdiction})
        AND (${category} = '' OR s.category = ${category})
        AND ((${articlePattern} <> '' AND coalesce(a.heading, '') ~* ${articlePattern})
          OR to_tsvector('spanish', coalesce(a.body, v.content_text, '')) @@ websearch_to_tsquery('spanish', ${query})
          OR similarity(s.title, ${query}) > 0.15 OR s.inventory_code ILIKE ${`%${query}%`})
      ORDER BY score DESC, s.inventory_code ASC LIMIT ${limit}
    `);
    return buildEvidencePacket(rows.map((row) => ({ ...row, score: Number(row.score || 0) })), limit);
  }
}

export const knowledgeService = new KnowledgeService();
