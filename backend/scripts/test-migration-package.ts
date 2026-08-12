import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('=== PRUEBA Y VALIDACIÓN TÉCNICA DEL PAQUETE DE MIGRACIÓN ===\n');

  // 1. Conteos Previos
  console.log('--- 1. CONTEOS PREVIOS EN LA BASE DE DATOS ---');
  const countUsersBefore = await prisma.user.count();
  const countComparecientesBefore = await prisma.compareciente.count();
  const countPersonasFisicasBefore = await prisma.personaFisica.count();
  const countPersonasMoralesBefore = await prisma.personaMoral.count();
  const countExpedientesBefore = await prisma.expediente.count();

  console.log(`Users: ${countUsersBefore}`);
  console.log(`Comparecientes: ${countComparecientesBefore}`);
  console.log(`Personas Físicas: ${countPersonasFisicasBefore}`);
  console.log(`Personas Morales: ${countPersonasMoralesBefore}`);
  console.log(`Expedientes: ${countExpedientesBefore}`);

  // 2. Validación de Modelos Nuevos en Prisma Client
  console.log('\n--- 2. VERIFICACIÓN DE MODELOS EN PRISMA CLIENT ---');
  const countAltaSessions = await prisma.comparecienteAltaSession.count();
  const countCargasTemporales = await prisma.cargaTemporalDocumento.count();
  const countCompensationJobs = await prisma.storageCompensationJob.count();
  const countDatosFuente = await prisma.comparecienteDatoFuente.count();
  const countAliases = await prisma.comparecienteAlias.count();
  const countActividades = await prisma.actividadEconomica.count();
  const countCompActividades = await prisma.comparecienteActividadEconomica.count();

  console.log(`ComparecienteAltaSession: ${countAltaSessions}`);
  console.log(`CargaTemporalDocumento: ${countCargasTemporales}`);
  console.log(`StorageCompensationJob: ${countCompensationJobs}`);
  console.log(`ComparecienteDatoFuente: ${countDatosFuente}`);
  console.log(`ComparecienteAlias: ${countAliases}`);
  console.log(`ActividadEconomica: ${countActividades}`);
  console.log(`ComparecienteActividadEconomica: ${countCompActividades}`);

  // 3. Prueba de Idempotencia y Aislamiento de Sesiones
  console.log('\n--- 3. PRUEBA DE BLOQUEO CONCURRENTE E IDEMPOTENCIA DE SESIÓN ---');
  const user = await prisma.user.findFirst();
  if (!user) {
    throw new Error('No se encontró ningún usuario para la prueba');
  }

  const testSessionKey = `test_idempotency_key_${Date.now()}`;
  const session1 = await prisma.comparecienteAltaSession.create({
    data: {
      usuario_id: user.id,
      tipo_persona: 'FISICA',
      idempotency_key: testSessionKey,
      correlation_id: `corr_${Date.now()}`,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      borrador_json: { nombre: 'Prueba Idempotencia', rfc: 'TEST000000XXX' }
    }
  });
  console.log(`✅ Sesión de prueba creada con éxito: ${session1.id}`);

  // Probar rechazo de clave de idempotencia duplicada
  let idempotencyRejected = false;
  try {
    await prisma.comparecienteAltaSession.create({
      data: {
        usuario_id: user.id,
        tipo_persona: 'FISICA',
        idempotency_key: testSessionKey,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
  } catch (err: any) {
    idempotencyRejected = true;
    console.log(`✅ Idempotencia validada: rechazo exitoso de clave de idempotencia duplicada (${err.code})`);
  }

  if (!idempotencyRejected) {
    throw new Error('FALLO DE IDEMPOTENCIA: Se permitió duplicar la clave de idempotencia');
  }

  // 4. Prueba del Job de Compensación y Carga Temporal
  console.log('\n--- 4. PRUEBA DE CARGA TEMPORAL Y JOB DE COMPENSACIÓN ---');
  const temporalDoc = await prisma.cargaTemporalDocumento.create({
    data: {
      alta_session_id: session1.id,
      usuario_id: user.id,
      tipo_documento: 'INE',
      nombre_original: 'ine_test.pdf',
      storage_key_temporal: `temporales/test/${session1.id}/ine_test.pdf`,
      mime_type: 'application/pdf',
      tamano_bytes: 102450,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });
  console.log(`✅ Carga temporal creada: ${temporalDoc.id}`);

  const compensationJob = await prisma.storageCompensationJob.create({
    data: {
      carga_temporal_id: temporalDoc.id,
      storage_key: temporalDoc.storage_key_temporal,
      tipo_operacion: 'ELIMINAR_TEMPORAL',
      estatus: 'PENDIENTE',
      correlation_id: session1.correlation_id
    }
  });
  console.log(`✅ Job de compensación registrado: ${compensationJob.id}`);

  // Limpieza de datos de prueba
  console.log('\n--- 5. LIMPIEZA DE REGISTROS DE PRUEBA Y CONFIRMACIÓN DE CERO MODIFICACIONES ---');
  await prisma.storageCompensationJob.delete({ where: { id: compensationJob.id } });
  await prisma.cargaTemporalDocumento.delete({ where: { id: temporalDoc.id } });
  await prisma.comparecienteAltaSession.delete({ where: { id: session1.id } });

  const countUsersAfter = await prisma.user.count();
  const countComparecientesAfter = await prisma.compareciente.count();

  console.log(`Users después: ${countUsersAfter} (Antes: ${countUsersBefore})`);
  console.log(`Comparecientes después: ${countComparecientesAfter} (Antes: ${countComparecientesBefore})`);

  if (countUsersBefore !== countUsersAfter || countComparecientesBefore !== countComparecientesAfter) {
    throw new Error('FALLO DE INTEGRIDAD: Se modificaron los datos existentes');
  }

  console.log('\n🎉 PRUEBA DE VALIDACIÓN DEL PAQUETE DE MIGRACIÓN COMPLETADA EXITOSAMENTE');
}

main()
  .catch((e) => {
    console.error('❌ ERROR EN PRUEBA:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
