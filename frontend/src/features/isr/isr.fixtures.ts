import type { ISRInput, ISRListResponse, ISRRecord, ISRV3Input, ISRV3Result } from './isr.types';

export const emptyISRInput = (taxYear = 2026): ISRInput => ({
  operationType: 'ENAJENACION_INMUEBLE', taxYear,
  taxpayer: { fullName: '', rfc: '', curp: '', personType: 'FISICA', fiscalResidence: 'NO_CONFIRMADA', confirmed: false },
  property: { description: '', landAndConstructionSameAcquisitionDate: true }, operation: { operationDate: '', operationTypeCode: '', instrumentTypeCode: '', deedNumber: '', notary: { number: '', name: '', state: '' }, propertyTypeCode: '', transmissionTypeCode: '', reportingMetadata: {}, source: 'MANUAL_CONFIRMED', confirmed: false }, sourceContext: { capturedAt: new Date().toISOString(), acts: [], properties: [], parties: [] }, iva: { applies: false, suggestedFromProperty: false, reviewNote: '' }, acquisitionDate: '', saleDate: '', yearsElapsed: 1, salePrice: '', deductions: [],
  exemptionTreatment: 'PENDIENTE_REVISION', ordinaryCaseConfirmed: false, specialCases: [],
  components: [], parties: [], payments: [],
  criteria: { adjustmentMethod: 'AUTO', resolvedAdjustmentMethod: 'MANUAL_CONFIRMED', tariffSelection: 'AUTO', landLossOffsetsConstructionGain: false, version: 'PENDIENTE', effectiveFrom: '', source: '', referenceCode: '' },
});

