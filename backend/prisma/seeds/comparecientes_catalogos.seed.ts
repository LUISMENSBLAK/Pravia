import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedComparecientesCatalogos() {
  console.log('🌱 Seeding Comparecientes catalogos...');

  // 1. Caracteres de Compareciente
  const caracteresCompareciente = [
    { clave: 'PARTE_VENDEDORA', nombre: 'Parte Vendedora', descripcion: 'Transfiere el dominio o propiedad de un bien o derecho' },
    { clave: 'PARTE_COMPRADORA', nombre: 'Parte Compradora', descripcion: 'Adquiere la propiedad o dominio de un bien o derecho' },
    { clave: 'APODERADO_VENDEDOR', nombre: 'Apoderado del Vendedor', descripcion: 'Actúa en representación legal de la parte vendedora' },
    { clave: 'APODERADO_COMPRADOR', nombre: 'Apoderado del Comprador', descripcion: 'Actúa en representación legal de la parte compradora' },
    { clave: 'CONYUGE_VENDEDOR', nombre: 'Cónyuge del Vendedor', descripcion: 'Manifiesta su consentimiento por el régimen matrimonial' },
    { clave: 'CONYUGE_COMPRADOR', nombre: 'Cónyuge del Comprador', descripcion: 'Manifiesta su consentimiento o comparece en la adquisición' },
    { clave: 'ACREEDOR_HIPOTECARIO', nombre: 'Acreedor Hipotecario', descripcion: 'Institución o persona a favor de quien se constituye garantía' },
    { clave: 'DEUDOR_HIPOTECARIO', nombre: 'Deudor Hipotecario', descripcion: 'Constituye garantía hipotecaria sobre bien de su propiedad' },
    { clave: 'INTERPRETE', nombre: 'Intérprete / Traductor', descripcion: 'Auxilia en la traducción legal de la comparecencia' },
    { clave: 'TESTIGO', nombre: 'Testigo Instrumental', descripcion: 'Atestigua el acto notarial cuando la ley o circunstancias lo exijan' }
  ];

  for (const c of caracteresCompareciente) {
    await prisma.caracterCompareciente.upsert({
      where: { clave: c.clave },
      update: { nombre: c.nombre, descripcion: c.descripcion },
      create: c
    });
  }

  // 2. Caracteres de Representación Corporativa
  const caracteresRepresentacion = [
    { clave: 'ADMINISTRADOR_UNICO', nombre: 'Administrador Único', descripcion: 'Órgano unipersonal de administración y representación legal' },
    { clave: 'PRESIDENTE_CONSEJO', nombre: 'Presidente del Consejo de Administración', descripcion: 'Presidente del órgano colegiado de administración' },
    { clave: 'APODERADO_GENERAL', nombre: 'Apoderado General para Pleitos, Cobranzas y Actos de Dominio', descripcion: 'Poder amplio con facultades de dominio' },
    { clave: 'APODERADO_ADMINISTRACION', nombre: 'Apoderado General para Actos de Administración', descripcion: 'Poder general para la gestión administrativa' },
    { clave: 'DELEGADO_FIDUCIARIO', nombre: 'Delegado Fiduciario', descripcion: 'Representante acreditado de la institución fiduciaria' },
    { clave: 'GERENTE_GENERAL', nombre: 'Gerente General', descripcion: 'Representante ejecutivo nombrado por asamblea o consejo' }
  ];

  for (const r of caracteresRepresentacion) {
    await prisma.caracterRepresentacion.upsert({
      where: { clave: r.clave },
      update: { nombre: r.nombre, descripcion: r.descripcion },
      create: r
    });
  }

  console.log('✅ Comparecientes catalogos seeded successfully.');
}

if (require.main === module) {
  seedComparecientesCatalogos()
    .catch((e) => {
      console.error('❌ Error seeding catalogos:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
