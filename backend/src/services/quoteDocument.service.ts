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
import { convertDocxToPdf, DocumentConversionError } from './docxPdfConverter.service';
import { deleteFile, downloadFile, uploadFile } from './supabase.service';
import { headFile } from '../storage/storage.service';

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

export type QuoteEconomicMapping = {
  table_index: number;
  detail_row_index: number;
  total_row_index: number;
  label_column: number;
  amount_column: number;
  base_column?: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** A mapping is pinned to an immutable CFG-002 version, never to a filename. */
export function resolveQuoteEconomicMapping(raw: unknown, versionId: string): QuoteEconomicMapping | null {
  const root = asRecord(raw);
  const config = asRecord(root?.quote_economic);
  if (!config) return null;
  if (config.schema_version !== 1) throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_MAPPING_INVALID', 'La versión del mapeo económico no es compatible.');
  const versions = asRecord(config.versions);
  const mapped = asRecord(versions?.[versionId]);
  if (!mapped) throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_MAPPING_VERSION_MISSING', 'Configura el mapeo económico para la versión activa de este formato.');
  const required = ['table_index', 'detail_row_index', 'total_row_index', 'label_column', 'amount_column'] as const;
  if (required.some((key) => !Number.isSafeInteger(mapped[key]) || Number(mapped[key]) < 0)
    || (mapped.base_column !== undefined && (!Number.isSafeInteger(mapped.base_column) || Number(mapped.base_column) < 0))
    || mapped.detail_row_index === mapped.total_row_index
    || mapped.label_column === mapped.amount_column
    || mapped.base_column === mapped.label_column || mapped.base_column === mapped.amount_column) {
    throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_MAPPING_INVALID', 'Revisa los índices de tabla, filas y columnas del mapeo económico.');
  }
  return Object.fromEntries([...required, ...(mapped.base_column === undefined ? [] : ['base_column' as const])].map((key) => [key, mapped[key]])) as QuoteEconomicMapping;
}

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
export function fillStructuredQuoteBudget(documentBuffer: Buffer, concepts: QuoteBudgetConcept[], mapping?: QuoteEconomicMapping | null, data: Record<string, string> = {}) {
  const zip = new PizZip(documentBuffer);
  const file = zip.file('word/document.xml');
  const documentXml = file?.asText();
  if (!documentXml) throw new QuoteDocumentError(422, 'QUOTE_DOCUMENT_XML_MISSING', 'El formato no contiene un documento Word válido.');
  const xmlDoc = new DOMParser().parseFromString(documentXml, 'application/xml');
  const textIn = (element: { getElementsByTagName: (name: string) => ArrayLike<{ textContent: string | null }> }) =>
    Array.from(element.getElementsByTagName('w:t')).map((node) => node.textContent || '').join('').trim();
  const tables = Array.from(xmlDoc.getElementsByTagName('w:tbl'));
  if (mapping) {
    const target = tables[mapping.table_index];
    const targetRows = target && Array.from(target.getElementsByTagName('w:tr'));
    const detail = targetRows?.[mapping.detail_row_index];
    const total = targetRows?.[mapping.total_row_index];
    const detailCells = detail && Array.from(detail.getElementsByTagName('w:tc'));
    const totalCells = total && Array.from(total.getElementsByTagName('w:tc'));
    const limit = Math.max(mapping.label_column, mapping.amount_column, mapping.base_column ?? 0);
    if (!target || !detail || !total || !detailCells || !totalCells || detailCells.length <= limit || totalCells.length <= mapping.amount_column
      || !detailCells[mapping.label_column].getElementsByTagName('w:t').length
      || !detailCells[mapping.amount_column].getElementsByTagName('w:t').length
      || !totalCells[mapping.amount_column].getElementsByTagName('w:t').length
      || detail.parentNode !== total.parentNode || mapping.detail_row_index >= mapping.total_row_index) {
      throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_MAPPING_STRUCTURE_INVALID', 'El mapeo no coincide con las filas y columnas editables de esta versión del machote.');
    }
    const setText = (cell: Element, value: string) => {
      const textNodes = Array.from(cell.getElementsByTagName('w:t'));
      textNodes[0].textContent = value;
      for (const node of textNodes.slice(1)) node.textContent = '';
    };
    const parent = detail.parentNode!;
    const items = concepts.filter((item) => item.categoria !== 'IVA_HONORARIOS');
    const totals = budgetTotals(concepts);
    const entries = items.map((item) => [item.concepto, money(item.importeCents)] as const);
    if (totals.ivaHonorariosCents) entries.push(['IVA sobre honorarios', money(totals.ivaHonorariosCents)]);
    if (totals.ivaOtrosGastosCents) entries.push(['IVA de otros gastos configurados', money(totals.ivaOtrosGastosCents)]);
    for (const [label, amount] of entries) {
      const row = detail.cloneNode(true) as Element;
      const cells = Array.from(row.getElementsByTagName('w:tc'));
      setText(cells[mapping.label_column], label);
      setText(cells[mapping.amount_column], amount);
      if (mapping.base_column !== undefined) setText(cells[mapping.base_column], '');
      parent.insertBefore(row, detail);
    }
    parent.removeChild(detail);
    setText(totalCells[mapping.amount_column], money(quoteStructuredBudget(concepts).totalCents));
    zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc));
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  }
  const sectioned = tables.find((candidate) => {
    const text = textIn(candidate);
    return text.includes('[ESCRIBA EL IMPUESTO O DERECHO]') && text.includes('[ESCRIBA EL CONCEPTO DE HONORARIOS]') && text.includes('TOTAL GENERAL');
  });
  if (sectioned) {
    const rows = Array.from(sectioned.getElementsByTagName('w:tr'));
    const cells = (row: Element) => Array.from(row.getElementsByTagName('w:tc'));
    const find = (label: string) => rows.find((row) => textIn(row).includes(label));
    const taxRow = find('[ESCRIBA EL IMPUESTO O DERECHO]')!;
    const feeRow = find('[ESCRIBA EL CONCEPTO DE HONORARIOS]')!;
    const taxTotal = find('SUBTOTAL IMPUESTOS Y DERECHOS');
    const feeTotal = find('SUBTOTAL HONORARIOS');
    const iva = rows.find((row) => /^IVA\s/i.test(textIn(row)));
    const total = find('TOTAL GENERAL');
    if (!taxTotal || !feeTotal || !iva || !total || [taxRow, feeRow].some((row) => cells(row).length !== 3)) {
      throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_BUDGET_STRUCTURE_MISSING', 'Revisa las filas económicas del presupuesto configurado.');
    }
    const write = (cell: Element, value: string) => {
      const nodes = Array.from(cell.getElementsByTagName('w:t'));
      if (!nodes.length) throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_BUDGET_STRUCTURE_MISSING', 'La celda del presupuesto no contiene texto editable.');
      nodes[0].textContent = value;
      for (const node of nodes.slice(1)) node.textContent = '';
    };
    const details = (model: Element, items: QuoteBudgetConcept[], empty: string) => {
      for (const [index, item] of (items.length ? items : [{ concepto: empty, importeCents: 0n }]).entries()) {
        const row = model.cloneNode(true) as Element;
        const tc = cells(row); write(tc[0], String(index + 1)); write(tc[1], item.concepto); write(tc[2], money(item.importeCents));
        model.parentNode!.insertBefore(row, model);
      }
      model.parentNode!.removeChild(model);
    };
    const totals = budgetTotals(concepts);
    const extras = concepts.filter((row) => row.categoria === 'OTRO_GASTO');
    if (extras.length) {
      const extraModel = feeRow.cloneNode(true) as Element;
      total.parentNode!.insertBefore(extraModel, total);
      details(extraModel, extras, 'Sin otros gastos');
      if (totals.ivaOtrosGastosCents) {
        const extraIva = iva.cloneNode(true) as Element;
        write(cells(extraIva)[0], 'IVA DE OTROS GASTOS'); write(cells(extraIva).at(-1)!, money(totals.ivaOtrosGastosCents));
        total.parentNode!.insertBefore(extraIva, total);
      }
    }
    details(taxRow, concepts.filter((row) => row.categoria === 'IMPUESTOS_DERECHOS'), 'Sin impuestos ni derechos');
    details(feeRow, concepts.filter((row) => row.categoria === 'HONORARIOS'), 'Sin honorarios');
    for (const [row, amount] of [[taxTotal, totals.impuestosDerechosCents], [feeTotal, totals.honorariosCents + totals.ivaHonorariosCents], [iva, totals.ivaHonorariosCents], [total, moneyToCents(totals.total)]] as const) write(cells(row).at(-1)!, money(amount));
    write(cells(iva)[0], 'IVA SOBRE HONORARIOS');
    const territoryRow = rows.find((row) => cells(row).length === 4 && textIn(cells(row)[0]) === 'ESTADO:');
    if (territoryRow) {
      write(cells(territoryRow)[1], data['operacion.estado'] || 'Pendiente');
      write(cells(territoryRow)[3], data['operacion.municipio'] || 'Pendiente');
    }
    const replacements: Record<string, string> = { '[000]': data['cotizacion.folio'] || 'Pendiente', '[DD/MM/AAAA]': data['cotizacion.fecha'] || 'Pendiente', '[TIPO DE ACTO]': data['expediente.acto'] || 'Pendiente', '[NOMBRE DEL ABOGADO]': data['responsable.nombre'] || 'Pendiente', '[NOMBRE / RAZÓN SOCIAL]': data['cliente.nombre'] || 'Pendiente', '[EXPEDIENTE / CLIENTE]': data['cotizacion.folio'] || 'Pendiente', '$[0.00]': 'POR CONFIRMAR', '[0.00]': 'POR CONFIRMAR' };
    // Replace only token spans: collapsing a whole paragraph loses Word line breaks,
    // tabs and run-level formatting (the client's header and bank block use them).
    const replaceSpan = (paragraph: Element, token: string, replacement: string) => {
      const original = Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent || '').join('');
      const positions: number[] = [];
      for (let at = original.indexOf(token); at >= 0; at = original.indexOf(token, at + token.length)) positions.push(at);
      for (const start of positions.reverse()) {
        const end = start + token.length;
        let offset = 0;
        for (const node of Array.from(paragraph.getElementsByTagName('w:t'))) {
          const value = node.textContent || '';
          const next = offset + value.length;
          if (offset < end && next > start) {
            node.textContent = value.slice(0, Math.max(0, start - offset))
              + (offset <= start ? replacement : '') + value.slice(Math.min(value.length, end - offset));
            node.setAttribute('xml:space', 'preserve');
          }
          offset = next;
        }
      }
    };
    for (const paragraph of Array.from(xmlDoc.getElementsByTagName('w:p'))) {
      const original = textIn(paragraph);
      for (const [token, replacement] of Object.entries(replacements)) replaceSpan(paragraph, token, replacement);
      if (/REFERENCIA\/CONCEPTO:\s*(?:CANTIDAD:|$)/.test(original)) replaceSpan(paragraph, 'REFERENCIA/CONCEPTO:', `REFERENCIA/CONCEPTO: ${data['cotizacion.folio'] || 'Pendiente'}`);
      if (/CANTIDAD:\s*\$\s*(?:TITULAR:|$)/.test(original)) replaceSpan(paragraph, 'CANTIDAD: $', `CANTIDAD: $${money(moneyToCents(totals.total))}`);
    }
    zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc));
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  }
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
  responsible?: string; state?: string; municipality?: string;
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
    'responsable.nombre': input.responsible || 'Pendiente',
    'operacion.estado': input.state || 'Pendiente',
    'operacion.municipio': input.municipality || 'Pendiente',
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

