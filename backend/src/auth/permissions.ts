import { Role } from '@prisma/client';

export const PERMISSIONS = [
  'mi_dia.read',
  'prospectos.read', 'prospectos.write',
  'cotizaciones.read', 'cotizaciones.write',
  'expedientes.read', 'expedientes.write', 'expedientes.archive',
  'expedientes.deliver', 'expedientes.postfirma.manage', 'expedientes.project.read',
  'documentos.read', 'documentos.write', 'documentos.unlink',
  'comparecientes.read', 'comparecientes.write',
  'notarias.read', 'notarias.write',
  'agenda.read', 'agenda.write',
  'finanzas.read', 'finanzas.write', 'finanzas.validate',
  'reportes.read',
  'ia.read', 'ia.execute',
  'ai.use', 'ai.expedientes.read', 'ai.comparecientes.read', 'ai.documentos.read',
  'ai.agenda.read', 'ai.finanzas.read', 'ai.cumplimiento.read', 'ai.work.read',
  'ai.search', 'ai.navigate', 'ai.actions.prepare', 'ai.admin.read',
  'cumplimiento.read', 'cumplimiento.write', 'cumplimiento.confirm',
  'usuarios.read', 'usuarios.manage',
  'configuracion.manage',
] as const;

export type Permission = typeof PERMISSIONS[number];

const all = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  DIRECCION: all,
  ADMINISTRACION: [
    'mi_dia.read',
    'prospectos.read', 'prospectos.write',
    'cotizaciones.read', 'cotizaciones.write',
    'expedientes.read', 'expedientes.write', 'expedientes.deliver', 'expedientes.postfirma.manage', 'expedientes.project.read',
    'documentos.read', 'documentos.write', 'documentos.unlink',
    'comparecientes.read', 'comparecientes.write',
    'notarias.read', 'notarias.write',
    'agenda.read', 'agenda.write',
    'finanzas.read', 'finanzas.write', 'finanzas.validate',
    'reportes.read', 'ia.read', 'ia.execute',
    'ai.use', 'ai.expedientes.read', 'ai.comparecientes.read', 'ai.documentos.read',
    'ai.agenda.read', 'ai.finanzas.read', 'ai.cumplimiento.read', 'ai.work.read',
    'ai.search', 'ai.navigate', 'ai.actions.prepare', 'ai.admin.read',
    'cumplimiento.read', 'usuarios.read',
  ],
  ABOGADO: [
    'mi_dia.read', 'prospectos.read', 'prospectos.write',
    'cotizaciones.read', 'cotizaciones.write',
    'expedientes.read', 'expedientes.write', 'expedientes.deliver', 'expedientes.postfirma.manage', 'expedientes.project.read',
    'documentos.read', 'documentos.write', 'documentos.unlink',
    'comparecientes.read', 'comparecientes.write',
    'notarias.read', 'agenda.read', 'agenda.write',
    'ia.read', 'ia.execute',
    'ai.use', 'ai.expedientes.read', 'ai.comparecientes.read', 'ai.documentos.read',
    'ai.agenda.read', 'ai.cumplimiento.read', 'ai.work.read', 'ai.search', 'ai.navigate', 'ai.actions.prepare',
    'cumplimiento.read', 'cumplimiento.write', 'cumplimiento.confirm',
    'usuarios.read',
  ],
  RECEPCION: [
    'mi_dia.read', 'prospectos.read', 'prospectos.write',
    'cotizaciones.read', 'cotizaciones.write',
    'expedientes.read', 'expedientes.deliver',
    'ai.use', 'ai.expedientes.read', 'ai.documentos.read', 'ai.agenda.read', 'ai.work.read', 'ai.search', 'ai.navigate', 'ai.actions.prepare',
    'documentos.read', 'documentos.write',
    'notarias.read', 'agenda.read', 'agenda.write', 'usuarios.read',
  ],
  GESTORIA: [
    'mi_dia.read', 'expedientes.read', 'expedientes.postfirma.manage',
    'ai.use', 'ai.expedientes.read', 'ai.documentos.read', 'ai.agenda.read', 'ai.work.read', 'ai.search', 'ai.navigate', 'ai.actions.prepare',
    'documentos.read', 'documentos.write',
    'notarias.read', 'agenda.read', 'agenda.write', 'usuarios.read',
  ],
  CONSULTA: [
    'mi_dia.read', 'expedientes.read', 'expedientes.project.read', 'documentos.read',
    'comparecientes.read', 'notarias.read', 'agenda.read',
    'reportes.read', 'ia.read', 'cumplimiento.read',
    'ai.use', 'ai.expedientes.read', 'ai.comparecientes.read', 'ai.documentos.read',
    'ai.agenda.read', 'ai.cumplimiento.read', 'ai.work.read', 'ai.search', 'ai.navigate',
  ],
};

export const permissionsForRole = (role: Role): Permission[] => [...ROLE_PERMISSIONS[role]];
export const roleHasPermission = (role: Role, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission);

export function validatePasswordStrength(password: string): string[] {
  const failures: string[] = [];
  if (password.length < 12) failures.push('Debe tener al menos 12 caracteres.');
  if (password.length > 128) failures.push('No puede superar 128 caracteres.');
  if (!/[a-záéíóúñ]/.test(password)) failures.push('Debe incluir una letra minúscula.');
  if (!/[A-ZÁÉÍÓÚÑ]/.test(password)) failures.push('Debe incluir una letra mayúscula.');
  if (!/\d/.test(password)) failures.push('Debe incluir un número.');
  if (!/[^\p{L}\p{N}\s]/u.test(password)) failures.push('Debe incluir un símbolo.');
  return failures;
}
