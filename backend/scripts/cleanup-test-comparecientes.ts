import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function cleanup() {
  console.log('🧹 Limpiando registros de prueba de comparecientes...');
  await prisma.personaFisica.deleteMany({ where: { compareciente_id: 'b4f345b7-6519-4f02-89a5-3204a981ca6e' } });
  await prisma.personaMoral.deleteMany({ where: { compareciente_id: '7cbc6f63-8d95-4edb-a623-5f1ebf7c2056' } });
  await prisma.auditLog.deleteMany({ where: { entidad_id: { in: ['b4f345b7-6519-4f02-89a5-3204a981ca6e', '7cbc6f63-8d95-4edb-a623-5f1ebf7c2056'] } } });
  await prisma.domainEventOutbox.deleteMany({ where: { aggregate_id: { in: ['b4f345b7-6519-4f02-89a5-3204a981ca6e', '7cbc6f63-8d95-4edb-a623-5f1ebf7c2056'] } } });
  await prisma.compareciente.deleteMany({ where: { id: { in: ['b4f345b7-6519-4f02-89a5-3204a981ca6e', '7cbc6f63-8d95-4edb-a623-5f1ebf7c2056'] } } });
  console.log('✅ Base de datos limpia sin registros residuales de prueba.');
}

cleanup().catch(console.error);
