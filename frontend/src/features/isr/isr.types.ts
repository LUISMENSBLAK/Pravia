export type ISROperationType = 'ENAJENACION_INMUEBLE' | 'ADQUISICION_INMUEBLE' | 'CASO_ESPECIAL';
export type ISRStatus = 'BORRADOR' | 'LISTO_PARA_CALCULAR' | 'CALCULADO' | 'REQUIERE_REVISION';
export type ISRView = 'cards' | 'list';
export type ISRUpdateOrigin = 'PRAVIA_CALCULATION' | 'MANUAL_CONFIRMED' | 'NORMATIVE_OPTION_TABLE';

export type ISRDeduction = {
  id: string; concept: string; historicalAmount: string; updatedAmount: string; expenseDate: string;
  updateOrigin: ISRUpdateOrigin; updateMethod: string;
  treatment: 'COSTO_ADQUISICION_ACTUALIZADO' | 'CONSTRUCCIONES_MEJORAS_AMPLIACIONES_ACTUALIZADAS' | 'GASTOS_NOTARIALES_IMPUESTOS_DERECHOS_AVALUO_ACTUALIZADOS' | 'COMISIONES_MEDIACIONES_ACTUALIZADAS' | 'NO_DEDUCIBLE' | 'REQUIERE_REVISION';
  included: boolean; confirmed: boolean; supportDocumentId: string; reason: string; confirmedBy: string; confirmedAt: string;
  appliesTo?: 'TERRENO' | 'CONSTRUCCION' | 'AMBOS';
  allocationRule?: { landPercentage: string; constructionPercentage: string; code: string; version: string; source: string; confirmed: boolean };
  depreciateConstructionComponent?: boolean;
  depreciationRule?: { factor: string; code: string; version: string; source: string; confirmed: boolean };
};

export type ISRPropertyComponent = { id: string; type: 'TERRENO' | 'CONSTRUCCION'; saleValue: string; surfaceM2?: string; acquisitions: Array<{ id: string; date: string; historicalAmount: string; updatedAmount: string; adjustmentMethod: 'MANUAL_CONFIRMED' | 'INPC' | 'FACTORES'; factor?: string; referenceCode?: string; source: string; confirmed: boolean }> };
export type ISRPartyAllocation = { id: string; comparecienteId?: string; role: 'ENAJENANTE' | 'ADQUIRENTE'; fullName: string; rfc?: string; curp?: string; personType: 'FISICA' | 'MORAL'; fiscalResidence: 'MEXICO' | 'EXTRANJERO' | 'NO_CONFIRMADA'; participationPercentage: string; exemption?: { amount: string; confirmed: boolean; source: string }; foreignTreatment?: { rate: string; ruleCode: string; source: string; confirmed: boolean } };
export type ISRPayment = { id: string; paymentDate: string; paymentFormCode: string; monetaryInstrumentCode: string; currencyCode: string; amount: string; financialInstitutionCode?: string; accountReference?: string; additionalDescription?: string; source: string };

export type ISRInput = {
  operationType: ISROperationType; taxYear: number;
  taxpayer: { fullName: string; rfc: string; curp?: string; personType: 'FISICA' | 'MORAL'; fiscalResidence: 'MEXICO' | 'EXTRANJERO' | 'NO_CONFIRMADA'; confirmed: boolean };
  property: {
    sourcePredioId?: string; description: string; landAndConstructionSameAcquisitionDate: boolean;
    addressText?: string; cadastralKey?: string; propertyTaxAccount?: string; realEstateFolio?: string;
    registryData?: Record<string, unknown>; countryCode?: string;
    boundaries?: Array<{ order: number; reference?: string; measurement?: string; unit?: string; neighbor?: string; description?: string }>;
    landSurfaceM2?: string; constructionSurfaceM2?: string; commercialConstructionSurfaceM2?: string;
    cadastralValue?: string; appraisalValue?: string; operationValue?: string;
  };
  operation?: {
    operationDate: string; operationTypeCode: string; instrumentTypeCode: string; deedNumber: string;
    notary: { id?: string; number: string; name: string; state: string };
    propertyTypeCode: string; transmissionTypeCode: string;
    reportingMetadata: { operationReference?: string; noticeReference?: string };
    source: 'EXPEDIENTE_SNAPSHOT' | 'MANUAL_CONFIRMED'; confirmed: boolean;
  };
  sourceContext?: {
    capturedAt: string;
    expediente?: { id: string; number: string; version: number };
    acts: Array<{ id: string; typeId: string; name: string }>;
    properties: Array<{ relationId: string; predioId: string; actIds: string[]; version: number; label: string; description: string; addressText?: string; cadastralKey?: string; propertyTaxAccount?: string; realEstateFolio?: string; registryData?: Record<string, unknown>; countryCode?: string; boundaries?: Array<{ order: number; reference?: string; measurement?: string; unit?: string; neighbor?: string; description?: string }>; landSurfaceM2?: string; constructionSurfaceM2?: string; commercialConstructionSurfaceM2?: string; cadastralValue?: string; appraisalValue?: string; operationValue?: string; ivaSuggested: boolean }>;
    parties: Array<{ relationId: string; comparecienteId: string; actId?: string | null; role: string; name: string; personType: 'FISICA' | 'MORAL'; rfc?: string; curp?: string; nationality?: string; fiscalResidence: 'MEXICO' | 'EXTRANJERO' | 'NO_CONFIRMADA'; participationPercentage?: string; validated: boolean }>;
  };
  iva?: { applies: boolean; suggestedFromProperty: boolean; reviewNote?: string };
  acquisitionDate: string; saleDate: string; yearsElapsed: number; salePrice: string;
  deductions: ISRDeduction[];
  exemptionTreatment: 'NO_APLICA_CONFIRMADO' | 'PENDIENTE_REVISION' | 'SOLICITADA';
  ordinaryCaseConfirmed: boolean;
  specialCases: string[];
  components?: ISRPropertyComponent[];
  parties?: ISRPartyAllocation[];
  payments?: ISRPayment[];
  landExemption?: { enabled: boolean; coveredAreaM2: string; totalAreaM2: string; exemptMultiplier: string; ruleCode: string; ruleVersion: string; source: string; confirmed: boolean };
  criteria?: { adjustmentMethod: 'AUTO' | 'INPC' | 'FACTORES'; resolvedAdjustmentMethod: 'MANUAL_CONFIRMED' | 'INPC' | 'FACTORES'; tariffSelection: 'AUTO' | 'MANUAL_AUTHORIZED'; landLossOffsetsConstructionGain: boolean; version: string; effectiveFrom: string; source: string; referenceCode: string; tariffRuleSetId?: string; authorizedBy?: string; authorizedAt?: string; reason?: string };
};

