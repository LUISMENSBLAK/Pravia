const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const UPLOADS_DIR = path.join(__dirname, '../uploads/finanzas');

async function main() {
  console.log('=== GENERANDO ARCHIVOS FÍSICOS DE MUESTRA Y ACTUALIZANDO BD ===');

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log('Creado directorio:', UPLOADS_DIR);
  }

  // 1. Valid PDF file content
  const samplePdfContent = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 115 >>\nstream\nBT /F1 18 Tf 50 700 Td (PRAVIA OS - COMPROBANTE DE PAGO VALIDADO) Tj ET\nBT /F1 12 Tf 50 650 Td (Monto: $2,000.00 MXN - Folio EXP-2026-001) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000259 00000 n \n0000000426 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n512\n%%EOF'
  );

  // 2. Valid XML file content
  const sampleXmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="F" Folio="2026-001" Fecha="2026-07-28T12:00:00" Sello="PRAVIA_DEMO_SIGNATURE" SubTotal="1724.14" Moneda="MXN" Total="2000.00" TipoDeComprobante="I" Exportacion="01" LugarExpedicion="63000">
    <cfdi:Emisor Rfc="PRA260101XXX" Nombre="PRAVIA NOTARIAL SERVICES S.A. DE C.V." RegimenFiscal="601"/>
    <cfdi:Receptor Rfc="XAXX010101000" Nombre="CLIENTE DEMO CONCORDIA" UsoCFDI="G03"/>
    <cfdi:Conceptos>
        <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="E48" Unidad="Servicio" Descripcion="Anticipo de honorarios notarias y derechos registrales" ValorUnitario="1724.14" Importe="1724.14">
            <cfdi:Impuestos>
                <cfdi:Traslados>
                    <cfdi:Traslado Base="1724.14" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="275.86"/>
                </cfdi:Traslados>
            </cfdi:Impuestos>
        </cfdi:Concepto>
    </cfdi:Conceptos>
    <cfdi:Impuestos TotalImpuestosTrasladados="275.86">
        <cfdi:Traslados>
            <cfdi:Traslado Base="1724.14" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="275.86"/>
        </cfdi:Traslados>
    </cfdi:Impuestos>
</cfdi:Comprobante>`;

  const pathComprobante = path.join(UPLOADS_DIR, 'comprobante_exp2026_001.pdf');
  const pathFacturaPdf = path.join(UPLOADS_DIR, 'factura_exp2026_001.pdf');
  const pathFacturaXml = path.join(UPLOADS_DIR, 'factura_exp2026_001.xml');

  fs.writeFileSync(pathComprobante, samplePdfContent);
  fs.writeFileSync(pathFacturaPdf, samplePdfContent);
  fs.writeFileSync(pathFacturaXml, sampleXmlContent, 'utf8');

  console.log('Archivos generados en disco:');
  console.log(' -', pathComprobante);
  console.log(' -', pathFacturaPdf);
  console.log(' -', pathFacturaXml);

  // Update DB Movimiento record
  const exp = await prisma.expediente.findFirst({
    where: { numero_pravia: 'EXP-2026-001' },
    include: { movimientosFinancieros: true }
  });

  if (exp && exp.movimientosFinancieros.length > 0) {
    const mov = exp.movimientosFinancieros[0];
    const refData = {
      nota: 'Anticipo inicial para gestoría y derechos',
      comprobante_nombre: 'Comprobante_Pago_Anticipo.pdf',
      comprobante_file: 'comprobante_exp2026_001.pdf',
      comprobante_mime: 'application/pdf',
      comprobante_size: samplePdfContent.length,

      factura_pdf_nombre: 'Factura_A101_Anticipo.pdf',
      factura_pdf_file: 'factura_exp2026_001.pdf',
      factura_pdf_mime: 'application/pdf',
      factura_pdf_size: samplePdfContent.length,

      factura_xml_nombre: 'Factura_A101_Anticipo.xml',
      factura_xml_file: 'factura_exp2026_001.xml',
      factura_xml_mime: 'application/xml',
      factura_xml_size: Buffer.byteLength(sampleXmlContent)
    };

    await prisma.movimientoFinanciero.update({
      where: { id: mov.id },
      data: {
        comprobante_url: 'comprobante_exp2026_001.pdf',
        factura_url: 'factura_exp2026_001.pdf',
        referencia: JSON.stringify(refData)
      }
    });

    console.log('Movimiento financiero actualizado con archivos reales:', mov.id);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
