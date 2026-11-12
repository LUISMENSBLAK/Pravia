import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import PizZip from 'pizzip';
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { PrefacturaSnapshot } from '../domain/prefacturaPdf';

// Repository copy of the client's approved template, with author metadata removed.
const TEMPLATE_SHA256 = '93c7eeac20182e9c75cf21561089dc65becbd1fee037e156af1549bec3e0f9b3';
const TEMPLATE_PATH = path.resolve(__dirname, '../../assets/fiscal/Factura_PRAVIA.docx');
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export class ClientInvoiceTemplateError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function textNodes(paragraph: Element): Element[] {
  return Array.from(paragraph.getElementsByTagNameNS(WORD_NS, 't'));
}

function allText(node: Element): string {
  return Array.from(node.getElementsByTagNameNS(WORD_NS, 't')).map((item) => item.textContent || '').join('');
}

/** Replace a marker across Word runs without replacing the containing paragraph/table. */
function replaceParagraphMarkers(paragraph: Element, values: Record<string, string>) {
  const nodes = textNodes(paragraph);
  const raw = nodes.map((node) => node.textContent || '').join('');
  const matches = Array.from(raw.matchAll(/\{\{([A-Z0-9_]+)\}\}/g));
  for (const match of matches.reverse()) {
    const replacement = values[match[1]] ?? '';
    const from = match.index;
    const to = from + match[0].length;
    let offset = 0;
    let first = -1;
    let last = -1;
    let firstOffset = 0;
    let lastOffset = 0;
    nodes.forEach((node, index) => {
      const length = (node.textContent || '').length;
      if (first < 0 && from >= offset && from < offset + length) { first = index; firstOffset = from - offset; }
      if (last < 0 && to > offset && to <= offset + length) { last = index; lastOffset = to - offset; }
      offset += length;
    });
    if (first < 0 || last < 0) throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_MARKER_INVALID', `Marcador ${match[1]} mal formado.`);
    const before = (nodes[first].textContent || '').slice(0, firstOffset);
    const after = (nodes[last].textContent || '').slice(lastOffset);
    nodes[first].textContent = before + replacement + (first === last ? after : '');
    if (first !== last) {
      for (let index = first + 1; index < last; index += 1) nodes[index].textContent = '';
      nodes[last].textContent = after;
    }
    nodes[first].setAttribute('xml:space', 'preserve');
  }
}

function replaceMarkers(root: Element, values: Record<string, string>) {
  Array.from(root.getElementsByTagNameNS(WORD_NS, 'p')).forEach((paragraph) => replaceParagraphMarkers(paragraph, values));
}

function replaceLiteral(root: Element, find: string, replacement: string) {
  for (const node of Array.from(root.getElementsByTagNameNS(WORD_NS, 't'))) {
    if (node.textContent?.includes(find)) node.textContent = node.textContent.split(find).join(replacement);
  }
}

function usePortableInvoiceFonts(doc: Document) {
  // The template requests Aptos, unavailable on the headless worker. LibreOffice's
  // implicit fallback can render numbers with incorrect Unicode mappings in PDF.
  // Use an installed sans-serif on this derivative; never change the source DOCX.
  for (const font of Array.from(doc.getElementsByTagNameNS(WORD_NS, 'rFonts'))) {
    for (const slot of ['ascii', 'hAnsi', 'eastAsia', 'cs']) {
      if (font.getAttributeNS(WORD_NS, slot) === 'Aptos') {
        font.setAttributeNS(WORD_NS, `w:${slot}`, 'Liberation Sans');
      }
    }
  }
}

function removeNode(node: Node) { node.parentNode?.removeChild(node); }

function directChildren(parent: Element, tag: string): Element[] {
  return Array.from(parent.childNodes).filter((child): child is Element => child.nodeType === 1 && (child as Element).tagName === tag);
}

function keepWithNext(doc: Document, paragraph: Element) {
  const properties = directChildren(paragraph, 'w:pPr')[0] || doc.createElementNS(WORD_NS, 'w:pPr');
  if (!properties.parentNode) paragraph.insertBefore(properties, paragraph.firstChild);
  let keep = directChildren(properties, 'w:keepNext')[0];
  if (!keep) {
    keep = doc.createElementNS(WORD_NS, 'w:keepNext');
    const style = directChildren(properties, 'w:pStyle')[0];
    properties.insertBefore(keep, style ? style.nextSibling : properties.firstChild);
  }
  keep.setAttributeNS(WORD_NS, 'w:val', '1');
}

