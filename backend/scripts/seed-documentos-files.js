const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DOCS_DIR = path.join(__dirname, '../uploads/documentos');

async function main() {
  console.log('=== SEEDING ARCHIVOS FÍSICOS PARA ARCHIVO DOCUMENTAL ===');

  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  // 1. Sample PDF content
  const samplePdfContent = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 125 >>\nstream\nBT /F1 18 Tf 50 700 Td (PRAVIA OS - ARCHIVO DOCUMENTAL EXPEDIENTE) Tj ET\nBT /F1 12 Tf 50 650 Td (Documento de Compraventa Inmobiliaria - Folio EXP-2026-001) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000269 00000 n \n0000000436 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n522\n%%EOF'
  );

  const sampleDocPath = path.join(DOCS_DIR, 'sample_documento.pdf');
  fs.writeFileSync(sampleDocPath, samplePdfContent);
  console.log('Archivo de muestra creado:', sampleDocPath);

  // Update existing documents for EXP-2026-001 in DB
  const exp = await prisma.expediente.findFirst({
    where: { numero_pravia: 'EXP-2026-001' },
    include: { requisitos_docs: true }
  });

  if (exp) {
    for (let i = 0; i < exp.requisitos_docs.length; i++) {
      const doc = exp.requisitos_docs[i];
      let folder = 'Administrativo';
      if (i % 3 === 1) folder = 'Comprador';
      if (i % 3 === 2) folder = 'Vendedor';

      await prisma.expedienteRequisitoDoc.update({
        where: { id: doc.id },
        data: {
          observaciones: `[Carpeta: ${folder}] Documento validado en repositorio físico (${(samplePdfContent.length / 1024).toFixed(1)} KB)`
        }
      });
      console.log(`Documento "${doc.nombre}" asignado a Carpeta: ${folder}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
