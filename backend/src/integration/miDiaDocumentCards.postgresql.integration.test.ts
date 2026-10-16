import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { MiDiaDocumentCardsService } from '../services/miDiaDocumentCards.service';
import { MiDiaComplianceCardsService } from '../services/miDiaComplianceCards.service';

const target = process.env.DATABASE_URL || '';
const parsed = new URL(target || 'postgresql://invalid.invalid/blocked');
if (process.env.MIDIA_QA === '1' && (process.env.NODE_ENV !== 'test'
  || target !== process.env.DIRECT_URL || parsed.hostname !== '127.0.0.1'
  || parsed.port !== '55510' || parsed.pathname !== '/pravia_qa'
  || parsed.searchParams.get('schema') !== 'pravia_os')) {
  throw new Error('Mi Día document integration requires isolated local PostgreSQL.');
}
const db = new PrismaClient({ datasources: { db: { url: target } } });
type Actor = NonNullable<Request['user']>;
afterAll(async () => db.$disconnect());

describe.runIf(process.env.MIDIA_QA === '1')('Mi Día document cards · physical PostgreSQL', () => {
  it('counts current act requirements/review/expiry, not historical or foreign links, and rolls back', async () => {
    const ids = { org: randomUUID(), foreignOrg: randomUUID(), owner: randomUUID(), peer: randomUUID(), foreign: randomUUID(),
      ownCase: randomUUID(), peerCase: randomUUID(), foreignCase: randomUUID(),
      ownCompliance: randomUUID(), peerCompliance: randomUUID(), foreignCompliance: randomUUID(),
      ownReview: randomUUID(), peerReview: randomUUID(), foreignReview: randomUUID(), staleReview: randomUUID(),
      criticalAlert: randomUUID(), warningAlert: randomUUID(), resolvedAlert: randomUUID(), staleAlert: randomUUID(),
      peerAlert: randomUUID(), foreignAlert: randomUUID(),
      upcomingNotice: randomUUID(), overdueNotice: randomUUID(), completeNotice: randomUUID(),
      staleNotice: randomUUID(), peerNotice: randomUUID(), foreignNotice: randomUUID(),
      valid: randomUUID(), expired: randomUUID(), review: randomUUID(), foreignDoc: randomUUID(),
      validReq: randomUUID(), missingReq: randomUUID(), reviewReq: randomUUID(), foreignReq: randomUUID(),
      notaria: randomUUID(), foreignNotaria: randomUUID(),
      artifact: randomUUID(), artifactVersion: randomUUID(), artifactRule: randomUUID(),
      foreignArtifact: randomUUID(), foreignVersion: randomUUID(), foreignRule: randomUUID(),
      ownFormat: randomUUID(), peerFormat: randomUUID(), foreignFormat: randomUUID(), validatedFormat: randomUUID(),
      ownProject: randomUUID(), peerProject: randomUUID(), foreignProject: randomUUID(),
      ownReport: randomUUID(), peerReport: randomUUID(), foreignReport: randomUUID() };
    const signedFormats = { own: randomUUID(), signed: randomUUID(), old: randomUUID(),
      peer: randomUUID(), foreign: randomUUID() };
    const now = new Date('2026-10-13T12:00:00.000Z');
    const actor: Actor = { id: ids.owner, email: 'document-qa@example.test', nombre: 'QA', apellido: 'Local',
      rol: 'ABOGADO', scope: 'ASSIGNED_OBJECTS', organizationId: ids.org, membershipId: randomUUID(),
      sessionId: randomUUID(), permissions: ['expedientes.read', 'documentos.read', 'expedientes.project.read', 'compliance.read', 'ai.work.read'], requiresPasswordChange: false };
    const director: Actor = { ...actor, rol: 'DIRECCION', scope: 'GLOBAL' };
    const rollback = new Error('MI_DIA_DOCUMENT_ROLLBACK');
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({ data: [{ id: ids.org, name: 'Mi Día document QA' },
          { id: ids.foreignOrg, name: 'Mi Día document foreign QA' }] });
        await tx.user.createMany({ data: [ids.owner, ids.peer, ids.foreign].map((id) => ({ id,
          nombre: 'Documento', apellido: 'QA', email: `document-${id}@example.test`,
          password_hash: 'synthetic-only', rol: 'ABOGADO' })) });
        await tx.organizationMembership.createMany({ data: [
          { organization_id: ids.org, user_id: ids.owner, rol: 'ABOGADO' },
          { organization_id: ids.org, user_id: ids.peer, rol: 'ABOGADO' },
          { organization_id: ids.foreignOrg, user_id: ids.foreign, rol: 'ABOGADO' },
        ] });
        await tx.notaria.createMany({ data: [
          { id: ids.notaria, organization_id: ids.org, nombre: 'Notaría QA' },
          { id: ids.foreignNotaria, organization_id: ids.foreignOrg, nombre: 'Notaría ajena QA' },
        ] });
        await tx.expediente.createMany({ data: [
          { id: ids.ownCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.ownCase}`,
            abogado_id: ids.owner, creador_id: ids.owner },
          { id: ids.peerCase, organization_id: ids.org, numero_pravia: `EXP-QA-${ids.peerCase}`,
            abogado_id: ids.peer, creador_id: ids.peer },
          { id: ids.foreignCase, organization_id: ids.foreignOrg, numero_pravia: `EXP-QA-${ids.foreignCase}`,
            abogado_id: ids.foreign, creador_id: ids.foreign },
        ] });
        await tx.expedienteComplianceState.createMany({ data: [
          { id: ids.ownCompliance, organization_id: ids.org, expediente_id: ids.ownCase,
            updated_by_id: ids.owner, state: 'EN_PROCESO', pending_count: 2 },
          { id: ids.peerCompliance, organization_id: ids.org, expediente_id: ids.peerCase,
            updated_by_id: ids.peer, state: 'PENDIENTE', pending_count: 1 },
          { id: ids.foreignCompliance, organization_id: ids.foreignOrg, expediente_id: ids.foreignCase,
            updated_by_id: ids.foreign, state: 'VENCIDO', pending_count: 1 },
        ] });
        await tx.complianceReview.createMany({ data: [
          [ids.ownReview, ids.org, ids.ownCase, ids.owner],
          [ids.peerReview, ids.org, ids.peerCase, ids.peer],
          [ids.foreignReview, ids.foreignOrg, ids.foreignCase, ids.foreign],
          [ids.staleReview, ids.org, ids.ownCase, ids.owner],
        ].map(([id, organization_id, expediente_id, creado_por_id]) => ({ id, organization_id,
          expediente_id, creado_por_id, tipo: 'UIF', rule_version_snapshot: 'QA',
          cuestionario_json: {}, rule_snapshot: {}, master_snapshot: {} })) });
        await Promise.all([
          tx.expedienteComplianceState.update({ where: { id: ids.ownCompliance }, data: { current_review_id: ids.ownReview } }),
          tx.expedienteComplianceState.update({ where: { id: ids.peerCompliance }, data: { current_review_id: ids.peerReview } }),
          tx.expedienteComplianceState.update({ where: { id: ids.foreignCompliance }, data: { current_review_id: ids.foreignReview } }),
        ]);
        await tx.complianceAlert.createMany({ data: [
          { id: ids.criticalAlert, organization_id: ids.org, expediente_id: ids.ownCase,
            state_id: ids.ownCompliance, review_id: ids.ownReview, alert_key: 'QA:CRITICAL',
            level: 'CRITICA', status: 'ABIERTA', message: 'Obligación jurídica vencida' },
          { id: ids.warningAlert, organization_id: ids.org, expediente_id: ids.ownCase,
            state_id: ids.ownCompliance, review_id: ids.ownReview, alert_key: 'QA:WARNING',
            level: 'ADVERTENCIA', status: 'ABIERTA', message: 'Aviso no crítico' },
          { id: ids.resolvedAlert, organization_id: ids.org, expediente_id: ids.ownCase,
            state_id: ids.ownCompliance, review_id: ids.ownReview, alert_key: 'QA:RESOLVED',
            level: 'CRITICA', status: 'RESUELTA', message: 'Alerta resuelta' },
          { id: ids.staleAlert, organization_id: ids.org, expediente_id: ids.ownCase,
            state_id: ids.ownCompliance, review_id: ids.staleReview, alert_key: 'QA:STALE',
            level: 'CRITICA', status: 'ABIERTA', message: 'Revisión antigua' },
          { id: ids.peerAlert, organization_id: ids.org, expediente_id: ids.peerCase,
            state_id: ids.peerCompliance, review_id: ids.peerReview, alert_key: 'QA:PEER',
            level: 'CRITICA', status: 'ABIERTA', message: 'Alerta de colega' },
          { id: ids.foreignAlert, organization_id: ids.foreignOrg, expediente_id: ids.foreignCase,
            state_id: ids.foreignCompliance, review_id: ids.foreignReview, alert_key: 'QA:FOREIGN',
            level: 'CRITICA', status: 'ABIERTA', message: 'Alerta externa' },
        ] });
        await tx.complianceObligation.createMany({ data: [
          [ids.upcomingNotice, ids.org, ids.ownCase, ids.ownReview, 'PENDIENTE', 'CURRENT', '2026-10-15'],
          [ids.overdueNotice, ids.org, ids.ownCase, ids.ownReview, 'PENDIENTE', 'CURRENT', '2026-10-01'],
          [ids.completeNotice, ids.org, ids.ownCase, ids.ownReview, 'CUMPLIDO', 'CURRENT', '2026-10-15'],
          [ids.staleNotice, ids.org, ids.ownCase, ids.ownReview, 'PENDIENTE', 'STALE', '2026-10-15'],
          [ids.peerNotice, ids.org, ids.peerCase, ids.peerReview, 'PENDIENTE', 'CURRENT', '2026-10-15'],
          [ids.foreignNotice, ids.foreignOrg, ids.foreignCase, ids.foreignReview, 'PENDIENTE', 'CURRENT', '2026-10-15'],
        ].map(([id, organization_id, expediente_id, review_id, avi_state, freshness, due]) => ({
          id, organization_id, expediente_id, review_id, avi_state: avi_state as 'PENDIENTE' | 'CUMPLIDO',
          freshness: freshness as 'CURRENT' | 'STALE', due_at: new Date(`${due}T12:00:00.000Z`),
          type: 'AVISO', legal_basis: 'QA local sintética', rule_version: 'QA', rule_status: 'QA',
          origin_date: now, channel: 'QA', checklist: {}, snapshot: {},
        })) });
        await tx.documento.createMany({ data: [
          { id: ids.valid, organization_id: ids.org, nombre_original: 'vigente.pdf', nombre_interno: `midia-${ids.valid}`,
            tipo: 'QA', storage_key: `midia/${ids.valid}`, mime_type: 'application/pdf', size_bytes: 1,
            estatus: 'VIGENTE', subido_por_id: ids.owner, fecha_vigencia: new Date('2026-11-01T00:00:00.000Z') },
          { id: ids.expired, organization_id: ids.org, nombre_original: 'vencido.pdf', nombre_interno: `midia-${ids.expired}`,
            tipo: 'QA', storage_key: `midia/${ids.expired}`, mime_type: 'application/pdf', size_bytes: 1,
            estatus: 'VIGENTE', subido_por_id: ids.owner, fecha_vigencia: new Date('2026-10-01T00:00:00.000Z') },
          { id: ids.review, organization_id: ids.org, nombre_original: 'revision.pdf', nombre_interno: `midia-${ids.review}`,
            tipo: 'QA', storage_key: `midia/${ids.review}`, mime_type: 'application/pdf', size_bytes: 1,
            estatus: 'PENDIENTE', subido_por_id: ids.peer },
          { id: ids.foreignDoc, organization_id: ids.foreignOrg, nombre_original: 'ajeno.pdf', nombre_interno: `midia-${ids.foreignDoc}`,
            tipo: 'QA', storage_key: `midia/${ids.foreignDoc}`, mime_type: 'application/pdf', size_bytes: 1,
            estatus: 'VENCIDO', subido_por_id: ids.foreign, fecha_vigencia: new Date('2026-10-01T00:00:00.000Z') },
        ] });
        await tx.expedienteRequisitoDoc.createMany({ data: [
          { id: ids.validReq, expediente_id: ids.ownCase, nombre: 'Identificación vigente', estatus: 'VALIDADO' },
          { id: ids.missingReq, expediente_id: ids.ownCase, nombre: 'Documento vencido', estatus: 'PENDIENTE' },
          { id: ids.reviewReq, expediente_id: ids.peerCase, nombre: 'Pendiente de revisar', estatus: 'EN_REVISION' },
          { id: ids.foreignReq, expediente_id: ids.foreignCase, nombre: 'Extranjero', estatus: 'PENDIENTE' },
        ] });
        await tx.requisitoDocumentoVinculo.createMany({ data: [
          { requisito_id: ids.validReq, documento_id: ids.valid, creado_por_id: ids.owner },
          { requisito_id: ids.missingReq, documento_id: ids.expired, creado_por_id: ids.owner },
          { requisito_id: ids.reviewReq, documento_id: ids.review, creado_por_id: ids.peer },
        ] });
        await tx.expedienteDocumento.createMany({ data: [
          { organization_id: ids.org, expediente_id: ids.ownCase, documento_id: ids.expired,
            tipo_vinculo: 'QA', source_key: `midia-${ids.expired}`, creado_por_id: ids.owner },
          { organization_id: ids.org, expediente_id: ids.ownCase, documento_id: ids.valid,
            tipo_vinculo: 'QA', source_key: `midia-${ids.valid}`, creado_por_id: ids.owner },
          { organization_id: ids.foreignOrg, expediente_id: ids.foreignCase, documento_id: ids.foreignDoc,
            tipo_vinculo: 'QA', source_key: `midia-${ids.foreignDoc}`, creado_por_id: ids.foreign },
        ] });
        await tx.documento.createMany({ data: [
          { id: ids.ownProject, organization_id: ids.org, nombre_original: 'proyecto.docx',
            nombre_interno: `midia-${ids.ownProject}`, storage_key: `midia/${ids.ownProject}`,
            tipo: 'PROYECTO_ESCRITURA', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size_bytes: 1, estatus: 'VIGENTE', subido_por_id: ids.owner, expediente_id: ids.ownCase },
          { id: ids.peerProject, organization_id: ids.org, nombre_original: 'proyecto-par.docx',
            nombre_interno: `midia-${ids.peerProject}`, storage_key: `midia/${ids.peerProject}`,
            tipo: 'PROYECTO_ESCRITURA', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size_bytes: 1, estatus: 'VIGENTE', subido_por_id: ids.peer, expediente_id: ids.peerCase },
          { id: ids.foreignProject, organization_id: ids.foreignOrg, nombre_original: 'proyecto-ajeno.docx',
            nombre_interno: `midia-${ids.foreignProject}`, storage_key: `midia/${ids.foreignProject}`,
            tipo: 'PROYECTO_ESCRITURA', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size_bytes: 1, estatus: 'VIGENTE', subido_por_id: ids.foreign, expediente_id: ids.foreignCase },
          { id: ids.ownReport, organization_id: ids.org, nombre_original: 'reporte.docx',
            nombre_interno: `midia-${ids.ownReport}`, storage_key: `midia/${ids.ownReport}`,
            tipo: 'REPORTE_IA_PROYECTO', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size_bytes: 1, estatus: 'VIGENTE', subido_por_id: ids.owner, expediente_id: ids.ownCase,
            datos_extraidos: { reporte_ia_proyecto: { proyecto_version_id: ids.ownProject,
              observaciones: [{ tipo_discrepancia: 'Identificación inconsistente', nivel_riesgo: 'ALTO' },
                { tipo_discrepancia: 'Dato no sustentado', nivel_riesgo: 'MEDIO' }] } } },
          { id: ids.peerReport, organization_id: ids.org, nombre_original: 'reporte-antiguo.docx',
            nombre_interno: `midia-${ids.peerReport}`, storage_key: `midia/${ids.peerReport}`,
            tipo: 'REPORTE_IA_PROYECTO', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size_bytes: 1, estatus: 'VIGENTE', subido_por_id: ids.peer, expediente_id: ids.peerCase,
            datos_extraidos: { reporte_ia_proyecto: { proyecto_version_id: randomUUID(),
              observaciones: [{ tipo_discrepancia: 'Hallazgo obsoleto' }] } } },
          { id: ids.foreignReport, organization_id: ids.foreignOrg, nombre_original: 'reporte-ajeno.docx',
            nombre_interno: `midia-${ids.foreignReport}`, storage_key: `midia/${ids.foreignReport}`,
            tipo: 'REPORTE_IA_PROYECTO', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size_bytes: 1, estatus: 'VIGENTE', subido_por_id: ids.foreign, expediente_id: ids.foreignCase,
            datos_extraidos: { reporte_ia_proyecto: { proyecto_version_id: ids.foreignProject,
              observaciones: [{ tipo_discrepancia: 'Hallazgo otro tenant' }] } } },
        ] });
        await tx.expedienteDocumento.createMany({ data: [
          [ids.org, ids.ownCase, ids.owner, ids.ownProject, 'PROYECTO_ESCRITURA'],
          [ids.org, ids.ownCase, ids.owner, ids.ownReport, 'REPORTE_IA_PROYECTO'],
          [ids.org, ids.peerCase, ids.peer, ids.peerProject, 'PROYECTO_ESCRITURA'],
          [ids.org, ids.peerCase, ids.peer, ids.peerReport, 'REPORTE_IA_PROYECTO'],
          [ids.foreignOrg, ids.foreignCase, ids.foreign, ids.foreignProject, 'PROYECTO_ESCRITURA'],
          [ids.foreignOrg, ids.foreignCase, ids.foreign, ids.foreignReport, 'REPORTE_IA_PROYECTO'],
        ].map(([organization_id, expediente_id, creado_por_id, documento_id, tipo_vinculo]) => ({
          organization_id, expediente_id, creado_por_id, documento_id, tipo_vinculo,
          source_key: `midia-project-${documento_id}`,
        })) });
        await tx.catalogoArtefacto.createMany({ data: [
          { id: ids.artifact, organization_id: ids.org, tipo: 'FORMATO', propietario_tipo: 'NOTARIA',
            notaria_id: ids.notaria, nombre: 'Formato QA', creado_por_id: ids.owner, actualizado_por_id: ids.owner },
          { id: ids.foreignArtifact, organization_id: ids.foreignOrg, tipo: 'FORMATO', propietario_tipo: 'NOTARIA',
            notaria_id: ids.foreignNotaria, nombre: 'Formato ajeno', creado_por_id: ids.foreign, actualizado_por_id: ids.foreign },
        ] });
        await tx.catalogoArtefactoVersion.createMany({ data: [
          { id: ids.artifactVersion, organization_id: ids.org, artefacto_id: ids.artifact,
            version: 1, origen: 'QA', creado_por_id: ids.owner, nombre_original: 'formato-qa.docx',
            storage_key: `midia/${ids.artifactVersion}.docx`, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size_bytes: 1, checksum_sha256: 'a'.repeat(64) },
          { id: ids.foreignVersion, organization_id: ids.foreignOrg, artefacto_id: ids.foreignArtifact,
            version: 1, origen: 'QA', creado_por_id: ids.foreign, nombre_original: 'formato-ajeno.docx',
            storage_key: `midia/${ids.foreignVersion}.docx`, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size_bytes: 1, checksum_sha256: 'b'.repeat(64) },
        ] });
        await tx.catalogoArtefactoRegla.createMany({ data: [
          { id: ids.artifactRule, organization_id: ids.org, artefacto_id: ids.artifact, multiplicidad: 'COMPARECIENTE' },
          { id: ids.foreignRule, organization_id: ids.foreignOrg, artefacto_id: ids.foreignArtifact, multiplicidad: 'COMPARECIENTE' },
        ] });
        await tx.expedienteArtefactoPendiente.createMany({ data: [
          [ids.ownFormat, ids.org, ids.ownCase, ids.artifact, ids.artifactVersion, ids.artifactRule, ids.owner, 'PENDIENTE'],
          [ids.peerFormat, ids.org, ids.peerCase, ids.artifact, ids.artifactVersion, ids.artifactRule, ids.peer, 'PENDIENTE'],
          [ids.validatedFormat, ids.org, ids.ownCase, ids.artifact, ids.artifactVersion, ids.artifactRule, ids.owner, 'NO_APLICA'],
          [ids.foreignFormat, ids.foreignOrg, ids.foreignCase, ids.foreignArtifact, ids.foreignVersion, ids.foreignRule, ids.foreign, 'PENDIENTE'],
        ].map(([id, organization_id, expediente_id, artefacto_id, artefacto_version_id, regla_id, created_by, estado]) => ({
          id, organization_id, expediente_id, artefacto_id, artefacto_version_id, regla_id,
          created_by, estado: estado as 'PENDIENTE' | 'NO_APLICA', source_revision: 'QA',
          sujeto_tipo: 'COMPARECIENTE' as const, sujeto_id: randomUUID(),
          identity_key: `QA:${id}`, explicacion_snapshot: {},
        })) });
        const source = new MiDiaDocumentCardsService(tx as unknown as PrismaClient);
        const own = { scope: 'OWN' as const, now };
        const org = { scope: 'ORGANIZATION' as const, now };
        expect((await source.read(actor, 'MISSING_DOCUMENTS', own)).items.map((row) => row.id)).toEqual([ids.missingReq]);
        expect((await source.read(director, 'MISSING_DOCUMENTS', org)).count).toBe(1);
        expect((await source.read(actor, 'DOCUMENTS_TO_REVIEW', own)).count).toBe(0);
        expect((await source.read(director, 'DOCUMENTS_TO_REVIEW', org)).items.map((row) => row.id)).toEqual([ids.reviewReq]);
        expect((await source.read(actor, 'EXPIRED_DOCUMENTS', own)).items.map((row) => row.id)).toEqual([ids.expired]);
        expect((await source.read(director, 'EXPIRED_DOCUMENTS', org)).count).toBe(1);
        expect((await source.read(actor, 'FORMATS_TO_GENERATE', own)).items.map((row) => row.id)).toEqual([ids.ownFormat]);
        expect((await source.read(director, 'FORMATS_TO_GENERATE', org)).count).toBe(2);
        expect((await source.read(director, 'FORMATS_TO_GENERATE', org)).items.every((row) => row.href.endsWith('#plantillas'))).toBe(true);
        await tx.complianceRequirement.createMany({ data: [
          [signedFormats.own, ids.org, ids.ownCase, ids.ownCompliance, ids.ownReview, 'OWN'],
          [signedFormats.signed, ids.org, ids.ownCase, ids.ownCompliance, ids.ownReview, 'SIGNED'],
          [signedFormats.old, ids.org, ids.ownCase, ids.ownCompliance, ids.staleReview, 'OLD'],
          [signedFormats.peer, ids.org, ids.peerCase, ids.peerCompliance, ids.peerReview, 'PEER'],
          [signedFormats.foreign, ids.foreignOrg, ids.foreignCase, ids.foreignCompliance, ids.foreignReview, 'FOREIGN'],
        ].map(([id, organization_id, expediente_id, state_id, review_id, requirement_key]) => ({
          id, organization_id, expediente_id, state_id, review_id, requirement_key,
          provider: 'FIR' as const, label: `Formato firmado ${requirement_key}`, status: 'PENDIENTE' as const,
          requires_signed_document: true, source_snapshot: {},
        })) });
        await tx.complianceEvidence.createMany({ data: [
          [ids.org, ids.ownReview, ids.ownCase, signedFormats.own, ids.ownProject, ids.owner, 'GENERATED'],
          [ids.org, ids.ownReview, ids.ownCase, signedFormats.signed, ids.ownProject, ids.owner, 'GENERATED'],
          [ids.org, ids.ownReview, ids.ownCase, signedFormats.signed, ids.valid, ids.owner, 'SIGNED_UPLOADED'],
          [ids.org, ids.staleReview, ids.ownCase, signedFormats.old, ids.ownProject, ids.owner, 'GENERATED'],
          [ids.org, ids.peerReview, ids.peerCase, signedFormats.peer, ids.peerProject, ids.peer, 'GENERATED'],
          [ids.foreignOrg, ids.foreignReview, ids.foreignCase, signedFormats.foreign, ids.foreignProject, ids.foreign, 'GENERATED'],
        ].map(([organization_id, review_id, expediente_id, requirement_id, documento_id, agregado_por_id, document_state]) => ({
          organization_id, review_id, expediente_id, requirement_id, documento_id, agregado_por_id,
          tipo_evidencia: 'QA', estatus: 'ACTIVO', storage_key_snapshot: `midia/${documento_id}`,
          document_version: 'QA-v1', validation_status: 'PENDING_HUMAN' as const,
          source: document_state === 'SIGNED_UPLOADED'
            ? 'MANUAL_SIGNED_UPLOAD' as const : 'FORMAT_GENERATED' as const,
          document_state: document_state as 'GENERATED' | 'SIGNED_UPLOADED',
        })) });
        expect((await source.read(actor, 'FORMATS_TO_SIGN', own)).items.map((row) => row.id)).toEqual([signedFormats.own]);
        expect((await source.read(director, 'FORMATS_TO_SIGN', org)).count).toBe(2);
        expect((await source.read({ ...director, organizationId: ids.foreignOrg, id: ids.foreign },
          'FORMATS_TO_SIGN', org)).items.map((row) => row.id)).toEqual([signedFormats.foreign]);
        const ownFindings = await source.read(actor, 'DOCUMENT_INCONSISTENCIES', { ...own, limit: 1 });
        expect(ownFindings).toMatchObject({ count: 2, items: [{ id: `${ids.ownReport}:0`,
          href: `/expedientes/${ids.ownCase}#proyecto` }] });
        expect((await source.read(director, 'DOCUMENT_INCONSISTENCIES', org)).count).toBe(2);
        expect((await source.read({ ...director, organizationId: ids.foreignOrg, id: ids.foreign },
          'DOCUMENT_INCONSISTENCIES', org)).count).toBe(1);
        const compliance = new MiDiaComplianceCardsService(tx as unknown as PrismaClient);
        expect((await compliance.read(actor, 'PLD_INCOMPLETE', own)).items.map((row) => row.id)).toEqual([ids.ownCompliance]);
        expect((await compliance.read(director, 'PLD_INCOMPLETE', org)).count).toBe(2);
        expect((await compliance.read(director, 'PLD_INCOMPLETE', org)).items.every((row) => row.href.endsWith('#cumplimiento'))).toBe(true);
        const noticeOptions = { ...own, timezone: 'America/Mexico_City', window: 3 };
        expect((await compliance.read(actor, 'NOTICES_PENDING', noticeOptions)).count).toBe(2);
        expect((await compliance.read(actor, 'NOTICES_UPCOMING', noticeOptions)).items.map((row) => row.id)).toEqual([ids.upcomingNotice]);
        expect((await compliance.read(actor, 'NOTICES_OVERDUE', noticeOptions)).items.map((row) => row.id)).toEqual([ids.overdueNotice]);
        expect((await compliance.read(director, 'NOTICES_UPCOMING', { ...org, timezone: 'America/Mexico_City', window: 3 })).count).toBe(2);
        const criticalOwn = await compliance.read(actor, 'CRITICAL_ALERTS', own);
        expect(criticalOwn.count).toBe(1);
        expect(criticalOwn.items.map((row) => row.id)).toEqual([ids.criticalAlert]);
        expect(criticalOwn.items[0]?.href).toBe(`/expedientes/${ids.ownCase}#cumplimiento`);
        expect((await compliance.read(director, 'CRITICAL_ALERTS', org)).count).toBe(2);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    expect(await db.documento.count({ where: { id: ids.expired } })).toBe(0);
    expect(await db.documento.count({ where: { id: ids.ownReport } })).toBe(0);
    expect(await db.expedienteArtefactoPendiente.count({ where: { id: ids.ownFormat } })).toBe(0);
    expect(await db.expedienteComplianceState.count({ where: { id: ids.ownCompliance } })).toBe(0);
    expect(await db.complianceRequirement.count({ where: { id: signedFormats.own } })).toBe(0);
    expect(await db.complianceObligation.count({ where: { id: ids.upcomingNotice } })).toBe(0);
  });
});
