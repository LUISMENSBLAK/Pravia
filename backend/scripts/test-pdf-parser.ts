import { prisma } from '../src/config/prisma';
import { downloadFile } from '../src/services/supabase.service';
const { pdfParse } = require('pdf-parse');

async function testPdfReading() {
  const cargas = await prisma.cargaTemporalDocumento.findMany({
    where: { archived_at: null },
    take: 10,
    orderBy: { created_at: 'desc' }
  });

  for (const carga of cargas) {
    if (!carga.nombre_original.includes('GABINO')) continue;
    console.log(`\n========================================`);
    console.log(`📄 Documento: ${carga.nombre_original}`);
    console.log(`========================================`);
    try {
      const buffer = await downloadFile(carga.storage_key_temporal);
      const res = await pdfParse(buffer);
      console.log('--- TEXTO EXTRAÍDO DEL DOCUMENTO REAL ---');
      console.log(res.text);
      console.log('----------------------------------------');
    } catch (err: any) {
      console.error('Error extrayendo:', err.message);
    }
  }
}

testPdfReading();
