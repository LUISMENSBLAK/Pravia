export interface ExtractedRubro {
  id: string;
  concepto: string;
  nombre_original: string;
  monto: number;
  categoria: string;
}

export interface ExtractionMetadata {
  notaria_detectada?: string;
  notario_titular?: string;
  folio?: string;
  fecha?: string;
}

export interface ExtractionResult {
  rubros: ExtractedRubro[];
  totales: {
    impuestos_derechos: number;
    honorarios: number;
    gastos_terceros: number;
    total_general: number;
  };
  total_notaria: number;
  total_pdf_declarado: number;
  suma_valida: boolean;
  mensaje_validacion: string;
  diferencia_monto: number;
  metadata?: ExtractionMetadata;
  debug?: {
    nombre_archivo: string;
    numero_paginas: number;
    caracteres_extraidos: number;
  };
  error?: string;
}

const SYNONYMS_CATALOG = [
  { concepto: 'Avalúo', category: 'GASTOS_TERCEROS', regex: /aval[uúoˆ”]+|comercial|fiscal/i },
  { concepto: 'Certificados', category: 'IMPUESTOS_DERECHOS', regex: /certificad|clg|libertad.*gravamen|solvencia/i },
  { concepto: 'Impuesto de Transmisión (ISABI)', category: 'IMPUESTOS_DERECHOS', regex: /isabi|transmisi|traslado.*dominio|impuesto.*municipal/i },
  { concepto: 'Derechos de Registro', category: 'IMPUESTOS_DERECHOS', regex: /derecho.*registro|rppyc|registral|inscripci/i },
  { concepto: 'Honorarios Notariales', category: 'HONORARIOS', regex: /honorario/i },
  { concepto: 'Gestoría', category: 'GASTOS_TERCEROS', regex: /gestor/i },
  { concepto: 'Misceláneos', category: 'IMPUESTOS_DERECHOS', regex: /miscel|folio|papeler|varios/i },
  { concepto: 'ISR', category: 'IMPUESTOS_DERECHOS', regex: /isr|impuesto.*renta/i },
  { concepto: 'IVA', category: 'HONORARIOS', regex: /iva|impuesto.*valor.*agregado/i }
];

const BLACKLIST_PATTERNS = [
  /tel[s\.]*|telefono|celular|whatsapp/i,
  /calle|avenida|av\.|colonia|interior|int\.|c\.?p\.?|c[oó]digo\s+postal/i,
  /cuenta|clabe|banco|bbva|banamex|banorte|santander/i,
  /notar[ií]a\s+p[uú]blica\s+no\.?\s*\d+/i,
  /subtotal|sub-total|sub\s+total|suma\s+parcial/i,
  /atentamente|quedamos\s+a\s+sus\s+[oó]rdenes/i,
  /folio\s*:|fecha\s*:/i,
  /lic\.|notario\s+titular/i
];

