const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== SEEDING NOTARIAS MAESTRAS EN PRAVIA OS ===');

  const notaria1 = await prisma.notaria.upsert({
    where: { id: '777a888b-999c-000d-111e-222f333a444b' },
    update: {
      numero_notaria: '1',
      nombre: 'Notaría Pública No. 1',
      notario_titular: 'Lic. Javier Concordia Ramos',
      entidad_federativa: 'Nayarit',
      municipio: 'Tepic',
      direccion: 'Av. México No. 145 Sur, Centro, Tepic, Nayarit',
      telefono: '311-212-4590',
      whatsapp: '311-102-3489',
      correo_general: 'contacto@notaria1tepic.mx',
      correo_proyectos: 'proyectos@notaria1tepic.mx',
      horario: 'Lunes a Viernes: 9:00 AM - 6:00 PM',
      predeterminada: true,
      activa: true
    },
    create: {
      id: '777a888b-999c-000d-111e-222f333a444b',
      numero_notaria: '1',
      nombre: 'Notaría Pública No. 1',
      notario_titular: 'Lic. Javier Concordia Ramos',
      entidad_federativa: 'Nayarit',
      municipio: 'Tepic',
      direccion: 'Av. México No. 145 Sur, Centro, Tepic, Nayarit',
      telefono: '311-212-4590',
      whatsapp: '311-102-3489',
      correo_general: 'contacto@notaria1tepic.mx',
      correo_proyectos: 'proyectos@notaria1tepic.mx',
      horario: 'Lunes a Viernes: 9:00 AM - 6:00 PM',
      predeterminada: true,
      activa: true,
      contactos: {
        create: [
          { nombre: 'Lic. Carlos Silva', cargo: 'Abogado Proyectista', telefono: '311-212-4591', correo: 'csilva@notaria1tepic.mx' },
          { nombre: 'Lic. María Fernanda Ruiz', cargo: 'Gestoría Registro', telefono: '311-212-4592', correo: 'mruiz@notaria1tepic.mx' }
        ]
      }
    }
  });

  const notaria12 = await prisma.notaria.upsert({
    where: { id: '888b999c-000d-111e-222f-333a444b555c' },
    update: {
      numero_notaria: '12',
      nombre: 'Notaría Pública No. 12',
      notario_titular: 'Lic. Arturo Ramos Gutiérrez',
      entidad_federativa: 'Nayarit',
      municipio: 'Tepic',
      direccion: 'Calle Allende No. 88 Poniente, Centro, Tepic, Nayarit',
      telefono: '311-216-9000',
      whatsapp: '311-140-5566',
      correo_general: 'notaria12tepic@gmail.com',
      predeterminada: false,
      activa: true
    },
    create: {
      id: '888b999c-000d-111e-222f-333a444b555c',
      numero_notaria: '12',
      nombre: 'Notaría Pública No. 12',
      notario_titular: 'Lic. Arturo Ramos Gutiérrez',
      entidad_federativa: 'Nayarit',
      municipio: 'Tepic',
      direccion: 'Calle Allende No. 88 Poniente, Centro, Tepic, Nayarit',
      telefono: '311-216-9000',
      whatsapp: '311-140-5566',
      correo_general: 'notaria12tepic@gmail.com',
      predeterminada: false,
      activa: true,
      contactos: {
        create: [
          { nombre: 'Lic. Patricia Vega', cargo: 'Proyectista', telefono: '311-216-9001', correo: 'pvega@notaria12.mx' }
        ]
      }
    }
  });

  console.log('Seeded notarías:', notaria1.nombre, 'y', notaria12.nombre);
}

main().catch(console.error).finally(() => prisma.$disconnect());