function conceptValues(concept: PrefacturaSnapshot['concepts'][number]): Record<string, string> {
  return {
    CLAVE_SAT: concept.product_code, DESCRIPCION_LIBRE: concept.description,
    Q: concept.quantity, UN: concept.unit_code, PU: concept.unit_price,
    D: concept.discount || '', IMPORTE: concept.subtotal,
    CLAVE_UNIDAD: concept.unit_code, OBJETO_IMP: concept.tax_object || '',
    NO_IDENTIFICACION: concept.identification || '',
  };
}

function expandConceptRows(doc: Document, snapshot: PrefacturaSnapshot) {
  const tables = Array.from(doc.getElementsByTagNameNS(WORD_NS, 'tbl'));
  const conceptTable = tables.find((table) => allText(table).includes('{{DESCRIPCION_LIBRE}}'));
  if (!conceptTable) throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_CONCEPT_ROW_MISSING', 'El machote no contiene una fila de conceptos.');
  const rows = directChildren(conceptTable, 'w:tr');
  const templateRow = rows.find((row) => allText(row).includes('{{DESCRIPCION_LIBRE}}'));
  if (!templateRow) throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_CONCEPT_ROW_MISSING', 'La fila de conceptos no es repetible.');
  const renderedRows: Element[] = [];
  for (const concept of snapshot.concepts) {
    const row = templateRow.cloneNode(true) as Element;
    replaceMarkers(row, conceptValues(concept));
    templateRow.parentNode!.insertBefore(row, templateRow);
    renderedRows.push(row);
  }
  removeNode(templateRow);
  // Keep the final concepts with the adjacent totals block so a dense invoice
  // does not strand only its totals on an otherwise blank following page.
  for (const row of renderedRows.slice(-3)) {
    for (const paragraph of Array.from(row.getElementsByTagNameNS(WORD_NS, 'p'))) keepWithNext(doc, paragraph);
  }
  // The original single-concept detail block cannot truthfully describe several
  // independent lines. Keep the per-line SAT keys in the repeated table instead.
  const detail = tables.find((table) => allText(table).includes('DETALLE DEL CONCEPTO:'));
  if (detail) removeNode(detail);
  // Chain through the tax/totals rows and their spacers, not only the first
  // spacer. A break inside that table can otherwise leave only totals behind.
  const closingBlocks: Element[] = [];
  for (let sibling = conceptTable.nextSibling; sibling; sibling = sibling.nextSibling) {
    if (sibling.nodeType !== 1) continue;
    const block = sibling as Element;
    if (block.tagName === 'w:tbl' && allText(block).includes('{{TOTAL_EN_LETRA}}')) {
      for (const preceding of closingBlocks) {
        if (preceding.tagName === 'w:p') keepWithNext(doc, preceding);
        if (preceding.tagName === 'w:tbl') {
          for (const paragraph of Array.from(preceding.getElementsByTagNameNS(WORD_NS, 'p'))) keepWithNext(doc, paragraph);
        }
      }
      break;
    }
    closingBlocks.push(block);
  }
}

function removeFiscalStamping(doc: Document) {
  const tables = Array.from(doc.getElementsByTagNameNS(WORD_NS, 'tbl'));
  const first = tables.findIndex((table) => allText(table).includes('TIMBRADO Y VALIDACIÓN SAT'));
  if (first < 0) throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_STAMP_BLOCK_MISSING', 'El bloque de timbrado del machote cambió.');
  for (const table of tables.slice(first)) if (table.parentNode?.nodeName === 'w:body') removeNode(table);
  for (const paragraph of Array.from(doc.getElementsByTagNameNS(WORD_NS, 'p'))) {
    const content = allText(paragraph);
    if (content.includes('DATOS ESPECIALES') || content.includes('REPRESENTACIÓN IMPRESA DE UN CFDI')) removeNode(paragraph);
  }
}

