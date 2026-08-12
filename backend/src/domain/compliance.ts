export class ComplianceError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

const amount = (value: unknown) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ComplianceError('Los montos deben ser números no negativos.', 'COMPLIANCE_AMOUNT_INVALID');
  return parsed;
};

export function evaluateUif(parameters: any, answers: Record<string, unknown>) {
  const ruleKey = String(answers.tipo_acto_uif || '');
  const rule = parameters?.reglas?.[ruleKey];
  if (!rule) throw new ComplianceError('Selecciona un supuesto UIF configurado.', 'UIF_RULE_REQUIRED');
  const uma = amount(parameters?.uma?.valor_diario_mxn);
  if (!uma) throw new ComplianceError('La versión de reglas no contiene una UMA válida.', 'UIF_UMA_INVALID');

  const base = rule.base === 'MAYOR_PRECIO_CATASTRAL_COMERCIAL_GARANTIZADO'
    ? Math.max(amount(answers.precio_pactado), amount(answers.valor_catastral), amount(answers.valor_comercial), amount(answers.monto_garantizado))
    : amount(answers.monto_operacion || answers.precio_pactado);
  const related = amount(answers.operaciones_relacionadas_seis_meses);
  const accumulated = base + related;
  const threshold = rule.aviso_siempre ? 0 : uma * amount(rule.umbral_uma);
  const requiresNotice = Boolean(rule.aviso_siempre) || accumulated >= threshold;
  const missing = [
    ['identidad_verificada', 'Identidad oficial'],
    ['beneficiario_controlador_identificado', 'Beneficiario controlador o declaración'],
    ['actividad_ocupacion_acreditada', 'Actividad u ocupación'],
    ['origen_recursos_documentado', 'Origen de recursos'],
    ['pep_declarada', 'Declaración PEP'],
  ].filter(([key]) => answers[key] === undefined || answers[key] === null || answers[key] === '').map(([, label]) => label);
  const alerts = [
    answers.identidad_verificada === false ? 'Falta verificar identidad con documento oficial.' : null,
    answers.beneficiario_controlador_identificado === false ? 'Falta identificar beneficiario controlador o recabar la declaración aplicable.' : null,
    answers.origen_recursos_documentado === false ? 'Falta documentar el origen de recursos.' : null,
    String(answers.pep_declarada || '').toUpperCase() === 'SI' ? 'La condición PEP requiere revisión reforzada conforme a la política vigente.' : null,
  ].filter(Boolean);

  return {
    tipo: 'UIF',
    clasificacion: missing.length ? 'INCOMPLETO' : requiresNotice ? 'REQUIERE_AVISO' : 'SIN_AVISO_POR_UMBRAL',
    requiere_aviso: requiresNotice,
    acto: ruleKey,
    fundamento: rule.fundamento,
    monto_base_mxn: Number(base.toFixed(2)),
    acumulado_seis_meses_mxn: Number(accumulated.toFixed(2)),
    uma_diaria_mxn: uma,
    umbral_uma: rule.aviso_siempre ? null : rule.umbral_uma,
    umbral_mxn: rule.aviso_siempre ? null : Number(threshold.toFixed(2)),
    faltantes: missing,
    alertas: alerts,
    requiere_revision_humana: true,
    disclaimer: 'Resultado de apoyo operativo; no sustituye la determinación del sujeto obligado ni la revisión jurídica.',
  };
}

export function assessIsrCompleteness(parameters: any, answers: Record<string, unknown>) {
  const required = Array.isArray(parameters?.campos_minimos) ? parameters.campos_minimos : [];
  const missing = required.filter((key: string) => answers[key] === undefined || answers[key] === null || String(answers[key]).trim() === '');
  return {
    tipo: 'ISR',
    clasificacion: missing.length ? 'INSUMOS_INCOMPLETOS' : 'LISTO_PARA_REVISION_FISCAL',
    motor_estado: 'NO_CALCULADO',
    campos_requeridos: required.length,
    campos_completos: required.length - missing.length,
    faltantes: missing,
    requiere_revision_humana: true,
    disclaimer: 'PRAVIA no calcula ni dictamina ISR con esta versión. La información debe revisarse con el especialista fiscal y la norma vigente.',
  };
}
