import { createHash, randomUUID } from 'crypto';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { budgetTotals } from '../domain/expedienteBudget';
import { CFG002_LIBRARY_CODE } from './configurationCatalogV4.domain';
import { deleteFile, downloadFile, uploadFile } from './supabase.service';

type Actor = NonNullable<Request['user']>;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class QuoteDocumentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const money = (value: bigint) => new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) / 100);
const names = (rows: Array<{ concepto: string }>) => rows.map((row) => row.concepto).join('; ') || 'No aplica';

export function quoteTemplateData(input: {
  folio: string; date: Date; client: string; act: string; notary: string;
  concepts: Array<{ concepto: string; categoria: 'HONORARIOS' | 'IVA_HONORARIOS' | 'IMPUESTOS_DERECHOS'; importeCents: bigint }>;
  validatedAdvanceCents: bigint;
}) {
  const totals = budgetTotals(input.concepts);
  const rights = input.concepts.filter((row) => row.categoria === 'IMPUESTOS_DERECHOS' && /derecho|registro|rpp/i.test(row.concepto));
  const taxes = input.concepts.filter((row) => row.categoria === 'IMPUESTOS_DERECHOS' && !rights.includes(row));
  const rightsCents = rights.reduce((sum, row) => sum + row.importeCents, 0n);
  const taxesCents = taxes.reduce((sum, row) => sum + row.importeCents, 0n);
  const totalCents = totals.honorariosCents + totals.ivaHonorariosCents + totals.impuestosDerechosCents;
  const balance = totalCents > input.validatedAdvanceCents ? totalCents - input.validatedAdvanceCents : 0n;
  return {
    'cotizacion.folio': input.folio,
    'cotizacion.fecha': new Intl.DateTimeFormat('es-MX', { dateStyle: 'long' }).format(input.date),
    'cliente.nombre': input.client,
    'expediente.acto': input.act,
    'inmueble.referencia|[PENDIENTE/NO APLICA]': 'Pendiente / no aplica',
    'cotizacion.base_honorarios': names(input.concepts.filter((row) => row.categoria === 'HONORARIOS')),
    'cotizacion.honorarios': money(totals.honorariosCents),
    'cotizacion.iva_tasa': names(input.concepts.filter((row) => row.categoria === 'IVA_HONORARIOS')),
    'cotizacion.iva': money(totals.ivaHonorariosCents),
    'cotizacion.impuestos_detalle': names(taxes),
    'cotizacion.impuestos': money(taxesCents),
    'cotizacion.derechos_detalle': names(rights),
    'cotizacion.derechos': money(rightsCents),
    'cotizacion.terceros_detalle': 'No identificado en el presupuesto estructurado',
    'cotizacion.terceros': '0.00',
    'cotizacion.total': money(totalCents),
    'cotizacion.anticipo': money(input.validatedAdvanceCents),
    'cotizacion.saldo': money(balance),
    'cotizacion.vigencia': 'No configurada',
    'notaria.datos_bancarios': 'Pendiente de configuración',
    'notaria.nombre': input.notary,
  };
}

