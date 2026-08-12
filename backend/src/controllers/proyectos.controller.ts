import { Request, Response } from 'express';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } from 'docx';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { Prisma } from '@prisma/client';
import { deleteFile, downloadFile, getStorageInfo, uploadFile } from '../services/supabase.service';
import { analizarProyectoNotarialConOpenAI, DocumentoParaExtraccion } from '../services/openaiDocument.service';
import { getOpenAIEscalationModelName } from '../services/openaiDocument.service';
import { recordAIFailure, recordAIUsages } from '../services/aiUsage.service';
import prisma from '../config/prisma';
import { projectRepository } from '../services/projectRepository.service';

function assertPersistentProjectStorage() {
  if (getStorageInfo().primary !== 'cloud') {
    const error: any = new Error('Los proyectos y reportes requieren el storage cloud persistente configurado.');
    error.code = 'PROJECT_PERSISTENT_STORAGE_REQUIRED';
    throw error;
  }
}

const PROYECTOS_DIR = path.join(__dirname, '../../uploads/proyectos');
const REPORTES_DIR = path.join(__dirname, '../../uploads/reportes_ia');
const DOCS_DIR = path.join(__dirname, '../../uploads/documentos');

if (!fs.existsSync(PROYECTOS_DIR)) fs.mkdirSync(PROYECTOS_DIR, { recursive: true });
if (!fs.existsSync(REPORTES_DIR)) fs.mkdirSync(REPORTES_DIR, { recursive: true });
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

export const uploadProyectoMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// In-Memory / File-Persisted Store for Proyecto Versions & IA Reports
interface ProyectoVersionRecord {
  id: string;
  expediente_id: string;
  version_numero: number;
  nombre_original: string;
  archivo_file: string;
  mime_type: string;
  size_bytes: number;
  es_vigente: boolean;
  es_version_final: boolean;
  nota_version?: string;
  cargado_por_nombre: string;
  created_at: string;
  storage_backend?: 'SUPABASE' | 'LOCAL_LEGACY';
}

interface IAReportRecord {
  expediente_id: string;
  proyecto_version_id: string;
  proyecto_version_numero: number;
  nombre_reporte: string;
  archivo_reporte_file: string;
  documentos_analizados_count: number;
  documentos_totales_count: number;
  documentos_no_leidos: string[];
  observaciones: Array<{
    id: string;
    titulo: string;
    nivel_riesgo: 'ALTO' | 'MEDIO' | 'INFORMATIVO';
    dato_proyecto: string;
    dato_fuente: string;
    documento_fuente: string;
    ubicacion: string;
    tipo_discrepancia: string;
    recomendacion: string;
  }>;
  solicitado_por: string;
  created_at: string;
}

const proyectosDBPath = path.join(__dirname, '../../uploads/proyectos_db.json');