const readyInput: ISRInput = {
  operationType: 'ENAJENACION_INMUEBLE', taxYear: 2026,
  taxpayer: { fullName: 'María Fernanda López Ramírez', rfc: 'LORM8504127G2', curp: 'LORM850412MNTPMR08', personType: 'FISICA', fiscalResidence: 'MEXICO', confirmed: true },
  property: { sourcePredioId: 'predio-1', description: 'Casa habitación · Paseo de los Cocoteros 125, Bahía de Banderas, Nayarit', addressText: 'Paseo de los Cocoteros 125, Nuevo Vallarta, Bahía de Banderas, Nayarit, 63735', cadastralKey: 'QA-CAT-001', propertyTaxAccount: 'QA-PRED-001', realEstateFolio: 'FR-QA-00418', registryData: { partida: '418', libro: 'QA' }, countryCode: 'MEX', boundaries: [{ order: 1, reference: 'Norte', measurement: '20.00', unit: 'm', neighbor: 'Área común' }], landAndConstructionSameAcquisitionDate: true, landSurfaceM2: '420.00', constructionSurfaceM2: '238.00', commercialConstructionSurfaceM2: '0.00', cadastralValue: '1450000.00', appraisalValue: '2100000.00', operationValue: '2000000.00' },
  operation: { operationDate: '2026-08-17', operationTypeCode: 'COMPRAVENTA', instrumentTypeCode: 'ESCRITURA_PUBLICA', deedNumber: '418', notary: { id: 'notary-1', number: '12', name: 'Notaría 12', state: 'Nayarit' }, propertyTypeCode: 'HOUSE', transmissionTypeCode: 'ONEROSA', reportingMetadata: { operationReference: 'QA-OP-418', noticeReference: 'QA-AV-418' }, source: 'EXPEDIENTE_SNAPSHOT', confirmed: true },
  sourceContext: {
    capturedAt: '2026-08-17T15:00:00.000Z', expediente: { id: 'exp-1', number: 'EXP-0001-2026', version: 7 },
    acts: [{ id: 'act-1', typeId: 'type-1', name: 'Compraventa de inmueble' }],
    properties: [{ relationId: 'ep-1', predioId: 'predio-1', actIds: ['act-1'], version: 3, label: 'Casa Nuevo Vallarta', description: 'Casa habitación · Paseo de los Cocoteros 125, Bahía de Banderas, Nayarit', addressText: 'Paseo de los Cocoteros 125, Nuevo Vallarta, Bahía de Banderas, Nayarit, 63735', cadastralKey: 'QA-CAT-001', propertyTaxAccount: 'QA-PRED-001', realEstateFolio: 'FR-QA-00418', registryData: { partida: '418', libro: 'QA' }, countryCode: 'MEX', boundaries: [{ order: 1, reference: 'Norte', measurement: '20.00', unit: 'm', neighbor: 'Área común' }], landSurfaceM2: '420.00', constructionSurfaceM2: '238.00', commercialConstructionSurfaceM2: '0.00', cadastralValue: '1450000.00', appraisalValue: '2100000.00', operationValue: '2000000.00', ivaSuggested: false }],
    parties: [{ relationId: 'ec-1', comparecienteId: 'party-1', actId: 'act-1', role: 'Enajenante', name: 'María Fernanda López Ramírez', personType: 'FISICA', rfc: 'LORM8504127G2', curp: 'LORM850412MNTPMR08', nationality: 'Mexicana', fiscalResidence: 'NO_CONFIRMADA', participationPercentage: '100.00', validated: true }],
  },
  iva: { applies: false, suggestedFromProperty: false, reviewNote: 'Sin superficie comercial informada en el predio.' },
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
  ruleSet: { id: 'rules-2026', key: 'ISR_ENAJENACION_INMUEBLE_PAGO_PROVISIONAL_MX_FED', version: '2026.1-DOF-2025-12-28', sourceUrl: 'https://www.dof.gob.mx/nota_detalle.php?codigo=5777219&fecha=28/12/2025', normativeSource: 'LISR artículos 119, 120, 121 y 126; RMF 2026 regla 3.15.4; Anexo 8 apartado A.I', jurisdiction: 'MX-FED', validFrom: '2026-01-01', validTo: '2026-12-31' },
  capabilityMatrix: [
    { key: 'ISR_ENAJENACION_ART126', label: 'ISR por enajenación · pago provisional federal', status: 'SUPPORTED' as const, reason: 'LISR 119, 121 y 126; Anexo 8 RMF 2026 A.I.' },
    { key: 'ISR_ADQUISICION', label: 'ISR por adquisición', status: 'HUMAN_REVIEW_REQUIRED' as const, reason: 'No existe un ruleset aprobado.' },
    { key: 'IVA_INMUEBLE', label: 'IVA de la operación inmobiliaria', status: 'HUMAN_REVIEW_REQUIRED' as const, reason: 'No existe un ruleset aprobado.' },
    { key: 'LISR_ART127_STATE_PAYMENT', label: 'Pago a la entidad federativa', status: 'HUMAN_REVIEW_REQUIRED' as const, reason: 'Fuera del alcance del motor canónico.' },
    { key: 'MULTIPLE_TAXPAYERS', label: 'Distribución entre múltiples contribuyentes', status: 'HUMAN_REVIEW_REQUIRED' as const, reason: 'No existe un ruleset aprobado.' },
  ],
  breakdown: [
    { key: 'income', label: 'Ingreso considerado', operation: 'Precio de enajenación confirmado', amount: '2000000.00', source: 'LISR 119' },
    { key: 'deductions', label: 'Deducciones consideradas', operation: 'Costo actualizado + gastos confirmados', amount: '1200000.00', source: 'LISR 121' },
    { key: 'gain', label: 'Ganancia determinada', operation: '$2,000,000.00 − $1,200,000.00', amount: '800000.00', source: 'LISR 121' },
    { key: 'tariff-base', label: 'Base para tarifa', operation: '$800,000.00 ÷ 10 años', amount: '80000.00', source: 'LISR 126' },
    { key: 'bracket-tax', label: 'Impuesto sobre base', operation: 'Cuota fija + excedente × 6.40%', amount: '4665.94', source: 'Anexo 8 RMF 2026 A.I' },
    { key: 'provisional-isr', label: 'ISR provisional federal', operation: '$4,665.94232 × 10 años', amount: '46659.42', source: 'LISR 126' },
  ],
};

