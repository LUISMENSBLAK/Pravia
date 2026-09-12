import { describe, expect, it } from 'vitest';
import { assertStrictPartySourceScope, exp006Identity, exp006ResolutionRevision, resolveExp006, type Exp006Artifact, type Exp006Context } from './expedienteArtifacts';

const context = (overrides: Partial<Exp006Context> = {}): Exp006Context => ({
  expedienteId: 'case-1', notariaId: 'notary-1', institutionIds: ['bank-1'], currentStageId: 'stage-prefirma',
  acts: [{ id: 'case-act-sale', typeId: 'act-sale', name: 'Compraventa' }, { id: 'case-act-trust', typeId: 'act-trust', name: 'Fideicomiso' }],
  parties: [
    { relationId: 'rel-juan-sale', partyId: 'juan', actId: 'case-act-sale', personType: 'FISICA', roleId: 'seller', name: 'Juan' },
    { relationId: 'rel-juan-trust', partyId: 'juan', actId: 'case-act-trust', personType: 'FISICA', roleId: 'representative', name: 'Juan' },
    { relationId: 'rel-acme-sale', partyId: 'acme', actId: 'case-act-sale', personType: 'MORAL', roleId: 'seller', name: 'Acme' },
  ],
  properties: [
    { relationId: 'property-a', propertyId: 'a', actIds: ['case-act-sale'], name: 'Predio A' },
    { relationId: 'property-b', propertyId: 'b', actIds: ['case-act-sale', 'case-act-trust'], name: 'Predio B' },
  ],
  ...overrides,
});

const artifact = (overrides: Partial<Exp006Artifact> = {}): Exp006Artifact => ({
  id: 'artifact-1', nombre: 'Anexo operativo', tipo: 'FORMATO', propietario_tipo: 'NOTARIA', notaria_id: 'notary-1', activo: true,
  actos: [{ tipo_acto_id: 'act-sale' }],
  reglas: [{ id: 'rule-1', artefacto_id: 'artifact-1', obligatoria: true, multiplicidad: 'EXPEDIENTE', activa: true }],
  versiones: [{ id: 'version-1', version: 1, checksum_sha256: 'sha', activa: true }],
  ...overrides,
});

