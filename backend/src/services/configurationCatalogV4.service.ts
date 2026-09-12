import { createHash, randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { CatalogoArtefactoTipo, CatalogoPropietarioTipo, Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { deleteFile, downloadFile, uploadFile } from './supabase.service';
import { CatalogConfigurationError } from './configurationCatalogError';
import {
  analyzeCatalogUpload,
  artifactCodeFromPath,
  catalogTree,
  CFG002_LIBRARY_CODE,
  CFG002_LIBRARY_SHA256,
  CFG002_LIBRARY_VERSION,
  normalizeStandardLibraryDirectory,
  standardLegalMetadata,
  type LegalMetadata,
  type SafeCatalogFile,
} from './configurationCatalogV4.domain';

type Actor = NonNullable<Express.Request['user']>;
type ImportAssignment = {
  act_ids?: string[];
  rules?: any[];
  normative?: Partial<LegalMetadata>;
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const safeSegment = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 150);
const displayName = (fileName: string) => fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const normalized = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toUpperCase();
const uniqueStrings = (value: unknown) => [...new Set(Array.isArray(value) ? value.map(String).filter(Boolean) : [])];

async function readLibrary() {
  const candidates = [
    path.resolve(process.cwd(), 'resources/cfg002/PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL.zip'),
    path.resolve(process.cwd(), 'backend/resources/cfg002/PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL.zip'),
  ];
  let buffer: Buffer | null = null;
  for (const candidate of candidates) {
    try { buffer = await readFile(candidate); break; } catch { /* try the next allowed repository path */ }
  }
  if (!buffer) throw new CatalogConfigurationError(500, 'CFG002_LIBRARY_FILE_MISSING', 'No se encontró la biblioteca estándar CFG-002 empacada con la aplicación.');
  if (sha(buffer) !== CFG002_LIBRARY_SHA256) throw new CatalogConfigurationError(500, 'CFG002_LIBRARY_CHECKSUM_MISMATCH', 'La biblioteca estándar CFG-002 no coincide con el checksum aprobado.');
  return buffer;
}

async function canonicalNotary(actor: Actor, createIfMissing = false) {
  const records = await prisma.notaria.findMany({
    where: { organization_id: actor.organizationId, archived_at: null },
    select: { id: true, nombre: true, numero_notaria: true, activa: true, predeterminada: true, created_at: true },
    orderBy: [{ predeterminada: 'desc' }, { activa: 'desc' }, { created_at: 'asc' }],
  });
  if (records[0] || !createIfMissing) return { notary: records[0] || null, legacyCount: Math.max(0, records.length - 1) };
  const organization = await prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } });
  const created = await prisma.notaria.create({ data: {
    organization_id: actor.organizationId, nombre: organization?.name || 'Notaría', predeterminada: true, activa: true,
  }, select: { id: true, nombre: true, numero_notaria: true, activa: true, predeterminada: true, created_at: true } });
  return { notary: created, legacyCount: 0 };
}

function normativeData(actor: Actor, artifactId: string, code: string, input?: Partial<LegalMetadata>) {
  const standard = standardLegalMetadata(code);
  const merged = { ...standard, ...input, condiciones: { ...(standard.condiciones || {}), ...(input?.condiciones || {}) } };
  return {
    organization_id: actor.organizationId, artefacto_id: artifactId,
    codigo_revision: `${code}:LEGAL`, revision: 1,
    fundamento_normativo: String(merged.fundamento_normativo), version_normativa: String(merged.version_normativa),
    tipo_cliente: merged.tipo_cliente || null, nacionalidad_condicion: merged.nacionalidad_condicion || null,
    regimen_simplificado: merged.regimen_simplificado ?? null, actividad_vulnerable: merged.actividad_vulnerable ?? null,
    requiere_bc: Boolean(merged.requiere_bc), requiere_riesgo: Boolean(merged.requiere_riesgo), requiere_pep: Boolean(merged.requiere_pep),
    requiere_perfil: Boolean(merged.requiere_perfil), requiere_alto_riesgo: Boolean(merged.requiere_alto_riesgo),
    vigencia_desde: merged.vigencia_desde ? new Date(merged.vigencia_desde) : null, condiciones_json: json(merged.condiciones || {}), creado_por_id: actor.id,
  };
}

