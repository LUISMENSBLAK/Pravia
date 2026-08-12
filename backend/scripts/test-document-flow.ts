import { ComparecienteAltaSessionService } from '../src/services/comparecienteAltaSession.service';
import { ComparecienteService } from '../src/services/compareciente.service';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const comparecienteService = new ComparecienteService(prisma);

async function main() {
  console.log('=== PRUEBA COMPLETA DEL FLUJO DOCUMENTAL Y ARCHIVO MAESTRO (DIRECTIVA 12) ===\n');

  const user = await prisma.user.findFirst();
  if (!user) throw new Error('No hay usuario en base de datos');

  // 1. Iniciar Sesión de Alta
  console.log('--- 1. INICIAR SESIÓN DE ALTA ---');
  const sesion = await ComparecienteAltaSessionService.iniciarOSentarseSesion({
    usuario_id: user.id,
    tipo_persona: 'FISICA',
    idempotency_key: `test_doc_flow_${Date.now()}`
  });
  console.log(`✅ Sesión iniciada: ${sesion.id}`);

  // 2. Cargar 3 Archivos a la Sesión (SIN APERTURA AUTOMÁTICA)
  console.log('\n--- 2. CARGA DE 3 ARCHIVOS A LA BANDEJA SESIONADA ---');
  const buffer1 = Buffer.from('PDF_INE_FRENTE_CONTENT');
  const buffer2 = Buffer.from('PDF_CURP_CONTENT');
  const buffer3 = Buffer.from('PDF_COMPROBANTE_CONTENT');

  const carga1 = await ComparecienteAltaSessionService.subirDocumentoTemporal({
    sessionId: sesion.id,
    usuarioId: user.id,
    buffer: buffer1,
    nombreOriginal: 'INE_Frente_Carlos.pdf',
    mimeType: 'application/pdf',
    tipoDocumento: 'INE_FRENTE'
  });

  const carga2 = await ComparecienteAltaSessionService.subirDocumentoTemporal({
    sessionId: sesion.id,
    usuarioId: user.id,
    buffer: buffer2,
    nombreOriginal: 'CURP_Carlos.pdf',
    mimeType: 'application/pdf',
    tipoDocumento: 'CURP'
  });

  const carga3 = await ComparecienteAltaSessionService.subirDocumentoTemporal({
    sessionId: sesion.id,
    usuarioId: user.id,
    buffer: buffer3,
    nombreOriginal: 'Comprobante_Luz.pdf',
    mimeType: 'application/pdf',
    tipoDocumento: 'COMPROBANTE_DOMICILIO'
  });

  console.log(`✅ 3 Archivos agregados a la bandeja de la sesión (0 abiertos automáticamente):`);
  console.log(`  - [${carga1.tipo_documento}] ${carga1.nombre_original}`);
  console.log(`  - [${carga2.tipo_documento}] ${carga2.nombre_original}`);
  console.log(`  - [${carga3.tipo_documento}] ${carga3.nombre_original}`);

  // 3. Clasificación Individual y Eliminar 1 Archivo de la Sesión
  console.log('\n--- 3. CLASIFICACIÓN INDIVIDUAL Y ELIMINACIÓN DE 1 ARCHIVO DE LA SESIÓN ---');
  await ComparecienteAltaSessionService.clasificarDocumentoTemporal(carga1.id, 'INE_FRENTE');
  await ComparecienteAltaSessionService.eliminarDocumentoTemporal(carga3.id);
  console.log(`✅ Carga #${carga3.id} (${carga3.nombre_original}) eliminada de la sesión correctamente.`);

  // 4. Extracción mediante IA
  console.log('\n--- 4. EXTRACCIÓN MEDIANTE INTELIGENCIA ARTIFICIAL (GEMINI) ---');
  const resIA = await ComparecienteAltaSessionService.extraerDatosConIA(sesion.id, carga1.id, buffer1);
  console.log(`✅ Extracción IA completada: proveedor ${resIA.resultado.proveedor}`);

  // 5. Confirmar Compareciente con Documentos Restantes
  console.log('\n--- 5. CONFIRMAR ALTA Y TRANSFERIR A ARCHIVO DOCUMENTAL MAESTRO ---');
  const resConfirm = await ComparecienteAltaSessionService.confirmarAltaDefinitiva(sesion.id, user.id, {
    tipo_persona: 'FISICA',
    nombre: 'CARLOS ENRIQUE',
    apellido_paterno: 'VALENZUELA',
    apellido_materno: 'GARCIA',
    curp: 'VAGC880415HDFRPR08',
    rfc: 'VAGC880415XYZ',
    documentos_integrar: [carga1.id, carga2.id]
  });

  const compId = resConfirm.compareciente.id;
  console.log(`✅ Compareciente registrado en pravia_os con ID: ${compId}`);
  console.log(`✅ Documentos integrados al Archivo Documental: ${resConfirm.docs_integrados_count}`);

  // 6. Verificar Archivo Documental en Ficha Maestra
  console.log('\n--- 6. VERIFICAR ARCHIVO DOCUMENTAL EN FICHA MAESTRA ---');
  const archivo = await comparecienteService.obtenerArchivoDocumental(compId);
  console.log(`Documentos en Ficha Maestra (${archivo.documentos.length}):`);
  for (const doc of archivo.documentos) {
    console.log(`  - [${doc.categoria}] ${doc.nombre} (${(doc.size_bytes / 1024).toFixed(1)} KB)`);
  }

  if (archivo.documentos.length !== 2) {
    throw new Error(`Se esperaban 2 documentos en la ficha, se encontraron ${archivo.documentos.length}`);
  }

  // 7. Cargar Documento Adicional desde la Ficha Maestra
  console.log('\n--- 7. CARGAR DOCUMENTO ADICIONAL DESDE LA FICHA MAESTRA ---');
  const buffer4 = Buffer.from('PDF_PASAPORTE_CONTENT');
  await comparecienteService.agregarDocumentoMaster({
    comparecienteId: compId,
    userId: user.id,
    buffer: buffer4,
    fileName: 'Pasaporte_Mexicano_Carlos.pdf',
    mimeType: 'application/pdf',
    categoria: 'IDENTIFICACION'
  });

  // 8. Confirmar Persistencia tras Recarga
  console.log('\n--- 8. CONFIRMAR PERSISTENCIA Y CARPETAS TRAS RECARGA ---');
  const archivoRecargado = await comparecienteService.obtenerArchivoDocumental(compId);
  console.log(`Documentos en Ficha Maestra tras recarga (${archivoRecargado.documentos.length}):`);
  for (const doc of archivoRecargado.documentos) {
    console.log(`  - [${doc.categoria}] ${doc.nombre}`);
  }

  if (archivoRecargado.documentos.length !== 3) {
    throw new Error(`Falló persistencia: se esperaban 3 documentos, hay ${archivoRecargado.documentos.length}`);
  }

  console.log('\n🎉 PRUEBA DE FLUJO DOCUMENTAL COMPLETADA CON 100% DE ÉXITO');
}

main()
  .catch((err) => {
    console.error('❌ ERROR EN PRUEBA DOCUMENTAL:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
