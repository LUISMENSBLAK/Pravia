export type ProspectOperationalStage = {
  code: string;
  label: string;
  order: number;
  active: boolean;
};

export type ProspectService = {
  code: string;
  label: string;
  order: number;
  active: boolean;
  states: string[];
  personTypes: string[];
};

export const PROSPECT_OPERATIONAL_STAGES: readonly ProspectOperationalStage[] = Object.freeze([
  { code: 'PROSPECTO_RECIBIDO', label: 'Prospecto recibido', order: 1, active: true },
  { code: 'ANTECEDENTES_SOLICITADOS', label: 'Antecedentes solicitados', order: 2, active: true },
  { code: 'ANTECEDENTES_RECIBIDOS', label: 'Antecedentes recibidos', order: 3, active: true },
]);

const NAYARIT_JALISCO = Object.freeze(['Nayarit', 'Jalisco']);
const PHYSICAL_AND_LEGAL = Object.freeze(['Persona física', 'Persona moral']);

const service = (
  order: number,
  code: string,
  label: string,
  states: readonly string[] = [],
  personTypes: readonly string[] = [],
): ProspectService => ({ code, label, order, active: true, states: [...states], personTypes: [...personTypes] });

export const PROSPECT_SERVICES: readonly ProspectService[] = Object.freeze([
  service(1, 'COMPRAVENTA', 'Compraventa', NAYARIT_JALISCO),
  service(2, 'DONACION', 'Donación', NAYARIT_JALISCO),
  service(3, 'CESION_DERECHOS_FIDEICOMISARIOS', 'Cesión de derechos fideicomisarios', NAYARIT_JALISCO),
  service(4, 'PERMUTA', 'Permuta', NAYARIT_JALISCO),
  service(5, 'SUBDIVISION', 'Subdivisión', NAYARIT_JALISCO),
  service(6, 'FUSION', 'Fusión', NAYARIT_JALISCO),
  service(7, 'REGIMEN_PROPIEDAD_CONDOMINIO', 'Régimen de propiedad en condominio', NAYARIT_JALISCO),
  service(8, 'CONSTITUCION_SERVIDUMBRE', 'Constitución de servidumbre', NAYARIT_JALISCO),
  service(9, 'EXTINCION_SERVIDUMBRE', 'Extinción de servidumbre', NAYARIT_JALISCO),
  service(10, 'RECONOCIMIENTO_SERVIDUMBRE', 'Reconocimiento de servidumbre', NAYARIT_JALISCO),
  service(11, 'CONSTITUCION_USUFRUCTO', 'Constitución de usufructo', NAYARIT_JALISCO),
  service(12, 'EXTINCION_USUFRUCTO', 'Extinción de usufructo', NAYARIT_JALISCO),
  service(13, 'RECONOCIMIENTO_FIDEICOMISARIO_SUSTITUTO', 'Reconocimiento de fideicomisario sustituto', NAYARIT_JALISCO),
  service(14, 'CONSTITUCION_FIDEICOMISO_ADMINISTRACION', 'Constitución de fideicomiso de administración', NAYARIT_JALISCO),
  service(15, 'CONSTITUCION_FIDEICOMISO_GARANTIA', 'Constitución de fideicomiso de garantía', NAYARIT_JALISCO),
  service(16, 'CONSTITUCION_FIDEICOMISO_TRASLATIVO_DOMINIO', 'Constitución de fideicomiso traslativo de dominio', NAYARIT_JALISCO),
  service(17, 'CONVENIO_MODIFICATORIO_FIDEICOMISO', 'Convenio modificatorio de fideicomiso', NAYARIT_JALISCO),
  service(18, 'EXTINCION_FIDEICOMISO', 'Extinción de fideicomiso', NAYARIT_JALISCO),
  service(19, 'JUICIO_SUCESORIO_TESTAMENTARIO_PRIMERA_ETAPA', 'Juicio sucesorio testamentario — primera etapa'),
  service(20, 'JUICIO_SUCESORIO_INTESTAMENTARIO_PRIMERA_ETAPA', 'Juicio sucesorio intestamentario — primera etapa'),
  service(21, 'JUICIO_SUCESORIO_TESTAMENTARIO_SEGUNDA_ETAPA', 'Juicio sucesorio testamentario — segunda etapa'),
  service(22, 'JUICIO_SUCESORIO_INTESTAMENTARIO_SEGUNDA_ETAPA', 'Juicio sucesorio intestamentario — segunda etapa'),
  service(23, 'CESION_DERECHOS_HEREDITARIOS', 'Cesión de derechos hereditarios'),
  service(24, 'PODER', 'Poder', NAYARIT_JALISCO, PHYSICAL_AND_LEGAL),
  service(25, 'REVOCACION_PODER', 'Revocación de poder', NAYARIT_JALISCO, PHYSICAL_AND_LEGAL),
  service(26, 'TESTAMENTO_PUBLICO_ABIERTO', 'Testamento público abierto', NAYARIT_JALISCO),
  service(27, 'REVOCACION_TESTAMENTO', 'Revocación de testamento'),
  service(28, 'RECONOCIMIENTO_DEUDA_GARANTIA_HIPOTECARIA', 'Reconocimiento de deuda con garantía hipotecaria', NAYARIT_JALISCO),
  service(29, 'CANCELACION_HIPOTECA', 'Cancelación de hipoteca', NAYARIT_JALISCO),
  service(30, 'CONSTITUCION_HIPOTECA', 'Constitución de hipoteca', NAYARIT_JALISCO),
  service(31, 'CONVENIO_MODIFICACION_GARANTIA', 'Convenio de modificación de garantía', NAYARIT_JALISCO),
  service(32, 'PROTOCOLIZACION_DOCUMENTOS', 'Protocolización de documentos'),
  service(33, 'PROTOCOLIZACION_ACTA_ASAMBLEA', 'Protocolización de acta de asamblea', NAYARIT_JALISCO),
  service(34, 'RATIFICACION_FIRMAS', 'Ratificación de firmas'),
  service(35, 'FE_HECHOS', 'Fe de hechos'),
  service(36, 'CONSTITUCION_SOCIEDADES', 'Constitución de sociedades', NAYARIT_JALISCO),
  service(37, 'ADJUDICACION_HERENCIA', 'Adjudicación por herencia'),
  service(38, 'ADJUDICACION_REBELDIA', 'Adjudicación en rebeldía'),
]);

export const DEFAULT_PROSPECT_OPERATIONAL_STAGE = PROSPECT_OPERATIONAL_STAGES[0];

export const prospectStageByCode = (code: unknown) =>
  typeof code === 'string' ? PROSPECT_OPERATIONAL_STAGES.find((item) => item.code === code && item.active) : undefined;

export const prospectServiceByCode = (code: unknown) =>
  typeof code === 'string' ? PROSPECT_SERVICES.find((item) => item.code === code && item.active) : undefined;

export const normalizeProspectName = (value: unknown) => String(value ?? '')
  .trim()
  .replace(/\s+/gu, ' ')
  .toLocaleUpperCase('es-MX');

export const prospectDocumentFlagsForType = (value: unknown) => {
  const type = String(value ?? '').trim().toLocaleUpperCase('es-MX');
  if (type === 'PREDIAL') return { tiene_predial: true };
  if (type === 'ANTECEDENTE') return { tiene_antecedente: true };
  return {};
};
