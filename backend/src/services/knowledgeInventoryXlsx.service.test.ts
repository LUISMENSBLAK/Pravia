import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readKnowledgeInventoryXlsx } from './knowledgeInventoryXlsx.service';

const xmlEscape = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const excelColumn = (index: number) => {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

async function createSyntheticInventoryFixture(destination: string) {
  const header = [
    'Código', 'Jurisdicción', 'Prioridad', 'Categoría', 'Título', 'Materia', 'Uso en PRAVIA',
    'Reforma/Corte', 'Autoridad', 'Publicación oficial', 'URL', 'Acción', 'Observaciones',
  ];
  const pendingActions = new Map([
    ['NAY-006', 'OBTENER ORIGINAL OFICIAL'],
    ['NAY-008', 'OBTENER TEXTO OFICIAL'],
    ['NAY-010', 'OBTENER ORIGINAL OFICIAL'],
    ['NAY-025', 'OBTENER TEXTO OFICIAL'],
  ]);
  const rows = [
    header,
    ...[
      ...Array.from({ length: 25 }, (_, index) => ({ jurisdiction: 'NAYARIT', prefix: 'NAY', ordinal: index + 1 })),
      ...Array.from({ length: 25 }, (_, index) => ({ jurisdiction: 'JALISCO', prefix: 'JAL', ordinal: index + 1 })),
      ...Array.from({ length: 35 }, (_, index) => ({ jurisdiction: 'FEDERAL', prefix: 'FED', ordinal: index + 1 })),
    ].map((source, index) => {
      const code = `${source.prefix}-${String(source.ordinal).padStart(3, '0')}`;
      return [
        code, source.jurisdiction, index < 51 ? 'A' : 'B', 'NORMATIVA', `Fuente sintética ${code}`,
        'QA', 'Validación de importación', '', 'Autoridad sintética', '', `https://example.test/${code}`,
        pendingActions.get(code) ?? 'INGESTAR', 'Fixture sintético sin contenido jurídico',
      ];
    }),
  ];
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => (
      `<c r="${excelColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
    )).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');

  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="FUENTES" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
  await fs.writeFile(destination, await zip.generateAsync({ type: 'nodebuffer' }));
}

let fixtureDirectory = '';
let fixture = '';

beforeAll(async () => {
  fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pravia-knowledge-inventory-'));
  fixture = path.join(fixtureDirectory, 'inventario-sintetico.xlsx');
  await createSyntheticInventoryFixture(fixture);
});

afterAll(async () => {
  if (fixtureDirectory) await fs.rm(fixtureDirectory, { recursive: true, force: true });
});

describe('inventario maestro KNOW-001', () => {
  it('lee exactamente 85 fuentes sin duplicar códigos', async () => {
    const rows = await readKnowledgeInventoryXlsx(fixture);
    expect(rows).toHaveLength(85);
    expect(new Set(rows.map((row) => row.inventory_code)).size).toBe(85);
  });

  it('conserva los conteos jurisdiccionales vinculantes', async () => {
    const rows = await readKnowledgeInventoryXlsx(fixture);
    expect(Object.fromEntries(['NAYARIT', 'JALISCO', 'FEDERAL'].map((key) => [
      key, rows.filter((row) => row.jurisdiction === key).length,
    ]))).toEqual({ NAYARIT: 25, JALISCO: 25, FEDERAL: 35 });
  });

  it('conserva 51 fuentes prioridad A', async () => {
    expect((await readKnowledgeInventoryXlsx(fixture)).filter((row) => row.priority === 'A')).toHaveLength(51);
  });

  it('bloquea las cuatro fuentes sin original o texto oficial', async () => {
    expect((await readKnowledgeInventoryXlsx(fixture))
      .filter((row) => row.ingestion_status.startsWith('PENDIENTE_'))
      .map((row) => row.inventory_code))
      .toEqual(['NAY-006', 'NAY-008', 'NAY-010', 'NAY-025']);
  });

  it('no marca ninguna metadata como versión legal verificada', async () => {
    expect((await readKnowledgeInventoryXlsx(fixture)).every((row) => !('verification_status' in row))).toBe(true);
  });
});
