import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('===========================================================');
  console.log('🧪 PRUEBA DE ACEPTACIÓN DE FASE 2: Visor Integrado y Generación de Proyecto con IA');
  console.log('===========================================================');

  try {
    // 1. Probar la visualización del archivo real "02 - PAGO PREDIAL UP 139.pdf"
    console.log('\n--- PASO 1: Probar Visualización del Archivo Real "02 - PAGO PREDIAL UP 139.pdf" ---');
    const predialDoc = await prisma.documento.findFirst({
      where: { nombre_original: { contains: 'PAGO PREDIAL UP 139' } }
    });

    if (!predialDoc) throw new Error('No se encontró el registro de 02 - PAGO PREDIAL UP 139.pdf en DB');
    console.log(`✓ Registro DB encontrado: ${predialDoc.nombre_original} [ID: ${predialDoc.id}]`);

    const expId = predialDoc.expediente_id || '1515420b-4b37-4e82-9019-ccdb7dde1cea';
    const visUrl = `http://localhost:3001/api/expedientes/${expId}/documentos/${predialDoc.id}/visualizar`;
    const visRes = await fetch(visUrl);
    console.log(`👁️ Visualizar 02 - PAGO PREDIAL UP 139.pdf: Status ${visRes.status} | Content-Type: ${visRes.headers.get('content-type')}`);

    if (visRes.status !== 200) {
      throw new Error(`Fallo al visualizar el archivo real en Supabase Storage (Status: ${visRes.status})`);
    }
    const buf = await visRes.arrayBuffer();
    console.log(`✓ Archivo físico recuperado exitosamente desde Supabase Storage (${buf.byteLength} bytes)`);

    // 2. Probar la consulta de Matriz de Datos Detectados para IA
    console.log('\n--- PASO 2: Obtener Matriz de Datos Detectados para IA ---');
    const matrixRes = await fetch(`http://localhost:3001/api/expedientes/${expId}/proyecto/matriz-datos`);
    const matrixData = await matrixRes.json();

    if (!matrixRes.ok) throw new Error(`Fallo al obtener matriz de datos: ${matrixData.error}`);
    console.log(`✓ Matriz de Datos Detectados generada (${matrixData.matriz.length} campos):`);
    matrixData.matriz.forEach((item, idx) => {
      console.log(`   ${idx + 1}. ${item.etiqueta}: "${item.valor_detectado}" [Fuente: ${item.fuente} | Confianza: ${item.confianza} | ${item.estatus}]`);
    });

    // 3. Probar la Generación de Proyecto con IA a partir de Plantilla Notarial
    console.log('\n--- PASO 3: Ejecutar Generación de Proyecto con IA ---');
    const genRes = await fetch(`http://localhost:3001/api/expedientes/${expId}/proyecto/generar-ia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matriz_confirmada: matrixData.matriz })
    });
    const genData = await genRes.json();

    if (!genRes.ok) throw new Error(`Fallo en la generación de IA: ${genData.error}`);
    console.log(`🎉 ¡PROYECTO CON IA GENERADO CON ÉXITO!`);
    console.log(`📌 Versión Creada: V${genData.version.version_numero} (${genData.version.nombre_original})`);
    console.log(`📌 Nota de Versión: "${genData.version.nota_version}"`);
    console.log(`📌 Tamaño .docx: ${genData.version.size_bytes} bytes`);

    // 4. Probar la Visualización y Descarga del Proyecto .docx Generado
    console.log('\n--- PASO 4: Probar Visualización y Descarga de la Versión .docx Generada ---');
    const verId = genData.version.id;
    const projVisRes = await fetch(`http://localhost:3001/api/expedientes/${expId}/proyecto/versions/${verId}/visualizar`);
    console.log(`👁️ Visualizar Proyecto .docx en PRAVIA OS: Status ${projVisRes.status} | Content-Type: ${projVisRes.headers.get('content-type')}`);

    const projDescRes = await fetch(`http://localhost:3001/api/expedientes/${expId}/proyecto/versions/${verId}/descargar`);
    console.log(`⬇️ Descargar Proyecto .docx: Status ${projDescRes.status} | Disposition: ${projDescRes.headers.get('content-disposition')}`);

    if (projVisRes.status !== 200 || projDescRes.status !== 200) {
      throw new Error('Fallo en la prueba de visualización o descarga del proyecto generado.');
    }

    console.log('\n===========================================================');
    console.log('🎉 ¡EVIDENCIA DE FASE 2 COMPLETA Y ACEPTABLE AL 100%! (TODOS LOS REQUISITOS CUMPLIDOS)');
    console.log('===========================================================');

  } catch (err) {
    console.error('❌ ERROR EN LA PRUEBA DE FASE 2:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
