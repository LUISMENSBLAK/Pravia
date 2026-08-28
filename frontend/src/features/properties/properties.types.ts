export type PropertyBoundary = { id?: string; referencia?: string | null; medida?: string | number | null; unidad?: string | null; colindante?: string | null; descripcion?: string | null; orden?: number };
export type PropertyDocument = { id: string; documento_id: string; tipo_vinculo: string; estatus: string; documento: { id: string; nombre_original: string; mime_type: string; size_bytes: number; fecha_carga: string } };
export type PropertyRecord = {
  id: string; version: number; apodo?: string | null; clave_catastral?: string | null; cuenta_predial?: string | null; folio_real?: string | null;
  datos_registrales?: Record<string, unknown> | null; ubicacion_texto?: string | null; calle?: string | null; numero_exterior?: string | null; numero_interior?: string | null;
  colonia?: string | null; localidad?: string | null; municipio?: string | null; estado?: string | null; codigo_postal?: string | null; pais?: string | null;
  superficie_terreno_m2?: string | number | null; superficie_construccion_m2?: string | number | null; superficie_construccion_comercial_m2?: string | number | null;
  valor_catastral?: string | number | null; valor_avaluo?: string | number | null; valor_operacion?: string | number | null; regimen?: string | null; descripcion?: string | null;
  colindancias: PropertyBoundary[]; documentos: PropertyDocument[];
  expedientes?: Array<{ id: string; expediente: { id: string; numero_pravia: string; cliente_alias?: string | null }; actos: Array<{ expedienteActo: { tipo_acto: { id: string; nombre: string } } }> }>;
};
export type PropertyForm = Omit<PropertyRecord, 'id' | 'version' | 'documentos' | 'expedientes' | 'datos_registrales'> & { datos_registrales?: Record<string, unknown> | string | null; datos_registrales_texto?: string; expected_version?: number };
export type PropertyAIProposal = { campo: string; valor_actual?: string | null; valor_propuesto?: string | null; pagina?: number | null; seccion?: string | null; fragmento_fuente?: string | null; confianza?: string };
export type PropertyAIReview = { extraccion_id: string; documento: { id: string; nombre: string }; propuestas: PropertyAIProposal[]; alertas: string[]; persisted_master: false };
