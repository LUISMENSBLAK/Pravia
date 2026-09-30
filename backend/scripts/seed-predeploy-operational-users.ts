import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import prisma from '../src/config/prisma';
import { validatePasswordStrength } from '../src/auth/permissions';
import { runWithPlatformOperation } from '../src/auth/actorContext';

const organizationId = String(process.env.PRAVIA_QA_ORGANIZATION_ID || '30000000-0000-4000-8000-000000000001');

const definitions: Array<{ key: string; email: string; nombre: string; apellido: string; rol: Role }> = [
  { key: 'JAVIER', email: 'javier.tapia@pravia.test', nombre: 'Javier', apellido: 'Tapia', rol: Role.ABOGADO },
  { key: 'ALEJANDRO', email: 'alejandro.abarca@pravia.test', nombre: 'Alejandro', apellido: 'Abarca', rol: Role.ABOGADO },
  { key: 'MARIA', email: 'maria.careaga@pravia.test', nombre: 'María', apellido: 'Careaga', rol: Role.ABOGADO },
  { key: 'ADRIAN', email: 'adrian.hernandez@pravia.test', nombre: 'Adrián', apellido: 'Hernández', rol: Role.DIRECCION },
  { key: 'ROSA', email: 'rosa.becerra@pravia.test', nombre: 'Rosa Dolores', apellido: 'Becerra', rol: Role.FINANCIERO },
];

function assertLocalDatabase() {
  const configured = String(process.env.DATABASE_URL || '');
  const parsed = new URL(configured);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('Este aprovisionamiento sólo puede ejecutarse contra PostgreSQL local aislado.');
  }
  if (process.env.PRAVIA_DATABASE_MODE !== 'local' || process.env.PRAVIA_PRIMARY_DATABASE !== 'local') {
    throw new Error('Activa explícitamente PRAVIA_DATABASE_MODE=local y PRAVIA_PRIMARY_DATABASE=local.');
  }
}

async function main() {
  assertLocalDatabase();
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, status: 'ACTIVE' }, select: { id: true, name: true } });
  if (!organization) throw new Error('La Organization QA indicada no existe o no está activa.');

  const created: Array<{ email: string; role: Role; organization: string }> = [];
  for (const definition of definitions) {
    const password = String(process.env[`PRAVIA_USER_${definition.key}_PASSWORD`] || '');
    const failures = validatePasswordStrength(password);
    if (failures.length) throw new Error(`Contraseña inválida para ${definition.email}: ${failures.join(' ')}`);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: definition.email },
        update: {
          nombre: definition.nombre, apellido: definition.apellido, rol: definition.rol, activo: true,
          password_hash: passwordHash, password_changed_at: new Date(), requires_password_change: false,
          failed_login_attempts: 0, locked_until: null,
        },
        create: {
          email: definition.email, nombre: definition.nombre, apellido: definition.apellido, rol: definition.rol,
          activo: true, password_hash: passwordHash, password_changed_at: new Date(), requires_password_change: false,
        },
      });
      await tx.organizationMembership.upsert({
        where: { organization_id_user_id: { organization_id: organization.id, user_id: user.id } },
        update: { rol: definition.rol, status: 'ACTIVE' },
        create: { organization_id: organization.id, user_id: user.id, rol: definition.rol, status: 'ACTIVE' },
      });
      await tx.authSession.updateMany({ where: { user_id: user.id, revoked_at: null }, data: { revoked_at: new Date(), revoked_reason: 'LOCAL_PREDEPLOY_ROLE_VALIDATION' } });
      await tx.auditLog.create({ data: {
        organization_id: organization.id, user_id: user.id, accion: 'QA_PREDEPLOY_USER_PROVISIONED',
        entidad: 'User', entidad_id: user.id, valores_nuevos: { role: definition.rol, local_only: true },
      } });
    });
    created.push({ email: definition.email, role: definition.rol, organization: organization.name });
  }
  console.log(JSON.stringify({ local_only: true, users: created }, null, 2));
}

runWithPlatformOperation('LOCAL_QA_PREDEPLOY_USER_PROVISIONING', main)
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
