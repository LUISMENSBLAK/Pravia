export const NOTARIA_WEEK_DAYS = [
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
] as const;

export type NotariaWeekDay = typeof NOTARIA_WEEK_DAYS[number];
export type NotariaDaySchedule = { cerrado: true } | { cerrado: false; apertura: string; cierre: string };
export type NotariaWeeklySchedule = Partial<Record<NotariaWeekDay, NotariaDaySchedule>>;

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const optionalEstimatedDays = (value: unknown, field: string): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    throw new Error(`${field} debe ser un número entero entre 1 y 365 días.`);
  }
  return parsed;
};

export const normalizeWeeklySchedule = (value: unknown): NotariaWeeklySchedule | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('El horario semanal no tiene un formato válido.');
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((day) => !NOTARIA_WEEK_DAYS.includes(day as NotariaWeekDay))) {
    throw new Error('El horario semanal contiene un día no válido.');
  }
  const result: NotariaWeeklySchedule = {};
  for (const day of NOTARIA_WEEK_DAYS) {
    const raw = source[day];
    if (raw === undefined) continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`El horario de ${day} no es válido.`);
    const entry = raw as Record<string, unknown>;
    if (entry.cerrado === true) {
      result[day] = { cerrado: true };
      continue;
    }
    const apertura = String(entry.apertura ?? '');
    const cierre = String(entry.cierre ?? '');
    if (entry.cerrado !== false || !timePattern.test(apertura) || !timePattern.test(cierre) || apertura >= cierre) {
      throw new Error(`El horario de ${day} debe incluir una apertura y cierre válidos.`);
    }
    result[day] = { cerrado: false, apertura, cierre };
  }
  return result;
};
