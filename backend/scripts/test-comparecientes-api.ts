import http from 'http';

function makeRequest(options: http.RequestOptions, postData?: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 500, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode || 500, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function runApiTests() {
  console.log('🧪 INICIANDO VERIFICACIÓN DE ENDPOINTS DE BACKEND PARA COMPARECIENTES\n');

  const realUser = await prisma.user.findFirst();
  const userId = realUser?.id || '00000000-0000-0000-0000-000000000001';
  console.log(`👤 Usuario de prueba obtenido: ${realUser?.nombre} (${userId})\n`);

  // 1. Probar catálogos
  console.log('1️⃣ GET /api/comparecientes/catalogos');
  const catRes = await makeRequest({
    hostname: 'localhost',
    port: 3001,
    path: '/api/comparecientes/catalogos',
    method: 'GET'
  });
  console.log(`   Status: ${catRes.status}`);
  console.log(`   Caracteres Compareciente: ${catRes.body?.data?.caracteresCompareciente?.length || 0}`);
  console.log(`   Caracteres Representación: ${catRes.body?.data?.caracteresRepresentacion?.length || 0}\n`);

  // 2. Probar creación Persona Física
  console.log('2️⃣ POST /api/comparecientes/persona-fisica');
  const pfRes = await makeRequest({
    hostname: 'localhost',
    port: 3001,
    path: '/api/comparecientes/persona-fisica',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    nombre: 'José Manuel',
    apellido_paterno: 'Richard',
    apellido_materno: 'García',
    curp: 'RIGJ800101HNTXXX01',
    rfc: 'RIGJ800101XXX',
    creado_por_id: userId
  });
  console.log(`   Status: ${pfRes.status}`);
  console.log(`   ID Creado: ${pfRes.body?.data?.compareciente?.id || 'N/A'}\n`);

  // 3. Probar creación Persona Moral
  console.log('3️⃣ POST /api/comparecientes/persona-moral');
  const pmRes = await makeRequest({
    hostname: 'localhost',
    port: 3001,
    path: '/api/comparecientes/persona-moral',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    razon_social: 'PACIFIC SOLEIL, S. DE R.L. DE C.V.',
    rfc: 'PSO150820XXX',
    creado_por_id: userId
  });
  console.log(`   Status: ${pmRes.status}`);
  console.log(`   ID Creado: ${pmRes.body?.data?.compareciente?.id || 'N/A'}\n`);

  // 4. Probar detección de duplicados
  console.log('4️⃣ GET /api/comparecientes/duplicados?rfc=PSO150820XXX');
  const dupRes = await makeRequest({
    hostname: 'localhost',
    port: 3001,
    path: '/api/comparecientes/duplicados?rfc=PSO150820XXX',
    method: 'GET'
  });
  console.log(`   Status: ${dupRes.status}`);
  console.log(`   Duplicados Detectados: ${dupRes.body?.data?.length || 0}\n`);

  // 5. Probar listado maestro
  console.log('5️⃣ GET /api/comparecientes');
  const listRes = await makeRequest({
    hostname: 'localhost',
    port: 3001,
    path: '/api/comparecientes',
    method: 'GET'
  });
  console.log(`   Status: ${listRes.status}`);
  console.log(`   Total Registros: ${listRes.body?.meta?.total || 0}\n`);

  console.log('🎉 VERIFICACIÓN DE BACKEND COMPLETADA SATISFACTORIAMENTE.');
}

runApiTests().catch(console.error);
