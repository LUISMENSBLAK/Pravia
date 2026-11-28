import { hasValidIdentifierStructure } from './mexicanIdentity';

export type ExtractionConfidence = 'LECTURA_CLARA' | 'LECTURA_DUDOSA' | 'LECTURA_DEFICIENTE';

export interface ExtractionField {
  campo: string;
  valor: string;
  confianza: ExtractionConfidence;
  fuente?: string;
  documento_id?: string;
  pagina?: number;
  fragmento?: string;
  verificacion_local?: 'MRZ_TD3' | 'MRZ_TD3_AMBIGUO' | 'BIRTH_DATE_LABEL';
  mrz_control?: string;
}

export interface ExtractionConflict {
  campo: string;
  alternativas: Array<{
    valor: string;
    fuente: string;
    documento_id: string;
    confianza: ExtractionConfidence;
    pagina?: number;
    fragmento?: string;
  }>;
  motivo: string;
}

const SOURCE_RULES: Record<string, string[][]> = {
  rfc: [['CONSTANCIA', 'FISCAL', 'CSF'], ['INE', 'PASAPORTE', 'OFICIAL'], ['FICHA', 'DECLARACION']],
  curp: [['CURP'], ['INE', 'PASAPORTE', 'OFICIAL'], ['FICHA', 'DECLARACION']],
  nombre: [['INE', 'PASAPORTE', 'OFICIAL'], ['CURP'], ['FICHA', 'WORD', 'ANEXO']],
  apellido_paterno: [['INE', 'PASAPORTE', 'OFICIAL'], ['CURP'], ['FICHA', 'WORD', 'ANEXO']],
  apellido_materno: [['INE', 'PASAPORTE', 'OFICIAL'], ['CURP'], ['FICHA', 'WORD', 'ANEXO']],
  domicilio_fiscal: [['CONSTANCIA', 'FISCAL', 'CSF']],
  domicilio_particular: [['COMPROBANTE', 'CFE', 'AGUA'], ['INE']],
};

const normalize = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase();

export function isAbsentDocumentValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return true;
  return /^(?:N\s*\/\s*A|NO APLICA|DATO NO ENCONTRADO|PENDIENTE(?: DE INFORMACION)?|NO PROPORCIONAD[OA]|SIN DATOS?|NO DISPONIBLE)$/.test(normalize(value).replace(/_/g, ' '));
}

export function canonicalExtractedValue(campo: string, literal: string) {
  if (['curp', 'rfc'].includes(campo)) return literal.replace(/\s+/g, '').toUpperCase();
  const key = normalize(literal).replace(/[\s-]+/g, '_');
  const aliases: Record<string, Record<string, string>> = {
    nacionalidad: { MEX: 'MEXICANA', MEXICO: 'MEXICANA', MEXICANO: 'MEXICANA', MEXICANA: 'MEXICANA', MEXICAN: 'MEXICANA' },
    estado_civil: { SOLTERA: 'SOLTERO', SOLTERO: 'SOLTERO', CASADA: 'CASADO', CASADO: 'CASADO', DIVORCIADA: 'DIVORCIADO', DIVORCIADO: 'DIVORCIADO', VIUDA: 'VIUDO', VIUDO: 'VIUDO', UNION_LIBRE: 'UNION_LIBRE' },
    regimen_matrimonial: { SEPARACION_DE_BIENES: 'SEPARACION_DE_BIENES', SOCIEDAD_CONYUGAL: 'SOCIEDAD_CONYUGAL', SOCIEDAD_LEGAL: 'SOCIEDAD_LEGAL' },
    sexo: { MASCULINO: 'MASCULINO', HOMBRE: 'MASCULINO', H: 'MASCULINO', FEMENINO: 'FEMENINO', MUJER: 'FEMENINO', F: 'FEMENINO' },
    tipo_identificacion: { INE: 'INE', PASAPORTE: 'PASAPORTE', PASAPORTE_MEXICANO: 'PASAPORTE', CEDULA_PROFESIONAL: 'CEDULA_PROFESIONAL', DOCUMENTO_MIGRATORIO: 'DOCUMENTO_MIGRATORIO' },
  };
  if (aliases[campo]?.[key]) return aliases[campo][key];
  if (campo.startsWith('fecha_')) {
    // The Mexican documentary calendar is day/month/year. Scan transcriptions
    // also use spaces, dots or Spanish month names. Accept complete dates only;
    // never infer missing components, two-digit centuries or fix OCR digits.
    const numeric = normalize(literal).match(/^(\d{1,2})([/. -])(\d{1,2})\2(\d{4})$/);
    const months = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    const written = normalize(literal).match(/^(\d{1,2}) (?:DE )?([A-Z]+) (?:DE )?(\d{4})$/);
    const month = written ? months.indexOf(written[2]) + 1 : 0;
    const iso = numeric ? `${numeric[4]}-${numeric[3].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`
      : written && month ? `${written[3]}-${String(month).padStart(2, '0')}-${written[1].padStart(2, '0')}` : literal;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const date = new Date(iso + 'T00:00:00Z');
      if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso) return iso;
    }
  }
  return literal;
}

function sourceRank(field: ExtractionField) {
  const rules = SOURCE_RULES[field.campo] || [];
  const source = normalize(field.fuente || '');
  const match = rules.findIndex((keywords) => keywords.some((keyword) => source.includes(keyword)));
  return match === -1 ? rules.length + 1 : match;
}

