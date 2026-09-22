export type OperationalActivitySnapshot = {
  id: string;
  estado: string;
  etapa_orden_snapshot: number;
  orden_operativo: number;
  created_at: Date;
  actividad_nombre_snapshot: string;
  etapa_nombre_snapshot: string;
};

export type OperationalDependencySnapshot = {
  actividad_id: string;
  depende_actividad_id: string;
  bloqueante: boolean;
};

const terminalStates = new Set(['COMPLETADO', 'NO_APLICA']);
const explicitlyCurrentStates = new Set(['EN_PROCESO', 'EN_ESPERA_EXTERNA']);

/** Resolves the displayed activity from the persisted Seguimiento copy. */
export function resolveCurrentOperationalActivity<T extends OperationalActivitySnapshot>(
  activities: T[],
  dependencies: OperationalDependencySnapshot[],
) {
  const ordered = [...activities].sort((left, right) =>
    left.etapa_orden_snapshot - right.etapa_orden_snapshot
    || left.orden_operativo - right.orden_operativo
    || left.created_at.getTime() - right.created_at.getTime()
    || left.id.localeCompare(right.id));
  const states = new Map(ordered.map((item) => [item.id, item.estado]));
  const dependenciesByActivity = new Map<string, OperationalDependencySnapshot[]>();
  dependencies.filter((item) => item.bloqueante).forEach((item) => {
    dependenciesByActivity.set(item.actividad_id, [...(dependenciesByActivity.get(item.actividad_id) || []), item]);
  });
  const actionable = ordered.filter((item) =>
    !terminalStates.has(item.estado)
    && (dependenciesByActivity.get(item.id) || []).every((dependency) => terminalStates.has(states.get(dependency.depende_actividad_id) || '')));
  return actionable.find((item) => explicitlyCurrentStates.has(item.estado)) || actionable[0] || null;
}
