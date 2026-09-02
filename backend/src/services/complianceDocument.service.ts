import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { ComplianceError } from '../domain/compliance';
import { deriveComplianceState, type ComplianceDocumentRequirementDefinition, type RuleEvaluation } from '../domain/complianceLegalEngine';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { deleteFile, downloadFile, fileExists, uploadFile } from '../storage/storage.service';

type User = NonNullable<Request['user']>;
export type ComplianceDocumentActor = Pick<User, 'id' | 'organizationId' | 'rol' | 'sessionId'>;
type Db = PrismaClient | Prisma.TransactionClient;
type PartyRef = { compareciente_id: string; expediente_acto_id: string | null };

const json = (value: unknown) => value as Prisma.InputJsonValue;
const normalize = (value: unknown) => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const checksum = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const versionOf = (document: { id: string; storage_key: string; size_bytes: number; fecha_carga: Date; mime_type: string; checksum_sha256: string | null }) =>
  document.checksum_sha256 || createHash('sha256').update(JSON.stringify([document.id, document.storage_key, document.size_bytes, document.fecha_carga.toISOString(), document.mime_type])).digest('hex');
const definitionOf = (requirement: { source_snapshot: unknown }) => {
  const snapshot = requirement.source_snapshot && typeof requirement.source_snapshot === 'object' ? requirement.source_snapshot as Record<string, unknown> : {};
  return snapshot.definition && typeof snapshot.definition === 'object' ? snapshot.definition as Partial<ComplianceDocumentRequirementDefinition> : {};
};

export const h2EvidenceSatisfies = (requirement: { requires_signed_document: boolean; requires_human_validation: boolean }, evidence: { document_state: string | null; validation_status: string | null }) => {
  if (requirement.requires_signed_document && evidence.document_state !== 'SIGNED_UPLOADED') return false;
  if (requirement.requires_human_validation || requirement.requires_signed_document) return evidence.validation_status === 'VALIDATED';
  return ['AUTO_LINKED', 'VALIDATED'].includes(String(evidence.validation_status));
};

export const sanitizeComplianceZipName = (value: string) => {
  const leaf = path.basename(value.replace(/[\\/]+/g, '/'));
  const safe = leaf.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\.\.+/g, '.').replace(/[^\p{L}\p{N}._() -]+/gu, '_').trim();
  return (safe && safe !== '.' && safe !== '..' ? safe : 'documento').slice(0, 180);
};

export const buildComplianceDocumentZip = async (entries: Array<{ path: string; bytes: Buffer }>, manifest: unknown) => {
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.path, entry.bytes);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
};

const categoryFolders: Record<string, string> = {
  IDENTIFICACION: 'Identificacion', PERSONAS_MORALES: 'Personas-Morales', FORMATOS: 'Formatos',
  CUESTIONARIOS_RIESGO: 'Cuestionarios-Riesgo', BENEFICIARIO_CONTROLADOR: 'Beneficiario-Controlador',
  PAGOS_EVIDENCIAS: 'Pagos-Evidencias', AVISOS_ACUSES: 'Avisos-Acuses', REVISIONES: 'Revisiones',
};

export class ComplianceDocumentService {
  static async materializeForRuleResultTx(tx: Prisma.TransactionClient, user: User, input: {
    expedienteId: string;
    reviewId: string;
    stateId: string;
    ruleResultId: string;
    expedienteActoId: string | null;
    result: RuleEvaluation;
    parties: PartyRef[];
    correlationId?: string;
  }) {
    if (input.result.vulnerableActivity !== true || !input.result.documentRequirements.length) return [] as string[];
    const statuses: string[] = [];
    for (const definition of input.result.documentRequirements) {
      const targets = definition.target_scope === 'EACH_RELEVANT_COMPARECIENTE'
        ? input.parties.filter((party) => party.expediente_acto_id === input.expedienteActoId).map((party) => party.compareciente_id)
        : [null];
      for (const targetComparecienteId of [...new Set(targets)]) {
        const targetKey = targetComparecienteId || 'EXPEDIENTE';
        const requirementKey = `DOC:${input.ruleResultId}:${definition.key}:${targetKey}`;
        const requirement = await tx.complianceRequirement.upsert({
          where: { organization_id_review_id_provider_requirement_key: { organization_id: user.organizationId, review_id: input.reviewId, provider: 'DOC', requirement_key: requirementKey } },
          create: {
            organization_id: user.organizationId, expediente_id: input.expedienteId, state_id: input.stateId,
            review_id: input.reviewId, rule_result_id: input.ruleResultId, provider: 'DOC', requirement_key: requirementKey,
            label: definition.label, status: 'PENDIENTE', blocks_completion: true,
            source_snapshot: json({ definition, rule_result_id: input.ruleResultId, h2_contract: 'CUM-DOC-001' }),
            document_category: definition.category, expected_document_type: definition.expected_document_type || null,
            target_compareciente_id: targetComparecienteId, requires_signed_document: Boolean(definition.requires_signed_document),
            requires_human_validation: definition.requires_human_validation !== false || Boolean(definition.requires_signed_document),
            missing_action: definition.action, action_target: json(definition.action_target || {}), is_documental: true,
          },
          update: {},
        });
        const linked = await this.autoLinkComparecienteTx(tx, user, requirement, definition, input.correlationId);
        statuses.push(linked.status);
      }
    }
    return statuses;
  }

