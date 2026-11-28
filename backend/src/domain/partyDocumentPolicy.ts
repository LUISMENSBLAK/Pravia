import { canonicalExtractedValue, consolidateExtractedFields, isAbsentDocumentValue, type ExtractionField } from './documentExtraction';
import { hasValidIdentifierStructure } from './mexicanIdentity';
import { mrzCheckDigit } from './machineReadableIdentity';

export type PartySource = 'INE' | 'PASSPORT' | 'CURP' | 'CSF' | 'BIRTH' | 'MARRIAGE' | 'ADDRESS' | 'GENERAL';
type SourceDocument = { documentoId: string; tipoDocumento?: string; nombreOriginal: string };
export const normalizeDocumentText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
export function partySource(label: string): PartySource | undefined {
  const text = normalizeDocumentText(label);
  if (/\b(PASAPORTE|PASSPORT)\b/.test(text)) return 'PASSPORT';
  if (/\b(INE|IFE|CREDENCIAL (?:PARA VOTAR|DE ELECTOR))\b/.test(text)) return 'INE';
  if (/\b(CSF|CONSTANCIA (?:FISCAL|(?:DE )?SITUACION FISCAL)|CEDULA DE IDENTIFICACION FISCAL)\b/.test(text)) return 'CSF';
  if (/\b(ACTA (?:DE )?NACIMIENTO|NACIMIENTO|BIRTH CERTIFICATE)\b/.test(text)) return 'BIRTH';
  if (/\b(ACTA (?:DE )?MATRIMONIO|MATRIMONIO)\b/.test(text)) return 'MARRIAGE';
  if (/\b(CURP|CLAVE UNICA DE REGISTRO DE POBLACION)\b/.test(text)) return 'CURP';
  if (/\b(CD|COMPROBANTE (?:DE )?DOMICILIO|CFE|RECIBO (?:DE )?(?:LUZ|AGUA|INTERNET|GAS))\b/.test(text)) return 'ADDRESS';
  if (/\b(GENERALES|FICHA (?:NOTARIAL|DE DATOS)|ANEXO 3|DECLARACION DE DATOS)\b/.test(text)) return 'GENERAL';
}

/** Treat the default upload category as a hint, not proof of document type.
 * This only routes supplemental readers; their results still need evidence. */
export function partySupplementalReaderKind(declared: string, filename: string): string {
  if (declared !== 'OTRO' && declared !== 'IDENTIFICACION') return declared;
  const source = partySource(filename);
  if (source === 'PASSPORT') return 'PASAPORTE';
  if (source === 'CSF') return 'CONSTANCIA_FISCAL';
  if (source === 'CURP') return 'CURP';
  if (source === 'INE') return 'IDENTIFICACION';
  return source ? 'OTRO' : declared;
}

/** Read the labelled date in the registrant section only. The printed
 * form often puts the label on the row below its value. */
export function readBirthCertificateDate(text: string) {
  const rows = text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  const start = rows.findIndex(row => /\bDATOS DE LA PERSONA REGISTRADA\b/.test(row));
  if (start < 0 || !rows.slice(0, start).some(row => /\bACTA DE NACIMIENTO\b/.test(row))) return;
  const end = rows.findIndex((row, i) => i > start && /\b(?:DATOS DE FILIACION|DATOS DE LOS PADRES|CERTIFICACION|ANOTACIONES MARGINALES)\b/.test(row));
  const section = rows.slice(start + 1, end < 0 ? start + 13 : Math.min(end, start + 13));
  const labels = section.flatMap((row, i) => /\bFECHA DE NACIMIENTO\b/.test(row) ? [i] : []);
  if (labels.length !== 1) return;
  const around = section.slice(Math.max(0, labels[0] - 1), labels[0] + 2).join(' ');
  if (/\bFECHA DE (?:REGISTRO|CERTIFICACION|EXPEDICION)\b/.test(around)) return;
  const literals = [...new Set(around.match(/\b\d{1,2}([/.-])\d{1,2}\1(?:18|19|20)\d{2}\b/g) || [])];
  if (literals.length !== 1) return;
  const value = canonicalExtractedValue('fecha_nacimiento', literals[0]);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { value, fragmento: `Datos de la persona registrada · Fecha de nacimiento: ${literals[0]}` } : undefined;
}

