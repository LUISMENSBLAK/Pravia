import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../src/config/prisma';
import {
  classifyLegacyProject,
  verifyMigratedLegacyProject,
  type LegacyProjectCandidate,
  type LegacyProjectClassification,
} from '../src/domain/legacyProjectMigration';
import { projectRepository } from '../src/services/projectRepository.service';
import { deleteFile, downloadFile, getStorageInfo, uploadFile } from '../src/services/supabase.service';

type LegacyState = { versiones?: any[]; reportes?: any[] };
type FinalClassification = LegacyProjectClassification | 'MIGRADO_VERIFICADO';
type CandidateEntry = { candidate: LegacyProjectCandidate; legacy: any; folder: 'proyectos' | 'reportes_ia' };
type Verification = { verified: boolean; failures: string[] };

type AuditRow = {
  id: string;
  kind: LegacyProjectCandidate['kind'];
  expediente_id: string;
  version?: number;
  original_name: string;
  legacy_path: string;
  file_exists: boolean;
  actual_size?: number;
  sha256?: string;
  proposed_destination?: string;
  classification: FinalClassification;
  reason: string;
  legacy_created_at?: string;
  legacy_author?: string;
  resolved_author_id?: string;
  author_resolution: 'LEGACY_ID' | 'UNIQUE_NAME' | 'MIGRATION_ACTOR' | 'UNRESOLVED';
  migrated_document_id?: string;
  match_method?: 'LEGACY_SOURCE_ID' | 'SHA256' | 'CREATED';
  verification?: Verification;
  legacy: any;
};

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const argValue = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes('--apply');
const legacyRoot = path.resolve(argValue('legacy-root') || path.join(process.cwd(), 'uploads'));
const statePath = path.resolve(argValue('state') || path.join(legacyRoot, 'proyectos_db.json'));
const outputDir = argValue('output-dir') ? path.resolve(argValue('output-dir')!) : null;
const actorUserId = argValue('actor-user-id') || '';
const environmentLabel = argValue('environment-label') || '';
const expectedProjectRef = argValue('expected-project-ref') || '';

