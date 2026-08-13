import prisma from '../src/config/prisma';
import { seedExpedientesConfig } from '../src/seeders/expedientesInitialSeed';
import { seedComparecientesCatalogos } from './seeds/comparecientes_catalogos.seed';
import { seedProductionCatalogs } from './seeds/production_catalogs.seed';

async function main() {
  await seedComparecientesCatalogos();
  await seedProductionCatalogs();
  await seedExpedientesConfig();
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