export const readyV3Input: ISRV3Input = {
  schemaVersion: 3,
  taxYear: 2026,
  operationDate: '2026-08-17',
  act: { id: 'type-1', name: 'Compraventa de inmueble', fiscalClassification: 'COMPRAVENTA' },
  property: { type: 'TERRENO_CONSTRUCCION', sameAcquisitionDate: true },
  values: {
    operation: '2000000.00', appraisal: '2100000.00', cadastral: '1450000.00',
    landSale: '1200000.00', constructionSale: '800000.00',
  },
  calculateIVA: true,
  parties: [
    {
      id: 'party-seller', role: 'ENAJENANTE', name: 'María Fernanda López Ramírez', subjectType: 'PF',
      nationalityCode: 'MX', immigrationStatus: 'Mexicana por nacimiento', fiscalResidence: 'MEXICO', percentage: '100',
      acquisitionLayers: [{
        id: 'layer-1', percentage: '100', acquisitionAct: 'ONEROSA', legalDate: '2016-03-01', fiscalDate: '2016-03-01',
        adjustedLandCost: '650000.00', adjustedConstructionCost: '450000.00', source: 'Escritura_adquisicion.pdf · cláusula quinta', verified: true,
      }],
    },
    {
      id: 'party-buyer', role: 'ADQUIRENTE', name: 'Roberto Salinas Vélez', subjectType: 'PF',
      nationalityCode: 'MX', immigrationStatus: 'Mexicano por nacimiento', fiscalResidence: 'MEXICO', percentage: '100',
    },
  ],
  deductions: [{ id: 'd-v3', concept: 'Gastos notariales', amount: '100000.00', paidByPartyId: 'party-seller', component: 'AMBOS', verified: true, supportDocumentId: 'doc-1' }],
};

