const http = require('http');

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
      let body = '';
      res.on('data', (chunk) => body += chunk.toString());
      res.on('end', () => {
        console.log(`[${method} ${path}] Status: ${res.statusCode} | Response: ${body.substring(0, 200)}...`);
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
  console.log('=== PROBANDO MÓDULO MAESTRO DE NOTARÍAS ===');
  await requestEndpoint('/api/notarias');
  
  // Create quick notary
  const createdRaw = await requestEndpoint('/api/notarias', 'POST', {
    numero_notaria: '5',
    nombre: 'Notaría Pública No. 5',
    notario_titular: 'Lic. Fernando Mendoza',
    municipio: 'Bahía de Banderas',
    entidad_federativa: 'Nayarit',
    activa: true
  });

  const created = JSON.parse(createdRaw || '{}');
  if (created.id) {
    // Set as default
    await requestEndpoint(`/api/notarias/${created.id}/predeterminada`, 'PATCH', {});
    // Delete/Inactivate
    await requestEndpoint(`/api/notarias/${created.id}`, 'DELETE');
  }

  // Final check
  await requestEndpoint('/api/notarias');
}

main();