function loadProyectosState(): { versiones: ProyectoVersionRecord[]; reportes: IAReportRecord[] } {
  if (!fs.existsSync(proyectosDBPath)) {
    return { versiones: [], reportes: [] };
  }
  try {
    const raw = fs.readFileSync(proyectosDBPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { versiones: [], reportes: [] };
  }
}

function saveProyectosState(state: { versiones: ProyectoVersionRecord[]; reportes: IAReportRecord[] }) {
  fs.writeFileSync(proyectosDBPath, JSON.stringify(state, null, 2), 'utf8');
}

const projectMeta = (document: any) => {
  const metadata = document.datos_extraidos;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const value = (metadata as any).proyecto;
  return value && typeof value === 'object' ? value : {};
};

const mapDocumentProjectVersion = (document: any): ProyectoVersionRecord => {
  const meta = projectMeta(document);
  const link = document.expedienteVinculos?.[0];
  return {
    id: document.id,
    expediente_id: document.expediente_id,
    version_numero: Number(meta.version_numero || 1),
    nombre_original: document.nombre_original,
    archivo_file: document.storage_key,
    mime_type: document.mime_type,
    size_bytes: document.size_bytes,
    es_vigente: link?.estatus === 'ACTIVO',
    es_version_final: Boolean(meta.es_version_final),
    nota_version: meta.nota_version || document.observaciones || undefined,
    cargado_por_nombre: document.subido_por ? `${document.subido_por.nombre} ${document.subido_por.apellido}` : 'Usuario PRAVIA',
    created_at: new Date(document.fecha_carga).toISOString(),
    storage_backend: 'SUPABASE',
  };
};

async function loadDatabaseProjectVersions(expedienteId: string) {
  const documents = await prisma.documento.findMany({
    where: { expediente_id: expedienteId, tipo: 'PROYECTO_ESCRITURA' },
    include: {
      subido_por: { select: { nombre: true, apellido: true } },
      expedienteVinculos: {
        where: { expediente_id: expedienteId, tipo_vinculo: 'PROYECTO_ESCRITURA' },
        orderBy: { fecha_vinculo: 'desc' },
      },
    },
    orderBy: { fecha_carga: 'desc' },
  });
  return documents.map(mapDocumentProjectVersion).sort((a, b) => b.version_numero - a.version_numero);
}

async function loadProjectVersionBuffer(version: ProyectoVersionRecord) {
  if (version.storage_backend === 'SUPABASE') return downloadFile(version.archivo_file);
  const legacyPath = path.join(PROYECTOS_DIR, version.archivo_file);
  if (!fs.existsSync(legacyPath)) throw new Error('El archivo físico del proyecto no existe en almacenamiento');
  return fs.readFileSync(legacyPath);
}

// 1. GET Proyecto State for Expediente
export const getProyectoEscritura = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const state = loadProyectosState();
    const databaseVersions = await loadDatabaseProjectVersions(id);
    const legacyVersions = state.versiones
      .filter(v => v.expediente_id === id)
      .map(version => ({ ...version, storage_backend: 'LOCAL_LEGACY' as const }));
    const expVersiones = [...databaseVersions, ...legacyVersions]
      .sort((a, b) => b.version_numero - a.version_numero);
    const vigente = expVersiones.find(v => v.es_vigente) || expVersiones[0] || null;
    const historial = expVersiones
      .filter(v => !vigente || v.id !== vigente.id)
      .sort((a, b) => b.version_numero - a.version_numero);

    const persistentReport = await projectRepository.latestReport(id);
    const reportesExp = state.reportes.filter(r => r.expediente_id === id).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const ultimoReporte = persistentReport?.record || (reportesExp.length > 0 ? reportesExp[0] : null);

    res.json({
      vigente,
      historial,
      ultimoReporte
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al consultar proyecto de escritura', detail: error.message });
  }
};

// 2. POST Upload New Proyecto Version
export const uploadProyectoVersion = async (req: Request, res: Response) => {
  let uploadedStorageKey: string | null = null;
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo de proyecto' });
    }

    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (path.extname(file.originalname).toLowerCase() !== '.docx' || file.mimetype !== docxMime) {
      return res.status(400).json({
        error: 'Formato de proyecto no válido',
        detail: 'La nueva versión debe ser un archivo .docx real.'
      });
    }
    assertPersistentProjectStorage();

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Usuario autenticado requerido para cargar una versión.' });
    const [user, expediente] = await Promise.all([
      prisma.user.findFirst({ where: { id: userId, activo: true }, select: { id: true, nombre: true, apellido: true } }),
      prisma.expediente.findFirst({ where: { id, archived_at: null }, select: { id: true } }),
    ]);
    if (!user) return res.status(403).json({ error: 'El usuario no existe o está inactivo.' });
    if (!expediente) return res.status(404).json({ error: 'Expediente no encontrado o archivado.' });

    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9_.-]/g, '_');
    uploadedStorageKey = `expedientes/${id}/proyectos/${crypto.randomUUID()}_${safeName}`;
    await uploadFile(file.buffer, uploadedStorageKey, file.mimetype);

    const createdDocument = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:proyecto-version:${id}`}))`);
      const existing = await tx.documento.findMany({
        where: { expediente_id: id, tipo: 'PROYECTO_ESCRITURA' },
        select: { datos_extraidos: true },
      });
      const legacy = loadProyectosState().versiones.filter(version => version.expediente_id === id);
      const maxVersion = [...existing.map(projectMeta), ...legacy]
        .reduce((max, metadata: any) => Math.max(max, Number(metadata.version_numero || 0)), 0);
      const newVersionNum = maxVersion + 1;

      await tx.expedienteDocumento.updateMany({
        where: { expediente_id: id, tipo_vinculo: 'PROYECTO_ESCRITURA', estatus: 'ACTIVO' },
        data: { estatus: 'SUSTITUIDO', inactivado_at: new Date(), inactivado_por_id: user.id, motivo_inactivacion: `Sustituido por V${newVersionNum}` },
      });

      const document = await tx.documento.create({
        data: {
          nombre_original: `V${newVersionNum} — ${file.originalname}`,
          nombre_interno: uploadedStorageKey!,
          storage_key: uploadedStorageKey!,
          tipo: 'PROYECTO_ESCRITURA',
          categoria: 'PROYECTO',
          mime_type: file.mimetype,
          size_bytes: file.size,
          subido_por_id: user.id,
          expediente_id: id,
          estatus: 'VIGENTE',
          observaciones: req.body.nota_version?.trim() || `Versión V${newVersionNum}`,
          datos_extraidos: {
            proyecto: {
              version_numero: newVersionNum,
              es_version_final: false,
              nota_version: req.body.nota_version?.trim() || `Versión V${newVersionNum}`,
            }
          },
        }
      });
      await tx.expedienteDocumento.create({
        data: {
          expediente_id: id,
          documento_id: document.id,
          tipo_vinculo: 'PROYECTO_ESCRITURA',
          creado_por_id: user.id,
          estatus: 'ACTIVO',
          observaciones: `Proyecto vigente V${newVersionNum}`,
        }
      });
      await tx.expedienteActividad.create({
        data: {
          expediente_id: id,
          tipo: 'DOCUMENTO',
          titulo: `Nueva versión de proyecto cargada (V${newVersionNum})`,
          descripcion: `Archivo: "${file.originalname}" (${(file.size / 1024).toFixed(1)} KB)`,
          usuario_id: user.id,
        }
      });
      await tx.auditLog.create({
        data: {
          user_id: user.id,
          accion: 'UPLOAD_PROYECTO_VERSION',
          entidad: 'Expediente',
          entidad_id: id,
          valores_nuevos: { documento_id: document.id, version: newVersionNum, storage_key: uploadedStorageKey },
          correlation_id: (req as any).correlationId,
        }
      });
      return document;
    });

    uploadedStorageKey = null;
    const [newVersion] = await loadDatabaseProjectVersions(id).then(versions => versions.filter(version => version.id === createdDocument.id));
    res.status(201).json(newVersion);
  } catch (error: any) {
    if (uploadedStorageKey) await deleteFile(uploadedStorageKey).catch(() => undefined);
    res.status(500).json({ error: 'Error al cargar versión de proyecto', detail: error.message });
  }
};