function ruleData(actor: Actor, artifactId: string, normativeId: string, code: string, rule: any) {
  const multiplicity = ['EXPEDIENTE', 'COMPARECIENTE', 'INMUEBLE', 'CANTIDAD_FIJA'].includes(rule?.multiplicidad) ? rule.multiplicidad : 'EXPEDIENTE';
  return {
    organization_id: actor.organizationId, artefacto_id: artifactId,
    tipo_persona: ['FISICA', 'MORAL'].includes(rule?.tipo_persona) ? rule.tipo_persona : null,
    caracter_compareciente_id: rule?.caracter_compareciente_id || null, etapa_requerida_id: rule?.etapa_requerida_id || null,
    momento_limite_etapa_id: rule?.momento_limite_etapa_id || null, obligatoria: Boolean(rule?.obligatoria), multiplicidad: multiplicity,
    cantidad_fija: multiplicity === 'CANTIDAD_FIJA' ? Math.max(1, Number(rule?.cantidad_fija || 1)) : null,
    condiciones_json: json(rule?.condiciones || {}), activa: rule?.activa !== false,
    codigo_regla: `${code}:RULE`, revision: 1, normativa_revision_id: normativeId,
  };
}

async function validateActIds(actor: Actor, actIds: string[]) {
  if (!actIds.length) return;
  const count = await prisma.tipoActo.count({ where: { id: { in: actIds }, activo: true, archived_at: null, OR: [{ organization_id: actor.organizationId }, { organization_id: null }] } });
  if (count !== actIds.length) throw new CatalogConfigurationError(400, 'CFG002_IMPORT_ACT_INVALID', 'Uno o más actos asignados no son válidos para esta organización.');
}

