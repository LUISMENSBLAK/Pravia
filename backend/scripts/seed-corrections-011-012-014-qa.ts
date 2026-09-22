import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Document, Footer, Header, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { Prisma, PrismaClient } from '@prisma/client';
import { actorScopeForRole, runWithActorContext } from '../src/auth/actorContext';
import { permissionsForRole } from '../src/auth/permissions';
import { validateQuestionnaireDefinition } from '../src/domain/complianceH5';
import { ComplianceH5Service } from '../src/services/complianceH5.service';
import { questionnaireBanksService } from '../src/services/questionnaireBanks.service';
import { deleteFile, uploadFile } from '../src/storage/storage.service';

const expectedDatabase = 'pravia_corr011_012_014_qa';
const expectedHost = '127.0.0.1';
const expectedPort = '55433';
const expectedStorage = '/private/tmp/pravia-corr011-012-014-storage-qa';
const databaseUrl = new URL(process.env.DATABASE_URL || '');
if (databaseUrl.hostname !== expectedHost || databaseUrl.port !== expectedPort || databaseUrl.pathname.slice(1) !== expectedDatabase) {
  throw new Error('QA_SEED_DATABASE_SAFETY_GATE_FAILED');
}
if (process.env.STORAGE_MODE !== 'local' || process.env.LOCAL_STORAGE_PATH !== expectedStorage) {
  throw new Error('QA_SEED_STORAGE_SAFETY_GATE_FAILED');
}

const ids = {
  organization: '30000000-0000-4000-8000-000000000001',
  user: '30000000-0000-4000-8000-000000000002',
  membership: '30000000-0000-4000-8000-000000000003',
  expediente: '770a40da-3ba5-4d24-a293-75fa8d064c05',
  act: '30000000-0000-4000-8000-000000000209',
  seller: '31100000-0000-4000-8000-000000000001',
  sellerPerson: '31100000-0000-4000-8000-000000000002',
  buyer: '31100000-0000-4000-8000-000000000003',
  buyerPerson: '31100000-0000-4000-8000-000000000004',
  sellerLink: '31100000-0000-4000-8000-000000000005',
  buyerLink: '31100000-0000-4000-8000-000000000006',
  templateArtifact: '31100000-0000-4000-8000-000000000010',
  templateVersion: '31100000-0000-4000-8000-000000000011',
  templateDestination: '31100000-0000-4000-8000-000000000012',
  templateAct: '31100000-0000-4000-8000-000000000013',
  sourceDocument: '31100000-0000-4000-8000-000000000020',
  sourceLink: '31100000-0000-4000-8000-000000000021',
  complianceReview: '31100000-0000-4000-8000-000000000030',
  complianceState: '31100000-0000-4000-8000-000000000031',
  questionnaireSeedCorrelation: '31100000-0000-4000-8000-000000000032',
  property: '31100000-0000-4000-8000-000000000040',
  propertyLink: '31100000-0000-4000-8000-000000000041',
  propertyActLink: '31100000-0000-4000-8000-000000000042',
};

const prisma = new PrismaClient();
const checksum = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const templateKey = `organizations/${ids.organization}/qa/correction-011/Machote_Proyecto_QA.docx`;
const sourceKey = `organizations/${ids.organization}/qa/correction-011/Certificado_Literal_QA.docx`;

const permissions = permissionsForRole('DIRECCION');
const actor = {
  id: ids.user,
  email: 'qa.correcciones@pravia.test',
  nombre: 'QA',
  apellido: 'Correcciones',
  rol: 'DIRECCION' as const,
  sessionId: 'QA-CORRECTIONS-011-012-014-SEED',
  organizationId: ids.organization,
  membershipId: ids.membership,
  scope: actorScopeForRole('DIRECCION'),
  permissions,
  requiresPasswordChange: false,
};

