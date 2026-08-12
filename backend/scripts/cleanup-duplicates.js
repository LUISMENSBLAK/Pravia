const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const expId = '887f498c-8a97-4617-a6cb-c00ab04e100f';
  const user = await prisma.user.findFirst();
  const userId = user.id;

  const movs = await prisma.movimientoFinanciero.findMany({
    where: { expediente_id: expId, estatus: 'VALIDADO', concepto: 'anticipo' },
    orderBy: { fecha_movimiento: 'asc' }
  });

  console.log(`Encontrados ${movs.length} movimientos de anticipo.`);

  if (movs.length <= 1) {
    console.log('No hay duplicados que limpiar.');
    return;
  }

  const original = movs[0];
  const duplicates = movs.slice(1);

  console.log(`Conservando movimiento original: ${original.id}`);
  console.log(`Revirtiendo ${duplicates.length} movimientos duplicados...`);

  for (const dup of duplicates) {
    await prisma.$transaction(async (tx) => {
      // Crear movimiento de reverso de compensación
      await tx.movimientoFinanciero.create({
        data: {
          expediente_id: expId,
          tipo_movimiento: 'DEVOLUCION',
          naturaleza: 'EGRESO',
          categoria: 'REVERSO',
          concepto: `Reverso de duplicado: ${dup.concepto}`,
          monto: dup.monto,
          capturado_por_id: userId,
          validado_por_id: userId,
          fecha_validacion: new Date(),
          estatus: 'VALIDADO',
          movimiento_origen_id: dup.id,
          motivo_reversion: 'Registro duplicado por múltiples clics',
          revertido_por_id: userId,
          fecha_reversion: new Date()
        }
      });

      // Marcar duplicado como REVERTIDO
      await tx.movimientoFinanciero.update({
        where: { id: dup.id },
        data: { estatus: 'REVERTIDO' }
      });

      // Registrar actividad
      await tx.expedienteActividad.create({
        data: {
          expediente_id: expId,
          tipo: 'AUDITORIA',
          titulo: 'Limpieza de Movimiento Duplicado por Clics Múltiples',
          descripcion: `Revertido movimiento duplicado $${dup.monto} (ID: ${dup.id})`,
          usuario_id: userId
        }
      });
    });
  }

  console.log('Limpieza de movimientos duplicados completada exitosamente.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
