import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { uploadFile } from '../src/storage/storage.service';

const prisma = new PrismaClient();
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const uuidFrom = (value: string) => {
  const hex = digest(value).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
};

const dossierRoot = path.resolve(process.env.QA_DOSSIER_ROOT || '');
const convertedLegacy = process.env.QA_CONVERTED_LEGACY_DOCX ? path.resolve(process.env.QA_CONVERTED_LEGACY_DOCX) : null;
const extractionRoot = path.resolve(process.env.QA_EXTRACTION_ROOT || '/private/tmp');
const storageRoot = path.resolve(process.env.LOCAL_STORAGE_PATH || '');
const databaseUrl = new URL(process.env.DATABASE_URL || '');
const expectedDatabase = process.env.QA_EXPECTED_DATABASE || '';
const expectedPort = process.env.QA_EXPECTED_DATABASE_PORT || '55433';
const organizationId = process.env.QA_ORGANIZATION_ID || '30000000-0000-4000-8000-000000000001';
const actorId = process.env.QA_ACTOR_ID || '30000000-0000-4000-8000-000000000002';
const expedienteId = process.env.QA_EXPEDIENTE_ID || '7a139000-0000-4000-8000-000000000001';

function assertSafety() {
  if (process.env.E2E_ALLOW_MUTATIONS !== 'isolated-database-confirmed') throw new Error('QA_DOSSIER_MUTATION_GATE_FAILED');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname) || databaseUrl.port !== expectedPort || databaseUrl.pathname.slice(1) !== expectedDatabase) {
    throw new Error('QA_DOSSIER_DATABASE_SAFETY_GATE_FAILED');
  }
  if (process.env.STORAGE_MODE !== 'local' || !storageRoot.startsWith('/private/tmp/') || storageRoot === '/private/tmp') {
    throw new Error('QA_DOSSIER_STORAGE_SAFETY_GATE_FAILED');
  }
  if (!dossierRoot.startsWith('/tmp/') || !extractionRoot.startsWith('/private/tmp')) throw new Error('QA_DOSSIER_PATH_SAFETY_GATE_FAILED');
}

const fieldMap = (payload: any) => {
  const result = new Map<string, string[]>();
  for (const item of payload?.result?.campos || []) {
    const key = String(item?.campo || '').trim();
    const value = String(item?.valor ?? '').trim();
    if (!key || !value) continue;
    result.set(key, [...new Set([...(result.get(key) || []), value])]);
  }
  return result;
};
const unambiguous = (fields: Map<string, string[]>, key: string) => fields.get(key)?.length === 1 ? fields.get(key)![0] : null;
const compact = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== '')) as T;
const parseDate = (value: string | null) => {
  if (!value) return null;
  const normalized = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)?.slice(1);
  const parsed = normalized ? new Date(`${normalized[2]}-${normalized[1].padStart(2, '0')}-${normalized[0].padStart(2, '0')}T00:00:00.000Z`) : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};
const decimal = (value: string | null) => {
  if (!value) return null;
  const parsed = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  return /^-?\d+(?:\.\d+)?$/.test(parsed) ? new Prisma.Decimal(parsed) : null;
};
const mime = (file: string) => ({
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
}[path.extname(file).toLowerCase()] || 'application/octet-stream');

async function readExtractions() {
  const result = new Map<string, any[]>();
  for (const name of await fs.readdir(extractionRoot)) {
    if (!/^pravia-zantamar-.*\.json$/.test(name)) continue;
    const payload = JSON.parse(await fs.readFile(path.join(extractionRoot, name), 'utf8'));
    for (const document of payload.documents || []) {
      const base = path.basename(String(document?.name || document?.id || '')).toLocaleLowerCase('es-MX');
      if (!base) continue;
      result.set(base, [...(result.get(base) || []), { extraction_file: name, mode: payload.mode, result: payload.result }]);
    }
  }
  return result;
}