function removeOriginalLogo(doc: Document) {
  // The customer's example logo is not the issuer's logo. Remove its drawing;
  // a tenant-scoped logo is inserted only after explicit configuration.
  const drawings = Array.from(doc.getElementsByTagNameNS(WORD_NS, 'drawing'));
  for (const drawing of drawings) {
    const blips = Array.from(drawing.getElementsByTagName('a:blip'));
    if (blips.some((blip) => blip.getAttribute('r:embed') === 'rId9')) removeNode(drawing);
  }
}

function pruneExampleImages(zip: PizZip, hasIssuerLogo: boolean, documentXml: string) {
  if (documentXml.includes('r:embed="rId10"')) {
    throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_SAMPLE_QR_REMAINS', 'La imagen de ejemplo de timbrado no fue retirada.');
  }
  if (!hasIssuerLogo && documentXml.includes('r:embed="rId9"')) {
    throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_EXAMPLE_LOGO_REMAINS', 'El logotipo de ejemplo no fue retirado.');
  }
  const rels = zip.file('word/_rels/document.xml.rels');
  if (!rels) throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_RELATIONS_MISSING', 'Faltan las relaciones del machote.');
  const relDoc = new DOMParser().parseFromString(rels.asText(), 'text/xml');
  for (const relation of Array.from(relDoc.getElementsByTagName('Relationship'))) {
    if (relation.getAttribute('Id') === 'rId10' || (!hasIssuerLogo && relation.getAttribute('Id') === 'rId9')) removeNode(relation);
  }
  zip.file('word/_rels/document.xml.rels', new XMLSerializer().serializeToString(relDoc));
  zip.remove('word/media/image2.png');
  if (!hasIssuerLogo) zip.remove('word/media/image1.png');
}

export async function validateFiscalLogoImage(bytes: Buffer, mimeType: string) {
  const png = mimeType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = mimeType === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if ((!png && !jpeg) || bytes.length < 100 || bytes.length > 2 * 1024 * 1024) {
    throw new ClientInvoiceTemplateError('INVOICE_LOGO_INVALID', 'El logotipo debe ser PNG o JPG válido y no exceder 2 MB.');
  }
  let image: Awaited<ReturnType<typeof loadImage>>;
  try { image = await loadImage(bytes); }
  catch { throw new ClientInvoiceTemplateError('INVOICE_LOGO_INVALID', 'No se pudo leer la imagen del logotipo.'); }
  if (image.width < 32 || image.height < 32 || image.width > 4096 || image.height > 4096) {
    throw new ClientInvoiceTemplateError('INVOICE_LOGO_DIMENSIONS_INVALID', 'El logotipo debe medir entre 32 y 4096 píxeles por lado.');
  }
  return { width: image.width, height: image.height };
}

async function replaceLogo(doc: Document, zip: PizZip, bytes: Buffer, mimeType: string) {
  await validateFiscalLogoImage(bytes, mimeType);
  const source = await loadImage(bytes);
  const canvas = createCanvas(512, 512);
  const context = canvas.getContext('2d');
  // Keep the artwork clear of the adjacent issuer name in the original header.
  // Padding is inside the existing image region; the Word layout stays intact.
  const scale = Math.min(416 / source.width, 416 / source.height);
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  context.drawImage(source, (512 - width) / 2, (512 - height) / 2, width, height);
  zip.file('word/media/image1.png', await canvas.encode('png'));
  const drawings = Array.from(doc.getElementsByTagNameNS(WORD_NS, 'drawing'));
  if (!drawings.some((drawing) => Array.from(drawing.getElementsByTagName('a:blip'))
    .some((blip) => blip.getAttribute('r:embed') === 'rId9'))) {
    throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_LOGO_REGION_MISSING', 'No existe la región gráfica del logotipo en el machote.');
  }
}