async function projectTemplate() {
  return Packer.toBuffer(new Document({ sections: [{
    headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: 'PRAVIA · MACHOTE NOTARIAL QA', bold: true })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph('Documento de prueba local aislado · Corrección 011')] }) },
    children: [
      new Paragraph({ children: [new TextRun({ text: 'PROYECTO DE ESCRITURA', bold: true, size: 30 })] }),
      new Table({ rows: [
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Expediente')] }), new TableCell({ children: [new Paragraph('{{expediente.folio}}')] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Cliente')] }), new TableCell({ children: [new Paragraph('{{expediente.cliente}}')] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Acto')] }), new TableCell({ children: [new Paragraph('{{expediente.acto}}')] })] }),
      ] }),
      new Paragraph('Responsable: {{expediente.responsable}}'),
      new Paragraph('Comparecientes: {{comparecientes}}'),
      new Paragraph('Predios: {{predios}}'),
      new Paragraph('Superficie del inmueble: {{inmueble.superficie}} m²'),
      new Paragraph('Importe: {{operacion.precio_formal_numero_letra}}'),
      new Paragraph('ANTECEDENTE DE CONTROL — CLIENTE: Persona Anterior QA'),
      new Paragraph('RFC: AAAA800101AA1'),
      new Paragraph('DOMICILIO: Calle Antigua 99, Colonia Anterior'),
      new Paragraph('VALOR: $980,000.00'),
      new Paragraph('FECHA: 01/02/2024'),
      new Paragraph('FOLIO REAL: FR-ANTERIOR-009'),
      new Paragraph({ children: [new TextRun({ text: 'TRANSCRIPCIÓN LITERAL', bold: true })] }),
      new Paragraph('ANTECEDENTE PRIMERO: {{transcripcion.antecedente_1}}'),
      new Paragraph('ANTECEDENTE SEGUNDO: {{transcripcion.antecedente_2}}'),
      new Paragraph('Se transcribe a continuación:'),
      new Paragraph('{{transcripcion.certificado}}'),
      new Paragraph('Elemento gráfico: {{elemento_grafico.sello}}'),
      new Paragraph('Dato que exige confirmación: {{dato.no_disponible}}'),
    ],
  }] }));
}

async function literalSource() {
  return Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph('ANTECEDENTE PRIMERO: El diez de enero de dos mil veinticuatro se formalizó la adquisición del inmueble.'),
    new Paragraph('ANTECEDENTE SEGUNDO: El quince de abril de dos mil veinticinco se autorizó la subdivisión relacionada.'),
    new Paragraph('CERTIFICO: Que la presente transcripción conserva MAYÚSCULAS, puntuación; y números 123/2026.'),
  ] }] }));
}

