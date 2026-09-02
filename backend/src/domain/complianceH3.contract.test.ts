import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  deriveScreeningExecutionState,
  requirementStateFromScreening,
  screeningCandidateScore,
  screeningIdentityFingerprint,
  type H3IdentitySnapshot,
} from './complianceScreening';

const identity: H3IdentitySnapshot = {
  tipo_persona: 'FISICA', primary_name: 'PERSONA SINTETICA UNO', aliases: ['P. SINTETICA'],
  birth_date: '1990-01-01', birth_place: 'LOCALIDAD DE PRUEBA', birth_country: 'MX', nationality: 'MX',
  curp: 'SINT900101HNTXXX01', rfc: 'SINT900101AA1', identification: { type: 'TEST', number: 'ID-001', country: 'MX' },
  incorporation_date: null, commercial_name: null, commercial_folio: null, corporate_type: null,
};
const migration = readFileSync(resolve(__dirname, '../../prisma/migrations/20260901020000_create_h3_compliance_screening/migration.sql'), 'utf8');
const service = readFileSync(resolve(__dirname, '../services/complianceScreening.service.ts'), 'utf8');
const legalEngine = readFileSync(resolve(__dirname, '../services/complianceLegalEngine.service.ts'), 'utf8');
const report = readFileSync(resolve(__dirname, 'screeningReportPdf.ts'), 'utf8');

