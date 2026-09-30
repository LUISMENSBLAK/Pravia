import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ISR2026_RULESET } from '../src/domain/isrTaxEngine';

const databaseUrl = new URL(process.env.DATABASE_URL || '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '55510' || databaseUrl.pathname.slice(1) !== 'pravia_qa') {
  throw new Error('NEW_LOT_QA_DATABASE_SAFETY_GATE_FAILED');
}

const db = new PrismaClient();
const organizationId = '30000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000002';
const sourceTitle = 'Fixture sintética local QA — no usar como fuente fiscal productiva';
const sourceUrl = 'https://qa.local.invalid/pravia/fiscal-fixture';
const verifiedAt = new Date('2026-09-26T12:00:00Z');
const json = (input: unknown) => JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
const quoteAIProspectId = '30000000-0000-4000-8000-000000000490';
const quoteAIQuoteId = '30000000-0000-4000-8000-000000000491';
const quoteAITransitionId = '30000000-0000-4000-8000-000000000492';
const quoteAIProposalId = '30000000-0000-4000-8000-000000000493';

const reference = async (type: string, code: string, value: Record<string, unknown>) => db.fiscalReferenceRevision.upsert({
  where: { organization_id_reference_type_code_version: { organization_id: organizationId, reference_type: type, code, version: 1 } },
  update: { value: json(value), effective_from: new Date('2026-01-01T00:00:00Z'), effective_to: new Date('2026-12-31T00:00:00Z'), source_title: sourceTitle, source_url: sourceUrl, verification_status: 'VERIFICADA', verified_by_id: userId, verified_at: verifiedAt },
  create: { organization_id: organizationId, reference_type: type, code, version: 1, effective_from: new Date('2026-01-01T00:00:00Z'), effective_to: new Date('2026-12-31T00:00:00Z'), value: json(value), source_title: sourceTitle, source_url: sourceUrl, verification_status: 'VERIFICADA', created_by_id: userId, verified_by_id: userId, verified_at: verifiedAt },
});