type Sources = Map<string, { kind: PartySource; name: string }>;
export function partyDocumentSources(documents: SourceDocument[], readings: Array<{ documento_id?: string; tipo_documental?: string }> = []): Sources {
  const sources: Sources = new Map();
  for (const doc of documents) {
    const kind = partySource(doc.nombreOriginal) || partySource(doc.tipoDocumento || '');
    if (kind) sources.set(doc.documentoId, { kind, name: doc.nombreOriginal });
  }
  for (const reading of readings) {
    if (!reading.documento_id || !reading.tipo_documental) continue;
    const kind = partySource(reading.tipo_documental);
    const root = documents.find(doc => doc.documentoId === reading.documento_id || reading.documento_id!.startsWith(`${doc.documentoId}:`));
    if (kind && root && !sources.has(reading.documento_id)) sources.set(reading.documento_id, { kind, name: reading.documento_id === root.documentoId ? root.nombreOriginal : `${root.nombreOriginal} · ${reading.documento_id.slice(root.documentoId.length + 1)}` });
  }
  return sources;
}

const identity: PartySource[] = ['INE', 'PASSPORT'];
const nameKeys = ['nombre', 'apellido_paterno', 'apellido_materno'];
const names: PartySource[][] = [identity, ['CURP'], ['CSF'], ['BIRTH'], ['GENERAL']];
const rules: Record<string, PartySource[][]> = {
  rfc: [['CSF'], ['GENERAL']], curp: [['CURP'], ['CSF'], ['INE'], ['BIRTH'], ['GENERAL']],
  fecha_nacimiento: [['BIRTH'], ['INE'], ['CSF', 'CURP'], ['GENERAL']], lugar_nacimiento: [['BIRTH'], ['GENERAL']],
  pais_nacimiento: [['BIRTH'], ['GENERAL'], identity], sexo: [['INE']],
  estado_civil: [['MARRIAGE']], regimen_matrimonial: [['MARRIAGE']],
  escolaridad: [['GENERAL']], ocupacion: [['GENERAL']], telefono: [['GENERAL']], correo: [['GENERAL']],
  actividad_economica: [['CSF'], ['GENERAL']], giro: [['CSF'], ['GENERAL']],
  tipo_identificacion: [identity], folio_identificacion: [identity], pais_emisor: [identity], autoridad_emisora: [identity],
  fecha_expedicion_identificacion: [identity], fecha_vencimiento_identificacion: [identity],
};

const compareName = (name: string) => name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase();
const accepted = (field: ExtractionField) => !isAbsentDocumentValue(field.valor) && field.confianza !== 'LECTURA_DEFICIENTE';
const fieldAliases: Record<string, string> = { correo_electronico: 'correo', email: 'correo', celular: 'telefono' };

