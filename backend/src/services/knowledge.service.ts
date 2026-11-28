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
const criterionKinds = new Set(['CRITERIO_INTERNO', 'ARANCEL_PROPIO', 'TABLA_HONORARIOS', 'REGLA_FORMULA']);
const reviewStatuses = new Set(['PENDIENTE', 'REVISADO']);
const approvalStatuses = new Set(['BORRADOR', 'APROBADO', 'RECHAZADO']);

export function normalizeCriterionScope(value: unknown, version = 1) {
  const scope = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const kind = clean(scope.kind, 40).toUpperCase();
  const jurisdiction = clean(scope.jurisdiction, 80).toUpperCase();
  const source = clean(scope.source, 500);
  const author = clean(scope.author, 240);
  const reviewStatus = clean(scope.review_status || 'PENDIENTE', 30).toUpperCase();
  const approvalStatus = clean(scope.approval_status || 'BORRADOR', 30).toUpperCase();
  if (!criterionKinds.has(kind) || !jurisdiction || !source || !author) {
    throw new KnowledgeValidationError('KNOW_CRITERION_SCOPE_REQUIRED', 'Define tipo, jurisdicción, fuente y autor del criterio interno.');
  }
  if (!reviewStatuses.has(reviewStatus) || !approvalStatuses.has(approvalStatus)) {
    throw new KnowledgeValidationError('KNOW_CRITERION_STATUS_INVALID', 'El estado de revisión o aprobación no es válido.');
  }
  const effectiveFrom = clean(scope.effective_from, 10);
  const effectiveTo = clean(scope.effective_to, 10);
  if ((effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) ||
      (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) ||
      (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo)) {
    throw new KnowledgeValidationError('KNOW_CRITERION_VALIDITY_INVALID', 'La vigencia del criterio no es válida.');
  }
  const amount = clean(scope.fixed_honorarium, 30);
  if (amount && (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)) {
    throw new KnowledgeValidationError('KNOW_CRITERION_AMOUNT_INVALID', 'El honorario fijo debe ser un importe positivo con máximo dos decimales.');
  }
  if (['ARANCEL_PROPIO', 'TABLA_HONORARIOS'].includes(kind) && !amount) {
    throw new KnowledgeValidationError('KNOW_CRITERION_AMOUNT_REQUIRED', 'El arancel propio requiere un honorario explícito; PRAVIA no lo inventará.');
  }
  return {
    kind, jurisdiction, state: clean(scope.state, 120).toUpperCase() || null,
    municipality: clean(scope.municipality, 160).toUpperCase() || null,
    act: clean(scope.act, 240).toUpperCase() || null,
    effective_from: effectiveFrom || null, effective_to: effectiveTo || null,
    source, author, review_status: reviewStatus, approval_status: approvalStatus,
    fixed_honorarium: amount || null,
    version: Math.max(1, Math.floor(Number(version) || 1)),
  };
}

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
  article_heading?: string | null;
  verification_status?: string;
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

