import 'dotenv/config';
import bcrypt from 'bcryptjs';
import prisma from '../src/config/prisma';
import { validatePasswordStrength } from '../src/auth/permissions';

async function main() {
  const email = String(process.env.PRAVIA_ADMIN_EMAIL || '').trim().toLocaleLowerCase('es-MX');
  const password = String(process.env.PRAVIA_ADMIN_PASSWORD || '');
  if (!email || !password) throw new Error('Define PRAVIA_ADMIN_EMAIL y PRAVIA_ADMIN_PASSWORD para activar la cuenta.');
  const failures = validatePasswordStrength(password);
  if (failures.length) throw new Error(failures.join(' '));
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.activo) throw new Error('No existe una cuenta activa con ese correo.');
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: {
      password_hash: passwordHash, password_changed_at: new Date(), requires_password_change: false,
      failed_login_attempts: 0, locked_until: null,
    } }),
    prisma.authSession.updateMany({ where: { user_id: user.id, revoked_at: null }, data: { revoked_at: new Date(), revoked_reason: 'ADMIN_PASSWORD_ACTIVATION' } }),
    prisma.auditLog.create({ data: { user_id: user.id, accion: 'AUTH_PASSWORD_ACTIVATED', entidad: 'User', entidad_id: user.id } }),
  ]);
  console.log(`Cuenta activada de forma segura para ${email}. No se imprimió la contraseña.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