export function consolidateExtractedFields(fields: ExtractionField[], options: { reconcileNames?: boolean } = {}) {
  const grouped = new Map<string, ExtractionField[]>();
  for (const field of fields) {
    const rawCampo = String(field.campo || '').trim();
    // Provider aliases still describe the same contact field. Keeping them in
    // separate groups could hide a disagreement and let a later alias win.
    const campo = ({ correo_electronico: 'correo', email: 'correo', celular: 'telefono' } as Record<string, string>)[rawCampo] || rawCampo;
    const literal = String(field.valor || '').trim();
    if (isAbsentDocumentValue(literal)) continue;
    // Whitespace/case are presentation, not a conflicting identity. Preserve
    // the literal for review; never repair, infer or substitute any character.
    const valor = canonicalExtractedValue(campo, literal);
    if (!campo || !valor) continue;
    const list = grouped.get(campo) || [];
    list.push({ ...field, campo, valor, ...(literal !== valor ? { fragmento: field.fragmento || literal } : {}) });
    grouped.set(campo, list);
  }

  // A sparse batch may label a full name as `nombre`, while another source
  // explicitly separates the given names and both surnames. Reconcile ONLY an
  // exact concatenation already evidenced by those separate fields. Never
  // split an isolated full name, guess surnames or resolve different people.
  const uniqueSurname = (key: string) => {
    const fields = grouped.get(key) || [];
    return new Set(fields.map(field => normalize(field.valor))).size === 1 ? fields[0]?.valor : undefined;
  };
  const paternal = uniqueSurname('apellido_paterno'), maternal = uniqueSurname('apellido_materno');
  const names = grouped.get('nombre') || [];
  if (options.reconcileNames !== false && paternal && maternal) for (const field of names) {
    const given = names.find(other => other !== field &&
      normalize(field.valor) === normalize(`${other.valor} ${paternal} ${maternal}`));
    if (given) {
      field.fragmento ||= field.valor;
      field.valor = given.valor;
    }
  }

  const values: Record<string, string> = {};
  const proposals: Record<string, any> = {};
  const conflicts: ExtractionConflict[] = [];
  const escalationDocumentIds = new Set<string>();

  for (const [campo, candidates] of grouped) {
    const ordered = [...candidates].sort((a, b) => sourceRank(a) - sourceRank(b));
    if (ordered.some(candidate => !hasValidIdentifierStructure(campo, candidate.valor))) {
      const conflict = { campo, alternativas: ordered.map(candidate => ({ ...candidate, documento_id: candidate.documento_id || '', fuente: candidate.fuente || 'Documento' })),
        motivo: 'La lectura del identificador no cumple su estructura. Revisa el original; no se corrigieron caracteres automáticamente.' };
      conflicts.push(conflict);
      proposals[campo] = { estado: 'EN_CONFLICTO', alternativas: conflict.alternativas, nota: conflict.motivo };
      continue;
    }
    if (campo.startsWith('fecha_') && ordered.some(candidate => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.valor)) return true;
      const date = new Date(candidate.valor + 'T00:00:00Z');
      return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate.valor;
    })) {
      const conflict = { campo, alternativas: ordered.map(candidate => ({ ...candidate, documento_id: candidate.documento_id || '', fuente: candidate.fuente || 'Documento' })),
        motivo: 'Fecha incompleta, ambigua o no válida: confirma día, mes y año sin completar valores por defecto.' };
      conflicts.push(conflict);
      proposals[campo] = { estado: 'EN_CONFLICTO', alternativas: conflict.alternativas, nota: conflict.motivo };
      continue;
    }
    const distinct = new Map<string, ExtractionField>();
    for (const candidate of ordered) {
      if (!distinct.has(normalize(candidate.valor))) distinct.set(normalize(candidate.valor), candidate);
      if (candidate.confianza !== 'LECTURA_CLARA' && candidate.documento_id) escalationDocumentIds.add(candidate.documento_id);
    }

    if (distinct.size > 1) {
      const alternativas = [...distinct.values()].map((candidate) => ({
        valor: candidate.valor,
        fuente: candidate.fuente || 'Documento sin nombre',
        documento_id: candidate.documento_id || '',
        confianza: candidate.confianza,
        pagina: candidate.pagina,
        fragmento: candidate.fragmento,
      }));
      for (const candidate of alternativas) if (candidate.documento_id) escalationDocumentIds.add(candidate.documento_id);
      const conflict = { campo, alternativas, motivo: 'Las fuentes contienen valores distintos; se requiere decisión humana.' };
      conflicts.push(conflict);
      proposals[campo] = { estado: 'EN_CONFLICTO', alternativas, nota: conflict.motivo };
      continue;
    }

    const selected = ordered[0];
    values[campo] = selected.valor;
    proposals[campo] = {
      valor: selected.valor,
      fuente: selected.fuente || 'Documento sin nombre',
      documento_id: selected.documento_id || '',
      confianza: selected.confianza,
      pagina: selected.pagina,
      fragmento: selected.fragmento,
      ...(selected.verificacion_local === 'MRZ_TD3' ? { verificacion_local: selected.verificacion_local } : {}),
      estado: 'PENDIENTE_CONFIRMACION',
    };
  }

  return {
    values,
    proposals,
    conflicts,
    needsEscalation: conflicts.length > 0 || escalationDocumentIds.size > 0,
    escalationDocumentIds: [...escalationDocumentIds],
  };
}