export const resultV3: ISRV3Result = {
  schemaVersion: 3,
  engineVersion: 'ISR-V3.0',
  ruleVersion: '2026.1-DOF-2025-12-28',
  currency: 'MXN',
  saleISR: [{
    partyId: 'party-seller', partyName: 'María Fernanda López Ramírez', status: 'GRAVADO', amount: '46659.42',
    taxableBase: '800000.00', exemptAmount: '0.00', route: 'PF_MEXICO', reason: 'Tarifa de enajenación vigente aplicada a la ganancia individual.', missing: [],
    traces: [{ ruleId: 'ISR_ENAJENACION_INMUEBLE_PAGO_PROVISIONAL_MX_FED', legalReference: 'LISR artículos 119, 120, 121 y 126', ruleVersion: '2026.1-DOF-2025-12-28', inputsUsed: { ganancia: '800000.00', anos: '10' }, calculation: 'tarifa(ganancia / años) × años', result: '46659.42', explanation: 'Cálculo determinístico individual por enajenante y sus capas de adquisición.' }],
  }],
  acquisitionISR: [{
    partyId: 'party-buyer', partyName: 'Roberto Salinas Vélez', status: 'NO_GENERADO', amount: '0.00',
    taxableBase: '0.00', exemptAmount: '0.00', route: 'ISR_ADQUISICION', reason: 'El avalúo no excede la contraprestación en más del umbral legal verificado.', missing: [],
    traces: [{ ruleId: 'RLISR217_THRESHOLD_PERCENT', legalReference: 'RLISR artículo 217', ruleVersion: '1', inputsUsed: { contraprestacion: '2000000.00', avaluo: '2100000.00', umbral: '10' }, calculation: 'avalúo ≤ contraprestación × (1 + umbral)', result: '0.00', explanation: 'No se actualiza el supuesto que genera ISR por adquisición.' }],
  }],
  iva: {
    status: 'GRAVADO', taxableBase: '800000.00', rate: '16', amount: '128000.00', reason: 'Sólo el componente de construcción legalmente gravado integra la base; el suelo nunca se incluyó.', missing: [],
    traces: [{ ruleId: 'LIVA_GENERAL_RATE', legalReference: 'LIVA artículo 1', ruleVersion: '1', inputsUsed: { construccionGravada: '800000.00', tasa: '16' }, calculation: 'construccionGravada × tasa / 100', result: '128000.00', explanation: 'Determinación de IVA sobre el componente gravado.' }],
  },
  missing: [],
  breakdown: [
    { key: 'sale:party-seller', label: 'ISR enajenación · María Fernanda López Ramírez', operation: 'PF_MEXICO', amount: '46659.42', source: 'LISR artículos 119, 120, 121 y 126' },
    { key: 'acquisition:party-buyer', label: 'ISR adquisición · Roberto Salinas Vélez', operation: 'ISR_ADQUISICION', amount: '0.00', source: 'RLISR artículo 217' },
    { key: 'iva', label: 'IVA', operation: 'GRAVADO', amount: '128000.00', source: 'LIVA artículo 1' },
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
    input_data: mode === 'new' ? emptyISRInput() : readyV3Input, ultima_version: calculated ? (mode === 'history' ? 2 : 1) : 0, datos_modificados: mode === 'existing', created_at: '2026-08-17T15:00:00Z', updated_at: '2026-08-17T16:10:00Z',
    expediente: mode === 'link' ? undefined : { id: 'exp-1', numero_pravia: 'EXP-2026-00318', cliente_alias: readyInput.taxpayer.fullName },
    documentos: ['documents', 'extraction-before', 'extraction-after', 'provenance', 'conflict', 'ready', 'result', 'breakdown', 'existing', 'history', 'link', 'federal-result', 'deduction-origin', 'print-summary'].includes(mode) ? documents : [],
    propuestas: ['extraction-after', 'provenance', 'conflict', 'ready', 'result', 'breakdown', 'existing', 'history', 'federal-result', 'deduction-origin', 'print-summary'].includes(mode) ? proposals : [],
    versiones: calculated ? [{ id: 'v1', version: 1, result: resultV3, breakdown: resultV3.breakdown, calculated_at: '2026-08-17T15:45:00Z', ruleset_snapshot: { version: resultV3.ruleVersion }, input_snapshot: readyV3Input }, ...(mode === 'history' ? [{ id: 'v2', version: 2, result: resultV3, breakdown: resultV3.breakdown, calculated_at: '2026-08-17T16:10:00Z', ruleset_snapshot: { version: resultV3.ruleVersion }, input_snapshot: readyV3Input }] : [])] : [],
  };
};

export const fixtureDirectory: ISRListResponse = {
  kpis: { total: 18, calculated: 11, pending: 5 }, meta: { page: 1, pageSize: 20, total: 18 },
  data: [
    { ...fixtureRecord('result'), id: 'f1', folio: 'ISR-2026-00418', versiones: [{ result: resultV3 }] },
    { ...fixtureRecord('ready'), id: 'f2', folio: 'ISR-2026-00417', contribuyente_nombre: 'Roberto Salinas Vélez', contribuyente_rfc: 'SAVR740922QK4', estado: 'LISTO_PARA_CALCULAR', expediente: { id: 'e2', numero_pravia: 'EXP-2026-00314' }, versiones: [] },
    { ...fixtureRecord('new'), id: 'f3', folio: 'ISR-2026-00416', contribuyente_nombre: 'Inmobiliaria del Pacífico, S.A. de C.V.', contribuyente_rfc: 'IPA190308GK2', tipo_operacion: 'ADQUISICION_INMUEBLE', estado: 'REQUIERE_REVISION', expediente: undefined, versiones: [] },
    { ...fixtureRecord('ready'), id: 'f4', folio: 'ISR-2026-00415', contribuyente_nombre: 'Ana Paula Medina', contribuyente_rfc: 'MERA900115LU8', estado: 'BORRADOR', inmueble_descripcion: 'Terreno · Bucerías, Nayarit', versiones: [] },
  ],
};