export function consolidatePartyDocuments(fields: ExtractionField[], sources: Sources, personType: 'FISICA' | 'MORAL' = 'FISICA', preferredIdentityId?: string) {
  let input = fields.filter(accepted).filter(({ campo }) => !['pep_estado', 'aliases'].includes(campo)).map(field => ({ ...field, campo: fieldAliases[field.campo] || field.campo, fuente: sources.get(field.documento_id || '')?.name || field.fuente }));
  const byId = (field: ExtractionField) => sources.get(field.documento_id || '')?.kind;
  const excludedDocumentIds: string[] = [];
  const reviewWarnings: string[] = [];
  const ambiguousPassport = input.filter(field => field.campo === 'folio_identificacion' && field.verificacion_local === 'MRZ_TD3_AMBIGUO');
  input = input.filter(field => field.verificacion_local !== 'MRZ_TD3_AMBIGUO');
  if (personType === 'MORAL') return { ...consolidateExtractedFields(input), excludedDocumentIds, reviewWarnings };
  input = input.map(field => {
    const isIssue = field.campo === 'fecha_expedicion_identificacion';
    const label = isIssue ? /\b(?:EMISION|EXPEDICION)\b/ : /\b(?:VIGENCIA|VENCIMIENTO)\b/;
    if (byId(field) !== 'INE' || (!isIssue && field.campo !== 'fecha_vencimiento_identificacion') || !/^(?:19|20)\d{2}$/.test(field.valor.trim()) || !label.test(normalizeDocumentText(field.fragmento || '')) || !field.fragmento?.includes(field.valor.trim())) return field;
    const year = field.valor.trim(); // The extractor emits a bare year only for the labelled field.
    const fragmento = `${field.fragmento || year} · Convención PRAVIA: ${isIssue ? '1 de enero del año de expedición' : '31 de diciembre del año de vencimiento'}.`;
    return { ...field, valor: `${year}-${isIssue ? '01-01' : '12-31'}`, fragmento };
  });
  const candidates = [...sources.keys()].flatMap(id => {
    const own = input.filter(field => field.documento_id === id && nameKeys.includes(field.campo));
    if (!own.some(field => field.campo === 'nombre')) return [];
    const parts = nameKeys.map(key => [...new Set(own.filter(field => field.campo === key).map(field => compareName(field.valor)))]);
    const rank = names.findIndex(tier => tier.includes(sources.get(id)!.kind));
    return rank < 0 ? [] : [{ id, own, rank, key: parts.flat().join(' '), unambiguous: parts.every(part => part.length <= 1), literal: nameKeys.map(key => own.find(field => field.campo === key)?.valor.trim()).filter(Boolean).join(' ') }];
  }).sort((a, b) => a.rank - b.rank);
  const top = candidates.filter(candidate => candidate.rank === candidates[0]?.rank);
  const differentIdentity = new Set(top.map(item => item.key)).size > 1 || top.some(item => !item.unambiguous);
  const curps = input.filter(field => field.campo === 'curp' && byId(field) && rules.curp.some(tier => tier.includes(byId(field)!)));
  const curpValue = (field: ExtractionField) => canonicalExtractedValue('curp', field.valor);
  const clearCurps = curps.filter(field => field.confianza === 'LECTURA_CLARA' && hasValidIdentifierStructure('curp', curpValue(field)));
  const independentlyVerified = clearCurps.filter(field => byId(field) === 'CURP');
  const trustedCurp = new Set(independentlyVerified.map(curpValue)).size === 1 ? curpValue(independentlyVerified[0]) : undefined;
  const differentCurps = new Set((trustedCurp ? clearCurps : curps).map(curpValue)).size > 1;
  if (trustedCurp && !differentCurps) {
    const doubtful = curps.filter(field => !clearCurps.includes(field) && curpValue(field) !== trustedCurp);
    const anchorSource = top.length && !differentIdentity ? top[0] : undefined;
    for (const field of doubtful) {
      const id = field.documento_id!;
      const candidate = candidates.find(name => name.id === id);
      const clearAnchor = anchorSource && anchorSource.own.every(part => part.confianza === 'LECTURA_CLARA');
      const linked = clearAnchor && candidate && candidate.id !== anchorSource.id && candidate.key === anchorSource.key && candidate.unambiguous;
      // A labelled RFC in the fiscal document can link it without relying
      // on that same OCR's weak CURP, but only if independently confirmed by
      // a generales form already tied to the same complete, clear name.
      const fiscalRfcs = input.filter(item => item.campo === 'rfc' && item.documento_id === id && hasValidIdentifierStructure('rfc', canonicalExtractedValue('rfc',item.valor))).map(item => canonicalExtractedValue('rfc',item.valor));
      const linkedByRfc = Boolean(byId(field) === 'CSF' && clearAnchor && new Set(fiscalRfcs).size === 1 &&
        candidates.some(name => name.id !== id && sources.get(name.id)?.kind === 'GENERAL' && name.key === anchorSource.key && name.unambiguous && name.own.every(part => part.confianza === 'LECTURA_CLARA') &&
          input.some(item => item.campo === 'rfc' && item.documento_id === name.id && item.confianza === 'LECTURA_CLARA' && canonicalExtractedValue('rfc',item.valor) === fiscalRfcs[0])));
      const matchingCurpSameSource = clearCurps.some(clear => clear.documento_id === id && curpValue(clear) === trustedCurp);
      if (!linked && !linkedByRfc && !matchingCurpSameSource && !excludedDocumentIds.includes(id)) excludedDocumentIds.push(id);
      reviewWarnings.push(`${field.fuente || 'Documento'}: una lectura dudosa de CURP no coincide con la constancia CURP. ${linked || linkedByRfc || matchingCurpSameSource ? 'Se conservan los demás datos del documento cotejado.' : 'No se usaron los datos de esa fuente sin corroborar su titular.'}`);
    }
    input = input.filter(field => !doubtful.includes(field) && !excludedDocumentIds.includes(field.documento_id || ''));
  }
  const selectedName = !differentIdentity ? candidates.find(candidate => !excludedDocumentIds.includes(candidate.id)) : undefined;
  const birthReads = input.filter(field => field.verificacion_local === 'BIRTH_DATE_LABEL');
  if (birthReads.length) {
    const dateOf = (field: ExtractionField) => canonicalExtractedValue('fecha_nacimiento', field.valor);
    input = input.filter(field => {
      if (field.verificacion_local !== 'BIRTH_DATE_LABEL') return true;
      const birth = candidates.find(name => name.id === field.documento_id && name.unambiguous && name.own.every(part => part.confianza === 'LECTURA_CLARA'));
      const corroborated = Boolean(birth && selectedName && birth.key === selectedName.key && input.some(other => other.campo === 'fecha_nacimiento' && other.documento_id !== field.documento_id && byId(other) && rules.fecha_nacimiento.some(tier => tier.includes(byId(other)!)) && other.confianza === 'LECTURA_CLARA' && dateOf(other) === dateOf(field)));
      if (!corroborated) reviewWarnings.push(`${field.fuente || 'Acta de nacimiento'}: la fecha leída por OCR requiere cotejo en el original.`);
      return corroborated;
    });
  }
  const chosenIdentification = preferredIdentityId || (selectedName && identity.includes(sources.get(selectedName.id)!.kind) ? selectedName.id : undefined);
  const primaryTokens = new Set((top[0]?.key || '').split(' ').filter(token => token.length > 2 && !['DEL', 'LOS', 'LAS'].includes(token)));
  const unlinked = primaryTokens.size > 1 ? candidates.filter(candidate => candidate !== top[0] && candidate.own.every(field => field.confianza === 'LECTURA_CLARA') && !candidate.key.split(' ').some(token => primaryTokens.has(token))) : [];
  const risk = differentCurps || differentIdentity || unlinked.length > 0;
  if (!risk) for (const mrzReading of ambiguousPassport) {
    if (byId(mrzReading) !== 'PASSPORT') continue;
    const passportName = candidates.find(name => name.id === mrzReading.documento_id && name.unambiguous && name.own.every(part => part.confianza === 'LECTURA_CLARA'));
    const matching = input.filter(field => field.campo === 'folio_identificacion' && field.confianza === 'LECTURA_CLARA' &&
      (field.documento_id === mrzReading.documento_id || (passportName && byId(field) === 'GENERAL' &&
        candidates.some(name => name.id === field.documento_id && name.key === passportName.key && name.unambiguous && name.own.every(part => part.confianza === 'LECTURA_CLARA')) &&
        input.some(type => type.documento_id === field.documento_id && type.campo === 'tipo_identificacion' && canonicalExtractedValue(type.campo, type.valor) === 'PASAPORTE'))));
    const values = [...new Set(matching.map(field => field.valor.trim().toUpperCase()).filter(value => /^[A-Z]\d{8}$/.test(value) && value.slice(1) === mrzReading.valor && String(mrzCheckDigit(value)) === mrzReading.mrz_control))];
    if (values.length === 1) {
      const corroboration = matching.find(field => field.valor.trim().toUpperCase() === values[0]);
      input.push({ ...mrzReading, valor: values[0], confianza: 'LECTURA_CLARA', verificacion_local: 'MRZ_TD3',
        fragmento: `Folio cotejado mediante la zona de lectura mecánica y el número de pasaporte leído en ${corroboration?.fuente || 'el documento corroborante'}.` });
    } else {
      input = input.filter(field => field.campo !== 'folio_identificacion' || field.documento_id !== mrzReading.documento_id || field.verificacion_local === 'MRZ_TD3');
      reviewWarnings.push(`${mrzReading.fuente || 'Pasaporte'}: el primer carácter del folio no pudo corroborarse. Revisa sólo el folio en el original.`);
    }
  }
  const mrz = input.filter(field => field.campo === 'folio_identificacion' && byId(field) === 'PASSPORT' && field.verificacion_local === 'MRZ_TD3');
  const picked = input.filter(field => {
    if (nameKeys.includes(field.campo)) return Boolean(selectedName ? field.documento_id === selectedName.id : top.some(item => item.id === field.documento_id));
    const tiers = rules[field.campo];
    if (!tiers) return true;
    const kind = byId(field);
    return Boolean(kind && tiers.some(tier => tier.includes(kind)) && (!chosenIdentification || !tiers[0].every(type => identity.includes(type)) || field.documento_id === chosenIdentification));
  }).filter(field => {
    if (field.campo !== 'folio_identificacion' || field.confianza === 'LECTURA_CLARA' || field.verificacion_local || byId(field) !== 'PASSPORT') return true;
    const checked = mrz.filter(verified => verified.documento_id === field.documento_id);
    return new Set(checked.map(verified => verified.valor)).size !== 1 || field.valor === checked[0].valor;
  });
  const ranked = picked.filter(field => {
    const tiers = rules[field.campo];
    if (!tiers || risk) return true;
    const rank = tiers.findIndex(tier => tier.includes(byId(field)!));
    return !picked.some(other => other.campo === field.campo && tiers.findIndex(tier => tier.includes(byId(other)!)) < rank);
  });
  const result = consolidateExtractedFields(ranked, { reconcileNames: false });
  if (risk) {
    // Never autocomplete a mixed identity. Review the original documents as whole names.
    for (const key of Object.keys(result.values)) delete result.values[key];
    const alternativas = [...new Set([...top, ...unlinked])].map(({ own, literal }) => ({ ...own[0], documento_id: own[0].documento_id!, fuente: own[0].fuente!, valor: literal }));
    const motivo = 'Las fuentes no permiten vincular inequívocamente los datos con una sola persona. Revisa las identidades antes de llenar la ficha.';
    result.conflicts.push({ campo: 'nombre_completo', alternativas, motivo });
    result.proposals.nombre_completo = { estado: 'EN_CONFLICTO', alternativas, nota: motivo };
    result.needsEscalation = true;
  } else if (selectedName) {
    const seen = new Set([selectedName.key]);
    const aliases = candidates.filter(item => {
      if (excludedDocumentIds.includes(item.id) || !item.unambiguous || !item.own.every(field => field.confianza === 'LECTURA_CLARA') || seen.has(item.key)) return false;
      seen.add(item.key); return true;
    });
    if (aliases.length) {
      const alternatives = aliases.map(({ own, literal }) => ({ ...own[0], valor: literal }));
      result.values.aliases = aliases.map(item => item.literal).join(', ');
      result.proposals.aliases = { ...alternatives[0], valor: result.values.aliases, fuentes: alternatives, estado: 'PENDIENTE_CONFIRMACION', nota: 'Variantes documentales del nombre; verifica que correspondan a la misma persona.' };
    }
  }
  return { ...result, excludedDocumentIds, reviewWarnings: [...new Set(reviewWarnings)] };
}

