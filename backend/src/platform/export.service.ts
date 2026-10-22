import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import archiver from 'archiver';
import yauzl from 'yauzl';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '../config/prisma';
import { getStorageProvider } from '../storage/storage.service';
import type { StorageProvider } from '../storage/storage.types';
import { BackgroundJobsService } from './backgroundJobs.service';
import { PlatformDomainError, serializeBigInts } from './platform.errors';
import { TrackedStorageService } from './trackedStorage.service';

const EXPORT_SCOPES = [
  'TENANT', 'USUARIOS', 'COMPARECIENTES', 'PROSPECTOS', 'COTIZACIONES', 'EXPEDIENTES',
  'ACTOS', 'PREDIOS', 'ARCHIVO', 'AGENDA', 'FINANZAS', 'DOCUMENTOS', 'RELACIONES',
  'CUMPLIMIENTO', 'CONOCIMIENTO', 'CONFIGURACION',
] as const;
type ExportScope = typeof EXPORT_SCOPES[number];

// Only tenant-owned business data belongs in the portable archive. Platform
// operations, credentials, sessions, provider accounting and transient jobs are
// intentionally absent. Keep this explicit: new Prisma models are not exported
// merely because they happen to acquire an organization_id column.
const ADDITIONAL_EXPORT_MODELS: Partial<Record<ExportScope, readonly string[]>> = {
  TENANT: [
    'MiDiaUserLayout', 'MiDiaPersonalTask', 'Notification', 'NotificationReminder',
    'AuditLog', 'AssistantConversation', 'AssistantMessage', 'AssistantAttachment',
    'Notaria', 'NotariaContacto',
  ],
  COMPARECIENTES: [
    'ComparecienteDatoFuente', 'ComparecienteAlias', 'ComparecienteActividadEconomica',
    'PersonaMoralOwnershipStructure', 'PersonaMoralOwnershipNode', 'PersonaMoralOwnershipEdge',
    'PersonaMoralControlFact', 'PersonaMoralStructureReconciliation', 'ComparecienteFiscalProfile',
  ],
  PROSPECTOS: ['ProspectoRevisionDocumental', 'ProspectoFuenteNotarial', 'ProspectoSeguimiento'],
  COTIZACIONES: ['CotizacionSeguimiento', 'CotizacionIAProposal'],
  EXPEDIENTES: [
    'ExpedienteEstatus_Log', 'ExpedienteEtapa', 'ExpedienteActividad',
    'ExpedientePresupuesto', 'ExpedientePresupuestoConcepto', 'ExpedientePresupuestoDistribucion',
    'ExpedientePresupuestoDocumento', 'ExpedienteSeguimientoActividad', 'ExpedienteSeguimientoOrigen',
    'ExpedienteCuestionarioRespuesta', 'ExpedienteSeguimientoDependencia',
    'ExpedienteSeguimientoHistorial', 'ExpedienteArtefactoPendiente', 'ExpedienteArtefactoDocumento',
    'ExpedienteDocumentoCarpeta', 'ExpedienteDocumentoSnapshot', 'ExpedienteDocumentoSnapshotItem',
    'ProjectFactSnapshot', 'ProjectInstructionApplication', 'ProjectTemplateAssignment',
    'ExpedienteEntrega', 'ExpedienteSocietyTarget',
  ],
  ACTOS: [
    'ConfiguracionActo', 'ConfiguracionEtapa', 'ConfiguracionActividad',
    'ConfiguracionDependencia', 'ConfiguracionExcepcion', 'ConfiguracionExcepcionDependencia',
    'ConfiguracionConceptoActividad', 'CatalogoInstitucion', 'CatalogoInstitucionTipoRespuesta',
    'CatalogoCarpeta', 'CatalogoArtefacto', 'CatalogoArtefactoDestino', 'CatalogoArtefactoVersion',
    'CatalogoCuestionarioFormato', 'CatalogoArtefactoActo', 'CatalogoArtefactoRegla',
    'CatalogoNormativaRevision', 'CatalogoBibliotecaImportacion',
  ],
  PREDIOS: ['PredioColindancia', 'PredioDatoFuente'],
  ARCHIVO: ['ExpedienteRequisitoDoc', 'RequisitoDocumentoVinculo'],
  AGENDA: [
    'EventoAgendaParticipante', 'Tarea', 'TareaExterna', 'Comunicacion', 'Nota',
    'MemoriaDespacho', 'AssistantAlert',
  ],
  FINANZAS: [
    'CategoriaFinanciera', 'CuentaFinanciera', 'HonorarioGenerado', 'MetaHonorario',
    'MovimientoDistribucion', 'ComprobanteFinanciero', 'ExpedienteIngresoReportado',
    'ExpedienteSolicitudPago', 'ExpedienteFinanzaDocumento', 'ExpedienteFinanzaPropuestaIA',
    'TransaccionEstadoCuenta', 'ConciliacionFinanciera', 'Pago',
    'GastoRecurrenteFinanciero', 'ConsultaFinancieraGuardada',
    'CalculoISR', 'CalculoISRVersion', 'CalculoISRDocumento', 'CalculoISRPropuesta',
    'EntidadFiscalCfdi', 'EntidadFiscalCuenta', 'ConceptoFiscalCfdi', 'ProveedorFiscal',
    'DocumentoCfdi', 'CuentaPorCobrarCfdi', 'CuentaPorPagarCfdi', 'AplicacionPagoCfdi',
    'TransferenciaInterna',
  ],
  RELACIONES: ['ExpedienteRepresentacion', 'ComunicacionDocumento'],
  CUMPLIMIENTO: [
    'ComplianceReview', 'ComplianceAssistedReview', 'ComplianceDecision', 'ComplianceEvidence',
    'CompliancePartySnapshot', 'ComplianceBeneficialOwner', 'CompliancePepReview',
    'ComplianceScreeningResult', 'ScreeningSource', 'ScreeningSourceVersion',
    'ScreeningSourceExecution', 'ScreeningSourceExecutionAttempt', 'ScreeningCandidate',
    'ScreeningHumanResolution', 'ScreeningOperationSnapshot', 'ScreeningReport',
    'CompliancePayment', 'ComplianceObligation', 'ComplianceOfficialDefinitionActivation',
    'ComplianceObligationTrigger', 'ComplianceNoticeFicheRevision', 'ComplianceOfficialProduct',
    'ComplianceNoticePresentation', 'ComplianceNoticeAcknowledgement', 'ComplianceLegalRule',
    'ComplianceLegalRuleRevision', 'ExpedienteComplianceState', 'ComplianceRuleResult',
    'ComplianceAlertLeadRevision', 'ComplianceRequirement', 'ComplianceRequirementException',
    'ComplianceAlert', 'ComplianceEvent', 'ComplianceAiProposal',
    'ComplianceQuestionnaireAssessment', 'ComplianceQuestionnaireAssessmentRevision',
    'ComplianceRiskMethodology', 'ComplianceRiskMethodologyRevision',
    'ComplianceOperationPayment', 'ComplianceOperationPaymentRevision',
    'ComplianceOperationPaymentAct', 'ComplianceOperationPaymentParty',
    'ComplianceOperationPaymentEvidence', 'ComplianceOperationPaymentVerification',
    'ComplianceOperationPaymentVerificationRule', 'ComplianceBcStructureSnapshot',
    'ComplianceBcEvaluation', 'ComplianceBcResult', 'ComplianceBcAiProposal',
    'ComplianceBcFormatMapping',
  ],
  CONOCIMIENTO: [
    'KnowledgeSource', 'KnowledgeSourceVersion', 'KnowledgeRadarRun', 'KnowledgeImpact',
    'KnowledgeArticle', 'KnowledgeCriterion',
  ],
  CONFIGURACION: [
    'TimingPolicyRevision', 'TimingInterval', 'FiscalReferenceRevision', 'FiscalExportProfile',
    'MiDiaCardPermission',
  ],
};

