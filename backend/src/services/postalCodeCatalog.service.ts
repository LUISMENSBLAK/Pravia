import fs from 'fs/promises';

export type PostalCodeImportRow = {
  postal_code: string;
  settlement: string;
  settlement_type: string | null;
  municipality: string;
  state: string;
  city: string | null;
  state_code: string;
  office_code: string | null;
  administration_cp: string | null;
  settlement_type_code: string | null;
  municipality_code: string;
  settlement_code: string;
  city_code: string | null;
  zone: string | null;
};

const value = (cells: string[], header: Map<string, number>, name: string) => {
  const index = header.get(name.toLowerCase());
  return index === undefined ? '' : String(cells[index] || '').trim();
};

export function parseSepomexTxt(buffer: Buffer): PostalCodeImportRow[] {
  const decoded = new TextDecoder('windows-1252').decode(buffer).replace(/^\uFEFF/, '');
  const lines = decoded.split(/\r?\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => line.toLowerCase().startsWith('d_codigo|'));
  if (headerIndex < 0 || lines.length <= headerIndex + 1) throw new Error('El TXT SEPOMEX no contiene registros.');
  const headers = lines[headerIndex].split('|').map((item) => item.trim().toLowerCase());
  const header = new Map(headers.map((item, index) => [item, index]));
  for (const required of ['d_codigo', 'd_asenta', 'd_mnpio', 'd_estado']) {
    if (!header.has(required)) throw new Error(`El TXT SEPOMEX no contiene la columna ${required}.`);
  }
  const rows = lines.slice(headerIndex + 1).map((line) => {
    const cells = line.split('|');
    return {
      postal_code: value(cells, header, 'd_codigo').padStart(5, '0'),
      settlement: value(cells, header, 'd_asenta'),
      settlement_type: value(cells, header, 'd_tipo_asenta') || null,
      municipality: value(cells, header, 'd_mnpio'),
      state: value(cells, header, 'd_estado'),
      city: value(cells, header, 'd_ciudad') || null,
      state_code: value(cells, header, 'c_estado'),
      office_code: value(cells, header, 'c_oficina') || null,
      administration_cp: value(cells, header, 'd_cp') || null,
      settlement_type_code: value(cells, header, 'c_tipo_asenta') || null,
      municipality_code: value(cells, header, 'c_mnpio'),
      settlement_code: value(cells, header, 'id_asenta_cpcons'),
      city_code: value(cells, header, 'c_cve_ciudad') || null,
      zone: value(cells, header, 'd_zona') || null,
    };
  });
  const invalid = rows.find((row) => !/^\d{5}$/.test(row.postal_code) || !row.settlement || !row.municipality || !row.state || !row.state_code || !row.municipality_code || !row.settlement_code);
  if (invalid) throw new Error('El TXT SEPOMEX contiene un registro incompleto o un código postal inválido.');
  return rows;
}

export async function readSepomexTxt(path: string) {
  return parseSepomexTxt(await fs.readFile(path));
}
