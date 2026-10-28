import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type PrefacturaSnapshot = {
  folio: string;
  version: number;
  generated_at: string;
  emitter: { name: string; rfc: string; regimen: string; postal_code: string };
  receiver: { name: string; rfc: string; regimen: string; postal_code: string; uso_cfdi: string };
  currency: string;
  exchange_rate: string | null;
  equivalent_mxn: string | null;
  payment: { method: string; form: string; terms: string | null };
  export_code: string | null;
  issue_place: string;
  concepts: Array<{ description: string; product_code: string; unit_code: string; quantity: string; unit_price: string; subtotal: string; transferred: string; retained: string; total: string }>;
  amounts: { subtotal: string; transferred: string; retained: string; total: string };
};

const navy = rgb(0.035, 0.102, 0.184);
const gold = rgb(0.74, 0.56, 0.25);
const ink = rgb(0.13, 0.19, 0.27);
const muted = rgb(0.34, 0.39, 0.45);
const paper = rgb(0.97, 0.975, 0.985);

// Standard PDF fonts use WinAnsi; normalize unsupported glyphs without
// changing the persisted source snapshot.
const printable = (value: unknown) => String(value ?? '—').replace(/[\u2011\u2013]/g, '—').replace(/[^\u0009\u000A\u000D\u0020-\u00FF\u2018\u2019\u201C\u201D\u2014\u2022]/g, '?');
const money = (value: string, currency: string) => `${Number(value).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export async function renderPrefacturaPdf(snapshot: PrefacturaSnapshot): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Prefactura ${snapshot.folio} v${snapshot.version}`);
  pdf.setSubject('PREFACTURA — DOCUMENTO SIN VALIDEZ FISCAL');
  pdf.setProducer('PRAVIA OS');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 46;
  const width = pageSize[0] - margin * 2;
  let page: PDFPage;
  let y = 0;
  let pageNumber = 0;

  const startPage = () => {
    page = pdf.addPage(pageSize);
    pageNumber += 1;
    page.drawRectangle({ x: 0, y: pageSize[1] - 87, width: pageSize[0], height: 87, color: navy });
    page.drawText('PRAVIA OS', { x: margin, y: pageSize[1] - 40, size: 17, font: bold, color: rgb(1, 1, 1) });
    page.drawText('PREFACTURA — DOCUMENTO SIN VALIDEZ FISCAL', { x: margin, y: pageSize[1] - 64, size: 10, font: bold, color: rgb(1, 0.88, 0.63) });
    page.drawRectangle({ x: 0, y: pageSize[1] - 91, width: pageSize[0], height: 4, color: gold });
    page.drawText(`Documento de trabajo · página ${pageNumber}`, { x: margin, y: 26, size: 8, font: regular, color: muted });
    y = pageSize[1] - 116;
  };
  const ensure = (height: number) => { if (y - height < 54) startPage(); };
  const wrap = (value: string, font: PDFFont, size: number, maxWidth: number) => {
    const words = printable(value).split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
        let count = line.length - 1;
        while (count > 1 && font.widthOfTextAtSize(line.slice(0, count), size) > maxWidth) count -= 1;
        lines.push(line.slice(0, count));
        line = line.slice(count);
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : ['—'];
  };
  const text = (value: string, size = 10, font = regular, color = ink, indent = 0) => {
    for (const line of wrap(value, font, size, width - indent)) {
      ensure(size + 7);
      page.drawText(line, { x: margin + indent, y, size, font, color });
      y -= size + 6;
    }
  };
  const heading = (label: string) => {
    ensure(36);
    y -= 8;
    page.drawRectangle({ x: margin, y: y - 4, width, height: 25, color: paper });
    page.drawRectangle({ x: margin, y: y - 4, width: 3, height: 25, color: gold });
    page.drawText(printable(label), { x: margin + 11, y: y + 4, size: 10, font: bold, color: navy });
    y -= 34;
  };
  const field = (label: string, value: string) => { text(`${label}: ${value || 'Pendiente'}`, 9); };

  startPage();
  text(`${snapshot.folio}  ·  v${snapshot.version}`, 16, bold, navy);
  field('Fecha de generación', new Date(snapshot.generated_at).toLocaleString('es-MX', { timeZone: 'UTC' }) + ' UTC');
  heading('EMISOR');
  field('Nombre / razón social', snapshot.emitter.name);
  field('RFC', snapshot.emitter.rfc);
  field('Régimen fiscal', snapshot.emitter.regimen);
  field('CP fiscal', snapshot.emitter.postal_code);
  heading('RECEPTOR');
  field('Nombre / razón social', snapshot.receiver.name);
  field('RFC', snapshot.receiver.rfc);
  field('Régimen fiscal elegido', snapshot.receiver.regimen);
  field('CP fiscal', snapshot.receiver.postal_code);
  field('Uso CFDI', snapshot.receiver.uso_cfdi);
  heading('COMPROBANTE');
  field('Moneda', snapshot.currency);
  if (snapshot.exchange_rate) field('Tipo de cambio confirmado', snapshot.exchange_rate);
  if (snapshot.equivalent_mxn) field('Equivalente informativo MXN', money(snapshot.equivalent_mxn, 'MXN'));
  field('Método / forma de pago', `${snapshot.payment.method} / ${snapshot.payment.form}`);
  if (snapshot.payment.terms) field('Condiciones', snapshot.payment.terms);
  if (snapshot.export_code) field('Exportación', snapshot.export_code);
  field('Lugar de expedición (CP)', snapshot.issue_place);
  heading('CONCEPTOS');
  for (const [index, concept] of snapshot.concepts.entries()) {
    ensure(72);
    text(`${index + 1}. ${concept.description}`, 10, bold);
    text(`SAT ${concept.product_code} · Unidad ${concept.unit_code} · Cantidad ${concept.quantity} · Precio unitario ${money(concept.unit_price, snapshot.currency)}`, 8, regular, muted, 9);
    text(`Base ${money(concept.subtotal, snapshot.currency)} · Traslados ${money(concept.transferred, snapshot.currency)} · Retenciones ${money(concept.retained, snapshot.currency)} · Total ${money(concept.total, snapshot.currency)}`, 8, regular, muted, 9);
    y -= 5;
  }
  heading('RESUMEN');
  field('Subtotal', money(snapshot.amounts.subtotal, snapshot.currency));
  field('Impuestos trasladados', money(snapshot.amounts.transferred, snapshot.currency));
  field('Impuestos retenidos', money(snapshot.amounts.retained, snapshot.currency));
  text(`TOTAL  ${money(snapshot.amounts.total, snapshot.currency)}`, 13, bold, navy);
  y -= 13;
  text('PREFACTURA — DOCUMENTO SIN VALIDEZ FISCAL', 10, bold, gold);
  text('No contiene UUID, sello digital, QR fiscal ni certificación del SAT. No sustituye un CFDI timbrado.', 8, regular, muted);
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