  static async syncEligibleComparecienteEvidenceTx(tx: Prisma.TransactionClient, user: ComplianceDocumentActor, input: {
    comparecienteId: string;
    documentId: string;
    correlationId?: string;
  }) {
    const candidate = await tx.comparecienteDocumento.findFirst({
      where: {
        organization_id: user.organizationId,
        compareciente_id: input.comparecienteId,
        documento_id: input.documentId,
        archived_at: null,
        estatus: 'ACTIVO',
        documento: { organization_id: user.organizationId },
      },
      include: { documento: true },
    });
    if (!candidate) return { requirements: 0, linked: 0 };

    const requirements = await tx.complianceRequirement.findMany({
      where: {
        organization_id: user.organizationId,
        target_compareciente_id: input.comparecienteId,
        is_documental: true,
        status: { notIn: ['CUMPLIDO', 'NO_APLICA'] },
        expediente: {
          archived_at: null,
          comparecientes: { some: {
            organization_id: user.organizationId,
            compareciente_id: input.comparecienteId,
            archived_at: null,
            estatus: 'ACTIVO',
          } },
          ...expedienteAccessWhere(user as User),
        },
      },
      include: {
        state: { select: { current_review_id: true } },
        evidence: { where: { estatus: 'ACTIVO' } },
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });

    let linked = 0;
    for (const requirement of requirements) {
      if (requirement.state.current_review_id !== requirement.review_id) continue;
      const definition = definitionOf(requirement) as ComplianceDocumentRequirementDefinition;
      const result = await this.linkComparecienteEvidenceTx(tx, user, requirement, definition, candidate, input.correlationId);
      if (!result.linked) continue;
      linked += result.created ? 1 : 0;
      await this.refreshRequirementTx(tx, user, requirement.id);
    }
    return { requirements: requirements.length, linked };
  }

  static async read(user: User, expedienteId: string) {
    await this.assertExpediente(prisma, user, expedienteId);
    const state = await prisma.expedienteComplianceState.findFirst({ where: { organization_id: user.organizationId, expediente_id: expedienteId } });
    if (!state?.current_review_id) return { vulnerable: false, state: null, groups: [], missing: [], automatic_structure: false };
    const [results, requirements] = await Promise.all([
      prisma.complianceRuleResult.findMany({ where: { organization_id: user.organizationId, review_id: state.current_review_id }, select: { vulnerable_activity: true } }),
      prisma.complianceRequirement.findMany({
        where: { organization_id: user.organizationId, expediente_id: expedienteId, review_id: state.current_review_id, is_documental: true },
        include: { evidence: { where: { estatus: 'ACTIVO' }, include: { documento: { select: { id: true, nombre_original: true, mime_type: true, size_bytes: true } } }, orderBy: { created_at: 'asc' } } },
        orderBy: [{ document_category: 'asc' }, { label: 'asc' }, { created_at: 'asc' }],
      }),
    ]);
    const targetIds = [...new Set(requirements.map((item) => item.target_compareciente_id).filter(Boolean) as string[])];
    const targets = targetIds.length ? await prisma.compareciente.findMany({ where: { organization_id: user.organizationId, id: { in: targetIds } }, select: { id: true, nombre_busqueda: true } }) : [];
    const names = new Map(targets.map((item) => [item.id, item.nombre_busqueda]));
    const serialized = requirements.map((requirement) => {
      const satisfied = requirement.evidence.some((evidence) => h2EvidenceSatisfies(requirement, evidence));
      const reason = satisfied ? null : !requirement.evidence.length ? 'Falta vincular la evidencia requerida.' : requirement.requires_signed_document && !requirement.evidence.some((item) => item.document_state === 'SIGNED_UPLOADED') ? 'Falta cargar la versión firmada.' : 'La evidencia requiere validación humana.';
      return {
        id: requirement.id, label: requirement.label, status: satisfied ? 'CUMPLIDO' : requirement.status,
        category: requirement.document_category, expected_document_type: requirement.expected_document_type,
        target_compareciente_id: requirement.target_compareciente_id,
        target_name: requirement.target_compareciente_id ? names.get(requirement.target_compareciente_id) || 'Compareciente' : null,
        requires_signed_document: requirement.requires_signed_document,
        requires_human_validation: requirement.requires_human_validation,
        missing_action: requirement.missing_action, action_target: requirement.action_target,
        missing_reason: reason,
        evidence: requirement.evidence.map((item) => ({ id: item.id, source: item.source, document_state: item.document_state, validation_status: item.validation_status, document_version: item.document_version, linked_at: item.created_at, validated_at: item.validated_at, document: item.documento })),
      };
    });
    const groups = [...new Set(serialized.map((item) => item.category).filter(Boolean))].map((category) => ({ category, label: categoryFolders[String(category)]?.replace(/-/g, ' ') || String(category), requirements: serialized.filter((item) => item.category === category) }));
    const vulnerable = results.some((item) => item.vulnerable_activity === true);
    return { vulnerable, state, groups, requirements: serialized, missing: serialized.filter((item) => item.status !== 'CUMPLIDO'), automatic_structure: vulnerable && serialized.length > 0 };
  }

  static async linkExisting(user: User, expedienteId: string, requirementId: string, documentId: string, correlationId?: string) {
    return prisma.$transaction(async (tx) => {
      const requirement = await this.assertRequirement(tx, user, expedienteId, requirementId);
      const document = await this.assertDocumentScope(tx, user, requirement, documentId);
      const existing = await tx.complianceEvidence.findFirst({ where: { organization_id: user.organizationId, requirement_id: requirement.id, documento_id: document.id, estatus: 'ACTIVO' } });
      if (existing) return { evidence: existing, idempotent: true };
      const definition = definitionOf(requirement);
      const generated = definition.source === 'FORMAT_GENERATED';
      const futureModule = definition.source === 'FUTURE_MODULE';
      const evidence = await tx.complianceEvidence.create({ data: {
        organization_id: user.organizationId, expediente_id: expedienteId, review_id: requirement.review_id,
        requirement_id: requirement.id, target_compareciente_id: requirement.target_compareciente_id,
        documento_id: document.id, tipo_evidencia: 'CUM_DOC', agregado_por_id: user.id,
        document_version: versionOf(document), document_checksum_snapshot: document.checksum_sha256,
        storage_key_snapshot: document.storage_key, source: generated ? 'FORMAT_GENERATED' : futureModule ? 'FUTURE_MODULE' : requirement.target_compareciente_id ? 'COMPARECIENTE' : 'EXPEDIENTE',
        document_state: generated ? 'GENERATED' : 'CANONICAL', validation_status: requirement.requires_human_validation || generated ? 'PENDING_HUMAN' : 'AUTO_LINKED', linked_by_system: false,
      } });
      await this.refreshRequirementTx(tx, user, requirement.id);
      await this.auditTx(tx, user, 'LINK_COMPLIANCE_DOCUMENT_EVIDENCE', 'ComplianceEvidence', evidence.id, { requirement_id: requirement.id, document_version: evidence.document_version }, correlationId);
      return { evidence, idempotent: false };
    });
  }

  static async uploadSigned(user: User, expedienteId: string, requirementId: string, file: Express.Multer.File, correlationId?: string) {
    if (!file || file.mimetype !== 'application/pdf' || !file.buffer?.length) throw new ComplianceError('Carga un archivo PDF firmado válido.', 'H2_SIGNED_PDF_REQUIRED');
    const preflight = await this.assertRequirement(prisma, user, expedienteId, requirementId);
    if (!preflight.requires_signed_document) throw new ComplianceError('Este requisito no solicita un formato firmado.', 'H2_SIGNED_UPLOAD_NOT_REQUIRED', 409);
    const digest = checksum(file.buffer);
    const storageKey = `organizations/${user.organizationId}/documentos/${randomUUID()}.pdf`;
    await uploadFile(file.buffer, storageKey, file.mimetype);
    try {
      return await prisma.$transaction(async (tx) => {
        const requirement = await this.assertRequirement(tx, user, expedienteId, requirementId);
        const document = await tx.documento.create({ data: {
          organization_id: user.organizationId, nombre_original: sanitizeComplianceZipName(file.originalname || 'formato-firmado.pdf'),
          nombre_interno: storageKey, tipo: `CUM_DOC_FIRMADO:${requirement.expected_document_type || requirement.requirement_key}`,
          categoria: 'UIF', storage_key: storageKey, mime_type: file.mimetype, size_bytes: file.size,
          checksum_sha256: digest, estatus: 'PENDIENTE', subido_por_id: user.id, expediente_id: expedienteId,
          compareciente_id: requirement.target_compareciente_id,
        } });
        await tx.expedienteDocumento.create({ data: {
          organization_id: user.organizationId, expediente_id: expedienteId, documento_id: document.id,
          tipo_vinculo: 'CUMPLIMIENTO_FIRMADO', creado_por_id: user.id, origen: 'EXPEDIENTE',
          source_entity_type: 'COMPLIANCE_REQUIREMENT', source_entity_id: requirement.id, source_context: 'CUM_DOC_SIGNED_UPLOAD',
          source_key: `EXPEDIENTE:COMPLIANCE_REQUIREMENT:${requirement.id}:${document.id}:SIGNED`, document_version: digest,
          provenance: json({ h2_contract: 'CUM-DOC-001', requirement_id: requirement.id, signed_upload: true }),
        } });
        if (requirement.target_compareciente_id) {
          await tx.comparecienteDocumento.create({ data: {
            organization_id: user.organizationId, compareciente_id: requirement.target_compareciente_id,
            documento_id: document.id, categoria: 'OTROS', subcategoria: requirement.expected_document_type || requirement.requirement_key,
            estatus: 'ACTIVO', creado_por_id: user.id,
            observaciones: 'Versión firmada vinculada por CUM-DOC-001.',
          } });
        }
        const evidence = await tx.complianceEvidence.create({ data: {
          organization_id: user.organizationId, expediente_id: expedienteId, review_id: requirement.review_id,
          requirement_id: requirement.id, target_compareciente_id: requirement.target_compareciente_id,
          documento_id: document.id, tipo_evidencia: 'CUM_DOC_SIGNED', agregado_por_id: user.id,
          document_version: digest, document_checksum_snapshot: digest, storage_key_snapshot: storageKey,
          source: 'MANUAL_SIGNED_UPLOAD', document_state: 'SIGNED_UPLOADED', validation_status: 'PENDING_HUMAN', linked_by_system: false,
        } });
        await tx.complianceRequirement.update({ where: { id: requirement.id }, data: { status: 'EN_PROCESO' } });
        await this.recalculateStateTx(tx, user, requirement.state_id, requirement.review_id);
        await this.auditTx(tx, user, 'UPLOAD_SIGNED_COMPLIANCE_EVIDENCE', 'ComplianceEvidence', evidence.id, { requirement_id: requirement.id, document_version: digest }, correlationId);
        return { evidence, document: { id: document.id, nombre_original: document.nombre_original } };
      });
    } catch (error) {
      await deleteFile(storageKey).catch(() => undefined);
      throw error;
    }
  }

  static async validate(user: User, expedienteId: string, evidenceId: string, body: { result?: string; notes?: string }, correlationId?: string) {
    const result = body.result === 'REJECTED' ? 'REJECTED' : body.result === 'VALIDATED' ? 'VALIDATED' : null;
    if (!result) throw new ComplianceError('Selecciona un resultado de validación válido.', 'H2_VALIDATION_RESULT_REQUIRED');
    return prisma.$transaction(async (tx) => {
      await this.assertExpediente(tx, user, expedienteId);
      const evidence = await tx.complianceEvidence.findFirst({ where: { id: evidenceId, organization_id: user.organizationId, expediente_id: expedienteId, estatus: 'ACTIVO', requirement_id: { not: null } }, include: { requirement: true } });
      if (!evidence?.requirement) throw new ComplianceError('Evidencia no encontrada.', 'H2_EVIDENCE_NOT_FOUND', 404);
      if (result === 'VALIDATED' && evidence.requirement.requires_signed_document && evidence.document_state !== 'SIGNED_UPLOADED') throw new ComplianceError('La versión generada no satisface un requisito firmado.', 'H2_SIGNED_VERSION_REQUIRED', 409);
      const updated = await tx.complianceEvidence.update({ where: { id: evidence.id }, data: { validation_status: result, validated_by_id: user.id, validated_at: new Date(), validation_notes: String(body.notes || '').trim() || null } });
      await this.refreshRequirementTx(tx, user, evidence.requirement.id);
      await this.auditTx(tx, user, 'VALIDATE_COMPLIANCE_DOCUMENT_EVIDENCE', 'ComplianceEvidence', evidence.id, { result, requirement_id: evidence.requirement.id }, correlationId);
      return updated;
    });
  }

  static async exportPackage(user: User, expedienteId: string, correlationId?: string) {
    await this.assertExpediente(prisma, user, expedienteId);
    const state = await prisma.expedienteComplianceState.findFirst({ where: { organization_id: user.organizationId, expediente_id: expedienteId } });
    if (!state?.current_review_id) throw new ComplianceError('No existe una evaluación documental para exportar.', 'H2_EXPORT_REVIEW_REQUIRED', 409);
    const requirements = await prisma.complianceRequirement.findMany({
      where: { organization_id: user.organizationId, expediente_id: expedienteId, review_id: state.current_review_id, is_documental: true },
      include: { evidence: { where: { estatus: 'ACTIVO' }, include: { documento: true }, orderBy: { created_at: 'asc' } } },
      orderBy: [{ document_category: 'asc' }, { label: 'asc' }],
    });
    const selected = requirements.flatMap((requirement) => requirement.evidence.filter((evidence) => h2EvidenceSatisfies(requirement, evidence)).map((evidence) => ({ requirement, evidence })));
    if (!selected.length) throw new ComplianceError('Todavía no hay archivos validados para integrar el paquete.', 'H2_EXPORT_NO_VALIDATED_FILES', 409);
    const seen = new Map<string, string>();
    const files = new Map<string, Buffer>();
    const manifest: Array<Record<string, unknown>> = [];
    for (const item of selected) {
      const versionKey = `${item.evidence.documento_id}:${item.evidence.document_version}`;
      let entry = seen.get(versionKey);
      if (!entry) {
        await this.assertDocumentScope(prisma, user, item.requirement, item.evidence.documento_id);
        const key = item.evidence.storage_key_snapshot || '';
        if (!key || !(await fileExists(key))) throw new ComplianceError('Una evidencia validada no tiene archivo físico disponible.', 'H2_EXPORT_BLOB_MISSING', 409);
        const bytes = await downloadFile(key);
        if (item.evidence.document_checksum_snapshot && checksum(bytes) !== item.evidence.document_checksum_snapshot) throw new ComplianceError('La versión física no coincide con la evidencia validada.', 'H2_EXPORT_VERSION_MISMATCH', 409);
        const folder = categoryFolders[String(item.requirement.document_category)] || 'Documentos';
        const base = sanitizeComplianceZipName(item.evidence.documento.nombre_original);
        entry = `${folder}/${base}`;
        let suffix = 2;
        while ([...seen.values()].includes(entry)) {
          const extension = path.extname(base); const stem = base.slice(0, base.length - extension.length);
          entry = `${folder}/${stem}-${suffix}${extension}`; suffix += 1;
        }
        files.set(entry, bytes); seen.set(versionKey, entry);
      }
      manifest.push({ requirement: item.requirement.label, category: item.requirement.document_category, file: entry, document_version: item.evidence.document_version, target_compareciente_id: item.requirement.target_compareciente_id || null });
    }
    const buffer = await buildComplianceDocumentZip(
      [...files].map(([filePath, bytes]) => ({ path: filePath, bytes })),
      { contract: 'CUM-DOC-001', expediente: expedienteId, generated_at: new Date().toISOString(), evidence: manifest },
    );
    await prisma.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: 'EXPORT_COMPLIANCE_DOCUMENT_PACKAGE', entidad: 'Expediente', entidad_id: expedienteId, valores_nuevos: json({ file_count: seen.size, requirement_count: manifest.length, stable_versions: true }), correlation_id: correlationId, session_id: user.sessionId } });
    return { buffer, fileName: `cumplimiento-${sanitizeComplianceZipName(expedienteId)}.zip`, fileCount: seen.size };
  }

  private static async autoLinkComparecienteTx(tx: Prisma.TransactionClient, user: ComplianceDocumentActor, requirement: any, definition: ComplianceDocumentRequirementDefinition, correlationId?: string) {
    if (definition.source !== 'COMPARECIENTE' || !requirement.target_compareciente_id || !definition.expected_document_type) return requirement;
    const candidates = await tx.comparecienteDocumento.findMany({
      where: { organization_id: user.organizationId, compareciente_id: requirement.target_compareciente_id, archived_at: null, estatus: 'ACTIVO', documento: { organization_id: user.organizationId, estatus: { in: ['VIGENTE', 'POR_VENCER'] } } },
      include: { documento: true }, orderBy: [{ principal: 'desc' }, { fecha_validacion: 'desc' }, { created_at: 'desc' }, { id: 'asc' }],
    });
    for (const candidate of candidates) {
      const result = await this.linkComparecienteEvidenceTx(tx, user, requirement, definition, candidate, correlationId);
      if (!result.linked) continue;
      const status = requirement.requires_human_validation || requirement.requires_signed_document ? 'EN_PROCESO' : 'CUMPLIDO';
      return tx.complianceRequirement.update({ where: { id: requirement.id }, data: { status } });
    }
    return requirement;
  }

  private static async linkComparecienteEvidenceTx(tx: Prisma.TransactionClient, user: ComplianceDocumentActor, requirement: any, definition: ComplianceDocumentRequirementDefinition, candidate: any, correlationId?: string) {
    if (definition.source !== 'COMPARECIENTE' || !requirement.target_compareciente_id || !definition.expected_document_type) return { linked: false, created: false };
    if (candidate.compareciente_id !== requirement.target_compareciente_id || candidate.organization_id !== user.organizationId || candidate.documento.organization_id !== user.organizationId) return { linked: false, created: false };
    const expected = normalize(definition.expected_document_type);
    if (![candidate.categoria, candidate.subcategoria, candidate.documento.tipo].some((value) => normalize(value) === expected)) return { linked: false, created: false };
    const activeEvidence = Array.isArray(requirement.evidence)
      ? requirement.evidence
      : await tx.complianceEvidence.findMany({ where: { organization_id: user.organizationId, requirement_id: requirement.id, estatus: 'ACTIVO' } });
    if (activeEvidence.some((item: any) => h2EvidenceSatisfies(requirement, item))) return { linked: false, created: false };

    const version = versionOf(candidate.documento);
    const inserted = await tx.complianceEvidence.createMany({
      data: [{
        organization_id: user.organizationId, expediente_id: requirement.expediente_id, review_id: requirement.review_id,
        requirement_id: requirement.id, target_compareciente_id: requirement.target_compareciente_id,
        documento_id: candidate.documento.id, tipo_evidencia: 'CUM_DOC_AUTO', agregado_por_id: user.id,
        document_version: version, document_checksum_snapshot: candidate.documento.checksum_sha256,
        storage_key_snapshot: candidate.documento.storage_key, source: 'COMPARECIENTE', document_state: 'CANONICAL',
        validation_status: 'AUTO_LINKED', linked_by_system: true,
      }],
      skipDuplicates: true,
    });
    const evidence = await tx.complianceEvidence.findFirst({ where: {
      organization_id: user.organizationId,
      requirement_id: requirement.id,
      documento_id: candidate.documento.id,
      document_version: version,
      estatus: 'ACTIVO',
    } });
    if (!evidence) throw new ComplianceError('No fue posible sincronizar la evidencia documental.', 'H2_AUTO_LINK_SYNC_FAILED', 500);
    if (inserted.count > 0) {
      await this.auditTx(tx, user, 'AUTO_LINK_COMPLIANCE_DOCUMENT_EVIDENCE', 'ComplianceEvidence', evidence.id, { requirement_id: requirement.id, document_version: version }, correlationId);
    }
    return { linked: true, created: inserted.count > 0 };
  }

  private static async refreshRequirementTx(tx: Prisma.TransactionClient, user: ComplianceDocumentActor, requirementId: string) {
    const requirement = await tx.complianceRequirement.findFirst({ where: { id: requirementId, organization_id: user.organizationId }, include: { evidence: { where: { estatus: 'ACTIVO' } } } });
    if (!requirement) throw new ComplianceError('Requisito documental no encontrado.', 'H2_REQUIREMENT_NOT_FOUND', 404);
    const satisfied = requirement.evidence.some((item) => h2EvidenceSatisfies(requirement, item));
    const status = satisfied ? 'CUMPLIDO' : requirement.evidence.some((item) => item.validation_status !== 'REJECTED') ? 'EN_PROCESO' : 'PENDIENTE';
    const updated = await tx.complianceRequirement.update({ where: { id: requirement.id }, data: { status } });
    await this.recalculateStateTx(tx, user, requirement.state_id, requirement.review_id);
    return updated;
  }

  private static async recalculateStateTx(tx: Prisma.TransactionClient, user: ComplianceDocumentActor, stateId: string, reviewId: string) {
    const requirements = await tx.complianceRequirement.findMany({ where: { organization_id: user.organizationId, state_id: stateId, review_id: reviewId }, select: { status: true, deadline: true } });
    const statuses = requirements.map((item) => item.status);
    const deadlines = requirements.map((item) => item.deadline);
    const state = deriveComplianceState(statuses, deadlines) as any;
    const pendingCount = statuses.filter((status) => !['CUMPLIDO', 'NO_APLICA'].includes(status)).length;
    await tx.expedienteComplianceState.update({ where: { id: stateId }, data: { state, pending_count: pendingCount, updated_by_id: user.id } });
  }

  private static async assertRequirement(db: Db, user: User, expedienteId: string, requirementId: string) {
    await this.assertExpediente(db, user, expedienteId);
    const state = await db.expedienteComplianceState.findFirst({ where: { organization_id: user.organizationId, expediente_id: expedienteId }, select: { current_review_id: true } });
    const requirement = await db.complianceRequirement.findFirst({ where: { id: requirementId, organization_id: user.organizationId, expediente_id: expedienteId, review_id: state?.current_review_id || undefined, is_documental: true } });
    if (!requirement) throw new ComplianceError('Requisito documental no encontrado.', 'H2_REQUIREMENT_NOT_FOUND', 404);
    return requirement;
  }

  private static async assertExpediente(db: Db, user: User, expedienteId: string) {
    const expediente = await db.expediente.findFirst({ where: { id: expedienteId, organization_id: user.organizationId, archived_at: null, ...expedienteAccessWhere(user) }, select: { id: true } });
    if (!expediente) throw new ComplianceError('Expediente no encontrado.', 'H2_CASE_ACCESS_DENIED', 403);
    return expediente;
  }

  private static async assertDocumentScope(db: Db, user: User, requirement: any, documentId: string) {
    const target = requirement.target_compareciente_id;
    const document = await db.documento.findFirst({
      where: {
        id: documentId, organization_id: user.organizationId,
        ...(target ? { OR: [{ compareciente_id: target }, { comparecienteVinculos: { some: { organization_id: user.organizationId, compareciente_id: target, archived_at: null, estatus: 'ACTIVO' } } }] }
          : { OR: [{ expediente_id: requirement.expediente_id }, { expedienteVinculos: { some: { organization_id: user.organizationId, expediente_id: requirement.expediente_id, estatus: 'ACTIVO' } } }] }),
      },
    });
    if (!document) throw new ComplianceError('El documento no pertenece al objeto autorizado para este requisito.', 'H2_DOCUMENT_OBJECT_ACCESS_DENIED', 403);
    return document;
  }

  private static auditTx(tx: Prisma.TransactionClient, user: ComplianceDocumentActor, action: string, entity: string, entityId: string, values: Record<string, unknown>, correlationId?: string) {
    return tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id, accion: action, entidad: entity, entidad_id: entityId, valores_nuevos: json(values), correlation_id: correlationId, session_id: user.sessionId } });
  }
}
