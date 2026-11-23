import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import annex8 from '../data/fiscal/isr-annex8-ai-2026-20251228.json';
import annex9 from '../data/fiscal/isr-annex9-2026-20260717.json';
import { ISR2026_RULESET } from '../src/domain/isrTaxEngine';

const url = new URL(process.env.ISR_CLIENT_QA_DATABASE_URL || '');
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55521'); assert.equal(url.pathname, '/pravia_client_qa'); assert.equal(url.searchParams.get('schema'), 'pravia_os');
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
const api = 'http://127.0.0.1:3011/api', org = '21110000-0000-4000-8000-000000000001';
async function main() {
  const health: any = await (await fetch('http://127.0.0.1:3011/health')).json(); assert.equal(health.database_mode, 'local'); assert.equal(health.storage_mode, 'local');
  const response = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'documentos.qa@pravia.test', password: process.env.QA_LOCAL_PASSWORD }) });
  assert.equal(response.status, 200); const token = (await response.json() as any).access_token;
  const request = async (route: string, method = 'GET', body?: unknown) => {
    const r = await fetch(`${api}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload: any = await r.json(); assert.ok(r.ok, `${route}:${r.status}:${payload.code || payload.error}`); return payload.data;
  };
  if (process.env.QA_LEGACY_SETUP === 'true') {
    let calc = await db.calculoISR.findFirst({ where: { organization_id: org, idempotency_key: 'qa-isr-legacy-unknown-moral-20261121' } });
    if (!calc) {
      const created = await request('/isr', 'POST', { ejercicio: 2026, tipo_operacion: 'ENAJENACION_INMUEBLE', idempotency_key: 'qa-isr-legacy-unknown-moral-20261121' });
      const detail: any = await request(`/isr/${created.id}`);
      await request(`/isr/${created.id}`, 'PATCH', { expected_updated_at: detail.updated_at, input_data: {
        ...detail.input_data,
        taxpayer: { fullName: 'SOCIEDAD SINTÉTICA QA SIN CLASIFICACIÓN', rfc: '', personType: 'MORAL', fiscalResidence: 'NO_CONFIRMADA', confirmed: false },
      } });
      calc = await db.calculoISR.findUniqueOrThrow({ where: { id: created.id } });
    }
    assert.equal((calc.input_data as any).taxpayer.personType, 'MORAL');
    assert.equal((calc.input_data as any).schemaVersion, undefined);
    console.log(JSON.stringify({ local_legacy_fixture: 'PASS', id: calc.id, ui: `http://127.0.0.1:5176/calculo-isr/${calc.id}`, synthetic_only: true })); return;
  }
  if (process.env.QA_LEGACY_VERIFY === 'true') {
    const calc = await db.calculoISR.findFirstOrThrow({ where: { organization_id: org, idempotency_key: 'qa-isr-legacy-unknown-moral-20261121' } });
    const input: any = calc.input_data; assert.equal(input.schemaVersion, 3); assert.equal(input.parties.length, 1);
    const party = input.parties[0]; assert.equal(party.subjectType, 'OTRO'); assert.equal(party.percentage, ''); assert.equal(party.nationalityCode, ''); assert.equal(party.fiscalResidence, 'POR_DETERMINAR');
    assert.equal(party.acquisitionLayers[0].acquisitionAct, 'OTRO'); assert.equal(party.acquisitionLayers[0].percentage, ''); assert.equal(party.acquisitionLayers[0].verified, false);
    const audit: any = await db.auditLog.findFirstOrThrow({ where: { organization_id: org, entidad_id: calc.id, accion: 'EDITAR_CALCULO_ISR', valores_anteriores: { path: ['input_data', 'taxpayer', 'personType'], equals: 'MORAL' } }, orderBy: { created_at: 'desc' } });
    assert.equal(audit.valores_anteriores.input_data.schemaVersion, undefined); assert.equal(calc.ultima_version, 0);
    console.log(JSON.stringify({ legacy_snapshot_preserved_in_audit: 'PASS', no_invented_tax_class_or_ownership: 'PASS', no_tax_generated: 'PASS', id: calc.id })); return;
  }
  if (process.env.QA_SURCHARGES_SETUP === 'true') {
    const put = (type: string, code: string, value: any) => db.fiscalReferenceRevision.upsert({ where: { organization_id_reference_type_code_version: { organization_id: org, reference_type: type, code, version: 1 } }, update: {}, create: { organization_id: org, reference_type: type, code, version: 1, value: { ...value, synthetic_fixture: true, not_production_configuration: true }, effective_from: new Date('2026-01-01'), effective_to: new Date('2026-12-31'), source_title: 'POLÍTICA / ÍNDICES SINTÉTICOS QA — SIN VALIDEZ FISCAL', source_url: 'https://qa.example.test/synthetic-accessories', verification_status: 'VERIFICADA', created_by_id: '21110000-0000-4000-8000-000000000002', verified_by_id: '21110000-0000-4000-8000-000000000002', verified_at: new Date() } });
    await put('ISR_SURCHARGE_POLICY', 'CFF17A_21_POLICY', { period_mode: 'ANNIVERSARY', rate_month: 'PERIOD_START', max_months: 60, factor_decimals: 4, factor_rounding: 'DOWN' });
    await put('INPC', 'ISR_INPC_SERIES', { base: 'SYNTHETIC_QA', months: { '2026-10': '100', '2026-11': '110' } });
    await put('RECARGO', '2026-11', { rate: '1.5' }); await put('RECARGO', '2026-12', { rate: '2' });
    console.log(JSON.stringify({ synthetic_accessories_references: 'PASS', production_writes: 'NONE' })); return;
  }
  if (process.env.QA_SURCHARGES_VERIFY === 'true') {
    const calc: any = await db.calculoISR.findFirstOrThrow({ where: { organization_id: org, idempotency_key: 'qa-isr-cost-worksheet-20261121' }, include: { versiones: { orderBy: { version: 'desc' } } } });
    const before = JSON.stringify(calc), count = await db.calculoISRVersion.count({ where: { calculo_id: calc.id } });
    const r: any = await request('/isr/utilities/surcharges', 'POST', { calculation_id: calc.id, expected_version: calc.ultima_version, party_id: 'qa-worksheet-seller', principal: '1.00', origin_date: '1900-01-01', due_date: '2026-11-12', payment_date: '2026-12-15' });
    assert.equal(r.principal, '126288.13'); assert.equal(r.updateAmount, '12628.81'); assert.equal(r.surcharges, '4862.09'); assert.equal(r.total, '143779.03'); assert.equal(r.delayMonths, 2);
    assert.equal(r.source.versionId, calc.versiones[0].id); assert.equal(r.originalCalculationModified, false);
    assert.equal(await db.calculoISRVersion.count({ where: { calculo_id: calc.id } }), count);
    const after = await db.calculoISR.findUniqueOrThrow({ where: { id: calc.id }, include: { versiones: { orderBy: { version: 'desc' } } } }); assert.equal(JSON.stringify(after), before);
    assert.ok(await db.auditLog.count({ where: { organization_id: org, entidad_id: calc.id, accion: 'CALCULAR_RECARGOS_ISR' } }));
    for (const email of ['otrotenant.qa@pravia.test', 'lectura.qa@pravia.test']) {
      const login = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: process.env.QA_LOCAL_PASSWORD }) });
      const denied = await fetch(`${api}/isr/utilities/surcharges`, { method: 'POST', headers: { Authorization: `Bearer ${(await login.json() as any).access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ calculation_id: calc.id, expected_version: calc.ultima_version, party_id: 'qa-worksheet-seller', due_date: '2026-11-12', payment_date: '2026-12-15' }) }); assert.ok([403, 404].includes(denied.status));
    }
    console.log(JSON.stringify({ original_snapshot_unchanged: 'PASS', canonical_principal_not_client_input: 'PASS', update_surcharges_arithmetic: 'PASS', audit: 'PASS', tenant_permissions: 'PASS', id: calc.id })); return;
  }
  if (process.env.QA_PDF_SETUP === 'true') {
    const name = 'SINTÉTICO QA · MEMORIA ISR · SIN VALIDEZ FISCAL';
    let artifact = await db.catalogoArtefacto.findFirst({ where: { organization_id: org, nombre: name }, include: { versiones: true } });
    if (!artifact) {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const pdf = await PDFDocument.create(); const form = pdf.getForm();
      const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const fields = [
        ['isr.folio', 'Folio'], ['isr.version', 'Versión del cálculo'], ['isr.valor_enajenacion', 'Valor de enajenación'],
        ['isr.costo_comprobado', 'Costo actualizado'], ['isr.costo_minimo', 'Costo mínimo fiscal'], ['isr.costo_aplicado', 'Costo aplicado'],
        ['isr.ganancia_fiscal', 'Ganancia fiscal'], ['isr.isr_enajenacion', 'ISR enajenación'], ['isr.pago_entidad_federativa', 'Pago a entidad federativa'],
        ['isr.remanente_federal', 'Remanente federal'], ['isr.isr_adquisicion', 'ISR adquisición'], ['isr.reglas_version', 'Versión de reglas'],
      ];
      for (let start = 0; start < fields.length; start += 6) {
        const page = pdf.addPage([612, 792]);
        page.drawText('PRAVIA | MEMORIA DE CALCULO ISR', { x: 44, y: 740, size: 17, font: bold, color: rgb(0.04, 0.12, 0.21) });
        page.drawText('SINTETICO QA / SIN VALIDEZ FISCAL', { x: 44, y: 714, size: 11, font: bold });
        fields.slice(start, start + 6).forEach(([key, label], index) => {
          const y = 650 - index * 89;
          page.drawText(label, { x: 44, y, size: 11, font }); const field = form.createTextField(key);
          field.addToPage(page, { x: 44, y: y - 40, width: 524, height: 30, font, borderWidth: 0.5 }); field.setFontSize(12);
        });
        page.drawText(`Fixture local reemplazable CFG-002 | página ${start / 6 + 1}`, { x: 44, y: 42, size: 9, font });
      }
      const formData = new FormData(); const bytes = await pdf.save();
      formData.set('file', new Blob([bytes], { type: 'application/pdf' }), 'SINTETICO-QA-Memoria-ISR.pdf');
      formData.set('metadata', JSON.stringify({ tipo: 'FORMATO', propietario_tipo: 'ORGANIZACION', organization_id: org, nombre: name,
        destinos_funcionales: [{ destino: 'CALCULO_ISR_MEMORIA', activo: true, predeterminado: true }] }));
      const result = await fetch(`${api}/settings/catalogs/artifacts`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
      const body: any = await result.json(); assert.equal(result.status, 201, body.code || body.error);
      artifact = await db.catalogoArtefacto.findFirstOrThrow({ where: { organization_id: org, nombre: name }, include: { versiones: true } });
    }
    assert.ok(await db.catalogoArtefactoDestino.findFirst({ where: { organization_id: org, artefacto_id: artifact.id, destino: 'CALCULO_ISR_MEMORIA', activo: true, predeterminado: true } }));
    console.log(JSON.stringify({ local_pdf_template: 'PASS', artifact_id: artifact.id, actual_pdf_fields: 12, production_writes: 'NONE' })); return;
  }
  if (process.env.QA_PDF_VERIFY === 'true') {
    const calc = await db.calculoISR.findFirstOrThrow({ where: { organization_id: org, idempotency_key: 'qa-isr-cost-worksheet-20261121' }, include: { documentos: { where: { estatus: 'ACTIVO', generated_from_version: 2 }, include: { documento: true } } } });
    assert.equal(calc.documentos.length, 1); const link = calc.documentos[0], doc = link.documento;
    const stored = await readFile(`/tmp/pravia-client-qa-20261121.amVOGW/storage/${doc.storage_key}`);
    const downloaded = await readFile('/tmp/pravia-client-qa-20261121.amVOGW/projection/Machote-sintetico-proyeccion.pdf');
    assert.ok(stored.equals(downloaded), 'UI download must equal the private stored PDF byte for byte.');
    const { createHash } = await import('node:crypto'); assert.equal(createHash('sha256').update(stored).digest('hex'), doc.checksum_sha256);
    const { PDFDocument } = await import('pdf-lib'); const pdf = await PDFDocument.load(stored); assert.equal(pdf.getPageCount(), 2);
    const form = pdf.getForm(); for (const [key, value] of Object.entries({ 'isr.isr_enajenacion': '126288.13', 'isr.ganancia_fiscal': '671517.00', 'isr.costo_comprobado': '2116.04', 'isr.costo_aplicado': '74613.00', 'isr.pago_entidad_federativa': '33575.85', 'isr.remanente_federal': '92712.28', 'isr.version': '2' })) assert.equal(form.getTextField(key).getText(), value);
    assert.ok(await db.auditLog.count({ where: { organization_id: org, entidad_id: calc.id, accion: 'GENERAR_PDF_ISR' } }));
    console.log(JSON.stringify({ real_pdf_private_storage: 'PASS', chrome_download_identical: 'PASS', pdf_fields_match_calculation: 'PASS', audit: 'PASS', document_id: doc.id, production_writes: 'NONE' })); return;
  }
  if (process.env.QA_CALCULATION_SETUP === 'true') {
    // No production fiscal configuration is changed by this local-only harness.
    assert.deepEqual(annex8.brackets.map((item) => ({ ...item, fixedFee: Number(item.fixedFee).toFixed(2) })), ISR2026_RULESET.brackets);
    const userId = '21110000-0000-4000-8000-000000000002';
    const rule = await db.fiscalRuleSet.upsert({ where: { clave_version: { clave: ISR2026_RULESET.key, version: ISR2026_RULESET.version } }, update: {}, create: { id: ISR2026_RULESET.id, clave: ISR2026_RULESET.key, version: ISR2026_RULESET.version, ejercicio: 2026, tipo_operacion: 'ENAJENACION_INMUEBLE', jurisdiccion: 'MX-FED', vigencia_desde: new Date('2026-01-01'), vigencia_hasta: new Date('2026-12-31'), fuente_normativa: annex8.sourceTitle, fuente_url: annex8.sourceUrl, parametros: { years_cap: 20, source_sha256: annex8.sourceSha256 } } });
    const table = await db.fiscalRateTable.upsert({ where: { rule_set_id_clave: { rule_set_id: rule.id, clave: 'ANEXO8-AI-2026' } }, update: {}, create: { rule_set_id: rule.id, clave: 'ANEXO8-AI-2026', nombre: annex8.sourceTitle, moneda: 'MXN', escala: 2 } });
    if (!await db.fiscalRateBracket.count({ where: { rate_table_id: table.id } })) await db.fiscalRateBracket.createMany({ data: annex8.brackets.map((item) => ({ rate_table_id: table.id, orden: item.order, limite_inferior: item.lower, limite_superior: item.upper, cuota_fija: item.fixedFee, porcentaje: item.percentage })) });
    const put = (code: string, value: any, title: string, source: string, version = 1, from = '2026-01-01') => db.fiscalReferenceRevision.upsert({ where: { organization_id_reference_type_code_version: { organization_id: org, reference_type: 'ISR_QA_VALIDATION', code, version } }, update: {}, create: { organization_id: org, reference_type: 'ISR_QA_VALIDATION', code, version, value, effective_from: new Date(from), effective_to: new Date('2026-12-31'), source_title: title, source_url: source, verification_status: 'VERIFICADA', created_by_id: userId, verified_by_id: userId, verified_at: new Date() } });
    await put(annex9.code, annex9, annex9.sourceTitle, annex9.sourceUrl, annex9.version, annex9.effectiveFrom);
    await put('ISR_ACQUISITION_UPDATE_POLICY', { fixture: true }, 'SINTÉTICO QA: caso sólo terreno mediante Anexo 9; sin INPC ni política de construcción', 'https://qa.example.test/synthetic-isr-policy');
    for (const [code, value, sourceTitle] of [
      ['LISR121_MIN_ACQUISITION_PERCENT', '10', 'LISR 121 I'], ['LISR127_STATE_RATE', '5', 'LISR 127'],
      ['RLISR217_THRESHOLD_PERCENT', '10', 'RLISR 217'], ['RLISR217_ACQUISITION_RATE', '20', 'LISR 132 / RLISR 217'],
    ]) await put(code, { value, fixture: true, not_production_configuration: true }, `${sourceTitle} · parámetro QA aislado`, 'https://qa.example.test/synthetic-isr-parameters');
    let calc = await db.calculoISR.findFirst({ where: { organization_id: org, idempotency_key: 'qa-isr-cost-worksheet-20261121' } });
    if (!calc) {
      const created = await request('/isr', 'POST', { ejercicio: 2026, tipo_operacion: 'ENAJENACION_INMUEBLE', idempotency_key: 'qa-isr-cost-worksheet-20261121' });
      await request(`/isr/${created.id}`, 'PATCH', { expected_updated_at: created.updated_at, input_data: { schemaVersion: 3, taxYear: 2026, operationDate: '2026-11-11', act: { id: '63139f24-a2d5-4422-948f-5a999b83c86f', name: 'COMPRAVENTA SINTÉTICA QA ACT4', fiscalClassification: 'COMPRAVENTA' }, property: { type: 'TERRENO', sameAcquisitionDate: true }, values: { operation: '746130', appraisal: '746130', cadastral: '', landSale: '746130', constructionSale: '0' }, calculateIVA: false, deductions: [], parties: [
        { id: 'qa-worksheet-seller', name: 'ENAJENANTE SINTÉTICO QA', role: 'ENAJENANTE', subjectType: 'PF', nationalityCode: 'MX', fiscalResidence: 'MEXICO', percentage: '100', acquisitionLayers: [{ id: 'qa-acquisition', percentage: '100', acquisitionAct: 'ONEROSA', legalDate: '2025-05-26', fiscalDate: '2025-05-26', source: 'Ejemplo sintético contractual; sin validez fiscal', verified: true, adjustedLandCost: '', adjustedConstructionCost: '', historical: { method: 'FACTORES', separation: 'EXPLICIT', land: '2034.65', construction: '0' } }] },
        { id: 'qa-worksheet-buyer', name: 'ADQUIRENTE SINTÉTICO QA', role: 'ADQUIRENTE', subjectType: 'PF', nationalityCode: 'MX', fiscalResidence: 'MEXICO', percentage: '100' },
      ] } });
      calc = await db.calculoISR.findUniqueOrThrow({ where: { id: created.id } });
    }
    console.log(JSON.stringify({ setup: 'PASS', calculation_id: calc.id, ui: `http://127.0.0.1:5176/calculo-isr/${calc.id}`, configured_only_locally: true, official_annex8_rows: annex8.brackets.length, official_annex9_rows: annex9.rows.length, synthetic_parameters_not_production: true })); return;
  }
  if (process.env.QA_CALCULATION_VERIFY === 'true') {
    const calc = await db.calculoISR.findFirstOrThrow({ where: { organization_id: org, idempotency_key: 'qa-isr-cost-worksheet-20261121' }, include: { versiones: { orderBy: { version: 'desc' } } } });
    assert.ok(calc.versiones.length); const latest: any = calc.versiones[0]; const result = latest.result;
    assert.equal(result.saleISR[0].amount, '126288.13'); assert.equal(result.saleISR[0].taxableBase, '671517.00');
    assert.equal(result.saleISR[0].distribution.statePayment, '33575.85'); assert.equal(result.saleISR[0].distribution.federalRemainder, '92712.28');
    assert.equal(result.saleISR[0].acquisitionWorksheet.updatedCost, '2116.04'); assert.equal(result.saleISR[0].acquisitionWorksheet.appliedCost, '74613.00');
    assert.equal(result.calculationRevision, '2026-11-21.2'); assert.equal(result.missing.length, 0);
    assert.ok(await db.auditLog.count({ where: { organization_id: org, entidad_id: calc.id, accion: 'GENERAR_CALCULO_ISR' } }));
    console.log(JSON.stringify({ postgres_api_calculation: 'PASS', immutable_version: latest.version, state_federal_reconciled: 'PASS', official_annex_factor: 'PASS', deterministic_minimum_cost: 'PASS', id: calc.id })); return;
  }
  if (process.env.QA_INTERPRETATION_VERIFY === 'true') {
    const audit = await db.auditLog.findFirstOrThrow({ where: { organization_id: org, accion: 'INTERPRETAR_OPERACION_ISR_IA' }, orderBy: { created_at: 'desc' } });
    const meta = audit.detalles as any; const calc: any = await request(`/isr/${audit.entidad_id}`);
    assert.deepEqual(calc.input_data.values, { operation: '746130.00', appraisal: '746130.00', cadastral: '', landSale: '746130.00', constructionSale: '0.00' });
    assert.equal(calc.input_data.operationDate, '2026-11-11'); assert.equal(calc.input_data.property.type, 'TERRENO');
    assert.equal(calc.input_data.parties.length, 2);
    assert.ok(calc.input_data.parties.some((party: any) => party.name === 'MARIANA SINTÉTICA QA' && party.role === 'ENAJENANTE' && party.percentage === '100' && party.acquisitionLayers[0].historical.land === '2034.65' && party.acquisitionLayers[0].verified === false));
    assert.ok(calc.input_data.parties.some((party: any) => party.name === 'ELENA SINTÉTICA QA' && party.role === 'ADQUIRENTE' && party.percentage === '100'));
    assert.ok(calc.input_data.parties.every((party: any) => party.subjectType === 'OTRO' && party.fiscalResidence === 'POR_DETERMINAR'));
    assert.equal(calc.versiones.length, 0);
    assert.equal(calc.propuestas.filter((proposal: any) => proposal.source_document_id === meta.source_document_id && proposal.status === 'ACEPTADA').length, 8);
    const doc = await db.documento.findUniqueOrThrow({ where: { id: meta.source_document_id } });
    const bytes = await readFile(`/tmp/pravia-client-qa-20261121.amVOGW/storage/${doc.storage_key}`);
    const { createHash } = await import('node:crypto'); assert.equal(createHash('sha256').update(bytes).digest('hex'), doc.checksum_sha256);
    const usage = await db.aiUsageEvent.findFirstOrThrow({ where: { organization_id: org, operation_code: 'ISR_OPERATION_INTERPRETATION', idempotency_key: meta.operation_id } });
    assert.equal(usage.status, 'COMPLETED'); assert.ok(usage.input_tokens > 0 && usage.output_tokens > 0);
    console.log(JSON.stringify({ actual_model_interpretation: 'PASS', eight_human_confirmations: 'PASS', api_postgres_storage: 'PASS', source_checksum: 'PASS', fiscal_assumptions_not_invented: 'PASS', no_tax_calculated_by_ai: 'PASS', id: calc.id })); return;
  }
  let current = await db.calculoISR.findFirst({ where: { organization_id: org, idempotency_key: 'qa-isr-confirmation-20261121' } });
  if (process.env.QA_VERIFY_ONLY !== 'true') {
    if (!current) {
      const created = await request('/isr', 'POST', { ejercicio: 2026, tipo_operacion: 'ENAJENACION_INMUEBLE', idempotency_key: 'qa-isr-confirmation-20261121' });
      await request(`/isr/${created.id}`, 'PATCH', { expected_updated_at: created.updated_at, input_data: {
        schemaVersion: 3, taxYear: 2026, operationDate: '', act: { name: '', fiscalClassification: 'OTRO', otherDescription: 'SINTÉTICO QA, sin validez fiscal' }, property: { type: 'TERRENO', sameAcquisitionDate: true }, values: { operation: '', appraisal: '', cadastral: '', landSale: '', constructionSale: '0' }, calculateIVA: false, deductions: [],
        parties: [{ id: 'qa-isr-seller', role: 'ENAJENANTE', name: 'PERSONA POR CONFIRMAR QA', subjectType: 'PF', nationalityCode: 'MX', fiscalResidence: 'POR_DETERMINAR', percentage: '100' }],
      } }); current = await db.calculoISR.findUniqueOrThrow({ where: { id: created.id } });
    }
    if (!await db.calculoISRDocumento.count({ where: { calculo_id: current.id, estatus: 'ACTIVO' } })) {
      const form = new FormData(); form.set('file', new Blob([await readFile('/tmp/pravia-client-qa-20261121.amVOGW/fixtures/persona-foto-sintetica.png')], { type: 'image/png' }), 'SINTETICO-QA-persona-foto.png');
      const r = await fetch(`${api}/isr/${current.id}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }); assert.equal(r.status, 201);
    }
    console.log(JSON.stringify({ setup: 'PASS', id: current.id, ui: `http://127.0.0.1:5176/calculo-isr/${current.id}`, provider_executed_by_setup: false })); return;
  }
  assert.ok(current);
  const persisted: any = await request(`/isr/${current.id}`);
  assert.equal(persisted.input_data.schemaVersion, 3); assert.equal(persisted.input_data.parties[0].name, 'MARIANA SINTÉTICA QA');
  const accepted = await db.calculoISRPropuesta.findMany({ where: { calculo_id: current.id, status: 'ACEPTADA' } }); assert.ok(accepted.length > 0);
  const audit = await db.auditLog.findMany({ where: { organization_id: org, entidad_id: current.id, accion: 'ACEPTAR_PROPUESTA_ISR_IA' } }); assert.ok(audit.length > 0);
  assert.ok(audit.some((item) => (item.detalles as any).applied_path === 'parties[qa-isr-seller].name'));
  assert.equal(await db.calculoISRVersion.count({ where: { calculo_id: current.id } }), 0);
  console.log(JSON.stringify({ persistence_api_db: 'PASS', human_confirmation: 'PASS', source_audit: 'PASS', no_tax_result_fabricated: 'PASS', id: current.id }));
}
main().finally(() => db.$disconnect()).catch((error) => { console.error(error.message); process.exitCode = 1; });