async function payload(name: string) {
  return JSON.parse(await fs.readFile(path.join(extractionRoot, name), 'utf8'));
}

async function setupStructuredMasters() {
  const [sellerPayload, companyPayload, representativePayload, appraisalPayload, taxPayload, cnaPayload, clgPayload] = await Promise.all([
    payload('pravia-zantamar-identity-seller.json'), payload('pravia-zantamar-identity-company.json'),
    payload('pravia-zantamar-identity-representative.json'), payload('pravia-zantamar-property-appraisal.json'),
    payload('pravia-zantamar-property-tax.json'), payload('pravia-zantamar-property-cna.json'), payload('pravia-zantamar-property-clg.json'),
  ]);
  const seller = fieldMap(sellerPayload); const company = fieldMap(companyPayload); const representative = fieldMap(representativePayload);
  const appraisal = fieldMap(appraisalPayload); const tax = fieldMap(taxPayload); const cna = fieldMap(cnaPayload); const clg = fieldMap(clgPayload);
  const fullName = (fields: Map<string, string[]>) => [unambiguous(fields, 'nombre'), unambiguous(fields, 'apellido_paterno'), unambiguous(fields, 'apellido_materno')].filter(Boolean).join(' ').trim();
  const sellerName = fullName(seller); const representativeName = fullName(representative); const companyName = unambiguous(company, 'razon_social');
  if (!sellerName || !representativeName || !companyName) throw new Error('QA_DOSSIER_IDENTITY_EXTRACTION_INCOMPLETE');

  const ids = {
    seller: uuidFrom('qa-zantamar-seller'), sellerPerson: uuidFrom('qa-zantamar-seller-person'),
    company: uuidFrom('qa-zantamar-company'), companyPerson: uuidFrom('qa-zantamar-company-person'),
    representative: uuidFrom('qa-zantamar-representative'), representativePerson: uuidFrom('qa-zantamar-representative-person'),
    act: uuidFrom('qa-zantamar-act'), property: uuidFrom('qa-zantamar-property'), propertyLink: uuidFrom('qa-zantamar-property-link'),
  };
  const canonicalActType = await prisma.tipoActo.findFirstOrThrow({
    where: { nombre: { equals: 'Compraventa', mode: 'insensitive' }, organization_id: null },
  });
  const actType = canonicalActType.activo && !canonicalActType.archived_at
    ? canonicalActType
    : await prisma.tipoActo.update({ where: { id: canonicalActType.id }, data: { activo: true, archived_at: null } });
  const sellerRole = await prisma.caracterCompareciente.upsert({ where: { clave: 'VENDEDOR' }, update: { activo: true }, create: { clave: 'VENDEDOR', nombre: 'Vendedor' } });
  const buyerRole = await prisma.caracterCompareciente.upsert({ where: { clave: 'COMPRADOR' }, update: { activo: true }, create: { clave: 'COMPRADOR', nombre: 'Comprador' } });
  const representativeRole = await prisma.caracterCompareciente.upsert({ where: { clave: 'REPRESENTANTE_LEGAL' }, update: { activo: true }, create: { clave: 'REPRESENTANTE_LEGAL', nombre: 'Representante legal' } });

  await prisma.expediente.upsert({
    where: { id: expedienteId },
    update: { organization_id: organizationId, cliente_alias: sellerName, descripcion: 'Compraventa inmobiliaria — dossier integral local QA', tipo_acto_id: actType.id, abogado_id: actorId, creador_id: actorId },
    create: { id: expedienteId, organization_id: organizationId, numero_pravia: 'EXP-0139-2026', cliente_alias: sellerName, descripcion: 'Compraventa inmobiliaria — dossier integral local QA', tipo_acto_id: actType.id, abogado_id: actorId, creador_id: actorId, estatus: 'EN_PROCESO' },
  });
  await prisma.expedienteActo.upsert({
    where: { id: ids.act }, update: { estatus: 'ACTIVO', removed_at: null },
    create: { id: ids.act, organization_id: organizationId, expediente_id: expedienteId, tipo_acto_id: actType.id, origen: 'ADICIONAL', created_by: actorId, idempotency_key: 'qa-zantamar-compraventa' },
  });

  const person = async (comparecienteId: string, personId: string, fields: Map<string, string[]>, name: string) => {
    await prisma.compareciente.upsert({ where: { id: comparecienteId }, update: { nombre_busqueda: name, estatus: 'ACTIVO' }, create: { id: comparecienteId, organization_id: organizationId, tipo_persona: 'FISICA', nombre_busqueda: name, creado_por_id: actorId, observaciones: 'Datos propuestos por IA y conservados sin marcar como validados en QA local.' } });
    const sexo = String(unambiguous(fields, 'sexo') || '').toUpperCase();
    const civil = String(unambiguous(fields, 'estado_civil') || '').toUpperCase().replace(/\s+/g, '_');
    await prisma.personaFisica.upsert({ where: { compareciente_id: comparecienteId }, update: compact({ nombre: unambiguous(fields, 'nombre') || name, apellido_paterno: unambiguous(fields, 'apellido_paterno'), apellido_materno: unambiguous(fields, 'apellido_materno'), nombre_completo_calculado: name, curp: unambiguous(fields, 'curp'), rfc: unambiguous(fields, 'rfc'), fecha_nacimiento: parseDate(unambiguous(fields, 'fecha_nacimiento')), lugar_nacimiento: unambiguous(fields, 'lugar_nacimiento'), nacionalidad: unambiguous(fields, 'nacionalidad'), pais_nacimiento: unambiguous(fields, 'pais_nacimiento'), ocupacion: unambiguous(fields, 'ocupacion'), sexo: ['MASCULINO', 'FEMENINO', 'OTRO'].includes(sexo) ? sexo as any : undefined, estado_civil: ['SOLTERO', 'CASADO', 'DIVORCIADO', 'VIUDO', 'UNION_LIBRE', 'OTRO'].includes(civil) ? civil as any : undefined }), create: compact({ id: personId, organization_id: organizationId, compareciente_id: comparecienteId, nombre: unambiguous(fields, 'nombre') || name, apellido_paterno: unambiguous(fields, 'apellido_paterno'), apellido_materno: unambiguous(fields, 'apellido_materno'), nombre_completo_calculado: name, curp: unambiguous(fields, 'curp'), rfc: unambiguous(fields, 'rfc'), fecha_nacimiento: parseDate(unambiguous(fields, 'fecha_nacimiento')), lugar_nacimiento: unambiguous(fields, 'lugar_nacimiento'), nacionalidad: unambiguous(fields, 'nacionalidad'), pais_nacimiento: unambiguous(fields, 'pais_nacimiento'), ocupacion: unambiguous(fields, 'ocupacion'), sexo: ['MASCULINO', 'FEMENINO', 'OTRO'].includes(sexo) ? sexo as any : undefined, estado_civil: ['SOLTERO', 'CASADO', 'DIVORCIADO', 'VIUDO', 'UNION_LIBRE', 'OTRO'].includes(civil) ? civil as any : undefined }) });
  };
  await person(ids.seller, ids.sellerPerson, seller, sellerName);
  await person(ids.representative, ids.representativePerson, representative, representativeName);
  await prisma.compareciente.upsert({ where: { id: ids.company }, update: { nombre_busqueda: companyName, estatus: 'ACTIVO' }, create: { id: ids.company, organization_id: organizationId, tipo_persona: 'MORAL', nombre_busqueda: companyName, creado_por_id: actorId, observaciones: 'Datos propuestos por IA y conservados sin marcar como validados en QA local.' } });
  await prisma.personaMoral.upsert({ where: { compareciente_id: ids.company }, update: { razon_social: companyName, rfc: unambiguous(company, 'rfc') }, create: { id: ids.companyPerson, organization_id: organizationId, compareciente_id: ids.company, razon_social: companyName, rfc: unambiguous(company, 'rfc') } });

  for (const [key, comparecienteId, characterId, order, form] of [
    ['seller', ids.seller, sellerRole.id, 1, 'PROPIO_DERECHO'], ['company', ids.company, buyerRole.id, 2, 'EN_REPRESENTACION_PERSONA_MORAL'], ['representative', ids.representative, representativeRole.id, 3, 'EN_REPRESENTACION_PERSONA_MORAL'],
  ] as const) {
    const id = uuidFrom(`qa-zantamar-link-${key}`);
    await prisma.expedienteCompareciente.upsert({ where: { id }, update: { estatus: 'ACTIVO', archived_at: null }, create: { id, organization_id: organizationId, expediente_id: expedienteId, expediente_acto_id: ids.act, compareciente_id: comparecienteId, caracter_id: characterId, forma_comparecencia: form, orden_comparecencia: order, creado_por_id: actorId, idempotency_key: `qa-zantamar-${key}`, datos_validados: false } });
  }

  const first = (...values: Array<string | null>) => values.find(Boolean) || null;
  await prisma.predio.upsert({
    where: { id: ids.property },
    update: compact({ apodo: first(unambiguous(appraisal, 'apodo'), unambiguous(clg, 'apodo'), 'Unidad privativa QA'), clave_catastral: first(unambiguous(appraisal, 'clave_catastral'), unambiguous(tax, 'clave_catastral'), unambiguous(cna, 'clave_catastral')), cuenta_predial: first(unambiguous(appraisal, 'cuenta_predial'), unambiguous(tax, 'cuenta_predial'), unambiguous(cna, 'cuenta_predial')), folio_real: first(unambiguous(appraisal, 'folio_real'), unambiguous(clg, 'folio_real')), ubicacion_texto: first(unambiguous(appraisal, 'ubicacion_texto'), unambiguous(clg, 'ubicacion_texto'), unambiguous(tax, 'ubicacion_texto')), calle: first(unambiguous(appraisal, 'calle'), unambiguous(clg, 'calle'), unambiguous(tax, 'calle')), numero_exterior: first(unambiguous(appraisal, 'numero_exterior'), unambiguous(clg, 'numero_exterior')), numero_interior: first(unambiguous(clg, 'numero_interior'), unambiguous(appraisal, 'numero_interior')), colonia: first(unambiguous(appraisal, 'colonia'), unambiguous(tax, 'colonia')), localidad: unambiguous(clg, 'localidad'), municipio: first(unambiguous(appraisal, 'municipio'), unambiguous(clg, 'municipio'), unambiguous(tax, 'municipio')), estado: first(unambiguous(appraisal, 'estado'), unambiguous(clg, 'estado'), unambiguous(tax, 'estado')), codigo_postal: unambiguous(tax, 'codigo_postal'), pais: first(unambiguous(appraisal, 'pais'), 'México'), superficie_terreno_m2: first(unambiguous(appraisal, 'superficie_terreno_m2'), unambiguous(tax, 'superficie_terreno_m2'), unambiguous(cna, 'superficie_terreno_m2')) ? decimal(first(unambiguous(appraisal, 'superficie_terreno_m2'), unambiguous(tax, 'superficie_terreno_m2'), unambiguous(cna, 'superficie_terreno_m2'))) : undefined, superficie_construccion_m2: first(unambiguous(appraisal, 'superficie_construccion_m2'), unambiguous(tax, 'superficie_construccion_m2'), unambiguous(cna, 'superficie_construccion_m2')) ? decimal(first(unambiguous(appraisal, 'superficie_construccion_m2'), unambiguous(tax, 'superficie_construccion_m2'), unambiguous(cna, 'superficie_construccion_m2'))) : undefined, valor_avaluo: decimal(unambiguous(appraisal, 'valor_avaluo')), regimen: first(unambiguous(appraisal, 'regimen'), unambiguous(clg, 'regimen')), datos_registrales: json({ source: 'AI_PROPOSAL_LOCAL_QA', validated: false }), updated_by: actorId }),
    create: compact({ id: ids.property, organization_id: organizationId, apodo: first(unambiguous(appraisal, 'apodo'), unambiguous(clg, 'apodo'), 'Unidad privativa QA'), clave_catastral: first(unambiguous(appraisal, 'clave_catastral'), unambiguous(tax, 'clave_catastral'), unambiguous(cna, 'clave_catastral')), cuenta_predial: first(unambiguous(appraisal, 'cuenta_predial'), unambiguous(tax, 'cuenta_predial'), unambiguous(cna, 'cuenta_predial')), folio_real: first(unambiguous(appraisal, 'folio_real'), unambiguous(clg, 'folio_real')), ubicacion_texto: first(unambiguous(appraisal, 'ubicacion_texto'), unambiguous(clg, 'ubicacion_texto'), unambiguous(tax, 'ubicacion_texto')), calle: first(unambiguous(appraisal, 'calle'), unambiguous(clg, 'calle'), unambiguous(tax, 'calle')), numero_exterior: first(unambiguous(appraisal, 'numero_exterior'), unambiguous(clg, 'numero_exterior')), numero_interior: first(unambiguous(clg, 'numero_interior'), unambiguous(appraisal, 'numero_interior')), colonia: first(unambiguous(appraisal, 'colonia'), unambiguous(tax, 'colonia')), localidad: unambiguous(clg, 'localidad'), municipio: first(unambiguous(appraisal, 'municipio'), unambiguous(clg, 'municipio'), unambiguous(tax, 'municipio')), estado: first(unambiguous(appraisal, 'estado'), unambiguous(clg, 'estado'), unambiguous(tax, 'estado')), codigo_postal: unambiguous(tax, 'codigo_postal'), pais: first(unambiguous(appraisal, 'pais'), 'México'), superficie_terreno_m2: decimal(first(unambiguous(appraisal, 'superficie_terreno_m2'), unambiguous(tax, 'superficie_terreno_m2'), unambiguous(cna, 'superficie_terreno_m2'))), superficie_construccion_m2: decimal(first(unambiguous(appraisal, 'superficie_construccion_m2'), unambiguous(tax, 'superficie_construccion_m2'), unambiguous(cna, 'superficie_construccion_m2'))), valor_avaluo: decimal(unambiguous(appraisal, 'valor_avaluo')), regimen: first(unambiguous(appraisal, 'regimen'), unambiguous(clg, 'regimen')), datos_registrales: json({ source: 'AI_PROPOSAL_LOCAL_QA', validated: false }), created_by: actorId, updated_by: actorId }),
  });
  await prisma.expedientePredio.upsert({ where: { organization_id_expediente_id_predio_id: { organization_id: organizationId, expediente_id: expedienteId, predio_id: ids.property } }, update: { estatus: 'ACTIVO', removed_at: null }, create: { id: ids.propertyLink, organization_id: organizationId, expediente_id: expedienteId, predio_id: ids.property, created_by: actorId, idempotency_key: 'qa-zantamar-property' } });
  await prisma.expedienteActoPredio.upsert({ where: { organization_id_expediente_predio_id_expediente_acto_id: { organization_id: organizationId, expediente_predio_id: ids.propertyLink, expediente_acto_id: ids.act } }, update: { estatus: 'ACTIVO', removed_at: null }, create: { id: uuidFrom('qa-zantamar-act-property'), organization_id: organizationId, expediente_predio_id: ids.propertyLink, expediente_acto_id: ids.act } });
  return ids;
}

