import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testTrigger() {
  console.log('Testing fn_check_compareciente_perfil()...');
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      DECLARE 
        v_comp UUID := gen_random_uuid();
        v_user UUID;
      BEGIN
        SELECT id INTO v_user FROM users LIMIT 1;

        INSERT INTO comparecientes (id, tipo_persona, nombre_busqueda, creado_por_id)
        VALUES (v_comp, 'FISICA', 'PRUEBA PERFIL INVALIDO', v_user);

        -- Esto debe violar el trigger diferido al finalizar el bloque o transacción
        INSERT INTO personas_morales (id, compareciente_id, razon_social)
        VALUES (gen_random_uuid(), v_comp, 'EMPRESA INVALIDA');
      END $$;
    `);
    console.error('FAILED: Trigger did not reject invalid profile!');
  } catch (err: any) {
    console.log('✅ TRIGGER REJECTED INVALID PROFILE CORRECTLY:', err.message);
  }
}

testTrigger().finally(() => prisma.$disconnect());