export function renderQuoteTemplate(template: Buffer, data: Record<string, string>) {
  const document = new Docxtemplater(new PizZip(template), {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
  });
  document.render(data);
  return document.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

export class QuoteDocumentService {
  async generate(actor: Actor, cotizacionId: string) {
    const quote = await prisma.cotizacion.findFirst({
      where: { id: cotizacionId, organization_id: actor.organizationId },
      include: {
        prospecto: true, notaria: true,
        conceptos: { orderBy: { orden: 'asc' } },
        versiones: { where: { aprobada: true }, orderBy: { version: 'desc' }, take: 1 },
        pagos: { where: { estatus: 'VALIDADO' } },
      },
    });
    if (!quote) throw new QuoteDocumentError(404, 'QUOTE_NOT_FOUND', 'No se encontró la cotización.');
    if (!quote.conceptos.length) throw new QuoteDocumentError(409, 'QUOTE_STRUCTURED_BUDGET_REQUIRED', 'Captura y confirma el presupuesto estructurado antes de generar la cotización.');
    if (['ACEPTADA', 'ACEPTO_ANTICIPO', 'CONVERTIDA_EXPEDIENTE'].includes(String(quote.etapa_contractual))) {
      throw new QuoteDocumentError(409, 'QUOTE_ACCEPTED_IMMUTABLE', 'La cotización aceptada conserva sus documentos históricos y no admite nuevas versiones.');
    }
    const artifact = await prisma.catalogoArtefacto.findFirst({
      where: { organization_id: actor.organizationId, codigo_biblioteca: `${CFG002_LIBRARY_CODE}:ADM-001`, tipo: 'FORMATO', activo: true },
      include: { versiones: { where: { activa: true }, orderBy: { version: 'desc' }, take: 1 } },
    });
    const template = artifact?.versiones[0];
    if (!artifact || !template?.storage_key || template.mime_type !== DOCX) throw new QuoteDocumentError(409, 'QUOTE_TEMPLATE_NOT_CONFIGURED', 'Configura el formato administrativo ADM-001 de cotización en Plantillas y formatos.');
    const source = await downloadFile(template.storage_key);
    if (template.size_bytes != null && source.length !== template.size_bytes) throw new QuoteDocumentError(409, 'QUOTE_TEMPLATE_SIZE_MISMATCH', 'La versión configurada de la plantilla no coincide con su registro.');
    if (template.checksum_sha256 && createHash('sha256').update(source).digest('hex') !== template.checksum_sha256) throw new QuoteDocumentError(409, 'QUOTE_TEMPLATE_CHECKSUM_MISMATCH', 'No fue posible verificar la integridad de la plantilla configurada.');
    const concepts = quote.conceptos.map((row) => ({ concepto: row.concepto, categoria: row.categoria, importeCents: BigInt(Math.round(Number(row.importe) * 100)) }));
    const version = quote.versiones[0];
    const data = quoteTemplateData({
      folio: quote.numero_cotizacion || quote.numero_solicitud || quote.id,
      date: new Date(), client: quote.prospecto?.nombre || 'Cliente pendiente',
      act: quote.prospecto?.tipo_acto || 'Acto pendiente', notary: quote.notaria?.nombre || 'Notaría', concepts,
      validatedAdvanceCents: quote.pagos.reduce((sum, row) => sum + BigInt(Math.round(Number(row.monto) * 100)), 0n),
    });
    let output: Buffer;
    try { output = renderQuoteTemplate(source, data); }
    catch { throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_RENDER_FAILED', 'La plantilla ADM-001 no pudo combinarse con los datos estructurados.'); }
    const checksum = createHash('sha256').update(output).digest('hex');
    const sequence = await prisma.cotizacionDocumento.count({ where: { cotizacion_id: quote.id, tipo_vinculo: 'COTIZACION_GENERADA' } }) + 1;
    const fileName = `${quote.numero_cotizacion || 'Cotizacion'}_V${sequence}.docx`;
    const storageKey = `organizations/${actor.organizationId}/documentos/cotizaciones/${quote.id}/${randomUUID()}_${fileName}`;
    await uploadFile(output, storageKey, DOCX);
    try {
      return await prisma.$transaction(async (tx) => {
        const document = await tx.documento.create({ data: {
          organization_id: actor.organizationId, cotizacion_id: quote.id,
          nombre_original: fileName, nombre_interno: storageKey, storage_key: storageKey,
          tipo: 'COTIZACION_GENERADA', categoria: 'OTROS', mime_type: DOCX, size_bytes: output.length,
          checksum_sha256: checksum, estatus: 'VIGENTE', subido_por_id: actor.id,
          datos_extraidos: { generation: { source: 'CFG-002', artifact_id: artifact.id, artifact_version_id: template.id, artifact_version: template.version, cotizacion_version_id: version?.id || null, structured_budget_checksum: createHash('sha256').update(JSON.stringify(data)).digest('hex') } },
        } });
        await tx.cotizacionDocumento.create({ data: { organization_id: actor.organizationId, cotizacion_id: quote.id, documento_id: document.id, tipo_vinculo: 'COTIZACION_GENERADA', creado_por_id: actor.id, observaciones: `CFG-002 ADM-001 · versión ${template.version}` } });
        await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'QUOTE_DOCUMENT_GENERATED', entidad: 'Documento', entidad_id: document.id, valores_nuevos: { cotizacion_id: quote.id, cotizacion_version_id: version?.id || null, template_version_id: template.id, checksum }, session_id: actor.sessionId } });
        return document;
      });
    } catch (error) { await deleteFile(storageKey).catch(() => undefined); throw error; }
  }
}

export const quoteDocumentService = new QuoteDocumentService();
