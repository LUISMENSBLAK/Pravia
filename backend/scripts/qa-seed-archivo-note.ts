/** Synthetic local-only CFG-002 fixture for Archive browser QA. Never run in production. */
import { createHash, randomUUID } from 'crypto';
import { Document, Packer, Paragraph } from 'docx';
import { PrismaClient } from '@prisma/client';
import { LocalStorageProvider } from '../src/storage/localStorage.provider';

const raw = process.env.LOCAL_DATABASE_URL || '';
const url = new URL(raw);
if (process.env.PRAVIA_DATABASE_MODE !== 'local' || process.env.STORAGE_MODE !== 'local'
  || url.hostname !== '127.0.0.1' || url.port !== '55510' || url.pathname !== '/pravia_qa'
  || url.searchParams.get('schema') !== 'pravia_os' || !process.env.LOCAL_STORAGE_PATH?.startsWith('/')) {
  throw new Error('LOCAL_ARCHIVO_QA_SAFETY_GATE_FAILED');
}

const prisma = new PrismaClient({ datasourceUrl: raw });
const storage = new LocalStorageProvider();
const code = 'QA_ARCHIVO_NOTA_SYNTHETIC_20261006';

async function run() {
  const caseRecord = await prisma.expediente.findUnique({ where: { id: '7a139000-0000-4000-8000-000000000001' }, select: { organization_id: true, notaria_id: true, abogado_id: true } });
  if (!caseRecord?.organization_id) throw new Error('LOCAL_QA_CASE_NOT_FOUND');
  const existing = await prisma.catalogoArtefacto.findFirst({ where: { organization_id: caseRecord.organization_id, codigo_biblioteca: code } });
  if (existing) { process.stdout.write('LOCAL_ARCHIVO_FORMAT_ALREADY_EXISTS\n'); return; }
  const notaria = caseRecord.notaria_id
    ? await prisma.notaria.findUnique({ where: { id: caseRecord.notaria_id }, select: { id: true } })
    : await prisma.notaria.findFirst({ where: { organization_id: caseRecord.organization_id }, select: { id: true } });
  if (!notaria) throw new Error('LOCAL_QA_NOTARIA_NOT_FOUND');
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph('NOTA SINTÉTICA DE PRUEBA — NO UTILIZAR EN OPERACIONES REALES'),
    new Paragraph('Expediente {{expediente.folio}}. Escritura {{archivo.numero_escritura}} del {{archivo.fecha_instrumento}}.'),
    new Paragraph('Folios {{archivo.folio_inicio}} a {{archivo.folio_fin}}. Total: {{archivo.numero_folios}}.'),
    new Paragraph('Instrucción revisable: {{archivo.instruccion}}'),
  ] }] }));
  const storageKey = `organizations/${caseRecord.organization_id}/qa/archivo/${randomUUID()}_nota-sintetica.docx`;
  await storage.upload(buffer, storageKey);
  try {
    await prisma.$transaction(async (tx) => {
      const artifact = await tx.catalogoArtefacto.create({ data: {
        organization_id: caseRecord.organization_id!, tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: notaria.id,
        nombre: 'Nota sintética de Archivo (QA local)', codigo_biblioteca: code, activo: true,
        creado_por_id: caseRecord.abogado_id, actualizado_por_id: caseRecord.abogado_id,
      } });
      await tx.catalogoArtefactoVersion.create({ data: {
        organization_id: caseRecord.organization_id!, artefacto_id: artifact.id, version: 1,
        nombre_original: 'nota-sintetica-archivo.docx', storage_key: storageKey,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: buffer.length,
        checksum_sha256: createHash('sha256').update(buffer).digest('hex'), origen: 'QA_LOCAL_SYNTHETIC',
        creado_por_id: caseRecord.abogado_id,
      } });
      await tx.catalogoArtefactoDestino.create({ data: {
        organization_id: caseRecord.organization_id!, artefacto_id: artifact.id, destino: 'ARCHIVO_NOTA',
        activo: true, predeterminado: true, creado_por_id: caseRecord.abogado_id, actualizado_por_id: caseRecord.abogado_id,
      } });
    });
    process.stdout.write('LOCAL_ARCHIVO_FORMAT_CREATED\n');
  } catch (error) { await storage.delete(storageKey); throw error; }
}

run().finally(() => prisma.$disconnect());