export function relevantInternalCriteria(rows:any[],query:string,jurisdiction:string,legalDate:Date) {
  const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const terms=norm(query).split(/\W+/).filter(s=>s.length>3);
  const date=legalDate.toISOString().slice(0,10);
  return rows.filter(row=>{
    const s=row.scope||{};
    if(s.review_status!=='REVISADO'||s.approval_status!=='APROBADO')return false;
    if(s.effective_from&&s.effective_from>date||s.effective_to&&s.effective_to<date)return false;
    if(jurisdiction&&norm(s.jurisdiction||'')!==norm(jurisdiction))return false;
    return terms.some(term=>norm(`${row.title} ${row.content} ${s.act||''}`).includes(term));
  }).slice(0,8).map(row=>({id:row.id,code:row.code,title:row.title,content:row.content,scope:row.scope,label:'CRITERIO INTERNO — NO ES NORMA.',legal_effect:'Orientación interna; no sustituye legislación ni acredita vigencia de una norma.'}));
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

const legalKey = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().trim();
export function legalSearchTerms(query: string) {
  const plain = legalKey(query).replace(/\bARTICULO\s+(?:\d+[A-Z]?|UNICO|PRIMERO|SEGUNDO|TERCERO)(?:\s+(?:BIS|TER))?\b/g, ' ');
  const titleLabel = plain.match(/\b(?:CODIGO (?:CIVIL|FISCAL|PENAL)|LEY (?:DE INGRESOS|DE HACIENDA(?: MUNICIPAL)?|DEL NOTARIADO))\b/)?.[0] || '';
  const stop = new Set(['QUE','DICE','DIME','HABLA','SOBRE','ESTABLECE','SEGUN','PARA','PUEDES','PODRIAS','EXPLICA','BUSCA','DENTRO','BIBLIOTECA','DOCUMENTO','JURIDICA','VIGENTE','NAYARIT','JALISCO','ESTADO','DERECHO','ARTICULO','DEL','LAS','LOS','POR','CON','UNA','COMO']);
  const words = [...new Set((query.normalize('NFC').match(/[\p{L}]{3,}/gu) || []).filter(word => !stop.has(legalKey(word))))].slice(0, 18);
  return { titleLabel, keywords: words.join(' OR ') };
}

export function officialLegalDirectories(jurisdiction: string) {
  const federal = { title: 'Leyes federales · Cámara de Diputados', url: 'https://www.diputados.gob.mx/LeyesBiblio/index.htm' };
  if (legalKey(jurisdiction) === 'NAYARIT') return [{ title: 'Publicaciones oficiales · Nayarit', url: 'https://periodicooficial.nayarit.gob.mx/publicaciones' }, federal];
  return [federal];
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
    const scope = normalizeCriterionScope(input.scope, 1) as Prisma.InputJsonValue;
    try {
      return await this.db.$transaction(async (tx) => {
        const created = await tx.knowledgeCriterion.create({ data: {
          id: crypto.randomUUID(), organization_id: actor.organizationId, code, title, content,
          scope, active: input.active !== false, created_by_id: actor.id,
        } });
        await tx.auditLog.create({ data: {
          organization_id: actor.organizationId, user_id: actor.id,
          accion: 'CREAR_CRITERIO_INTERNO_CONOCIMIENTO', entidad: 'KnowledgeCriterion', entidad_id: created.id,
          detalles: { code, distinction: 'CRITERIO_INTERNO_NO_ES_NORMA' }, valores_nuevos: { title, content, scope },
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
    const currentScope = current.scope && typeof current.scope === 'object' && !Array.isArray(current.scope)
      ? current.scope as Record<string, unknown> : {};
    const nextScope = input.scope === undefined ? currentScope : input.scope;
    const scope = normalizeCriterionScope(nextScope, Number(currentScope.version || 0) + 1) as Prisma.InputJsonValue;
    return this.db.$transaction(async (tx) => {
      const updated = await tx.knowledgeCriterion.update({ where: { id: criterionId }, data: {
        title, content, scope,
        ...(input.active === undefined ? {} : { active: Boolean(input.active) }),
      } });
      await tx.auditLog.create({ data: {
        organization_id: actor.organizationId, user_id: actor.id,
        accion: 'ACTUALIZAR_CRITERIO_INTERNO_CONOCIMIENTO', entidad: 'KnowledgeCriterion', entidad_id: criterionId,
        detalles: { code: current.code, active: updated.active, distinction: 'CRITERIO_INTERNO_NO_ES_NORMA' },
        valores_anteriores: { title: current.title, content: current.content, scope: current.scope, active: current.active },
        valores_nuevos: { title: updated.title, content: updated.content, scope: updated.scope, active: updated.active },
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
      this.db.knowledgeSource.findMany({ where, include: { versions: { orderBy: { version: 'desc' }, take: 50, select:{id:true,version:true,label:true,verification_status:true,effective_from:true,effective_to:true} } }, orderBy: [{ jurisdiction: 'asc' }, { inventory_code: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
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
      if (!version?.content_text || !version.source.source_url || version.source.active === false) throw new KnowledgeValidationError('KNOW_VERSION_NOT_VERIFIABLE', 'La versión necesita texto, fuente activa y URL oficial antes de validarse.', 409);
      const nextEffectiveFrom = effectiveFrom ? new Date(`${effectiveFrom}T00:00:00Z`) : version.effective_from || new Date(`${new Date().toISOString().slice(0,10)}T00:00:00Z`);
      if (Number.isNaN(nextEffectiveFrom.getTime())) throw new KnowledgeValidationError('KNOW_EFFECTIVE_DATE_INVALID', 'La fecha inicial de vigencia no es válida.');
      if(effectiveFrom&&(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)||nextEffectiveFrom.toISOString().slice(0,10)!==effectiveFrom))throw new KnowledgeValidationError('KNOW_EFFECTIVE_DATE_INVALID','La fecha inicial debe existir en el calendario y usar AAAA-MM-DD.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`knowledge-verify:${actor.organizationId}:${sourceId}`}))`;
      // Reload after acquiring the lock: another verification may have completed while waiting.
      const current=await tx.knowledgeSourceVersion.findFirst({where:{id:versionId,source_id:sourceId,organization_id:actor.organizationId}});
      if(!current)throw new KnowledgeValidationError('KNOW_VERSION_NOT_FOUND','La versión no existe dentro de esta organización.',404);
      if(current.verification_status==='VERIFICADA'&&current.effective_from?.getTime()===nextEffectiveFrom.getTime())return current;
      if(current.verification_status!=='PENDIENTE')throw new KnowledgeValidationError('KNOW_VERSION_ALREADY_REVIEWED','La versión ya fue revisada. Su vigencia histórica no se modifica mediante otra verificación.',409);
      if(current.effective_to&&current.effective_to<nextEffectiveFrom)throw new KnowledgeValidationError('KNOW_EFFECTIVE_DATE_INVALID','La fecha final no puede ser anterior a la inicial.');
      const later=await tx.knowledgeSourceVersion.findFirst({where:{organization_id:actor.organizationId,source_id:sourceId,id:{not:versionId},verification_status:{in:['VERIFICADA','SUPERADA']},effective_from:{gte:nextEffectiveFrom}},select:{id:true}});
      if(later)throw new KnowledgeValidationError('KNOW_VALIDITY_CONFLICT','Ya existe una versión verificada con vigencia igual o posterior. Revisa las fechas; no se superponen versiones ni se reescriben históricos automáticamente.',409);
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
    if(Number.isNaN(legalDate.getTime()))throw new KnowledgeValidationError('KNOW_DATE_INVALID','La fecha de consulta no es válida.');
    if(input.legal_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(String(input.legal_date).trim())||legalDate.toISOString().slice(0,10)!==String(input.legal_date).trim()))throw new KnowledgeValidationError('KNOW_DATE_INVALID','La fecha de consulta debe existir en el calendario y usar AAAA-MM-DD.');
    const limit = Math.floor(Math.min(20, Math.max(1, Number(input.limit) || 8)));
    const articlePattern = exactArticleHeadingPattern(query);
    const { titleLabel, keywords } = legalSearchTerms(query);
    const municipality = legalKey(clean(input.municipality, 150));
    const includeDocumentReading = input.include_document_reading === true;
    const articleVector = Prisma.sql`to_tsvector('spanish', coalesce(a.body, ''))`;
    const documentVector = Prisma.sql`to_tsvector('spanish', coalesce(v.content_text, ''))`;
    const tsQuery = Prisma.sql`websearch_to_tsquery('spanish', ${keywords})`;
    // Translate before upper() so results are stable under both C and ICU
    // database collations. In C, accented lowercase letters are not uppercased.
    const sqlKey = (column: Prisma.Sql) => Prisma.sql`upper(translate(${column}, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'))`;
    const titleKey = sqlKey(Prisma.sql`s.title`);
    const jurisdictionKey = sqlKey(Prisma.sql`s.jurisdiction`);
    const headingKey = sqlKey(Prisma.sql`coalesce(a.heading, '')`);
    const titleMatches = Prisma.sql`(${titleLabel} <> '' AND position(${titleLabel} in ${titleKey}) > 0)`;
    const numberedVariant = String.raw`^\s*ARTICULO\s+[0-9]+[Oº]?[. ]*\s+(BIS|TER)\M`;
    const strictArticle = Prisma.sql`(${headingKey} ~* ${articlePattern.replace(/\[IÍ\]/g, 'I').replace(/[Úú]/g, 'U')} AND (${/\\s\+(?:BIS|TER)/.test(articlePattern)} OR ${headingKey} !~* ${numberedVariant}))`;
    const rows = await this.db.$queryRaw<KnowledgeEvidenceItem[]>(Prisma.sql`
      SELECT s.id AS source_id, s.inventory_code, s.title, v.version, v.label,
        left(coalesce(a.body, v.content_text, ''), 1200) AS article_fragment, s.source_url AS official_url,
        a.heading AS article_heading, v.verification_status::text AS verification_status,
        jsonb_build_object('from', v.effective_from, 'to', v.effective_to) AS validity,
        s.jurisdiction, s.category,
        (ts_rank_cd(CASE WHEN a.id IS NOT NULL THEN ${articleVector} ELSE ${documentVector} END, ${tsQuery}) * 20
          + similarity(s.title, ${query})
          + CASE WHEN ${titleMatches} THEN 10 ELSE 0 END
          + CASE WHEN s.inventory_code ILIKE ${`%${query}%`} THEN 3 ELSE 0 END) AS score
      FROM knowledge_sources s
      JOIN knowledge_source_versions v ON v.source_id = s.id AND v.organization_id = s.organization_id
      LEFT JOIN knowledge_articles a ON a.version_id = v.id AND a.organization_id = v.organization_id
      WHERE s.organization_id = ${actor.organizationId}::uuid AND s.active = true
        AND ((v.verification_status IN ('VERIFICADA', 'SUPERADA') AND v.effective_from <= ${legalDate}
          AND (v.effective_to IS NULL OR v.effective_to >= ${legalDate}) AND coalesce(a.body, v.content_text, '') <> '')
          OR (${includeDocumentReading} AND v.verification_status = 'PENDIENTE'
            AND (${titleMatches} OR s.inventory_code ILIKE ${query} OR similarity(s.title, ${query}) > 0.4)
            AND v.version = (SELECT max(latest.version) FROM knowledge_source_versions latest WHERE latest.source_id = s.id AND latest.organization_id = s.organization_id)))
        AND (${jurisdiction} = '' OR ${jurisdictionKey} = ${legalKey(jurisdiction)} OR (${municipality} <> '' AND ${jurisdictionKey} = ${municipality}))
        AND (${category} = '' OR s.category = ${category})
        AND (${titleLabel} = '' OR ${titleMatches})
        AND ((${articlePattern} <> '' AND (${strictArticle} OR (v.verification_status = 'PENDIENTE' AND coalesce(v.content_text, '') = '')))
          OR (${articlePattern} = '' AND (${titleMatches} OR ${articleVector} @@ ${tsQuery} OR (a.id IS NULL AND ${documentVector} @@ ${tsQuery})
            OR similarity(s.title, ${query}) > 0.25 OR s.inventory_code ILIKE ${query})))
      ORDER BY CASE WHEN v.verification_status = 'PENDIENTE' THEN 1 ELSE 0 END, score DESC, s.inventory_code ASC, a.ordinal ASC LIMIT ${includeDocumentReading ? limit * 2 : limit}
    `);
    const criteria=await this.db.knowledgeCriterion.findMany({where:{organization_id:actor.organizationId,active:true},select:{id:true,code:true,title:true,content:true,scope:true},take:200});
    const verified = rows.filter(row => row.verification_status !== 'PENDIENTE').map(row => ({ ...row, score: Number(row.score || 0) }));
    const readings = rows.filter(row => row.verification_status === 'PENDIENTE').slice(0, Math.min(4, limit)).map(({ score: _score, ...row }) => ({ ...row,
      reading_status: row.article_fragment ? 'LECTURA DOCUMENTAL SIN VIGENCIA VERIFICADA' : 'ORIGINAL CARGADO SIN TEXTO RECUPERABLE',
      normative_use: false,
    }));
    return {...buildEvidencePacket(verified, limit), internal_criteria:relevantInternalCriteria(criteria,query,jurisdiction,legalDate),
      document_readings: readings, official_directories: verified.length ? [] : officialLegalDirectories(jurisdiction || (/\bNAYARIT\b/i.test(query) ? 'NAYARIT' : '')) };
  }
}

export const knowledgeService = new KnowledgeService();
