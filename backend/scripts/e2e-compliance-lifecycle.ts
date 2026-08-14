import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';

const base = (process.env.E2E_API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
if (process.env.E2E_ALLOW_MUTATIONS !== 'isolated-database-confirmed' || !['localhost', '127.0.0.1', '::1'].includes(new URL(base).hostname)) {
  throw new Error('Compliance E2E solo se permite en localhost con confirmación de base aislada.');
}

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const email = `e2e-compliance-${suffix}@example.invalid`;
const password = `Pravia!Compliance-${suffix}-Q7`;
let token = '';
const checks: string[] = [];

async function api(path: string, init: RequestInit = {}, expected = 200) {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const body: any = await response.json().catch(() => ({}));
  if (response.status !== expected) throw new Error(`${init.method || 'GET'} ${path}: ${response.status} ${body.code || body.error || ''}`);
  if (!response.headers.get('x-correlation-id')) throw new Error(`${path} no devolvió correlation-id.`);
  return body;
}
const post = (path: string, body: unknown, expected = 200) => api(path, { method: 'POST', body: JSON.stringify(body) }, expected);
const patch = (path: string, body: unknown) => api(path, { method: 'PATCH', body: JSON.stringify(body) });

async function main() {
  const user = await prisma.user.create({ data: {
    email, password_hash: await bcrypt.hash(password, 12), nombre: 'E2E Compliance', apellido: suffix,
    rol: 'DIRECCION', activo: true, requires_password_change: false, password_changed_at: new Date(),
  } });
  const login = await post('/auth/login', { email, password });
  token = login.access_token;
  if (!token) throw new Error('Login sintético no emitió access token.');

  const [tipo, notaria, caracter, sourceUif, sourceIsr] = await Promise.all([
    prisma.tipoActo.findFirstOrThrow({ where: { activo: true } }),
    prisma.notaria.findFirstOrThrow({ where: { activa: true, archived_at: null } }),
    prisma.caracterCompareciente.findFirstOrThrow({ where: { activo: true } }),
    prisma.complianceRuleSet.findFirstOrThrow({ where: { tipo: 'UIF', estatus: { in: ['REFERENCIA_VERIFICADA', 'APROBADA'] } } }),
    prisma.complianceRuleSet.findFirstOrThrow({ where: { tipo: 'ISR', estatus: { in: ['PREPARADO_SIN_CALCULO', 'APROBADA'] } } }),
  ]);
  const now = new Date();
  const [uifRule, isrRule] = await Promise.all([
    prisma.complianceRuleSet.create({ data: {
      tipo: 'UIF', clave: `E2E_UIF_${suffix}`, version: `E2E-${suffix}`, nombre: 'UIF E2E versionado',
      estatus: 'REFERENCIA_VERIFICADA', vigencia_desde: new Date(now.getTime() - 86400000),
      fuente_nombre: sourceUif.fuente_nombre, fuente_url: sourceUif.fuente_url,
      parametros: sourceUif.parametros as Prisma.InputJsonValue, cuestionario: sourceUif.cuestionario as Prisma.InputJsonValue,
      notas: 'RuleSet sintético staging; no representa presentación real.', creado_por_id: user.id,
      aprobado_por_id: user.id, aprobado_at: now,
    } }),
    prisma.complianceRuleSet.create({ data: {
      tipo: 'ISR', clave: `E2E_ISR_${suffix}`, version: `E2E-${suffix}`, nombre: 'ISR E2E versionado',
      estatus: 'PREPARADO_SIN_CALCULO', vigencia_desde: new Date(now.getTime() - 86400000),
      fuente_nombre: sourceIsr.fuente_nombre, fuente_url: sourceIsr.fuente_url,
      parametros: sourceIsr.parametros as Prisma.InputJsonValue, cuestionario: sourceIsr.cuestionario as Prisma.InputJsonValue,
      notas: 'RuleSet sintético staging; diagnóstico de completitud sin cálculo.', creado_por_id: user.id,
    } }),
  ]);
  checks.push('rulesets:UIF-ISR-creados-y-separados');

  const expediente = await post('/expedientes', {
    tipo_acto_id: tipo.id, notaria_id: notaria.id, abogado_id: user.id,
    cliente_alias: `E2E Compliance ${suffix}`, descripcion: 'Expediente sintético de cumplimiento', valor_operacion: 2_000_000,
  }, 201);
  const person = await post('/comparecientes/persona-fisica', {
    nombre: `PEP Presidente Sintético ${suffix}`, apellido_paterno: 'PRUEBA',
    ocupacion: 'Senador sintético', nacionalidad: 'Mexicana', pep_estado: 'PENDIENTE',
  }, 201);
  const comparecienteId = person.data?.compareciente?.id || person.data?.id;
  const link = await post('/comparecientes/vincular-expediente', {
    expediente_id: expediente.id, compareciente_id: comparecienteId, caracter_id: caracter.id,
  });
  await patch(`/comparecientes/vincular-expediente/${link.data.id}/validacion`, { datos_validados: true });
  checks.push('master:compareciente-expediente-creados');

  const review = await post('/cumplimiento/revisiones', {
    expediente_id: expediente.id, tipo: 'UIF', rule_set_id: uifRule.id, fecha_operacion: now.toISOString(),
    cuestionario: {
      tipo_acto_uif: 'TRANSMISION_DERECHOS_REALES_INMUEBLES', precio_pactado: 2_000_000,
      valor_catastral: 1_500_000, valor_comercial: 1_800_000, monto_garantizado: 0,
      operaciones_relacionadas_seis_meses: 0, identidad_verificada: true,
      beneficiario_controlador_identificado: true, actividad_ocupacion_acreditada: true,
      origen_recursos_documentado: true,
    },
  }, 201);
  const reviewId = review.revision.id;
  if (review.revision.cuestionario_json.pep_declarada === 'SI') throw new Error('PEP fue inferido por nombre/profesión.');
  checks.push('pep:no-inferido-por-nombre-profesion');

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const form = new FormData();
  form.set('file', new Blob([pdf], { type: 'application/pdf' }), `compliance-${suffix}.pdf`);
  form.set('categoria', 'PROYECTO');
  form.set('carpeta', 'Administrativo');
  const uploaded = await api(`/expedientes/${expediente.id}/documentos`, { method: 'POST', body: form }, 201);
  await post(`/cumplimiento/revisiones/${reviewId}/evidencias`, {
    documento_id: uploaded.documento.id, tipo_evidencia: 'SOPORTE_UIF', observaciones: 'Evidencia sintética local.',
  }, 201);
  const evaluated = await post(`/cumplimiento/revisiones/${reviewId}/evaluar`, { cuestionario: { pep_declarada: 'NO' } });
  if (!evaluated.revision.resultado_json?.requiere_revision_humana) throw new Error('UIF no dejó revisión humana requerida.');
  const confirmed = await post(`/cumplimiento/revisiones/${reviewId}/revisar`, { decision: 'CONFIRMAR', observaciones: 'Decisión humana E2E.' });
  const frozen = JSON.stringify(confirmed.revision.master_snapshot);
  checks.push('review:evidencia-evaluacion-decision-snapshot');

  const before = await api(`/expedientes/${expediente.id}`);
  await patch(`/expedientes/${expediente.id}`, { version: before.version, cliente_alias: `Master cambiado ${suffix}` });
  const detail = await api(`/cumplimiento/revisiones/${reviewId}`);
  if (JSON.stringify(detail.revision.master_snapshot) !== frozen || detail.revision.master_data_changed !== true) {
    throw new Error('El snapshot histórico cambió o no detectó el master modificado.');
  }
  const reevaluation = await post(`/cumplimiento/revisiones/${reviewId}/reevaluar`, { conservar_respuestas: true }, 201);
  if (reevaluation.revision.supersedes_review_id !== reviewId || reevaluation.revision.supersedes?.id !== reviewId) {
    throw new Error('La reevaluación no preservó lineage supersedes.');
  }
  checks.push('snapshot:inmutable-y-reevaluacion-lineage');

  const isr = await post('/cumplimiento/revisiones', {
    expediente_id: expediente.id, tipo: 'ISR', rule_set_id: isrRule.id, fecha_operacion: now.toISOString(), cuestionario: {},
  }, 201);
  const isrEvaluated = await post(`/cumplimiento/revisiones/${isr.revision.id}/evaluar`, { cuestionario: {} });
  if (isrEvaluated.revision.resultado_json?.tipo !== 'ISR'
    || isrEvaluated.revision.resultado_json?.motor_estado !== 'NO_CALCULADO'
    || 'requiere_aviso' in isrEvaluated.revision.resultado_json) {
    throw new Error('UIF e ISR no permanecieron semánticamente separados.');
  }
  checks.push('uif-isr:separados-sin-afirmar-presentacion');

  console.log(JSON.stringify({ ok: true, environment: 'local-staging-s2', checks, ids: {
    expediente: expediente.id, compareciente: comparecienteId, uif_rule: uifRule.id, isr_rule: isrRule.id,
    review: reviewId, reevaluation: reevaluation.revision.id,
  } }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, checks, error: error.message }, null, 2));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
