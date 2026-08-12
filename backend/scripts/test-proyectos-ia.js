const http = require('http');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function requestEndpoint(path, method = 'GET', postData = null) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let dataLen = 0;
      let body = '';
      res.on('data', (chunk) => {
        dataLen += chunk.length;
        if (body.length < 500) body += chunk.toString();
      });
      res.on('end', () => {
        console.log(`[${method} ${path}] Status: ${res.statusCode} | Content-Type: ${res.headers['content-type']} | Bytes: ${dataLen}`);
        resolve(body);
      });
    });

    req.on('error', (e) => {
      console.error(`[${method} ${path}] Error:`, e.message);
      resolve(null);
    });

    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

async function main() {
  const exp = await prisma.expediente.findFirst({
    where: { numero_pravia: 'EXP-2026-001' }
  });

  if (!exp) {
    console.log('No se encontró expediente EXP-2026-001');
    return;
  }

  console.log('=== PROBANDO ENDPOINTS DE PROYECTO, IA Y DESCARGA ZIP ===');
  await requestEndpoint(`/api/expedientes/${exp.id}/proyecto`);
  await requestEndpoint(`/api/expedientes/${exp.id}/documentos/descargar-zip?carpeta=Administrativo`);
  await requestEndpoint(`/api/expedientes/${exp.id}/documentos/descargar-zip?carpeta=Todas`);
  await requestEndpoint(`/api/expedientes/${exp.id}/proyecto/analizar-ia`, 'POST', {});
  await requestEndpoint(`/api/expedientes/${exp.id}/proyecto/reporte-ia/descargar`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
