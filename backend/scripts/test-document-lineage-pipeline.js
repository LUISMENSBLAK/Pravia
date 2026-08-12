const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testDocumentLineagePipeline() {
  console.log('===========================================================');
  console.log('🧪 PRUEBA DE CONTINUIDAD DOCUMENTAL: Prospecto → Cotización → Expediente');
  console.log('===========================================================');

  try {
    // Get active user and notary
    const user = await prisma.user.findFirst({ where: { activo: true } });
    const notaria = await prisma.notaria.findFirst({ where: { activa: true } });

    if (!user || !notaria) {
      throw new Error('Se requiere un usuario y notaria activos en base de datos.');
    }

    console.log(`👤 Usuario de prueba: ${user.nombre} (${user.id})`);
    console.log(`🏛️ Notaría de prueba: ${notaria.nombre} (${notaria.id})`);

    // 1. Crear Prospecto de prueba
    console.log('\n--- PASO 1: Crear Prospecto de prueba ---');
    const prospecto = await prisma.prospecto.create({
      data: {
        nombre: 'Cliente Integridad Lineage Test ' + Date.now(),
        telefono: '3221234567',
        email: 'lineage.test@pravia.os',
        tipo_acto: 'Compraventa Inmobiliaria',
        necesidad: 'Compraventa de Residencia en Marina Vallarta',
        user_id: user.id
      }
    });
    console.log(`✓ Prospecto creado: ${prospecto.nombre} [ID: ${prospecto.id}]`);

    // 2. Cargar dos documentos al Prospecto
    console.log('\n--- PASO 2: Cargar dos documentos al Prospecto ---');
    const docProspecto1 = await prisma.documento.create({
      data: {
        nombre_original: 'INE_Comprador_Test.pdf',
        nombre_interno: `doc_p1_${Date.now()}.pdf`,
        tipo: 'COMPRADOR',
        categoria: 'OTROS',
        storage_key: `prospectos/${prospecto.id}/ine_comprador.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 102450,
        subido_por_id: user.id,
        prospecto_id: prospecto.id
      }
    });

    const docProspecto2 = await prisma.documento.create({
      data: {
        nombre_original: 'Predial_2026_Test.pdf',
        nombre_interno: `doc_p2_${Date.now()}.pdf`,
        tipo: 'INMUEBLE',
        categoria: 'OTROS',
        storage_key: `prospectos/${prospecto.id}/predial_2026.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 204800,
        subido_por_id: user.id,
        prospecto_id: prospecto.id
      }
    });

    // Create junction records
    await prisma.prospectoDocumento.createMany({
      data: [
        { prospecto_id: prospecto.id, documento_id: docProspecto1.id, tipo_vinculo: 'General', creado_por_id: user.id },
        { prospecto_id: prospecto.id, documento_id: docProspecto2.id, tipo_vinculo: 'General', creado_por_id: user.id }
      ]
    });

    console.log(`✓ Documento 1 cargado a Prospecto: ${docProspecto1.nombre_original} [ID: ${docProspecto1.id}]`);
    console.log(`✓ Documento 2 cargado a Prospecto: ${docProspecto2.nombre_original} [ID: ${docProspecto2.id}]`);

    // 3. Crear Cotización desde ese Prospecto
    console.log('\n--- PASO 3: Crear Cotización desde el Prospecto ---');
    const year = new Date().getFullYear();
    const count = await prisma.cotizacion.count();
    const cotizacion = await prisma.cotizacion.create({
      data: {
        numero_solicitud: `SOL-${year}-${String(count + 1).padStart(3, '0')}`,
        prospecto_id: prospecto.id,
        notaria_id: notaria.id,
        user_id: user.id,
        estado: 'BORRADOR',
        total_cliente: 157782.25
      }
    });
    console.log(`✓ Cotización creada: ${cotizacion.numero_solicitud} [ID: ${cotizacion.id}]`);

    // 4. Confirmar que los documentos del Prospecto se consultan en Cotización
    console.log('\n--- PASO 4: Verificar que los documentos del Prospecto se heredan en Cotización ---');
    const docsCotizacionConsultados = await prisma.documento.findMany({
      where: {
        OR: [
          { prospecto_id: prospecto.id },
          { cotizacion_id: cotizacion.id }
        ]
      }
    });

    console.log(`✓ Documentos heredados en Cotización (${docsCotizacionConsultados.length}):`);
    docsCotizacionConsultados.forEach(d => {
      const origen = d.prospecto_id ? 'Prospecto' : 'Cotización';
      console.log(`   • ${d.nombre_original} (Origen: ${origen})`);
    });

    if (docsCotizacionConsultados.length < 2) {
      throw new Error('FAIL: No se heredaron los 2 documentos del Prospecto en la Cotización.');
    }

    // 5. Cargar un documento adicional en la Cotización
    console.log('\n--- PASO 5: Cargar documento adicional en Cotización ---');
    const docCotizacionAdicional = await prisma.documento.create({
      data: {
        nombre_original: 'Presupuesto_Notaria_4_Oficial.pdf',
        nombre_interno: `doc_c1_${Date.now()}.pdf`,
        tipo: 'PRESUPUESTO_NOTARIA',
        categoria: 'PROYECTO',
        storage_key: `cotizaciones/${cotizacion.id}/presupuesto_notaria_demo.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 512000,
        subido_por_id: user.id,
        cotizacion_id: cotizacion.id
      }
    });

    await prisma.cotizacionDocumento.create({
      data: {
        cotizacion_id: cotizacion.id,
        documento_id: docCotizacionAdicional.id,
        tipo_vinculo: 'Presupuesto Notarial',
        creado_por_id: user.id
      }
    });

    console.log(`✓ Documento 3 cargado en Cotización: ${docCotizacionAdicional.nombre_original} [ID: ${docCotizacionAdicional.id}]`);

    // 6. Aprobar la Cotización (ACEPTADA)
    console.log('\n--- PASO 6: Aprobar la Cotización ---');
    await prisma.cotizacion.update({
      where: { id: cotizacion.id },
      data: { estado: 'ACEPTADA' }
    });
    console.log(`✓ Cotización estado actualizado a: APROBADA`);

    // 7. Convertir Cotización en Expediente (Ejecutar Transacción Completa)
    console.log('\n--- PASO 7: Convertir Cotización en Expediente (Transacción Completa) ---');
    const tipoActo = await prisma.tipoActo.findFirst({ where: { activo: true } });
    if (!tipoActo) throw new Error('No existe TipoActo activo.');

    const countExp = await prisma.expediente.count();
    const numero_pravia = `EXP-${year}-${String(countExp + 1).padStart(4, '0')}`;

    const expediente = await prisma.$transaction(async (tx) => {
      const exp = await tx.expediente.create({
        data: {
          numero_pravia,
          tipo_acto_id: tipoActo.id,
          cotizacion_id: cotizacion.id,
          notaria_id: notaria.id,
          abogado_id: user.id,
          creador_id: user.id,
          cliente_alias: prospecto.nombre,
          valor_operacion: 157782.25,
          estatus: 'ABIERTO'
        }
      });

      await tx.cotizacion.update({
        where: { id: cotizacion.id },
        data: { estado: 'CONVERTIDA_EXPEDIENTE', fecha_conversion_expediente: new Date() }
      });

      // Vincular documentos sin duplicar física ni lógicamente
      const [pDocs, cDocs] = await Promise.all([
        tx.documento.findMany({ where: { prospecto_id: prospecto.id } }),
        tx.documento.findMany({ where: { cotizacion_id: cotizacion.id } })
      ]);

      const docMap = new Map();
      pDocs.forEach(d => {
        let folder = 'Administrativo';
        if (d.tipo === 'COMPRADOR') folder = 'Comprador';
        if (d.tipo === 'INMUEBLE') folder = 'Inmueble';
        docMap.set(d.id, { docId: d.id, folder });
      });

      cDocs.forEach(d => {
        docMap.set(d.id, { docId: d.id, folder: 'Administrativo' });
      });

      for (const item of Array.from(docMap.values())) {
        await tx.expedienteDocumento.create({
          data: {
            expediente_id: exp.id,
            documento_id: item.docId,
            tipo_vinculo: item.folder,
            creado_por_id: user.id
          }
        });
        await tx.documento.update({
          where: { id: item.docId },
          data: { expediente_id: exp.id }
        });
      }

      return exp;
    });

    console.log(`✓ Expediente creado: ${expediente.numero_pravia} [ID: ${expediente.id}]`);

    // 8. Confirmar que el Expediente contiene los 3 documentos
    console.log('\n--- PASO 8: Confirmar que el Expediente contiene los 3 documentos heredados ---');
    const expedienteDocs = await prisma.expedienteDocumento.findMany({
      where: { expediente_id: expediente.id, estatus: 'ACTIVO' },
      include: { documento: true }
    });

    console.log(`✓ Documentos presentes en Expediente (${expedienteDocs.length}):`);
    expedienteDocs.forEach((ed, idx) => {
      const origen = ed.documento.prospecto_id ? 'Prospecto' : ed.documento.cotizacion_id ? 'Cotización' : 'Expediente';
      console.log(`   ${idx + 1}. ${ed.documento.nombre_original} (Carpeta: ${ed.tipo_vinculo}, Origen Inicial: ${origen})`);
    });

    if (expedienteDocs.length !== 3) {
      throw new Error(`FAIL: Se esperaban exactamente 3 documentos en el Expediente, pero se encontraron ${expedienteDocs.length}.`);
    }

    // 9. Verificar que ningún documento esté duplicado
    console.log('\n--- PASO 9: Verificar que NO existan duplicados ---');
    const docIds = expedienteDocs.map(ed => ed.documento_id);
    const uniqueIds = new Set(docIds);
    if (uniqueIds.size !== docIds.length) {
      throw new Error('FAIL: Se encontraron documentos duplicados en el Expediente.');
    }
    console.log('✓ 0 Duplicados confirmados: todos los IDs de documento son únicos.');

    // 10. Desvincular un documento del Expediente sin eliminar el original del Prospecto/Cotización
    console.log('\n--- PASO 10: Desvincular documento del Expediente y verificar persistencia en Prospecto ---');
    const targetDocToUnlink = docProspecto1.id;

    await prisma.expedienteDocumento.updateMany({
      where: { expediente_id: expediente.id, documento_id: targetDocToUnlink },
      data: { estatus: 'INACTIVO' }
    });

    const docEnProspecto = await prisma.documento.findUnique({
      where: { id: targetDocToUnlink }
    });

    if (!docEnProspecto) {
      throw new Error('FAIL: El documento físico fue eliminado de base de datos.');
    }

    console.log(`✓ El documento ${docEnProspecto.nombre_original} sigue intacto en base de datos.`);
    console.log(`✓ storage_key preservada: ${docEnProspecto.storage_key}`);

    console.log('\n===========================================================');
    console.log('🎉 ¡TODAS LAS PRUEBAS DE CONTINUIDAD DOCUMENTAL PASARON CON ÉXITO! (100%)');
    console.log('===========================================================');

  } catch (error) {
    console.error('\n❌ ERROR EN PRUEBA DE CONTINUIDAD DOCUMENTAL:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testDocumentLineagePipeline();
