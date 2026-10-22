import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { inspectCsvFile, inspectZipFile, scanMigrationSourceFile, streamCsvRecords, verifyMultipartSource } from './migrationStreaming.service';
import { parseXlsx } from './migrationEngine.service';
import type { StorageProvider } from '../storage/storage.types';

describe('migration streaming CSV parser', () => {
  it('preserves quoted multiline fields and counts every non-empty data row', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pravia-csv-test-'));
    const filename = path.join(directory, 'source.csv');
    const body = Buffer.from('\uFEFFid,nombre,nota\n1,Ana,"línea 1\nlínea 2"\n2,"Luis ""L""",ok\n', 'utf8');
    try {
      await writeFile(filename, body);
      const inspected = await inspectCsvFile(
        filename,
        'source.csv',
        createHash('sha256').update(body).digest('hex'),
        body.byteLength,
      );
      expect(inspected).toMatchObject({ headers: ['id', 'nombre', 'nota'], records: 2 });
      const rows: string[][] = [];
      for await (const row of streamCsvRecords(filename)) rows.push(row);
      expect(rows).toEqual([
        ['id', 'nombre', 'nota'],
        ['1', 'Ana', 'línea 1\nlínea 2'],
        ['2', 'Luis "L"', 'ok'],
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('migration XLSX parser', () => {
  it('reads the first worksheet headers and record count without inventing mappings', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/sharedStrings.xml', '<sst><si><t>id</t></si><si><t>nombre</t></si><si><t>legacy-1</t></si><si><t>Ana</t></si><si><t>legacy-2</t></si><si><t>Luis</t></si></sst>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row><row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c></row></sheetData></worksheet>');
    const workbook = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(parseXlsx(workbook)).resolves.toEqual({ headers: ['id', 'nombre'], records: 2 });
  });
});

describe('migration source integrity', () => {
  it('rejects the EICAR test signature and an executable disguised as a migration source', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pravia-signature-test-'));
    const eicar = path.join(directory, 'source.csv');
    const executable = path.join(directory, 'source.xlsx');
    try {
      await writeFile(eicar, Buffer.from('id,nombre\n1,"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"\n', 'latin1'));
      await expect(scanMigrationSourceFile(eicar)).rejects.toMatchObject({ code: 'MIGRATION_MALWARE_DETECTED' });
      await writeFile(executable, Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]));
      await expect(scanMigrationSourceFile(executable)).rejects.toMatchObject({ code: 'MIGRATION_EXECUTABLE_BLOCKED' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a corrupted part and a wrong whole-file checksum before analysis', async () => {
    const original = Buffer.from('id,nombre\n1,Ana\n');
    let stored = Buffer.from(original);
    const provider = { download: async () => Buffer.from(stored) } as StorageProvider;
    const part = [{ part_number: 1, size_bytes: original.length,
      checksum_sha256: createHash('sha256').update(original).digest('hex'), provider_etag: 'qa-part' }];
    const correctSha = part[0].checksum_sha256;
    stored = Buffer.from('id,nombre\n2,Ana\n');
    await expect(verifyMultipartSource(provider, part, () => 'qa-part', BigInt(original.length), correctSha))
      .rejects.toMatchObject({ code: 'MIGRATION_UPLOAD_PART_CORRUPT' });
    stored = Buffer.from(original);
    await expect(verifyMultipartSource(provider, part, () => 'qa-part', BigInt(original.length), '0'.repeat(64)))
      .rejects.toMatchObject({ code: 'MIGRATION_UPLOAD_CHECKSUM_MISMATCH' });
    await expect(verifyMultipartSource(provider, part, () => 'qa-part', BigInt(original.length)))
      .resolves.toEqual({ bytes: BigInt(original.length), sha256: correctSha });
  });

  it('rejects a ZIP entry whose raw path traverses outside the archive', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pravia-zip-test-'));
    const filename = path.join(directory, 'source.zip');
    try {
      const zip = new JSZip();
      zip.file('aa/evil.pdf', Buffer.from('%PDF-1.4\n'));
      const bytes = await zip.generateAsync({ type: 'nodebuffer' });
      const poisoned = Buffer.from(bytes);
      let replacements = 0;
      for (let index = 0; index <= poisoned.length - 11; index += 1) {
        if (poisoned.subarray(index, index + 11).toString('utf8') === 'aa/evil.pdf') {
          poisoned.write('../evil.pdf', index, 'utf8');
          replacements += 1;
        }
      }
      expect(replacements).toBeGreaterThanOrEqual(2);
      await writeFile(filename, poisoned);
      await expect(inspectZipFile(filename, BigInt(poisoned.length))).rejects.toMatchObject({ code: 'MIGRATION_ARCHIVE_PATH_TRAVERSAL' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects an EICAR signature compressed inside an otherwise valid ZIP entry', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pravia-zip-signature-test-'));
    const filename = path.join(directory, 'source.zip');
    try {
      const zip = new JSZip();
      zip.file('evidence.pdf', Buffer.from('%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n', 'latin1'));
      const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      await writeFile(filename, bytes);
      await expect(inspectZipFile(filename, BigInt(bytes.length))).rejects.toMatchObject({ code: 'MIGRATION_MALWARE_DETECTED' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('classifies an over-expanded ZIP bomb before extracting an entry', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pravia-zip-expansion-test-'));
    const filename = path.join(directory, 'source.zip');
    try {
      const zip = new JSZip();
      zip.file('large.txt', Buffer.alloc(1024 * 1024, 65));
      const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      expect(BigInt(1024 * 1024)).toBeGreaterThan(BigInt(bytes.length) * 20n);
      await writeFile(filename, bytes);
      await expect(inspectZipFile(filename, BigInt(bytes.length)))
        .rejects.toMatchObject({ code: 'MIGRATION_ARCHIVE_EXPANSION_LIMIT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