export type ISRResult = {
  currency: 'MXN'; scope: 'FEDERAL_ARTICLE_126_ONLY'; fiscalOperationFullyDetermined: false;
  unsupportedObligations: Array<'LISR_ARTICLE_127_STATE_PAYMENT'>;
  taxableIncome: string; exemptIncome: string; consideredDeductions: string; gain: string;
  yearsConsidered: number; tariffBase: string; provisionalFederalISR: string;
  bracket: { order: number; lower: string; upper: string | null; fixedFee: string; percentage: string };
  calculationPrecision: { tariffTaxRaw: string; provisionalFederalISRRaw: string };
  ruleSet: { id: string; key: string; version: string; sourceUrl: string; normativeSource: string; jurisdiction: string; validFrom: string; validTo: string };
  capabilityMatrix: Array<{ key: string; label: string; status: 'SUPPORTED' | 'HUMAN_REVIEW_REQUIRED'; reason: string }>;
  breakdown: Array<{ key: string; label: string; operation: string; amount: string; source: string }>;
  advanced?: { scenario: string; adjustedAcquisition: string; components: Array<{ id: string; type: 'TERRENO' | 'CONSTRUCCION'; saleValue: string; adjustedAcquisition: string; allocatedDeductions: string; gain: string; acquisitionCount: number }>; criteria?: ISRInput['criteria']; partyResults: Array<{ id: string; role: 'ENAJENANTE'; participationPercentage: string; taxableIncome: string; allocatedDeductions: string; exemptIncome: string; provisionalFederalISR: string; treatment: string }>; landExemption?: { exemptAreaM2: string; nonExemptAreaM2: string; exemptRatio: string; acquisitionNonExempt: string; saleNonExempt: string; ruleCode: string; ruleVersion: string; source: string }; paymentTotal: string; calculationTrace: Array<{ node: string; inputs: Record<string,string>; formula: string; rule: string; rounding: string; result: string }> };
};

