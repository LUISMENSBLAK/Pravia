import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const email = String(process.env.PRAVIA_E2E_EMAIL || '').trim().toLowerCase();
const password = String(process.env.PRAVIA_E2E_PASSWORD || '');
if (!email || !password) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: 'Faltan PRAVIA_E2E_EMAIL/PRAVIA_E2E_PASSWORD. La verificación nunca crea ni restablece cuentas.' }));
  process.exit(0);
}

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.activo || user.requires_password_change || !(await bcrypt.compare(password, user.password_hash))) {
    throw new Error('La cuenta E2E existente no es válida, está inactiva o requiere cambio de contraseña. No se modificó ningún dato.');
  }
  const [notaria, tipo, caracter] = await Promise.all([
    prisma.notaria.findFirst({ where: { activa: true, archived_at: null }, select: { id: true } }),
    prisma.tipoActo.findFirst({ where: { activo: true }, select: { id: true } }),
    prisma.caracterCompareciente.findFirst({ where: { activo: true }, select: { id: true } }),
  ]);
  if (!notaria || !tipo || !caracter) throw new Error('Faltan catálogos activos para E2E. No se crearon datos automáticamente.');
  console.log(JSON.stringify({ ok: true, read_only: true, user_id: user.id, notaria_id: notaria.id, tipo_acto_id: tipo.id, caracter_id: caracter.id }));
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