// 3. PATCH Restore version to Vigente / Rename / Mark Final
export const updateProyectoVersion = async (req: Request, res: Response) => {
  try {
    const { id, versionId } = req.params;
    const { accion, nuevo_nombre, nota_version } = req.body;

    const databaseDocument = await prisma.documento.findFirst({
      where: { id: versionId, expediente_id: id, tipo: 'PROYECTO_ESCRITURA' },
      include: {
        subido_por: { select: { nombre: true, apellido: true } },
        expedienteVinculos: { where: { expediente_id: id, tipo_vinculo: 'PROYECTO_ESCRITURA' } },
      }
    });
    if (databaseDocument) {
      const actorId = req.user?.id;
      if (!actorId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
      const actor = await prisma.user.findFirst({ where: { id: actorId, activo: true }, select: { id: true } });
      if (!actor) return res.status(403).json({ error: 'Usuario activo requerido para actualizar el proyecto.' });
      const currentMeta = projectMeta(databaseDocument);

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:proyecto-version:${id}`}))`);
        if (accion === 'RESTAURAR_VIGENTE') {
          await tx.expedienteDocumento.updateMany({
            where: { expediente_id: id, tipo_vinculo: 'PROYECTO_ESCRITURA', estatus: 'ACTIVO' },
            data: { estatus: 'SUSTITUIDO', inactivado_at: new Date(), inactivado_por_id: actor.id, motivo_inactivacion: `Restaurada versión ${currentMeta.version_numero || ''}` },
          });
          await tx.expedienteDocumento.updateMany({
            where: { expediente_id: id, documento_id: versionId, tipo_vinculo: 'PROYECTO_ESCRITURA' },
            data: { estatus: 'ACTIVO', inactivado_at: null, inactivado_por_id: null, motivo_inactivacion: null },
          });
        }

        const nextMeta = {
          ...currentMeta,
          es_version_final: accion === 'MARCAR_FINAL' ? true : Boolean(currentMeta.es_version_final),
          nota_version: nota_version?.trim() || currentMeta.nota_version,
        };
        await tx.documento.update({
          where: { id: versionId },
          data: {
            nombre_original: accion === 'RENOMBRAR' && nuevo_nombre?.trim() ? nuevo_nombre.trim() : databaseDocument.nombre_original,
            observaciones: nota_version?.trim() || databaseDocument.observaciones,
            datos_extraidos: { proyecto: nextMeta },
          }
        });
        await tx.expedienteActividad.create({
          data: {
            expediente_id: id,
            usuario_id: actor.id,
            tipo: 'DOCUMENTO',
            titulo: accion === 'RESTAURAR_VIGENTE' ? `Proyecto V${currentMeta.version_numero || ''} restaurado` : 'Metadatos del proyecto actualizados',
            descripcion: nota_version?.trim() || accion,
          }
        });
      });

      const [updated] = (await loadDatabaseProjectVersions(id)).filter(version => version.id === versionId);
      return res.json(updated);
    }

    const state = loadProyectosState();
    const version = state.versiones.find(v => v.id === versionId && v.expediente_id === id);

    if (!version) return res.status(404).json({ error: 'Versión no encontrada' });

    if (accion === 'RESTAURAR_VIGENTE') {
      state.versiones.forEach(v => {
        if (v.expediente_id === id) v.es_vigente = (v.id === versionId);
      });
    } else if (accion === 'MARCAR_FINAL') {
      version.es_version_final = true;
    } else if (accion === 'RENOMBRAR' && nuevo_nombre) {
      version.nombre_original = nuevo_nombre;
    }

    if (nota_version) version.nota_version = nota_version;

    saveProyectosState(state);
    res.json(version);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al actualizar versión', detail: error.message });
  }
};

// 4 & 5. Stream and Download Proyecto Version
export const streamProyectoVersion = async (req: Request, res: Response) => {
  try {
    const { id, versionId } = req.params;
    const databaseVersion = (await loadDatabaseProjectVersions(id)).find(version => version.id === versionId);
    if (databaseVersion) {
      const buffer = await loadProjectVersionBuffer(databaseVersion);
      res.setHeader('Content-Type', databaseVersion.mime_type);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(databaseVersion.nombre_original)}"`);
      return res.send(buffer);
    }
    const state = loadProyectosState();
    const version = state.versiones.find(v => v.id === versionId && v.expediente_id === id);

    if (!version) return res.status(404).json({ error: 'Versión del proyecto no encontrada' });

    const filePath = path.join(PROYECTOS_DIR, version.archivo_file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'El archivo físico del proyecto no existe en almacenamiento' });
    }

    res.setHeader('Content-Type', version.mime_type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(version.nombre_original)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al visualizar proyecto', detail: error.message });
  }
};

export const downloadProyectoVersion = async (req: Request, res: Response) => {
  try {
    const { id, versionId } = req.params;
    const databaseVersion = (await loadDatabaseProjectVersions(id)).find(version => version.id === versionId);
    if (databaseVersion) {
      const buffer = await loadProjectVersionBuffer(databaseVersion);
      res.setHeader('Content-Type', databaseVersion.mime_type);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(databaseVersion.nombre_original)}"`);
      return res.send(buffer);
    }
    const state = loadProyectosState();
    const version = state.versiones.find(v => v.id === versionId && v.expediente_id === id);

    if (!version) return res.status(404).json({ error: 'Versión del proyecto no encontrada' });

    const filePath = path.join(PROYECTOS_DIR, version.archivo_file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'El archivo físico del proyecto no existe en almacenamiento' });
    }

    res.download(filePath, version.nombre_original, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Error al descargar archivo del proyecto' });
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al descargar proyecto', detail: error.message });
  }
};

