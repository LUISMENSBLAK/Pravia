const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const exp = await prisma.expediente.findFirst({
    include: { tipo_acto: true, cotizacion: { include: { prospecto: true } } }
  });

  console.log('=== EXPEDIENTE EN DB ===');
  console.log('ID:', exp.id);
  console.log('Numero Pravia:', exp.numero_pravia);
  console.log('Tipo Acto ID:', exp.tipo_acto_id);
  console.log('Tipo Acto Obj:', exp.tipo_acto);

  // Check all TipoActo in DB
  const tipos = await prisma.tipoActo.findMany();
  console.log('=== TIPOS DE ACTO EN DB ===');
  tipos.forEach(t => console.log(t.id, t.nombre, t.clave));
}

main().catch(console.error).finally(() => prisma.$disconnect());