async function persistFiles(input: {
  actor: Actor; files: SafeCatalogFile[]; ownerType: CatalogoPropietarioTipo; ownerId: string;
  type: CatalogoArtefactoTipo; parentId?: string | null; library?: boolean; idempotencyKey: string;
  bulk?: ImportAssignment; overrides?: Record<string, ImportAssignment>; directories?: string[];
}) {
  const { actor, files, ownerType, ownerId, type, library = false } = input;
  const completed = await prisma.catalogoBibliotecaImportacion.findUnique({ where: { organization_id_idempotency_key: { organization_id: actor.organizationId, idempotency_key: input.idempotencyKey } } });
  if (completed?.estado === 'COMPLETED') return { ...(completed.resultado_json as any), idempotent: true };
  const allActs = uniqueStrings(files.flatMap((file) => input.overrides?.[file.path]?.act_ids || input.bulk?.act_ids || []));
  await validateActIds(actor, allActs);
  const uploaded: string[] = [];
  const referenced = new Set<string>();
  const stored = files.map((file) => ({ file, storageKey: `organizations/${actor.organizationId}/catalogos/plantillas-formatos/${library ? 'standard/' : 'imports/'}${randomUUID()}_${safeSegment(file.name)}` }));
  try {
    for (const item of stored) { await uploadFile(item.file.buffer, item.storageKey, item.file.mimeType); uploaded.push(item.storageKey); }
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`cfg002:${actor.organizationId}:${input.idempotencyKey}`}))`);
      const existingImport = await tx.catalogoBibliotecaImportacion.findUnique({ where: { organization_id_idempotency_key: { organization_id: actor.organizationId, idempotency_key: input.idempotencyKey } } });
      if (existingImport?.estado === 'COMPLETED') return { ...(existingImport.resultado_json as any), idempotent: true };
      const batch = existingImport || await tx.catalogoBibliotecaImportacion.create({ data: {
        organization_id: actor.organizationId, idempotency_key: input.idempotencyKey,
        codigo_biblioteca: library ? CFG002_LIBRARY_CODE : 'USER_IMPORT', version_biblioteca: library ? CFG002_LIBRARY_VERSION : 'user',
        source_checksum: library ? CFG002_LIBRARY_SHA256 : sha(Buffer.from(files.map((file) => `${file.path}:${file.checksum}`).sort().join('|'))),
        estado: 'IN_PROGRESS', creado_por_id: actor.id,
      } });
      const folderCache = new Map<string, string>();
      const createdArtifacts: string[] = [];
      const ensureFolder = async (segments: string[], artifactType: CatalogoArtefactoTipo) => {
        let parentId: string | null = input.parentId || null;
        let accumulated = '';
        for (const segment of segments) {
          accumulated = accumulated ? `${accumulated}/${segment}` : segment;
          const code = library ? `${CFG002_LIBRARY_CODE}:${artifactType}:${accumulated}` : null;
          const cacheKey = `${artifactType}:${parentId || 'root'}:${segment}`;
          if (folderCache.has(cacheKey)) { parentId = folderCache.get(cacheKey)!; continue; }
          const existing = code
            ? await tx.catalogoCarpeta.findFirst({ where: { organization_id: actor.organizationId, codigo_biblioteca: code } })
            : await tx.catalogoCarpeta.findFirst({ where: { organization_id: actor.organizationId, propietario_tipo: ownerType, tipo: artifactType, notaria_id: ownerType === 'NOTARIA' ? ownerId : null, institucion_id: ownerType === 'INSTITUCION' ? ownerId : null, parent_id: parentId, nombre: segment, activa: true } });
          const folder = existing || await tx.catalogoCarpeta.create({ data: {
            organization_id: actor.organizationId, propietario_tipo: ownerType, tipo: artifactType,
            notaria_id: ownerType === 'NOTARIA' ? ownerId : null, institucion_id: ownerType === 'INSTITUCION' ? ownerId : null,
            parent_id: parentId, nombre: segment, codigo_biblioteca: code, ruta_biblioteca: library ? accumulated : null, activa: true,
          } });
          parentId = String(folder.id); folderCache.set(cacheKey, parentId);
        }
        return parentId;
      };
      for (const directory of input.directories || []) {
        let directoryType = type;
        let segments: string[];
        if (library) {
          const normalizedDirectory = normalizeStandardLibraryDirectory(directory);
          directoryType = normalizedDirectory.artifactType;
          segments = normalizedDirectory.segments;
        } else {
          segments = directory.split('/');
        }
        if (segments.length) await ensureFolder(segments, directoryType);
      }
      for (const item of stored) {
        let relative = item.file.path.replace(/^NOTARIA\//, '');
        let artifactType = type;
        if (library) {
          artifactType = relative.startsWith('Plantillas/') ? 'PLANTILLA' : 'FORMATO';
          relative = relative.replace(/^(Plantillas|Formatos)\//, '');
        }
        const parts = relative.split('/');
        const fileName = parts.pop()!;
        const folderId = await ensureFolder(parts, artifactType);
        const code = artifactCodeFromPath(item.file.path);
        const stableCode = library ? `${CFG002_LIBRARY_CODE}:${code}` : null;
        const prior = stableCode ? await tx.catalogoArtefacto.findFirst({ where: { organization_id: actor.organizationId, codigo_biblioteca: stableCode } }) : null;
        if (prior) continue;
        const assignment = { ...(input.bulk || {}), ...(input.overrides?.[item.file.path] || {}) };
        const artifact = await tx.catalogoArtefacto.create({ data: {
          organization_id: actor.organizationId, tipo: artifactType, propietario_tipo: ownerType,
          notaria_id: ownerType === 'NOTARIA' ? ownerId : null, institucion_id: ownerType === 'INSTITUCION' ? ownerId : null,
          carpeta_id: folderId, nombre: displayName(fileName), descripcion: library ? `Biblioteca estándar ${CFG002_LIBRARY_VERSION}` : null,
          codigo_biblioteca: stableCode, ruta_biblioteca: library ? item.file.path : null,
          activo: true, creado_por_id: actor.id, actualizado_por_id: actor.id,
        } });
        await tx.catalogoArtefactoVersion.create({ data: {
          organization_id: actor.organizationId, artefacto_id: artifact.id, version: 1, nombre_original: fileName,
          storage_key: item.storageKey, mime_type: item.file.mimeType, size_bytes: item.file.size, checksum_sha256: item.file.checksum,
          origen: library ? 'BIBLIOTECA_ESTANDAR_CLIENTE' : 'IMPORTACION_USUARIO', version_biblioteca: library ? CFG002_LIBRARY_VERSION : null,
          creado_por_id: actor.id,
        } });
        referenced.add(item.storageKey);
        const normative = await tx.catalogoNormativaRevision.create({ data: normativeData(actor, artifact.id, code, assignment.normative) });
        const actIds = uniqueStrings(assignment.act_ids);
        if (actIds.length) await tx.catalogoArtefactoActo.createMany({ data: actIds.map((actId) => ({ organization_id: actor.organizationId, artefacto_id: artifact.id, tipo_acto_id: actId })) });
        const rules = Array.isArray(assignment.rules) ? assignment.rules : [];
        for (let index = 0; index < rules.length; index += 1) await tx.catalogoArtefactoRegla.create({ data: { ...ruleData(actor, artifact.id, normative.id, `${code}:${index + 1}`, rules[index]), codigo_regla: `${code}:RULE:${index + 1}` } });
        createdArtifacts.push(artifact.id);
      }
      const result = { imported: createdArtifacts.length, files: files.length, artifacts: createdArtifacts, library_version: library ? CFG002_LIBRARY_VERSION : null };
      await tx.catalogoBibliotecaImportacion.update({ where: { id: batch.id }, data: { estado: 'COMPLETED', completed_at: new Date(), resultado_json: json(result) } });
      await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: library ? 'CFG002_STANDARD_LIBRARY_BOOTSTRAPPED' : 'CFG002_IMPORT_CONFIRMED', entidad: 'CatalogoBibliotecaImportacion', entidad_id: batch.id, valores_nuevos: json({ ...result, storage: '[PRIVATE]', checksum: library ? CFG002_LIBRARY_SHA256 : batch.source_checksum }), session_id: actor.sessionId } });
      return { ...result, idempotent: false };
    }, { timeout: 60_000 });
    // Concurrent retries can finish after their bytes were uploaded, and a partially
    // initialized standard library can already contain individual artifacts. Keep only
    // objects referenced by a version committed in this transaction.
    await Promise.all(uploaded.filter((key) => !referenced.has(key)).map((key) => deleteFile(key).catch(() => undefined)));
    return result;
  } catch (error) {
    await Promise.all(uploaded.map((key) => deleteFile(key).catch(() => undefined)));
    throw error;
  }
}

export const configurationCatalogV4Service = {
  canonicalNotary,

  async saveProjectAsNotaryTemplate(actor: Actor, expedienteId: string, projectVersionId: string, requestedName?: string) {
    const stableCode = `EXP010:${projectVersionId}`;
    const existing = await prisma.catalogoArtefacto.findFirst({ where: { organization_id: actor.organizationId, codigo_biblioteca: stableCode }, include: { versiones: true } });
    if (existing) return { artifact_id: existing.id, version_id: existing.versiones[0]?.id, idempotent: true };
    const project = await prisma.documento.findFirst({ where: { id: projectVersionId, organization_id: actor.organizationId, expediente_id: expedienteId, tipo: 'PROYECTO_ESCRITURA', estatus: { not: 'RECHAZADO' } } });
    if (!project) throw new CatalogConfigurationError(403, 'CFG002_PROJECT_ACCESS_DENIED', 'El proyecto no pertenece a este expediente u organización.');
    const { notary } = await canonicalNotary(actor, false);
    if (!notary) throw new CatalogConfigurationError(409, 'CFG002_CANONICAL_NOTARY_UNAVAILABLE', 'Inicializa la biblioteca de la Notaría antes de guardar una plantilla.');
    const buffer = await downloadFile(project.storage_key);
    const storageKey = `organizations/${actor.organizationId}/catalogos/plantillas-formatos/project-promotions/${randomUUID()}_${safeSegment(project.nombre_original)}`;
    await uploadFile(buffer, storageKey, project.mime_type);
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`cfg002:exp010:${actor.organizationId}:${projectVersionId}`}))`);
        const concurrent = await tx.catalogoArtefacto.findFirst({ where: { organization_id: actor.organizationId, codigo_biblioteca: stableCode }, include: { versiones: true } });
        if (concurrent) return { artifact_id: concurrent.id, version_id: concurrent.versiones[0]?.id, idempotent: true };
        const artifact = await tx.catalogoArtefacto.create({ data: {
          organization_id: actor.organizationId, tipo: 'PLANTILLA', propietario_tipo: 'NOTARIA', notaria_id: notary.id,
          nombre: requestedName?.trim() || displayName(project.nombre_original), descripcion: `Promovida explícitamente desde el proyecto del expediente ${expedienteId}.`,
          codigo_biblioteca: stableCode, activo: true, creado_por_id: actor.id, actualizado_por_id: actor.id,
        } });
        const version = await tx.catalogoArtefactoVersion.create({ data: {
          organization_id: actor.organizationId, artefacto_id: artifact.id, version: 1, nombre_original: project.nombre_original,
          storage_key: storageKey, mime_type: project.mime_type, size_bytes: buffer.length,
          checksum_sha256: project.checksum_sha256 || sha(buffer), origen: 'EXP010_PROJECT_PROMOTION', creado_por_id: actor.id,
        } });
        await tx.auditLog.create({ data: {
          organization_id: actor.organizationId, user_id: actor.id, accion: 'CFG002_PROJECT_SAVED_AS_NOTARY_TEMPLATE', entidad: 'CatalogoArtefacto', entidad_id: artifact.id,
          valores_nuevos: json({ expediente_id: expedienteId, project_version_id: projectVersionId, artifact_id: artifact.id, version_id: version.id, provenance: 'EXP-010', storage_key: '[PRIVATE]' }), session_id: actor.sessionId,
        } });
        return { artifact_id: artifact.id, version_id: version.id, idempotent: false };
      });
      if (result.idempotent) await deleteFile(storageKey).catch(() => undefined);
      return result;
    } catch (error) {
      await deleteFile(storageKey).catch(() => undefined);
      throw error;
    }
  },

  async bootstrap(actor: Actor, idempotencyKey = `${CFG002_LIBRARY_CODE}:${CFG002_LIBRARY_VERSION}`) {
    const previous = await prisma.catalogoBibliotecaImportacion.findFirst({ where: { organization_id: actor.organizationId, codigo_biblioteca: CFG002_LIBRARY_CODE, version_biblioteca: CFG002_LIBRARY_VERSION, source_checksum: CFG002_LIBRARY_SHA256, estado: 'COMPLETED' } });
    if (previous) return { ...(previous.resultado_json as any), idempotent: true };
    const { notary } = await canonicalNotary(actor, true);
    if (!notary) throw new CatalogConfigurationError(409, 'CFG002_CANONICAL_NOTARY_UNAVAILABLE', 'No se pudo resolver la Notaría canónica de la organización.');
    const buffer = await readLibrary();
    const directories: string[] = [];
    const packageRoot = 'PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL/';
    const files = (await analyzeCatalogUpload([{ buffer, originalname: 'PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL.zip', mimetype: 'application/zip', size: buffer.length } as Express.Multer.File], false, directories))
      .filter((file) => file.path.startsWith(`${packageRoot}NOTARIA/`))
      .map((file) => ({ ...file, path: file.path.slice(packageRoot.length) }));
    if (files.length !== 40) throw new CatalogConfigurationError(500, 'CFG002_LIBRARY_CONTENT_MISMATCH', `La biblioteca aprobada debe contener 40 archivos operativos; se encontraron ${files.length}.`);
    const acts = await prisma.tipoActo.findMany({ where: { activo: true, archived_at: null, OR: [{ organization_id: actor.organizationId }, { organization_id: null }] }, select: { id: true, nombre: true, codigo_catalogo: true } });
    const allActIds = acts.map((act) => act.id);
    const overrides = Object.fromEntries(files.map((file) => {
      const code = artifactCodeFromPath(file.path);
      if (code.startsWith('PRY-')) {
        const title = normalized(displayName(file.name).replace(/^PRY \d{3}\s+/, ''));
        const matched = acts.filter((act) => {
          const actName = normalized(act.nombre); const catalogCode = normalized(act.codigo_catalogo || '');
          const keywords = title.split(' ').filter((word) => word.length > 4);
          return Boolean(catalogCode && title.includes(catalogCode)) || keywords.some((word) => actName.includes(word));
        }).map((act) => act.id);
        return [file.path, { act_ids: matched, rules: matched.length ? [{ obligatoria: false, multiplicidad: 'EXPEDIENTE', condiciones: { fuente: 'BIBLIOTECA_ESTANDAR', aplicabilidad: 'ACTO_CONFIGURADO' } }] : [] }];
      }
      if (code.startsWith('PLD-')) {
        const legal = standardLegalMetadata(code);
        const multiplicidad = ['FISICA', 'MORAL'].includes(String(legal.tipo_cliente)) || ['PLD-A3', 'PLD-A4', 'PLD-A5', 'PLD-A6'].includes(code) ? 'COMPARECIENTE' : 'EXPEDIENTE';
        return [file.path, { act_ids: allActIds, rules: [{ tipo_persona: legal.tipo_cliente === 'FISICA' || legal.tipo_cliente === 'MORAL' ? legal.tipo_cliente : null, obligatoria: true, multiplicidad, condiciones: { fuente: 'MATRIZ_NORMATIVA_VERSIONADA', requiere_hechos_confirmados: true } }] }];
      }
      return [file.path, { act_ids: allActIds, rules: [] }];
    }));
    return persistFiles({ actor, files, ownerType: 'NOTARIA', ownerId: notary.id, type: 'FORMATO', library: true, idempotencyKey, overrides, directories: directories.filter((item) => item.startsWith(`${packageRoot}NOTARIA`)).map((item) => item.slice(packageRoot.length)) });
  },

  async preview(_actor: Actor, files: Express.Multer.File[]) {
    const directories: string[] = [];
    const analyzed = await analyzeCatalogUpload(files, false, directories);
    return { files: catalogTree(analyzed), folders: directories, total_files: analyzed.length, total_bytes: analyzed.reduce((sum, file) => sum + file.size, 0), requires_confirmation: true, persisted: false };
  },

  async confirm(actor: Actor, metadata: any, files: Express.Multer.File[], idempotencyKey: string) {
    if (!idempotencyKey) throw new CatalogConfigurationError(400, 'CFG002_IDEMPOTENCY_REQUIRED', 'La confirmación requiere una clave de idempotencia.');
    const ownerType = String(metadata.owner_type) as CatalogoPropietarioTipo;
    const type = String(metadata.type) as CatalogoArtefactoTipo;
    if (!Object.values(CatalogoPropietarioTipo).includes(ownerType) || !Object.values(CatalogoArtefactoTipo).includes(type)) throw new CatalogConfigurationError(400, 'CFG002_IMPORT_TARGET_INVALID', 'El destino de importación no es válido.');
    if (ownerType === 'INSTITUCION' && type === 'PLANTILLA') throw new CatalogConfigurationError(400, 'BANK_TEMPLATE_FORBIDDEN', 'Los Bancos y Fiduciarias sólo pueden contener Formatos.');
    const ownerId = String(metadata.owner_id || '');
    if (ownerType === 'NOTARIA') {
      const { notary } = await canonicalNotary(actor, false);
      if (!notary || notary.id !== ownerId) throw new CatalogConfigurationError(403, 'CFG002_CANONICAL_NOTARY_REQUIRED', 'CFG-002 sólo admite la Notaría canónica visible de la organización.');
    } else {
      const institution = await prisma.catalogoInstitucion.findFirst({ where: { id: ownerId, organization_id: actor.organizationId, activa: true } });
      if (!institution) throw new CatalogConfigurationError(403, 'CFG002_INSTITUTION_ACCESS_DENIED', 'La institución no pertenece a esta organización.');
    }
    const directories: string[] = [];
    const analyzed = await analyzeCatalogUpload(files, false, directories);
    return persistFiles({ actor, files: analyzed, ownerType, ownerId, type, parentId: metadata.parent_id || null, idempotencyKey, bulk: metadata.bulk || {}, overrides: metadata.overrides || {}, directories });
  },
};