export function renderQuoteTemplate(template: Buffer, data: Record<string, string>, concepts: QuoteBudgetConcept[] = [], mapping?: QuoteEconomicMapping | null) {
  const document = new Docxtemplater(new PizZip(template), {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
  });
  document.render(data);
  const rendered = document.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  return fillStructuredQuoteBudget(rendered, concepts, mapping, data);
}

export class QuoteDocumentService {
  async generatePdf(actor: Actor, cotizacionId: string, sourceDocumentId: string) {
    const source = await prisma.documento.findFirst({
      where: { id: sourceDocumentId, organization_id: actor.organizationId, cotizacion_id: cotizacionId,
        tipo: 'COTIZACION_GENERADA', estatus: 'VIGENTE',
        cotizacionVinculos: { some: { organization_id: actor.organizationId, cotizacion_id: cotizacionId, estatus: 'ACTIVO' } } },
    });
    if (!source) throw new QuoteDocumentError(404, 'QUOTE_WORD_NOT_FOUND', 'El Word generado no pertenece a esta cotización.');
    let key = `quote-pdf:${source.id}`;
    let replacesDocumentId: string | null = null;
    let version = 1;
    let storageKey: string | null = null;
    try {
      const findVersion = (candidateKey: string) => prisma.cotizacionDocumento.findFirst({
          where: { organization_id: actor.organizationId, cotizacion_id: cotizacionId, idempotency_key: candidateKey,
            estatus: 'ACTIVO', documento: { estatus: 'VIGENTE' } }, include: { documento: true },
      });
      let latest = await findVersion(key);
      while (latest) {
        const nextKey = `quote-pdf:${source.id}:after:${latest.documento.id}`;
        const next = await findVersion(nextKey);
        if (!next) break;
        if (++version > 20) throw new QuoteDocumentError(409, 'QUOTE_PDF_HISTORY_REVIEW_REQUIRED', 'El historial PDF necesita revisión.');
        latest = next;
      }
      if (latest) {
        const document = latest.documento;
        const bytes = await downloadFile(document.storage_key).catch(async (error: unknown) => {
          // A permission/network error is not evidence of missing storage.
          if (await headFile(document.storage_key)) throw error;
          return null;
        });
        if (bytes) {
          if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-' || bytes.length !== document.size_bytes ||
            (document.checksum_sha256 && createHash('sha256').update(bytes).digest('hex') !== document.checksum_sha256)) {
            throw new QuoteDocumentError(409, 'QUOTE_PDF_INTEGRITY_FAILED', 'El PDF registrado no coincide con su huella. No se sobrescribió el archivo.');
          }
          return document;
        }
        replacesDocumentId = document.id;
        key = `quote-pdf:${source.id}:after:${document.id}`;
        version += 1;
      }
      if (version > 20) throw new QuoteDocumentError(409, 'QUOTE_PDF_HISTORY_REVIEW_REQUIRED', 'El historial PDF necesita revisión antes de crear otra versión.');
      const sourceBytes = await downloadFile(source.storage_key).catch(async (error: unknown) => {
        if (await headFile(source.storage_key)) throw error;
        throw new QuoteDocumentError(409, 'QUOTE_WORD_PHYSICALLY_MISSING', 'El Word original no está disponible. No se puede regenerar este PDF histórico sin su fuente.');
      });
      const originalGeneration = asRecord(asRecord(source.datos_extraidos)?.generation) || {};
      if (replacesDocumentId && (!source.checksum_sha256 || typeof originalGeneration.artifact_version_id !== 'string' ||
        typeof originalGeneration.structured_budget_checksum !== 'string')) {
        throw new QuoteDocumentError(409, 'QUOTE_WORD_PROVENANCE_REQUIRED', 'Falta la procedencia del Word histórico. No se regeneró el PDF.');
      }
      if ((source.size_bytes !== null && sourceBytes.length !== source.size_bytes) ||
        (source.checksum_sha256 && createHash('sha256').update(sourceBytes).digest('hex') !== source.checksum_sha256)) {
        throw new QuoteDocumentError(409, 'QUOTE_WORD_INTEGRITY_FAILED', 'El Word generado no coincide con su huella registrada.');
      }
      const pdf = await convertDocxToPdf(sourceBytes);
      const checksum = createHash('sha256').update(pdf).digest('hex');
      const name = source.nombre_original.replace(/\.docx$/i, version > 1 ? `_PDF_v${version}.pdf` : '.pdf');
      storageKey = `organizations/${actor.organizationId}/documentos/cotizaciones/${cotizacionId}/${randomUUID()}_${name}`;
      await uploadFile(pdf, storageKey, 'application/pdf');
      const persistedBytes = await downloadFile(storageKey);
      if (persistedBytes.length !== pdf.length || createHash('sha256').update(persistedBytes).digest('hex') !== checksum) {
        throw new QuoteDocumentError(503, 'QUOTE_PDF_STORAGE_UNVERIFIED', 'El almacenamiento no confirmó el PDF íntegro. El Word permanece disponible para reintentar.');
      }
      const created = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:quote-pdf:${actor.organizationId}:${source.id}`}))`);
        const concurrent = await tx.cotizacionDocumento.findFirst({
          where: { organization_id: actor.organizationId, cotizacion_id: cotizacionId, idempotency_key: key,
            estatus: 'ACTIVO', documento: { estatus: 'VIGENTE' } }, include: { documento: true },
        });
        if (concurrent) return { document: concurrent.documento, discardUpload: true };
        const document = await tx.documento.create({ data: {
          organization_id: actor.organizationId, cotizacion_id: cotizacionId, nombre_original: name,
          nombre_interno: storageKey!, storage_key: storageKey!, tipo: 'COTIZACION_GENERADA_PDF', categoria: 'OTROS',
          mime_type: 'application/pdf', size_bytes: pdf.length, checksum_sha256: checksum,
          estatus: 'VIGENTE', subido_por_id: actor.id,
          datos_extraidos: { generation: { ...originalGeneration, source_document_id: source.id,
            source_checksum_sha256: source.checksum_sha256, derived_format: 'PDF', converter: 'LibreOffice Writer',
            pdf_version: version, replaces_missing_pdf_document_id: replacesDocumentId } },
        } });
        await tx.cotizacionDocumento.create({ data: { organization_id: actor.organizationId, cotizacion_id: cotizacionId,
          documento_id: document.id, tipo_vinculo: 'COTIZACION_GENERADA_PDF', creado_por_id: actor.id,
          observaciones: `PDF derivado del Word ${source.nombre_original}`, idempotency_key: key } });
        await tx.documento.update({ where: { id: source.id }, data: { datos_extraidos: {
          ...asRecord(source.datos_extraidos), generation: { ...originalGeneration, pdf_status: 'READY', pdf_document_id: document.id },
        } as Prisma.InputJsonValue } });
        await tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id,
          accion: 'QUOTE_PDF_GENERATED', entidad: 'Documento', entidad_id: document.id,
          valores_nuevos: { cotizacion_id: cotizacionId, source_document_id: source.id, pdf_sha256: checksum,
            pdf_version: version, replaces_missing_pdf_document_id: replacesDocumentId },
          session_id: actor.sessionId } });
        return { document, discardUpload: false };
      });
      if (created.discardUpload) await deleteFile(storageKey).catch(() => undefined);
      return created.document;
    } catch (error) {
      if (storageKey) await deleteFile(storageKey).catch(() => undefined);
      const code = error instanceof DocumentConversionError || error instanceof QuoteDocumentError ? error.code : 'PDF_CONVERSION_FAILED';
      await prisma.documento.updateMany({ where: { id: source.id, organization_id: actor.organizationId,
        datos_extraidos: { equals: source.datos_extraidos === null ? Prisma.DbNull : source.datos_extraidos } }, data: {
        datos_extraidos: { ...asRecord(source.datos_extraidos), generation: {
          ...asRecord(asRecord(source.datos_extraidos)?.generation), pdf_status: 'ERROR', pdf_error_code: code,
        } } as Prisma.InputJsonValue,
      } }).catch(() => undefined);
      if (error instanceof QuoteDocumentError) throw error;
      if (error instanceof DocumentConversionError) throw new QuoteDocumentError(
        error.code === 'PDF_CONVERTER_UNAVAILABLE' || error.code === 'PDF_CONVERSION_BUSY' ? 503 : 422,
        error.code, error.message,
      );
      throw new QuoteDocumentError(500, 'QUOTE_PDF_GENERATION_FAILED', 'No fue posible generar el PDF. El Word permanece disponible para reintentar.');
    }
  }

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
        creada_por: { select: { nombre: true, apellido: true } },
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
      responsible: [quote.creada_por?.nombre, quote.creada_por?.apellido].filter(Boolean).join(' '),
      state: quote.territorio_operacion && typeof quote.territorio_operacion === 'object' && !Array.isArray(quote.territorio_operacion)
        ? String(quote.territorio_operacion.state || '') : '',
      municipality: quote.territorio_operacion && typeof quote.territorio_operacion === 'object' && !Array.isArray(quote.territorio_operacion)
        ? String(quote.territorio_operacion.municipality || '') : '',
      validatedAdvanceCents: quote.pagos.reduce((sum, row) => sum + BigInt(Math.round(Number(row.monto) * 100)), 0n),
    });
    let output: Buffer;
    try { output = renderQuoteTemplate(source, data, concepts, resolveQuoteEconomicMapping(resolvedTemplate.mapping, template.id)); }
    catch (error) {
      if (error instanceof QuoteDocumentError) throw error;
      throw new QuoteDocumentError(422, 'QUOTE_TEMPLATE_RENDER_FAILED', 'El formato configurado para Cotización no pudo combinarse con los datos estructurados.');
    }
    const checksum = createHash('sha256').update(output).digest('hex');
    const sequence = await prisma.cotizacionDocumento.count({ where: { cotizacion_id: quote.id, tipo_vinculo: 'COTIZACION_GENERADA' } }) + 1;
    const fileName = `${quote.numero_cotizacion || 'Cotizacion'}_Documento_${sequence}.docx`;
    const storageKey = `organizations/${actor.organizationId}/documentos/cotizaciones/${quote.id}/${randomUUID()}_${fileName}`;
    try {
      await uploadFile(output, storageKey, DOCX);
      const persistedBytes = await downloadFile(storageKey);
      if (persistedBytes.length !== output.length || createHash('sha256').update(persistedBytes).digest('hex') !== checksum) {
        throw new QuoteDocumentError(503, 'QUOTE_WORD_STORAGE_UNVERIFIED', 'El almacenamiento no confirmó el Word íntegro. Reintenta la generación.');
      }
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
          datos_extraidos: { generation: { source: 'CFG-002', artifact_id: artifact.id, artifact_version_id: template.id, artifact_version: template.version, mapping_checksum: resolvedTemplate.mapping ? createHash('sha256').update(JSON.stringify(resolvedTemplate.mapping)).digest('hex') : null, structured_budget_checksum: createHash('sha256').update(JSON.stringify(data)).digest('hex'), pdf_status: 'PENDING' } },
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
