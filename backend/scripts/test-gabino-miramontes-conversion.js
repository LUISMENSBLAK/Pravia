import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('===========================================================');
  console.log('🧪 PRUEBA OBLIGATORIA: Conversión Cotización "Gabino Miramontes" → Expediente');
  console.log('===========================================================');

  try {
    // 1. Obtener o crear TipoActo 'Compraventa Inmobiliaria'
    let tipoActo = await prisma.tipoActo.findFirst({
      where: { nombre: { contains: 'Compraventa', mode: 'insensitive' }, activo: true }
    });
    if (!tipoActo) {
      tipoActo = await prisma.tipoActo.create({
        data: {
          nombre: 'Compraventa Inmobiliaria',
          descripcion: 'Operaciones de traslado de dominio inmobiliario',
          activo: true
        }
      });
    }
    console.log(`✓ Tipo de Acto maestro verificado: ${tipoActo.nombre} [ID: ${tipoActo.id}]`);

    // 2. Obtener usuario por defecto
    const user = await prisma.user.findFirst({ where: { activo: true } });
    if (!user) throw new Error('No hay usuarios activos en la base de datos');
    console.log(`👤 Usuario de prueba: ${user.nombre} [ID: ${user.id}]`);

    // 3. Obtener o crear Notaría Pública No. 4
    let notaria = await prisma.notaria.findFirst({
      where: { numero_notaria: '4' }
    });
    if (!notaria) {
      notaria = await prisma.notaria.create({
        data: {
          numero_notaria: '4',
          nombre: 'Notaría Pública No. 4',
          titular: 'Lic. Notario Titular 4',
          entidad_federativa: 'CDMX',
          municipio: 'Cuauhtémoc',
          activa: true
        }
      });
    }
    console.log(`🏛️ Notaría verificada: ${notaria.nombre} [ID: ${notaria.id}]`);

    // 4. Crear Prospecto para Gabino Miramontes
    const prospecto = await prisma.prospecto.create({
      data: {
        user_id: user.id,
        nombre: 'Gabino Miramontes',
        email: 'gabino.miramontes@ejemplo.com',
        telefono: '5551234567',
        tipo_acto: 'Compraventa',
        estado: 'NUEVO'
      }
    });
    console.log(`✓ Prospecto creado: ${prospecto.nombre} [ID: ${prospecto.id}]`);

    // 5. Cargar 2 documentos en Prospecto (INE Comprador, Predial Inmueble)
    const t = Date.now().toString();
    const docP1 = await prisma.documento.create({
      data: {
        nombre_original: 'INE_Gabino_Miramontes.pdf',
        nombre_interno: `INE_Gabino_Miramontes_${t}.pdf`,
        tipo: 'COMPRADOR',
        categoria: 'PROYECTO',
        mime_type: 'application/pdf',
        size_bytes: 102400,
        storage_key: `prospectos/${prospecto.id}/ine_${t}.pdf`,
        prospecto: { connect: { id: prospecto.id } },
        subido_por: { connect: { id: user.id } }
      }
    });
    await prisma.prospectoDocumento.create({
      data: {
        prospecto: { connect: { id: prospecto.id } },
        documento: { connect: { id: docP1.id } },
        tipo_vinculo: 'Comprador',
        creado_por: { connect: { id: user.id } },
        estatus: 'ACTIVO'
      }
    });

    const docP2 = await prisma.documento.create({
      data: {
        nombre_original: 'Predial_2026_Gabino.pdf',
        nombre_interno: `Predial_2026_Gabino_${t}.pdf`,
        tipo: 'INMUEBLE',
        categoria: 'PROYECTO',
        mime_type: 'application/pdf',
        size_bytes: 204800,
        storage_key: `prospectos/${prospecto.id}/predial_${t}.pdf`,
        prospecto: { connect: { id: prospecto.id } },
        subido_por: { connect: { id: user.id } }
      }
    });
    await prisma.prospectoDocumento.create({
      data: {
        prospecto: { connect: { id: prospecto.id } },
        documento: { connect: { id: docP2.id } },
        tipo_vinculo: 'Inmueble',
        creado_por: { connect: { id: user.id } },
        estatus: 'ACTIVO'
      }
    });

    // 6. Crear Cotización para Gabino Miramontes con Presupuesto $157,782.25
    const timestamp = Date.now().toString().slice(-4);
    const cotizacion = await prisma.cotizacion.create({
      data: {
        numero_solicitud: `SOL-GAB-${timestamp}`,
        prospecto: { connect: { id: prospecto.id } },
        notaria: { connect: { id: notaria.id } },
        creada_por: { connect: { id: user.id } },
        total_cliente: 157782.25,
        honorarios_pravia: 15000.00,
        estado: 'ACEPTADA'
      }
    });
    console.log(`✓ Cotización creada: ${cotizacion.numero_solicitud} - Presupuesto: $${cotizacion.total_cliente} [ID: ${cotizacion.id}]`);

    // 7. Cargar 2 documentos adicionales en Cotización (Presupuesto PDF, Avalúo)
    const docC1 = await prisma.documento.create({
      data: {
        nombre_original: 'Presupuesto_Notaria_4_Gabino.pdf',
        nombre_interno: `Presupuesto_Notaria_4_Gabino_${t}.pdf`,
        tipo: 'PRESUPUESTO_NOTARIA',
        categoria: 'PROYECTO',
        mime_type: 'application/pdf',
        size_bytes: 350000,
        storage_key: `cotizaciones/${cotizacion.id}/presupuesto_${t}.pdf`,
        cotizacion: { connect: { id: cotizacion.id } },
        subido_por: { connect: { id: user.id } }
      }
    });
    await prisma.cotizacionDocumento.create({
      data: {
        cotizacion: { connect: { id: cotizacion.id } },
        documento: { connect: { id: docC1.id } },
        tipo_vinculo: 'Administrativo',
        creado_por: { connect: { id: user.id } },
        estatus: 'ACTIVO'
      }
    });

    const docC2 = await prisma.documento.create({
      data: {
        nombre_original: 'Avaluo_Comercial_Gabino.pdf',
        nombre_interno: `Avaluo_Comercial_Gabino_${t}.pdf`,
        tipo: 'OTRO',
        categoria: 'OTROS',
        mime_type: 'application/pdf',
        size_bytes: 450000,
        storage_key: `cotizaciones/${cotizacion.id}/avaluo_${t}.pdf`,
        cotizacion: { connect: { id: cotizacion.id } },
        subido_por: { connect: { id: user.id } }
      }
    });
    await prisma.cotizacionDocumento.create({
      data: {
        cotizacion: { connect: { id: cotizacion.id } },
        documento: { connect: { id: docC2.id } },
        tipo_vinculo: 'Administrativo',
        creado_por: { connect: { id: user.id } },
        estatus: 'ACTIVO'
      }
    });

    console.log('✓ 4 Documentos vinculados previamente a Prospecto/Cotización');

    // 8. EJECUTAR LA CONVERSIÓN ATÓMICA (Probando la lógica del controlador)
    console.log('\n--- PASO CRÍTICO: Ejecutar Conversión Cotización → Expediente ---');
    
    // Simular el llamado al controller interno:
    const convertUrl = 'http://localhost:3001/api/expedientes/convertir-cotizacion';
    const response = await fetch(convertUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cotizacion_id: cotizacion.id,
        abogado_id: user.id
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ Error devuelto por la API:', result);
      throw new Error(`La conversión falló con status ${response.status}: ${result.error}`);
    }

    console.log('🎉 ¡CONVERSIÓN EXITOSA SIN ERRORES!');
    console.log(`📌 Folio Generado: ${result.numero_pravia} [Expediente ID: ${result.id}]`);

    // 9. Verificar Expediente Creado en BD
    const expDB = await prisma.expediente.findUnique({
      where: { id: result.id },
      include: {
        tipo_acto: true,
        notaria: true,
        cotizacion: true,
        expedienteDocumentos: { include: { documento: true } }
      }
    });

    console.log('\n--- PASO DE VERIFICACIÓN EN BASE DE DATOS ---');
    console.log(`✓ Folio de Expediente: ${expDB.numero_pravia}`);
    console.log(`✓ Tipo de Acto Conectado: ${expDB.tipo_acto.nombre} [ID: ${expDB.tipo_acto_id}]`);
    console.log(`✓ Notaría Heredada: ${expDB.notaria?.nombre || 'No asignada'}`);
    console.log(`✓ Presupuesto Heredado ($): ${Number(expDB.valor_operacion).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
    console.log(`✓ Documentos Vinculados en Expediente (${expDB.expedienteDocumentos.length}):`);
    expDB.expedienteDocumentos.forEach((ed, i) => {
      console.log(`   ${i + 1}. ${ed.documento.nombre_original} (Carpeta: ${ed.tipo_vinculo})`);
    });

    if (expDB.expedienteDocumentos.length !== 4) {
      throw new Error(`Se esperaban 4 documentos vinculados, se encontraron ${expDB.expedienteDocumentos.length}`);
    }

    // 10. Verificar Estado de Cotización
    const cotDB = await prisma.cotizacion.findUnique({ where: { id: cotizacion.id } });
    console.log(`✓ Estado final de Cotización: ${cotDB.estado}`);
    if (cotDB.estado !== 'CONVERTIDA_EXPEDIENTE') {
      throw new Error(`La cotización debería estar en estado CONVERTIDA_EXPEDIENTE, pero está en ${cotDB.estado}`);
    }

    // 11. Probar BLOQUEO de Segundo Intento de Conversión
    console.log('\n--- PASO DE VERIFICACIÓN: Bloqueo de Segundo Intento ---');
    const retryRes = await fetch(convertUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cotizacion_id: cotizacion.id,
        abogado_id: user.id
      })
    });
    const retryResult = await retryRes.json();
    console.log(`✓ Status HTTP devuelto en 2º intento: ${retryRes.status}`);
    console.log(`✓ Mensaje devuelto: "${retryResult.error}"`);

    if (retryRes.status === 400 && retryResult.error.includes('convertida')) {
      console.log('✓ ¡Bloqueo de duplicados 100% FUNCIONAL!');
    } else {
      throw new Error('El segundo intento no fue bloqueado adecuadamente.');
    }

    console.log('\n===========================================================');
    console.log('🎉 ¡PRUEBA DE CONVERSIÓN COMPLETA EXITOSA (100% APTO PARA PRODUCCIÓN)!');
    console.log('===========================================================');

  } catch (err) {
    console.error('❌ ERROR EN LA PRUEBA:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
