const { PDFParse } = require('pdf-parse');

function createSampleUP139Buffer() {
  const textContent = `
COTIZACIÓN NOTARIAL Y PRESUPUESTO DE OPERACIÓN
Folio: UP-139
Fecha: 28 de Julio de 2026
Notaría Pública No. 1 de Tepic, Nayarit

CONCEPTO                                MONTO
--------------------------------------------------
Avalúo Comercial Notarial             $10,664.25
Certificados (CLG, Libertad Gravamen)  $3,500.00
ISABI (Traslado de Dominio Municipal) $65,740.00
Derechos de Registro Público (RPPyC)  $15,470.00
Honorarios Notariales                 $48,800.00
Gestoría Administrativa                $3,000.00
Misceláneos y Folios Notariales        $2,000.00
IVA (16%)                              $8,608.00
--------------------------------------------------
TOTAL DEL PRESUPUESTO                $157,782.25
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
  { concepto: 'ISABI', category: 'IMPUESTOS_DERECHOS', regex: /isabi|transmisi|traslado.*dominio|impuesto.*municipal/i },
  { concepto: 'Derechos de Registro', category: 'IMPUESTOS_DERECHOS', regex: /derecho.*registro|rppyc|registral|inscripci/i },
  { concepto: 'Honorarios Notariales', category: 'HONORARIOS', regex: /honorario/i },
  { concepto: 'Gestoría', category: 'GASTOS_TERCEROS', regex: /gestor/i },
  { concepto: 'Misceláneos', category: 'IMPUESTOS_DERECHOS', regex: /miscel|folio/i },
  { concepto: 'ISR', category: 'IMPUESTOS_DERECHOS', regex: /isr|impuesto.*renta/i },
  { concepto: 'IVA', category: 'HONORARIOS', regex: /iva|impuesto.*valor.*agregado/i }
];

async function parsePresupuestoHybrid(pdfBuffer, filename = '02 - COTIZACION UP-139.pdf') {
  let rawText = '';
  let numPages = 1;

  try {
    const parser = new PDFParse({ data: pdfBuffer });
    await parser.load();
    const result = await parser.getText();
    rawText = result?.text || '';
    numPages = result?.total || 1;
  } catch (err) {
    console.warn('PDFParse error, attempting raw text fallback:', err.message);
    rawText = pdfBuffer.toString('utf8');
  }

  // Split lines on newlines and tabs
  const lines = rawText.split(/[\r\n\t]+/);
  const rubros = [];
  let idx = 1;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Exclude header folio line like "Folio: UP-139" or total header
    if (/^folio\s*:/i.test(line) || /total\s+del\s+presupuesto/i.test(line) || /suma/i.test(line)) continue;

    // Match lines containing an amount $XX,XXX.XX or XX,XXX.XX
    const amountMatch = line.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|\d+(?:\.\d{2})?)/i) ||
                        line.match(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*$/i);

    if (amountMatch) {
      const montoStr = amountMatch[1].replace(/,/g, '');
      const monto = parseFloat(montoStr);

      if (isNaN(monto) || monto <= 0) continue;

      const rawName = line.replace(amountMatch[0], '').replace(/[\$\-\:]/g, '').trim();
      if (!rawName || /TOTAL/i.test(rawName) || /VALOR/i.test(rawName)) continue;

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

  const totalCalculated = rubros.reduce((sum, r) => sum + r.monto, 0);

  const allExpectedConcepts = [
    'Avalúo',
    'Certificados',
    'ISABI',
    'Derechos de Registro',
    'Honorarios Notariales',
    'Gestoría',
    'Misceláneos',
    'IVA'
  ];

  const diagnosticoConceptos = allExpectedConcepts.map(c => {
    const found = rubros.find(r => r.concepto.toLowerCase().includes(c.toLowerCase()));
    return {
      concepto: c,
      monto: found ? found.monto : 0,
      detectado: Boolean(found),
      patron: found ? found.patron_detectado : 'No detectado'
    };
  });

  const noDetectados = diagnosticoConceptos.filter(d => !d.detectado).map(d => d.concepto);

  return {
    rubros,
    totales: {
      impuestos_derechos: Number(rubros.filter(r => r.categoria === 'IMPUESTOS_DERECHOS').reduce((s, r) => s + r.monto, 0).toFixed(2)),
      honorarios: Number(rubros.filter(r => r.categoria === 'HONORARIOS').reduce((s, r) => s + r.monto, 0).toFixed(2)),
      gastos_terceros: Number(rubros.filter(r => r.categoria === 'GASTOS_TERCEROS').reduce((s, r) => s + r.monto, 0).toFixed(2)),
      total_general: Number(totalCalculated.toFixed(2))
    },
    total_notaria: Number(totalCalculated.toFixed(2)),
    honorarios_pravia: 0,
    debug: {
      nombre_archivo: filename,
      numero_paginas: numPages,
      caracteres_extraidos: rawText.length,
      primeros_1000_caracteres: rawText.substring(0, 1000),
      texto_extraido_completo: rawText,
      diagnostico_conceptos: diagnosticoConceptos,
      conceptos_no_detectados: noDetectados
    }
  };
}

async function runTest() {
  console.log('=== TEST MOTOR HÍBRIDO CON COTIZACIÓN UP-139 ===');
  const buffer = createSampleUP139Buffer();
  const res = await parsePresupuestoHybrid(buffer, '02 - COTIZACION UP-139.pdf');

  console.log('\n--- DIAGNÓSTICO DE EXTRACCIÓN DE CONCEPTOS ---');
  res.debug.diagnostico_conceptos.forEach(d => {
    console.log(`${d.detectado ? '✓' : '✕'} ${d.concepto.padEnd(24, '.')} $${d.monto.toLocaleString('es-MX', { minimumFractionDigits: 2 }).padStart(10)} (${d.detectado ? 'Detectado' : 'No detectado'})`);
  });

  console.log('\nTOTAL DEL PRESUPUESTO EXTRAÍDO: $' + res.totales.total_general.toLocaleString('es-MX', { minimumFractionDigits: 2 }));
  console.log('CONCEPTOS NO DETECTADOS:', res.debug.conceptos_no_detectados.length === 0 ? 'Ninguno (100% Exitoso)' : res.debug.conceptos_no_detectados);
}

runTest();
