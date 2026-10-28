import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { runWithActorContext } from '../auth/actorContext';
import { ComparecienteService } from '../services/compareciente.service';
import { downloadFile, uploadFile } from '../storage/storage.service';

const enabled = process.env.CURP_EXTRACTION_QA === '1';
const qaUrl = process.env.CURP_EXTRACTION_QA_DATABASE_URL || '';
if (enabled) {
  const parsed = new URL(qaUrl);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55439' || parsed.pathname !== '/postgres' ||
      parsed.searchParams.get('schema') !== 'pravia_os' || process.env.STORAGE_MODE !== 'local' ||
      process.env.PRAVIA_DATABASE_MODE !== 'local' ||
      !process.env.LOCAL_STORAGE_PATH?.startsWith('/tmp/pravia-billing-qa-20261026-storage')) {
    throw new Error('CURP integration requires isolated local PostgreSQL and Storage QA.');
  }
}

async function syntheticCurp() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const draw = (value: string, x: number, y: number) => page.drawText(value, { x, y, font, size: 10 });
  draw('Clave Unica de Registro de Poblacion - SINTETICO / SIN VALIDEZ', 20, 740);
  draw('Clave:', 170, 660); draw('GARA900101HDFRBC09', 170, 642);
  draw('Nombre', 170, 615); draw('PERSONA SINTETICA DE PRUEBA', 170, 596);
  draw('Fecha de inscripcion', 150, 545); draw('05/02/2026', 150, 529);
  draw('Folio', 290, 545); draw('12345678', 290, 529);
  draw('Entidad de registro', 380, 545); draw('NAYARIT', 380, 529);
  return Buffer.from(await pdf.save());
}

describe.runIf(enabled)('CURP · PostgreSQL y Storage locales', () => {
  it('guarda original, propuestas y procedencia, sin aplicar identidad maestra ni cruzar tenants', async () => {
    const db = new PrismaClient({ datasources: { db: { url: qaUrl } } });
    const suffix = randomUUID();
    try {
      const user = await db.user.create({ data: { email: `curp-qa-${suffix}@pravia.test`,
        password_hash: 'LOCAL_QA_NO_LOGIN', nombre: 'QA', apellido: 'CURP', rol: 'DIRECCION' } });
      const organization = await db.organization.create({ data: { name: `QA CURP ${suffix}` } });
      await db.organizationMembership.create({ data: { organization_id: organization.id,
        user_id: user.id, rol: 'DIRECCION' } });
      await db.tenantEntitlement.create({ data: { organization_id: organization.id,
        included_storage_bytes: 1024n * 1024n, total_storage_capacity_bytes: 1024n * 1024n } });
      await db.tenantStorageUsage.create({ data: { organization_id: organization.id } });
      const actor = { id: user.id, organizationId: organization.id, rol: 'DIRECCION',
        membershipId: 'QA', sessionId: 'QA', scope: 'GLOBAL',
        permissions: ['comparecientes.read', 'comparecientes.write', 'documentos.read', 'ia.execute'] } as any;
      const asActor = <T>(work: () => T) => runWithActorContext({ userId: user.id,
        organizationId: organization.id, membershipId: 'QA', sessionId: 'QA', role: 'DIRECCION',
        permissions: actor.permissions, scope: 'GLOBAL' }, work);
      await asActor(async () => {
      const compareciente = await db.compareciente.create({ data: { organization_id: organization.id,
        nombre_busqueda: 'PERSONA SINTETICA DE PRUEBA', creado_por_id: user.id } });
      const bytes = await syntheticCurp();
      const key = `organizations/${organization.id}/curp-qa/${randomUUID()}.pdf`;
      await uploadFile(bytes, key, 'application/pdf');
      const document = await db.documento.create({ data: { organization_id: organization.id,
        nombre_original: 'CURP_SINTETICA_SIN_VALIDEZ.pdf', nombre_interno: key,
        tipo: 'CURP', categoria: 'OTROS', storage_key: key, mime_type: 'application/pdf',
        size_bytes: bytes.length, checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
        subido_por_id: user.id, compareciente_id: compareciente.id } });
      await db.comparecienteDocumento.create({ data: { organization_id: organization.id,
        compareciente_id: compareciente.id, documento_id: document.id,
        categoria: 'CURP', creado_por_id: user.id } });
      const service = new ComparecienteService(db);
      const extracted = await asActor(() => service.extraerDocumentosExistentesConIA(compareciente.id, actor, suffix));
      expect(extracted.values).toMatchObject({ curp: 'GARA900101HDFRBC09' });
      expect(extracted.proposals.curp).toMatchObject({ documento_id: document.id, pagina: 1,
        fragmento: 'GARA900101HDFRBC09', estado: 'PENDIENTE_CONFIRMACION' });
      expect(extracted.documentos_curp[0].fields.fecha_inscripcion?.normalized).toBe('2026-02-05');
      expect((await downloadFile(key)).equals(bytes)).toBe(true);
      expect(await db.comparecienteDatoFuente.findMany({ where: { organization_id: organization.id,
        compareciente_id: compareciente.id, documento_id: document.id },
        select: { campo: true, pagina: true, fragmento_fuente: true, estado: true } }))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ campo: 'curp', pagina: 1, fragmento_fuente: 'GARA900101HDFRBC09', estado: 'PENDIENTE_CONFIRMACION' }),
          expect.objectContaining({ campo: 'curp_folio_documental', pagina: 1, fragmento_fuente: '12345678' }),
          expect.objectContaining({ campo: 'curp_fecha_inscripcion', pagina: 1, fragmento_fuente: '05/02/2026' }),
        ]));
      expect(await db.personaFisica.findUnique({ where: { compareciente_id: compareciente.id } })).toBeNull();
      expect(await db.auditLog.count({ where: { organization_id: organization.id,
        entidad_id: compareciente.id, accion: 'EXTRAER_DATOS_COMPARECIENTE_IA' } })).toBe(1);
      const sourceCount = await db.comparecienteDatoFuente.count({ where: {
        organization_id: organization.id, compareciente_id: compareciente.id, documento_id: document.id } });
      await asActor(() => service.extraerDocumentosExistentesConIA(compareciente.id, actor, suffix));
      expect(await db.comparecienteDatoFuente.count({ where: { organization_id: organization.id,
        compareciente_id: compareciente.id, documento_id: document.id } })).toBe(sourceCount);
      expect(await db.auditLog.count({ where: { organization_id: organization.id,
        entidad_id: compareciente.id, accion: 'EXTRAER_DATOS_COMPARECIENTE_IA' } })).toBe(1);
      await expect(service.extraerDocumentosExistentesConIA(compareciente.id,
        { ...actor, organizationId: randomUUID() }, randomUUID())).rejects.toThrow();
      });
    } finally { await db.$disconnect(); }
  });
});