// 6. ANALIZAR CON IA & GENERAR REPORTE WORD (.docx)
export const analizarProyectoConIA = async (req: Request, res: Response) => {
  const aiStartedAt = Date.now();
  let aiRequestStarted = false;
  let usageUserId: string | undefined;
  let uploadedReportKey: string | null = null;
  try {
    const { id } = req.params;

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
    usageUserId = userId;
    let userName = 'Usuario no identificado';

    if (userId) {
      const u = await prisma.user.findUnique({ where: { id: userId } });
      if (u) userName = `${u.nombre} ${u.apellido}`;
    }

    const exp = await prisma.expediente.findUnique({
      where: { id },
      include: {
        tipo_acto: true,
        requisitos_docs: true,
        movimientosFinancieros: true,
        expedienteDocumentos: {
          where: { estatus: 'ACTIVO' },
          include: { documento: true }
        }
      }
    });

    if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

    const state = loadProyectosState();
    const databaseVersions = await loadDatabaseProjectVersions(id);
    const expVersiones = [
      ...databaseVersions,
      ...state.versiones.filter(v => v.expediente_id === id).map(version => ({ ...version, storage_backend: 'LOCAL_LEGACY' as const })),
    ].sort((a, b) => b.version_numero - a.version_numero);
    const vigente = expVersiones.find(v => v.es_vigente) || expVersiones[0];

    if (!vigente) {
      return res.status(400).json({ error: 'Debe existir un proyecto vigente para ejecutar el análisis con IA' });
    }

    const docsActivos = exp.expedienteDocumentos
      .map(vinculo => vinculo.documento)
      .filter(documento => documento.estatus !== 'RECHAZADO');
    if (docsActivos.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos un documento activo cargado en el expediente' });
    }

    const projectBuffer = await loadProjectVersionBuffer(vigente);

    const documentosParaIA: DocumentoParaExtraccion[] = [];
    const documentosNoDescargados: string[] = [];
    for (const documento of docsActivos) {
      try {
        const localPath = path.join(DOCS_DIR, documento.storage_key);
        const buffer = fs.existsSync(localPath)
          ? fs.readFileSync(localPath)
          : await downloadFile(documento.storage_key);
        documentosParaIA.push({
          buffer,
          mimeType: documento.mime_type,
          tipoDocumento: documento.tipo,
          documentoId: documento.id,
          nombreOriginal: documento.nombre_original
        });
      } catch {
        documentosNoDescargados.push(documento.nombre_original);
      }
    }

    if (documentosParaIA.length === 0) {
      return res.status(400).json({
        error: 'No fue posible descargar ningún documento fuente para ejecutar la revisión con IA'
      });
    }

    aiRequestStarted = true;
    const resultadoIA = await analizarProyectoNotarialConOpenAI(
      {
        buffer: projectBuffer,
        mimeType: vigente.mime_type,
        tipoDocumento: 'PROYECTO_ESCRITURA',
        documentoId: vigente.id,
        nombreOriginal: vigente.nombre_original
      },
      documentosParaIA
    );
    await recordAIUsages(resultadoIA.uso ? [resultadoIA.uso] : [], {
      operacion: 'REVISION_PROYECTO_ESCRITURA',
      usuarioId: userId,
      expedienteId: id,
      escalamientoMotivo: 'Revisión jurídica documental compleja',
      metadata: { proyecto_version_id: vigente.id, documentos_fuente: documentosParaIA.map((item) => item.documentoId) },
    }).catch((usageError) => console.error('[AI usage] No fue posible registrar el consumo:', usageError.message));
    aiRequestStarted = false;

    const observaciones = resultadoIA.observaciones.map((observacion, index) => ({
      id: `obs_${index + 1}`,
      titulo: `OBSERVACIÓN ${String(index + 1).padStart(2, '0')} — Riesgo ${
        observacion.nivel_riesgo === 'ALTO'
          ? 'Alto'
          : observacion.nivel_riesgo === 'MEDIO' ? 'Medio' : 'Informativo'
      }`,
      ...observacion
    }));
    const conteoAlto = observaciones.filter(o => o.nivel_riesgo === 'ALTO').length;
    const conteoMedio = observaciones.filter(o => o.nivel_riesgo === 'MEDIO').length;
    const conteoInformativo = observaciones.filter(o => o.nivel_riesgo === 'INFORMATIVO').length;
    const documentosNoLeidos = Array.from(new Set([
      ...documentosNoDescargados,
      ...resultadoIA.documentos_no_leidos
    ]));

    const reportFileName = `Observaciones_IA_Expediente_${exp.numero_pravia.replace(/[^a-zA-Z0-9]/g, '_')}_V${vigente.version_numero}.docx`;
    // Build Formatted Word .docx Report using 'docx' library
    const reportDoc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: "PRAVIA OS — REPORTE DE REVISIÓN IA JURÍDICA",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Expediente: ", bold: true }),
              new TextRun({ text: `${exp.numero_pravia} (${exp.cliente_alias || 'Sin alias'})` }),
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Tipo de Acto: ", bold: true }),
              new TextRun({ text: `${exp.tipo_acto?.nombre || 'Compraventa Inmobiliaria'}` }),
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Versión del Proyecto Analizada: ", bold: true }),
              new TextRun({ text: `V${vigente.version_numero} — ${vigente.nombre_original}` }),
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Fecha y Solicitante: ", bold: true }),
              new TextRun({ text: `${new Date().toLocaleString()} por ${userName}` }),
            ]
          }),
          new Paragraph({ text: " " }),
          new Paragraph({
            text: "RESUMEN EJECUTIVO DE DOCUMENTOS:",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `• Documentos Analizados: `, bold: true }),
              new TextRun({ text: `${documentosParaIA.length} de ${docsActivos.length} documentos procesados` }),
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `• Resumen OpenAI: `, bold: true }),
              new TextRun({ text: resultadoIA.resumen_ejecutivo || 'Análisis completado.' }),
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `• Observaciones Detectadas: `, bold: true }),
              new TextRun({
                text: `${observaciones.length} observaciones (${conteoAlto} Alto, ${conteoMedio} Medio, ${conteoInformativo} Informativo)`
              }),
            ]
          }),
          new Paragraph({ text: " " }),
          new Paragraph({
            text: "DETALLE DE OBSERVACIONES Y DISCREPANCIAS:",
            heading: HeadingLevel.HEADING_2,
          }),
          ...(observaciones.length > 0 ? observaciones.map(o => [
            new Paragraph({
              children: [
                new TextRun({ text: `${o.titulo}: `, bold: true, color: o.nivel_riesgo === 'ALTO' ? 'DC2626' : o.nivel_riesgo === 'MEDIO' ? 'D97706' : '2563EB' }),
                new TextRun({ text: o.tipo_discrepancia }),
              ]
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `   - Dato en Proyecto: `, bold: true }),
                new TextRun({ text: o.dato_proyecto }),
              ]
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `   - Dato en Fuente: `, bold: true }),
                new TextRun({ text: o.dato_fuente }),
              ]
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `   - Documento Origen: `, bold: true }),
                new TextRun({ text: `${o.documento_fuente} (${o.ubicacion})` }),
              ]
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `   - Recomendación Jurídica: `, bold: true }),
                new TextRun({ text: o.recomendacion }),
              ]
            }),
            new Paragraph({ text: " " })
          ]).flat() : [new Paragraph({ text: 'No se detectaron discrepancias comprobables en los documentos analizados.' })]),
          new Paragraph({
            children: [
              new TextRun({ text: "DECLARACIÓN DE AUDITORÍA: ", bold: true, italics: true }),
              new TextRun({ text: "Este reporte es una herramienta tecnológica de asistencia. No sustituye la revisión jurídica obligatoria del abogado encargado ni la autorización del Notario Público.", italics: true }),
            ]
          })
        ]
      }]
    });

    const reportBuffer = await Packer.toBuffer(reportDoc);
    assertPersistentProjectStorage();
    uploadedReportKey = `expedientes/${id}/reportes-ia/${crypto.randomUUID()}_${reportFileName}`;
    await uploadFile(reportBuffer, uploadedReportKey, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const reportName = `Observaciones IA - Expediente ${exp.numero_pravia.replace('EXP-', '')} - Proyecto V${vigente.version_numero}.docx`;
    const reportDocument = await prisma.$transaction(async (tx) => {
      await tx.expedienteDocumento.updateMany({
        where: { expediente_id: id, tipo_vinculo: 'REPORTE_IA_PROYECTO', estatus: 'ACTIVO' },
        data: { estatus: 'SUSTITUIDO', inactivado_at: new Date(), inactivado_por_id: userId, motivo_inactivacion: 'Sustituido por un reporte de revisión más reciente' },
      });
      const document = await tx.documento.create({ data: {
        nombre_original: reportName,
        nombre_interno: uploadedReportKey!,
        storage_key: uploadedReportKey!,
        tipo: 'REPORTE_IA_PROYECTO',
        categoria: 'PROYECTO',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size_bytes: reportBuffer.length,
        subido_por_id: userId,
        expediente_id: id,
        estatus: 'VIGENTE',
        observaciones: `Revisión IA del proyecto V${vigente.version_numero}; requiere revisión humana.`,
        datos_extraidos: { reporte_ia_proyecto: {
          proyecto_version_id: vigente.id,
          proyecto_version_numero: vigente.version_numero,
          documentos_analizados_count: documentosParaIA.length,
          documentos_totales_count: docsActivos.length,
          documentos_no_leidos: documentosNoLeidos,
          observaciones,
          solicitado_por: userName,
        } },
      } });
      await tx.expedienteDocumento.create({ data: {
        expediente_id: id, documento_id: document.id, tipo_vinculo: 'REPORTE_IA_PROYECTO',
        creado_por_id: userId, estatus: 'ACTIVO', observaciones: `Reporte IA sobre proyecto V${vigente.version_numero}`,
      } });
      return document;
    });
    uploadedReportKey = null;
    const persistentReport = await projectRepository.latestReport(id);
    const reportRecord = persistentReport?.record;
    if (!reportRecord || reportRecord.id !== reportDocument.id) throw new Error('No fue posible verificar el reporte persistido.');

    // Audit activity
    if (userId) {
      await prisma.expedienteActividad.create({
        data: {
          expediente_id: id,
          tipo: 'DOCUMENTO',
          titulo: `Análisis de Inteligencia Artificial Ejecutado`,
          descripcion: `Proyecto V${vigente.version_numero} comparado con OpenAI contra ${documentosParaIA.length} documentos. ${observaciones.length} observaciones generadas.`,
          usuario_id: userId
        }
      });
    }

    res.status(201).json(reportRecord);
  } catch (error: any) {
    if (uploadedReportKey) await deleteFile(uploadedReportKey).catch(() => undefined);
    if (aiRequestStarted) {
      await recordAIFailure({
        operacion: 'REVISION_PROYECTO_ESCRITURA',
        modelo: getOpenAIEscalationModelName(),
        usuarioId: usageUserId,
        expedienteId: req.params.id,
        durationMs: Date.now() - aiStartedAt,
        errorCode: error.code || 'AI_PROJECT_REVIEW_FAILED',
      }).catch(() => undefined);
    }
    res.status(500).json({ error: 'Error al ejecutar análisis de IA', detail: error.message });
  }
};

