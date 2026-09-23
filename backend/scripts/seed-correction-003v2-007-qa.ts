import 'dotenv/config';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Document, Packer, Paragraph } from 'docx';
import jpeg from 'jpeg-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PNG } from 'pngjs';
import { PrismaClient } from '@prisma/client';
import prisma from '../src/config/prisma';
import { actorScopeForRole, runWithActorContext, runWithPlatformOperation } from '../src/auth/actorContext';
import { permissionsForRole } from '../src/auth/permissions';
import { configurationCatalogV2Service } from '../src/services/configurationCatalogV2.service';
import { ExpedienteSeguimientoService } from '../src/services/expedienteSeguimiento.service';
import { ExpedienteBudgetService } from '../src/services/expedienteBudget.service';
import { deleteFile, fileExists, uploadFile } from '../src/services/supabase.service';

const ids = {
  organization: '30000000-0000-4000-8000-000000000001',
  user: '30000000-0000-4000-8000-000000000002',
  membership: '30000000-0000-4000-8000-000000000003',
  alternateUser: '30000000-0000-4000-8000-000000000004',
  alternateMembership: '30000000-0000-4000-8000-000000000005',
  readOnlyUser: '30000000-0000-4000-8000-000000000006',
  readOnlyMembership: '30000000-0000-4000-8000-000000000007',
  detail: '770a40da-3ba5-4d24-a293-75fa8d064c05',
  selector: '30000000-0000-4000-8000-000000000102',
  dynamic: '30000000-0000-4000-8000-000000000103',
  stage: '955b61c5-bbeb-4783-bd67-c3b84d07cc28',
  stageType: '30000000-0000-4000-8000-000000000201',
  stageConfig: '30000000-0000-4000-8000-000000000202',
  stageOne: '30000000-0000-4000-8000-000000000203',
  stageTwo: '30000000-0000-4000-8000-000000000204',
  activityOne: '30000000-0000-4000-8000-000000000205',
  activityTwo: '30000000-0000-4000-8000-000000000206',
  dependency: '30000000-0000-4000-8000-000000000207',
  stageAct: '30000000-0000-4000-8000-000000000208',
  detailAct: '30000000-0000-4000-8000-000000000209',
  document: '30000000-0000-4000-8000-000000000301',
  documentLink: '30000000-0000-4000-8000-000000000302',
  pdfDocument: '30000000-0000-4000-8000-000000000303',
  pdfDocumentLink: '30000000-0000-4000-8000-000000000304',
  pngDocument: '30000000-0000-4000-8000-000000000305',
  pngDocumentLink: '30000000-0000-4000-8000-000000000306',
  jpgDocument: '30000000-0000-4000-8000-000000000307',
  jpgDocumentLink: '30000000-0000-4000-8000-000000000308',
  notaria: '30000000-0000-4000-8000-000000000401',
  prospect: '30000000-0000-4000-8000-000000000402',
  quote: '30000000-0000-4000-8000-000000000403',
  quoteTransition: '30000000-0000-4000-8000-000000000404',
  quoteConceptHonoraria: '30000000-0000-4000-8000-000000000405',
  quoteConceptRights: '30000000-0000-4000-8000-000000000406',
  quoteDocumentLink: '30000000-0000-4000-8000-000000000407',
  quoteArtifact: '30000000-0000-4000-8000-000000000408',
  quoteArtifactVersionA: '30000000-0000-4000-8000-000000000409',
  quoteArtifactAct: '30000000-0000-4000-8000-000000000410',
  quoteVersion: '30000000-0000-4000-8000-000000000411',
  quoteVersionHonoraria: '30000000-0000-4000-8000-000000000412',
  quoteVersionRights: '30000000-0000-4000-8000-000000000413',
  quoteServicesDestination: '30000000-0000-4000-8000-000000000414',
  quoteBudgetDestination: '30000000-0000-4000-8000-000000000415',
};

const email = 'qa.correcciones@pravia.test';
const password = 'Pravia!QA-Release-2026';
const raw = new PrismaClient();
const permissions = permissionsForRole('DIRECCION');
const context = {
  userId: ids.user,
  organizationId: ids.organization,
  membershipId: ids.membership,
  role: 'DIRECCION' as const,
  permissions,
  scope: actorScopeForRole('DIRECCION'),
  sessionId: 'QA-CORRECTION-003V2-007-SEED',
};
const actor = {
  id: ids.user,
  email,
  nombre: 'QA',
  apellido: 'Correcciones',
  rol: 'DIRECCION' as const,
  sessionId: context.sessionId,
  organizationId: ids.organization,
  membershipId: ids.membership,
  scope: context.scope,
  permissions,
  requiresPasswordChange: false,
};

