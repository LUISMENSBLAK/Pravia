import { createHash } from 'crypto';

export type Exp006Multiplicity = 'EXPEDIENTE' | 'COMPARECIENTE' | 'INMUEBLE' | 'CANTIDAD_FIJA';
export type Exp006Subject = 'EXPEDIENTE' | 'COMPARECIENTE' | 'INMUEBLE' | 'FIJO';

export type Exp006Rule = {
  id: string;
  artefacto_id: string;
  tipo_persona?: 'FISICA' | 'MORAL' | null;
  caracter_compareciente_id?: string | null;
  etapa_requerida_id?: string | null;
  momento_limite_etapa_id?: string | null;
  obligatoria: boolean;
  multiplicidad: Exp006Multiplicity;
  cantidad_fija?: number | null;
  condiciones_json?: unknown;
  activa: boolean;
  codigo_regla?: string | null;
  revision?: number;
  normativaRevision?: {
    id: string; codigo_revision: string; revision: number; fundamento_normativo: string; version_normativa: string;
    tipo_cliente?: string | null; nacionalidad_condicion?: string | null; regimen_simplificado?: boolean | null;
    actividad_vulnerable?: boolean | null; requiere_bc: boolean; requiere_riesgo: boolean; requiere_pep: boolean;
    requiere_perfil: boolean; requiere_alto_riesgo: boolean; vigencia_desde: Date; condiciones_json?: unknown;
  } | null;
};

export type Exp006Artifact = {
  id: string;
  nombre: string;
  tipo: 'PLANTILLA' | 'FORMATO';
  propietario_tipo: 'NOTARIA' | 'INSTITUCION';
  notaria_id?: string | null;
  institucion_id?: string | null;
  activo: boolean;
  actos: Array<{ tipo_acto_id: string }>;
  reglas: Exp006Rule[];
  versiones: Array<{ id: string; version: number; checksum_sha256: string; activa: boolean }>;
};

export type Exp006Context = {
  expedienteId: string;
  notariaId?: string | null;
  institutionIds: string[];
  currentStageId?: string | null;
  acts: Array<{ id: string; typeId: string; name: string }>;
  parties: Array<{ relationId: string; partyId: string; actId: string; personType: 'FISICA' | 'MORAL'; roleId: string; name: string; nationality?: string | null; migrationStatus?: string | null }>;
  properties: Array<{ relationId: string; propertyId: string; actIds: string[]; name: string }>;
  complianceFacts?: Record<string, boolean | string | null | undefined>;
};

export type Exp006Resolution = {
  identityKey: string;
  artifactId: string;
  ruleId: string;
  masterVersionId: string;
  expedienteActoId: string | null;
  subjectType: Exp006Subject;
  subjectId: string | null;
  ordinal: number;
  mandatory: boolean;
  normativeRevisionId: string | null;
  evaluatedFacts: Record<string, unknown>;
  pendingConditions: string[];
  sourceRevision: string;
  snapshot: Record<string, unknown>;
};

export type Exp006UnresolvedDecision = {
  artifactId: string;
  artifactName: string;
  ruleId: string;
  subjectType: Exp006Subject;
  subjectId: string | null;
  normativeRevisionId: string | null;
  evaluatedFacts: Record<string, unknown>;
  pendingConditions: string[];
};

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
const conditionObject = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const exp006Identity = (ruleId: string, subjectType: Exp006Subject, subjectId: string | null, ordinal = 1) =>
  `${ruleId}:${subjectType}:${subjectId || 'case'}:${ordinal}`;

function ownerMatches(artifact: Exp006Artifact, context: Exp006Context) {
  if (artifact.propietario_tipo === 'NOTARIA') return Boolean(context.notariaId && artifact.notaria_id === context.notariaId);
  return artifact.tipo === 'FORMATO' && Boolean(artifact.institucion_id && context.institutionIds.includes(artifact.institucion_id));
}

function otherConditionsMatch(rule: Exp006Rule, context: Exp006Context) {
  const conditions = conditionObject(rule.condiciones_json);
  if (conditions.notaria_id && conditions.notaria_id !== context.notariaId) return false;
  if (conditions.institucion_id && !context.institutionIds.includes(String(conditions.institucion_id))) return false;
  if (conditions.etapa_id && conditions.etapa_id !== context.currentStageId) return false;
  const allowedStages = Array.isArray(conditions.etapas_ids) ? conditions.etapas_ids.map(String) : [];
  if (allowedStages.length && (!context.currentStageId || !allowedStages.includes(context.currentStageId))) return false;
  return true;
}

const normalized = (value?: string | null) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

