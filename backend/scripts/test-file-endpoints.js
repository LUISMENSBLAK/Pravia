const http = require('http');
const fs = require('fs');

function testEndpoint(path, label) {
  return new Promise((resolve) => {
    http.get(`http://localhost:3001${path}`, (res) => {
      let dataLen = 0;
      res.on('data', (chunk) => { dataLen += chunk.length; });
      res.on('end', () => {
        console.log(`[${label}] Status: ${res.statusCode} | Content-Type: ${res.headers['content-type']} | Content-Disposition: ${res.headers['content-disposition']} | Bytes: ${dataLen}`);
        resolve();
      });
    }).on('error', (err) => {
      console.error(`[${label}] Error:`, err.message);
      resolve();
    });
  });
}

async function main() {
  const movId = '1bc6ea6c-5de0-4d17-84b3-dec925561ff5';
  const expId = '887f498c-8a97-4617-a6cb-c00ab04e100f';

  console.log('=== PROBANDO ENDPOINTS REALES DE ARCHIVO ===');
  await testEndpoint(`/api/expedientes/${expId}/movimientos/${movId}/adjuntos/COMPROBANTE/visualizar`, 'VISUALIZAR COMPROBANTE');
  await testEndpoint(`/api/expedientes/${expId}/movimientos/${movId}/adjuntos/FACTURA_PDF/visualizar`, 'VISUALIZAR FACTURA PDF');
  await testEndpoint(`/api/expedientes/${expId}/movimientos/${movId}/adjuntos/FACTURA_XML/visualizar`, 'VISUALIZAR FACTURA XML');
  await testEndpoint(`/api/expedientes/${expId}/movimientos/${movId}/adjuntos/COMPROBANTE/descargar`, 'DESCARGAR COMPROBANTE');
  await testEndpoint(`/api/expedientes/${expId}/movimientos/${movId}/adjuntos/FACTURA_XML/descargar`, 'DESCARGAR FACTURA XML');
}

main();
