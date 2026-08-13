import 'dotenv/config';
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const base = (process.env.E2E_API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
let email = process.env.PRAVIA_E2E_EMAIL || '';
let password = process.env.PRAVIA_E2E_PASSWORD || '';
const allowed = process.env.E2E_ALLOW_MUTATIONS === 'isolated-database-confirmed';
const targetKind = process.env.E2E_TARGET_KIND || 'local';
const syntheticIdentity = process.env.E2E_CREATE_SYNTHETIC_USER === 'true';

if ((!email || !password) && !syntheticIdentity) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: 'Faltan PRAVIA_E2E_EMAIL/PRAVIA_E2E_PASSWORD; no se creó ni restableció ninguna cuenta.' }, null, 2));
  process.exit(0);
}
if (!allowed) throw new Error('E2E_ALLOW_MUTATIONS=isolated-database-confirmed es obligatorio. Esta prueba crea datos.');
const hostname = new URL(base).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(hostname) && targetKind !== 'ephemeral-branch') {
  throw new Error('Las mutaciones E2E solo se permiten en localhost o con E2E_TARGET_KIND=ephemeral-branch.');
}

const created: Record<string, string> = {};
const steps: string[] = [];
let accessToken = '';
const prisma = new PrismaClient();

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${init.method || 'GET'} ${path} → ${response.status} ${body.code || ''} ${body.error || body.mensaje || ''}`);
    (error as any).body = body;
    throw error;
  }
  if (response.status >= 400 || !response.headers.get('x-correlation-id')) {
    throw new Error(`${path} no respetó el contrato HTTP/correlation-id.`);
  }
  return body;
}

const post = (path: string, body: unknown) => request(path, { method: 'POST', body: JSON.stringify(body) });
const patch = (path: string, body: unknown) => request(path, { method: 'PATCH', body: JSON.stringify(body) });
const put = (path: string, body: unknown) => request(path, { method: 'PUT', body: JSON.stringify(body) });

async function transition(expedienteId: string, next: string, extra: Record<string, unknown> = {}) {
  const current = await request(`/expedientes/${expedienteId}`);
  const result = await post(`/expedientes/${expedienteId}/transicion-estatus`, {
    expected_version: current.version,
    nuevo_estatus: next,
    notas: next === 'ENTREGADO' ? 'Entrega E2E a persona sintética con evidencia en entorno aislado.' : `Transición E2E a ${next}`,
    ...extra,
  });
  const expediente = result.expediente || result;
  if (expediente.estatus !== next) throw new Error(`La transición no persistió ${next}.`);
  steps.push(`expediente:${next}`);
  return expediente;
}

async function runOptionalPaidAI(expedienteId: string) {
  if (process.env.E2E_RUN_PAID_AI !== 'true') return { executed: false, reason: 'La corrida pagada requiere E2E_RUN_PAID_AI=true.' };
  const fixturePath = process.env.E2E_AI_FIXTURE_PATH;
  if (!fixturePath) throw new Error('E2E_AI_FIXTURE_PATH es obligatorio para la corrida IA autorizada.');
  const session = await post('/comparecientes/altas', {
    tipo_persona: 'FISICA',
    origen_expediente_id: expedienteId,
    idempotency_key: `e2e-ai-${Date.now()}`,
  });
  const sessionId = session.session.id;
  const form = new FormData();
  form.set('archivo', new Blob([readFileSync(fixturePath)], { type: 'application/pdf' }), basename(fixturePath));
  form.set('tipo_documento', 'INE');
  const uploaded = await request(`/comparecientes/altas/${sessionId}/documentos`, { method: 'POST', body: form });
  const extraction = await post(`/comparecientes/altas/${sessionId}/extraer-ia`, { documentos: [uploaded.documento.id] });
  if (!extraction.propuesta || !extraction.borrador_actualizado) throw new Error('La IA no devolvió una propuesta trazable.');
  if (Object.values(extraction.propuesta).some((item: any) => !item.fuente || (!item.documento_id && item.estado !== 'DERIVADO'))) {
    throw new Error('La propuesta IA contiene campos sin fuente o documento.');
  }
  const overrides = process.env.E2E_AI_CONFIRM_OVERRIDES ? JSON.parse(process.env.E2E_AI_CONFIRM_OVERRIDES) : {};
  const confirmed = await post(`/comparecientes/altas/${sessionId}/confirmar`, {
    ...extraction.borrador_actualizado,
    ...overrides,
    documentos_integrar: [uploaded.documento.id],
  });
  if (!confirmed.compareciente?.id && !confirmed.id) throw new Error('La confirmación humana IA no creó el compareciente.');
  steps.push('ia:propuesta-confirmacion');
  return { executed: true, model: extraction.resultado?.modelo };
}

async function main() {
  if (syntheticIdentity) {
    if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) throw new Error('La identidad sintética E2E solo puede crearse en localhost.');
    const identitySuffix = randomUUID().slice(0, 8);
    email = `e2e-critical-${identitySuffix}@example.invalid`;
    password = `Pravia!Critical-${identitySuffix}-Q7`;
    await prisma.user.create({ data: {
      email,
      password_hash: await bcrypt.hash(password, 12),
      nombre: 'E2E Dirección',
      apellido: identitySuffix,
      rol: 'DIRECCION',
      activo: true,
      requires_password_change: false,
      password_changed_at: new Date(),
    } });
  }
  const login = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  accessToken = login.access_token;
  if (!accessToken || login.user?.requires_password_change) throw new Error('La cuenta E2E debe estar activa y con contraseña definitiva.');
  if (!['DIRECCION', 'ADMINISTRACION'].includes(login.user.rol)) throw new Error('La cuenta E2E requiere rol DIRECCION o ADMINISTRACION.');
  steps.push('auth:login');

  const [tipos, notarias, catalogos] = await Promise.all([
    request('/expedientes/tipos-acto'),
    request('/notarias?activa=true'),
    request('/comparecientes/catalogos'),
  ]);
  const tipo = tipos[0];
  const notaria = notarias[0];
  const caracter = catalogos.data?.caracteresCompareciente?.[0];
  if (!tipo || !notaria || !caracter) throw new Error('El entorno aislado requiere tipo de acto, notaría y carácter activos.');

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const prospecto = await post('/prospectos', {
    nombre: `E2E Prospecto ${suffix}`,
    email: `e2e-${suffix}@example.invalid`,
    prioridad: 'MEDIA',
    estado: 'NUEVO',
    tipo_acto: tipo.nombre,
  });
  created.prospecto = prospecto.id;
  steps.push('prospecto:creado');

  const quote = await post('/cotizaciones', { prospecto_id: prospecto.id, notaria_id: notaria.id });
  created.cotizacion = quote.id;
  steps.push('prospecto:cotizacion');
  for (const estado of ['ENVIADA_NOTARIA', 'PRESUPUESTO_RECIBIDO', 'EN_REVISION_ABOGADO']) {
    await put(`/cotizaciones/${quote.id}/estado`, { estado });
  }
  await post(`/cotizaciones/${quote.id}/versiones`, {
    total_notaria: 10000,
    honorarios_pravia: 2500,
    desglose_notaria: [{ concepto: 'Concepto sintético E2E', monto: 10000 }],
    aprobada: true,
    notas: 'Versión sintética de prueba aislada',
  });
  await put(`/cotizaciones/${quote.id}/estado`, { estado: 'ENVIADA_CLIENTE' });
  await put(`/cotizaciones/${quote.id}/estado`, { estado: 'ACEPTADA' });
  steps.push('cotizacion:aceptada');

  const advance = await post(`/cotizaciones/${quote.id}/anticipo`, { monto: 1000, notas: 'Anticipo E2E' });
  await post(`/cotizaciones/pago/${advance.id}/validar`, {});
  steps.push('anticipo:validado');
  const expediente = await post(`/cotizaciones/${quote.id}/convertir`, { tipo_acto_id: tipo.id, abogado_id: login.user.id });
  created.expediente = expediente.id;
  const repeatedConversion = await post(`/cotizaciones/${quote.id}/convertir`, { tipo_acto_id: tipo.id, abogado_id: login.user.id });
  if (!repeatedConversion.idempotent || repeatedConversion.id !== expediente.id) throw new Error('La conversión no fue idempotente.');
  steps.push('anticipo:expediente-idempotente');

  const secondExpediente = await post('/expedientes', {
    tipo_acto_id: tipo.id,
    abogado_id: login.user.id,
    cliente_alias: `E2E Reutilización ${suffix}`,
    descripcion: 'Segundo expediente sintético para probar reutilización',
  });
  created.segundo_expediente = secondExpediente.id;
  const person = await post('/comparecientes/persona-fisica', {
    nombre: `Persona E2E ${suffix}`,
    apellido_paterno: 'PRUEBA',
    nacionalidad: 'Mexicana',
    pep_estado: 'NO',
  });
  const comparecienteId = person.data?.compareciente?.id || person.data?.id;
  if (!comparecienteId) throw new Error('La creación de persona no devolvió el ID maestro del compareciente.');
  created.compareciente = comparecienteId;
  const firstLink = await post('/comparecientes/vincular-expediente', {
    expediente_id: expediente.id, compareciente_id: comparecienteId, caracter_id: caracter.id,
  });
  await post('/comparecientes/vincular-expediente', {
    expediente_id: secondExpediente.id, compareciente_id: comparecienteId, caracter_id: caracter.id,
  });
  await patch(`/comparecientes/vincular-expediente/${firstLink.data.id}/validacion`, { datos_validados: true });
  steps.push('compareciente:creado-reutilizado-validado');

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const documentForm = new FormData();
  documentForm.set('file', new Blob([pdf], { type: 'application/pdf' }), `evidencia-${suffix}.pdf`);
  documentForm.set('categoria', 'FIRMA');
  documentForm.set('carpeta', 'Administrativo');
  const document = await request(`/expedientes/${expediente.id}/documentos`, { method: 'POST', body: documentForm });
  if (!document.documento?.storage_key) throw new Error('El documento no conservó storage_key.');
  steps.push('documento:subido-privado');

  const requirementState = await request(`/expedientes/${expediente.id}`);
  const mandatoryRequirements = (requirementState.requisitos_docs || []).filter((item: any) => item.obligatorio);
  for (const [index, requirement] of mandatoryRequirements.entries()) {
    const evidence = new FormData();
    evidence.set('file', new Blob([pdf], { type: 'application/pdf' }), `requisito-firma-${index + 1}-${suffix}.pdf`);
    evidence.set('categoria', requirement.categoria);
    evidence.set('carpeta', requirement.categoria === 'FIRMA' ? 'Firma' : 'Administrativo');
    evidence.set('requisito_id', requirement.id);
    const uploaded = await request(`/expedientes/${expediente.id}/documentos`, { method: 'POST', body: evidence });
    if (uploaded.documento?.requisito_id !== requirement.id) throw new Error('El documento no quedó vinculado al requisito de firma.');
    await patch(`/expedientes/${expediente.id}/requisitos/${requirement.id}`, { estatus: 'VALIDADO', observaciones: 'Validación humana sintética E2E en entorno aislado.' });
  }
  steps.push('documentos:obligatorios-vinculados-validados');

  const beforeSave = await request(`/expedientes/${expediente.id}`);
  await patch(`/expedientes/${expediente.id}`, {
    version: beforeSave.version,
    cliente_alias: `E2E Guardado ${suffix}`,
    numero_escritura: `E2E-${suffix}`,
    budget_items: [{ id: 'e2e-rubro', concepto: 'Rubro E2E', monto: 10000 }],
    honorarios_pravia: 2500,
  });
  const afterSave = await request(`/expedientes/${expediente.id}`);
  if (afterSave.cliente_alias !== `E2E Guardado ${suffix}` || Number(afterSave.datos_operacion?.presupuesto?.honorarios_pravia) !== 2500) {
    throw new Error('El guardado integral del expediente no persistió tras recarga.');
  }
  steps.push('expediente:guardado-recargado');

  const movement = await post(`/expedientes/${expediente.id}/movimientos`, {
    tipo_movimiento: 'ABONO', naturaleza: 'INGRESO', categoria: 'HONORARIOS_PRAVIA',
    concepto: `Ingreso E2E ${suffix}`, monto: 500, referencia: `REF-${suffix}`,
  });
  if (!movement.id) throw new Error('El movimiento financiero no fue creado.');
  steps.push('finanzas:movimiento-auditado');

  const ai = await runOptionalPaidAI(expediente.id);

  await transition(expediente.id, 'EN_INTEGRACION');
  await transition(expediente.id, 'EN_PROCESO');
  await transition(expediente.id, 'FIRMA_PROGRAMADA', {
    datos_firma: { fecha_firma: new Date(Date.now() + 86_400_000).toISOString(), lugar: 'Sala E2E', autoriza_saldo_pendiente: true },
  });
  await transition(expediente.id, 'FIRMADO', { fecha_efectiva: new Date().toISOString() });
  await transition(expediente.id, 'POST_FIRMA');
  const postfirmaTask = await post(`/expedientes/${expediente.id}/postfirma/tramites`, {
    tipo: 'REGISTRO_PUBLICO',
    descripcion: 'Inscripción sintética E2E',
    institucion: 'Registro Público QA',
    folio: `RPP-${suffix}`,
    fecha_ingreso: new Date().toISOString(),
    evidencia_documento_id: document.documento.id,
  });
  await patch(`/expedientes/${expediente.id}/postfirma/tramites/${postfirmaTask.id}`, {
    estatus: 'COMPLETADA',
    resultado: 'Inscripción sintética concluida en entorno aislado.',
    evidencia_documento_id: document.documento.id,
  });
  steps.push('postfirma:tramite-concluido-con-evidencia');
  await transition(expediente.id, 'LISTO_ENTREGA');
  const readyForDelivery = await request(`/expedientes/${expediente.id}`);
  const delivery = await post(`/expedientes/${expediente.id}/entrega`, {
    expected_version: readyForDelivery.version,
    receptor_nombre: 'Persona Receptora E2E',
    receptor_caracter: 'Titular',
    fecha_efectiva: new Date().toISOString(),
    medio: 'PRESENCIAL',
    evidencia_documento_id: document.documento.id,
    items: [{ documento_id: document.documento.id, tipo: 'TESTIMONIO', cantidad: 1 }],
    observaciones: 'Entrega sintética verificada en entorno local aislado.',
  });
  if ((delivery.expediente || delivery).estatus !== 'ENTREGADO') throw new Error('La entrega final no cerró el expediente.');
  steps.push('expediente:ENTREGADO');

  const final = await request(`/expedientes/${expediente.id}`);
  if (final.estatus !== 'ENTREGADO' || !final.fecha_real_firma || !final.fecha_entrega_cliente) {
    throw new Error('Firma, postfirma o entrega no quedaron persistidas.');
  }
  steps.push('entrega:verificada');
  console.log(JSON.stringify({ ok: true, target_kind: targetKind, created, steps, paid_ai: ai }, null, 2));
}

main()
  .catch((error: any) => {
    console.error(JSON.stringify({ ok: false, created, steps, error: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
