export type ComplianceStatus = 'BORRADOR' | 'PENDIENTE_REVISION' | 'REQUIERE_AJUSTES' | 'CONFIRMADO' | 'EVALUACION_DETERMINISTA';
export type ComplianceType = 'UIF' | 'ISR' | 'LEGAL_H1';
export type ComplianceAlert = { codigo: string; mensaje: string; regla: string; dato: string; fuente: string; accion: string };
export type ComplianceReview = {
  id: string; tipo: ComplianceType; estatus: ComplianceStatus; fecha_operacion?: string; created_at: string; updated_at: string;
  rule_version_snapshot: string; rule_snapshot: any; master_snapshot: any; snapshot_captured_at: string; master_data_changed?: boolean;
  is_canonical_legal_engine?: boolean; legal_date_source?: string | null; engine_version?: string | null; canonical_state_snapshot?: any;
  cuestionario_json: Record<string, any>; resultado_json?: { clasificacion: string; disclaimer?: string; alertas?: ComplianceAlert[]; faltantes?: string[]; [key: string]: any };
  explicacion?: string; revisado_at?: string; expediente: any; ruleSet: any | null; creado_por: any; revisado_por?: any; evidencias: any[]; decisiones: any[]; supersedes?: any;
};
export type ComplianceList = { revisiones: ComplianceReview[]; meta: { page: number; pageSize: number; total: number; totalPages: number }; metrics: { expedientes_evaluados: number; requieren_revision: number; avisos_por_presentar: number; obligaciones_vencidas: number } };
export type ComplianceCatalogs = { reglas: any[]; expedientes: any[]; usuarios: any[]; documentos: any[] };
export type ComplianceWorkspace = { parties: any[]; beneficialOwners: any[]; pepReviews: any[]; screenings: any[]; payments: any[]; obligations: any[]; events: any[]; aiProposals: any[]; sensitiveRedacted: boolean; state?: any; ruleResults?: any[]; requirements?: any[]; alerts?: any[] };
export type ComplianceDetail = { revision: ComplianceReview; historial: ComplianceReview[]; workspace?: ComplianceWorkspace };