async function seedParties() {
  const sellerRole = await prisma.caracterCompareciente.upsert({
    where: { clave: 'VENDEDOR' }, update: { activo: true },
    create: { clave: 'VENDEDOR', nombre: 'Vendedor', descripcion: 'Transmitente', activo: true },
  });
  const buyerRole = await prisma.caracterCompareciente.upsert({
    where: { clave: 'COMPRADOR' }, update: { activo: true },
    create: { clave: 'COMPRADOR', nombre: 'Comprador', descripcion: 'Adquirente', activo: true },
  });
  await prisma.compareciente.upsert({ where: { id: ids.seller }, update: { nombre_busqueda: 'María Transmitente QA', archived_at: null }, create: { id: ids.seller, organization_id: ids.organization, tipo_persona: 'FISICA', nombre_busqueda: 'María Transmitente QA', creado_por_id: ids.user } });
  await prisma.personaFisica.upsert({ where: { compareciente_id: ids.seller }, update: { nombre_completo_calculado: 'María Transmitente QA', rfc: 'MAQA800101AA1' }, create: { id: ids.sellerPerson, organization_id: ids.organization, compareciente_id: ids.seller, nombre: 'María', apellido_paterno: 'Transmitente', apellido_materno: 'QA', nombre_completo_calculado: 'María Transmitente QA', rfc: 'MAQA800101AA1' } });
  await prisma.compareciente.upsert({ where: { id: ids.buyer }, update: { nombre_busqueda: 'Carlos Adquirente QA', archived_at: null }, create: { id: ids.buyer, organization_id: ids.organization, tipo_persona: 'FISICA', nombre_busqueda: 'Carlos Adquirente QA', creado_por_id: ids.user } });
  await prisma.personaFisica.upsert({ where: { compareciente_id: ids.buyer }, update: { nombre_completo_calculado: 'Carlos Adquirente QA', rfc: 'CAQA810202BB2' }, create: { id: ids.buyerPerson, organization_id: ids.organization, compareciente_id: ids.buyer, nombre: 'Carlos', apellido_paterno: 'Adquirente', apellido_materno: 'QA', nombre_completo_calculado: 'Carlos Adquirente QA', rfc: 'CAQA810202BB2' } });
  await prisma.expedienteCompareciente.upsert({ where: { id: ids.sellerLink }, update: { archived_at: null, estatus: 'ACTIVO', caracter_id: sellerRole.id, expediente_acto_id: ids.act }, create: { id: ids.sellerLink, organization_id: ids.organization, expediente_id: ids.expediente, expediente_acto_id: ids.act, compareciente_id: ids.seller, caracter_id: sellerRole.id, orden_comparecencia: 1, es_principal: true, creado_por_id: ids.user, idempotency_key: 'QA-011-SELLER' } });
  await prisma.expedienteCompareciente.upsert({ where: { id: ids.buyerLink }, update: { archived_at: null, estatus: 'ACTIVO', caracter_id: buyerRole.id, expediente_acto_id: ids.act }, create: { id: ids.buyerLink, organization_id: ids.organization, expediente_id: ids.expediente, expediente_acto_id: ids.act, compareciente_id: ids.buyer, caracter_id: buyerRole.id, orden_comparecencia: 2, es_principal: true, creado_por_id: ids.user, idempotency_key: 'QA-011-BUYER' } });
  await prisma.expediente.update({
    where: { id: ids.expediente },
    data: { valor_operacion: new Prisma.Decimal('1234.50') },
  });
  await prisma.predio.upsert({
    where: { id: ids.property },
    update: { archived_at: null, superficie_terreno_m2: new Prisma.Decimal('245.7500'), updated_by: ids.user },
    create: {
      id: ids.property,
      organization_id: ids.organization,
      apodo: 'Inmueble QA Centro',
      clave_catastral: 'CAT-QA-245-75',
      cuenta_predial: 'PRED-QA-2026-01',
      folio_real: 'FR-QA-2026-0041',
      ubicacion_texto: 'Calle Prueba 41, Centro, Tepic, Nayarit',
      calle: 'Calle Prueba',
      numero_exterior: '41',
      colonia: 'Centro',
      municipio: 'Tepic',
      estado: 'Nayarit',
      codigo_postal: '63000',
      superficie_terreno_m2: new Prisma.Decimal('245.7500'),
      superficie_construccion_m2: new Prisma.Decimal('180.2500'),
      valor_operacion: new Prisma.Decimal('1234.50'),
      created_by: ids.user,
      updated_by: ids.user,
    },
  });
  await prisma.expedientePredio.upsert({
    where: { organization_id_expediente_id_predio_id: { organization_id: ids.organization, expediente_id: ids.expediente, predio_id: ids.property } },
    update: { estatus: 'ACTIVO', removed_at: null, removed_by: null, removed_reason: null },
    create: { id: ids.propertyLink, organization_id: ids.organization, expediente_id: ids.expediente, predio_id: ids.property, created_by: ids.user, idempotency_key: 'QA-011-PROPERTY' },
  });
  await prisma.expedienteActoPredio.upsert({
    where: { organization_id_expediente_predio_id_expediente_acto_id: { organization_id: ids.organization, expediente_predio_id: ids.propertyLink, expediente_acto_id: ids.act } },
    update: { estatus: 'ACTIVO', removed_at: null },
    create: { id: ids.propertyActLink, organization_id: ids.organization, expediente_predio_id: ids.propertyLink, expediente_acto_id: ids.act },
  });
}

