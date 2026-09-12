import { createHash } from 'crypto';
import JSZip from 'jszip';
import { CatalogConfigurationError } from './configurationCatalogError';

export const CFG002_LIBRARY_CODE = 'PRAVIA_CFG002_STANDARD';
export const CFG002_LIBRARY_VERSION = 'v2-LEGAL';
export const CFG002_LIBRARY_SHA256 = '52de78a24956643b8f39556ccc04aa778ddcd011966590ced840316c5a80733a';
export const CFG002_MAX_FILES = 100;
export const CFG002_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const CFG002_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const CFG002_MAX_COMPRESSION_RATIO = 100;

const allowedExtensions = new Set(['docx', 'pdf', 'xlsx', 'xls', 'odt', 'txt', 'rtf']);
const ignoredPackageFiles = new Set(['CFG-002_Instruccion_Codex_v4.0_LEGAL.docx', 'FUENTES_Y_CRITERIOS_2026.txt']);

export type SafeCatalogFile = {
  path: string;
  name: string;
  extension: string;
  mimeType: string;
  buffer: Buffer;
  checksum: string;
  size: number;
};

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const mimeFor = (extension: string) => ({
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel', odt: 'application/vnd.oasis.opendocument.text',
  txt: 'text/plain', rtf: 'application/rtf',
}[extension] || 'application/octet-stream');

export function assertSafeCatalogPath(rawPath: string) {
  const path = rawPath.normalize('NFC').replace(/\\/g, '/');
  if (!path || path.startsWith('/') || /^[A-Za-z]:\//.test(path) || path.includes('\0')) {
    throw new CatalogConfigurationError(400, 'CFG002_ARCHIVE_ABSOLUTE_PATH', 'El archivo contiene una ruta absoluta o inválida.');
  }
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new CatalogConfigurationError(400, 'CFG002_ARCHIVE_TRAVERSAL', 'El archivo contiene una ruta insegura.');
  }
  return parts.join('/');
}

export function validateCatalogFile(path: string, buffer: Buffer, declaredMime?: string): SafeCatalogFile {
  const safePath = assertSafeCatalogPath(path);
  const name = safePath.split('/').at(-1)!;
  const extension = name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '';
  if (!allowedExtensions.has(extension)) throw new CatalogConfigurationError(400, 'CFG002_FILE_EXTENSION_FORBIDDEN', `El tipo .${extension || '(sin extensión)'} no está permitido.`);
  if (!buffer.length) throw new CatalogConfigurationError(400, 'CFG002_FILE_EMPTY', `${name} está vacío.`);
  if (buffer.length > CFG002_MAX_FILE_BYTES) throw new CatalogConfigurationError(413, 'CFG002_FILE_TOO_LARGE', `${name} supera 25 MB.`);
  const expectedMime = mimeFor(extension);
  if (declaredMime && declaredMime !== 'application/octet-stream' && ![expectedMime, 'application/zip', 'application/x-zip-compressed'].includes(declaredMime)) {
    throw new CatalogConfigurationError(400, 'CFG002_FILE_MIME_CONFLICT', `${name} no coincide con el tipo de archivo declarado.`);
  }
  return { path: safePath, name, extension, mimeType: expectedMime, buffer, checksum: sha256(buffer), size: buffer.length };
}

export async function analyzeCatalogUpload(files: Express.Multer.File[], includePackageMetadata = false, directoryCollector: string[] = []): Promise<SafeCatalogFile[]> {
  if (!files.length) throw new CatalogConfigurationError(400, 'CFG002_IMPORT_FILES_REQUIRED', 'Selecciona archivos o un ZIP.');
  const result: SafeCatalogFile[] = [];
  for (const file of files) {
    const lower = file.originalname.toLowerCase();
    if (lower.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(file.buffer, { createFolders: true, checkCRC32: true });
      const entries = Object.values(zip.files);
      if (entries.length > CFG002_MAX_FILES + 40) throw new CatalogConfigurationError(413, 'CFG002_ARCHIVE_ENTRY_LIMIT', 'El ZIP contiene demasiadas entradas.');
      for (const entry of entries) {
        const unsafeName = (entry as any).unsafeOriginalName || entry.name;
        if (entry.dir) {
          const directory = assertSafeCatalogPath(unsafeName.replace(/\/$/, '') || 'root');
          if (!directoryCollector.includes(directory)) directoryCollector.push(directory);
          continue;
        }
        const unixMode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : parseInt(String(entry.unixPermissions || '0'), 10);
        if ((unixMode & 0o170000) === 0o120000) throw new CatalogConfigurationError(400, 'CFG002_ARCHIVE_SYMLINK', 'El ZIP contiene un enlace simbólico no permitido.');
        const path = assertSafeCatalogPath(unsafeName);
        if (!includePackageMetadata && ignoredPackageFiles.has(path.split('/').at(-1)!)) continue;
        const buffer = await entry.async('nodebuffer');
        const compressedSize = Number((entry as any)._data?.compressedSize || 0);
        if (compressedSize > 0 && buffer.length / compressedSize > CFG002_MAX_COMPRESSION_RATIO) throw new CatalogConfigurationError(413, 'CFG002_ARCHIVE_RATIO_LIMIT', `${path} excede la relación de compresión permitida.`);
        result.push(validateCatalogFile(path, buffer));
      }
    } else {
      result.push(validateCatalogFile(file.originalname, file.buffer, file.mimetype));
    }
  }
  if (result.length > CFG002_MAX_FILES) throw new CatalogConfigurationError(413, 'CFG002_IMPORT_FILE_LIMIT', 'La importación supera 100 archivos.');
  if (result.reduce((sum, file) => sum + file.size, 0) > CFG002_MAX_TOTAL_BYTES) throw new CatalogConfigurationError(413, 'CFG002_IMPORT_TOTAL_LIMIT', 'La importación supera 100 MB descomprimidos.');
  const seen = new Map<string, string>();
  for (const file of result) {
    const key = file.path.normalize('NFC').toLocaleLowerCase('es-MX');
    const previous = seen.get(key);
    if (previous && previous !== file.checksum) throw new CatalogConfigurationError(409, 'CFG002_IMPORT_DUPLICATE_CONFLICT', `La ruta ${file.path} aparece con contenidos diferentes.`);
    if (previous) throw new CatalogConfigurationError(409, 'CFG002_IMPORT_DUPLICATE_PATH', `La ruta ${file.path} está duplicada.`);
    seen.set(key, file.checksum);
  }
  return result;
}

