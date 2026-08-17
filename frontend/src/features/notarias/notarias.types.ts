export type NotariaStatus = 'ACTIVA' | 'INACTIVA';
export type NotariaContactSummary = { id: string | null; nombre: string | null; cargo: string | null; telefono: string | null; correo: string | null; es_principal: boolean };
export type NotariaListItem = {
  id: string; numero_notaria: string | null; nombre: string; etiqueta: string; titular: string | null;
  ciudad: string | null; municipio: string; entidad_federativa: string; demarcacion: string | null;
  contacto: NotariaContactSummary; expedientes_activos: number; estatus: NotariaStatus; predeterminada: boolean; updated_at: string;
};
export type NotariaListResult = {
  data: NotariaListItem[];
  metrics: { total: number; nayarit: number; jalisco: number };
  facets: { states: string[] };
  meta: { total: number; page: number; limit: number; pageSize: number; totalPages: number; hasPreviousPage: boolean; hasNextPage: boolean };
  definitions: Record<string, string>;
};
export type NotariaFilters = { search?: string; state?: string; page?: number; pageSize?: number };
export type NotariaWeekDay = 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | 'sabado' | 'domingo';
export type NotariaDaySchedule = { cerrado: true } | { cerrado: false; apertura: string; cierre: string };
export type NotariaWeeklySchedule = Partial<Record<NotariaWeekDay, NotariaDaySchedule>>;
export type NotariaContact = { id: string; nombre: string; cargo: string | null; telefono: string | null; whatsapp: string | null; correo: string | null; observaciones: string | null; activo: boolean; created_at: string };
export type NotariaCase = { id: string; numero_pravia: string; cliente_alias: string | null; estatus: string; etapa_actual_nombre: string | null; updated_at: string; tipo_acto?: { nombre: string }; abogado?: { id: string; nombre: string; apellido: string }; gestor?: { id: string; nombre: string; apellido: string } | null };
export type NotariaDetail = Omit<NotariaListItem, 'expedientes_activos'> & {
  direccion: string | null; codigo_postal: string | null; telefono: string | null; whatsapp: string | null;
  correo_general: string | null; correo_proyectos: string | null; pagina_web: string | null; contacto_principal: string | null; contacto_principal_id: string | null;
  horario: string | null; horario_semanal: NotariaWeeklySchedule | null; dias_atencion: string | null; tiempo_respuesta: string | null; tiempo_presupuesto: string | null; tiempo_firma: string | null;
  instrucciones_especiales: string | null; observaciones_generales: string | null; requisitos_frecuentes: string | null;
  dias_respuesta_estimados: number; dias_presupuesto_estimados: number | null; dias_firma_estimados: number | null; activa: boolean; color_identificador: string | null;
  tipos_acto_json: string[] | null; instituciones_json: string[] | null; municipios_atendidos_json: string[] | null;
  created_at: string; contactos: NotariaContact[];
  metrics: { activeCases: number; historicalCases: number; quotes: number; upcomingSignatures: number; lastActivity: string };
  expedientes: NotariaCase[]; proximasFirmas: Array<{ id: string; numero_pravia: string; fecha_estimada_firma: string; cliente_alias: string | null }>;
  responsables: Array<{ id: string; nombre: string; apellido: string; rol: string; expedientes: number }>;
  actividad: Array<{ id: string; accion: string; created_at: string; valores_nuevos?: Record<string, unknown>; usuario?: { nombre: string; apellido: string } }>;
  definitions: Record<string, string>;
};
export type NotariaDraft = {
  numero_notaria: string; nombre: string; notario_titular: string; entidad_federativa: string; municipio: string; ciudad: string;
  demarcacion: string; direccion: string; codigo_postal: string; telefono: string; correo_general: string; correo_proyectos: string;
  activa: boolean;
};
export type NotariaUpdateInput = Partial<{
  notario_titular: string | null;
  entidad_federativa: string;
  municipio: string;
  ciudad: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  telefono: string | null;
  correo_general: string | null;
  contacto_principal_id: string | null;
  horario_semanal: NotariaWeeklySchedule | null;
  dias_respuesta_estimados: number;
  dias_presupuesto_estimados: number | null;
  dias_firma_estimados: number | null;
}>;