function removeOptionalFields(doc: Document, snapshot: PrefacturaSnapshot) {
  const blankMarkers = new Set<string>();
  // The current issuer master stores postal code, not a confirmed street address.
  // Do not leave an empty address label suggesting that one was verified.
  blankMarkers.add('EMISOR_DOMICILIO');
  if (!snapshot.export_code) blankMarkers.add('EXPORTACION');
  if (!snapshot.exchange_rate) blankMarkers.add('TIPO_CAMBIO');
  if (!snapshot.payment.terms) blankMarkers.add('CONDICIONES_PAGO');
  if (!snapshot.expediente_reference) blankMarkers.add('REFERENCIA_EXPEDIENTE');
  blankMarkers.add('NUMERO_ESCRITURA');
  blankMarkers.add('CFDI_RELACIONADOS');
  if (!snapshot.amounts.discount) blankMarkers.add('DESCTO');
  blankMarkers.add('IMPUESTOS_LOCALES');
  blankMarkers.add('IMP_OTROS');
  for (const table of Array.from(doc.getElementsByTagNameNS(WORD_NS, 'tbl'))) {
    for (const row of directChildren(table, 'w:tr')) {
      const rowText = allText(row);
      if (table.parentNode?.nodeName === 'w:tc' &&
          (rowText.includes('{{DESCTO}}') || rowText.includes('{{IMP_OTROS}}')) &&
          [...blankMarkers].some((marker) => rowText.includes(`{{${marker}}}`))) {
        removeNode(row);
        continue;
      }
      for (const cell of directChildren(row, 'w:tc')) {
        const paragraphs = directChildren(cell, 'w:p');
        const cellText = paragraphs.map(allText).join('');
        if (![...blankMarkers].some((marker) => cellText.includes(`{{${marker}}}`))) continue;
        for (const paragraph of paragraphs) {
          if ([...blankMarkers].some((marker) => allText(paragraph).includes(`{{${marker}}}`))) removeNode(paragraph);
        }
      }
    }
  }
}

function addCurrencyNote(doc: Document, snapshot: PrefacturaSnapshot) {
  if (!snapshot.equivalent_mxn || !snapshot.exchange_rate) return;
  const amountTable = Array.from(doc.getElementsByTagNameNS(WORD_NS, 'tbl'))
    .find((table) => allText(table).includes('IMPORTE CON LETRA:'));
  if (!amountTable?.parentNode) return;
  const paragraph = doc.createElementNS(WORD_NS, 'w:p');
  const run = doc.createElementNS(WORD_NS, 'w:r');
  const text = doc.createElementNS(WORD_NS, 'w:t');
  text.textContent = `Equivalente informativo: ${Number(snapshot.equivalent_mxn).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN (tipo de cambio ${snapshot.exchange_rate}).`;
  run.appendChild(text);
  paragraph.appendChild(run);
  amountTable.parentNode.insertBefore(paragraph, amountTable.nextSibling);
}

