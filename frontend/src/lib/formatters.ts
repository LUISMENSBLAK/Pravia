export const ROLE_LABELS = {
  DIRECCION: 'Dirección',
  ADMINISTRACION: 'Administración',
  ABOGADO: 'Abogado',
  RECEPCION: 'Recepción',
  GESTORIA: 'Gestoría',
  CONSULTA: 'Consulta',
} as const;

export function humanizeRole(role?: string | null) {
  if (!role) return 'Sin rol';
  const known = ROLE_LABELS[role as keyof typeof ROLE_LABELS];
  if (known) return known;
  return role.toLocaleLowerCase('es-MX').replaceAll('_', ' ').replace(/^./, (letter) => letter.toLocaleUpperCase('es-MX'));
}