type Check = { name: string; run: () => void };
const cases: Check[] = [
  { name: '01 no sources is NOT_CONFIGURED', run: () => expect(deriveScreeningExecutionState([])).toBe('NOT_CONFIGURED') },
  { name: '02 all unconfigured is NOT_CONFIGURED', run: () => expect(deriveScreeningExecutionState(['NOT_CONFIGURED', 'NOT_CONFIGURED'])).toBe('NOT_CONFIGURED') },
  { name: '03 all successful is SUCCEEDED', run: () => expect(deriveScreeningExecutionState(['SUCCEEDED', 'SUCCEEDED'])).toBe('SUCCEEDED') },
  { name: '04 all errors is ERROR', run: () => expect(deriveScreeningExecutionState(['ERROR', 'ERROR'])).toBe('ERROR') },
  { name: '05 success plus error is PARTIAL', run: () => expect(deriveScreeningExecutionState(['SUCCEEDED', 'ERROR'])).toBe('PARTIAL') },
  { name: '06 partial source remains PARTIAL', run: () => expect(deriveScreeningExecutionState(['PARTIAL'])).toBe('PARTIAL') },
  { name: '07 NOT_EXECUTED cannot clear requirement', run: () => expect(requirementStateFromScreening({ executionState: 'NOT_EXECUTED', candidates: [] })).toBe('PENDIENTE') },
  { name: '08 NOT_CONFIGURED cannot clear requirement', run: () => expect(requirementStateFromScreening({ executionState: 'NOT_CONFIGURED', candidates: [] })).toBe('PENDIENTE') },
  { name: '09 ERROR cannot clear requirement', run: () => expect(requirementStateFromScreening({ executionState: 'ERROR', candidates: [] })).toBe('PENDIENTE') },
  { name: '10 QUEUED remains in process', run: () => expect(requirementStateFromScreening({ executionState: 'QUEUED', candidates: [] })).toBe('EN_PROCESO') },
  { name: '11 RUNNING remains in process', run: () => expect(requirementStateFromScreening({ executionState: 'RUNNING', candidates: [] })).toBe('EN_PROCESO') },
  { name: '12 PARTIAL remains in process', run: () => expect(requirementStateFromScreening({ executionState: 'PARTIAL', candidates: [] })).toBe('EN_PROCESO') },
  { name: '13 zero candidates on all-success clears component', run: () => expect(requirementStateFromScreening({ executionState: 'SUCCEEDED', candidates: [] })).toBe('CUMPLIDO') },
  { name: '14 unresolved candidate blocks completion', run: () => expect(requirementStateFromScreening({ executionState: 'SUCCEEDED', candidates: [{}] })).toBe('EN_PROCESO') },
  { name: '15 additional review blocks completion', run: () => expect(requirementStateFromScreening({ executionState: 'SUCCEEDED', candidates: [{ latestDecision: 'REVISION_ADICIONAL' }] })).toBe('EN_PROCESO') },
  { name: '16 no-corresponde resolves component', run: () => expect(requirementStateFromScreening({ executionState: 'SUCCEEDED', candidates: [{ latestDecision: 'NO_CORRESPONDE' }] })).toBe('CUMPLIDO') },
  { name: '17 confirmed match resolves component only', run: () => expect(requirementStateFromScreening({ executionState: 'SUCCEEDED', candidates: [{ latestDecision: 'COINCIDENCIA_CONFIRMADA' }] })).toBe('CUMPLIDO') },
  { name: '18 fully resolved mixed candidates complete', run: () => expect(requirementStateFromScreening({ executionState: 'SUCCEEDED', candidates: [{ latestDecision: 'NO_CORRESPONDE' }, { latestDecision: 'COINCIDENCIA_CONFIRMADA' }] })).toBe('CUMPLIDO') },
  { name: '19 exact identifier is only a candidate score', run: () => { const value = screeningCandidateScore(identity, { stableId: 'c1', sourceReference: 'r1', displayName: 'OTRA PERSONA', identifiers: ['SINT900101AA1'], evidence: {} }); expect(value.score).toBe(1); expect(value.fields).toContain('IDENTIFIER'); } },
  { name: '20 exact name is only a candidate score', run: () => expect(screeningCandidateScore(identity, { stableId: 'c1', sourceReference: 'r1', displayName: 'PERSONA SINTETICA UNO', evidence: {} })).toEqual({ score: .96, fields: ['NAME_EXACT'] }) },
  { name: '21 fuzzy discovery has bounded deterministic score', run: () => { const value = screeningCandidateScore(identity, { stableId: 'c1', sourceReference: 'r1', displayName: 'PERSONA SINTETICA DOS', evidence: {} }); expect(value.fields).toContain('NAME_FUZZY'); expect(value.score).toBeGreaterThan(0); expect(value.score).toBeLessThan(.96); } },
  { name: '22 accents and casing normalize in identity fingerprint', run: () => expect(screeningIdentityFingerprint({ ...identity, primary_name: 'Pérsona Sintética Uno' })).toBe(screeningIdentityFingerprint({ ...identity, primary_name: 'PERSONA SINTETICA UNO' })) },
  { name: '23 alias order does not change identity fingerprint', run: () => expect(screeningIdentityFingerprint({ ...identity, aliases: ['DOS', 'UNO'] })).toBe(screeningIdentityFingerprint({ ...identity, aliases: ['UNO', 'DOS'] })) },
  { name: '24 identifier casing does not change fingerprint', run: () => expect(screeningIdentityFingerprint({ ...identity, rfc: identity.rfc!.toLowerCase() })).toBe(screeningIdentityFingerprint(identity)) },
  { name: '25 aggregate supports multiple source executions', run: () => expect(migration).toContain('screening_source_executions_query_source_key') },
  { name: '26 migration does not seed an official source', run: () => expect(migration).not.toMatch(/INSERT\s+INTO\s+"?screening_sources"?/i) },
  { name: '27 production path contains no score-to-confirm decision', run: () => expect(service).not.toMatch(/score\s*[>=]+[^\n]*(COINCIDENCIA_CONFIRMADA|CONFIRM)/) },
  { name: '28 PEP ledger is not used by H3 service', run: () => expect(service).not.toContain('CompliancePepReview') },
  { name: '29 legal trigger does not loop shareholders', run: () => expect(legalEngine).not.toMatch(/accionistas|shareholders/i) },
  { name: '30 free search writes only query aggregate', run: () => { const segment = service.slice(service.indexOf('async freeSearch'), service.indexOf('async execute')); expect(segment).not.toMatch(/compareciente\.(create|update)|expediente\.(create|update)/); } },
  { name: '31 current is derived from MASTER history', run: () => expect(service).toContain("query_kind: 'MASTER', contract_version: 'CUM-LST-001'") },
  { name: '32 report carries the required human name', run: () => expect(report).toContain('REPORTE DE CONSULTA') },
  { name: '33 H3 introduces no signing hard block', run: () => expect(service).not.toMatch(/cannot.sign|block.*sign|impedir.*firma/i) },
  { name: '34 operation snapshot requires LST provider', run: () => expect(migration).toContain("req.provider <> 'LST'") },
  { name: '35 confirmed incidence has no invented consequence', run: () => expect(service).toContain('incidence_confirmed: incidence, consequence: null') },
  { name: '36 tenant and person lineage are database-enforced', run: () => { expect(migration).toContain('H3_REQUIREMENT_QUERY_PERSON_LINEAGE_MISMATCH'); expect(migration).toContain('FOREIGN KEY ("query_id","organization_id")'); } },
];

describe('CUM-LST-001 · matriz adversarial congelada', () => {
  it.each(cases)('$name', ({ run }) => run());
});