async function walk(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(path.join(root, entry.name)) : [path.join(root, entry.name)]));
  return nested.flat();
}

async function main() {
  assertSafety();
  const masterIds = await setupStructuredMasters();
  const extractions = await readExtractions();
  const roots = (await fs.readdir(dossierRoot, { withFileTypes: true })).filter((item) => item.isDirectory());
  if (roots.length !== 1) throw new Error('QA_DOSSIER_SINGLE_ROOT_REQUIRED');
  const sourceRoot = path.join(dossierRoot, roots[0].name);
  const files = (await walk(sourceRoot)).filter((item) => path.extname(item).toLowerCase() !== '.zip');
  if (convertedLegacy) files.push(convertedLegacy);
  const folderCache = new Map<string, string>();
  const ensureFolder = async (relativeDirectory: string) => {
    let parentId: string | null = null; let built = '';
    for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
      built = built ? `${built}/${segment}` : segment;
      const cached = folderCache.get(built); if (cached) { parentId = cached; continue; }
      let folder: { id: string } | null = await prisma.expedienteDocumentoCarpeta.findFirst({ where: { organization_id: organizationId, expediente_id: expedienteId, parent_id: parentId, nombre: segment, archived_at: null }, select: { id: true } });
      if (!folder) folder = await prisma.expedienteDocumentoCarpeta.create({ data: { id: uuidFrom(`qa-zantamar-folder:${built}`), organization_id: organizationId, expediente_id: expedienteId, parent_id: parentId, nombre: segment, created_by_id: actorId } });
      folderCache.set(built, folder.id); parentId = folder.id;
    }
    return parentId;
  };
  let created = 0; let unchanged = 0;
  for (const file of files) {
    const isConverted = convertedLegacy === file;
    const relative = isConverted ? '01 - EDITABLE/01 - PRIMER AVISO PREVENTIVO UP139 (vista DOCX).docx' : path.relative(sourceRoot, file);
    const buffer = await fs.readFile(file); const checksum = digest(buffer); const sourceKey = `QA_DOSSIER:${digest(relative).slice(0, 40)}`;
    const previousProject = /PROYECTO COMPRAVENTA(?:\s+\d+\.0)?\.docx$/i.test(relative);
    const folderId = await ensureFolder(path.dirname(relative) === '.' ? '' : path.dirname(relative));
    const storageKey = `organizations/${organizationId}/documentos/expedientes/${expedienteId}/qa-dossier/${digest(relative).slice(0, 20)}_${path.basename(relative).replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    let link = await prisma.expedienteDocumento.findFirst({ where: { organization_id: organizationId, expediente_id: expedienteId, source_key: sourceKey }, include: { documento: true } });
    if (!link) {
      await uploadFile(buffer, storageKey, mime(relative));
      const ai = extractions.get(path.basename(file).toLocaleLowerCase('es-MX')) || [];
      const document = await prisma.documento.create({ data: { id: uuidFrom(`qa-zantamar-document:${relative}`), organization_id: organizationId, expediente_id: expedienteId, nombre_original: path.basename(relative), nombre_interno: storageKey, storage_key: storageKey, tipo: previousProject ? 'PROYECTO_REFERENCIA_HISTORICA' : isConverted ? 'DERIVADO_VISUAL_LEGACY' : 'DOSSIER_OPERACION', categoria: /ESTADO DE CUENTA|COMPROBANTES|ANTICIPO|COTIZACION/i.test(relative) ? 'BANCO' : /PREDIAL|CNA|CLG|AVALUO|REGIMEN|ADQUISICION/i.test(relative) ? 'REGISTRO' : 'PROYECTO', mime_type: mime(relative), size_bytes: buffer.length, checksum_sha256: checksum, subido_por_id: actorId, estatus: 'VIGENTE', observaciones: previousProject ? 'Proyecto humano previo importado únicamente como referencia histórica.' : isConverted ? 'Derivado DOCX local del archivo .doc original; el original se conserva sin cambios.' : 'Documento real importado en QA local aislado.', datos_extraidos: json({ ai_extractions: ai, ai_proposal_only: ai.length > 0, local_qa: true, original_relative_path_hash: digest(relative) }) } });
      link = await prisma.expedienteDocumento.create({ data: { id: uuidFrom(`qa-zantamar-link:${relative}`), organization_id: organizationId, expediente_id: expedienteId, documento_id: document.id, tipo_vinculo: previousProject ? 'PROYECTO_REFERENCIA_HISTORICA' : 'FUENTE_PROYECTO', creado_por_id: actorId, origen: 'EXPEDIENTE', source_entity_type: 'QA_DOSSIER_FILE', source_entity_id: document.id, source_context: previousProject ? 'PROYECTO_HUMANO_PREVIO' : isConverted ? 'DERIVADO_VISUAL_LEGACY' : 'DOSSIER_SOURCE', source_key: sourceKey, document_version: checksum, provenance: json({ local_qa: true, checksum, original_preserved: true, converted_derivative: isConverted, selected_by_default: !previousProject }), carpeta_id: folderId, nombre_visual: path.basename(relative) }, include: { documento: true } });
      created += 1;
    } else unchanged += 1;
    const upper = relative.toLocaleUpperCase('es-MX');
    const comparecienteId = upper.includes('/03 - ') ? masterIds.seller : upper.includes('/04.1 - ') ? masterIds.representative : upper.includes('/04 - ') && !upper.includes('/04.2 - ') ? masterIds.company : null;
    if (comparecienteId) await prisma.comparecienteDocumento.upsert({ where: { compareciente_id_documento_id_categoria: { compareciente_id: comparecienteId, documento_id: link.documento_id, categoria: /INE/.test(upper) ? 'IDENTIFICACION' : /CURP/.test(upper) ? 'CURP' : /CSF/.test(upper) ? 'CONSTANCIA_FISCAL' : /PODER/.test(upper) ? 'PODERES' : /CONSTITUTIVA/.test(upper) ? 'ACTA_CONSTITUTIVA' : 'OTROS' } }, update: { estatus: 'ACTIVO', vigencia: 'VIGENTE' }, create: { organization_id: organizationId, compareciente_id: comparecienteId, documento_id: link.documento_id, categoria: /INE/.test(upper) ? 'IDENTIFICACION' : /CURP/.test(upper) ? 'CURP' : /CSF/.test(upper) ? 'CONSTANCIA_FISCAL' : /PODER/.test(upper) ? 'PODERES' : /CONSTITUTIVA/.test(upper) ? 'ACTA_CONSTITUTIVA' : 'OTROS', vigencia: 'VIGENTE', creado_por_id: actorId, observaciones: 'Vínculo local QA derivado de la estructura original del dossier.' } });
    if (/AVALUO|PREDIAL|CNA|CLG|REGIMEN|ADQUISICION|RECTIFICACION|AVISO PREV/i.test(relative)) await prisma.predioDocumento.upsert({ where: { organization_id_predio_id_documento_id_tipo_vinculo: { organization_id: organizationId, predio_id: masterIds.property, documento_id: link.documento_id, tipo_vinculo: 'DOSSIER_QA' } }, update: { estatus: 'ACTIVO', vigencia: 'VIGENTE' }, create: { organization_id: organizationId, predio_id: masterIds.property, documento_id: link.documento_id, tipo_vinculo: 'DOSSIER_QA', vigencia: 'VIGENTE', creado_por_id: actorId, source_expediente_documento_id: link.id, observaciones: 'Vínculo local QA; clasificación fina pendiente de confirmación humana.' } });
  }
  await prisma.auditLog.create({ data: { organization_id: organizationId, user_id: actorId, accion: 'QA_LOCAL_DOSSIER_IMPORTED', entidad: 'Expediente', entidad_id: expedienteId, valores_nuevos: json({ local_only: true, files_created: created, files_unchanged: unchanged, nested_archives_skipped: true, ai_outputs_attached: true }), correlation_id: uuidFrom('qa-zantamar-import-audit'), session_id: 'QA-ZANTAMAR-LOCAL' } });
  console.log(JSON.stringify({ ok: true, local_only: true, expediente_id: expedienteId, files_created: created, files_unchanged: unchanged, files_total: files.length, folders: folderCache.size }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