const sha256Buffer = (buffer: Buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const hashFile = (filePath: string) => {
  const buffer = fs.readFileSync(filePath);
  return { buffer, size: buffer.length, sha256: sha256Buffer(buffer) };
};

const projectCandidate = (item: any): LegacyProjectCandidate => ({
  source_id: String(item.id || ''),
  expediente_id: String(item.expediente_id || ''),
  kind: 'PROJECT_VERSION',
  file_name: String(item.archivo_file || ''),
  original_name: String(item.nombre_original || ''),
  version: Number(item.version_numero || 0) || undefined,
  expected_size: Number(item.size_bytes || 0) || undefined,
});

const reportCandidate = (item: any): LegacyProjectCandidate => ({
  source_id: `report:${String(item.expediente_id || '')}:${String(item.created_at || item.archivo_reporte_file || '')}`,
  expediente_id: String(item.expediente_id || ''),
  kind: 'AI_REPORT',
  file_name: String(item.archivo_reporte_file || ''),
  original_name: String(item.nombre_reporte || ''),
  version: Number(item.proyecto_version_numero || 0) || undefined,
});

const metadataRoot = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const namespaceFor = (kind: LegacyProjectCandidate['kind']) => kind === 'PROJECT_VERSION' ? 'proyecto' : 'reporte_ia_proyecto';
const typeFor = (kind: LegacyProjectCandidate['kind']) => kind === 'PROJECT_VERSION' ? 'PROYECTO_ESCRITURA' : 'REPORTE_IA_PROYECTO';
const linkStatusFor = (row: AuditRow) => row.kind === 'PROJECT_VERSION' && !row.legacy.es_vigente ? 'SUSTITUIDO' : 'ACTIVO';
const safeDate = (value: unknown) => {
  if (!value) return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};
const legacyCreatedAt = (entry: CandidateEntry) => entry.legacy.created_at || entry.legacy.fecha_carga || undefined;
const legacyAuthor = (entry: CandidateEntry) => entry.legacy.cargado_por_nombre || entry.legacy.solicitado_por || undefined;
const normalizedName = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const mimeFor = (fileName: string, legacy: any) => String(legacy.mime_type || '').trim() || (path.extname(fileName).toLowerCase() === '.docx' ? DOCX_MIME : 'application/octet-stream');

const legacySources = (document: any, kind: LegacyProjectCandidate['kind']) => {
  const meta = metadataRoot(metadataRoot(document.datos_extraidos)[namespaceFor(kind)]);
  return new Set<string>([
    meta.legacy_source_id,
    ...(Array.isArray(meta.legacy_source_ids) ? meta.legacy_source_ids : []),
  ].filter(Boolean).map(String));
};

const legacyHash = (document: any, kind: LegacyProjectCandidate['kind']) => {
  const meta = metadataRoot(metadataRoot(document.datos_extraidos)[namespaceFor(kind)]);
  return String(meta.legacy_sha256 || meta.checksum_sha256 || '').toLowerCase() || undefined;
};

function assertSafeEnvironment() {
  if (!outputDir) throw new Error('Se requiere --output-dir para conservar el reporte verificable.');
  if (!environmentLabel) throw new Error('Se requiere --environment-label con el nombre del entorno aislado validado.');
  if (!expectedProjectRef) throw new Error('Se requiere --expected-project-ref para fijar el proyecto Supabase esperado.');
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production' || /prod/i.test(environmentLabel)) {
    throw new Error('Esta herramienta se niega a conectarse cuando NODE_ENV o la etiqueta indican producción. Use una copia aislada verificada.');
  }
  const databaseUrl = new URL(process.env.DATABASE_URL || '');
  const supabaseUrl = new URL(process.env.SUPABASE_URL || '');
  const databaseMatch = databaseUrl.hostname.match(/^db\.([^.]+)\.supabase\.co$/i);
  const storageMatch = supabaseUrl.hostname.match(/^([^.]+)\.supabase\.co$/i);
  if (!databaseMatch || !storageMatch || databaseMatch[1] !== storageMatch[1]) {
    throw new Error('DATABASE_URL y SUPABASE_URL no pertenecen al mismo proyecto Supabase identificable.');
  }
  if (databaseMatch[1] !== expectedProjectRef) {
    throw new Error(`El proyecto Supabase real (${databaseMatch[1]}) no coincide con --expected-project-ref.`);
  }
  if (getStorageInfo().primary !== 'cloud') throw new Error('La migración requiere Storage cloud como primario.');
  if (apply) {
    if (process.env.LEGACY_PROJECT_MIGRATION_APPLY !== 'I_UNDERSTAND_THIS_WRITES_POSTGRES_AND_STORAGE') {
      throw new Error('Falta la confirmación explícita LEGACY_PROJECT_MIGRATION_APPLY.');
    }
    if (process.env.LEGACY_PROJECT_MIGRATION_ENVIRONMENT !== environmentLabel) {
      throw new Error('LEGACY_PROJECT_MIGRATION_ENVIRONMENT debe coincidir exactamente con --environment-label.');
    }
    if (!actorUserId) throw new Error('El modo apply requiere --actor-user-id.');
  }
}

function assertLegacyPaths() {
  if (!fs.existsSync(statePath) || !fs.statSync(statePath).isFile()) throw new Error(`No existe el inventario legacy: ${statePath}`);
  const relativeState = path.relative(legacyRoot, statePath);
  if (relativeState.startsWith('..') || path.isAbsolute(relativeState)) throw new Error('El inventario debe estar contenido dentro de --legacy-root.');
}

async function downloadIfPresent(storageKey: string) {
  try {
    return await downloadFile(storageKey);
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('not found') || message.includes('not_found') || message.includes('object not found')) return null;
    throw error;
  }
}

const publicRow = (row: AuditRow) => ({
  id: row.id,
  kind: row.kind,
  expediente_id: row.expediente_id,
  version: row.version,
  original_name: row.original_name,
  legacy_path: row.legacy_path,
  file_exists: row.file_exists,
  actual_size: row.actual_size,
  sha256: row.sha256,
  proposed_destination: row.proposed_destination,
  classification: row.classification,
  reason: row.reason,
  legacy_created_at: row.legacy_created_at,
  legacy_author: row.legacy_author,
  resolved_author_id: row.resolved_author_id,
  author_resolution: row.author_resolution,
  migrated_document_id: row.migrated_document_id,
  match_method: row.match_method,
  verification: row.verification,
});

