const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== ACTUALIZANDO TIPO DE ACTO EN BD ===');

  // Ensure "Compraventa Inmobiliaria" TipoActo exists or update "General / No Especificado"
  const compActo = await prisma.tipoActo.findFirst({
    where: { nombre: 'Compraventa Inmobiliaria' }
  });

  let targetId = compActo?.id;

  if (compActo) {
    console.log('Encontrado TipoActo Compraventa Inmobiliaria ID:', compActo.id);
  } else {
    const updated = await prisma.tipoActo.updateMany({
      where: { nombre: { contains: 'General' } },
      data: { nombre: 'Compraventa Inmobiliaria' }
    });
    console.log('Actualizados TipoActo a "Compraventa Inmobiliaria":', updated.count);
    const refreshed = await prisma.tipoActo.findFirst({ where: { nombre: 'Compraventa Inmobiliaria' } });
    targetId = refreshed.id;
  }

  // Update ALL expedientes to point to Compraventa Inmobiliaria
  const expUpdate = await prisma.expediente.updateMany({
    data: { tipo_acto_id: targetId }
  });

  console.log(`Actualizados ${expUpdate.count} expedientes a "Compraventa Inmobiliaria".`);

  const verification = await prisma.expediente.findMany({
    include: { tipo_acto: true }
  });

  verification.forEach(e => {
    console.log('Expediente:', e.numero_pravia, '-> Acto:', e.tipo_acto?.nombre);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
