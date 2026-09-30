import prisma from '../src/config/prisma';
import { readSepomexTxt } from '../src/services/postalCodeCatalog.service';

const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ''; };

async function main() {
  const file = arg('--file');
  const version = arg('--version');
  const updated = arg('--updated');
  const sourceUrl = arg('--source-url');
  if (!file || !version || !updated || !sourceUrl) throw new Error('Uso: ts-node scripts/import-postal-catalog.ts --file <txt> --version <versión> --updated <AAAA-MM-DD> --source-url <url oficial>');
  const sourceUpdatedAt = new Date(`${updated}T00:00:00Z`);
  if (Number.isNaN(sourceUpdatedAt.getTime()) || !/^https:\/\//.test(sourceUrl)) throw new Error('La fecha o URL oficial del catálogo no es válida.');
  const rows = await readSepomexTxt(file);
  await prisma.$transaction(async (tx) => {
    await tx.postalCodeCatalog.deleteMany({ where: { source_version: version } });
    for (let index = 0; index < rows.length; index += 2_000) {
      await tx.postalCodeCatalog.createMany({
        data: rows.slice(index, index + 2_000).map((row) => ({ ...row, source_version: version, source_updated_at: sourceUpdatedAt, source_url: sourceUrl })),
      });
    }
  }, { timeout: 120_000 });
  console.log(JSON.stringify({ imported: rows.length, version, updated, source: sourceUrl }));
}

main().finally(() => prisma.$disconnect());
