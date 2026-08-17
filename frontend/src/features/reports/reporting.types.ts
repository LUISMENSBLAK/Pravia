export type ReportView = 'resumen' | 'finanzas' | 'cobranza' | 'abogados' | 'firmas' | '80-20' | 'clientes-potenciales';
export type ReportPeriodKey = 'ESTA_SEMANA' | 'ESTE_MES' | 'MES_ANTERIOR' | 'ESTE_TRIMESTRE' | 'ESTE_ANO' | 'PERSONALIZADO';
export type ReportScope = { mode: 'GLOBAL' | 'PROPIO' | 'OPERATIVO'; lawyerId?: string; notariaId?: string; financial: boolean };
export type ReportPeriod = { key: string; label: string; from: string; to: string; timezone: string };

export type ReportingCatalogs = {
  usuarios: Array<{ id: string; nombre: string; apellido: string; rol: string }>;
  notarias: Array<{ id: string; nombre: string; numero_notaria?: string | number | null }>;
  scope: { global: boolean; financial: boolean; targetsManage?: boolean };
};

export type FinancialTotals = {
  honorarios_generados: number;
  honorarios_cobrados: number;
  honorarios_por_cobrar: number;
  ingresos_recibidos: number;
  fondos_terceros: number;
  otros_destinos: number;
  fondos_terceros_pendientes: number;
  egresos: number;
};

export type GoalProgress = {
  meta: number;
  actual: number;
  pendiente: number;
  cumplimiento: number | null;
  base: 'GENERADOS' | 'COBRADOS';
};

export type SummaryReport = {
  period: ReportPeriod;
  scope: ReportScope;
  financial: FinancialTotals | null;
  goal: GoalProgress | null;
  operations: {
    firmas_realizadas: number;
    firmas_restantes_semana: number;
    honorarios_programados_semana: number | null;
    presupuestos_solicitados: number;
    importe_cotizado: number | null;
    presupuestos_aceptados: number;
    clientes_generados: number;
  };
  definitions: { programado: string; clientes: string };
};

export type ComparisonRow = {
  id: string;
  nombre: string;
  generated: number;
  collected: number;
  pending: number;
  expedientes: number;
  porcentaje_cobrado: number | null;
  overdue?: number;
  goal?: GoalProgress | null;
};

export type FinanceReport = {
  period: ReportPeriod;
  scope: ReportScope;
  restricted?: boolean;
  financial?: FinancialTotals;
  tendency?: Array<{ periodo: string; generados: number; cobrados: number }>;
  byLawyer?: ComparisonRow[];
  byNotaria?: ComparisonRow[];
  goal?: GoalProgress | null;
};

export type CollectionRow = {
  id: string;
  expediente_id?: string;
  expediente: string;
  cliente: string;
  abogado: string;
  notaria: string;
  generated: number;
  collected: number;
  pending: number;
  due?: string | null;
  overdue?: boolean;
  link: string;
};

export type CollectionsReport = {
  period: ReportPeriod;
  scope: ReportScope;
  restricted?: boolean;
  totals?: { generated: number; collected: number; pending: number; overdue: number };
  byLawyer?: ComparisonRow[];
  byNotaria?: ComparisonRow[];
  rows?: CollectionRow[];
  tendency?: Array<{ periodo: string; generados: number; cobrados: number }>;
  dueBreakdown?: { overdue: number; notOverdue: number; withoutDue: number };
};

export type LawyerRow = {
  id: string;
  nombre: string;
  expedientes_periodo: number;
  honorarios_generados: number | null;
  honorarios_cobrados: number | null;
  firmas_semana: number;
  firmas_mes: number;
  firmas_proximo_mes: number;
  firmas_realizadas_semana_anterior: number;
  honorarios_semana: number | null;
  honorarios_mes: number | null;
  goal: GoalProgress | null;
};

export type LawyersReport = { period: ReportPeriod; scope: ReportScope; rows: LawyerRow[] };

export type SignatureRow = {
  id: string;
  numero_pravia: string;
  cliente_alias?: string | null;
  fecha_estimada_firma?: string | null;
  fecha_real_firma?: string | null;
  honorarios: number | null;
  abogado: string;
  estado: 'PROGRAMADA' | 'REALIZADA' | 'ATRASADA_SIN_CONFIRMAR';
  link: string;
};

export type SignaturesReport = {
  period: ReportPeriod;
  scope: ReportScope;
  metrics: {
    realizadas_periodo: number;
    realizadas_semana_anterior: number;
    programadas_semana: number;
    programadas_mes: number;
    programadas_proximo_mes: number;
    atrasadas_sin_confirmar: number;
    honorarios_realizados_periodo: number | null;
    honorarios_programados_semana: number | null;
    honorarios_programados_mes: number | null;
  };
  definitions: { programada: string; realizada: string };
  rows: SignatureRow[];
};

export type EightyTwentyReport = {
  period: ReportPeriod;
  scope: ReportScope;
  restricted?: boolean;
  definition?: string;
  source?: string;
  unclassified_amount?: number;
  limit?: number;
  rows?: Array<{
    id: string;
    expediente: string;
    cliente: string;
    honorarios: number | null;
    importe_computable: number;
    cobrado_honorarios_acumulado: number | null;
    pending: number | null;
    fecha_firma?: string | null;
    notaria: string;
    abogado: string;
    status: string;
    link: string;
  }>;
};

export type PotentialClientsReport = {
  period: ReportPeriod;
  scope: ReportScope;
  restricted?: boolean;
  definition: string;
  metrics?: { total: number; honorarios: number };
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
  rows: Array<{
    id: string;
    cliente: string;
    honorarios: number;
    notaria: string;
    responsable: string;
    acto: string;
    fecha_cotizacion: string;
    link: string;
  }>;
};