export type ISRV3LegalStatus = 'GRAVADO' | 'EXENTO' | 'EXENTO_PARCIALMENTE' | 'NO_GENERADO' | 'NO_APLICA' | 'PENDIENTE_INFORMACION';
export type ISRV3Party = {
  id: string; role: 'ENAJENANTE' | 'ADQUIRENTE'; name: string;
  subjectType: 'PF' | 'PM_TITULO_II' | 'PM_TITULO_III' | 'OTRO'; nationalityCode: string;
  immigrationStatus?: string; fiscalResidence: 'MEXICO' | 'EXTRANJERO' | 'POR_DETERMINAR'; percentage: string;
  acquisitionLayers?: Array<{ id: string; percentage: string; acquisitionAct: 'ONEROSA' | 'HERENCIA' | 'DONACION' | 'OTRO'; legalDate: string; fiscalDate: string; adjustedLandCost: string; adjustedConstructionCost: string; source: string; priorLayerId?: string; verified: boolean }>;
  foreignGainOption?: { requested: boolean; requirementsVerified: boolean; source: string };
  acquisitionExemption?: { applies: boolean; legalReference: string; verified: boolean };
  homeExemption?: { requested: boolean; homeUseVerified: boolean; requiredDocumentsVerified: boolean; noExemptionInPriorThreeYearsVerified: boolean };
};
export type ISRV3Input = {
  schemaVersion: 3; taxYear: number; operationDate: string;
  act: { id?: string; name: string; fiscalClassification: 'COMPRAVENTA' | 'PERMUTA' | 'DACION_PAGO' | 'ADJUDICACION' | 'DONACION' | 'FIDEICOMISO' | 'APORTACION' | 'OTRO'; otherDescription?: string };
  property: { type: 'TERRENO' | 'CASA_HABITACION' | 'TERRENO_CONSTRUCCION' | 'CONSTRUCCION_COMERCIAL' | 'USO_MIXTO' | 'OTRO'; otherDescription?: string; sameAcquisitionDate: boolean; mixedTaxablePercentage?: string };
  values: { operation: string; appraisal: string; cadastral: string; landSale: string; constructionSale: string };
  calculateIVA: boolean; parties: ISRV3Party[];
  deductions: Array<{ id: string; concept: string; amount: string; paidByPartyId?: string; component: 'TERRENO' | 'CONSTRUCCION' | 'AMBOS'; verified: boolean; supportDocumentId?: string }>;
};
export type ISRV3Trace = { ruleId: string; legalReference: string; ruleVersion: string; inputsUsed: Record<string,string>; calculation: string; result: string; explanation: string };
export type ISRV3PartyResult = { partyId: string; partyName: string; status: ISRV3LegalStatus; amount: string | null; taxableBase: string | null; exemptAmount: string | null; route: string; reason: string; missing: string[]; traces: ISRV3Trace[] };
export type ISRV3Result = { schemaVersion: 3; engineVersion: 'ISR-V3.0'; ruleVersion: string; currency: 'MXN'; saleISR: ISRV3PartyResult[]; acquisitionISR: ISRV3PartyResult[]; iva: { status: ISRV3LegalStatus; taxableBase: string | null; rate: string | null; amount: string | null; reason: string; missing: string[]; traces: ISRV3Trace[] }; missing: string[]; breakdown: Array<{ key: string; label: string; operation: string; amount: string; source: string }> };
export type ISRAnyInput = ISRInput | ISRV3Input;
export type ISRAnyResult = ISRResult | ISRV3Result;

export type ISRVersion = { id: string; version: number; result: ISRAnyResult; breakdown: Array<{ key: string; label: string; operation: string; amount: string; source: string }>; calculated_at: string; ruleset_snapshot: Record<string, unknown>; input_snapshot: ISRAnyInput };
export type ISRDocumentLink = { id: string; documento_id: string; estatus?: 'ACTIVO' | 'INACTIVO'; idempotency_key?: string | null; generated_from_version?: number | null; format_source?: string | null; documento: { id: string; nombre_original: string; mime_type: string; size_bytes: number; fecha_carga: string; tipo?: string } };
export type ISRProposal = { id: string; field_path: string; proposed_value: unknown; status: 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA' | 'CONFLICTO'; source_document_id: string; source_document_name: string; source_page?: number; confidence?: string; model_version: string; source_fragment?: string; conflict_group?: string };

export type ISRRecord = {
  id: string; folio: string; tipo_operacion: ISROperationType; estado: ISRStatus; ejercicio: number;
  expediente_id?: string; compareciente_id?: string; contribuyente_nombre?: string; contribuyente_rfc?: string; inmueble_descripcion?: string;
  input_data: ISRAnyInput; ultima_version: number; datos_modificados: boolean; created_at: string; updated_at: string;
  expediente?: { id: string; numero_pravia: string; cliente_alias?: string };
  compareciente?: { id: string; nombre_busqueda: string };
  versiones: ISRVersion[]; documentos: ISRDocumentLink[]; propuestas: ISRProposal[];
};

export type ISRListItem = Omit<ISRRecord, 'versiones' | 'documentos' | 'propuestas'> & { versiones?: Array<{ result: ISRAnyResult }> };
export type ISRListResponse = { data: ISRListItem[]; meta: { page: number; pageSize: number; total: number }; kpis: { total: number; calculated: number; pending: number } };
export type ISRFiscalReference = { id: string; type: string; code: string; version: number; effectiveFrom: string; effectiveTo: string | null; value: Record<string, unknown>; sourceTitle: string; sourceUrl: string };
export type ISRExportProfile = { id: string; code: string; name: string; target: string; version: number; definition: Record<string, unknown>; authority?: string | null; validFrom?: string | null; validTo?: string | null; serialization?: Record<string, unknown> | null; validationRules?: Record<string, unknown> | null; sourceTitle?: string | null; sourceUrl?: string | null };
export type ISRResources = { legal_date: string; references: ISRFiscalReference[]; export_profiles: ISRExportProfile[]; rule_sets: Array<{ id: string; key: string; version: string; taxYear: number; operationType: string; jurisdiction: string; validFrom: string; validTo: string | null; normativeSource: string; sourceUrl: string }>; acts: Array<{ id: string; name: string; description?: string | null; catalogCode?: string | null }>; catalogs: Record<string, Array<{ code: string; label: string }>> };
export type ISRPostalCode = { id: string; postal_code: string; settlement: string; settlement_type?: string | null; municipality: string; state: string; city?: string | null; zone?: string | null };
export type ISRPostalCodeSearch = { source: { version: string; updated_at: string; url: string } | null; data: ISRPostalCode[] };