// 7 & 8. Stream and Download IA Report
export const streamIAReport = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const persistent = await projectRepository.loadLatestReportBuffer(id);
    if (persistent) {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(persistent.record.nombre_reporte)}"`);
      return res.send(persistent.buffer);
    }
    const state = loadProyectosState();
    const reportesExp = state.reportes.filter(r => r.expediente_id === id);
    const reporte = reportesExp.length > 0 ? reportesExp[reportesExp.length - 1] : null;

    if (!reporte) return res.status(404).json({ error: 'No existe un reporte de IA para este expediente' });

    const filePath = path.join(REPORTES_DIR, reporte.archivo_reporte_file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'El archivo físico del reporte IA no existe' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(reporte.nombre_reporte)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al visualizar reporte IA', detail: error.message });
  }
};

export const downloadIAReport = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const persistent = await projectRepository.loadLatestReportBuffer(id);
    if (persistent) {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(persistent.record.nombre_reporte)}"`);
      return res.send(persistent.buffer);
    }
    const state = loadProyectosState();
    const reportesExp = state.reportes.filter(r => r.expediente_id === id);
    const reporte = reportesExp.length > 0 ? reportesExp[reportesExp.length - 1] : null;

    if (!reporte) return res.status(404).json({ error: 'No existe un reporte de IA para este expediente' });

    const filePath = path.join(REPORTES_DIR, reporte.archivo_reporte_file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'El archivo físico del reporte IA no existe' });
    }

    res.download(filePath, reporte.nombre_reporte, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Error al descargar reporte de IA' });
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al descargar reporte de IA', detail: error.message });
  }
};

