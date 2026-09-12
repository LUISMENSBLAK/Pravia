import { Prisma } from '@prisma/client';
import { CatalogConfigurationError } from './configurationCatalogError';

export const inheritableActivityAttributes = [
  'nombre', 'descripcion', 'naturaleza', 'duracion_estimada', 'unidad_tiempo', 'tipo_dias',
  'margen_seguridad', 'responsable_rol', 'responsable_usuario_id', 'aplica_por_defecto',
  'fuente_tiempo', 'condicion_json',
] as const;
export type InheritableActivityAttribute = typeof inheritableActivityAttributes[number];

const conditionFields = new Set(['acto.codigo', 'acto.familia', 'institucion.id', 'institucion.tipo', 'inmueble.tipo', 'expediente.tiene_credito', 'expediente.vulnerable']);
const conditionOperators = new Set(['eq', 'neq', 'in', 'not_in', 'exists', 'and', 'or', 'not']);
export function validateDeclarativeCondition(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || !node || typeof node !== 'object' || Array.isArray(node)) throw new CatalogConfigurationError(400, 'CFG_CONDITION_INVALID', 'La condición declarativa no es válida.');
    const item = node as Record<string, unknown>; const operator = String(item.op || '');
    if (!conditionOperators.has(operator)) throw new CatalogConfigurationError(400, 'CFG_CONDITION_OPERATOR_INVALID', 'La condición usa un operador no permitido.');
    if (['and', 'or'].includes(operator)) { if (!Array.isArray(item.rules) || !item.rules.length) throw new CatalogConfigurationError(400, 'CFG_CONDITION_RULES_REQUIRED', 'La condición compuesta requiere reglas.'); item.rules.forEach((child) => visit(child, depth + 1)); return; }
    if (operator === 'not') { visit(item.rule, depth + 1); return; }
    if (!conditionFields.has(String(item.field || ''))) throw new CatalogConfigurationError(400, 'CFG_CONDITION_FIELD_INVALID', 'La condición usa un campo no permitido.');
    if (operator !== 'exists' && item.value === undefined) throw new CatalogConfigurationError(400, 'CFG_CONDITION_VALUE_REQUIRED', 'La condición requiere un valor.');
  };
  visit(value, 0); return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function resolveInheritedActivity(activity: any, master: any | null): any {
  const inherited = new Set<InheritableActivityAttribute>(Array.isArray(activity.atributos_heredados) ? activity.atributos_heredados : []);
  const effective: Record<string, unknown> = { ...activity };
  if (master) for (const attribute of inheritableActivityAttributes) if (inherited.has(attribute)) effective[attribute] = master[attribute];
  return { ...effective, concepto_maestro: master, inheritance: Object.fromEntries(inheritableActivityAttributes.map((attribute) => [attribute, inherited.has(attribute) ? 'HEREDADO' : 'OVERRIDE'])) };
}

const conditionValue = (context: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((value, key) => (
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined
), context);

/** Evaluates only the closed declarative condition language accepted above. */
export function evaluateDeclarativeCondition(value: unknown, context: Record<string, unknown>): boolean {
  if (value === undefined || value === null) return true;
  validateDeclarativeCondition(value);
  const evaluate = (node: Record<string, unknown>): boolean => {
    const operator = String(node.op);
    if (operator === 'and') return (node.rules as Record<string, unknown>[]).every(evaluate);
    if (operator === 'or') return (node.rules as Record<string, unknown>[]).some(evaluate);
    if (operator === 'not') return !evaluate(node.rule as Record<string, unknown>);
    const actual = conditionValue(context, String(node.field));
    const actualValues = Array.isArray(actual) ? actual : [actual];
    if (operator === 'exists') return actualValues.some((item) => item !== undefined && item !== null && item !== '');
    const expectedValues = Array.isArray(node.value) ? node.value : [node.value];
    if (operator === 'eq') return actualValues.some((item) => expectedValues.some((expected) => item === expected));
    if (operator === 'neq') return actualValues.every((item) => expectedValues.every((expected) => item !== expected));
    if (operator === 'in') return actualValues.some((item) => expectedValues.includes(item));
    if (operator === 'not_in') return actualValues.every((item) => !expectedValues.includes(item));
    return false;
  };
  return evaluate(value as Record<string, unknown>);
}