export const catalogTree = (files: SafeCatalogFile[]) => files.map(({ buffer: _buffer, ...file }) => ({
  ...file,
  folders: file.path.split('/').slice(0, -1),
}));

export function normalizeStandardLibraryDirectory(directory: string) {
  let relative = directory.replace(/^NOTARIA(?:\/|$)/, '');
  const artifactType = relative === 'Plantillas' || relative.startsWith('Plantillas/') ? 'PLANTILLA' : 'FORMATO';
  relative = relative.replace(/^(Plantillas|Formatos)(?:\/|$)/, '');
  return { artifactType, segments: relative ? relative.split('/') : [] } as const;
}

export function artifactCodeFromPath(path: string) {
  const name = path.split('/').at(-1)!.replace(/\.[^.]+$/, '');
  return name.match(/^(PRY-\d{3}|ADM-\d{3}|PLD-[A-Z0-9]+(?:-\d{3})?)/)?.[1] || `USR-${sha256(Buffer.from(path)).slice(0, 16).toUpperCase()}`;
}

export type LegalMetadata = {
  fundamento_normativo: string;
  version_normativa: string;
  tipo_cliente?: string | null;
  nacionalidad_condicion?: string | null;
  regimen_simplificado?: boolean | null;
  actividad_vulnerable?: boolean | null;
  requiere_bc?: boolean;
  requiere_riesgo?: boolean;
  requiere_pep?: boolean;
  requiere_perfil?: boolean;
  requiere_alto_riesgo?: boolean;
  vigencia_desde?: string | null;
  condiciones?: Record<string, unknown>;
};

const legalFoundations: Record<string, string> = {
  'PLD-A3': 'LFPIORPI art. 18; RCG art. 12 fr. I; Anexo 3; Acuerdo 115/2026',
  'PLD-A4': 'LFPIORPI art. 18; RCG art. 12 fr. II; Anexo 4; Acuerdo 115/2026',
  'PLD-A4BIS': 'RCG art. 12 fr. II Bis; Anexo 4 Bis; Acuerdo 115/2026',
  'PLD-A5': 'LFPIORPI art. 18; RCG art. 12 fr. III; Anexo 5; Acuerdo 115/2026',
  'PLD-A6': 'RCG art. 12 fr. IV; Anexo 6; Acuerdo 115/2026',
  'PLD-A6BIS': 'RCG art. 12 fr. IV Bis; Anexo 6 Bis; Acuerdo 115/2026',
  'PLD-A7': 'RCG art. 12 fr. V; Anexos 7 y 7-A; clasificación previa como bajo riesgo',
  'PLD-A7BIS': 'RCG art. 12 fr. V Bis; Anexos 7 Bis y 7 Bis-A',
  'PLD-A8': 'RCG art. 12 fr. VI; Anexo 8; Acuerdo 115/2026',
  'PLD-BC-001': 'LFPIORPI art. 18 fr. III; RCG arts. 12 fr. VII, 23 Quinquies a 23 Quinquies 3; formato SAT de identificación del Beneficiario Controlador',
  'PLD-BC-002': 'RCG arts. 23 Quinquies y 23 Quinquies 1',
  'PLD-RSK-001': 'RCG arts. 23 Bis a 23 Bis 4; Acuerdo 115/2026',
  'PLD-KYC-001': 'RCG arts. 23 Ter y 23 Ter 1; para acto único, el perfil se integra con la información de ese acto',
  'PLD-PEP-001': 'RCG arts. 23 Bis 3, 23 Bis 4, 23 Quáter a 23 Quáter 2 y 23 Ter 5',
  'PLD-ALTO-001': 'RCG arts. 23 Ter 3 y 23 Ter 4',
  'PLD-NOT-001': 'RCG art. 13 vigente: identificación de quien solicita materialmente la protocolización o formalización',
  'PLD-NOT-002': 'LFPIORPI, RCG y obligaciones de integración/soporte aplicables al acto',
  'PLD-NOT-003': 'RCG arts. 12, 13, 23 Bis, 23 Ter, 23 Quáter, 23 Quinquies y correlativos vigentes',
};