async function main() {
  const identity = await db.organizationMembership.findFirst({ where: { organization_id: organizationId, user_id: userId, status: 'ACTIVE' } });
  if (!identity) throw new Error('NEW_LOT_QA_IDENTITY_NOT_FOUND');
  await reference('INPC', 'INPC-QA-2026-08', { factor: '1.01230000', fixture: true });
  await reference('FACTOR', 'FACTOR-QA-2016-2026', { factor: '1.25000000', fixture: true });
  await reference('UDI', 'UDI-QA-2026-09', { value: '8.50000000', factor: '1.00000000', fixture: true });
  await reference('ADQUISICION', 'ADQ-QA-NAY-2026', { rate: '2.00000000', base: 'operationValue', jurisdiction: 'QA-LOCAL', fixture: true });
  await reference('IVA', 'IVA-QA-2026', { rate: '16.00000000', base: 'confirmedTaxableBase', jurisdiction: 'QA-LOCAL', fixture: true });
  await reference('CALCULATION_CRITERIA', 'ISR-CRITERIO-QA-2026', { adjustmentMethod: 'AUTO', resolvedAdjustmentMethod: 'MANUAL_CONFIRMED', tariffSelection: 'AUTO', landLossOffsetsConstructionGain: false, fixture: true });
  await reference('CALCULATION_CRITERIA', 'ISR-CRITERIO-MANUAL-QA-2026', { adjustmentMethod: 'AUTO', resolvedAdjustmentMethod: 'MANUAL_CONFIRMED', tariffSelection: 'MANUAL_AUTHORIZED', landLossOffsetsConstructionGain: false, fixture: true });
  for (const month of ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12']) {
    await reference('RECARGO', month, { rate: '1.47000000', fixture: true });
  }
  const fiscalRule = await db.fiscalRuleSet.upsert({
    where: { clave_version: { clave: ISR2026_RULESET.key, version: ISR2026_RULESET.version } },
    update: { ejercicio: ISR2026_RULESET.taxYear, tipo_operacion: ISR2026_RULESET.operationType, jurisdiccion: ISR2026_RULESET.jurisdiction, vigencia_desde: new Date(`${ISR2026_RULESET.validFrom}T00:00:00Z`), vigencia_hasta: new Date(`${ISR2026_RULESET.validTo}T00:00:00Z`), fuente_normativa: ISR2026_RULESET.normativeSource, fuente_url: ISR2026_RULESET.sourceUrl, activo: true, parametros: { years_cap: ISR2026_RULESET.yearsCap, rounding: ISR2026_RULESET.rounding } },
    create: { id: ISR2026_RULESET.id, clave: ISR2026_RULESET.key, version: ISR2026_RULESET.version, ejercicio: ISR2026_RULESET.taxYear, tipo_operacion: ISR2026_RULESET.operationType, jurisdiccion: ISR2026_RULESET.jurisdiction, vigencia_desde: new Date(`${ISR2026_RULESET.validFrom}T00:00:00Z`), vigencia_hasta: new Date(`${ISR2026_RULESET.validTo}T00:00:00Z`), fuente_normativa: ISR2026_RULESET.normativeSource, fuente_url: ISR2026_RULESET.sourceUrl, activo: true, parametros: { years_cap: ISR2026_RULESET.yearsCap, rounding: ISR2026_RULESET.rounding } },
  });
  const rateTable = await db.fiscalRateTable.upsert({
    where: { rule_set_id_clave: { rule_set_id: fiscalRule.id, clave: 'ANEXO8-AI-2026' } },
    update: { nombre: 'Tarifa anual ISR 2026 · QA local', moneda: 'MXN', escala: 2 },
    create: { rule_set_id: fiscalRule.id, clave: 'ANEXO8-AI-2026', nombre: 'Tarifa anual ISR 2026 · QA local', moneda: 'MXN', escala: 2 },
  });
  await db.fiscalRateBracket.deleteMany({ where: { rate_table_id: rateTable.id } });
  await db.fiscalRateBracket.createMany({ data: ISR2026_RULESET.brackets.map((bracket) => ({ rate_table_id: rateTable.id, orden: bracket.order, limite_inferior: bracket.lower, limite_superior: bracket.upper, cuota_fija: bracket.fixedFee, porcentaje: bracket.percentage })) });
  const catalogs = {
    currencies: [{ code: 'MXN', label: 'Peso mexicano' }, { code: 'USD', label: 'Dólar estadounidense' }],
    payment_forms: [{ code: '01', label: 'Efectivo' }, { code: '03', label: 'Transferencia electrónica' }],
    monetary_instruments: [{ code: 'TRANSFER', label: 'Transferencia' }, { code: 'CHEQUE', label: 'Cheque nominativo' }],
    financial_institutions: [{ code: 'QA-BANK-001', label: 'Banco sintético QA' }],
    countries: [{ code: 'MEX', label: 'México' }],
    property_types: [{ code: 'HOUSE', label: 'Casa habitación' }, { code: 'LAND', label: 'Terreno' }],
    operation_types: [{ code: 'COMPRAVENTA', label: 'Compraventa' }, { code: 'ADJUDICACION', label: 'Adjudicación' }],
    instrument_types: [{ code: 'ESCRITURA_PUBLICA', label: 'Escritura pública' }, { code: 'INSTRUMENTO_NOTARIAL', label: 'Instrumento notarial' }],
    transmission_types: [{ code: 'ONEROSA', label: 'Transmisión onerosa' }, { code: 'GRATUITA', label: 'Transmisión gratuita' }],
  };
  const profiles = [
    { code: 'SAT-QA-2026', name: 'SAT local QA', target: 'SAT', fields: [{ path: 'input.taxpayer.rfc', outputPath: 'contribuyente.rfc', required: true }, { path: 'calculation.provisionalFederalISR', outputPath: 'resultado.isr_provisional', required: true }] },
    { code: 'UIF-QA-2026', name: 'UIF local QA', target: 'UIF', fields: [{ path: 'input.taxpayer.rfc', outputPath: 'solicitante.rfc', required: true }, { path: 'input.operation.operationDate', outputPath: 'operacion.fecha', required: true }, { path: 'input.operation.instrumentTypeCode', outputPath: 'operacion.tipo_instrumento', required: true, catalog: 'instrument_types' }, { path: 'input.operation.propertyTypeCode', outputPath: 'inmueble.tipo', required: true, catalog: 'property_types' }, { path: 'input.payments.0.paymentFormCode', outputPath: 'liquidaciones.primera.forma_pago', required: true, catalog: 'payment_forms' }] },
  ];
  for (const profile of profiles) {
    const metadata = { authority: 'Entorno sintético QA — no autoridad oficial', valid_from: new Date('2026-01-01T00:00:00Z'), valid_to: new Date('2026-12-31T00:00:00Z'), serialization: { format: 'JSON', encoding: 'UTF-8', deterministic: true }, validation_rules: { rejectMissingRequired: true, rejectUnknownCatalogValue: true }, source_title: 'Especificación sintética local de validación', source_url: sourceUrl, verification_status: 'VERIFICADA' };
    await db.fiscalExportProfile.upsert({
      where: { organization_id_code_version: { organization_id: organizationId, code: profile.code, version: 1 } },
      update: { name: profile.name, target: profile.target, definition: { fields: profile.fields, catalogs, provenance: { fixture: true, source: sourceUrl } }, ...metadata, active: true },
      create: { organization_id: organizationId, code: profile.code, name: profile.name, target: profile.target, version: 1, definition: { fields: profile.fields, catalogs, provenance: { fixture: true, source: sourceUrl } }, ...metadata, active: true, created_by_id: userId },
    });
  }
  const notaria = await db.notaria.findFirst({ where: { organization_id: organizationId, activa: true }, select: { id: true } });
  await db.prospecto.upsert({
    where: { id: quoteAIProspectId },
    update: { organization_id: organizationId, nombre: 'Cliente sintético COT IA', email: 'cot-ia.qa@local.invalid', telefono: '3110000490', tipo_acto: 'Compraventa', necesidad: 'Validación local de propuesta sin guardado automático', estado: 'ACEPTADO', folio: 'PRO-0490-2026', user_id: userId, notaria_id: notaria?.id || null, archived_at: null },
    create: { id: quoteAIProspectId, organization_id: organizationId, nombre: 'Cliente sintético COT IA', email: 'cot-ia.qa@local.invalid', telefono: '3110000490', tipo_acto: 'Compraventa', necesidad: 'Validación local de propuesta sin guardado automático', estado: 'ACEPTADO', folio: 'PRO-0490-2026', user_id: userId, notaria_id: notaria?.id || null },
  });
  await db.cotizacion.upsert({
    where: { id: quoteAIQuoteId },
    update: { organization_id: organizationId, prospecto_id: quoteAIProspectId, user_id: userId, notaria_id: notaria?.id || null, numero_cotizacion: 'COT-0490-2026', estado: 'BORRADOR', total_cliente: '12345.67', total_notaria: '12345.67' },
    create: { id: quoteAIQuoteId, organization_id: organizationId, prospecto_id: quoteAIProspectId, user_id: userId, notaria_id: notaria?.id || null, numero_cotizacion: 'COT-0490-2026', estado: 'BORRADOR', etapa_contractual: null, total_cliente: '12345.67', total_notaria: '12345.67' },
  });
  await db.$transaction(async (tx) => {
    const transition = await tx.cotizacionTransicion.findUnique({ where: { id: quoteAITransitionId }, select: { id: true } });
    if (!transition) {
      await tx.cotizacionTransicion.create({ data: {
        id: quoteAITransitionId, organization_id: organizationId, cotizacion_id: quoteAIQuoteId, actor_id: userId,
        etapa_anterior: null, etapa_nueva: 'BORRADOR', effective_at: verifiedAt, accion: 'CREAR', procedencia: 'QA_LOCAL',
        evidencia: { fixture: true, purpose: 'COT-IA-001 browser QA' }, version: 1,
        idempotency_key: 'NEW-LOT-QA-COT-IA-CREATE', payload_hash: createHash('sha256').update('new-lot-qa-cot-ia-create').digest('hex'),
      } });
    }
    await tx.cotizacion.update({ where: { id: quoteAIQuoteId }, data: { etapa_contractual: 'BORRADOR', transicion_actual_id: quoteAITransitionId, version_operativa: 1 } });
  });
  await db.cotizacionConcepto.deleteMany({ where: { organization_id: organizationId, cotizacion_id: quoteAIQuoteId } });
  await db.cotizacionConcepto.create({ data: { organization_id: organizationId, cotizacion_id: quoteAIQuoteId, categoria: 'HONORARIOS', concepto: 'Honorarios profesionales', importe: '12345.67', orden: 0, origen: 'IA_PROPUESTA' } });
  await db.cotizacionIAProposal.deleteMany({ where: { organization_id: organizationId, cotizacion_id: quoteAIQuoteId } });
  await db.cotizacionIAProposal.create({ data: {
    id: quoteAIProposalId, organization_id: organizationId, cotizacion_id: quoteAIQuoteId, status: 'PENDIENTE',
    proposal: json({ concepts: [{ categoria: 'HONORARIOS', concepto: 'Honorarios profesionales', importe: 14000, explanation: { layer: 'HISTORICO_VALIDADO', sample_size: 1, range: { min: 14000, median: 14000, max: 14000 }, reason: 'Fixture local trazable para comprobar que una propuesta pendiente nunca modifica silenciosamente el presupuesto persistido.' } }], totals: { total: 14000 } }),
    evidence_packet: json({ layers: { tariff: [{ source_id: 'qa-local', code: 'NAY-002', title: 'Arancel / fuente oficial verificada en biblioteca local', official_url: 'https://qa.local.invalid/pravia/knowledge/NAY-002', version: 1 }], internal_policy: [{ criterion_id: 'qa-local', code: 'INT-QA-COMPRAVENTA', title: 'Criterio sintético de revisión local', label: 'CRITERIO INTERNO — NO ES NORMA.', scope: 'Compraventa' }], validated_comparables: { organization_id: organizationId, act: 'Compraventa', sample_quotes: 1 } }, exclusions: ['BORRADOR', 'RECHAZADA', 'CANCELADA'], taxes_notice: 'Impuestos, derechos e ISR requieren motor determinístico o fuente tarifaria verificada.' }),
    model_version: 'PRAVIA-COT-IA-001/local-qa-fixture-v1', idempotency_key: 'NEW-LOT-QA-COT-IA-PENDING', created_by_id: userId,
  } });
  console.log(JSON.stringify({ organizationId, references: 17, profiles: profiles.length, fiscalRuleSet: fiscalRule.id, quoteAIQuoteId, fixture: true }));
}

main().finally(() => db.$disconnect());
