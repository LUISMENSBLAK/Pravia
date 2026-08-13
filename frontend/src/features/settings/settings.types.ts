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
  id: string; type: string; title: string; body: string; href?: string | null;
  read_at?: string | null; created_at: string;
};

export type SearchResult = { type: string; id: string; title: string; subtitle?: string | null; href: string };

export { ROLE_LABELS } from '../../lib/formatters';