const summaryFor = (rows: AuditRow[]) => ({
  TOTAL: rows.length,
  MIGRADOS_VERIFICADOS: rows.filter((row) => row.classification === 'MIGRADO_VERIFICADO').length,
  YA_MIGRADOS: rows.filter((row) => row.classification === 'YA_MIGRADO').length,
  MIGRABLES: rows.filter((row) => row.classification === 'MIGRABLE').length,
  ARCHIVOS_NO_DISPONIBLES: rows.filter((row) => row.classification === 'ARCHIVO_LOCAL_NO_DISPONIBLE').length,
  INCONSISTENTES: rows.filter((row) => row.classification === 'REFERENCIA_INCONSISTENTE').length,
  REQUIEREN_REVISION: rows.filter((row) => row.classification === 'REQUIERE_REVISION').length,
});

const markdown = (report: any) => {
  const lines = [
    '# LOCAL_LEGACY_MIGRATION_REPORT', '',
    `Modo: **${report.mode}**`,
    `Entorno validado: **${report.environment.label}**`,
    `Proyecto Supabase: **${report.environment.project_ref}**`,
    `Generado: ${report.generated_at}`, '',
    '## Resumen', '',
    ...Object.entries(report.summary).map(([key, value]) => `- ${key}: ${value}`), '',
    '## Comparación', '',
    `- Inventario legacy: ${report.comparison.legacy_inventory.project_versions} versiones, ${report.comparison.legacy_inventory.reports} reportes, ${report.comparison.legacy_inventory.files_present} archivos presentes y ${report.comparison.legacy_inventory.linked_expedientes} expedientes referidos.`,
    `- Proyectos/versiones modernos antes/después: ${report.comparison.before.project_versions} / ${report.comparison.after.project_versions}`,
    `- Reportes modernos antes/después: ${report.comparison.before.reports} / ${report.comparison.after.reports}`,
    `- Archivos modernos antes/después: ${report.comparison.before.files} / ${report.comparison.after.files}`,
    `- Vínculos modernos antes/después: ${report.comparison.before.links} / ${report.comparison.after.links}`,
    `- Expedientes vinculados antes/después: ${report.comparison.before.linked_expedientes} / ${report.comparison.after.linked_expedientes}`,
    `- Verificaciones 100% aprobadas: ${report.comparison.verified_rows}/${report.comparison.verifiable_rows}`, '',
    '## Registros', '',
    '| ID | Tipo | Expediente | Versión | Ruta legacy | Existe | Tamaño | SHA-256 | Destino | Estado | Motivo |',
    '| --- | --- | --- | ---: | --- | :---: | ---: | --- | --- | --- | --- |',
  ];
  for (const row of report.rows) {
    const safe = (value: unknown) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${safe(row.id)} | ${safe(row.kind)} | ${safe(row.expediente_id)} | ${safe(row.version)} | ${safe(row.legacy_path)} | ${row.file_exists ? 'Sí' : 'No'} | ${safe(row.actual_size)} | ${safe(row.sha256)} | ${safe(row.proposed_destination)} | ${safe(row.classification)} | ${safe(row.reason)} |`);
  }
  lines.push('', '## Condición para retirar el reader', '', 'Este reporte no autoriza el retiro de `LOCAL_LEGACY`. Se requiere autorización separada cuando todos los registros estén verificados o exceptuados conscientemente.');
  return `${lines.join('\n')}\n`;
};

const csv = (rows: any[]) => {
  const fields = ['id', 'kind', 'expediente_id', 'version', 'original_name', 'legacy_path', 'file_exists', 'actual_size', 'sha256', 'proposed_destination', 'classification', 'reason', 'legacy_created_at', 'legacy_author', 'resolved_author_id', 'author_resolution', 'migrated_document_id', 'match_method'];
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return `${fields.join(',')}\n${rows.map((row) => fields.map((field) => cell(row[field])).join(',')).join('\n')}\n`;
};

async function modernCounts() {
  const types = ['PROYECTO_ESCRITURA', 'REPORTE_IA_PROYECTO'];
  const [projectVersions, reports, links, linkedExpedientes] = await Promise.all([
    prisma.documento.count({ where: { tipo: 'PROYECTO_ESCRITURA' } }),
    prisma.documento.count({ where: { tipo: 'REPORTE_IA_PROYECTO' } }),
    prisma.expedienteDocumento.count({ where: { tipo_vinculo: { in: types } } }),
    prisma.expedienteDocumento.findMany({ where: { tipo_vinculo: { in: types } }, select: { expediente_id: true }, distinct: ['expediente_id'] }),
  ]);
  return {
    project_versions: projectVersions,
    reports,
    files: projectVersions + reports,
    links,
    linked_expedientes: linkedExpedientes.length,
  };
}

function mergeLegacyMetadata(document: any, row: AuditRow, actorId: string) {
  const root = metadataRoot(document?.datos_extraidos);
  const namespace = namespaceFor(row.kind);
  const previous = metadataRoot(root[namespace]);
  const sourceIds = [...new Set([previous.legacy_source_id, ...(Array.isArray(previous.legacy_source_ids) ? previous.legacy_source_ids : []), row.id].filter(Boolean).map(String))];
  const legacyCopy = JSON.parse(JSON.stringify(row.legacy || {}));
  delete legacyCopy.archivo_file;
  delete legacyCopy.archivo_reporte_file;
  const core = row.kind === 'PROJECT_VERSION'
    ? { version_numero: row.version || 1, es_version_final: Boolean(row.legacy.es_version_final), nota_version: row.legacy.nota_version || null }
    : legacyCopy;
  return {
    ...root,
    [namespace]: {
      ...previous,
      ...core,
      legacy_source_id: previous.legacy_source_id || row.id,
      legacy_source_ids: sourceIds,
      legacy_sha256: row.sha256,
      legacy_path: row.legacy_path,
      legacy_created_at: row.legacy_created_at || null,
      legacy_author: row.legacy_author || null,
      migration_actor_user_id: actorId,
      migration_environment: environmentLabel,
    },
  } as Prisma.InputJsonValue;
}

async function verifyRow(row: AuditRow) {
  const expectedType = typeFor(row.kind);
  const document = row.migrated_document_id ? await prisma.documento.findUnique({
    where: { id: row.migrated_document_id },
    include: { expedienteVinculos: { where: { expediente_id: row.expediente_id, tipo_vinculo: expectedType } } },
  }) : null;
  const sources = document ? legacySources(document, row.kind) : new Set<string>();
  const storedHash = document ? legacyHash(document, row.kind) : undefined;
  let storageBuffer: Buffer | null = null;
  let modernBuffer: Buffer | null = null;
  if (document) {
    storageBuffer = await downloadIfPresent(document.storage_key);
    const modern = row.kind === 'PROJECT_VERSION'
      ? await projectRepository.loadVersionBuffer(row.expediente_id, document.id)
      : await projectRepository.loadReportBuffer(row.expediente_id, document.id);
    modernBuffer = modern?.buffer || null;
  }
  const expectedHash = row.sha256 || storedHash;
  const decision = verifyMigratedLegacyProject({
    document_exists: Boolean(document),
    link_exists: Boolean(document?.expedienteVinculos.length),
    expediente_matches: document?.expediente_id === row.expediente_id,
    kind_matches: document?.tipo === expectedType,
    storage_key_matches: Boolean(document?.storage_key && document.storage_key === row.proposed_destination),
    metadata_source_matches: sources.has(row.id),
    metadata_hash_matches: Boolean(expectedHash && storedHash === expectedHash),
    storage_downloaded: Boolean(storageBuffer),
    storage_hash_matches: Boolean(storageBuffer && expectedHash && sha256Buffer(storageBuffer) === expectedHash),
    modern_repository_resolves: Boolean(modernBuffer),
    modern_repository_hash_matches: Boolean(modernBuffer && expectedHash && sha256Buffer(modernBuffer) === expectedHash),
  });
  row.verification = decision;
  if (!decision.verified) {
    row.classification = 'REQUIERE_REVISION';
    row.reason = `Verificación fallida: ${decision.failures.join(' ')}`;
  }
}

async function main() {
  assertLegacyPaths();
  assertSafeEnvironment();
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as LegacyState;
  const entries: CandidateEntry[] = [
    ...(state.versiones || []).map((legacy) => ({ candidate: projectCandidate(legacy), legacy, folder: 'proyectos' as const })),
    ...(state.reportes || []).map((legacy) => ({ candidate: reportCandidate(legacy), legacy, folder: 'reportes_ia' as const })),
  ];
  const sourceCounts = entries.reduce<Map<string, number>>((map, entry) => map.set(entry.candidate.source_id, (map.get(entry.candidate.source_id) || 0) + 1), new Map());
  const currentCounts = entries.filter((entry) => entry.candidate.kind === 'PROJECT_VERSION' && entry.legacy.es_vigente).reduce<Map<string, number>>((map, entry) => map.set(entry.candidate.expediente_id, (map.get(entry.candidate.expediente_id) || 0) + 1), new Map());
  const expedienteIds = [...new Set(entries.map((entry) => entry.candidate.expediente_id).filter(Boolean))];
  const [before, expedientes, existingDocuments, users] = await Promise.all([
    modernCounts(),
    prisma.expediente.findMany({ where: { id: { in: expedienteIds } }, select: { id: true } }),
    prisma.documento.findMany({ where: { tipo: { in: ['PROYECTO_ESCRITURA', 'REPORTE_IA_PROYECTO'] } }, include: { expedienteVinculos: true } }),
    prisma.user.findMany({ select: { id: true, nombre: true, apellido: true } }),
  ]);
  const existingExpedientes = new Set(expedientes.map((item) => item.id));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const usersByName = new Map<string, typeof users>();
  for (const user of users) {
    const name = normalizedName(`${user.nombre} ${user.apellido}`);
    usersByName.set(name, [...(usersByName.get(name) || []), user]);
  }
  const migratedBySource = new Map<string, any>();
  const modernByHash = new Map<string, any>();
  const versionsByExpediente = new Map<string, Set<number>>();
  for (const document of existingDocuments) {
    const kind: LegacyProjectCandidate['kind'] = document.tipo === 'PROYECTO_ESCRITURA' ? 'PROJECT_VERSION' : 'AI_REPORT';
    for (const source of legacySources(document, kind)) migratedBySource.set(source, document);
    let hash = legacyHash(document, kind);
    if (!hash) {
      const buffer = await downloadIfPresent(document.storage_key);
      if (buffer) hash = sha256Buffer(buffer);
    }
    if (hash && document.expediente_id) modernByHash.set(`${kind}:${document.expediente_id}:${hash}`, document);
    if (kind === 'PROJECT_VERSION' && document.expediente_id) {
      const meta = metadataRoot(metadataRoot(document.datos_extraidos).proyecto);
      if (Number(meta.version_numero)) {
        const set = versionsByExpediente.get(document.expediente_id) || new Set<number>();
        set.add(Number(meta.version_numero));
        versionsByExpediente.set(document.expediente_id, set);
      }
    }
  }

  const rows: AuditRow[] = entries.map((entry) => {
    const { candidate, legacy, folder } = entry;
    const localPath = path.resolve(legacyRoot, folder, candidate.file_name);
    const relative = path.relative(legacyRoot, localPath);
    const pathContained = !relative.startsWith('..') && !path.isAbsolute(relative);
    let fileEvidence: { size?: number; sha256?: string } = {};
    if (pathContained && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
      const hashed = hashFile(localPath);
      fileEvidence = { size: hashed.size, sha256: hashed.sha256 };
    }
    const bySource = migratedBySource.get(candidate.source_id);
    const byHash = fileEvidence.sha256 ? modernByHash.get(`${candidate.kind}:${candidate.expediente_id}:${fileEvidence.sha256}`) : undefined;
    const decision = classifyLegacyProject(candidate, {
      expediente_exists: existingExpedientes.has(candidate.expediente_id),
      file_exists: Boolean(fileEvidence.sha256),
      actual_size: fileEvidence.size,
      sha256: fileEvidence.sha256,
      already_migrated_document_id: bySource?.id,
      version_collision: candidate.kind === 'PROJECT_VERSION' && Boolean(candidate.version && versionsByExpediente.get(candidate.expediente_id)?.has(candidate.version)),
    });
    const legacyId = String(legacy.cargado_por_id || legacy.usuario_id || '');
    const nameMatches = usersByName.get(normalizedName(legacyAuthor(entry))) || [];
    const resolvedUser = usersById.get(legacyId) || (nameMatches.length === 1 ? nameMatches[0] : undefined);
    let classification: FinalClassification = decision.classification;
    let reason = decision.reason;
    let migratedDocument = bySource;
    let matchMethod: AuditRow['match_method'] = bySource ? 'LEGACY_SOURCE_ID' : undefined;
    if (bySource && fileEvidence.sha256 && legacyHash(bySource, candidate.kind) !== fileEvidence.sha256) {
      classification = 'MIGRABLE';
      reason = `El documento ${bySource.id} conserva el origen, pero requiere reconciliar y verificar su SHA-256.`;
    } else if (!bySource && byHash) {
      classification = 'MIGRABLE';
      reason = `El mismo SHA-256 ya existe en el documento ${byHash.id}; solo falta reconciliar la referencia legacy y verificarla.`;
      migratedDocument = byHash;
      matchMethod = 'SHA256';
    }
    if ((sourceCounts.get(candidate.source_id) || 0) > 1) {
      classification = 'REFERENCIA_INCONSISTENTE';
      reason = 'El identificador de origen legacy está duplicado en el inventario.';
    }
    if (candidate.kind === 'PROJECT_VERSION' && legacy.es_vigente && (currentCounts.get(candidate.expediente_id) || 0) > 1) {
      classification = 'REQUIERE_REVISION';
      reason = 'El expediente tiene más de una versión legacy marcada como vigente.';
    }
    const proposedDestination = migratedDocument?.storage_key || decision.proposed_storage_key;
    return {
      id: candidate.source_id,
      kind: candidate.kind,
      expediente_id: candidate.expediente_id,
      version: candidate.version,
      original_name: candidate.original_name,
      legacy_path: localPath,
      file_exists: Boolean(fileEvidence.sha256),
      actual_size: fileEvidence.size,
      sha256: fileEvidence.sha256 || (migratedDocument ? legacyHash(migratedDocument, candidate.kind) : undefined),
      proposed_destination: proposedDestination,
      classification,
      reason,
      legacy_created_at: legacyCreatedAt(entry),
      legacy_author: legacyAuthor(entry),
      resolved_author_id: resolvedUser?.id,
      author_resolution: usersById.has(legacyId) ? 'LEGACY_ID' : nameMatches.length === 1 ? 'UNIQUE_NAME' : apply ? 'MIGRATION_ACTOR' : 'UNRESOLVED',
      migrated_document_id: migratedDocument?.id,
      match_method: matchMethod,
      legacy,
    };
  });

  let actor: { id: string } | null = null;
  if (apply) {
    actor = await prisma.user.findFirst({ where: { id: actorUserId, activo: true }, select: { id: true } });
    if (!actor) throw new Error('El actor de migración no existe o está inactivo.');
    for (const row of rows.filter((item) => item.classification === 'MIGRABLE')) {
      const authorId = row.resolved_author_id || actor.id;
      row.resolved_author_id = authorId;
      if (!row.resolved_author_id || row.author_resolution === 'UNRESOLVED') row.author_resolution = 'MIGRATION_ACTOR';
      let uploadedThisRun = false;
      if (!row.migrated_document_id) {
        const local = hashFile(row.legacy_path);
        if (local.sha256 !== row.sha256 || local.size !== row.actual_size) {
          row.classification = 'REQUIERE_REVISION';
          row.reason = 'El archivo cambió después del inventario; no se migró.';
          continue;
        }
        const remote = await downloadIfPresent(row.proposed_destination!);
        if (remote && sha256Buffer(remote) !== row.sha256) {
          row.classification = 'REQUIERE_REVISION';
          row.reason = 'La clave propuesta ya existe en Storage con un hash diferente.';
          continue;
        }
        if (!remote) {
          await uploadFile(local.buffer, row.proposed_destination!, mimeFor(row.original_name, row.legacy));
          uploadedThisRun = true;
        }
      }
      try {
        const document = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`legacy-project:${row.id}`}))`);
          let current = row.migrated_document_id ? await tx.documento.findUnique({ where: { id: row.migrated_document_id } }) : await tx.documento.findUnique({ where: { storage_key: row.proposed_destination! } });
          if (current) {
            await tx.documento.update({ where: { id: current.id }, data: { datos_extraidos: mergeLegacyMetadata(current, row, actor!.id) } });
          } else {
            if (row.kind === 'PROJECT_VERSION' && row.legacy.es_vigente) {
              await tx.expedienteDocumento.updateMany({
                where: { expediente_id: row.expediente_id, tipo_vinculo: 'PROYECTO_ESCRITURA', estatus: 'ACTIVO' },
                data: { estatus: 'SUSTITUIDO', inactivado_at: new Date(), inactivado_por_id: actor!.id, motivo_inactivacion: 'Migración controlada de proyecto legacy vigente' },
              });
            }
            current = await tx.documento.create({
              data: {
                nombre_original: row.original_name,
                nombre_interno: row.proposed_destination!,
                storage_key: row.proposed_destination!,
                tipo: typeFor(row.kind),
                categoria: 'PROYECTO',
                mime_type: mimeFor(row.original_name, row.legacy),
                size_bytes: row.actual_size!,
                fecha_carga: safeDate(row.legacy_created_at) || new Date(),
                subido_por_id: authorId,
                expediente_id: row.expediente_id,
                estatus: 'VIGENTE',
                observaciones: `Migrado desde ${row.id}`,
                datos_extraidos: mergeLegacyMetadata(null, row, actor!.id),
              },
            });
          }
          await tx.expedienteDocumento.upsert({
            where: { expediente_id_documento_id_tipo_vinculo: { expediente_id: row.expediente_id, documento_id: current.id, tipo_vinculo: typeFor(row.kind) } },
            create: {
              expediente_id: row.expediente_id,
              documento_id: current.id,
              tipo_vinculo: typeFor(row.kind),
              fecha_vinculo: safeDate(row.legacy_created_at) || new Date(),
              creado_por_id: authorId,
              estatus: linkStatusFor(row),
              observaciones: `Migración legacy · SHA-256 ${row.sha256}`,
            },
            update: { observaciones: `Migración legacy · SHA-256 ${row.sha256}` },
          });
          await tx.auditLog.create({
            data: {
              user_id: actor!.id,
              accion: row.migrated_document_id ? 'RECONCILE_LEGACY_PROJECT' : 'MIGRATE_LEGACY_PROJECT',
              entidad: 'Documento',
              entidad_id: current.id,
              valores_nuevos: { legacy_source_id: row.id, legacy_sha256: row.sha256, expediente_id: row.expediente_id, environment: environmentLabel },
            },
          });
          return current;
        });
        row.migrated_document_id = document.id;
        row.proposed_destination = document.storage_key;
        row.match_method = row.match_method || 'CREATED';
        row.classification = 'MIGRADO_VERIFICADO';
        row.reason = 'Migrado y pendiente de verificación automática final.';
      } catch (error) {
        if (uploadedThisRun) await deleteFile(row.proposed_destination!).catch(() => undefined);
        throw error;
      }
    }
  }

  for (const row of rows.filter((item) => item.classification === 'MIGRADO_VERIFICADO' || item.classification === 'YA_MIGRADO')) {
    await verifyRow(row);
    if (row.verification?.verified) {
      row.reason = row.classification === 'MIGRADO_VERIFICADO'
        ? 'Storage, hash, DB, vínculo y resolución moderna verificados.'
        : 'Migración preexistente verificada por Storage, hash, DB, vínculo y resolución moderna.';
    }
  }

  const after = await modernCounts();
  const verifiableRows = rows.filter((row) => row.classification === 'MIGRADO_VERIFICADO' || row.classification === 'YA_MIGRADO' || row.verification).length;
  const verifiedRows = rows.filter((row) => row.verification?.verified).length;
  const report = {
    mode: apply ? 'APPLY_AND_VERIFY' : 'DRY_RUN_READ_ONLY',
    generated_at: new Date().toISOString(),
    source: statePath,
    environment: { label: environmentLabel, project_ref: expectedProjectRef, production: false },
    summary: summaryFor(rows),
    comparison: {
      legacy_inventory: {
        project_versions: entries.filter((entry) => entry.candidate.kind === 'PROJECT_VERSION').length,
        reports: entries.filter((entry) => entry.candidate.kind === 'AI_REPORT').length,
        files_present: rows.filter((row) => row.file_exists).length,
        linked_expedientes: new Set(rows.map((row) => row.expediente_id).filter(Boolean)).size,
      },
      before,
      after,
      verifiable_rows: verifiableRows,
      verified_rows: verifiedRows,
    },
    rows: rows.map(publicRow),
    reader_removed: false,
    legacy_files_deleted: false,
  };
  fs.mkdirSync(outputDir!, { recursive: true });
  fs.writeFileSync(path.join(outputDir!, 'LOCAL_LEGACY_MIGRATION_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir!, 'LOCAL_LEGACY_MIGRATION_REPORT.md'), markdown(report));
  fs.writeFileSync(path.join(outputDir!, 'LOCAL_LEGACY_MIGRATION_REPORT.csv'), csv(report.rows));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main()
  .catch((error) => { process.stderr.write(`No fue posible auditar/migrar proyectos legacy: ${error.message}\n`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
