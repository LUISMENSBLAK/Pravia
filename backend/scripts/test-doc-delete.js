const http = require('http');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const exp = await prisma.expediente.findFirst({
    where: { numero_pravia: 'EXP-2026-001' },
    include: { requisitos_docs: true }
  });

  if (!exp || exp.requisitos_docs.length === 0) {
    console.log('No hay documentos para probar eliminación');
    return;
  }

  // Create a temporary doc to delete
  const tempDoc = await prisma.expedienteRequisitoDoc.create({
    data: {
      expediente_id: exp.id,
      nombre: 'DOCUMENTO_PRUEBA_ELIMINACION.pdf',
      categoria: 'PROYECTO',
      estatus: 'VALIDADO',
      observaciones: '[Carpeta: Administrativo] Archivo temporal'
    }
  });

  console.log('Creado documento temporal para prueba:', tempDoc.id);

  // Perform DELETE request via http
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: `/api/expedientes/${exp.id}/documentos/${tempDoc.id}`,
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const req = http.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log(`[DELETE DOCUMENTO] Status: ${res.statusCode} | Response:`, body);
    });
  });

  req.on('error', (e) => console.error('Error request:', e.message));
  req.end();
}

main().catch(console.error).finally(() => prisma.$disconnect());
