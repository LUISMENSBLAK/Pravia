export type ISROperationType = 'ENAJENACION_INMUEBLE' | 'ADQUISICION_INMUEBLE' | 'CASO_ESPECIAL';
export type ISRStatus = 'BORRADOR' | 'LISTO_PARA_CALCULAR' | 'CALCULADO' | 'REQUIERE_REVISION';
export type ISRView = 'cards' | 'list';
export type ISRUpdateOrigin = 'PRAVIA_CALCULATION' | 'MANUAL_CONFIRMED' | 'NORMATIVE_OPTION_TABLE';

export type ISRDeduction = {
  id: string; concept: string; historicalAmount: string; updatedAmount: string; expenseDate: string;
  updateOrigin: ISRUpdateOrigin; updateMethod: string;
  treatment: 'COSTO_ADQUISICION_ACTUALIZADO' | 'CONSTRUCCIONES_MEJORAS_AMPLIACIONES_ACTUALIZADAS' | 'GASTOS_NOTARIALES_IMPUESTOS_DERECHOS_AVALUO_ACTUALIZADOS' | 'COMISIONES_MEDIACIONES_ACTUALIZADAS' | 'NO_DEDUCIBLE' | 'REQUIERE_REVISION';
  included: boolean; confirmed: boolean; supportDocumentId: string; reason: string; confirmedBy: string; confirmedAt: string;
};

export type ISRInput = {
  operationType: ISROperationType; taxYear: number;
  taxpayer: { fullName: string; rfc: string; curp?: string; personType: 'FISICA' | 'MORAL'; fiscalResidence: 'MEXICO' | 'EXTRANJERO' | 'NO_CONFIRMADA'; confirmed: boolean };
  property: { description: string; landAndConstructionSameAcquisitionDate: boolean };
  acquisitionDate: string; saleDate: string; yearsElapsed: number; salePrice: string;
  deductions: ISRDeduction[];
  exemptionTreatment: 'NO_APLICA_CONFIRMADO' | 'PENDIENTE_REVISION' | 'SOLICITADA';
  ordinaryCaseConfirmed: boolean;
  specialCases: string[];
};

export type ISRResult = {
  currency: 'MXN'; scope: 'FEDERAL_ARTICLE_126_ONLY'; fiscalOperationFullyDetermined: false;
  unsupportedObligations: Array<'LISR_ARTICLE_127_STATE_PAYMENT'>;
  taxableIncome: string; exemptIncome: string; consideredDeductions: string; gain: string;
  yearsConsidered: number; tariffBase: string; provisionalFederalISR: string;
  bracket: { order: number; lower: string; upper: string | null; fixedFee: string; percentage: string };
  calculationPrecision: { tariffTaxRaw: string; provisionalFederalISRRaw: string };
  ruleSet: { id: string; key: string; version: string; sourceUrl: string };
  breakdown: Array<{ key: string; label: string; operation: string; amount: string; source: string }>;
};

export type ISRVersion = { id: string; version: number; result: ISRResult; breakdown: ISRResult['breakdown']; calculated_at: string; ruleset_snapshot: Record<string, unknown>; input_snapshot: ISRInput };
export type ISRDocumentLink = { id: string; documento_id: string; documento: { id: string; nombre_original: string; mime_type: string; size_bytes: number; fecha_carga: string } };
export type ISRProposal = { id: string; field_path: string; proposed_value: unknown; status: 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA' | 'CONFLICTO'; source_document_id: string; source_document_name: string; source_page?: number; confidence?: string; model_version: string; source_fragment?: string; conflict_group?: string };

export type ISRRecord = {
  id: string; folio: string; tipo_operacion: ISROperationType; estado: ISRStatus; ejercicio: number;
  expediente_id?: string; compareciente_id?: string; contribuyente_nombre?: string; contribuyente_rfc?: string; inmueble_descripcion?: string;
  input_data: ISRInput; ultima_version: number; datos_modificados: boolean; created_at: string; updated_at: string;
  expediente?: { id: string; numero_pravia: string; cliente_alias?: string };
  compareciente?: { id: string; nombre_busqueda: string };
  versiones: ISRVersion[]; documentos: ISRDocumentLink[]; propuestas: ISRProposal[];
};

export type ISRListItem = Omit<ISRRecord, 'versiones' | 'documentos' | 'propuestas'> & { versiones?: Array<{ result: ISRResult }> };
export type ISRListResponse = { data: ISRListItem[]; meta: { page: number; pageSize: number; total: number }; kpis: { total: number; calculated: number; pending: number } };
