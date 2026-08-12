export type ExtractionConfidence = 'LECTURA_CLARA' | 'LECTURA_DUDOSA' | 'LECTURA_DEFICIENTE';

export interface ExtractionField {
  campo: string;
  valor: string;
  confianza: ExtractionConfidence;
  fuente?: string;
  documento_id?: string;
  pagina?: number;
  fragmento?: string;
}

export interface ExtractionConflict {
  campo: string;
  alternativas: Array<{
    valor: string;
    fuente: string;
    documento_id: string;
    confianza: ExtractionConfidence;
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

function sourceRank(field: ExtractionField) {
  const rules = SOURCE_RULES[field.campo] || [];
  const source = normalize(field.fuente || '');
  const match = rules.findIndex((keywords) => keywords.some((keyword) => source.includes(keyword)));
  return match === -1 ? rules.length + 1 : match;
}

export function consolidateExtractedFields(fields: ExtractionField[]) {
  const grouped = new Map<string, ExtractionField[]>();
  for (const field of fields) {
    const campo = String(field.campo || '').trim();
    const valor = String(field.valor || '').trim();
    if (!campo || !valor) continue;
    const list = grouped.get(campo) || [];
    list.push({ ...field, campo, valor });
    grouped.set(campo, list);
  }

  const values: Record<string, string> = {};
  const proposals: Record<string, any> = {};
  const conflicts: ExtractionConflict[] = [];
  const escalationDocumentIds = new Set<string>();

  for (const [campo, candidates] of grouped) {
    const ordered = [...candidates].sort((a, b) => sourceRank(a) - sourceRank(b));
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
