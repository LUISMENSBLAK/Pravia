export type NotariaStatus = 'ACTIVA' | 'INACTIVA';
export type NotariaContactSummary = { nombre: string | null; telefono: string | null; correo: string | null };
export type NotariaListItem = {
  id: string; numero_notaria: string | null; nombre: string; etiqueta: string; titular: string | null;
  ciudad: string | null; municipio: string; entidad_federativa: string; demarcacion: string | null;
  contacto: NotariaContactSummary; expedientes_activos: number; estatus: NotariaStatus; predeterminada: boolean; updated_at: string;
};
export type NotariaListResult = {
  data: NotariaListItem[];
  metrics: { total: number; active: number; inactive: number; withActiveCases: number };
  distribution: { criterion: 'ENTIDAD_FEDERATIVA'; total: number; items: Array<{ label: string; value: number; percentage: number }> };
  facets: { states: string[]; cities: string[] };
  meta: { total: number; page: number; limit: number; pageSize: number; totalPages: number; hasPreviousPage: boolean; hasNextPage: boolean };
  definitions: Record<string, string>;
};
export type NotariaFilters = { search?: string; state?: string; city?: string; status?: string; activeCases?: boolean; sort?: string; page?: number; pageSize?: number };
export type NotariaContact = { id: string; nombre: string; cargo: string; telefono: string | null; whatsapp: string | null; correo: string | null; observaciones: string | null; activo: boolean; created_at: string };
export type NotariaCase = { id: string; numero_pravia: string; cliente_alias: string | null; estatus: string; etapa_actual_nombre: string | null; updated_at: string; tipo_acto?: { nombre: string }; abogado?: { id: string; nombre: string; apellido: string }; gestor?: { id: string; nombre: string; apellido: string } | null };
export type NotariaDetail = Omit<NotariaListItem, 'expedientes_activos'> & {
  direccion: string | null; codigo_postal: string | null; telefono: string | null; whatsapp: string | null;
  correo_general: string | null; correo_proyectos: string | null; pagina_web: string | null; contacto_principal: string | null;
  horario: string | null; dias_atencion: string | null; tiempo_respuesta: string | null; tiempo_presupuesto: string | null; tiempo_firma: string | null;
  instrucciones_especiales: string | null; observaciones_generales: string | null; requisitos_frecuentes: string | null;
  dias_respuesta_estimados: number; activa: boolean; color_identificador: string | null;
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
  demarcacion: string; direccion: string; codigo_postal: string; telefono: string; whatsapp: string; correo_general: string; correo_proyectos: string;
  activa: boolean;
};
