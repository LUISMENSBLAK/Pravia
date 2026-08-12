import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import JSZip from 'jszip';
import prisma from '../src/config/prisma';
import { deleteFile, getStorageInfo, uploadFile } from '../src/services/supabase.service';

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
const apply = process.argv.includes('--apply');

async function main() {
  const filePath = path.resolve(arg('file'));
  const tipoActoId = arg('tipo-acto-id');
  const notariaId = arg('notaria-id') || null;
  const actorUserId = arg('actor-user-id');
  const requestedVersion = Number(arg('version') || 0);
  if (!arg('file') || !tipoActoId || !actorUserId) throw new Error('Indica --file, --tipo-acto-id y --actor-user-id.');
  if (!fs.existsSync(filePath) || path.extname(filePath).toLowerCase() !== '.docx') throw new Error('La plantilla debe ser un archivo .docx existente.');
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file('word/document.xml')) throw new Error('El archivo no contiene una estructura Word válida.');
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const [actor, tipoActo, notaria, latest] = await Promise.all([
    prisma.user.findFirst({ where: { id: actorUserId, activo: true }, select: { id: true } }),
    prisma.tipoActo.findUnique({ where: { id: tipoActoId }, select: { id: true, nombre: true } }),
    notariaId ? prisma.notaria.findUnique({ where: { id: notariaId }, select: { id: true, nombre: true } }) : Promise.resolve(null),
    prisma.plantillaDocumentalVersion.findFirst({ where: { tipo_acto_id: tipoActoId, notaria_id: notariaId }, orderBy: { version: 'desc' } }),
  ]);
  if (!actor || !tipoActo || (notariaId && !notaria)) throw new Error('Actor, tipo de acto o notaría no válidos.');
  const version = requestedVersion || Number(latest?.version || 0) + 1;
  const storageKey = `plantillas-proyecto/${tipoActoId}/${notariaId || 'general'}/v${version}_${checksum.slice(0, 16)}_${path.basename(filePath).replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  const report = { mode: apply ? 'APPLY_EXPLICIT' : 'DRY_RUN_READ_ONLY', tipo_acto: tipoActo, notaria, version, file: filePath, size_bytes: buffer.length, checksum_sha256: checksum, proposed_storage_key: storageKey };
  if (!apply) return process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (process.env.PROJECT_TEMPLATE_REGISTRATION_APPLY !== 'I_UNDERSTAND_THIS_REGISTERS_A_PERSISTENT_TEMPLATE') throw new Error('Falta la confirmación explícita PROJECT_TEMPLATE_REGISTRATION_APPLY.');
  if (getStorageInfo().primary !== 'cloud') throw new Error('Las plantillas de proyecto solo pueden registrarse en storage cloud.');
  await uploadFile(buffer, storageKey, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  try {
    const created = await prisma.plantillaDocumentalVersion.create({ data: {
      tipo_acto_id: tipoActoId,
      notaria_id: notariaId,
      version,
      nombre: arg('name') || path.basename(filePath),
      storage_key: storageKey,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: buffer.length,
      checksum_sha256: checksum,
      activa: true,
      requisitos_json: latest?.requisitos_json || [],
      creado_por_id: actor.id,
    } });
    process.stdout.write(`${JSON.stringify({ ...report, plantilla_documental_version_id: created.id }, null, 2)}\n`);
  } catch (error) {
    await deleteFile(storageKey).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => { process.stderr.write(`No fue posible registrar la plantilla: ${error.message}\n`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
