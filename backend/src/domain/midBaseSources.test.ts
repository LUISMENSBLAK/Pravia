import { TimingCalculationStatus, TimingPolicyType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { emptyTime, operationalActivityFact, operationalPhase, stableMidBaseSort, timingFact } from './midBaseSources';

const now = new Date('2026-09-05T12:00:00.000Z');
const activity = (overrides: Record<string, unknown> = {}) => ({
  id: 'activity-1', etapa_nombre_snapshot: 'Prefirma', etapa_orden_snapshot: 1,
  actividad_nombre_snapshot: 'Integrar proyecto', estado: 'EN_PROCESO', en_alcance: true,
  duracion_estimada: 3, tipo_dias: 'NATURALES', margen_seguridad: 1,
  primera_fecha_inicio: new Date('2026-09-01T12:00:00.000Z'), fecha_completada_actual: null,
  excepcion_operativa: null, ...overrides,
});

describe('G1 MID-BASE · cálculo puro y fronteras contractuales', () => {
  it.each([
    ['Prefirma', 1, 2, 'PRE_SIGNATURE'],
    ['Firma', 2, 2, 'PRE_SIGNATURE'],
    ['Postfirma', 3, 2, 'POST_SIGNATURE'],
    ['Registro', 4, 2, 'POST_SIGNATURE'],
    ['Etapa configurada anterior', 1, 2, 'PRE_SIGNATURE'],
    ['Etapa configurada posterior', 3, 2, 'POST_SIGNATURE'],
  ])('separa %s usando snapshot CFG-001', (name, order, signatureOrder, expected) => {
    expect(operationalPhase({ etapa_nombre_snapshot: name, etapa_orden_snapshot: order }, signatureOrder)).toBe(expected);
  });

  it('conserva estados temporales explícitos sin fabricar overdue', () => {
    for (const state of [TimingCalculationStatus.NOT_CONFIGURED, TimingCalculationStatus.UNKNOWN_LEGACY, TimingCalculationStatus.NOT_APPLICABLE]) {
      expect(emptyTime(state, { source: 'test' })).toMatchObject({ calculationState: state, dueAt: null, elapsed: null, overdue: null });
    }
  });

  it('calcula desde la revisión pinneada y el reloj recibido', () => {
    const interval = { calculation_status: 'CALCULABLE', opened_at: new Date('2026-09-04T12:00:00Z'), closed_at: null, provenance: { source: 'G0-C' } };
    const revision = { id: 'r1', revision: 1, duration: 12, unit: 'HOURS', calendar_semantics: 'ELAPSED_UTC', domain: 'COMMERCIAL', policy_type: TimingPolicyType.PROSPECT_NOTARY_WAIT, provenance: {}, created_by_id: 'u', created_at: now, published_at: now, superseded_at: now };
    expect(timingFact(TimingPolicyType.PROSPECT_NOTARY_WAIT, 'p1', interval, revision, now, { state: 'UNKNOWN_LEGACY', openedAt: null, provenance: null })).toMatchObject({
      calculationState: 'CALCULABLE', policyRevisionId: 'r1', policyRevision: 1, elapsed: 24, overdue: true,
    });
  });

  it('una R2 corriente no sustituye la R1 entregada por el intervalo', () => {
    const interval = { calculation_status: 'CALCULABLE', opened_at: new Date('2026-09-04T12:00:00Z'), closed_at: null, provenance: { pinned: 'R1' } };
    const r1 = { id: 'r1', revision: 1, duration: 48, unit: 'HOURS', calendar_semantics: 'ELAPSED_UTC', domain: 'COMMERCIAL', policy_type: TimingPolicyType.PROSPECT_NOTARY_WAIT, provenance: {}, created_by_id: 'u', created_at: now, published_at: now, superseded_at: now };
    const result = timingFact(TimingPolicyType.PROSPECT_NOTARY_WAIT, 'p1', interval, r1, now, { state: 'UNKNOWN_LEGACY', openedAt: null, provenance: null });
    expect(result.policyRevision).toBe(1);
    expect(result.dueAt?.toISOString()).toBe('2026-09-06T12:00:00.000Z');
  });

  it('una revisión pinneada ausente o incompleta es NOT_CONFIGURED, nunca CALCULABLE falso', () => {
    const interval = { policy_revision_id: 'missing', calculation_status: 'CALCULABLE', opened_at: new Date('2026-09-04T12:00:00Z'), closed_at: null, provenance: { source: 'G0-C' } };
    expect(timingFact(TimingPolicyType.PROSPECT_NOTARY_WAIT, 'p1', interval, null, now, { state: 'UNKNOWN_LEGACY', openedAt: null, provenance: null })).toMatchObject({
      calculationState: 'NOT_CONFIGURED', policyRevisionId: 'missing', openedAt: new Date('2026-09-04T12:00:00Z'), dueAt: null, overdue: null,
    });
  });

  it('deriva dependencia, bloqueo, duración, restante y margen desde copia EXP-005', () => {
    const prerequisite = activity({ id: 'prerequisite', actividad_nombre_snapshot: 'Documento previo', estado: 'NO_INICIADO' });
    const result = operationalActivityFact(activity(), [{ id: 'dependency', actividad_id: 'activity-1', depende_actividad_id: 'prerequisite', bloqueante: true }], [activity(), prerequisite], now);
    expect(result).toMatchObject({ effectiveState: 'BLOQUEADO', blocked: true, incomplete: true, duration: 3, elapsed: 4, remainingDuration: 0, safetyMargin: 1, overdue: false });
    expect(result.dependencies).toEqual([{ id: 'dependency', prerequisiteActivityId: 'prerequisite', blocking: true, satisfied: false }]);
  });

  it('actividad sin inicio es NOT_APPLICABLE en tiempo y no simula transcurrido', () => {
    const result = operationalActivityFact(activity({ primera_fecha_inicio: null, estado: 'NO_INICIADO' }), [], [activity({ primera_fecha_inicio: null, estado: 'NO_INICIADO' })], now);
    expect(result).toMatchObject({ elapsed: null, remainingDuration: null, dueAt: null, overdue: null });
  });

  it('el orden es técnico estable por categoría, fecha e identificador, no prioridad', () => {
    const base: any = { organizationId: 'o', objectType: 'Prospecto', objectId: 'x', status: 'x', active: true, responsibility: { userId: null, role: null }, waitingOn: 'NONE', effectiveAt: null, provenance: null, time: emptyTime('NOT_APPLICABLE', null), links: {} };
    const rows: any[] = [
      { ...base, sourceKind: 'QUOTE', sourceId: 'quote:z' },
      { ...base, sourceKind: 'PROSPECT', sourceId: 'prospect:b' },
      { ...base, sourceKind: 'PROSPECT', sourceId: 'prospect:a' },
    ];
    expect(stableMidBaseSort(rows).map((row) => row.sourceId)).toEqual(['prospect:a', 'prospect:b', 'quote:z']);
    expect(JSON.stringify(rows)).not.toMatch(/priority|urgency|rank/i);
  });
});