export const extractPresupuestoData = async (pdfBuffer: Buffer, filename = 'Documento.pdf'): Promise<ExtractionResult> => {
  let rawText = '';
  let numPages = 1;

  try {
    // 1. Digital text extraction with PDFParse
    try {
      const { PDFParse } = require('pdf-parse');
      const instance = new PDFParse({ data: pdfBuffer });
      await instance.load();
      const res = await instance.getText();
      rawText = res?.text || '';
      numPages = res?.total || 1;
    } catch (parseErr: any) {
      console.warn('pdf-parse warning, fallback to raw buffer toString:', parseErr.message);
      rawText = pdfBuffer.toString('utf8');
    }

    console.log(`=== STRICT BOUNDED EXTRACTION [${filename}] (Text Length: ${rawText.length}, Pages: ${numPages}) ===`);

    const allLines = rawText.split(/[\r\n\t]+/).map(l => l.trim()).filter(Boolean);

    // 2. Extract Metadata separately (Notary, Folio, Date)
    const metadata: ExtractionMetadata = {};
    for (const line of allLines) {
      if (!metadata.notaria_detectada && /notar[ií]a\s+p[uú]blica/i.test(line)) {
        metadata.notaria_detectada = line;
      }
      if (!metadata.notario_titular && /notario\s+titular|lic\./i.test(line)) {
        metadata.notario_titular = line;
      }
      if (!metadata.folio && /folio\s*:/i.test(line)) {
        metadata.folio = line;
      }
      if (!metadata.fecha && /fecha\s*:/i.test(line)) {
        metadata.fecha = line;
      }
    }

    // 3. Locate Table Window (Start of table -> TOTAL line)
    let startIdx = 0;
    let endIdx = allLines.length - 1;
    let totalPdfDeclarado = 0;

    // Start Index: first line with known concept or table header
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      if (SYNONYMS_CATALOG.some(s => s.regex.test(line)) || /CONCEPTO|DESGLOSE|GASTOS Y HONORARIOS/i.test(line)) {
        startIdx = i;
        break;
      }
    }

    // End Index: line starting with or containing TOTAL
    for (let i = startIdx; i < allLines.length; i++) {
      const line = allLines[i];
      if (/total\s+(?:del\s+presupuesto|general|notaria|\$)/i.test(line) || /^total/i.test(line)) {
        endIdx = i;
        const matchTotal = line.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|\d+(?:\.\d{2})?)/i);
        if (matchTotal) {
          totalPdfDeclarado = parseFloat(matchTotal[1].replace(/,/g, ''));
        }
        break;
      }
    }

    const tableLines = allLines.slice(startIdx, endIdx);
    const rubros: ExtractedRubro[] = [];
    let idx = 1;

    for (let line of tableLines) {
      // Reject blacklisted non-budget lines
      if (BLACKLIST_PATTERNS.some(b => b.test(line))) {
        continue;
      }

      // Match amount pattern ($10,664.25 or 10,664.25)
      const amountMatch = line.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|\d+(?:\.\d{2})?)/i) ||
                          line.match(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*$/i);

      if (amountMatch) {
        const montoStr = amountMatch[1].replace(/,/g, '');
        const monto = parseFloat(montoStr);

        if (isNaN(monto) || monto <= 0) continue;

        const rawName = line.replace(amountMatch[0], '').replace(/[\$\-\:\_\=]/g, '').trim();
        if (!rawName || /TOTAL/i.test(rawName) || /SUBTOTAL/i.test(rawName) || /VALOR/i.test(rawName)) {
          continue;
        }

        let matchedConcept = rawName;
        let category = 'IMPUESTOS_DERECHOS';

        for (const item of SYNONYMS_CATALOG) {
          if (item.regex.test(rawName)) {
            matchedConcept = item.concepto;
            category = item.category;
            break;
          }
        }

        rubros.push({
          id: String(idx++),
          concepto: matchedConcept,
          nombre_original: rawName,
          monto,
          categoria: category
        });
      }
    }

    const impDerechos = rubros.filter(c => c.categoria === 'IMPUESTOS_DERECHOS').reduce((s, c) => s + c.monto, 0);
    const honorarios = rubros.filter(c => c.categoria === 'HONORARIOS').reduce((s, c) => s + c.monto, 0);
    const gastosTerceros = rubros.filter(c => c.categoria === 'GASTOS_TERCEROS').reduce((s, c) => s + c.monto, 0);
    const totalGeneral = rubros.reduce((s, c) => s + c.monto, 0);

    // 4. Mathematical Validation
    const diff = totalPdfDeclarado > 0 ? Math.abs(totalGeneral - totalPdfDeclarado) : 0;
    const sumaValida = totalPdfDeclarado > 0 ? diff < 0.05 : true;

    let mensajeValidacion = '';
    if (sumaValida) {
      mensajeValidacion = '✓ Extracción validada matemáticamente con éxito';
    } else {
      mensajeValidacion = `La suma de partidas detectadas es $${totalGeneral.toLocaleString('es-MX', { minimumFractionDigits: 2 })}. El total del documento es $${totalPdfDeclarado.toLocaleString('es-MX', { minimumFractionDigits: 2 })} (Diferencia: $${diff.toLocaleString('es-MX', { minimumFractionDigits: 2 })}). Requiere revisión manual.`;
    }

    return {
      rubros,
      totales: {
        impuestos_derechos: Number(impDerechos.toFixed(2)),
        honorarios: Number(honorarios.toFixed(2)),
        gastos_terceros: Number(gastosTerceros.toFixed(2)),
        total_general: Number(totalGeneral.toFixed(2))
      },
      total_notaria: Number(totalGeneral.toFixed(2)),
      total_pdf_declarado: Number(totalPdfDeclarado.toFixed(2)),
      suma_valida: sumaValida,
      mensaje_validacion: mensajeValidacion,
      diferencia_monto: Number(diff.toFixed(2)),
      metadata,
      debug: {
        nombre_archivo: filename,
        numero_paginas: numPages,
        caracteres_extraidos: rawText.length
      }
    };
  } catch (error: any) {
    console.error('Error in extractPresupuestoData:', error);
    return {
      rubros: [],
      totales: { impuestos_derechos: 0, honorarios: 0, gastos_terceros: 0, total_general: 0 },
      total_notaria: 0,
      total_pdf_declarado: 0,
      suma_valida: false,
      mensaje_validacion: 'Error al procesar el archivo PDF: ' + error.message,
      diferencia_monto: 0,
      error: error.message
    };
  }
};