const NON_EXPORTABLE_FIELD = /(?:password|secret|token_hash|provider_response_id|^verification_|^csd_.*_ref$|^pac_.*_ref$|^session_id$|^ip_address$|^user_agent$)/i;

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const serialized = value instanceof Date ? value.toISOString()
    : typeof value === 'bigint' ? value.toString()
      : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${serialized.replace(/"/g, '""')}"`;
};

const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const safeArchiveName = (value: string, fallback: string) =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-180) || fallback;

async function verifyArchive(filename: string, expectedFiles: Array<{ path: string; sizeBytes: number; sha256: string }>) {
  const expected = new Map(expectedFiles.map((file) => [file.path, file]));
  const verified = new Set<string>();
  const archiveSize = (await stat(filename)).size;
  const verifyEntry = async (entry: yauzl.Entry, expectation: { sizeBytes: number; sha256: string }) => {
    if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)
      || entry.uncompressedSize !== expectation.sizeBytes) {
      throw new PlatformDomainError('EXPORT_ARCHIVE_ENTRY_INVALID', `La entrada ${entry.fileName} tiene un formato o tamaño inesperado.`, 409);
    }
    const handle = await open(filename, 'r');
    let dataStart: number;
    try {
      const header = Buffer.alloc(30);
      if ((await handle.read(header, 0, 30, entry.relativeOffsetOfLocalHeader)).bytesRead !== 30
        || header.readUInt32LE(0) !== 0x04034b50
        || header.readUInt16LE(8) !== entry.compressionMethod) {
        throw new PlatformDomainError('EXPORT_ARCHIVE_ENTRY_INVALID', `La cabecera de ${entry.fileName} es inválida.`, 409);
      }
      const nameLength = header.readUInt16LE(26);
      const extraLength = header.readUInt16LE(28);
      const name = Buffer.alloc(nameLength);
      if ((await handle.read(name, 0, nameLength, entry.relativeOffsetOfLocalHeader + 30)).bytesRead !== nameLength
        || name.toString('utf8') !== entry.fileName) {
        throw new PlatformDomainError('EXPORT_ARCHIVE_ENTRY_INVALID', `El nombre local de ${entry.fileName} no coincide.`, 409);
      }
      dataStart = entry.relativeOffsetOfLocalHeader + 30 + nameLength + extraLength;
    } finally {
      await handle.close();
    }
    if (dataStart + entry.compressedSize > archiveSize) {
      throw new PlatformDomainError('EXPORT_ARCHIVE_ENTRY_INVALID', `La entrada ${entry.fileName} excede el paquete.`, 409);
    }
    const hash = createHash('sha256');
    let bytes = 0;
    if (entry.compressedSize > 0) {
      const source = createReadStream(filename, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
      const sink = new Writable({ write(chunk: Buffer, _encoding, callback) {
        bytes += chunk.byteLength;
        if (bytes > expectation.sizeBytes) {
          callback(new PlatformDomainError('EXPORT_ARCHIVE_HASH_MISMATCH', `La entrada ${entry.fileName} supera el tamaño declarado.`, 409));
        } else {
          hash.update(chunk);
          callback();
        }
      } });
      if (entry.compressionMethod === 8) await pipeline(source, createInflateRaw(), sink);
      else await pipeline(source, sink);
    }
    if (bytes !== expectation.sizeBytes || hash.digest('hex') !== expectation.sha256) {
      throw new PlatformDomainError('EXPORT_ARCHIVE_HASH_MISMATCH', `La entrada ${entry.fileName} no coincide con su manifiesto.`, 409);
    }
  };
  await new Promise<void>((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, autoClose: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError || new Error('EXPORT_ARCHIVE_OPEN_FAILED'));
      let finished = false;
      zip.once('error', reject);
      zip.once('close', () => {
        if (!finished) reject(new PlatformDomainError('EXPORT_ARCHIVE_INCOMPLETE', 'El paquete se cerró antes de verificar todas sus entradas.', 409));
      });
      zip.once('end', () => {
        const missing = [...expected.keys()].filter((name) => !verified.has(name));
        if (missing.length) reject(new PlatformDomainError('EXPORT_ARCHIVE_INCOMPLETE', `El paquete no contiene ${missing[0]}.`, 409));
        else { finished = true; resolve(); }
      });
      zip.on('entry', async (entry) => {
        if (/\/$/.test(entry.fileName)) { zip.readEntry(); return; }
        const expectation = expected.get(entry.fileName);
        if (!expectation) {
          reject(new PlatformDomainError('EXPORT_ARCHIVE_UNEXPECTED_ENTRY', `El paquete contiene una entrada no declarada: ${entry.fileName}.`, 409));
          zip.close();
          return;
        }
        if (verified.has(entry.fileName)) {
          reject(new PlatformDomainError('EXPORT_ARCHIVE_DUPLICATE_ENTRY', `El paquete contiene la entrada duplicada ${entry.fileName}.`, 409));
          zip.close();
          return;
        }
        try {
          await verifyEntry(entry, expectation);
          verified.add(entry.fileName);
          zip.readEntry();
        } catch (error) {
          zip.close();
          reject(error);
        }
      });
      zip.readEntry();
    });
  });
  return { files: verified.size };
}

export class TenantExportService {
  private readonly tracked: TrackedStorageService;
  private readonly jobs: BackgroundJobsService;

  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly provider: StorageProvider = getStorageProvider(),
  ) {
    this.tracked = new TrackedStorageService(provider, db);
    this.jobs = new BackgroundJobsService(db);
  }

  async create(input: { organizationId: string; userId: string; scope: string[]; format: string; idempotencyKey: string }) {
    const scope = [...new Set(input.scope.map((item) => item.toUpperCase()))];
    if (!scope.length || scope.some((item) => !EXPORT_SCOPES.includes(item as ExportScope))) {
      throw new PlatformDomainError('EXPORT_SCOPE_INVALID', 'Selecciona únicamente áreas exportables válidas.', 400);
    }
    if (input.format !== 'ZIP_CSV') throw new PlatformDomainError('EXPORT_FORMAT_UNSUPPORTED', 'El formato disponible es ZIP_CSV.', 415);
    if (!input.idempotencyKey.trim()) throw new PlatformDomainError('EXPORT_IDEMPOTENCY_REQUIRED', 'La clave de idempotencia es obligatoria.', 400);
    const existing = await this.db.exportJob.findUnique({ where: {
      organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey },
    } });
    const assertSameRequest = (candidate: NonNullable<typeof existing>) => {
      const existingScope = Array.isArray(candidate.scope) ? candidate.scope.map(String).sort() : [];
      if (candidate.created_by !== input.userId || candidate.format !== input.format
        || JSON.stringify(existingScope) !== JSON.stringify([...scope].sort())) {
        throw new PlatformDomainError('EXPORT_IDEMPOTENCY_CONFLICT', 'La clave de idempotencia ya pertenece a otra exportación.', 409);
      }
    };
    let job = existing;
    if (job) assertSameRequest(job);
    else {
      try {
        job = await this.db.exportJob.create({ data: {
          organization_id: input.organizationId, created_by: input.userId,
          scope, format: input.format, idempotency_key: input.idempotencyKey,
        } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        job = await this.db.exportJob.findUnique({ where: {
          organization_id_idempotency_key: { organization_id: input.organizationId, idempotency_key: input.idempotencyKey },
        } });
        if (!job) throw error;
        assertSameRequest(job);
      }
    }
    await this.jobs.enqueue({
      organizationId: input.organizationId, jobType: 'EXPORT', idempotencyKey: `export:${job.id}`, payload: { exportJobId: job.id },
    });
    return serializeBigInts(job);
  }

  async process(input: { organizationId: string; exportJobId: string }) {
    const job = await this.db.exportJob.findFirstOrThrow({ where: { id: input.exportJobId, organization_id: input.organizationId } });
    if (job.status === 'COMPLETED') {
      if (job.expires_at) await this.jobs.enqueue({
        organizationId: input.organizationId, jobType: 'EXPORT_CLEANUP',
        idempotencyKey: `export-cleanup:${job.id}`, payload: { exportJobId: job.id },
        scheduledAt: job.expires_at, priority: 200, maxAttempts: 10,
      });
      return serializeBigInts(job);
    }
    if (!['PENDING', 'FAILED', 'RUNNING'].includes(job.status)) throw new PlatformDomainError('EXPORT_STATE_CONFLICT', 'La exportación no puede ejecutarse en su estado actual.', 409);
    if (job.status === 'FAILED') await this.cleanupFailedAttempt(input.organizationId, job.id);
    const scope = Array.isArray(job.scope) ? job.scope.map(String) : [];
    const manifest: {
      export_schema_version: number; exportJobId: string; organizationId: string; generatedAt: string;
      scope: string[]; entityCounts: Record<string, number>; relationshipCounts: Record<string, number>; warnings: string[];
      files: Array<{ path: string; sizeBytes: number; sha256: string; mimeType: string; rows?: number }>;
    } = {
      export_schema_version: 1, exportJobId: job.id, organizationId: input.organizationId,
      generatedAt: job.created_at.toISOString(), scope, entityCounts: {}, relationshipCounts: {}, warnings: [], files: [],
    };
    await this.db.exportJob.update({ where: { id: job.id }, data: { status: 'RUNNING', progress: 5 } });

    const directory = await mkdtemp(path.join(os.tmpdir(), 'pravia-export-'));
    const archiveFilename = path.join(directory, 'export.zip');
    const output = createWriteStream(archiveFilename, { flags: 'wx', mode: 0o600 });
    const zip = archiver('zip', { zlib: { level: 6 } });
    const archiveComplete = new Promise<void>((resolve, reject) => {
      output.once('close', () => resolve());
      output.once('error', reject);
      zip.once('error', reject);
    });
    zip.pipe(output);
    const appendBuffer = (archivePath: string, body: Buffer, mimeType: string, rows?: number) => {
      zip.append(body, { name: archivePath, date: job.created_at });
      manifest.files.push({ path: archivePath, sizeBytes: body.byteLength, sha256: digest(body), mimeType, rows });
    };
    const addCsv = async (
      name: string,
      page: (skip: number, take: number) => Promise<Array<Record<string, unknown>>>,
      relation = false,
      countRows?: () => Promise<number>,
    ) => {
      const expectedBefore = countRows ? await countRows() : null;
      const filename = path.join(directory, `${name}.csv`);
      const handle = await open(filename, 'wx', 0o600);
      const checksum = createHash('sha256');
      let sizeBytes = 0;
      let count = 0;
      let columns: string[] | null = null;
      const write = async (content: string) => {
        const bytes = Buffer.from(content, 'utf8');
        await handle.writeFile(bytes);
        checksum.update(bytes);
        sizeBytes += bytes.byteLength;
      };
      try {
        for (;;) {
          const rows = await page(count, 200);
          if (!rows.length) break;
          if (!columns) {
            columns = Object.keys(rows[0]);
            await write(`\uFEFF${columns.map(csvCell).join(',')}\n`);
          }
          const csvColumns = columns;
          await write(`${rows.map((row) => csvColumns.map((column) => csvCell(row[column])).join(',')).join('\n')}\n`);
          count += rows.length;
          if (rows.length < 200) break;
        }
        if (!columns) await write('\uFEFF');
      } finally {
        await handle.close();
      }
      if (countRows) {
        const expectedAfter = await countRows();
        if (expectedBefore !== count || expectedAfter !== count) {
          throw new PlatformDomainError('EXPORT_ENTITY_COUNT_DRIFT', `Cambió el inventario de ${name} durante la exportación; se requiere reintentar.`, 409);
        }
      }
      const archivePath = `data/${name}.csv`;
      zip.file(filename, { name: archivePath, date: job.created_at });
      manifest.files.push({ path: archivePath, sizeBytes, sha256: checksum.digest('hex'), mimeType: 'text/csv', rows: count });
      (relation ? manifest.relationshipCounts : manifest.entityCounts)[name] = count;
    };
    const addScopedModel = async (modelName: string) => {
      const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
      if (!model || !model.fields.some((field) => field.name === 'organization_id')
        || !model.fields.some((field) => field.name === 'id')) {
        throw new PlatformDomainError('EXPORT_MODEL_CONTRACT_CHANGED', `El modelo ${modelName} ya no tiene identidad o pertenencia de tenant exportable.`, 500);
      }
      const select = Object.fromEntries(model.fields
        .filter((field) => (field.kind === 'scalar' || field.kind === 'enum')
          && field.type !== 'Bytes' && !NON_EXPORTABLE_FIELD.test(field.name))
        .map((field) => [field.name, true]));
      const delegateName = modelName[0].toLowerCase() + modelName.slice(1);
      const delegate = (this.db as unknown as Record<string, {
        findMany: (args: object) => Promise<Array<Record<string, unknown>>>;
        count: (args: object) => Promise<number>;
      }>)[delegateName];
      if (!delegate?.findMany || !delegate?.count) {
        throw new PlatformDomainError('EXPORT_MODEL_CONTRACT_CHANGED', `No se puede consultar ${modelName} de forma segura.`, 500);
      }
      await addCsv(modelName, (skip, take) => delegate.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select,
      }), false, () => delegate.count({ where: { organization_id: input.organizationId } }));
    };
    const addStorageBinary = async (source: {
      objectKey: string; expectedSize?: number | null; expectedSha256?: string | null;
      mimeType: string; archivePath: string; spoolName: string;
    }) => {
      const spool = path.join(directory, source.spoolName);
      if (this.provider.downloadFile) await this.provider.downloadFile(source.objectKey, spool);
      else {
        if (source.expectedSize === undefined || source.expectedSize === null
          || source.expectedSize > 50 * 1024 * 1024) {
          throw new PlatformDomainError('EXPORT_STORAGE_STREAM_UNAVAILABLE', 'El proveedor no permite exportar este archivo sin cargarlo completo en memoria.', 503);
        }
        const handle = await open(spool, 'wx', 0o600);
        try { await handle.writeFile(await this.provider.download(source.objectKey)); }
        finally { await handle.close(); }
      }
      const fileHash = createHash('sha256');
      let sizeBytes = 0;
      for await (const chunk of createReadStream(spool)) {
        const bytes = chunk as Buffer;
        sizeBytes += bytes.byteLength;
        fileHash.update(bytes);
      }
      const checksum = fileHash.digest('hex');
      if ((source.expectedSize !== undefined && source.expectedSize !== null && sizeBytes !== source.expectedSize)
        || (source.expectedSha256 && source.expectedSha256 !== checksum)) {
        throw new PlatformDomainError('EXPORT_DOCUMENT_CHECKSUM_MISMATCH', `El archivo ${source.archivePath} no coincide con su tamaño o checksum.`, 409);
      }
      zip.file(spool, { name: source.archivePath, date: job.created_at });
      manifest.files.push({ path: source.archivePath, sizeBytes, sha256: checksum, mimeType: source.mimeType });
    };

    try {
      if (scope.includes('TENANT')) {
        await addCsv('tenant', (skip, take) => this.db.organization.findMany({ where: { id: input.organizationId }, skip, take, select: {
          id: true, name: true, created_at: true,
        } }));
        await addCsv('mi_dia_configuracion', (skip, take) => this.db.miDiaTenantConfig.findMany({
          where: { organization_id: input.organizationId }, orderBy: { organization_id: 'asc' }, skip, take,
        }));
        await addCsv('tenant_entitlements', (skip, take) => this.db.tenantEntitlement.findMany({
          where: { organization_id: input.organizationId }, orderBy: { organization_id: 'asc' }, skip, take,
        }));
        await addCsv('tenant_storage_usage', (skip, take) => this.db.tenantStorageUsage.findMany({
          where: { organization_id: input.organizationId }, orderBy: { organization_id: 'asc' }, skip, take,
          select: { organization_id: true, production_bytes: true, last_reconciled_at: true, updated_at: true },
        }));
      }
      if (scope.includes('USUARIOS')) {
        await addCsv('usuarios', (skip, take) => this.db.organizationMembership.findMany({ where: { organization_id: input.organizationId }, orderBy: { user_id: 'asc' }, skip, take, select: {
          organization_id: true, user_id: true, rol: true, status: true, created_at: true, updated_at: true,
          user: { select: { email: true, nombre: true, apellido: true, activo: true } },
        } }));
      }

    if (scope.includes('COMPARECIENTES')) {
      await addCsv('comparecientes', (skip, take) => this.db.compareciente.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('personas_fisicas', (skip, take) => this.db.personaFisica.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('personas_morales', (skip, take) => this.db.personaMoral.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('compareciente_contactos', (skip, take) => this.db.comparecienteContacto.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('compareciente_domicilios', (skip, take) => this.db.comparecienteDomicilio.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('compareciente_identificaciones', (skip, take) => this.db.comparecienteIdentificacion.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('relaciones_conyugales', (skip, take) => this.db.relacionConyugal.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }), true);
      await addCsv('persona_moral_instrumentos', (skip, take) => this.db.personaMoralInstrumento.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }), true);
      await addCsv('persona_moral_representantes', (skip, take) => this.db.personaMoralRepresentante.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }), true);
    }
    if (scope.includes('PROSPECTOS')) {
      await addCsv('prospectos', (skip, take) => this.db.prospecto.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('prospecto_actos', (skip, take) => this.db.prospectoActo.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }), true);
      await addCsv('prospecto_transiciones', (skip, take) => this.db.prospectoTransicion.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }), true);
    }
    if (scope.includes('COTIZACIONES')) {
      await addCsv('cotizaciones', (skip, take) => this.db.cotizacion.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('cotizacion_actos', (skip, take) => this.db.cotizacionActo.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }), true);
      await addCsv('cotizacion_transiciones', (skip, take) => this.db.cotizacionTransicion.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }), true);
      await addCsv('cotizacion_versiones', (skip, take) => this.db.cotizacionVersion.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('cotizacion_conceptos', (skip, take) => this.db.cotizacionConcepto.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('cotizacion_version_conceptos', (skip, take) => this.db.cotizacionVersionConcepto.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
    }
    if (scope.includes('EXPEDIENTES')) {
      await addCsv('expedientes', (skip, take) => this.db.expediente.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
    }
    if (scope.includes('PREDIOS')) {
      await addCsv('predios', (skip, take) => this.db.predio.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
    }
    if (scope.includes('ACTOS')) {
      await addCsv('tipos_acto', (skip, take) => this.db.tipoActo.findMany({
        where: { OR: [{ organization_id: input.organizationId }, { organization_id: null }] }, orderBy: { id: 'asc' }, skip, take,
      }));
      const selectedActo = { OR: [{ organization_id: input.organizationId }, { organization_id: null }] };
      await addCsv('formulario_secciones', (skip, take) => this.db.formularioSeccion.findMany({
        where: { tipo_acto: selectedActo }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('formulario_campos', (skip, take) => this.db.formularioCampo.findMany({
        where: { seccion: { tipo_acto: selectedActo } }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('flujo_etapas', (skip, take) => this.db.flujoEtapa.findMany({
        where: { tipo_acto: selectedActo }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('formulario_versiones', (skip, take) => this.db.formularioVersion.findMany({
        where: { tipo_acto: selectedActo }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('flujo_versiones', (skip, take) => this.db.flujoVersion.findMany({
        where: { tipo_acto: selectedActo }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('plantilla_documental_versiones', (skip, take) => this.db.plantillaDocumentalVersion.findMany({
        where: { tipo_acto: selectedActo }, orderBy: { id: 'asc' }, skip, take,
      }));
      const templateBinaryWhere = { tipo_acto: selectedActo, storage_key: { not: null } };
      const expectedTemplates = await this.db.plantillaDocumentalVersion.count({ where: templateBinaryWhere });
      let templateOffset = 0;
      for (;;) {
        const templates = await this.db.plantillaDocumentalVersion.findMany({
          where: templateBinaryWhere, orderBy: { id: 'asc' },
          skip: templateOffset, take: 200,
        });
        if (!templates.length) break;
        for (const template of templates) {
          if (!template.storage_key) continue;
          const safeName = safeArchiveName(path.basename(template.storage_key), `${template.id}.bin`);
          await addStorageBinary({ objectKey: template.storage_key, expectedSize: template.size_bytes,
            expectedSha256: template.checksum_sha256, mimeType: template.mime_type || 'application/octet-stream',
            archivePath: `templates/${template.id}/${safeName}`, spoolName: `template-${template.id}.bin` });
        }
        templateOffset += templates.length;
        if (templates.length < 200) break;
      }
      if (templateOffset !== expectedTemplates
        || await this.db.plantillaDocumentalVersion.count({ where: templateBinaryWhere }) !== expectedTemplates) {
        throw new PlatformDomainError('EXPORT_TEMPLATE_COUNT_DRIFT', 'Cambió el inventario de plantillas durante la exportación; se requiere reintentar.', 409);
      }
      await addCsv('checklist_items', (skip, take) => this.db.checklistItem.findMany({
        where: { tipo_acto: selectedActo }, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('caracteres_compareciente', (skip, take) => this.db.caracterCompareciente.findMany({
        where: selectedActo, orderBy: { id: 'asc' }, skip, take,
      }));
      await addCsv('tipos_acto_caracteres', (skip, take) => this.db.tipoActoCaracterCompareciente.findMany({
        where: { tipo_acto: selectedActo, caracter: selectedActo }, orderBy: { id: 'asc' }, skip, take,
      }), true);
      await addCsv('expediente_actos', (skip, take) => this.db.expedienteActo.findMany({ where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select: {
        id: true, expediente_id: true, tipo_acto_id: true, porcentaje_objeto: true, origen: true, estatus: true,
        source_cotizacion_id: true, created_by: true, created_at: true, removed_at: true, removed_reason: true,
      } }));
    }
    if (scope.includes('ARCHIVO')) {
      await addCsv('archivo', (skip, take) => this.db.archivoRegistro.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
    }
    if (scope.includes('AGENDA')) {
      await addCsv('agenda', (skip, take) => this.db.eventoAgenda.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
    }
    if (scope.includes('FINANZAS')) {
      await addCsv('movimientos_financieros', (skip, take) => this.db.movimientoFinanciero.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      }));
    }
    if (scope.includes('RELACIONES')) {
      await addCsv('expediente_predios', (skip, take) => this.db.expedientePredio.findMany({ where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select: {
        id: true, expediente_id: true, predio_id: true, estatus: true, created_at: true, removed_at: true,
      } }), true);
      await addCsv('expediente_acto_predios', (skip, take) => this.db.expedienteActoPredio.findMany({ where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select: {
        id: true, expediente_predio_id: true, expediente_acto_id: true, estatus: true, created_at: true, removed_at: true,
      } }), true);
      await addCsv('expediente_comparecientes', (skip, take) => this.db.expedienteCompareciente.findMany({ where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select: {
        id: true, expediente_id: true, expediente_acto_id: true, compareciente_id: true, caracter_id: true, estatus: true,
        created_at: true, archived_at: true, motivo_desvinculacion: true,
      } }), true);
      await addCsv('expediente_documentos', (skip, take) => this.db.expedienteDocumento.findMany({ where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select: {
        id: true, expediente_id: true, documento_id: true, tipo_vinculo: true, estatus: true, fecha_vinculo: true,
      } }), true);
      await addCsv('prospecto_documentos', (skip, take) => this.db.prospectoDocumento.findMany({ where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select: {
        id: true, prospecto_id: true, documento_id: true, tipo_vinculo: true, estatus: true, fecha_vinculo: true,
      } }), true);
      await addCsv('cotizacion_documentos', (skip, take) => this.db.cotizacionDocumento.findMany({ where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select: {
        id: true, cotizacion_id: true, documento_id: true, tipo_vinculo: true, estatus: true, fecha_vinculo: true,
      } }), true);
      await addCsv('predio_documentos', (skip, take) => this.db.predioDocumento.findMany({ where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select: {
        id: true, predio_id: true, documento_id: true, tipo_vinculo: true, vigencia: true, estatus: true, fecha_vinculo: true,
      } }), true);
      await addCsv('compareciente_documentos', (skip, take) => this.db.comparecienteDocumento.findMany({ where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select: {
        id: true, compareciente_id: true, documento_id: true, categoria: true, estatus: true, vigencia: true, created_at: true,
      } }), true);
      await addCsv('movimiento_documentos', (skip, take) => this.db.movimientoDocumento.findMany({ where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take, select: {
        id: true, movimiento_id: true, documento_id: true, tipo_vinculo: true, estatus: true, fecha_vinculo: true,
      } }), true);
    }
    if (scope.includes('DOCUMENTOS')) {
      const documentPage = (skip: number, take: number) => this.db.documento.findMany({
        where: { organization_id: input.organizationId }, orderBy: { id: 'asc' }, skip, take,
      });
      await addCsv('documentos', documentPage);
      let documentOffset = 0;
      let binaryDocuments = 0;
      for (;;) {
        const documents = await documentPage(documentOffset, 200);
        if (!documents.length) break;
        for (const document of documents) {
          const safeName = safeArchiveName(document.nombre_original, `${document.id}.bin`);
          await addStorageBinary({ objectKey: document.storage_key, expectedSize: document.size_bytes,
            expectedSha256: document.checksum_sha256, mimeType: document.mime_type,
            archivePath: `documents/${document.id}/${safeName}`, spoolName: `document-${document.id}.bin` });
          binaryDocuments += 1;
        }
        documentOffset += documents.length;
        if (documents.length < 200) break;
      }
      if (binaryDocuments !== manifest.entityCounts.documentos) {
        throw new PlatformDomainError('EXPORT_DOCUMENT_COUNT_DRIFT', 'Cambió el inventario documental durante la exportación; se requiere reintentar.', 409);
      }
    }

    for (const exportScope of scope) {
      for (const modelName of ADDITIONAL_EXPORT_MODELS[exportScope as ExportScope] || []) {
        await addScopedModel(modelName);
      }
    }
    if (scope.includes('TENANT')) {
      const attachmentBinaryWhere = { organization_id: input.organizationId, documento_id: null,
        storage_key: { not: null }, storage_deleted_at: null };
      const expectedAttachments = await this.db.assistantAttachment.count({ where: attachmentBinaryWhere });
      let attachmentOffset = 0;
      for (;;) {
        const attachments = await this.db.assistantAttachment.findMany({
          where: attachmentBinaryWhere,
          orderBy: { id: 'asc' }, skip: attachmentOffset, take: 200,
        });
        if (!attachments.length) break;
        for (const attachment of attachments) {
          if (!attachment.storage_key) throw new PlatformDomainError('EXPORT_ATTACHMENT_MISSING_SOURCE', `El adjunto ${attachment.id} no tiene archivo recuperable.`, 409);
          const safeName = safeArchiveName(attachment.original_name, `${attachment.id}.bin`);
          await addStorageBinary({ objectKey: attachment.storage_key, expectedSize: attachment.size_bytes,
            expectedSha256: attachment.sha256, mimeType: attachment.mime_type,
            archivePath: `assistant-attachments/${attachment.id}/${safeName}`,
            spoolName: `assistant-attachment-${attachment.id}.bin` });
        }
        attachmentOffset += attachments.length;
        if (attachments.length < 200) break;
      }
      if (attachmentOffset !== expectedAttachments
        || await this.db.assistantAttachment.count({ where: attachmentBinaryWhere }) !== expectedAttachments) {
        throw new PlatformDomainError('EXPORT_ATTACHMENT_COUNT_DRIFT', 'Cambió el inventario de adjuntos durante la exportación; se requiere reintentar.', 409);
      }
    }

    await this.db.exportJob.update({ where: { id: job.id }, data: { progress: 80 } });

    appendBuffer('README.txt', Buffer.from('PRAVIA OS tenant export\nVerify every data and document file against manifest.json before use.\n', 'utf8'), 'text/plain');
    const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    appendBuffer('manifest.json', manifestBody, 'application/json');
    await zip.finalize();
    await archiveComplete;
    await this.db.exportJob.update({ where: { id: job.id }, data: { progress: 90 } });
    await verifyArchive(archiveFilename, manifest.files);
    const attemptId = randomUUID();
    const archiveKey = `organizations/${input.organizationId}/exports/${job.id}/${attemptId}/export.zip`;
    const manifestKey = `organizations/${input.organizationId}/exports/${job.id}/${attemptId}/manifest.json`;
    await this.tracked.upload(manifestBody, manifestKey, 'application/json', 'TEMPORARY');
    const manifestReference = await this.tracked.linkReference({ key: manifestKey, ownerType: 'EXPORT_MANIFEST', ownerId: job.id });
    await this.tracked.uploadFile(archiveFilename, archiveKey, 'application/zip', 'TEMPORARY');
    const archiveReference = await this.tracked.linkReference({ key: archiveKey, ownerType: 'EXPORT_JOB', ownerId: job.id });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.db.$transaction(async (tx) => {
      const existingArtifacts = await tx.exportArtifact.findMany({ where: {
        organization_id: input.organizationId, export_job_id: job.id,
        artifact_type: { in: ['ZIP_CSV', 'MANIFEST_JSON'] },
      } });
      if (!existingArtifacts.some((artifact) => artifact.artifact_type === 'ZIP_CSV')) {
        await tx.exportArtifact.create({ data: {
          organization_id: input.organizationId, export_job_id: job.id, blob_id: archiveReference.blob_id,
          artifact_type: 'ZIP_CSV', expires_at: expiresAt,
        } });
      }
      if (!existingArtifacts.some((artifact) => artifact.artifact_type === 'MANIFEST_JSON')) {
        await tx.exportArtifact.create({ data: {
          organization_id: input.organizationId, export_job_id: job.id, blob_id: manifestReference.blob_id,
          artifact_type: 'MANIFEST_JSON', expires_at: expiresAt,
        } });
      }
      await tx.exportJob.update({ where: { id: job.id }, data: {
        status: 'COMPLETED', progress: 100, archive_blob_id: archiveReference.blob_id,
        manifest_blob_id: manifestReference.blob_id, expires_at: expiresAt, completed_at: new Date(),
      } });
    });
    await this.jobs.enqueue({
      organizationId: input.organizationId, jobType: 'EXPORT_CLEANUP',
      idempotencyKey: `export-cleanup:${job.id}`, payload: { exportJobId: job.id },
      scheduledAt: expiresAt, priority: 200, maxAttempts: 10,
    });
    return serializeBigInts(await this.db.exportJob.findUniqueOrThrow({ where: { id: job.id } }));
    } catch (error) {
      const failed = await this.db.exportJob.updateMany({ where: { id: job.id, status: 'RUNNING' }, data: { status: 'FAILED' } }).catch(() => ({ count: 0 }));
      if (failed.count) await this.cleanupFailedAttempt(input.organizationId, job.id).catch(() => undefined);
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async cleanupFailedAttempt(organizationId: string, exportJobId: string) {
    const locations = await this.db.storageBlobLocation.findMany({ where: {
      organization_id: organizationId,
      object_key: { startsWith: `organizations/${organizationId}/exports/${exportJobId}/` },
      status: 'AVAILABLE',
    }, select: { object_key: true } });
    await this.db.exportArtifact.deleteMany({ where: { organization_id: organizationId, export_job_id: exportJobId } });
    await this.db.storageBlobReference.deleteMany({ where: {
      organization_id: organizationId, owner_id: exportJobId,
      owner_type: { in: ['EXPORT_JOB', 'EXPORT_MANIFEST'] },
    } });
    for (const location of locations) await this.tracked.delete(location.object_key);
  }

  async signedDownload(input: { organizationId: string; exportJobId: string; expiresInSeconds?: number }) {
    const job = await this.db.exportJob.findFirstOrThrow({ where: { id: input.exportJobId, organization_id: input.organizationId } });
    if (job.status !== 'COMPLETED' || !job.archive_blob_id || !job.expires_at || job.expires_at <= new Date()) {
      throw new PlatformDomainError('EXPORT_NOT_AVAILABLE', 'La exportación no está disponible o ya expiró.', 410);
    }
    const location = await this.db.storageBlobLocation.findFirstOrThrow({ where: {
      organization_id: input.organizationId, blob_id: job.archive_blob_id, status: 'AVAILABLE',
    } });
    const blob = await this.db.storageBlob.findFirstOrThrow({ where: { id: job.archive_blob_id, organization_id: input.organizationId } });
    return {
      url: await this.provider.signedUrl(location.object_key, Math.max(60, Math.min(input.expiresInSeconds || 600, 3600))),
      expiresAt: job.expires_at,
      sizeBytes: blob.size_bytes.toString(),
    };
  }

  async status(organizationId: string, exportJobId: string) {
    return serializeBigInts(await this.db.exportJob.findFirstOrThrow({ where: { id: exportJobId, organization_id: organizationId } }));
  }

  async list(organizationId: string) {
    return serializeBigInts(await this.db.exportJob.findMany({
      where: { organization_id: organizationId }, orderBy: { created_at: 'desc' }, take: 20,
      select: { id: true, status: true, progress: true, scope: true, format: true,
        created_at: true, completed_at: true, expires_at: true },
    }));
  }

  async cleanupArtifact(input: { organizationId: string; exportJobId: string; reason: 'EXPIRED' | 'REVOKED' }) {
    const job = await this.db.exportJob.findFirstOrThrow({ where: {
      id: input.exportJobId, organization_id: input.organizationId,
    } });
    if (input.reason === 'EXPIRED' && job.expires_at && job.expires_at > new Date()) {
      throw new PlatformDomainError('EXPORT_NOT_EXPIRED', 'La exportación aún no ha expirado.', 409);
    }
    const artifacts = await this.db.exportArtifact.findMany({ where: {
      organization_id: input.organizationId, export_job_id: job.id,
      artifact_type: { in: ['ZIP_CSV', 'MANIFEST_JSON'] },
    } });
    await this.db.exportJob.update({ where: { id: job.id }, data: {
      status: input.reason, expires_at: new Date(),
    } });
    for (const artifact of artifacts) {
      const location = await this.db.storageBlobLocation.findFirst({ where: {
        organization_id: input.organizationId, blob_id: artifact.blob_id, status: { in: ['AVAILABLE', 'LEGACY_UNVERIFIED'] },
      } });
      await this.db.storageBlobReference.deleteMany({ where: {
        organization_id: input.organizationId, blob_id: artifact.blob_id,
        owner_type: artifact.artifact_type === 'MANIFEST_JSON' ? 'EXPORT_MANIFEST' : 'EXPORT_JOB', owner_id: job.id,
      } });
      if (location) await this.tracked.delete(location.object_key);
    }
    await this.db.exportArtifact.deleteMany({ where: { organization_id: input.organizationId, export_job_id: job.id } });
    return this.status(input.organizationId, job.id);
  }

  async revoke(input: { organizationId: string; exportJobId: string }) {
    return this.cleanupArtifact({ ...input, reason: 'REVOKED' });
  }

  async recordCompletedEgress(input: { organizationId: string; exportJobId: string; bytes: bigint; providerReceipt: string }) {
    if (!input.providerReceipt.trim() || input.bytes <= 0n) {
      throw new PlatformDomainError('EGRESS_RECEIPT_INVALID', 'La medición de descarga exige bytes y recibo del proveedor.', 400);
    }
    const job = await this.db.exportJob.findFirstOrThrow({ where: { id: input.exportJobId, organization_id: input.organizationId } });
    if (job.status !== 'COMPLETED' || !job.archive_blob_id || !job.expires_at || job.expires_at <= new Date()) {
      throw new PlatformDomainError('EXPORT_NOT_AVAILABLE', 'La exportación no está disponible para medir descarga.', 409);
    }
    const blob = await this.db.storageBlob.findFirstOrThrow({ where: { id: job.archive_blob_id, organization_id: input.organizationId } });
    if (input.bytes > blob.size_bytes) throw new PlatformDomainError('EGRESS_BYTES_INVALID', 'El recibo excede el tamaño del artefacto.', 409);
    const idempotencyKey = `egress:${input.providerReceipt}`;
    const existing = await this.db.usageEvent.findUnique({ where: { organization_id_idempotency_key: {
      organization_id: input.organizationId, idempotency_key: idempotencyKey,
    } } });
    if (existing) {
      if (existing.source_id !== job.id || existing.quantity.toString() !== input.bytes.toString()) {
        throw new PlatformDomainError('EGRESS_RECEIPT_CONFLICT', 'El recibo del proveedor ya corresponde a otra descarga.', 409);
      }
      return serializeBigInts(existing);
    }
    const data = {
        organization_id: input.organizationId, resource_type: 'EGRESS_BYTES', quantity: input.bytes.toString(),
        unit: 'BYTE', source_type: 'EXPORT_DOWNLOAD', source_id: job.id,
        metadata: { exportJobId: job.id, blobId: blob.id, providerReceipt: input.providerReceipt },
        idempotency_key: idempotencyKey,
    };
    try {
      return serializeBigInts(await this.db.usageEvent.create({ data }));
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const concurrent = await this.db.usageEvent.findUnique({ where: { organization_id_idempotency_key: {
        organization_id: input.organizationId, idempotency_key: idempotencyKey,
      } } });
      if (concurrent?.source_id === job.id && concurrent.quantity.toString() === input.bytes.toString()) {
        return serializeBigInts(concurrent);
      }
      throw new PlatformDomainError('EGRESS_RECEIPT_CONFLICT', 'El recibo del proveedor ya corresponde a otra descarga.', 409);
    }
  }
}

export const tenantExportService = new TenantExportService();
