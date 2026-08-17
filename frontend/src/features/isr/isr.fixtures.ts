import type { ISRInput, ISRListResponse, ISRRecord } from './isr.types';

export const emptyISRInput = (taxYear = 2026): ISRInput => ({
  operationType: 'ENAJENACION_INMUEBLE', taxYear,
  taxpayer: { fullName: '', rfc: '', curp: '', personType: 'FISICA', fiscalResidence: 'NO_CONFIRMADA', confirmed: false },
  property: { description: '', landAndConstructionSameAcquisitionDate: true }, acquisitionDate: '', saleDate: '', yearsElapsed: 1, salePrice: '', deductions: [],
  exemptionTreatment: 'PENDIENTE_REVISION', ordinaryCaseConfirmed: false, specialCases: [],
});

const readyInput: ISRInput = {
  operationType: 'ENAJENACION_INMUEBLE', taxYear: 2026,
  taxpayer: { fullName: 'María Fernanda López Ramírez', rfc: 'LORM8504127G2', curp: 'LORM850412MNTPMR08', personType: 'FISICA', fiscalResidence: 'MEXICO', confirmed: true },
  property: { description: 'Casa habitación · Paseo de los Cocoteros 125, Bahía de Banderas, Nayarit', landAndConstructionSameAcquisitionDate: true },
  acquisitionDate: '2016-03-01', saleDate: '2026-08-17', yearsElapsed: 10, salePrice: '2000000.00',
  deductions: [
    { id: 'd1', concept: 'Costo de adquisición actualizado', historicalAmount: '900000.00', updatedAmount: '1100000.00', expenseDate: '2016-03-01', updateOrigin: 'MANUAL_CONFIRMED', updateMethod: 'Importe actualizado proporcionado por el usuario', treatment: 'COSTO_ADQUISICION_ACTUALIZADO', included: true, confirmed: true, supportDocumentId: 'doc-1', reason: 'LISR 121, fracción I y artículo 124', confirmedBy: 'Andrea Ruiz', confirmedAt: '2026-08-17T15:30:00.000Z' },
    { id: 'd2', concept: 'Gastos notariales actualizados', historicalAmount: '80000.00', updatedAmount: '100000.00', expenseDate: '2016-03-01', updateOrigin: 'MANUAL_CONFIRMED', updateMethod: 'Importe actualizado proporcionado por el usuario', treatment: 'GASTOS_NOTARIALES_IMPUESTOS_DERECHOS_AVALUO_ACTUALIZADOS', included: true, confirmed: true, supportDocumentId: 'doc-2', reason: 'LISR 121, fracción III', confirmedBy: 'Andrea Ruiz', confirmedAt: '2026-08-17T15:32:00.000Z' },
  ], exemptionTreatment: 'NO_APLICA_CONFIRMADO', ordinaryCaseConfirmed: true, specialCases: [],
};

const result = {
  currency: 'MXN' as const, scope: 'FEDERAL_ARTICLE_126_ONLY' as const, fiscalOperationFullyDetermined: false as const, unsupportedObligations: ['LISR_ARTICLE_127_STATE_PAYMENT' as const],
  taxableIncome: '2000000.00', exemptIncome: '0.00', consideredDeductions: '1200000.00', gain: '800000.00', yearsConsidered: 10, tariffBase: '80000.00', provisionalFederalISR: '46659.42',
  bracket: { order: 2, lower: '10135.12', upper: '86022.11', fixedFee: '194.59', percentage: '6.40' },
  calculationPrecision: { tariffTaxRaw: '4665.94232', provisionalFederalISRRaw: '46659.42320' },
  ruleSet: { id: 'rules-2026', key: 'ISR_ENAJENACION_INMUEBLE_PAGO_PROVISIONAL_MX_FED', version: '2026.1-DOF-2025-12-28', sourceUrl: 'https://www.dof.gob.mx/nota_detalle.php?codigo=5777219&fecha=28/12/2025' },
  breakdown: [
    { key: 'income', label: 'Ingreso considerado', operation: 'Precio de enajenación confirmado', amount: '2000000.00', source: 'LISR 119' },
    { key: 'deductions', label: 'Deducciones consideradas', operation: 'Costo actualizado + gastos confirmados', amount: '1200000.00', source: 'LISR 121' },
    { key: 'gain', label: 'Ganancia determinada', operation: '$2,000,000.00 − $1,200,000.00', amount: '800000.00', source: 'LISR 121' },
    { key: 'tariff-base', label: 'Base para tarifa', operation: '$800,000.00 ÷ 10 años', amount: '80000.00', source: 'LISR 126' },
    { key: 'bracket-tax', label: 'Impuesto sobre base', operation: 'Cuota fija + excedente × 6.40%', amount: '4665.94', source: 'Anexo 8 RMF 2026 A.I' },
    { key: 'provisional-isr', label: 'ISR provisional federal', operation: '$4,665.94232 × 10 años', amount: '46659.42', source: 'LISR 126' },
  ],
};