const baseLegal = (code: string, condition: string): LegalMetadata => ({
  fundamento_normativo: legalFoundations[code] || 'REQUIERE CONFIGURACIÓN Y VALIDACIÓN JURÍDICA DE LA NOTARÍA',
  version_normativa: 'Biblioteca estándar CFG-002 v2 LEGAL (2026)',
  vigencia_desde: null,
  condiciones: { decision: 'DECLARATIVE_CONFIRMED_FACTS_ONLY', condition, source_document_code: code },
});

export const hasStandardLegalApplicability = (code: string) => Object.prototype.hasOwnProperty.call(legalFoundations, code);

export function standardLegalMetadata(code: string): LegalMetadata {
  const metadata = baseLegal(code, hasStandardLegalApplicability(code) ? 'DOCUMENTED_STANDARD' : 'CONFIGURABLE');
  if (code === 'PLD-A3') return { ...metadata, tipo_cliente: 'FISICA', nacionalidad_condicion: 'MEXICANA_O_RESIDENTE', actividad_vulnerable: true, condiciones: { tipo_persona: 'FISICA', residencia: ['MEXICANA', 'RESIDENTE'], mutually_exclusive_with: ['PLD-A5'] } };
  if (code === 'PLD-A5') return { ...metadata, tipo_cliente: 'FISICA', nacionalidad_condicion: 'EXTRANJERA_VISITANTE', actividad_vulnerable: true, condiciones: { tipo_persona: 'FISICA', residencia: ['EXTRANJERA_VISITANTE'], mutually_exclusive_with: ['PLD-A3'] } };
  if (code === 'PLD-A4') return { ...metadata, tipo_cliente: 'MORAL', nacionalidad_condicion: 'MEXICANA', actividad_vulnerable: true, requiere_bc: true, condiciones: { tipo_persona: 'MORAL', nacionalidad: ['MEXICANA'] } };
  if (code === 'PLD-A6') return { ...metadata, tipo_cliente: 'MORAL', nacionalidad_condicion: 'EXTRANJERA', actividad_vulnerable: true, requiere_bc: true, condiciones: { tipo_persona: 'MORAL', nacionalidad: ['EXTRANJERA'] } };
  if (code === 'PLD-A4BIS') return { ...metadata, tipo_cliente: 'MORAL_DERECHO_PUBLICO', actividad_vulnerable: true, condiciones: { persona_moral_derecho_publico_confirmada: true } };
  if (code === 'PLD-A6BIS') return { ...metadata, tipo_cliente: 'ORGANISMO_INTERNACIONAL', actividad_vulnerable: true, condiciones: { organismo_internacional_confirmado: true } };
  if (code === 'PLD-A8') return { ...metadata, tipo_cliente: 'FIDEICOMISO', actividad_vulnerable: true, requiere_bc: true, condiciones: { fideicomiso_aplicable_confirmado: true } };
  if (code === 'PLD-A7' || code === 'PLD-A7BIS') return { ...metadata, regimen_simplificado: true, actividad_vulnerable: true, condiciones: { regimen_simplificado_confirmado: true, risk_level: 'BAJO' } };
  if (code.startsWith('PLD-BC-')) return { ...metadata, actividad_vulnerable: true, requiere_bc: true, condiciones: { compliance_source: 'BENEFICIAL_CONTROLLER_CONFIRMED' } };
  if (code === 'PLD-RSK-001') return { ...metadata, actividad_vulnerable: true, requiere_riesgo: true, condiciones: { compliance_source: 'RISK_METHODOLOGY_CONFIRMED' } };
  if (code === 'PLD-KYC-001') return { ...metadata, actividad_vulnerable: true, requiere_perfil: true, condiciones: { compliance_source: 'TRANSACTIONAL_PROFILE_APPLICABLE' } };
  if (code === 'PLD-PEP-001') return { ...metadata, actividad_vulnerable: true, requiere_pep: true, condiciones: { compliance_source: 'PEP_REVIEW_APPLICABLE' } };
  if (code === 'PLD-ALTO-001') return { ...metadata, actividad_vulnerable: true, requiere_alto_riesgo: true, condiciones: { compliance_source: 'RISK_LEVEL_CONFIRMED', risk_level: 'ALTO' } };
  if (code === 'PLD-NOT-001') return { ...metadata, actividad_vulnerable: true, condiciones: { solicitante_material_aplicable_confirmado: true } };
  if (code === 'PLD-NOT-002' || code === 'PLD-NOT-003') return { ...metadata, actividad_vulnerable: true, condiciones: { actividad_vulnerable_confirmada: true } };
  return metadata;
}
