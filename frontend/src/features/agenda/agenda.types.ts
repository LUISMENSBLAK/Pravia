export type AgendaView = 'day' | 'week' | 'month' | 'list';
export type AgendaEventStatus = 'ACTIVO' | 'COMPLETADO' | 'CANCELADO';
export type AgendaEventType = 'PERSONAL' | 'DESPACHO' | 'FIRMA' | 'AUDIENCIA' | 'VENCIMIENTO' | 'CITA' | 'NOTARIA' | 'SEGUIMIENTO' | 'OTRO';

export type AgendaUser = { id: string; nombre: string; apellido: string; rol: string };
export type AgendaNotaria = { id: string; numero_notaria: string | null; nombre: string; ciudad: string | null; municipio: string; entidad_federativa: string };
export type AgendaCase = {
  id: string; numero_pravia: string; cliente_alias: string | null; estatus: string; etapa_actual_nombre?: string | null;
  version?: number; abogado_id?: string; fecha_estimada_firma?: string | null; fecha_real_firma?: string | null;
  tipo_acto?: { id: string; nombre: string } | null; notaria?: AgendaNotaria | null;
};
export type AgendaParty = { id: string; tipo_persona: string; nombre: string };

export type AgendaEvent = {
  id: string; titulo: string; descripcion: string | null; tipo: AgendaEventType; estatus: AgendaEventStatus;
  fecha_inicio: string; fecha_fin: string | null; todo_el_dia: boolean; user_id: string | null;
  expediente_id: string | null; compareciente_id: string | null; recordatorios: number[] | null;
  cancelado_at?: string | null; motivo_cancelacion?: string | null; created_at: string; updated_at: string;
  usuario: AgendaUser | null; responsable_nombre: string; expediente: AgendaCase | null;
  compareciente_nombre: string | null; notaria: AgendaNotaria | null; color: string;
  firma: { programada: string; estimada_expediente: string | null; efectiva: string | null } | null;
  actividad?: Array<{ id: string; accion: string; created_at: string; usuario?: AgendaUser; valores_anteriores?: Record<string, unknown>; valores_nuevos?: Record<string, unknown> }>;
};

export type AgendaTask = {
  id: string; titulo: string; descripcion: string | null; prioridad: 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE';
  estatus: 'PENDIENTE' | 'EN_PROCESO' | 'COMPLETADA' | 'CANCELADA'; fecha_limite: string | null;
  asignado_a: AgendaUser; expediente: Pick<AgendaCase, 'id' | 'numero_pravia' | 'cliente_alias' | 'estatus'> | null;
};

export type AgendaCatalogs = {
  usuarios: AgendaUser[]; expedientes: AgendaCase[]; comparecientes: AgendaParty[];
  tipos: Array<{ tipo: AgendaEventType; color: string }>; timezone: string;
  permisos: { gestionar_equipo: boolean; escribir: boolean };
};

export type AgendaDraft = {
  titulo: string; tipo: AgendaEventType; fecha: string; hora_inicio: string; hora_fin: string;
  responsable_id: string; expediente_id: string; compareciente_id: string; descripcion: string; recordatorio: string;
};

export type AgendaLoadResult = { eventos: AgendaEvent[]; meta: { total: number; desde: string; hasta: string; timezone: string } };

