import { PDFParse } from 'pdf-parse';
import { prisma } from '../src/config/prisma';
import { downloadFile } from '../src/services/supabase.service';

async function run() {
  console.log('PDFParse type:', typeof PDFParse);
  const parser = new (PDFParse as any)({ data: Buffer.from('') });
  console.log('Methods of PDFParse instance:', Object.getOwnPropertyNames(Object.getPrototypeOf(parser)));

  const cargas = await prisma.cargaTemporalDocumento.findMany({
    where: { archived_at: null },
    take: 10,
    orderBy: { created_at: 'desc' }
  });

  for (const carga of cargas) {
    if (!carga.nombre_original.includes('GABINO')) continue;
    console.log(`\n📄 Documento: ${carga.nombre_original}`);
    try {
      const buffer = await downloadFile(carga.storage_key_temporal);
      console.log('Descargados', buffer.length, 'bytes');

      const p = new (PDFParse as any)({ data: buffer });
      const text = await p.asText();
      console.log('>>> TEXTO PARSED VIA asText():');
      console.log(text ? text.slice(0, 500) : 'Sin texto');
    } catch (err: any) {
      console.error('Error:', err.message);
    }
  }
}

run();