const documents = [
  { id: 'link-1', documento_id: 'doc-1', documento: { id: 'doc-1', nombre_original: 'Escritura_adquisicion.pdf', mime_type: 'application/pdf', size_bytes: 2480000, fecha_carga: '2026-08-17T15:20:00Z' } },
  { id: 'link-2', documento_id: 'doc-2', documento: { id: 'doc-2', nombre_original: 'Avaluo_2026.pdf', mime_type: 'application/pdf', size_bytes: 1860000, fecha_carga: '2026-08-17T15:24:00Z' } },
];

const proposals = [
  { id: 'p1', field_path: 'taxpayer.fullName', proposed_value: 'María Fernanda López Ramírez', status: 'ACEPTADA' as const, source_document_id: 'doc-1', source_document_name: 'Escritura_adquisicion.pdf', source_page: 2, confidence: '0.9500', model_version: 'document-model', source_fragment: 'Comparece la señora María Fernanda López Ramírez…' },
  { id: 'p2', field_path: 'salePrice', proposed_value: '2000000.00', status: 'CONFLICTO' as const, source_document_id: 'doc-1', source_document_name: 'Escritura_adquisicion.pdf', source_page: 8, confidence: '0.6500', model_version: 'document-model', conflict_group: 'salePrice' },
  { id: 'p3', field_path: 'salePrice', proposed_value: '2100000.00', status: 'CONFLICTO' as const, source_document_id: 'doc-2', source_document_name: 'Avaluo_2026.pdf', source_page: 4, confidence: '0.9500', model_version: 'document-model', conflict_group: 'salePrice' },
];

export const fixtureRecord = (mode = 'ready'): ISRRecord => {
  const calculated = ['result', 'breakdown', 'existing', 'history', 'federal-result', 'deduction-origin', 'print-summary'].includes(mode);
  return {
    id: 'fixture-isr-2026', folio: 'ISR-2026-00418', tipo_operacion: 'ENAJENACION_INMUEBLE', estado: calculated ? 'CALCULADO' : mode === 'ready' ? 'LISTO_PARA_CALCULAR' : 'BORRADOR', ejercicio: 2026,
    expediente_id: mode === 'link' ? undefined : 'exp-1', contribuyente_nombre: readyInput.taxpayer.fullName, contribuyente_rfc: readyInput.taxpayer.rfc, inmueble_descripcion: readyInput.property.description,
    input_data: mode === 'new' ? emptyISRInput() : readyInput, ultima_version: calculated ? (mode === 'history' ? 2 : 1) : 0, datos_modificados: mode === 'existing', created_at: '2026-08-17T15:00:00Z', updated_at: '2026-08-17T16:10:00Z',
    expediente: mode === 'link' ? undefined : { id: 'exp-1', numero_pravia: 'EXP-2026-00318', cliente_alias: readyInput.taxpayer.fullName },
    documentos: ['documents', 'extraction-before', 'extraction-after', 'provenance', 'conflict', 'ready', 'result', 'breakdown', 'existing', 'history', 'link', 'federal-result', 'deduction-origin', 'print-summary'].includes(mode) ? documents : [],
    propuestas: ['extraction-after', 'provenance', 'conflict', 'ready', 'result', 'breakdown', 'existing', 'history', 'federal-result', 'deduction-origin', 'print-summary'].includes(mode) ? proposals : [],
    versiones: calculated ? [{ id: 'v1', version: 1, result, breakdown: result.breakdown, calculated_at: '2026-08-17T15:45:00Z', ruleset_snapshot: { version: result.ruleSet.version }, input_snapshot: readyInput }, ...(mode === 'history' ? [{ id: 'v2', version: 2, result: { ...result, provisionalFederalISR: '48120.20', calculationPrecision: { ...result.calculationPrecision, provisionalFederalISRRaw: '48120.20000' } }, breakdown: result.breakdown, calculated_at: '2026-08-17T16:10:00Z', ruleset_snapshot: { version: result.ruleSet.version }, input_snapshot: readyInput }] : [])] : [],
  };
};

export const fixtureDirectory: ISRListResponse = {
  kpis: { total: 18, calculated: 11, pending: 5 }, meta: { page: 1, pageSize: 20, total: 18 },
  data: [
    { ...fixtureRecord('result'), id: 'f1', folio: 'ISR-2026-00418', versiones: [{ result }] },
    { ...fixtureRecord('ready'), id: 'f2', folio: 'ISR-2026-00417', contribuyente_nombre: 'Roberto Salinas Vélez', contribuyente_rfc: 'SAVR740922QK4', estado: 'LISTO_PARA_CALCULAR', expediente: { id: 'e2', numero_pravia: 'EXP-2026-00314' }, versiones: [] },
    { ...fixtureRecord('new'), id: 'f3', folio: 'ISR-2026-00416', contribuyente_nombre: 'Inmobiliaria del Pacífico, S.A. de C.V.', contribuyente_rfc: 'IPA190308GK2', tipo_operacion: 'ADQUISICION_INMUEBLE', estado: 'REQUIERE_REVISION', expediente: undefined, versiones: [] },
    { ...fixtureRecord('ready'), id: 'f4', folio: 'ISR-2026-00415', contribuyente_nombre: 'Ana Paula Medina', contribuyente_rfc: 'MERA900115LU8', estado: 'BORRADOR', inmueble_descripcion: 'Terreno · Bucerías, Nayarit', versiones: [] },
  ],
};