// 9. GENERAR Y DESCARGAR ARCHIVO ZIP POR CARPETA O VISTA GENERAL TODAS (PULL REAL BINARIES)
export const downloadCarpetaZip = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const carpetaQuery = (req.query.carpeta as string) || 'Todas';

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });

    const exp = await prisma.expediente.findUnique({
      where: { id },
      include: {
        expedienteDocumentos: {
          where: { estatus: 'ACTIVO' },
          include: { documento: true }
        },
        requisitos_docs: true
      }
    });

    if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

    // Map active documents from expedienteDocumentos or fallback to requisitos_docs
    const allDocs = (exp.expedienteDocumentos && exp.expedienteDocumentos.length > 0)
      ? exp.expedienteDocumentos.map((ed: any) => ({
          id: ed.documento?.id || ed.id,
          nombre: ed.documento?.nombre_original || ed.nombre,
          storage_key: ed.documento?.storage_key || ed.documento?.nombre_interno,
          carpeta: ed.tipo_vinculo || 'Administrativo'
        }))
      : (exp.requisitos_docs || []).map((rd: any) => {
          const match = rd.observaciones?.match(/\[Carpeta: (.*?)\]/);
          return {
            id: rd.id,
            nombre: rd.nombre,
            storage_key: null,
            carpeta: (match && match[1]) ? match[1] : (rd.carpeta || 'Administrativo')
          };
        });

    const getDocContent = async (storageKey: string | null, documentName: string): Promise<Buffer> => {
      if (!storageKey) {
        const missingError: any = new Error(`El documento "${documentName}" no tiene un archivo vinculado.`);
        missingError.code = 'DOCUMENTO_NO_DISPONIBLE';
        throw missingError;
      }

      const docsDir = path.join(__dirname, '../../uploads/documentos');
      const localPath = path.join(docsDir, storageKey);
      if (fs.existsSync(localPath)) return fs.readFileSync(localPath);

      try {
        return await downloadFile(storageKey);
      } catch (storageError: any) {
        const missingError: any = new Error(`No se encontró el archivo físico de "${documentName}" en el almacenamiento.`);
        missingError.code = 'DOCUMENTO_NO_DISPONIBLE';
        missingError.cause = storageError;
        throw missingError;
      }
    };

    const zip = new JSZip();
    const usedNamesInFolder: Record<string, number> = {};

    if (carpetaQuery === 'Todas') {
      const rootFolderName = `Expediente_${exp.numero_pravia.replace('EXP-', '')}`;
      const rootFolder = zip.folder(rootFolderName)!;

      for (const doc of allDocs) {
        const folderName = doc.carpeta || 'Administrativo';
        const folderZip = rootFolder.folder(folderName)!;

        let filename = path.basename(doc.nombre || `documento_${doc.id}`);
        if (!path.extname(filename)) filename = `${filename}.bin`;
        const keyName = `${folderName}_${filename}`;
        if (usedNamesInFolder[keyName]) {
          usedNamesInFolder[keyName]++;
          const ext = path.extname(filename);
          const base = path.basename(filename, ext);
          filename = `${base} (${usedNamesInFolder[keyName]})${ext || '.pdf'}`;
        } else {
          usedNamesInFolder[keyName] = 1;
        }

        const fileBuffer = await getDocContent(doc.storage_key, doc.nombre);
        folderZip.file(filename, fileBuffer);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      if (userId) {
        await prisma.expedienteActividad.create({
          data: {
            expediente_id: id,
            tipo: 'DOCUMENTO',
            titulo: `Descarga de Expediente Completo en ZIP`,
            descripcion: `Archivo: "${rootFolderName}.zip"`,
            usuario_id: userId
          }
        });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${rootFolderName}.zip"`);
      return res.send(zipBuffer);
    } else {
      const docsInFolder = allDocs.filter(d => (d.carpeta || 'Administrativo') === carpetaQuery);
      if (docsInFolder.length === 0) {
        return res.status(400).json({ error: `La carpeta "${carpetaQuery}" no contiene documentos activos` });
      }

      const folderZip = zip.folder(carpetaQuery)!;

      for (const doc of docsInFolder) {
        let filename = path.basename(doc.nombre || `documento_${doc.id}`);
        if (!path.extname(filename)) filename = `${filename}.bin`;
        if (usedNamesInFolder[filename]) {
          usedNamesInFolder[filename]++;
          const ext = path.extname(filename);
          const base = path.basename(filename, ext);
          filename = `${base} (${usedNamesInFolder[filename]})${ext || '.pdf'}`;
        } else {
          usedNamesInFolder[filename] = 1;
        }

        const fileBuffer = await getDocContent(doc.storage_key, doc.nombre);
        folderZip.file(filename, fileBuffer);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      if (userId) {
        await prisma.expedienteActividad.create({
          data: {
            expediente_id: id,
            tipo: 'DOCUMENTO',
            titulo: `Descarga de Carpeta "${carpetaQuery}" en ZIP`,
            descripcion: `Contiene ${docsInFolder.length} documento(s)`,
            usuario_id: userId
          }
        });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(carpetaQuery)}.zip"`);
      return res.send(zipBuffer);
    }
  } catch (error: any) {
    const status = error.code === 'DOCUMENTO_NO_DISPONIBLE' ? 409 : 500;
    res.status(status).json({ error: 'Error al generar archivo ZIP de la carpeta', detail: error.message });
  }
};

// 10. MATRIZ DE DATOS DETECTADOS PARA EL PROYECTO
export const getDatosDetectadosMatrix = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const exp = await prisma.expediente.findUnique({
      where: { id },
      include: {
        tipo_acto: true,
        notaria: true,
        cotizacion: {
          include: { prospecto: true }
        },
        comparecientes: {
          include: {
            caracter: true,
            compareciente: {
              include: {
                personaFisica: true,
                personaMoral: true
              }
            }
          }
        },
        expedienteDocumentos: {
          include: { documento: true }
        }
      }
    });

    if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

    // Helper para obtener nombre legible de compareciente
    const getNombreCompareciente = (compObj: any) => {
      if (!compObj || !compObj.compareciente) return '';
      const { personaMoral, personaFisica, nombre_busqueda } = compObj.compareciente;
      if (personaMoral?.razon_social) return personaMoral.razon_social;
      if (personaFisica?.nombre_completo_calculado) return personaFisica.nombre_completo_calculado;
      return nombre_busqueda || '';
    };

    // 1. Extraer comprador real
    const compradorComp = exp.comparecientes.find(c =>
      c.caracter?.clave === 'PARTE_COMPRADORA' ||
      c.caracter?.nombre?.toUpperCase().includes('COMPRADOR')
    );
    const compradorNombre = compradorComp
      ? getNombreCompareciente(compradorComp)
      : (exp.cotizacion?.prospecto?.nombre || exp.cliente_alias || '[PENDIENTE DE CONFIRMAR]');

    const compradorFuente = compradorComp
      ? 'Compareciente Registrado en Expediente'
      : (exp.cotizacion?.prospecto ? 'Prospecto vinculado a la cotización' : 'Expediente Maestro');

    // 2. Extraer vendedor real
    const vendedorComp = exp.comparecientes.find(c =>
      c.caracter?.clave === 'PARTE_VENDEDORA' ||
      c.caracter?.nombre?.toUpperCase().includes('VENDEDOR')
    );
    const vendedorNombre = vendedorComp
      ? getNombreCompareciente(vendedorComp)
      : '[PENDIENTE DE CONFIRMAR]';

    const vendedorFuente = vendedorComp
      ? 'Compareciente Registrado en Expediente'
      : 'Falta Registrar Compareciente Vendedor';

    // 3. Documentos reales del expediente
    const predialDoc = exp.expedienteDocumentos.find(d => d.documento.nombre_original.toLowerCase().includes('predial'));
    const escDoc = exp.expedienteDocumentos.find(d => d.documento.nombre_original.toLowerCase().includes('esc'));
    const cotDoc = exp.expedienteDocumentos.find(d => d.documento.nombre_original.toLowerCase().includes('cotizacion'));

    const getDatoExtraido = (vinculo: any, claves: string[]) => {
      const datos = vinculo?.documento?.datos_extraidos;
      if (!datos || typeof datos !== 'object') return null;
      for (const clave of claves) {
        const valor = (datos as any)[clave];
        if (valor !== undefined && valor !== null && String(valor).trim()) return String(valor).trim();
      }
      return null;
    };

    const cuentaPredial = getDatoExtraido(predialDoc, ['cuenta_predial', 'cuentaPredial', 'clave_catastral']);
    const superficie = getDatoExtraido(escDoc, ['superficie_privativa', 'superficie', 'metros_cuadrados']);
    const notariaNombre = exp.notaria?.nombre || '[PENDIENTE DE ASIGNAR]';
    const tipoActoNombre = exp.tipo_acto?.nombre || exp.cotizacion?.prospecto?.tipo_acto || '[PENDIENTE DE CONFIRMAR]';
    
    const totalPrecioNum = exp.valor_operacion || exp.cotizacion?.total_cliente;
    const totalPrecioStr = totalPrecioNum
      ? `$${Number(totalPrecioNum).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
      : '[PENDIENTE DE CONFIRMAR]';

    const matrix = [
      {
        campo: 'tipo_acto',
        etiqueta: 'Tipo de Acto',
        valor_detectado: tipoActoNombre,
        fuente: 'Expediente Maestro / Prospecto',
        confianza: 'Alta',
        estatus: 'CONFIRMADO',
        obligatorio: true
      },
      {
        campo: 'notaria',
        etiqueta: 'Notaría Pública',
        valor_detectado: notariaNombre,
        fuente: exp.notaria ? 'Notaría asignada al expediente' : 'Falta asignar notaría',
        confianza: exp.notaria ? 'Alta' : 'Pendiente',
        estatus: exp.notaria ? 'CONFIRMADO' : 'PENDIENTE',
        obligatorio: true
      },
      {
        campo: 'vendedor',
        etiqueta: 'Vendedor / Transmitente',
        valor_detectado: vendedorNombre,
        fuente: vendedorFuente,
        confianza: vendedorComp ? 'Alta' : 'Pendiente',
        estatus: vendedorComp ? 'CONFIRMADO' : 'PENDIENTE',
        obligatorio: true
      },
      {
        campo: 'comprador',
        etiqueta: 'Comprador / Adquirente',
        valor_detectado: compradorNombre,
        fuente: compradorFuente,
        confianza: compradorComp ? 'Alta' : 'Pendiente',
        estatus: compradorComp ? 'CONFIRMADO' : 'PENDIENTE',
        obligatorio: true
      },
      {
        campo: 'cuenta_predial',
        etiqueta: 'Cuenta Predial',
        valor_detectado: cuentaPredial || '[PENDIENTE DE EXTRAER]',
        fuente: predialDoc ? `Documento disponible: ${predialDoc.documento.nombre_original}` : 'Falta documento predial',
        confianza: cuentaPredial ? 'Alta' : 'Pendiente',
        estatus: cuentaPredial ? 'CONFIRMADO' : 'PENDIENTE',
        obligatorio: true
      },
      {
        campo: 'superficie',
        etiqueta: 'Superficie Privativa',
        valor_detectado: superficie || '[PENDIENTE DE EXTRAER]',
        fuente: escDoc ? `Documento disponible: ${escDoc.documento.nombre_original}` : 'Falta escritura o antecedente',
        confianza: superficie ? 'Alta' : 'Pendiente',
        estatus: superficie ? 'CONFIRMADO' : 'PENDIENTE',
        obligatorio: true
      },
      {
        campo: 'precio',
        etiqueta: 'Precio de Operación',
        valor_detectado: totalPrecioStr,
        fuente: cotDoc ? `Documento: ${cotDoc.documento.nombre_original}` : 'Expediente / cotización vinculada',
        confianza: totalPrecioNum ? 'Alta' : 'Pendiente',
        estatus: totalPrecioNum ? 'CONFIRMADO' : 'PENDIENTE',
        obligatorio: true
      },
      {
        campo: 'folio_real',
        etiqueta: 'Folio Real / Registro',
        valor_detectado: '[PENDIENTE DE CONFIRMAR]',
        fuente: 'Falta Certificado de Gravamen',
        confianza: 'Pendiente',
        estatus: 'PENDIENTE',
        obligatorio: false
      },
      {
        campo: 'estado_civil',
        etiqueta: 'Estado Civil Comprador',
        valor_detectado: '[PENDIENTE DE CONFIRMAR]',
        fuente: 'Falta Identificación / Acta de Nacimiento',
        confianza: 'Pendiente',
        estatus: 'PENDIENTE',
        obligatorio: false
      }
    ];

    res.json({ expediente_id: id, numero_pravia: exp.numero_pravia, matriz: matrix });
  } catch (error: any) {
    res.status(500).json({ error: 'Error al obtener matriz de datos detectados', detail: error.message });
  }
};

// 11. GENERAR PROYECTO CON IA A PARTIR DE PLANTILLA PARAMETRIZADA
export const generarProyectoConIA = async (req: Request, res: Response) => {
  let uploadedProjectKey: string | null = null;
  try {
    const { id } = req.params;
    const { matriz_confirmada } = req.body;

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Tu sesión no es válida.', code: 'AUTH_REQUIRED' });
    let userName = 'Abogado Responsable';
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (u) userName = u.nombre;

    const exp = await prisma.expediente.findUnique({
      where: { id },
      include: { tipo_acto: true, notaria: true, plantillaDocVersion: true }
    });

    if (!exp) return res.status(404).json({ error: 'Expediente no encontrado' });

    // Map de valores confirmados
    const confirmedMap: Record<string, string> = {};
    if (Array.isArray(matriz_confirmada)) {
      matriz_confirmada.forEach((item: any) => {
        if (item.campo && item.valor_detectado) {
          confirmedMap[item.campo] = item.valor_detectado;
        }
      });
    }

    assertPersistentProjectStorage();
    const template = exp.plantillaDocVersion;
    if (!template?.storage_key || !template.mime_type || !template.size_bytes || !template.activa) {
      return res.status(400).json({
        error: 'No existe una plantilla aprobada para esta Notaría y Tipo de Acto.',
        detail: 'El expediente no tiene una plantilla Word persistente, activa y versionada.'
      });
    }
    if (template.notaria_id && template.notaria_id !== exp.notaria_id) {
      return res.status(409).json({ error: 'La plantilla congelada no corresponde a la notaría asignada al expediente.', code: 'PROJECT_TEMPLATE_NOTARY_MISMATCH' });
    }

    const state = loadProyectosState();
    const databaseVersions = await projectRepository.listVersions(id);
    const expVersiones = [...databaseVersions, ...state.versiones.filter(v => v.expediente_id === id)];
    const nextVersionNum = expVersiones.length > 0 ? Math.max(...expVersiones.map(v => v.version_numero)) + 1 : 1;

    const newFilename = `Proyecto_${exp.numero_pravia.replace(/[^a-zA-Z0-9]/g, '_')}_V${nextVersionNum}.docx`;
    const content = await downloadFile(template.storage_key);
    if (content.length !== template.size_bytes) {
      return res.status(409).json({ error: 'La plantilla persistente no coincide con el tamaño registrado.', code: 'PROJECT_TEMPLATE_SIZE_MISMATCH' });
    }
    if (template.checksum_sha256 && createHash('sha256').update(content).digest('hex') !== template.checksum_sha256) {
      return res.status(409).json({ error: 'La integridad de la plantilla persistente no pudo verificarse.', code: 'PROJECT_TEMPLATE_CHECKSUM_MISMATCH' });
    }
    const zip = await JSZip.loadAsync(content);
    let xml = await zip.file('word/document.xml')?.async('string');

    if (!xml) {
      return res.status(500).json({ error: 'La plantilla notarial está dañada o no contiene document.xml' });
    }

    // Realizar sustitución sobre el XML manteniendo 100% de la estructura, 10 páginas, antecedente e inmutabilidad
    xml = xml.replace(/\{\{\s*vendedor_nombre\s*\}\}/gi, confirmedMap.vendedor || '[PENDIENTE DE CONFIRMAR]');
    xml = xml.replace(/\{\{\s*comprador_nombre\s*\}\}/gi, confirmedMap.comprador || exp.cliente_alias || '[PENDIENTE DE CONFIRMAR]');
    xml = xml.replace(/\{\{\s*inmueble_predial\s*\}\}/gi, confirmedMap.cuenta_predial || '[PENDIENTE DE CONFIRMAR]');
    xml = xml.replace(/\{\{\s*inmueble_superficie\s*\}\}/gi, confirmedMap.superficie || '[PENDIENTE DE CONFIRMAR]');
    xml = xml.replace(/\{\{\s*operacion_precio\s*\}\}/gi, confirmedMap.precio || '[PENDIENTE DE CONFIRMAR]');
    xml = xml.replace(/\{\{\s*inmueble_folio_real\s*\}\}/gi, confirmedMap.folio_real || '[PENDIENTE DE CONFIRMAR]');

    zip.file('word/document.xml', xml);
    const outBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    const generatedZip = await JSZip.loadAsync(outBuffer);
    if (!generatedZip.file('word/document.xml') || Object.keys(generatedZip.files).length !== Object.keys(zip.files).length) {
      return res.status(400).json({
        error: 'La validación estructural del proyecto generado falló.',
        detail: 'El documento resultante no conservó la estructura interna de la plantilla versionada.'
      });
    }

    uploadedProjectKey = `expedientes/${id}/proyectos/${crypto.randomUUID()}_${newFilename}`;
    await uploadFile(outBuffer, uploadedProjectKey, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:proyecto-version:${id}`}))`);
      await tx.expedienteDocumento.updateMany({
        where: { expediente_id: id, tipo_vinculo: 'PROYECTO_ESCRITURA', estatus: 'ACTIVO' },
        data: { estatus: 'SUSTITUIDO', inactivado_at: new Date(), inactivado_por_id: userId, motivo_inactivacion: `Sustituido por V${nextVersionNum}` },
      });
      const document = await tx.documento.create({ data: {
        nombre_original: `Proyecto_${exp.numero_pravia}_V${nextVersionNum}.docx`,
        nombre_interno: uploadedProjectKey!, storage_key: uploadedProjectKey!, tipo: 'PROYECTO_ESCRITURA', categoria: 'PROYECTO',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: outBuffer.length,
        subido_por_id: userId, expediente_id: id, estatus: 'VIGENTE',
        observaciones: `V${nextVersionNum} — BORRADOR GENERADO DESDE PLANTILLA — REQUIERE REVISIÓN`,
        datos_extraidos: { proyecto: {
          version_numero: nextVersionNum, es_version_final: false,
          nota_version: `V${nextVersionNum} — BORRADOR GENERADO DESDE PLANTILLA — REQUIERE REVISIÓN`,
          plantilla_documental_version_id: template.id,
          plantilla_version: template.version,
          plantilla_checksum_sha256: template.checksum_sha256,
        } },
      } });
      await tx.expedienteDocumento.create({ data: { expediente_id: id, documento_id: document.id, tipo_vinculo: 'PROYECTO_ESCRITURA', creado_por_id: userId, estatus: 'ACTIVO', observaciones: `Proyecto vigente V${nextVersionNum}` } });
      return document;
    });
    uploadedProjectKey = null;
    const persisted = await projectRepository.getVersion(id, created.id);
    if (!persisted) throw new Error('No fue posible verificar el proyecto persistido.');
    const newVersion = persisted.record;

    if (userId) {
      await prisma.expedienteActividad.create({
        data: {
          expediente_id: id,
          tipo: 'AUDITORIA',
          titulo: `Generado Proyecto de Escritura con IA (V${nextVersionNum})`,
          descripcion: `Proyecto V${nextVersionNum} generado con plantilla persistente ${template.id} y matriz confirmada. Requiere revisión profesional.`,
          usuario_id: userId
        }
      });
    }

    res.status(201).json({
      mensaje: 'Proyecto de Escritura generado con éxito mediante IA',
      version: newVersion
    });
  } catch (error: any) {
    if (uploadedProjectKey) await deleteFile(uploadedProjectKey).catch(() => undefined);
    res.status(500).json({ error: 'Error al generar proyecto con IA', detail: error.message });
  }
};