type Address = { documento_id?: string; tipo_sugerido: string; fuente: string; titular_confirmado?: boolean; titular_literal?: string; calle?: string; numero_exterior?: string; numero_interior?: string; colonia?: string; codigo_postal?: string; municipio?: string; ciudad?: string; localidad?: string; estado?: string; pais?: string; pagina?: number; fragmento?: string; confianza?: ExtractionField['confianza'] };
const addressFields = { calle: 'calle', numero_exterior: 'exterior', numero_interior: 'interior', colonia: 'colonia', codigo_postal: 'codigo_postal', municipio: 'municipio', localidad: 'localidad', estado: 'estado', pais: 'pais' } as const;
export const documentedPartyName = (values: Record<string, string>) => nameKeys.map(key => values[key]).filter(Boolean).join(' ');
export function proposePartyAddresses(addresses: Address[], sources: Sources, preventMerge: boolean, fiscalFileUnavailable = false, holderName = ''): ExtractionField[] {
  if (preventMerge) return [];
  const eligible = addresses.flatMap(address => {
    const source = sources.get(address.documento_id || '');
    if (!source || address.confianza === 'LECTURA_DEFICIENTE' || !address.calle) return [];
    return [{ ...address, localidad: address.localidad || address.ciudad, kind: source.kind, fuente: source.name }];
  });
  const firstUnambiguous = (items: typeof eligible) => new Set(items.map(item => Object.keys(addressFields).map(key => compareName(item[key as keyof typeof addressFields] || '')).join('|'))).size === 1 ? items[0] : undefined;
  const fiscalAddresses = eligible.filter(item => item.kind === 'CSF' && item.tipo_sugerido === 'FISCAL');
  type AddressKey = keyof typeof addressFields;
  const keys = Object.keys(addressFields) as AddressKey[];
  const fiscalEvidence = new Map<AddressKey, (typeof eligible)[number]>();
  // Two readings of the exact same CSF can fill complementary components.
  // Require the same street, exterior and postal code across all of them;
  // never assemble an address out of separate documents or conflicting values.
  const sharedCore = (['calle', 'numero_exterior', 'codigo_postal'] as const).every(key =>
    fiscalAddresses.every(item => Boolean(item[key]) && compareName(item[key]!) === compareName(fiscalAddresses[0][key]!)));
  const sameFile = Boolean(fiscalAddresses[0]?.documento_id) && fiscalAddresses.every(item => item.documento_id === fiscalAddresses[0].documento_id);
  const compatible = keys.every(key => new Set(fiscalAddresses.flatMap(item => item[key] ? [compareName(item[key]!)] : [])).size <= 1);
  let fiscal = firstUnambiguous(fiscalAddresses);
  if (!fiscal && sameFile && compatible && sharedCore) {
    const merged = { ...fiscalAddresses[0] };
    for (const key of keys) {
      const evidence = fiscalAddresses.find(item => item[key] && item.confianza === 'LECTURA_CLARA') || fiscalAddresses.find(item => item[key]);
      if (evidence) { merged[key] = evidence[key]; fiscalEvidence.set(key, evidence); }
    }
    fiscal = merged;
  }
  const nameParts = (value: string) => normalizeDocumentText(value).split(' ').filter(Boolean).sort().join(' ');
  const documentedHolder = nameParts(holderName);
  const groups = [eligible.filter(item => item.kind === 'ADDRESS' && item.titular_confirmado === true && documentedHolder.includes(' ') && nameParts(item.titular_literal || '') === documentedHolder), eligible.filter(item => item.kind === 'INE' && item.numero_exterior && item.colonia && item.codigo_postal && item.municipio && item.estado), eligible.filter(item => item.kind === 'GENERAL'), fiscal ? [fiscal] : []];
  const residential = firstUnambiguous(groups.find(group => group.length) || []);
  const fiscalFallback = !fiscalFileUnavailable && ![...sources.values()].some(item => item.kind === 'CSF') && !fiscal;
  return ([['particular', residential], ['fiscal', fiscal || (fiscalFallback ? residential : undefined)]] as const).flatMap(([type, address]) => address ? Object.entries(addressFields).flatMap(([key, suffix]) => {
    const valor = address[key as AddressKey];
    if (!valor || isAbsentDocumentValue(valor)) return [];
    const copied = type === 'fiscal' && !fiscal;
    const evidence = (address === fiscal ? fiscalEvidence.get(key as AddressKey) : undefined) || address;
    return [{ campo: `dom_${type}_${suffix}`, valor, documento_id: evidence.documento_id, fuente: copied ? `${evidence.fuente} · domicilio particular propuesto por ausencia de CSF` : evidence.fuente, confianza: evidence.confianza || 'LECTURA_DUDOSA', pagina: evidence.pagina, fragmento: evidence.fragmento }];
  }) : []);
}
