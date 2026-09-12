import { readFile } from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  analyzeCatalogUpload,
  assertSafeCatalogPath,
  CFG002_LIBRARY_SHA256,
  normalizeStandardLibraryDirectory,
  standardLegalMetadata,
  validateCatalogFile,
} from './configurationCatalogV4.domain';
import { createHash } from 'crypto';

const upload = (buffer: Buffer, originalname: string, mimetype = 'application/zip') => ({
  buffer, originalname, mimetype, size: buffer.length,
} as Express.Multer.File);

describe('CFG-002 v4 biblioteca legal e importación segura', () => {
  it('acepta el ZIP exacto, conserva carpetas y devuelve 40 documentos operativos', async () => {
    const buffer = await readFile(path.resolve(process.cwd(), 'resources/cfg002/PRAVIA_OS_CFG-002_Biblioteca_Estandar_v2_LEGAL.zip'));
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(CFG002_LIBRARY_SHA256);
    const directories: string[] = [];
    const files = await analyzeCatalogUpload([upload(buffer, 'library.zip')], false, directories);
    expect(files).toHaveLength(40);
    expect(files.filter((file) => file.path.includes('/NOTARIA/Plantillas/'))).toHaveLength(19);
    expect(files.filter((file) => file.path.includes('/NOTARIA/Formatos/'))).toHaveLength(21);
    expect(directories.some((item) => item.endsWith('NOTARIA/Formatos/PLD_UIF/Beneficiario_Controlador'))).toBe(true);
  });

  it('trata NOTARIA como raíz lógica y no la materializa como carpeta de Formatos', () => {
    expect(normalizeStandardLibraryDirectory('NOTARIA')).toEqual({ artifactType: 'FORMATO', segments: [] });
    expect(normalizeStandardLibraryDirectory('NOTARIA/Plantillas')).toEqual({ artifactType: 'PLANTILLA', segments: [] });
    expect(normalizeStandardLibraryDirectory('NOTARIA/Formatos')).toEqual({ artifactType: 'FORMATO', segments: [] });
    expect(normalizeStandardLibraryDirectory('NOTARIA/Formatos/PLD_UIF')).toEqual({ artifactType: 'FORMATO', segments: ['PLD_UIF'] });
  });

  it('rechaza traversal, rutas absolutas, nombres vacíos y extensiones/MIME incompatibles', () => {
    expect(() => assertSafeCatalogPath('../evil.docx')).toThrow(/ruta insegura/i);
    expect(() => assertSafeCatalogPath('/tmp/evil.docx')).toThrow(/absoluta/i);
    expect(() => assertSafeCatalogPath('a//b.docx')).toThrow(/insegura/i);
    expect(() => validateCatalogFile('evil.exe', Buffer.from('x'))).toThrow(/no está permitido/i);
    expect(() => validateCatalogFile('empty.pdf', Buffer.alloc(0))).toThrow(/vacío/i);
    expect(() => validateCatalogFile('file.pdf', Buffer.from('x'), 'image/png')).toThrow(/no coincide/i);
  });

  it('rechaza rutas duplicadas y ZIP Slip aunque JSZip normalice el nombre visible', async () => {
    await expect(analyzeCatalogUpload([
      upload(Buffer.from('uno'), 'a.txt', 'text/plain'),
      upload(Buffer.from('dos'), 'A.TXT', 'text/plain'),
    ])).rejects.toMatchObject({ code: 'CFG002_IMPORT_DUPLICATE_CONFLICT' });
    const zip = new JSZip();
    zip.file('../escape.txt', 'x');
    await expect(analyzeCatalogUpload([upload(await zip.generateAsync({ type: 'nodebuffer' }), 'unsafe.zip')])).rejects.toMatchObject({ code: 'CFG002_ARCHIVE_TRAVERSAL' });
  });

  it('modela A3/A5, A4/A6, A8 y controles reforzados sin cambiar valores por nombre libre', () => {
    expect(standardLegalMetadata('PLD-A3')).toMatchObject({
      tipo_cliente: 'FISICA',
      nacionalidad_condicion: 'MEXICANA_O_RESIDENTE',
      fundamento_normativo: 'LFPIORPI art. 18; RCG art. 12 fr. I; Anexo 3; Acuerdo 115/2026',
      vigencia_desde: null,
    });
    expect(standardLegalMetadata('PLD-A5')).toMatchObject({ tipo_cliente: 'FISICA', nacionalidad_condicion: 'EXTRANJERA_VISITANTE' });
    expect(standardLegalMetadata('PLD-A4')).toMatchObject({ tipo_cliente: 'MORAL', requiere_bc: true });
    expect(standardLegalMetadata('PLD-A6')).toMatchObject({ tipo_cliente: 'MORAL', requiere_bc: true });
    expect(standardLegalMetadata('PLD-A8')).toMatchObject({ tipo_cliente: 'FIDEICOMISO', requiere_bc: true });
    expect(standardLegalMetadata('PLD-A4BIS')).toMatchObject({ tipo_cliente: 'MORAL_DERECHO_PUBLICO' });
    expect(standardLegalMetadata('PLD-A6BIS')).toMatchObject({ tipo_cliente: 'ORGANISMO_INTERNACIONAL' });
    expect(standardLegalMetadata('PLD-A7')).toMatchObject({ regimen_simplificado: true, condiciones: expect.objectContaining({ risk_level: 'BAJO' }) });
    expect(standardLegalMetadata('PLD-NOT-001')).toMatchObject({ condiciones: { solicitante_material_aplicable_confirmado: true } });
    expect(standardLegalMetadata('PLD-PEP-001')).toMatchObject({ requiere_pep: true });
    expect(standardLegalMetadata('PLD-ALTO-001')).toMatchObject({ requiere_alto_riesgo: true });
    expect(standardLegalMetadata('archivo-que-parece-pep')).toMatchObject({ fundamento_normativo: 'REQUIERE CONFIGURACIÓN Y VALIDACIÓN JURÍDICA DE LA NOTARÍA' });
    expect(standardLegalMetadata('archivo-que-parece-pep')).not.toHaveProperty('requiere_pep');
  });
});
