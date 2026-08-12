import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function testUrl(name: string, url: string) {
  console.log(`\n--- Probando ${name} ---`);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const user = await prisma.user.findFirst();
    console.log(`✅ ${name} ÉXITO: Usuario ID: ${user?.id}`);
  } catch (err: any) {
    console.error(`❌ ${name} FALLÓ:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function run() {
  const poolerUrl = process.env.DATABASE_URL || '';
  const directUrl = process.env.DIRECT_URL || '';
  const directHostUrl = poolerUrl.replace('aws-1-us-west-2.pooler.supabase.com:6543', 'db.mkiwijbampubccrpvgga.supabase.co:5432').replace('pgbouncer=true&connection_limit=1&', '');

  await testUrl('DATABASE_URL (Pooler actual)', poolerUrl);
  await testUrl('DIRECT_URL', directUrl);
  await testUrl('Direct Host URL (db.mkiwijbampubccrpvgga.supabase.co:5432)', directHostUrl);
}

run();
