import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function inspect() {
  const tables = ['comparecientes', 'expediente_comparecientes', 'compareciente_documentos'];
  for (const t of tables) {
    const exists: any = await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = '${t}'
      ) as exists;
    `);
    if (exists[0].exists) {
      const count: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "${t}";`);
      console.log(`Table ${t} exists. Row count: ${count[0].count}`);
    } else {
      console.log(`Table ${t} does NOT exist.`);
    }
  }
}

inspect().finally(() => prisma.$disconnect());
