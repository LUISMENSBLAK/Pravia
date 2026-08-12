const { PDFParse } = require('pdf-parse');

function createComplexUP139MockBuffer() {
  const textContent = `
NOTARÍA PÚBLICA NO. 4 DE BAHÍA DE BANDERAS, NAYARIT
Lic. Notario Titular: Fernando Mendoza
Dirección: Av. Héroes No. 450, Interior 301, Centro, C.P. 63735
Tels. 322 297 5927 / 322 102 9988
Cuenta Bancaria BBVA: 1183534650  CLABE: 012345678901234567

PRESUPUESTO DE GASTOS Y HONORARIOS NOTARIALES
Folio: UP-139 | Fecha: 28/07/2026

CONCEPTO                                MONTO
--------------------------------------------------
Avalúo Comercial Notarial             $10,664.25
Certificados (CLG, Libertad Gravamen)  $3,500.00
ISABI (Traslado de Dominio Municipal) $65,740.00
Derechos de Registro Público (RPPyC)  $15,470.00
Subtotal Impuestos y Derechos         $95,374.25
Honorarios Notariales                 $48,800.00
Gestoría Administrativa                $3,000.00
Misceláneos y Folios Notariales        $2,000.00
IVA (16%)                              $8,608.00
Subtotal Honorarios y Servicios       $62,408.00
--------------------------------------------------
TOTAL DEL PRESUPUESTO                $157,782.25

Por la atención prestada a la presente, quedamos a sus órdenes.
Atentamente,
Notaría Pública No. 4
  `;

  const pdfStream = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${textContent.length + 100} >>
stream
BT /F1 10 Tf 40 750 Td (${textContent.replace(/\n/g, ') Tj T* (' )}) ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000269 00000 n 
0000000450 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
536
%%EOF`;

  return Buffer.from(pdfStream);
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

async function parsePresupuestoStrictBounded(pdfBuffer, filename = '02 - COTIZACION UP-139.pdf') {
  let rawText = '';
  let numPages = 1;

  try {
    const parser = new PDFParse({ data: pdfBuffer });
    await parser.load();
    const result = await parser.getText();
    rawText = result?.text || '';
    numPages = result?.total || 1;
  } catch (err) {
    rawText = pdfBuffer.toString('utf8');
  }

  const allLines = rawText.split(/[\r\n\t]+/).map(l => l.trim()).filter(Boolean);

  // 1. Locate Bounded Table Window (Start Line -> TOTAL Line)
  let startIdx = 0;
  let endIdx = allLines.length - 1;
  let totalPdfDeclarado = 0;

  // Find start of table (First line containing known budget concept or CONCEPTO header)
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    if (SYNONYMS_CATALOG.some(s => s.regex.test(line)) || /CONCEPTO|DESGLOSE|GASTOS Y HONORARIOS/i.test(line)) {
      startIdx = i;
      break;
    }
  }

  // Find end of table (Line starting with or containing TOTAL)
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
  const rubros = [];
  let idx = 1;

  for (let line of tableLines) {
    // Check blacklist
    if (BLACKLIST_PATTERNS.some(b => b.test(line))) {
      continue;
    }

    // Match amount
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
      let matchedPattern = 'Literal';

      for (const item of SYNONYMS_CATALOG) {
        if (item.regex.test(rawName)) {
          matchedConcept = item.concepto;
          category = item.category;
          matchedPattern = item.regex.toString();
          break;
        }
      }

      rubros.push({
        id: String(idx++),
        concepto: matchedConcept,
        nombre_original: rawName,
        monto,
        categoria: category,
        patron_detectado: matchedPattern
      });
    }
  }

  const sumCalculated = rubros.reduce((sum, r) => sum + r.monto, 0);
  const diff = totalPdfDeclarado > 0 ? Math.abs(sumCalculated - totalPdfDeclarado) : 0;
  const sumaValida = totalPdfDeclarado > 0 ? diff < 0.05 : true;

  let mensajeValidacion = '';
  if (sumaValida) {
    mensajeValidacion = '✓ Extracción validada matemáticamente con éxito';
  } else {
    mensajeValidacion = `⚠️ La suma de partidas detectadas es $${sumCalculated.toLocaleString('es-MX', { minimumFractionDigits: 2 })}. El total del documento es $${totalPdfDeclarado.toLocaleString('es-MX', { minimumFractionDigits: 2 })} (Diferencia: $${diff.toLocaleString('es-MX', { minimumFractionDigits: 2 })}). Requiere revisión manual.`;
  }

  return {
    rubros,
    totales: {
      impuestos_derechos: Number(rubros.filter(r => r.categoria === 'IMPUESTOS_DERECHOS').reduce((s, r) => s + r.monto, 0).toFixed(2)),
      honorarios: Number(rubros.filter(r => r.categoria === 'HONORARIOS').reduce((s, r) => s + r.monto, 0).toFixed(2)),
      gastos_terceros: Number(rubros.filter(r => r.categoria === 'GASTOS_TERCEROS').reduce((s, r) => s + r.monto, 0).toFixed(2)),
      total_general: Number(sumCalculated.toFixed(2))
    },
    total_notaria: Number(sumCalculated.toFixed(2)),
    total_pdf_declarado: totalPdfDeclarado,
    suma_valida: sumaValida,
    mensaje_validacion: mensajeValidacion,
    debug: {
      nombre_archivo: filename,
      numero_paginas: numPages,
      caracteres_extraidos: rawText.length,
      primeros_1000_caracteres: rawText.substring(0, 1000),
      texto_extraido_completo: rawText
    }
  };
}

async function runTest() {
  console.log('=== TEST BOUNDED EXTRACTION ENGINE (COMPLEX PDF) ===');
  const buffer = createComplexUP139MockBuffer();
  const res = await parsePresupuestoStrictBounded(buffer, '02 - COTIZACION UP-139.pdf');

  console.log('\n--- PARTIDAS EXTRAÍDAS ---');
  res.rubros.forEach(r => {
    console.log(`- ${r.concepto.padEnd(35, '.')} $${r.monto.toLocaleString('es-MX', { minimumFractionDigits: 2 }).padStart(10)}`);
  });

  console.log('\nTOTAL SUMA DE PARTIDAS: $' + res.totales.total_general.toLocaleString('es-MX', { minimumFractionDigits: 2 }));
  console.log('TOTAL DECLARADO EN PDF:  $' + res.total_pdf_declarado.toLocaleString('es-MX', { minimumFractionDigits: 2 }));
  console.log('VALIDACIÓN MATEMÁTICA:   ' + res.mensaje_validacion);
}

runTest();