describe('EXP-006 resolver operacional', () => {
  it('resuelve exactamente una vez por expediente aunque existan varios sujetos', () => {
    const rows = resolveExp006([artifact()], context());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectType: 'EXPEDIENTE', subjectId: 'case-1', mandatory: true });
  });

  it('filtra propietario Notaría de forma exacta', () => {
    expect(resolveExp006([artifact()], context({ notariaId: 'notary-2' }))).toEqual([]);
  });

  it('permite formato institucional y bloquea plantilla bancaria', () => {
    const bank = artifact({ propietario_tipo: 'INSTITUCION', notaria_id: null, institucion_id: 'bank-1' });
    expect(resolveExp006([bank], context())).toHaveLength(1);
    expect(resolveExp006([{ ...bank, tipo: 'PLANTILLA' }], context())).toEqual([]);
  });

  it('resuelve únicamente actos configurados', () => {
    expect(resolveExp006([artifact({ actos: [{ tipo_acto_id: 'unknown' }] })], context())).toEqual([]);
  });

  it('multiplica por vínculo compareciente y filtra tipo y rol por acto', () => {
    const input = artifact({ reglas: [{ id: 'rule-party', artefacto_id: 'artifact-1', obligatoria: true, multiplicidad: 'COMPARECIENTE', tipo_persona: 'FISICA', caracter_compareciente_id: 'seller', activa: true }] });
    const rows = resolveExp006([input], context());
    expect(rows.map((row) => row.subjectId)).toEqual(['rel-juan-sale']);
    expect(rows[0].expedienteActoId).toBe('case-act-sale');
  });

  it('la misma persona en otro acto usa su vínculo y rol contextual distinto', () => {
    const input = artifact({ actos: [{ tipo_acto_id: 'act-trust' }], reglas: [{ id: 'rule-rep', artefacto_id: 'artifact-1', obligatoria: false, multiplicidad: 'COMPARECIENTE', caracter_compareciente_id: 'representative', activa: true }] });
    expect(resolveExp006([input], context()).map((row) => row.subjectId)).toEqual(['rel-juan-trust']);
  });

  it('multiplica una vez por relación de inmueble aplicable', () => {
    const input = artifact({ reglas: [{ id: 'rule-property', artefacto_id: 'artifact-1', obligatoria: true, multiplicidad: 'INMUEBLE', activa: true }] });
    expect(resolveExp006([input], context()).map((row) => row.subjectId)).toEqual(['property-a', 'property-b']);
  });

  it('crea exactamente N instancias fijas sin duplicar la regla', () => {
    const input = artifact({ reglas: [{ id: 'rule-fixed', artefacto_id: 'artifact-1', obligatoria: false, multiplicidad: 'CANTIDAD_FIJA', cantidad_fija: 3, activa: true }] });
    expect(resolveExp006([input], context()).map((row) => row.ordinal)).toEqual([1, 2, 3]);
  });

  it('respeta etapa requerida y condiciones de etapa', () => {
    const input = artifact({ reglas: [{ id: 'rule-stage', artefacto_id: 'artifact-1', obligatoria: true, multiplicidad: 'EXPEDIENTE', etapa_requerida_id: 'stage-firma', activa: true }] });
    expect(resolveExp006([input], context())).toEqual([]);
    expect(resolveExp006([input], context({ currentStageId: 'stage-firma' }))).toHaveLength(1);
  });

  it('selecciona la versión maestra activa más reciente y conserva explicación', () => {
    const input = artifact({ versiones: [{ id: 'v1', version: 1, checksum_sha256: '1', activa: true }, { id: 'v2', version: 2, checksum_sha256: '2', activa: true }] });
    const [row] = resolveExp006([input], context());
    expect(row.masterVersionId).toBe('v2');
    expect(row.snapshot).toMatchObject({ source: 'CFG-002', editable_rule_copy: false, master_version: 2 });
  });

  it('produce identidad y revisión estables ante el mismo contexto', () => {
    const first = resolveExp006([artifact()], context());
    const second = resolveExp006([artifact()], context());
    expect(exp006Identity('rule-1', 'EXPEDIENTE', 'case-1')).toBe('rule-1:EXPEDIENTE:case-1:1');
    expect(exp006ResolutionRevision(first)).toBe(exp006ResolutionRevision(second));
  });

  it('elige A3 para física mexicana/residente y A5 para extranjera visitante sin duplicarlas', () => {
    const normative = (id: string, condition: string) => ({ id, codigo_revision: id, revision: 1, fundamento_normativo: 'LFPIORPI', version_normativa: '2026', tipo_cliente: 'FISICA', nacionalidad_condicion: condition, actividad_vulnerable: true, requiere_bc: false, requiere_riesgo: false, requiere_pep: false, requiere_perfil: false, requiere_alto_riesgo: false, vigencia_desde: new Date() });
    const a3 = artifact({ id: 'a3', reglas: [{ id: 'r-a3', artefacto_id: 'a3', obligatoria: true, multiplicidad: 'COMPARECIENTE', tipo_persona: 'FISICA', activa: true, normativaRevision: normative('n-a3', 'MEXICANA_O_RESIDENTE') }] });
    const a5 = artifact({ id: 'a5', reglas: [{ id: 'r-a5', artefacto_id: 'a5', obligatoria: true, multiplicidad: 'COMPARECIENTE', tipo_persona: 'FISICA', activa: true, normativaRevision: normative('n-a5', 'EXTRANJERA_VISITANTE') }] });
    const rows = resolveExp006([a3, a5], context({ parties: [{ relationId: 'rel', partyId: 'p', actId: 'case-act-sale', personType: 'FISICA', roleId: 'seller', name: 'Ana', nationality: 'Mexicana', migrationStatus: null }], complianceFacts: { actividad_vulnerable_confirmada: true } }));
    expect(rows.map((row) => row.ruleId)).toEqual(['r-a3']);
  });

  it('expresa una decisión pendiente cuando faltan hechos jurídicos confirmados', () => {
    const unresolved: any[] = [];
    const input = artifact({ reglas: [{ id: 'rule-bc', artefacto_id: 'artifact-1', obligatoria: true, multiplicidad: 'COMPARECIENTE', tipo_persona: 'MORAL', activa: true, normativaRevision: { id: 'norm-bc', codigo_revision: 'PLD-A4', revision: 1, fundamento_normativo: 'LFPIORPI', version_normativa: '2026', tipo_cliente: 'MORAL', nacionalidad_condicion: 'MEXICANA', actividad_vulnerable: true, requiere_bc: true, requiere_riesgo: false, requiere_pep: false, requiere_perfil: false, requiere_alto_riesgo: false, vigencia_desde: new Date() } }] });
    const rows = resolveExp006([input], context({ parties: [{ relationId: 'rel-acme-sale', partyId: 'acme', actId: 'case-act-sale', personType: 'MORAL', roleId: 'seller', name: 'Acme', nationality: 'Mexicana' }], complianceFacts: {} }), unresolved);
    expect(rows).toEqual([]);
    expect(unresolved[0]).toMatchObject({ ruleId: 'rule-bc', normativeRevisionId: 'norm-bc', pendingConditions: expect.arrayContaining(['actividad_vulnerable_confirmada', 'beneficiario_controlador_confirmado']) });
  });

  it('no materializa solicitante material sin el hecho confirmado y sí lo hace al confirmarlo', () => {
    const input = artifact({ reglas: [{
      id: 'rule-material', artefacto_id: 'artifact-1', obligatoria: true, multiplicidad: 'EXPEDIENTE', activa: true,
      normativaRevision: {
        id: 'norm-material', codigo_revision: 'PLD-NOT-001', revision: 1, fundamento_normativo: 'RCG art. 13', version_normativa: '2026',
        actividad_vulnerable: true, requiere_bc: false, requiere_riesgo: false, requiere_pep: false, requiere_perfil: false,
        requiere_alto_riesgo: false, vigencia_desde: new Date(), condiciones_json: { solicitante_material_aplicable_confirmado: true },
      },
    }] });
    const unresolved: any[] = [];
    expect(resolveExp006([input], context({ complianceFacts: { actividad_vulnerable_confirmada: true } }), unresolved)).toEqual([]);
    expect(unresolved[0].pendingConditions).toContain('solicitante_material_aplicable_confirmado');
    expect(resolveExp006([input], context({ complianceFacts: { actividad_vulnerable_confirmada: true, solicitante_material_aplicable_confirmado: false } }))).toEqual([]);
    expect(resolveExp006([input], context({ complianceFacts: { actividad_vulnerable_confirmada: true, solicitante_material_aplicable_confirmado: true } }))).toHaveLength(1);
  });

  it('aplica régimen simplificado sólo con clasificación BAJO confirmada', () => {
    const input = artifact({ reglas: [{
      id: 'rule-a7', artefacto_id: 'artifact-1', obligatoria: true, multiplicidad: 'EXPEDIENTE', activa: true,
      normativaRevision: {
        id: 'norm-a7', codigo_revision: 'PLD-A7', revision: 1, fundamento_normativo: 'RCG art. 12 fr. V', version_normativa: '2026',
        regimen_simplificado: true, actividad_vulnerable: true, requiere_bc: false, requiere_riesgo: false, requiere_pep: false,
        requiere_perfil: false, requiere_alto_riesgo: false, vigencia_desde: new Date(), condiciones_json: { risk_level: 'BAJO' },
      },
    }] });
    const baseFacts = { actividad_vulnerable_confirmada: true, regimen_simplificado_confirmado: true };
    expect(resolveExp006([input], context({ complianceFacts: { ...baseFacts, nivel_riesgo_confirmado: 'ALTO' } }))).toEqual([]);
    expect(resolveExp006([input], context({ complianceFacts: { ...baseFacts, nivel_riesgo_confirmado: 'BAJO' } }))).toHaveLength(1);
  });

  it('no asume fideicomiso por el nombre del acto; exige el hecho estructurado confirmado', () => {
    const input = artifact({ actos: [{ tipo_acto_id: 'act-trust' }], reglas: [{
      id: 'rule-a8', artefacto_id: 'artifact-1', obligatoria: true, multiplicidad: 'EXPEDIENTE', activa: true,
      normativaRevision: {
        id: 'norm-a8', codigo_revision: 'PLD-A8', revision: 1, fundamento_normativo: 'Anexo 8', version_normativa: '2026',
        tipo_cliente: 'FIDEICOMISO', actividad_vulnerable: true, requiere_bc: true, requiere_riesgo: false, requiere_pep: false,
        requiere_perfil: false, requiere_alto_riesgo: false, vigencia_desde: new Date(), condiciones_json: { fideicomiso_aplicable_confirmado: true },
      },
    }] });
    const unresolved: any[] = [];
    expect(resolveExp006([input], context({ complianceFacts: { actividad_vulnerable_confirmada: true, beneficiario_controlador_confirmado: true } }), unresolved)).toEqual([]);
    expect(unresolved[0].pendingConditions).toContain('fideicomiso_aplicable_confirmado');
    expect(resolveExp006([input], context({ complianceFacts: { actividad_vulnerable_confirmada: true, beneficiario_controlador_confirmado: true, fideicomiso_aplicable_confirmado: true } }))).toHaveLength(1);
  });

  it('bloquea fuentes del frontend y generación no individual', () => {
    expect(() => assertStrictPartySourceScope({ subjectType: 'COMPARECIENTE', subjectId: 'rel-1' }, ['foreign-doc'])).toThrow();
    expect(() => assertStrictPartySourceScope({ subjectType: 'EXPEDIENTE', subjectId: 'case-1' })).toThrow();
    expect(() => assertStrictPartySourceScope({ subjectType: 'COMPARECIENTE', subjectId: 'rel-1' })).not.toThrow();
  });
});
