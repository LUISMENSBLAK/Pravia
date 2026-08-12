const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const cotizaciones = await prisma.cotizacion.findMany({
    include: { versiones: true, prospecto: true }
  });
  console.log('=== COTIZACIONES ===');
  cotizaciones.forEach(c => {
    console.log(c.id, c.numero_cotizacion, c.estado, 'Total Cliente:', c.total_cliente, 'Honorarios:', c.honorarios_pravia);
    if (c.versiones && c.versiones.length > 0) {
      console.log('  Versión desglose:', JSON.stringify(c.versiones[0].desglose_notaria));
    }
  });

  const expedientes = await prisma.expediente.findMany({
    include: { cotizacion: { include: { versiones: true } }, movimientosFinancieros: true }
  });
  console.log('=== EXPEDIENTES ===');
  expedientes.forEach(e => {
    console.log(e.id, e.numero_pravia, e.cliente_alias, 'Valor Op:', e.valor_operacion);
    console.log('  Cotizacion ID:', e.cotizacion_id);
    console.log('  Movimientos:', e.movimientosFinancieros.map(m => ({ id: m.id, concepto: m.concepto, monto: m.monto, estatus: m.estatus })));
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
