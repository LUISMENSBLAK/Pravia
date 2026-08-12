import fixtures from '../fixtures/ai-document-fixtures.json';
import { consolidateExtractedFields, type ExtractionField } from '../domain/documentExtraction';

export type EvaluationModel = 'gpt-5.4-nano' | 'gpt-5.4-mini';

const normalize = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase();

export function evaluateDocumentModel(model: EvaluationModel) {
  let checks = 0;
  let passed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedUsd = 0;
  let latencyMs = 0;

  const cases = fixtures.map((fixture) => {
    const sample = fixture.models[model];
    const result = consolidateExtractedFields(sample.fields as ExtractionField[]);
    const failures: string[] = [];
    inputTokens += sample.input_tokens;
    outputTokens += sample.output_tokens;
    estimatedUsd += sample.estimated_usd;
    latencyMs += sample.latency_ms;

    for (const [field, expected] of Object.entries(fixture.expected_values)) {
      checks += 1;
      if (normalize(result.values[field] || '') === normalize(expected)) passed += 1;
      else failures.push(`valor:${field}`);
    }
    for (const field of fixture.expected_conflicts) {
      checks += 1;
      if (result.conflicts.some((conflict) => conflict.campo === field)) passed += 1;
      else failures.push(`conflicto:${field}`);
    }
    checks += 1;
    if (result.needsEscalation === fixture.expected_escalation) passed += 1;
    else failures.push('escalamiento');

    const traceable = Object.values(result.proposals).every((proposal: any) =>
      proposal.estado === 'EN_CONFLICTO'
        ? proposal.alternativas.every((item: any) => Boolean(item.documento_id && item.fuente))
        : Boolean(proposal.documento_id && proposal.fuente));
    checks += 1;
    if (traceable) passed += 1;
    else failures.push('trazabilidad');

    return { id: fixture.id, kind: fixture.kind, passed: failures.length === 0, failures };
  });

  return {
    model,
    dataset: 'sintetico_offline',
    fixture_count: fixtures.length,
    checks,
    passed,
    accuracy: checks ? passed / checks : 0,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_usd: Number(estimatedUsd.toFixed(6)),
    mean_fixture_latency_ms: Math.round(latencyMs / fixtures.length),
    cases,
    disclaimer: 'Métricas reproducibles de contrato con salidas sintéticas; no sustituyen una corrida pagada con documentos reales autorizados.',
  };
}

export function evaluateAllDocumentModels() {
  return [evaluateDocumentModel('gpt-5.4-nano'), evaluateDocumentModel('gpt-5.4-mini')];
}
