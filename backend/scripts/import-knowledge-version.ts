import fs from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import prisma from '../src/config/prisma';
import { actorScopeForRole, runWithActorContext } from '../src/auth/actorContext';
import { permissionsForRole } from '../src/auth/permissions';
import { KnowledgeService } from '../src/services/knowledge.service';

const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ''; };
const identityDb = new PrismaClient();

async function main() {
  const file = arg('--file'); const organizationId = arg('--organization'); const userId = arg('--user');
  const inventoryCode = arg('--source-code').toUpperCase(); const label = arg('--label'); const effectiveFrom = arg('--effective-from');
  const importedFrom = arg('--imported-from'); const verify = process.argv.includes('--verify');
  if (!file || !organizationId || !userId || !inventoryCode || !label) throw new Error('Uso: ts-node scripts/import-knowledge-version.ts --file <txt> --organization <uuid> --user <uuid> --source-code <código> --label <etiqueta> [--effective-from AAAA-MM-DD] [--verify]');
  const membership = await identityDb.organizationMembership.findFirst({ where: { organization_id: organizationId, user_id: userId, status: 'ACTIVE', user: { activo: true } }, include: { user: true } });
  if (!membership) throw new Error('El usuario no pertenece a la organización indicada.');
  const source = await identityDb.knowledgeSource.findFirst({ where: { organization_id: organizationId, inventory_code: inventoryCode, active: true } });
  if (!source) throw new Error(`No existe la fuente ${inventoryCode}.`);
  const contentText = await fs.readFile(file, 'utf8');
  const permissions = permissionsForRole(membership.rol);
  const result = await runWithActorContext({ userId, organizationId, membershipId: membership.id, role: membership.rol, permissions, scope: actorScopeForRole(membership.rol), sessionId: 'KNOWLEDGE-VERSION-LOCAL-IMPORT' }, async () => {
    const service = new KnowledgeService(prisma);
    const created = await service.addVersion({ id: userId, organizationId }, source.id, { content_text: contentText, label, effective_from: effectiveFrom || undefined, imported_from: importedFrom || file });
    const verified = verify ? await service.verifyVersion({ id: userId, organizationId }, source.id, created.id, effectiveFrom || undefined) : null;
    return { source: inventoryCode, version: created.version, articles: created.articles_ingested, verification_status: verified?.verification_status || created.verification_status };
  });
  console.log(JSON.stringify(result));
}

main().finally(() => Promise.allSettled([prisma.$disconnect(), identityDb.$disconnect()]));