export async function renderClientPrefacturaDocx(snapshot: PrefacturaSnapshot, logo?: { bytes: Buffer; mimeType: string }, sourceDocx?: Buffer): Promise<{ bytes: Buffer; templateSha256: string }> {
  const original = sourceDocx || await readFile(TEMPLATE_PATH);
  const hash = createHash('sha256').update(original).digest('hex');
  if (!sourceDocx && hash !== TEMPLATE_SHA256) throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_HASH_MISMATCH', 'El machote original no coincide con la versión aprobada.');
  if (original.length > 10 * 1024 * 1024) throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_TOO_LARGE', 'La versión del machote excede el límite de seguridad de 10 MiB.');
  let zip: PizZip;
  try { zip = new PizZip(original); }
  catch { throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_INVALID', 'La versión configurada no es un DOCX válido.'); }
  const main = zip.file('word/document.xml');
  if (!main) throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_INVALID', 'Falta la estructura Word del machote.');
  const doc = new DOMParser().parseFromString(main.asText(), 'text/xml');
  usePortableInvoiceFonts(doc);
  removeFiscalStamping(doc);
  if (logo) await replaceLogo(doc, zip, logo.bytes, logo.mimeType);
  else removeOriginalLogo(doc);
  expandConceptRows(doc, snapshot);
  removeOptionalFields(doc, snapshot);
  addCurrencyNote(doc, snapshot);
  const generatedAt = new Date(snapshot.generated_at);
  if (Number.isNaN(generatedAt.getTime())) throw new ClientInvoiceTemplateError('INVOICE_TIMESTAMP_INVALID', 'La fecha del borrador no es válida.');
  const displayDate = `${new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(generatedAt)} UTC`;
  const values: Record<string, string> = {
    TIPO_COMPROBANTE: 'I — Ingreso (borrador)', SERIE: '', FOLIO: snapshot.folio,
    UUID: 'SIN TIMBRAR', FECHA_EMISION: displayDate, LUGAR_EXPEDICION: snapshot.issue_place,
    EMISOR_NOMBRE: snapshot.emitter.name, EMISOR_RFC: snapshot.emitter.rfc, EMISOR_REGIMEN: snapshot.emitter.regimen,
    EMISOR_DOMICILIO: '', RECEPTOR_NOMBRE: snapshot.receiver.name, RECEPTOR_RFC: snapshot.receiver.rfc,
    RECEPTOR_REGIMEN: snapshot.receiver.regimen, RECEPTOR_CP: snapshot.receiver.postal_code,
    USO_CFDI: snapshot.receiver.uso_cfdi, EXPORTACION: snapshot.export_code || '', MONEDA: snapshot.currency,
    TIPO_CAMBIO: snapshot.exchange_rate || '', METODO_PAGO: snapshot.payment.method,
    FORMA_PAGO: snapshot.payment.form, CONDICIONES_PAGO: snapshot.payment.terms || '',
    REFERENCIA_EXPEDIENTE: snapshot.expediente_reference || '', NUMERO_ESCRITURA: '',
    TIPO_RELACION: '', CFDI_RELACIONADOS: '', TRASLADOS_POR_TASA: snapshot.amounts.transferred,
    RETENCIONES_POR_IMPUESTO: snapshot.amounts.retained, IMPUESTOS_LOCALES: '',
    SUBTOTAL: snapshot.amounts.subtotal, DESCTO: snapshot.amounts.discount || '',
    IMP_TRAS: snapshot.amounts.transferred, IMP_RET: snapshot.amounts.retained,
    IMP_OTROS: '', TOTAL: snapshot.amounts.total, TOTAL_EN_LETRA: snapshot.total_in_words || '',
  };
  replaceMarkers(doc.documentElement!, values);
  replaceLiteral(doc.documentElement!, 'PRAVIA', snapshot.emitter.name);
  replaceLiteral(doc.documentElement!, 'LEGAL PATRIMONIAL GROUP', '');
  replaceLiteral(doc.documentElement!, 'FACTURA ELECTRÓNICA', 'PREFACTURA — SIN VALIDEZ FISCAL');
  replaceLiteral(doc.documentElement!, 'VALORES DEL XML', 'DATOS DEL BORRADOR');
  replaceLiteral(doc.documentElement!, 'FILAS DINÁMICAS · AGREGAR SEGÚN XML', 'CONCEPTOS DEL BORRADOR');
  replaceLiteral(doc.documentElement!, 'FOLIO FISCAL / UUID', 'ESTADO DEL DOCUMENTO');
  const output = new XMLSerializer().serializeToString(doc);
  if (/\{\{[A-Z0-9_]+\}\}/.test(output)) throw new ClientInvoiceTemplateError('INVOICE_TEMPLATE_UNRESOLVED', 'El machote conserva campos sin resolver.');
  pruneExampleImages(zip, Boolean(logo), output);
  zip.file('word/document.xml', output);
  const footer = zip.file('word/footer1.xml');
  if (footer) {
    const footerDoc = new DOMParser().parseFromString(footer.asText(), 'text/xml');
    usePortableInvoiceFonts(footerDoc);
    replaceLiteral(footerDoc.documentElement!, 'PRAVIA OS', snapshot.emitter.name);
    replaceLiteral(footerDoc.documentElement!, 'FACTURA ELECTRÓNICA', 'PREFACTURA — SIN VALIDEZ FISCAL');
    replaceLiteral(footerDoc.documentElement!, 'FACTURACIÓN ELECTRÓNICA', 'PREFACTURA — SIN VALIDEZ FISCAL');
    replaceLiteral(footerDoc.documentElement!, 'INFORMACIÓN FISCAL GENERADA A PARTIR DEL XML CERTIFICADO', 'DOCUMENTO DE REVISIÓN SIN TIMBRADO');
    zip.file('word/footer1.xml', new XMLSerializer().serializeToString(footerDoc));
  }
  const styles = zip.file('word/styles.xml');
  if (styles) {
    const stylesDoc = new DOMParser().parseFromString(styles.asText(), 'text/xml');
    usePortableInvoiceFonts(stylesDoc);
    zip.file('word/styles.xml', new XMLSerializer().serializeToString(stylesDoc));
  }
  return { bytes: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }), templateSha256: hash };
}
