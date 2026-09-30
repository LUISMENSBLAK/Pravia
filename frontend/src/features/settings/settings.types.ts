export type Role = 'DIRECCION' | 'ADMINISTRACION' | 'ABOGADO' | 'RECEPCION' | 'GESTORIA' | 'CONSULTA';
export type UserStatus = 'ACTIVO' | 'SUSPENDIDO' | 'BLOQUEADO' | 'CAMBIO_REQUERIDO';

export type ManagedUser = {
  id: string; email: string; nombre: string; apellido: string; telefono?: string | null;
  rol: Role; activo: boolean; status: UserStatus; last_login_at?: string | null;
  created_at: string; requires_password_change?: boolean;
};

export type UserInvitation = {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: Role;
  status: 'PENDIENTE' | 'EXPIRADA';
  created_at: string;
  expires_at: string;
};

export type UserPreferences = {
  default_view: 'CARDS' | 'LIST'; density: 'COMFORTABLE' | 'COMPACT';
  timezone: string; date_format: 'DD/MM/YYYY' | 'YYYY-MM-DD'; theme: 'SYSTEM' | 'LIGHT';
  notifications_enabled: boolean; assistant_suggestions_enabled: boolean; updated_at?: string;
};

export type Session = {
  id: string; device: string; ip_approximate: string; expires_at: string; last_used_at: string;
  created_at: string; current: boolean;
};

export type NotificationItem = {
  id: string; type: string; subtype?: string | null; priority: 'LOW' | 'NORMAL' | 'IMPORTANT' | 'URGENT';
  title: string; body: string; source_module?: string | null; entity_type?: string | null; entity_id?: string | null;
  href?: string | null; status: 'ACTIVE' | 'RESOLVED' | 'DISMISSED' | 'NOT_APPLICABLE';
  read_at?: string | null; last_reminder_at?: string | null; snoozed_until?: string | null;
  resolved_at?: string | null; dismissed_at?: string | null; not_applicable_at?: string | null;
  metadata?: Record<string, unknown>; created_at: string; updated_at?: string;
  reminders?: Array<{ id: string; reminder_key: string; channel: string; created_at: string }>;
};

export type NotificationFeed = {
  notifications: NotificationItem[]; unread: number; generated_at?: string; refresh_seconds?: number;
};

export type SearchResult = { type: string; id: string; title: string; subtitle?: string | null; href: string };

export { ROLE_LABELS } from '../../lib/formatters';