async function setupIdentity() {
  await runWithPlatformOperation('QA_CORRECTION_003V2_007_IDENTITY', async () => {
    await raw.organization.upsert({
      where: { id: ids.organization },
      update: { name: 'PRAVIA QA Correcciones', status: 'ACTIVE' },
      create: { id: ids.organization, name: 'PRAVIA QA Correcciones', status: 'ACTIVE' },
    });
    await raw.user.upsert({
      where: { email },
      update: {
        password_hash: await bcrypt.hash(password, 12),
        nombre: 'QA', apellido: 'Correcciones', rol: 'DIRECCION', activo: true,
        requires_password_change: false, password_changed_at: new Date(), failed_login_attempts: 0, locked_until: null,
      },
      create: {
        id: ids.user, email, password_hash: await bcrypt.hash(password, 12), nombre: 'QA', apellido: 'Correcciones',
        rol: 'DIRECCION', activo: true, requires_password_change: false, password_changed_at: new Date(),
      },
    });
    await raw.organizationMembership.upsert({
      where: { organization_id_user_id: { organization_id: ids.organization, user_id: ids.user } },
      update: { rol: 'DIRECCION', status: 'ACTIVE' },
      create: { id: ids.membership, organization_id: ids.organization, user_id: ids.user, rol: 'DIRECCION', status: 'ACTIVE' },
    });
    await raw.user.upsert({
      where: { email: 'abogada.qa@pravia.test' },
      update: { nombre: 'Ana', apellido: 'Abogada QA', rol: 'ABOGADO', activo: true },
      create: {
        id: ids.alternateUser,
        email: 'abogada.qa@pravia.test',
        password_hash: await bcrypt.hash('Synthetic-Local-Only-2026!', 12),
        nombre: 'Ana',
        apellido: 'Abogada QA',
        rol: 'ABOGADO',
        activo: true,
        requires_password_change: false,
        password_changed_at: new Date(),
      },
    });
    await raw.organizationMembership.upsert({
      where: { organization_id_user_id: { organization_id: ids.organization, user_id: ids.alternateUser } },
      update: { rol: 'ABOGADO', status: 'ACTIVE' },
      create: { id: ids.alternateMembership, organization_id: ids.organization, user_id: ids.alternateUser, rol: 'ABOGADO', status: 'ACTIVE' },
    });
    await raw.user.upsert({
      where: { email: 'consulta.proyecto.qa@pravia.test' },
      update: {
        password_hash: await bcrypt.hash('Synthetic-ReadOnly-2026!', 12),
        nombre: 'Consulta', apellido: 'Proyecto QA', rol: 'CONSULTA', activo: true,
        requires_password_change: false, password_changed_at: new Date(), failed_login_attempts: 0, locked_until: null,
      },
      create: {
        id: ids.readOnlyUser,
        email: 'consulta.proyecto.qa@pravia.test',
        password_hash: await bcrypt.hash('Synthetic-ReadOnly-2026!', 12),
        nombre: 'Consulta', apellido: 'Proyecto QA', rol: 'CONSULTA', activo: true,
        requires_password_change: false, password_changed_at: new Date(),
      },
    });
    await raw.organizationMembership.upsert({
      where: { organization_id_user_id: { organization_id: ids.organization, user_id: ids.readOnlyUser } },
      update: { rol: 'CONSULTA', status: 'ACTIVE' },
      create: { id: ids.readOnlyMembership, organization_id: ids.organization, user_id: ids.readOnlyUser, rol: 'CONSULTA', status: 'ACTIVE' },
    });
  });
}