function legalConditions(rule: Exp006Rule, party: Exp006Context['parties'][number] | null, context: Exp006Context) {
  const normative = rule.normativaRevision;
  if (!normative) return { matches: true, facts: {}, pending: [] as string[] };
  const normativeConditions = conditionObject(normative.condiciones_json);
  const facts: Record<string, unknown> = {
    tipo_persona: party?.personType || null,
    nacionalidad: party?.nationality || null,
    condicion_migratoria: party?.migrationStatus || null,
    compliance: context.complianceFacts || {},
  };
  const pending: string[] = [];
  if (normative.tipo_cliente === 'FISICA' && party?.personType !== 'FISICA') return { matches: false, facts, pending };
  if (normative.tipo_cliente === 'MORAL' && party?.personType !== 'MORAL') return { matches: false, facts, pending };
  const nationality = normalized(party?.nationality);
  const migration = normalized(party?.migrationStatus);
  if (normative.nacionalidad_condicion === 'MEXICANA_O_RESIDENTE') {
    if (!nationality && !migration) pending.push('nacionalidad_condicion_migratoria');
    else if (!(nationality.includes('MEXIC') || migration.includes('RESIDENT'))) return { matches: false, facts, pending };
  }
  if (normative.nacionalidad_condicion === 'EXTRANJERA_VISITANTE') {
    if (!nationality || !migration) pending.push(!nationality ? 'nacionalidad' : 'condicion_migratoria');
    else if (nationality.includes('MEXIC') || !migration.includes('VISIT')) return { matches: false, facts, pending };
  }
  if (normative.nacionalidad_condicion === 'MEXICANA' && !nationality.includes('MEXIC')) return { matches: false, facts, pending: nationality ? pending : ['nacionalidad'] };
  if (normative.nacionalidad_condicion === 'EXTRANJERA' && nationality.includes('MEXIC')) return { matches: false, facts, pending };
  if (normative.nacionalidad_condicion === 'EXTRANJERA' && !nationality) pending.push('nacionalidad');
  const requireConfirmedFact = (key: string) => {
    if (context.complianceFacts?.[key] === false) return false;
    if (context.complianceFacts?.[key] !== true) pending.push(key);
    return true;
  };
  for (const key of [
    'fideicomiso_aplicable_confirmado',
    'persona_moral_derecho_publico_confirmada',
    'organismo_internacional_confirmado',
    'solicitante_material_aplicable_confirmado',
  ]) {
    if (normativeConditions[key] === true && !requireConfirmedFact(key)) return { matches: false, facts, pending };
  }
  if (typeof normativeConditions.risk_level === 'string') {
    const expectedRisk = normalized(String(normativeConditions.risk_level));
    const confirmedRisk = normalized(String(context.complianceFacts?.nivel_riesgo_confirmado || ''));
    if (confirmedRisk && confirmedRisk !== expectedRisk) return { matches: false, facts, pending };
    if (!confirmedRisk) pending.push('nivel_riesgo_confirmado');
  }
  const checks: Array<[boolean, string]> = [
    [normative.actividad_vulnerable === true, 'actividad_vulnerable_confirmada'],
    [normative.regimen_simplificado === true, 'regimen_simplificado_confirmado'],
    [normative.requiere_bc, 'beneficiario_controlador_confirmado'],
    [normative.requiere_riesgo, 'riesgo_aplicable_confirmado'],
    [normative.requiere_pep, 'pep_aplicable_confirmado'],
    [normative.requiere_perfil, 'perfil_transaccional_aplicable'],
    [normative.requiere_alto_riesgo, 'alto_riesgo_confirmado'],
  ];
  for (const [required, key] of checks) {
    if (!required) continue;
    if (!requireConfirmedFact(key)) return { matches: false, facts, pending };
  }
  return { matches: pending.length === 0, facts, pending };
}

