import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

console.log('--- DIAGNÓSTICO DE CONEXIÓN A BASE DE DATOS ---');
console.log('DATABASE_URL presente:', !!process.env.DATABASE_URL);

if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);
    console.log('Host:', url.hostname);
    console.log('Puerto:', url.port);
    console.log('Base:', url.pathname);
    console.log('Usuario:', url.username);
    console.log('SSL / Params:', url.search);
  } catch (e: any) {
    console.log('Error parseando DATABASE_URL:', e.message);
  }
}

const prisma = new PrismaClient({ log: ['error', 'warn'] });

async function main() {
  try {
    console.log('Probando prisma.user.findFirst()...');
    const user = await prisma.user.findFirst();
    console.log('✅ CONEXIÓN EXITOSA A POSTGRESQL');
    console.log('Resultado user:', user ? { id: user.id, email: user.email } : 'Ningún usuario encontrado (tabla vacía)');
  } catch (err: any) {
    console.error('❌ ERROR AL CONECTAR CON POSTGRESQL:', err.message || err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