async function setupCatalogsAndCases() {
  await runWithActorContext(context, async () => {
    await configurationCatalogV2Service.bootstrap(actor);
    await prisma.configuracionActo.updateMany({
      where: { organization_id: ids.organization, activa: true },
      data: { requiere_revision: false },
    });

    const purchase = await prisma.tipoActo.findFirstOrThrow({
      where: { nombre: 'Compraventa', activo: true },
    });
    await raw.tipoActo.upsert({
      where: { id: ids.stageType },
      update: { nombre: 'Seguimiento QA', activo: true, archived_at: null },
      create: {
        id: ids.stageType, organization_id: ids.organization, codigo_catalogo: 'QA_SEGUIMIENTO_003V2_007',
        nombre: 'Seguimiento QA', descripcion: 'Fixture sintético local para validar la etapa derivada.', activo: true,
      },
    });
    await prisma.configuracionActo.upsert({
      where: { organization_id_tipo_acto_id: { organization_id: ids.organization, tipo_acto_id: ids.stageType } },
      update: { activa: true, requiere_revision: false, clasificacion: 'NO TRASLATIVOS', familia: 'QA' },
      create: {
        id: ids.stageConfig, organization_id: ids.organization, tipo_acto_id: ids.stageType, activa: true,
        requiere_revision: false, clasificacion: 'NO TRASLATIVOS', familia: 'QA', creado_por_id: ids.user, actualizado_por_id: ids.user,
      },
    });
    await prisma.configuracionEtapa.upsert({
      where: { id: ids.stageOne },
      update: { nombre: 'Firma', orden: 1, activa: true },
      create: { id: ids.stageOne, organization_id: ids.organization, configuracion_id: ids.stageConfig, nombre: 'Firma', orden: 1 },
    });
    await prisma.configuracionEtapa.upsert({
      where: { id: ids.stageTwo },
      update: { nombre: 'Entrega', orden: 2, activa: true },
      create: { id: ids.stageTwo, organization_id: ids.organization, configuracion_id: ids.stageConfig, nombre: 'Entrega', orden: 2 },
    });
    await prisma.configuracionActividad.upsert({
      where: { id: ids.activityOne },
      update: { nombre: 'Preparar firma', duracion_estimada: 1, orden_operativo: 1, activa: true },
      create: {
        id: ids.activityOne, organization_id: ids.organization, etapa_id: ids.stageOne, nombre: 'Preparar firma',
        descripcion: 'Preparación sintética local.', duracion_estimada: 1, tipo_dias: 'HABILES', orden_operativo: 1,
      },
    });
    await prisma.configuracionActividad.upsert({
      where: { id: ids.activityTwo },
      update: { nombre: 'Entrega al cliente', duracion_estimada: 1, orden_operativo: 2, activa: true },
      create: {
        id: ids.activityTwo, organization_id: ids.organization, etapa_id: ids.stageTwo, nombre: 'Entrega al cliente',
        descripcion: 'Entrega sintética local.', duracion_estimada: 1, tipo_dias: 'HABILES', orden_operativo: 2,
      },
    });
    await prisma.configuracionDependencia.upsert({
      where: { actividad_id_depende_actividad_id: { actividad_id: ids.activityTwo, depende_actividad_id: ids.activityOne } },
      update: { bloqueante: true },
      create: { id: ids.dependency, organization_id: ids.organization, actividad_id: ids.activityTwo, depende_actividad_id: ids.activityOne, bloqueante: true },
    });

    const cases = [
      [ids.detail, 'EXP-0001-2026', 'Cliente QA cabecera', purchase.id],
      [ids.selector, 'EXP-0002-2026', 'Cliente QA selector', purchase.id],
      [ids.dynamic, 'EXP-0003-2026', 'Cliente QA catálogo vivo', purchase.id],
      [ids.stage, 'EXP-0004-2026', 'Cliente QA seguimiento', ids.stageType],
    ] as const;
    for (const [id, folio, client, typeId] of cases) {
      await prisma.expediente.upsert({
        where: { id },
        update: {
          organization_id: ids.organization,
          numero_pravia: folio,
          cliente_alias: client,
          tipo_acto_id: typeId,
          abogado_id: ids.user,
          creador_id: ids.user,
          numero_escritura: null,
          fecha_escritura: null,
          fecha_estimada_firma: null,
          fecha_estimada_entrega: null,
          fecha_real_firma: null,
          folio_desde: null,
          folio_hasta: null,
          archived_at: null,
        },
        create: { id, organization_id: ids.organization, numero_pravia: folio, cliente_alias: client, tipo_acto_id: typeId, abogado_id: ids.user, creador_id: ids.user, estatus: 'EN_PROCESO' },
      });
    }
    await prisma.$transaction([
      prisma.expedienteSeguimientoHistorial.deleteMany({
        where: { organization_id: ids.organization, expediente_id: ids.dynamic },
      }),
      prisma.expedienteSeguimientoDependencia.deleteMany({
        where: { organization_id: ids.organization, expediente_id: ids.dynamic },
      }),
      prisma.expedienteSeguimientoActividad.deleteMany({
        where: { organization_id: ids.organization, expediente_id: ids.dynamic },
      }),
      prisma.expedienteActo.deleteMany({
        where: { organization_id: ids.organization, expediente_id: ids.dynamic },
      }),
    ]);
    await prisma.expedienteActo.upsert({
      where: { id: ids.detailAct },
      update: { estatus: 'ACTIVO', removed_at: null, tipo_acto_id: purchase.id },
      create: { id: ids.detailAct, organization_id: ids.organization, expediente_id: ids.detail, tipo_acto_id: purchase.id, origen: 'LEGACY_MIGRATION', created_by: ids.user, idempotency_key: 'QA-DETAIL-ACT' },
    });
    await prisma.expedienteActo.upsert({
      where: { id: ids.stageAct },
      update: { estatus: 'ACTIVO', removed_at: null, tipo_acto_id: ids.stageType },
      create: { id: ids.stageAct, organization_id: ids.organization, expediente_id: ids.stage, tipo_acto_id: ids.stageType, origen: 'LEGACY_MIGRATION', created_by: ids.user, idempotency_key: 'QA-STAGE-ACT' },
    });
    await new ExpedienteSeguimientoService(prisma).materialize(actor, ids.stage);
    const stageActivities = await prisma.expedienteSeguimientoActividad.findMany({
      where: { organization_id: ids.organization, expediente_id: ids.stage },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.expedienteSeguimientoHistorial.deleteMany({
        where: { organization_id: ids.organization, expediente_id: ids.stage },
      }),
      prisma.expedienteSeguimientoActividad.updateMany({
        where: { id: { in: stageActivities.map((item) => item.id) } },
        data: {
          estado: 'NO_INICIADO',
          version: 1,
          primera_fecha_inicio: null,
          fecha_completada_actual: null,
          completada_por_id: null,
        },
      }),
    ]);

    const ensurePreviewDocument = async (fixture: { documentId: string; linkId: string; name: string; key: string; mime: string; buffer: Buffer }) => {
      const checksum = createHash('sha256').update(fixture.buffer).digest('hex');
      if (await fileExists(fixture.key)) await deleteFile(fixture.key);
      await uploadFile(fixture.buffer, fixture.key, fixture.mime);
      await prisma.documento.upsert({
        where: { id: fixture.documentId },
        update: {
          nombre_original: fixture.name, nombre_interno: fixture.key, storage_key: fixture.key, mime_type: fixture.mime,
          size_bytes: fixture.buffer.byteLength, checksum_sha256: checksum, estatus: 'VIGENTE',
        },
        create: {
          id: fixture.documentId, organization_id: ids.organization, nombre_original: fixture.name, nombre_interno: fixture.key,
          tipo: 'PROYECTO', categoria: 'PROYECTO', storage_key: fixture.key, mime_type: fixture.mime,
          size_bytes: fixture.buffer.byteLength, checksum_sha256: checksum, subido_por_id: ids.user,
          expediente_id: ids.detail, estatus: 'VIGENTE',
        },
      });
      await prisma.expedienteDocumento.upsert({
        where: { id: fixture.linkId },
        update: { estatus: 'ACTIVO', inactivado_at: null, inactivado_por_id: null, motivo_inactivacion: null, document_version: checksum },
        create: {
          id: fixture.linkId, organization_id: ids.organization, expediente_id: ids.detail, documento_id: fixture.documentId,
          tipo_vinculo: 'QA', creado_por_id: ids.user, estatus: 'ACTIVO', origen: 'EXPEDIENTE',
          source_entity_type: 'EXPEDIENTE', source_entity_id: ids.detail, source_context: 'CARGA_DIRECTA',
          source_key: `EXPEDIENTE:EXPEDIENTE:${ids.detail}:${fixture.documentId}:CARGA_DIRECTA`, document_version: checksum,
          provenance: { origin: 'EXPEDIENTE', synthetic_local_qa: true, preview_format: fixture.mime },
        },
      });
    };

    const docxBuffer = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('PRAVIA OS — Documento sintético de QA'),
      new Paragraph('Vista previa DOCX real para Corrección 003 v2 + 007.'),
    ] }] }));
    const pdf = await PDFDocument.create();
    const pdfPage = pdf.addPage([612, 792]);
    const pdfFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    pdfPage.drawText('PRAVIA QA — PDF REAL 003 v2 + 007', { x: 54, y: 700, size: 20, font: pdfFont, color: rgb(.08, .2, .16) });
    pdfPage.drawText('Documento sintético local para validar el visor protegido.', { x: 54, y: 660, size: 12 });
    const pdfBuffer = Buffer.from(await pdf.save());
    const width = 320; const height = 180; const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4; const band = Math.floor(x / 80);
      const colors = [[13, 54, 47], [197, 151, 48], [42, 92, 132], [231, 236, 232]];
      [rgba[offset], rgba[offset + 1], rgba[offset + 2]] = colors[band]; rgba[offset + 3] = 255;
    }
    const png = new PNG({ width, height }); rgba.copy(png.data);
    const pngBuffer = PNG.sync.write(png);
    const jpgBuffer = Buffer.from(jpeg.encode({ data: rgba, width, height }, 90).data);
    const previewBase = `organizations/${ids.organization}/documentos/expedientes/${ids.detail}`;
    await Promise.all([
      ensurePreviewDocument({ documentId: ids.document, linkId: ids.documentLink, name: 'COT-QA-003V2.docx', key: `${previewBase}/qa-cotizacion-003v2.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxBuffer }),
      ensurePreviewDocument({ documentId: ids.pdfDocument, linkId: ids.pdfDocumentLink, name: 'QA-PREVIEW-PDF.pdf', key: `${previewBase}/qa-preview-real.pdf`, mime: 'application/pdf', buffer: pdfBuffer }),
      ensurePreviewDocument({ documentId: ids.pngDocument, linkId: ids.pngDocumentLink, name: 'QA-PREVIEW-PNG.png', key: `${previewBase}/qa-preview-real.png`, mime: 'image/png', buffer: pngBuffer }),
      ensurePreviewDocument({ documentId: ids.jpgDocument, linkId: ids.jpgDocumentLink, name: 'QA-PREVIEW-JPG.jpg', key: `${previewBase}/qa-preview-real.jpg`, mime: 'image/jpeg', buffer: jpgBuffer }),
    ]);

    await prisma.notaria.upsert({
      where: { id: ids.notaria },
      update: {
        organization_id: ids.organization, nombre: 'Notaría QA Local', numero_notaria: 'QA-001',
        entidad_federativa: 'Nayarit', municipio: 'Tepic', activa: true, predeterminada: true, archived_at: null,
      },
      create: {
        id: ids.notaria, organization_id: ids.organization, nombre: 'Notaría QA Local', numero_notaria: 'QA-001',
        entidad_federativa: 'Nayarit', municipio: 'Tepic', activa: true, predeterminada: true,
      },
    });
    await prisma.prospecto.upsert({
      where: { id: ids.prospect },
      update: {
        organization_id: ids.organization, nombre: 'Cliente QA Cotización 002 v2', telefono: '3110000022',
        email: 'cliente.cotizacion.qa@local.invalid', tipo_acto: 'Compraventa', necesidad: 'Operación sintética local',
        estado: 'ACEPTADO', user_id: ids.user, folio: 'PRO-0099-2026', notaria_id: ids.notaria,
        etapa_contractual: null, version_operativa: 0, transicion_actual_id: null, archived_at: null,
      },
      create: {
        id: ids.prospect, organization_id: ids.organization, nombre: 'Cliente QA Cotización 002 v2', telefono: '3110000022',
        email: 'cliente.cotizacion.qa@local.invalid', tipo_acto: 'Compraventa', necesidad: 'Operación sintética local',
        estado: 'ACEPTADO', user_id: ids.user, folio: 'PRO-0099-2026', notaria_id: ids.notaria,
        etapa_contractual: null, version_operativa: 0,
      },
    });
    await prisma.cotizacion.upsert({
      where: { id: ids.quote },
      update: {
        organization_id: ids.organization, prospecto_id: ids.prospect, user_id: ids.user, estado: 'ACEPTADA',
        notaria_id: ids.notaria, numero_cotizacion: 'COT-0099-2026', total_cliente: '19999.99', total_notaria: '19999.99',
        etapa_contractual: null, version_operativa: 0, transicion_actual_id: null,
      },
      create: {
        id: ids.quote, organization_id: ids.organization, prospecto_id: ids.prospect, user_id: ids.user, estado: 'ACEPTADA',
        notaria_id: ids.notaria, numero_cotizacion: 'COT-0099-2026', total_cliente: '19999.99', total_notaria: '19999.99',
        etapa_contractual: null, version_operativa: 0,
      },
    });
    await prisma.$transaction(async (tx) => {
      const transition = await tx.cotizacionTransicion.findUnique({ where: { id: ids.quoteTransition }, select: { id: true } });
      if (!transition) {
        await tx.cotizacionTransicion.create({ data: {
          id: ids.quoteTransition, organization_id: ids.organization, cotizacion_id: ids.quote, actor_id: ids.user,
          etapa_anterior: 'EN_SEGUIMIENTO', etapa_nueva: 'ACEPTADA', effective_at: new Date('2026-09-16T18:00:00.000Z'),
          accion: 'ACEPTAR', procedencia: 'QA_LOCAL', evidencia: { synthetic_local_qa: true }, version: 1,
          idempotency_key: 'QA-COT-002V2-ACCEPTED',
          payload_hash: createHash('sha256').update('qa-cotizacion-accepted').digest('hex'),
        } });
      }
      await tx.cotizacion.update({
        where: { id: ids.quote },
        data: { etapa_contractual: 'ACEPTADA', version_operativa: 1, transicion_actual_id: ids.quoteTransition },
      });
    });
    const generatedDocuments = await prisma.documento.findMany({
      where: { organization_id: ids.organization, cotizacion_id: ids.quote, tipo: 'COTIZACION_GENERADA' },
      select: { id: true, storage_key: true },
    });
    for (const document of generatedDocuments) {
      if (await fileExists(document.storage_key)) await deleteFile(document.storage_key);
    }
    await prisma.cotizacionDocumento.deleteMany({
      where: { organization_id: ids.organization, cotizacion_id: ids.quote, tipo_vinculo: 'COTIZACION_GENERADA' },
    });
    await prisma.documento.deleteMany({ where: { id: { in: generatedDocuments.map((document) => document.id) } } });
    await prisma.cotizacionConcepto.deleteMany({ where: { organization_id: ids.organization, cotizacion_id: ids.quote } });
    await prisma.cotizacionConcepto.createMany({ data: [
      { id: ids.quoteConceptHonoraria, organization_id: ids.organization, cotizacion_id: ids.quote, concepto: 'Honorarios profesionales', categoria: 'HONORARIOS', importe: '12345.67', orden: 0, origen: 'MANUAL' },
      { id: ids.quoteConceptRights, organization_id: ids.organization, cotizacion_id: ids.quote, concepto: 'Derechos de registro', categoria: 'IMPUESTOS_DERECHOS', importe: '7654.32', orden: 1, origen: 'MANUAL' },
    ] });
    await prisma.cotizacionDocumento.upsert({
      where: { cotizacion_id_documento_id_tipo_vinculo: { cotizacion_id: ids.quote, documento_id: ids.document, tipo_vinculo: 'QA_COMPARTIDO' } },
      update: { estatus: 'ACTIVO', inactivado_at: null, inactivado_por_id: null, motivo_inactivacion: null },
      create: {
        id: ids.quoteDocumentLink, organization_id: ids.organization, cotizacion_id: ids.quote,
        documento_id: ids.document, tipo_vinculo: 'QA_COMPARTIDO', creado_por_id: ids.user,
      },
    });

    const quoteTemplate = async (marker: string) => Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph(marker),
      new Paragraph('Folio: {{cotizacion.folio}}'),
      new Paragraph('Cliente: {{cliente.nombre}}'),
      new Paragraph('Acto: {{expediente.acto}}'),
      new Paragraph('Honorarios: {{cotizacion.honorarios}}'),
      new Paragraph('Impuestos: {{cotizacion.impuestos}}'),
      new Paragraph('Derechos: {{cotizacion.derechos}}'),
      new Paragraph('Total: {{cotizacion.total}}'),
    ] }] }));
    const templateA = await quoteTemplate('PRUEBA_CFG002_COTIZACION_A_20260916');
    const templateB = await quoteTemplate('PRUEBA_CFG002_COTIZACION_B_20260916');
    const ineQa = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('DOCUMENTO SINTÉTICO LOCAL DE QA — NO ES UNA IDENTIFICACIÓN REAL'),
      new Paragraph('Nombre: MARÍA PRUEBA OCHO'),
      new Paragraph('Primer apellido: CONTROLADA'),
      new Paragraph('Segundo apellido: LOCAL'),
      new Paragraph('CURP: COLM900101MNTRCR01'),
      new Paragraph('RFC: COLM900101QA1'),
      new Paragraph('CIC: IDMEX1234567890'),
      new Paragraph('OCR: 9876543210123'),
      new Paragraph('Dato deliberadamente no modelado: CLAVE ELECTOR TEST00000000'),
    ] }] }));
    const predioQa = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph('DOCUMENTO SINTÉTICO LOCAL DE QA — INMUEBLE'),
      new Paragraph('Clave catastral: QA-009-2026'),
      new Paragraph('Cuenta predial: PREDIAL-QA-009'),
      new Paragraph('Folio real: FR-QA-009'),
      new Paragraph('Ubicación: Avenida Pruebas 109, Tepic, Nayarit'),
      new Paragraph('Superficie terreno: 250.5000 m2'),
      new Paragraph('Superficie construcción: 180.2500 m2'),
      new Paragraph('Valor catastral: 1500000.00'),
      new Paragraph('Régimen: Propiedad privada'),
    ] }] }));
    const templateAKey = `organizations/${ids.organization}/catalogos/qa/ADM-001-A.docx`;
    const templateBKey = 'qa-inputs/CFG002-ADM-001-B.docx';
    for (const [key, buffer] of [[templateAKey, templateA], [templateBKey, templateB]] as const) {
      if (await fileExists(key)) await deleteFile(key);
      await uploadFile(buffer, key, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }
    for (const [key, buffer] of [['qa-inputs/CMP-008-INE.docx', ineQa], ['qa-inputs/PRD-009-PREDIO.docx', predioQa]] as const) {
      if (await fileExists(key)) await deleteFile(key);
      await uploadFile(buffer, key, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }
    await prisma.catalogoArtefacto.upsert({
      where: { id: ids.quoteArtifact },
      update: {
        organization_id: ids.organization, tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: ids.notaria,
        institucion_id: null, carpeta_id: null, nombre: 'ADM-001 · Cotización QA', descripcion: 'Plantilla sintética local reemplazable.',
        codigo_biblioteca: 'PRAVIA_CFG002_STANDARD:ADM-001', ruta_biblioteca: 'Administrativos/ADM-001.docx', activo: true,
        actualizado_por_id: ids.user,
      },
      create: {
        id: ids.quoteArtifact, organization_id: ids.organization, tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: ids.notaria,
        nombre: 'ADM-001 · Cotización QA', descripcion: 'Plantilla sintética local reemplazable.',
        codigo_biblioteca: 'PRAVIA_CFG002_STANDARD:ADM-001', ruta_biblioteca: 'Administrativos/ADM-001.docx', activo: true,
        creado_por_id: ids.user, actualizado_por_id: ids.user,
      },
    });
    for (const destination of [
      { id: ids.quoteServicesDestination, destino: 'COTIZACION_SERVICIOS' as const },
      { id: ids.quoteBudgetDestination, destino: 'EXPEDIENTE_PRESUPUESTO' as const },
    ]) {
      await prisma.catalogoArtefactoDestino.updateMany({
        where: { organization_id: ids.organization, destino: destination.destino, artefacto_id: { not: ids.quoteArtifact } },
        data: { predeterminado: false },
      });
      await prisma.catalogoArtefactoDestino.upsert({
        where: {
          organization_id_artefacto_id_destino: {
            organization_id: ids.organization,
            artefacto_id: ids.quoteArtifact,
            destino: destination.destino,
          },
        },
        update: { activo: true, predeterminado: true, actualizado_por_id: ids.user },
        create: {
          id: destination.id,
          organization_id: ids.organization,
          artefacto_id: ids.quoteArtifact,
          destino: destination.destino,
          activo: true,
          predeterminado: true,
          creado_por_id: ids.user,
          actualizado_por_id: ids.user,
        },
      });
    }
    await prisma.catalogoArtefactoActo.upsert({
      where: { artefacto_id_tipo_acto_id: { artefacto_id: ids.quoteArtifact, tipo_acto_id: purchase.id } },
      update: { organization_id: ids.organization },
      create: {
        id: ids.quoteArtifactAct, organization_id: ids.organization,
        artefacto_id: ids.quoteArtifact, tipo_acto_id: purchase.id,
      },
    });
    const existingBudget = await prisma.expedientePresupuesto.findUnique({
      where: { expediente_id: ids.detail },
      include: { documentos: { include: { documento: true } } },
    });
    if (existingBudget) {
      const documentIds = existingBudget.documentos.map((item) => item.documento_id);
      for (const item of existingBudget.documentos) {
        if (await fileExists(item.documento.storage_key)) await deleteFile(item.documento.storage_key);
      }
      await prisma.$transaction(async (tx) => {
        if (documentIds.length) await tx.expedienteDocumento.deleteMany({ where: { documento_id: { in: documentIds } } });
        await tx.expedientePresupuestoDocumento.deleteMany({ where: { presupuesto_id: existingBudget.id } });
        if (documentIds.length) await tx.documento.deleteMany({ where: { id: { in: documentIds } } });
        await tx.expedientePresupuesto.delete({ where: { id: existingBudget.id } });
      });
    }
    await prisma.catalogoArtefactoVersion.deleteMany({
      where: { organization_id: ids.organization, artefacto_id: ids.quoteArtifact, id: { not: ids.quoteArtifactVersionA } },
    });
    await prisma.catalogoArtefactoVersion.upsert({
      where: { id: ids.quoteArtifactVersionA },
      update: {
        version: 1, nombre_original: 'ADM-001-A.docx', storage_key: templateAKey,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: templateA.byteLength,
        checksum_sha256: createHash('sha256').update(templateA).digest('hex'), origen: 'QA_LOCAL', version_biblioteca: 'QA-A', activa: true,
      },
      create: {
        id: ids.quoteArtifactVersionA, organization_id: ids.organization, artefacto_id: ids.quoteArtifact, version: 1,
        nombre_original: 'ADM-001-A.docx', storage_key: templateAKey,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: templateA.byteLength,
        checksum_sha256: createHash('sha256').update(templateA).digest('hex'), origen: 'QA_LOCAL', version_biblioteca: 'QA-A', activa: true,
        creado_por_id: ids.user,
      },
    });

    const quoteVersion = await prisma.cotizacionVersion.upsert({
      where: { id: ids.quoteVersion },
      update: {
        organization_id: ids.organization,
        cotizacion_id: ids.quote,
        version: 1,
        total_cliente: '19999.99',
        total_notaria: '19999.99',
        honorarios_pravia: '3000.00',
        aprobada: true,
        creada_por_id: ids.user,
      },
      create: {
        id: ids.quoteVersion,
        organization_id: ids.organization,
        cotizacion_id: ids.quote,
        version: 1,
        total_cliente: '19999.99',
        total_notaria: '19999.99',
        honorarios_pravia: '3000.00',
        aprobada: true,
        creada_por_id: ids.user,
      },
      include: { conceptos: true },
    });
    await prisma.cotizacionVersionConcepto.deleteMany({
      where: { organization_id: ids.organization, cotizacion_version_id: ids.quoteVersion },
    });
    await prisma.cotizacionVersionConcepto.createMany({ data: [
      {
        id: ids.quoteVersionHonoraria,
        organization_id: ids.organization,
        cotizacion_version_id: ids.quoteVersion,
        concepto: 'Honorarios profesionales',
        categoria: 'HONORARIOS',
        importe: '12345.67',
        orden: 0,
        origen: 'MANUAL',
      },
      {
        id: ids.quoteVersionRights,
        organization_id: ids.organization,
        cotizacion_version_id: ids.quoteVersion,
        concepto: 'Derechos de registro',
        categoria: 'IMPUESTOS_DERECHOS',
        importe: '7654.32',
        orden: 1,
        origen: 'MANUAL',
      },
    ] });
    await prisma.expediente.update({
      where: { id: ids.detail },
      data: { cotizacion_id: ids.quote },
    });
    const versionWithConcepts = await prisma.cotizacionVersion.findUniqueOrThrow({
      where: { id: quoteVersion.id },
      include: { conceptos: { orderBy: { orden: 'asc' } } },
    });
    await prisma.$transaction(async (tx) => {
      await new ExpedienteBudgetService(prisma).createFromQuoteInTransaction(tx, {
        actor,
        expedienteId: ids.detail,
        quoteVersion: versionWithConcepts,
      });
    });
  });
}

async function main() {
  if (process.env.E2E_ALLOW_MUTATIONS !== 'isolated-database-confirmed') {
    throw new Error('E2E_ALLOW_MUTATIONS=isolated-database-confirmed es obligatorio.');
  }
  const database = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)) {
    throw new Error('Los fixtures sólo pueden sembrarse en PostgreSQL local aislado.');
  }
  await setupIdentity();
  await setupCatalogsAndCases();
  console.log(JSON.stringify({
    ok: true, local_only: true,
    ids: { detail: ids.detail, selector: ids.selector, dynamic: ids.dynamic, stage: ids.stage, quote: ids.quote, quoteArtifact: ids.quoteArtifact, quoteVersion: ids.quoteVersion },
    qa_inputs: {
      template_b: 'qa-inputs/CFG002-ADM-001-B.docx',
      ine: 'qa-inputs/CMP-008-INE.docx',
      predio: 'qa-inputs/PRD-009-PREDIO.docx',
    }, email,
  }, null, 2));
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; })
  .finally(async () => { await Promise.allSettled([prisma.$disconnect(), raw.$disconnect()]); });