export function resolveExp006(
  artifacts: Exp006Artifact[],
  context: Exp006Context,
  unresolved: Exp006UnresolvedDecision[] = [],
): Exp006Resolution[] {
  const result = new Map<string, Exp006Resolution>();
  const activeActTypes = new Map(context.acts.map((act) => [act.typeId, act]));
  for (const artifact of artifacts) {
    if (!artifact.activo || !ownerMatches(artifact, context)) continue;
    if (artifact.propietario_tipo === 'INSTITUCION' && artifact.tipo !== 'FORMATO') continue;
    const matchingActs = artifact.actos.map((item) => activeActTypes.get(item.tipo_acto_id)).filter(Boolean) as Exp006Context['acts'];
    if (!matchingActs.length) continue;
    const masterVersion = [...artifact.versiones].filter((item) => item.activa).sort((a, b) => b.version - a.version)[0];
    if (!masterVersion) continue;
    for (const rule of artifact.reglas) {
      if (!rule.activa || !otherConditionsMatch(rule, context)) continue;
      if (rule.etapa_requerida_id && rule.etapa_requerida_id !== context.currentStageId) continue;
      const actIds = new Set(matchingActs.map((act) => act.id));
      const base = {
        artifactId: artifact.id, ruleId: rule.id, masterVersionId: masterVersion.id, mandatory: rule.obligatoria,
        normativeRevisionId: rule.normativaRevision?.id || null,
      };
      const push = (subjectType: Exp006Subject, subjectId: string | null, ordinal: number, actId: string | null, subjectName: string, party: Exp006Context['parties'][number] | null = null) => {
        const legal = legalConditions(rule, party, context);
        if (!legal.matches) {
          if (legal.pending.length) unresolved.push({
            artifactId: artifact.id, artifactName: artifact.nombre, ruleId: rule.id,
            subjectType, subjectId, normativeRevisionId: rule.normativaRevision?.id || null,
            evaluatedFacts: legal.facts, pendingConditions: [...new Set(legal.pending)],
          });
          return;
        }
        const identityKey = exp006Identity(rule.id, subjectType, subjectId, ordinal);
        const snapshot = {
          source: 'CFG-002', artifact_id: artifact.id, artifact_name: artifact.nombre, artifact_type: artifact.tipo,
          owner_type: artifact.propietario_tipo, owner_id: artifact.notaria_id || artifact.institucion_id,
          rule_id: rule.id, master_version_id: masterVersion.id, master_version: masterVersion.version,
          act_ids: matchingActs.map((act) => act.id), act_names: matchingActs.map((act) => act.name),
          selected_act_id: actId, subject_type: subjectType, subject_id: subjectId, subject_name: subjectName,
          person_type: rule.tipo_persona || null, role_id: rule.caracter_compareciente_id || null,
          required_stage_id: rule.etapa_requerida_id || null, deadline_stage_id: rule.momento_limite_etapa_id || null,
          mandatory: rule.obligatoria, multiplicity: rule.multiplicidad, ordinal,
          conditions: conditionObject(rule.condiciones_json), editable_rule_copy: false,
          normative_revision_id: rule.normativaRevision?.id || null,
          normative_revision: rule.normativaRevision?.revision || null,
          normative_version: rule.normativaRevision?.version_normativa || null,
          legal_basis: rule.normativaRevision?.fundamento_normativo || null,
          evaluated_facts: legal.facts, pending_conditions: legal.pending,
        };
        const sourceRevision = hash({ masterVersion, rule, context: {
          notariaId: context.notariaId, institutionIds: [...context.institutionIds].sort(), currentStageId: context.currentStageId,
          acts: matchingActs.map((item) => item.id).sort(), subjectType, subjectId, ordinal, actId,
          legalFacts: legal.facts,
        } });
        result.set(identityKey, { identityKey, ...base, expedienteActoId: actId, subjectType, subjectId, ordinal, sourceRevision, snapshot, evaluatedFacts: legal.facts, pendingConditions: legal.pending });
      };
      if (rule.multiplicidad === 'EXPEDIENTE') {
        push('EXPEDIENTE', context.expedienteId, 1, matchingActs[0].id, 'Expediente');
      } else if (rule.multiplicidad === 'COMPARECIENTE') {
        for (const party of context.parties.filter((item) => actIds.has(item.actId) && (!rule.tipo_persona || item.personType === rule.tipo_persona) && (!rule.caracter_compareciente_id || item.roleId === rule.caracter_compareciente_id))) {
          push('COMPARECIENTE', party.relationId, 1, party.actId, party.name, party);
        }
      } else if (rule.multiplicidad === 'INMUEBLE') {
        for (const property of context.properties.filter((item) => item.actIds.some((id) => actIds.has(id)))) {
          push('INMUEBLE', property.relationId, 1, property.actIds.find((id) => actIds.has(id)) || matchingActs[0].id, property.name);
        }
      } else {
        const count = Math.max(0, Math.min(100, Number(rule.cantidad_fija || 0)));
        for (let ordinal = 1; ordinal <= count; ordinal += 1) push('FIJO', null, ordinal, matchingActs[0].id, `Ejemplar ${ordinal}`);
      }
    }
  }
  return [...result.values()].sort((a, b) => a.identityKey.localeCompare(b.identityKey));
}

export const exp006ResolutionRevision = (rows: Exp006Resolution[]) => hash(rows.map((row) => ({ identity: row.identityKey, revision: row.sourceRevision })));

export function assertStrictPartySourceScope(pending: Pick<Exp006Resolution, 'subjectType' | 'subjectId'>, requestedDocumentIds?: string[]) {
  if (requestedDocumentIds?.length) throw Object.assign(new Error('Las fuentes documentales se resuelven exclusivamente en el backend.'), { code: 'EXP006_FRONTEND_SOURCE_INJECTION' });
  if (pending.subjectType !== 'COMPARECIENTE' || !pending.subjectId) throw Object.assign(new Error('La generación individual requiere una comparecencia inequívoca.'), { code: 'EXP006_INDIVIDUAL_SUBJECT_REQUIRED' });
}
