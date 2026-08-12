const { PDFParse } = require('pdf-parse');

async function test() {
  // Create a minimal PDF buffer
  const samplePdfContent = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 190 >>\nstream\nBT /F1 12 Tf 50 700 Td (PRESUPUESTO DE GASTOS Y HONORARIOS NOTARIALES) Tj ET\nBT /F1 12 Tf 50 670 Td (Avaluo $10,664.25) Tj ET\nBT /F1 12 Tf 50 640 Td (Certificados $3,500.00) Tj ET\nBT /F1 12 Tf 50 610 Td (ISABI $65,740.00) Tj ET\nBT /F1 12 Tf 50 580 Td (Derechos de Registro $15,470.00) Tj ET\nBT /F1 12 Tf 50 550 Td (Honorarios Notariales $48,800.00) Tj ET\nBT /F1 12 Tf 50 520 Td (Gestoria $3,000.00) Tj ET\nBT /F1 12 Tf 50 490 Td (Miscelaneos $2,000.00) Tj ET\nBT /F1 12 Tf 50 460 Td (IVA $8,608.00) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000269 00000 n \n0000000510 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n596\n%%EOF'
  );

  try {
    const parser = new PDFParse({ data: samplePdfContent });
    await parser.load();
    const result = await parser.getText();
    console.log('Result type:', typeof result);
    console.log('Result:', result);
  } catch (err) {
    console.error('Error with PDFParse:', err);
  }
}

test();
