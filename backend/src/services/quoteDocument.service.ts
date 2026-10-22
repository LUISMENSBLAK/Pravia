import { createHash, randomUUID } from 'crypto';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prisma';
import { budgetTotals, moneyToCents, type BudgetTaxTreatment } from '../domain/expedienteBudget';
import {
  AdministrativeQuoteTemplateError,
  DOCX_MIME_TYPE,
  resolveAdministrativeQuoteTemplate,
} from './administrativeQuoteTemplate.service';
import { deleteFile, uploadFile } from './supabase.service';

type Actor = NonNullable<Request['user']>;
const DOCX = DOCX_MIME_TYPE;
type QuoteBudgetConcept = {
  concepto: string;
  categoria: 'HONORARIOS' | 'IVA_HONORARIOS' | 'IMPUESTOS_DERECHOS' | 'OTRO_GASTO';
  importeCents: bigint;
  tratamiento_iva?: BudgetTaxTreatment | null;
  iva_tasa?: string | null;
};

export class QuoteDocumentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const money = (value: bigint) => new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) / 100);
const names = (rows: Array<{ concepto: string }>) => rows.map((row) => row.concepto).join('; ') || 'No aplica';
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const paragraph = (value: string, options: { bold?: boolean; before?: number; after?: number } = {}) => `<w:p><w:pPr><w:spacing w:before="${options.before ?? 0}" w:after="${options.after ?? 80}"/></w:pPr><w:r>${options.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;

export function quoteStructuredBudget(concepts: QuoteBudgetConcept[]) {
  const totals = budgetTotals(concepts);
  const taxes = concepts.filter((row) => row.categoria === 'IMPUESTOS_DERECHOS');
  const fees = concepts.filter((row) => row.categoria === 'HONORARIOS' || row.categoria === 'IVA_HONORARIOS');
  const others = concepts.filter((row) => row.categoria === 'OTRO_GASTO');
  const subtotal = (rows: QuoteBudgetConcept[]) => rows.reduce((sum, row) => sum + row.importeCents, 0n);
  const groups = [
    { label: 'IMPUESTOS Y DERECHOS', rows: taxes, subtotalCents: subtotal(taxes) },
    { label: 'HONORARIOS', rows: fees, subtotalCents: subtotal(fees) },
    { label: 'OTROS GASTOS', rows: others, subtotalCents: totals.subtotalOtrosGastosCents },
  ].filter((group) => group.rows.length > 0);
  return { groups, totalCents: moneyToCents(totals.total) };
}

/** Fill the economic table already present in ADM-001; never append a second quote. */
export function fillStructuredQuoteBudget(documentBuffer: Buffer, concepts: QuoteBudgetConcept[]) {
  const zip = new PizZip(documentBuffer);
  const file = zip.file('word/document.xml');
  const documentXml = file?.asText();
  if (!documentXml) throw new QuoteDocumentError(422, 'QUOTE_DOCUMENT_XML_MISSING', 'El formato no contiene un documento Word válido.');
  const xmlDoc = new DOMParser().parseFromString(documentXml, 'application/xml');
  const textIn = (element: { getElementsByTagName: (name: string) => ArrayLike<{ textContent: string | null }> }) =>
    Array.from(element.getElementsByTagName('w:t')).map((node) => node.textContent || '').join('').trim();
  const tables = Array.from(xmlDoc.getElementsByTagName('w:tbl'));
  const table = tables.find((candidate) => Array.from(candidate.getElementsByTagName('w:tr')).some((row) => {
    const first = row.getElementsByTagName('w:tc').item(0);
    return first && textIn(first) === 'TOTAL ESTIMADO';
  }));
  if (!table) throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_BUDGET_STRUCTURE_MISSING', 'El machote no tiene la tabla económica ADM-001; revisa su estructura antes de generar.');
  const rows = Array.from(table.getElementsByTagName('w:tr'));
  const findRow = (label: string) => rows.find((row) => {
    const first = row.getElementsByTagName('w:tc').item(0);
    return first && textIn(first) === label;
  });
  const anchors = {
    fees: findRow('Honorarios notariales'), iva: findRow('IVA sobre honorarios, cuando aplique'),
    taxes: findRow('Impuestos'), rights: findRow('Derechos'),
    total: findRow('TOTAL ESTIMADO'),
  };
  if (Object.values(anchors).some((row) => !row)) throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_BUDGET_STRUCTURE_MISSING', 'El machote no contiene todas las filas económicas ADM-001.');
  const rowStyle = anchors.taxes!.cloneNode(true) as Element;
  const setCell = (cell: Element, value: string) => {
    const nodes = Array.from(cell.getElementsByTagName('w:t'));
    if (!nodes.length) throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_BUDGET_STRUCTURE_MISSING', 'Una celda económica del machote no contiene texto editable.');
    nodes[0].textContent = value;
    for (const node of nodes.slice(1)) node.textContent = '';
  };
  const replaceRow = (original: NonNullable<typeof anchors.fees>, entries: Array<[string, string, string]>) => {
    const parent = original.parentNode;
    if (!parent) throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_BUDGET_STRUCTURE_MISSING', 'La tabla económica del machote no es válida.');
    for (const [label, base, amount] of entries) {
      const copy = original.cloneNode(true) as Element;
      const cells = Array.from(copy.getElementsByTagName('w:tc'));
      if (cells.length < 3) throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_BUDGET_STRUCTURE_MISSING', 'La tabla económica necesita tres columnas.');
      setCell(cells[0], label); setCell(cells[1], base); setCell(cells[2], amount);
      parent.insertBefore(copy, original);
    }
    parent.removeChild(original);
  };
  const fees = concepts.filter((row) => row.categoria === 'HONORARIOS');
  const totals = budgetTotals(concepts);
  const rights = concepts.filter((row) => row.categoria === 'IMPUESTOS_DERECHOS' && /derecho|registro|rpp/i.test(row.concepto));
  const taxes = concepts.filter((row) => row.categoria === 'IMPUESTOS_DERECHOS' && !rights.includes(row));
  const detail = (items: QuoteBudgetConcept[], empty: string): Array<[string, string, string]> =>
    items.length ? items.map((item) => [item.concepto, '', money(item.importeCents)]) : [[empty, '', '0.00']];
  replaceRow(anchors.fees!, detail(fees, 'Sin honorarios'));
  replaceRow(anchors.iva!, [['IVA sobre honorarios, cuando aplique', '', money(totals.ivaHonorariosCents)]]);
  replaceRow(anchors.taxes!, detail(taxes, 'Sin impuestos'));
  replaceRow(anchors.rights!, detail(rights, 'Sin derechos'));
  // ADM-001 has a legacy aggregate row for third-party costs. The detailed
  // canonical concept rows below replace it; retaining both duplicates costs.
  const legacyThirdPartyRow = findRow('Avalúos / certificados / gestoría / terceros');
  if (legacyThirdPartyRow?.parentNode) legacyThirdPartyRow.parentNode.removeChild(legacyThirdPartyRow);
  const extra: Array<[string, string, string]> = concepts.filter((row) => row.categoria === 'OTRO_GASTO').map((row) => [row.concepto, '', money(row.importeCents)]);
  if (totals.ivaOtrosGastosCents) extra.push(['IVA de otros gastos configurados', '', money(totals.ivaOtrosGastosCents)]);
  if (extra.length) extra.unshift(['OTROS GASTOS', '', '']);
  extra.push(['SUBTOTAL IMPUESTOS Y DERECHOS', '', money(totals.impuestosDerechosCents)]);
  extra.push(['SUBTOTAL HONORARIOS', '', money(totals.honorariosCents + totals.ivaHonorariosCents)]);
  if (totals.otrosGastosCents) extra.push(['SUBTOTAL OTROS GASTOS', '', money(totals.subtotalOtrosGastosCents)]);
  for (const [label, base, value] of extra) {
    const copy = rowStyle.cloneNode(true) as Element;
    const cells = Array.from(copy.getElementsByTagName('w:tc'));
    if (cells.length < 3) throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_BUDGET_STRUCTURE_MISSING', 'La tabla económica necesita tres columnas.');
    setCell(cells[0], label); setCell(cells[1], base); setCell(cells[2], value);
    anchors.total!.parentNode!.insertBefore(copy, anchors.total!);
  }
  const totalCells = Array.from(anchors.total!.getElementsByTagName('w:tc'));
  if (totalCells.length < 3) throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_BUDGET_STRUCTURE_MISSING', 'La fila TOTAL ESTIMADO debe tener tres columnas.');
  setCell(totalCells[2], money(quoteStructuredBudget(concepts).totalCents));
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

export type AccountStatementDocumentData = {
  generatedAt: string;
  budgetVersion: number;
  sections: Array<{ label: string; budgeted: string; collected: string; pending: string }>;
  totals: {
    budget: string;
    collected: string;
    pending: string;
    thirdPartyPendingApplication: string;
  };
};

/**
 * Adds the financial statement to the same DOCX pipeline used by quotes and
 * expediente budgets. This deliberately extends the canonical renderer rather
 * than introducing a parallel document generator.
 */
export function appendAccountStatement(documentBuffer: Buffer, statement: AccountStatementDocumentData) {
  const zip = new PizZip(documentBuffer);
  const file = zip.file('word/document.xml');
  const documentXml = file?.asText();
  if (!documentXml) throw new Error('ACCOUNT_STATEMENT_DOCUMENT_XML_MISSING');
  if (documentXml.includes('PRAVIA_EXPEDIENTE_ACCOUNT_STATEMENT')) return documentBuffer;
  const header = '<w:tr>'
    + `<w:tc>${paragraph('CONCEPTO', { bold: true })}</w:tc>`
    + `<w:tc>${paragraph('PRESUPUESTADO', { bold: true })}</w:tc>`
    + `<w:tc>${paragraph('COBRADO / APLICADO', { bold: true })}</w:tc>`
    + `<w:tc>${paragraph('PENDIENTE', { bold: true })}</w:tc>`
    + '</w:tr>';
  const rows = statement.sections.map((row) => '<w:tr>'
    + `<w:tc>${paragraph(row.label)}</w:tc>`
    + `<w:tc>${paragraph(`$${row.budgeted}`)}</w:tc>`
    + `<w:tc>${paragraph(`$${row.collected}`)}</w:tc>`
    + `<w:tc>${paragraph(`$${row.pending}`)}</w:tc>`
    + '</w:tr>').join('');
  const block = [
    '<w:bookmarkStart w:id="19778" w:name="PRAVIA_EXPEDIENTE_ACCOUNT_STATEMENT"/>',
    paragraph('ESTADO DE CUENTA DEL EXPEDIENTE', { bold: true, before: 260, after: 100 }),
    paragraph(`Generado: ${statement.generatedAt} · Presupuesto vigente versión ${statement.budgetVersion}`, { after: 120 }),
    '<w:tbl><w:tblPr><w:tblW w:w="10000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="2" w:color="E8E8E8"/></w:tblBorders></w:tblPr>',
    header, rows, '</w:tbl>',
    paragraph(`PRESUPUESTO VIGENTE    $${statement.totals.budget}`, { bold: true, before: 160 }),
    paragraph(`TOTAL COBRADO    $${statement.totals.collected}`, { bold: true }),
    paragraph(`TOTAL PENDIENTE    $${statement.totals.pending}`, { bold: true }),
    paragraph(`RECURSOS NO PROPIOS PENDIENTES DE ENTREGAR / APLICAR    $${statement.totals.thirdPartyPendingApplication}`, { bold: true }),
    '<w:bookmarkEnd w:id="19778"/>',
  ].join('');
  const sectionIndex = documentXml.lastIndexOf('<w:sectPr');
  const nextXml = sectionIndex >= 0
    ? `${documentXml.slice(0, sectionIndex)}${block}${documentXml.slice(sectionIndex)}`
    : documentXml.replace('</w:body>', `${block}</w:body>`);
  zip.file('word/document.xml', nextXml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

export function quoteTemplateData(input: {
  folio: string; date: Date; client: string; act: string; notary: string;
  concepts: QuoteBudgetConcept[];
  validatedAdvanceCents: bigint;
}) {
  const totals = budgetTotals(input.concepts);
  const rights = input.concepts.filter((row) => row.categoria === 'IMPUESTOS_DERECHOS' && /derecho|registro|rpp/i.test(row.concepto));
  const taxes = input.concepts.filter((row) => row.categoria === 'IMPUESTOS_DERECHOS' && !rights.includes(row));
  const rightsCents = rights.reduce((sum, row) => sum + row.importeCents, 0n);
  const taxesCents = taxes.reduce((sum, row) => sum + row.importeCents, 0n);
  const totalCents = moneyToCents(totals.total);
  const balance = totalCents > input.validatedAdvanceCents ? totalCents - input.validatedAdvanceCents : 0n;
  return {
    'cotizacion.folio': input.folio,
    'cotizacion.fecha': new Intl.DateTimeFormat('es-MX', { dateStyle: 'long' }).format(input.date),
    'cliente.nombre': input.client,
    'expediente.acto': input.act,
    'inmueble.referencia|[PENDIENTE/NO APLICA]': 'Pendiente / no aplica',
    'cotizacion.base_honorarios': names(input.concepts.filter((row) => row.categoria === 'HONORARIOS')),
    'cotizacion.honorarios': money(totals.honorariosCents),
    'cotizacion.iva_tasa': totals.ivaHonorariosCents ? '16 % sobre honorarios, salvo excepción configurada' : 'No aplica',
    'cotizacion.iva': money(totals.ivaHonorariosCents),
    'cotizacion.impuestos_detalle': names(taxes),
    'cotizacion.impuestos': money(taxesCents),
    'cotizacion.derechos_detalle': names(rights),
    'cotizacion.derechos': money(rightsCents),
    'cotizacion.terceros_detalle': input.concepts.some((row) => row.categoria === 'OTRO_GASTO')
      ? names(input.concepts.filter((row) => row.categoria === 'OTRO_GASTO'))
      : 'No identificado en el presupuesto estructurado',
    'cotizacion.terceros': money(totals.subtotalOtrosGastosCents),
    'cotizacion.total': money(totalCents),
    'cotizacion.anticipo': money(input.validatedAdvanceCents),
    'cotizacion.saldo': money(balance),
    'cotizacion.vigencia': 'No configurada',
    'notaria.datos_bancarios': 'Pendiente de configuración',
    'notaria.nombre': input.notary,
  };
}

export function renderQuoteTemplate(template: Buffer, data: Record<string, string>, concepts: QuoteBudgetConcept[] = []) {
  const document = new Docxtemplater(new PizZip(template), {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
  });
  document.render(data);
  const rendered = document.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  return fillStructuredQuoteBudget(rendered, concepts);
}

export class QuoteDocumentService {
  async generate(actor: Actor, cotizacionId: string, options: { idempotencyKey?: string } = {}) {
    const idempotencyKey = String(options.idempotencyKey || '').trim() || null;
    if (idempotencyKey && idempotencyKey.length > 160) throw new QuoteDocumentError(400, 'QUOTE_DOCUMENT_IDEMPOTENCY_INVALID', 'La clave de idempotencia no es válida.');
    if (idempotencyKey) {
      const existing = await prisma.cotizacionDocumento.findFirst({
        where: { organization_id: actor.organizationId, cotizacion_id: cotizacionId, idempotency_key: idempotencyKey },
        include: { documento: true },
      });
      if (existing) return existing.documento;
    }
    const quote = await prisma.cotizacion.findFirst({
      where: { id: cotizacionId, organization_id: actor.organizationId },
      include: {
        prospecto: true,
        conceptos: { orderBy: { orden: 'asc' } },
        pagos: { where: { estatus: 'VALIDADO' } },
      },
    });
    if (!quote) throw new QuoteDocumentError(404, 'QUOTE_NOT_FOUND', 'No se encontró la cotización.');
    if (!quote.conceptos.length) throw new QuoteDocumentError(409, 'QUOTE_STRUCTURED_BUDGET_REQUIRED', 'Captura y confirma el presupuesto estructurado antes de generar la cotización.');
    if (quote.conceptos.some((row) => row.tratamiento_iva === 'REQUIERE_REVISION')) throw new QuoteDocumentError(409, 'QUOTE_TAX_REVIEW_REQUIRED', 'Revisa el tratamiento fiscal pendiente antes de generar un total definitivo.');
    const organization = await prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { name: true },
    });
    if (!organization) throw new QuoteDocumentError(409, 'QUOTE_ORGANIZATION_MISSING', 'La organización activa no tiene configuración institucional.');
    let resolvedTemplate: Awaited<ReturnType<typeof resolveAdministrativeQuoteTemplate>>;
    try { resolvedTemplate = await resolveAdministrativeQuoteTemplate(prisma, actor.organizationId); }
    catch (error) {
      if (error instanceof AdministrativeQuoteTemplateError) throw new QuoteDocumentError(error.status, error.code.replace('ADMINISTRATIVE_', 'QUOTE_'), error.message);
      throw error;
    }
    const { artifact, version: template, source } = resolvedTemplate;
    const concepts = quote.conceptos.map((row) => ({ concepto: row.concepto, categoria: row.categoria, importeCents: moneyToCents(String(row.importe)),
      tratamiento_iva: row.tratamiento_iva, iva_tasa: row.iva_tasa == null ? null : String(row.iva_tasa) }));
    const data = quoteTemplateData({
      folio: quote.numero_cotizacion || quote.numero_solicitud || quote.id,
      date: new Date(), client: quote.prospecto?.nombre || 'Cliente pendiente',
      act: quote.prospecto?.tipo_acto || 'Acto pendiente', notary: organization.name, concepts,
      validatedAdvanceCents: quote.pagos.reduce((sum, row) => sum + BigInt(Math.round(Number(row.monto) * 100)), 0n),
    });
    let output: Buffer;
    try { output = renderQuoteTemplate(source, data, concepts); }
    catch (error) {
      if (error instanceof QuoteDocumentError) throw error;
      throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_RENDER_FAILED', 'El formato configurado para Cotización no pudo combinarse con los datos estructurados.');
    }
    const checksum = createHash('sha256').update(output).digest('hex');
    const sequence = await prisma.cotizacionDocumento.count({ where: { cotizacion_id: quote.id, tipo_vinculo: 'COTIZACION_GENERADA' } }) + 1;
    const fileName = `${quote.numero_cotizacion || 'Cotizacion'}_Documento_${sequence}.docx`;
    const storageKey = `organizations/${actor.organizationId}/documentos/cotizaciones/${quote.id}/${randomUUID()}_${fileName}`;
    await uploadFile(output, storageKey, DOCX);
    try {
      const persisted = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:quote-document:${actor.organizationId}:${cotizacionId}`}))`);
        if (idempotencyKey) {
          const concurrent = await tx.cotizacionDocumento.findFirst({
            where: { organization_id: actor.organizationId, cotizacion_id: cotizacionId, idempotency_key: idempotencyKey },
            include: { documento: true },
          });
          if (concurrent) return { document: concurrent.documento, discardUpload: true };
        }
        const document = await tx.documento.create({ data: {
          organization_id: actor.organizationId, cotizacion_id: quote.id,
          nombre_original: fileName, nombre_interno: storageKey, storage_key: storageKey,
          tipo: 'COTIZACION_GENERADA', categoria: 'OTROS', mime_type: DOCX, size_bytes: output.length,
          checksum_sha256: checksum, estatus: 'VIGENTE', subido_por_id: actor.id,
          datos_extraidos: { generation: { source: 'CFG-002', artifact_id: artifact.id, artifact_version_id: template.id, artifact_version: template.version, structured_budget_checksum: createHash('sha256').update(JSON.stringify(data)).digest('hex') } },
        } });
        await tx.cotizacionDocumento.create({ data: { organization_id: actor.organizationId, cotizacion_id: quote.id, documento_id: document.id, tipo_vinculo: 'COTIZACION_GENERADA', creado_por_id: actor.id, observaciones: `CFG-002 Cotización · versión ${template.version}`, idempotency_key: idempotencyKey } });
        await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, accion: 'QUOTE_DOCUMENT_GENERATED', entidad: 'Documento', entidad_id: document.id, valores_nuevos: { cotizacion_id: quote.id, template_version_id: template.id, checksum }, session_id: actor.sessionId } });
        return { document, discardUpload: false };
      });
      if (persisted.discardUpload) await deleteFile(storageKey).catch(() => undefined);
      return persisted.document;
    } catch (error) { await deleteFile(storageKey).catch(() => undefined); throw error; }
  }
}

export const quoteDocumentService = new QuoteDocumentService();
