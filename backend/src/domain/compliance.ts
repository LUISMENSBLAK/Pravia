export class ComplianceError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

const amount = (value: unknown) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ComplianceError('Los montos deben ser números no negativos.', 'COMPLIANCE_AMOUNT_INVALID');
  return parsed;
};

function evaluateLegacyUif(parameters: any, answers: Record<string, unknown>) {
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
    answers.identidad_verificada === false ? { codigo: 'ID-01', mensaje: 'Falta verificar identidad con documento oficial.', regla: rule.fundamento, dato: 'identidad_verificada = no', fuente: 'Snapshot de comparecientes y respuesta humana', accion: 'Revisar identificación y vincular evidencia.' } : null,
    answers.beneficiario_controlador_identificado === false ? { codigo: 'BC-04', mensaje: 'Falta confirmar beneficiario controlador o recabar la declaración aplicable.', regla: rule.fundamento, dato: 'beneficiario_controlador_identificado = no', fuente: 'Respuesta de la revisión; no existe maestro independiente', accion: 'Completar la declaración y adjuntar evidencia.' } : null,
    answers.origen_recursos_documentado === false ? { codigo: 'OR-02', mensaje: 'Falta documentar el origen de recursos.', regla: rule.fundamento, dato: 'origen_recursos_documentado = no', fuente: 'Respuesta y evidencia de la revisión', accion: 'Solicitar o vincular soporte de origen de recursos.' } : null,
    String(answers.pep_declarada || '').toUpperCase() === 'SI' ? { codigo: 'PEP-01', mensaje: 'La declaración PEP requiere revisión reforzada conforme a la política vigente.', regla: 'Declaración PEP de la revisión', dato: 'pep_declarada = sí', fuente: 'Master/snapshot o confirmación humana; sin screening externo', accion: 'Realizar revisión humana reforzada.' } : null,
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

export function evaluateUif(parameters: any, answers: Record<string, unknown>, context: { operationDate?: Date | string; relatedOperations?: any[] } = {}) {
  const ruleKey = String(answers.tipo_acto_uif || '') as VulnerableActivityKey;
  if (!(ruleKey in NOTARIAL_RULES)) return evaluateLegacyUif(parameters, answers);
  const operationDateSource = context.operationDate || answers.fecha_operacion_juridica || new Date();
  const operationDate = operationDateSource instanceof Date ? new Date(operationDateSource) : new Date(String(operationDateSource));
  if (Number.isNaN(operationDate.getTime())) throw new ComplianceError('La fecha jurídica de la operación no es válida.', 'COMPLIANCE_DATE_INVALID');
  const uma = parameters?.uma;
  const umaCatalog: UmaReference[] = Array.isArray(parameters?.uma_catalog)
    ? parameters.uma_catalog
    : [{
        year: Number(String(uma?.vigencia_desde || operationDate.toISOString()).slice(0, 4)),
        dailyValueMxn: Number(uma?.valor_diario_mxn),
        effectiveFrom: String(uma?.vigencia_desde || `${operationDate.getUTCFullYear()}-01-01`),
        effectiveTo: uma?.vigencia_hasta || null,
        sourceUrl: String(uma?.fuente || ''),
      }];
  const activity = evaluateVulnerableActivity({
    activity: ruleKey,
    operationDate: operationDate.toISOString().slice(0, 10),
    clientId: String(answers.cliente_compareciente_id || ''),
    priceMxn: answers.precio_pactado as number,
    cadastralValueMxn: answers.valor_catastral as number,
    commercialValueMxn: answers.valor_comercial as number,
    securedPrincipalMxn: answers.monto_garantizado as number,
    operationAmountMxn: (answers.monto_operacion || answers.precio_pactado) as number,
    relatedOperations: context.relatedOperations || [],
  }, umaCatalog);
  const payments = (Array.isArray(answers.formas_pago) ? answers.formas_pago : []) as PaymentEntry[];
  const cashRestriction = ruleKey === 'TRANSMISION_DERECHOS_REALES_INMUEBLES'
    ? evaluateRealEstateCashRestriction({ operationValueMxn: activity.amountConsideredMxn, payments }, umaCatalog)
    : { status: 'NO_EVALUADO', cashDetectedMxn: 0, thresholdUma: null, thresholdMxn: null, excessMxn: 0, legalBasis: 'LFPIORPI, artículo 32', explanation: 'El supuesto no usa la regla inmobiliaria configurada del artículo 32, fracción I.' };
  const pepStatus = String(answers.pep_estado || answers.pep_declarada || 'NO_EVALUADO').toUpperCase();
  const beneficialOwnerStatus = String(answers.beneficiario_controlador_estado || (answers.beneficiario_controlador_identificado === true ? 'EXISTE' : answers.beneficiario_controlador_identificado === false ? 'NO_DECLARADO' : 'PENDIENTE_DE_CONFIRMAR'));
  const missing = [
    ['identidad_verificada', 'Identidad oficial'],
    ['actividad_ocupacion_acreditada', 'Actividad u ocupación'],
    ['origen_recursos_documentado', 'Origen de recursos'],
  ].filter(([key]) => answers[key] === undefined || answers[key] === null || answers[key] === '').map(([, label]) => label);
  if (activity.noticeRequired === 'INDETERMINADA') missing.push('Importe jurídico para determinar Aviso');
  if (beneficialOwnerStatus === 'PENDIENTE_DE_CONFIRMAR' || beneficialOwnerStatus === 'NO_DECLARADO') missing.push('Beneficiario controlador o declaración');
  if (pepStatus === 'NO_EVALUADO' || pepStatus === 'PENDIENTE' || pepStatus === 'INFORMACION_INSUFICIENTE') missing.push('Revisión PEP');
  const risk = evaluateInternalRisk({
    incompleteInformation: missing.length > 0,
    beneficialOwnerUndetermined: ['PENDIENTE_DE_CONFIRMAR', 'NO_DECLARADO', 'INFORMACION_INSUFICIENTE'].includes(beneficialOwnerStatus),
    pepConfirmedByHuman: pepStatus === 'CONFIRMADO_POR_REVISION',
    documentaryContradiction: answers.contradiccion_documental === true,
    complexStructureDocumented: answers.estructura_compleja_documentada === true,
    relatedOperations: activity.includedOperations.length > 0,
  });
  const alerts = [
    missing.length ? { codigo: 'INFO-01', mensaje: 'La evaluación requiere información o confirmación adicional.', regla: activity.legalBasis, dato: missing.join(', '), fuente: 'Checklist y snapshots de la revisión', accion: 'Completar los datos y vincular evidencia.' } : null,
    cashRestriction.status === 'REQUIERE_REVISION' ? { codigo: 'CASH-32', mensaje: 'La forma de pago requiere revisión frente a la restricción independiente de efectivo.', regla: cashRestriction.legalBasis, dato: `${cashRestriction.cashDetectedMxn} MXN detectados`, fuente: 'Formas de pago registradas', accion: 'Verificar evidencia y forma de liquidación antes de formalizar.' } : null,
    pepStatus === 'POSIBLE_COINCIDENCIA' ? { codigo: 'PEP-REVIEW', mensaje: 'Existe una posible coincidencia que no equivale a PEP confirmada.', regla: 'Reglamento LFPIORPI, artículos 45 Bis a 45 Quinquies', dato: 'POSIBLE_COINCIDENCIA', fuente: 'Revisión pendiente; consulta oficial no configurada', accion: 'Completar revisión humana con evidencia oficial.' } : null,
  ].filter(Boolean);
  const evaluationStatus = missing.length ? 'INFORMACION_INCOMPLETA' : alerts.length || ['ALTO', 'REQUIERE_REVISION'].includes(risk.level) ? 'REQUIERE_REVISION' : 'EVALUADO';
  return {
    tipo: 'UIF',
    clasificacion: activity.noticeRequired === 'SI' ? 'REQUIERE_AVISO' : activity.noticeRequired === 'NO' ? 'SIN_AVISO_POR_UMBRAL' : 'INCOMPLETO',
    estado_evaluacion: evaluationStatus,
    estado_aviso: activity.noticeStatus,
    requiere_aviso: activity.noticeRequired === 'SI',
    actividad_vulnerable: activity.activityVulnerable,
    identificacion_requerida: activity.identificationRequired,
    acto: ruleKey,
    fundamento: activity.legalBasis,
    monto_base_mxn: activity.amountConsideredMxn,
    acumulado_seis_meses_mxn: activity.accumulatedAmountMxn,
    operaciones_acumuladas: activity.includedOperations,
    uma: activity.uma,
    uma_diaria_mxn: activity.uma.dailyValueMxn,
    umbral_uma: activity.noticeThresholdUma,
    umbral_mxn: activity.noticeThresholdMxn,
    canal_aviso: activity.channel,
    fecha_limite_aviso: activity.noticeRequired === 'SI' ? ordinaryNoticeDeadline(operationDate.toISOString().slice(0, 10)).toISOString() : null,
    restriccion_efectivo: cashRestriction,
    evaluacion_riesgo: risk,
    pep_estado: pepStatus === 'PENDIENTE' ? 'NO_EVALUADO' : pepStatus,
    pep_consulta_oficial: 'NO_CONFIGURADA',
    beneficiario_controlador_estado: beneficialOwnerStatus,
    faltantes: missing,
    alertas: alerts,
    version_normativa: activity.ruleVersion,
    estatus_normativo: activity.ruleStatus,
    requiere_revision_humana: true,
    disclaimer: 'Clasificación interna de cumplimiento. No constituye una determinación de ilicitud ni sustituye el criterio del sujeto obligado.',
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
import {
  evaluateInternalRisk,
  evaluateRealEstateCashRestriction,
  evaluateVulnerableActivity,
  NOTARIAL_RULES,
  ordinaryNoticeDeadline,
  type PaymentEntry,
  type UmaReference,
  type VulnerableActivityKey,
} from './uifCompliance';