async function seedTemplateAndSource() {
  const [template, source] = await Promise.all([projectTemplate(), literalSource()]);
  await Promise.all([deleteFile(templateKey).catch(() => undefined), deleteFile(sourceKey).catch(() => undefined)]);
  await Promise.all([uploadFile(template, templateKey, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), uploadFile(source, sourceKey, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')]);
  const expediente = await prisma.expediente.findUniqueOrThrow({ where: { id: ids.expediente }, select: { tipo_acto_id: true, notaria_id: true } });
  const notaria = expediente.notaria_id
    ? { id: expediente.notaria_id }
    : await prisma.notaria.findFirstOrThrow({ where: { organization_id: ids.organization, activa: true }, select: { id: true } });
  await prisma.catalogoArtefacto.upsert({
    where: { id: ids.templateArtifact },
    update: { nombre: 'Machote proyecto notarial QA', tipo: 'PLANTILLA', activo: true, notaria_id: notaria.id, actualizado_por_id: ids.user },
    create: { id: ids.templateArtifact, organization_id: ids.organization, tipo: 'PLANTILLA', propietario_tipo: 'NOTARIA', notaria_id: notaria.id, nombre: 'Machote proyecto notarial QA', descripcion: 'Fixture local aislado para Corrección 011.', codigo_biblioteca: 'QA-CORR-011-PROJECT', activo: true, creado_por_id: ids.user, actualizado_por_id: ids.user },
  });
  await prisma.catalogoArtefactoVersion.updateMany({ where: { organization_id: ids.organization, artefacto_id: ids.templateArtifact, id: { not: ids.templateVersion } }, data: { activa: false } });
  await prisma.catalogoArtefactoVersion.upsert({
    where: { id: ids.templateVersion },
    update: { version: 1, nombre_original: 'Machote_Proyecto_QA.docx', storage_key: templateKey, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: template.length, checksum_sha256: checksum(template), definition_json: Prisma.DbNull, activa: true },
    create: { id: ids.templateVersion, organization_id: ids.organization, artefacto_id: ids.templateArtifact, version: 1, nombre_original: 'Machote_Proyecto_QA.docx', storage_key: templateKey, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: template.length, checksum_sha256: checksum(template), origen: 'QA_CORRECTION_011', activa: true, creado_por_id: ids.user },
  });
  await prisma.catalogoArtefactoDestino.upsert({
    where: { organization_id_artefacto_id_destino: { organization_id: ids.organization, artefacto_id: ids.templateArtifact, destino: 'PROYECTO_MACHOTE' } },
    update: { activo: true, predeterminado: true, actualizado_por_id: ids.user },
    create: { id: ids.templateDestination, organization_id: ids.organization, artefacto_id: ids.templateArtifact, destino: 'PROYECTO_MACHOTE', activo: true, predeterminado: true, creado_por_id: ids.user, actualizado_por_id: ids.user },
  });
  if (expediente.tipo_acto_id) await prisma.catalogoArtefactoActo.upsert({
    where: { artefacto_id_tipo_acto_id: { artefacto_id: ids.templateArtifact, tipo_acto_id: expediente.tipo_acto_id } },
    update: {},
    create: { id: ids.templateAct, organization_id: ids.organization, artefacto_id: ids.templateArtifact, tipo_acto_id: expediente.tipo_acto_id },
  });
  await prisma.documento.upsert({
    where: { id: ids.sourceDocument },
    update: { storage_key: sourceKey, nombre_original: 'Certificado_Literal_QA.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: source.length, checksum_sha256: checksum(source), estatus: 'VIGENTE', datos_extraidos: json({ proyecto: { literal_transcriptions: { 'transcripcion.antecedente_1': 'El diez de enero de dos mil veinticuatro se formalizó la adquisición del inmueble.', 'transcripcion.antecedente_2': 'El quince de abril de dos mil veinticinco se autorizó la subdivisión relacionada.', 'transcripcion.certificado': 'CERTIFICO: Que la presente transcripción conserva MAYÚSCULAS, puntuación; y números 123/2026.' }, graphic_elements: [{ key: 'sello', description: 'SELLO CIRCULAR DE LA AUTORIDAD EMISORA' }], antecedents: [{ fecha: '2024-01-10', text: 'Adquisición' }, { fecha: '2025-04-15', text: 'Subdivisión' }], template_values: { 'expediente.cliente': 'VALOR DOCUMENTAL EN CONFLICTO QA' } } }) },
    create: { id: ids.sourceDocument, organization_id: ids.organization, expediente_id: ids.expediente, nombre_original: 'Certificado_Literal_QA.docx', nombre_interno: sourceKey, storage_key: sourceKey, tipo: 'FUENTE_PROYECTO_QA', categoria: 'PROYECTO', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: source.length, checksum_sha256: checksum(source), estatus: 'VIGENTE', subido_por_id: ids.user, datos_extraidos: json({ proyecto: { literal_transcriptions: { 'transcripcion.antecedente_1': 'El diez de enero de dos mil veinticuatro se formalizó la adquisición del inmueble.', 'transcripcion.antecedente_2': 'El quince de abril de dos mil veinticinco se autorizó la subdivisión relacionada.', 'transcripcion.certificado': 'CERTIFICO: Que la presente transcripción conserva MAYÚSCULAS, puntuación; y números 123/2026.' }, graphic_elements: [{ key: 'sello', description: 'SELLO CIRCULAR DE LA AUTORIDAD EMISORA' }], antecedents: [{ fecha: '2024-01-10', text: 'Adquisición' }, { fecha: '2025-04-15', text: 'Subdivisión' }], template_values: { 'expediente.cliente': 'VALOR DOCUMENTAL EN CONFLICTO QA' } } }) },
  });
  await prisma.expedienteDocumento.upsert({
    where: { expediente_id_documento_id_tipo_vinculo: { expediente_id: ids.expediente, documento_id: ids.sourceDocument, tipo_vinculo: 'FUENTE_PROYECTO' } },
    update: { estatus: 'ACTIVO', inactivado_at: null, inactivado_por_id: null },
    create: { id: ids.sourceLink, organization_id: ids.organization, expediente_id: ids.expediente, documento_id: ids.sourceDocument, tipo_vinculo: 'FUENTE_PROYECTO', creado_por_id: ids.user, origen: 'EXPEDIENTE', source_entity_type: 'Documento', source_entity_id: ids.sourceDocument, source_context: 'PROYECTO_FUENTE_LITERAL', source_key: `EXPEDIENTE:Documento:${ids.sourceDocument}:FUENTE_PROYECTO`, document_version: checksum(source), provenance: json({ source: 'QA_CORRECTION_011' }) },
  });
}

async function seedQuestionBanks() {
  await runWithActorContext({ userId: actor.id, organizationId: actor.organizationId, membershipId: actor.membershipId, role: actor.rol, permissions, scope: actor.scope, sessionId: actor.sessionId }, async () => {
    const current = await questionnaireBanksService.list(actor as any);
    if (!current.banks.find((item) => item.key === 'PERSONAL')?.questions.length) {
      await questionnaireBanksService.add(actor as any, 'PERSONAL', { id: 'qa-personal-ocupacion', label: '¿Cuál es su ocupación actual?', type: 'TEXT', required: true });
      await questionnaireBanksService.add(actor as any, 'PERSONAL', { id: 'qa-personal-pep', label: '¿Es persona políticamente expuesta?', type: 'BOOLEAN', required: true });
    }
    if (!current.banks.find((item) => item.key === 'OPERACION')?.questions.length) {
      await questionnaireBanksService.add(actor as any, 'OPERACION', { id: 'qa-operacion-origen', label: 'Origen de los recursos de la operación', type: 'TEXT', required: true });
      await questionnaireBanksService.add(actor as any, 'OPERACION', { id: 'qa-operacion-tercero', label: '¿Interviene un tercero en el pago?', type: 'BOOLEAN', required: false });
    }
  });
}

async function seedApplicableQuestionnairesForCurrentReview() {
  await runWithActorContext({ userId: actor.id, organizationId: actor.organizationId, membershipId: actor.membershipId, role: actor.rol, permissions, scope: actor.scope, sessionId: actor.sessionId }, async () => {
    await prisma.complianceReview.upsert({
      where: { id: ids.complianceReview },
      update: {
        estatus: 'EVALUACION_DETERMINISTA',
        updated_at: new Date(),
      },
      create: {
        id: ids.complianceReview,
        organization_id: ids.organization,
        expediente_id: ids.expediente,
        tipo: 'QA_CORRECTION_012',
        estatus: 'EVALUACION_DETERMINISTA',
        rule_version_snapshot: 'synthetic-local-qa-correction-012',
        cuestionario_json: json({ source: 'SYNTHETIC_LOCAL_QA_COMPLIANCE_DETERMINATION' }),
        rule_snapshot: json({ source: 'SYNTHETIC_LOCAL_QA_COMPLIANCE_DETERMINATION' }),
        master_snapshot: json({ source: 'SYNTHETIC_LOCAL_QA_COMPLIANCE_DETERMINATION' }),
        creado_por_id: ids.user,
        engine_version: 'qa-correction-012-v1',
        idempotency_key: 'QA-CORRECTION-012-CURRENT-REVIEW',
        is_canonical_legal_engine: false,
      },
    });
    await prisma.expedienteComplianceState.upsert({
      where: { expediente_id: ids.expediente },
      update: {
        current_review_id: ids.complianceReview,
        state: 'PENDIENTE',
        updated_by_id: ids.user,
      },
      create: {
        id: ids.complianceState,
        organization_id: ids.organization,
        expediente_id: ids.expediente,
        current_review_id: ids.complianceReview,
        state: 'PENDIENTE',
        pending_count: 0,
        updated_by_id: ids.user,
      },
    });
  });
  const state = await prisma.expedienteComplianceState.findFirst({
    where: { organization_id: ids.organization, expediente_id: ids.expediente, current_review_id: { not: null } },
    select: { id: true, current_review_id: true },
  });
  if (!state?.current_review_id) return;
  const parties = await prisma.expedienteCompareciente.findMany({
    where: { organization_id: ids.organization, expediente_id: ids.expediente, estatus: 'ACTIVO', archived_at: null },
    select: { compareciente_id: true },
  });
  const requirements = [
    { key: `CUE:GENERAL:${ids.act}`, label: 'Cuestionario del acto / operación', target: null },
    ...parties.map((party) => ({ key: `CUE:PERSONAL:${party.compareciente_id}`, label: 'Cuestionario personal', target: party.compareciente_id })),
  ];
  for (const requirement of requirements) await prisma.complianceRequirement.upsert({
    where: { organization_id_review_id_provider_requirement_key: { organization_id: ids.organization, review_id: state.current_review_id, provider: 'CUE', requirement_key: requirement.key } },
    update: {},
    create: {
      organization_id: ids.organization,
      expediente_id: ids.expediente,
      state_id: state.id,
      review_id: state.current_review_id,
      provider: 'CUE',
      requirement_key: requirement.key,
      label: requirement.label,
      status: 'PENDIENTE',
      source_snapshot: json({ source: 'SYNTHETIC_LOCAL_QA_COMPLIANCE_DETERMINATION', correction: '012', applicable: true }),
      document_category: 'CUESTIONARIOS_RIESGO',
      target_compareciente_id: requirement.target,
      requires_signed_document: false,
      requires_human_validation: true,
      missing_action: 'GO_TO_QUESTIONNAIRE',
      is_documental: false,
    },
  });
  await prisma.expedienteComplianceState.update({
    where: { id: state.id },
    data: { pending_count: requirements.length, updated_by_id: ids.user },
  });
}

async function seedRiskMethodologies() {
  const activeBanks = await prisma.catalogoArtefacto.findMany({
    where: {
      organization_id: ids.organization,
      purpose: { in: ['CUE_PERSONAL', 'CUE_GENERAL'] },
      activo: true,
    },
    include: { versiones: { where: { activa: true }, orderBy: { version: 'desc' }, take: 1 } },
  });
  const pinnedVersions = await prisma.complianceQuestionnaireAssessment.findMany({
    where: { organization_id: ids.organization, expediente_id: ids.expediente },
    select: { definition_version_id: true },
  });
  const versionIds = new Set([
    ...activeBanks.flatMap((bank) => bank.versiones.map((version) => version.id)),
    ...pinnedVersions.map((item) => item.definition_version_id),
  ]);
  const versions = await prisma.catalogoArtefactoVersion.findMany({
    where: {
      id: { in: [...versionIds] },
      organization_id: ids.organization,
      content_kind: 'STRUCTURED_QUESTIONNAIRE',
    },
  });
  await runWithActorContext({ userId: actor.id, organizationId: actor.organizationId, membershipId: actor.membershipId, role: actor.rol, permissions, scope: actor.scope, sessionId: actor.sessionId }, async () => {
    for (const version of versions) {
      const definition = validateQuestionnaireDefinition(version.definition_json);
      const question = definition.sections
        .flatMap((section) => section.questions || [])
        .find((item) => item.active !== false);
      if (!question) throw new Error(`QA_RISK_METHODOLOGY_QUESTION_REQUIRED:${version.id}`);
      const factorDsl = {
        schema_version: 1,
        outputs: [
          { code: 'QA_APLICABLE', label: 'Evaluación sintética QA', when: { op: 'EXISTS', question_id: question.id } },
          { code: 'QA_SIN_RESPUESTA', label: 'Sin respuesta sintética QA', when: { op: 'NOT', condition: { op: 'EXISTS', question_id: question.id } } },
        ],
      };
      await ComplianceH5Service.publishMethodology(actor as any, {
        stable_key: `QA-CORR-012-${version.id}`,
        definition_version_id: version.id,
        scope: definition.scope,
        name: `Metodología sintética QA ${definition.scope} v${version.version}`,
        taxonomy: { source: 'SYNTHETIC_LOCAL_QA', correction: '012' },
        factor_dsl: factorDsl,
        output_mapping: { QA_APLICABLE: 'QA_APLICABLE', QA_SIN_RESPUESTA: 'QA_SIN_RESPUESTA' },
        provenance: { source: 'SYNTHETIC_LOCAL_QA', isolated: true },
        effective_from: '2026-01-01T00:00:00.000Z',
        validation_answers: { [question.id]: 'QA' },
      });
    }
  });
}

async function seedQuestionnaireInstances() {
  await runWithActorContext({ userId: actor.id, organizationId: actor.organizationId, membershipId: actor.membershipId, role: actor.rol, permissions, scope: actor.scope, sessionId: actor.sessionId }, async () => {
    await ComplianceH5Service.ensureQuestionnaires(actor as any, ids.complianceReview, ids.questionnaireSeedCorrelation);
  });
}

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  await seedParties();
  await seedTemplateAndSource();
  await seedQuestionBanks();
  await seedApplicableQuestionnairesForCurrentReview();
  await seedRiskMethodologies();
  await seedQuestionnaireInstances();
  console.log(JSON.stringify({ database: expectedDatabase, storage: expectedStorage, expediente: ids.expediente, templateVersion: ids.templateVersion, sourceDocument: ids.sourceDocument }));
}

main().finally(async () => prisma.$disconnect());
