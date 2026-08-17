import type { ComplianceDetail, ComplianceList } from './compliance.types';

const expediente = {
  id: 'fixture-exp-141', numero_pravia: 'EXP-2026-0141', cliente_alias: 'María Fernanda López', estatus: 'EN_PROCESO',
  tipo_acto: { nombre: 'Compraventa de inmueble' }, notaria: { id: 'not-12', numero_notaria: '12', nombre: 'Notaría 12' },
  abogado: { id: 'u1', nombre: 'Andrea', apellido: 'Ruiz' }, comparecientes: [{ compareciente: { id: 'party-1' } }, { compareciente: { id: 'party-2' } }],
};

const result = {
  clasificacion: 'REQUIERE_AVISO', estado_evaluacion: 'REQUIERE_REVISION', estado_aviso: 'REQUIERE_AVISO', requiere_aviso: true,
  actividad_vulnerable: 'SI', identificacion_requerida: 'SI', acto: 'TRANSMISION_DERECHOS_REALES_INMUEBLES',
  fundamento: 'LFPIORPI, artículo 17, fracción XII, Apartado A, inciso a)', monto_base_mxn: 1_250_000,
  acumulado_seis_meses_mxn: 1_250_000, operaciones_acumuladas: [], uma: { year: 2026, dailyValueMxn: 117.31, effectiveFrom: '2026-02-01', sourceUrl: 'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf' },
  umbral_uma: 8_000, umbral_mxn: 938_480, canal_aviso: 'DECLARANOT', fecha_limite_aviso: '2026-09-17T23:59:59.999Z',
  restriccion_efectivo: { status: 'CUMPLE', thresholdUma: 8_025, thresholdMxn: 941_412.75, cashDetectedMxn: 0, excessMxn: 0, legalBasis: 'LFPIORPI, artículo 32, fracción I', explanation: 'No se registraron pagos en efectivo, divisas o metales preciosos.' },
  evaluacion_riesgo: { level: 'MEDIO', score: 20, factors: [{ key: 'INFORMACION_INCOMPLETA', points: 20, evidence: 'Checklist de información' }], methodology: 'PRAVIA-RISK-INTERNAL-1.0', normativeStatus: 'PENDIENTE_DE_IMPLEMENTACION_NORMATIVA', disclaimer: 'Clasificación interna de cumplimiento. No constituye una determinación de ilicitud.' },
  pep_estado: 'NO_EVALUADO', pep_consulta_oficial: 'NO_CONFIGURADA', beneficiario_controlador_estado: 'PENDIENTE_DE_CONFIRMAR',
  faltantes: ['Revisión PEP', 'Comprobante de transferencia'], alertas: [{ codigo: 'INFO-01', mensaje: 'La evaluación requiere información o confirmación adicional.', regla: 'LFPIORPI, artículo 18', dato: 'Revisión PEP y comprobante de transferencia', fuente: 'Checklist y snapshots de la revisión', accion: 'Completar los datos y vincular evidencia.' }],
  version_normativa: 'LFPIORPI-2025-07-16+RLFPIORPI-2026-03-27+UMA-2026', estatus_normativo: 'VIGENTE', requiere_revision_humana: true,
  disclaimer: 'Clasificación interna de cumplimiento. No constituye una determinación de ilicitud ni sustituye el criterio del sujeto obligado.',
};

const review: any = {
  id: 'fixture-uif', tipo: 'UIF', estatus: 'PENDIENTE_REVISION', fecha_operacion: '2026-08-17T12:00:00.000Z', created_at: '2026-08-17T14:00:00.000Z', updated_at: '2026-08-17T17:15:00.000Z',
  rule_version_snapshot: 'LFPIORPI-2025-07-16+RLFPIORPI-2026-03-27+UMA-2026', snapshot_captured_at: '2026-08-17T14:00:00.000Z', master_data_changed: true,
  cuestionario_json: { tipo_acto_uif: 'TRANSMISION_DERECHOS_REALES_INMUEBLES', precio_pactado: 1_250_000, identidad_verificada: true, actividad_ocupacion_acreditada: true, origen_recursos_documentado: true, pep_estado: 'NO_EVALUADO', beneficiario_controlador_estado: 'PENDIENTE_DE_CONFIRMAR', formas_pago: [{ id: 'pay-1', method: 'TRANSFERENCIA', amountMxn: 1_250_000, paymentDate: '2026-08-17' }] },
  resultado_json: result,
  rule_snapshot: { nombre: 'Fe pública notarial — artículo 17 XII-A', version: 'LFPIORPI-2025-07-16+RLFPIORPI-2026-03-27+UMA-2026', estatus: 'VIGENTE', fuente_nombre: 'Cámara de Diputados, DOF, SAT e INEGI', fuente_url: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPIORPI.pdf', parametros: { uma: { valor_diario_mxn: 117.31 } } },
  master_snapshot: { captured_at: '2026-08-17T14:00:00.000Z', expediente: { id: expediente.id, version: 7, numero_pravia: expediente.numero_pravia, acto: expediente.tipo_acto, valor_operacion_mxn: 1_250_000, notaria: expediente.notaria, responsable: expediente.abogado, updated_at: '2026-08-17T13:45:00.000Z' }, comparecientes: [
    { id: 'party-1', version: 4, tipo_persona: 'FISICA', nombre: 'María Fernanda López', rfc: 'LOFM900101AA1', caracter: { clave: 'COMPRADOR', nombre: 'Compradora' }, pep_estado: 'PENDIENTE', datos_validados: true },
    { id: 'party-2', version: 2, tipo_persona: 'MORAL', nombre: 'Inmobiliaria del Valle, S.A. de C.V.', rfc: 'IVA240101AB2', caracter: { clave: 'VENDEDOR', nombre: 'Vendedora' }, pep_estado: 'NO_APLICA', datos_validados: true },
  ] },
  expediente, ruleSet: { nombre: 'Fe pública notarial', version: '2026.1' }, creado_por: { nombre: 'Andrea', apellido: 'Ruiz' }, revisado_por: null,
  evidencias: [
    { id: 'ev-1', tipo_evidencia: 'IDENTIFICACION', estatus: 'ACTIVO', created_at: '2026-08-17T14:15:00.000Z', retention_until: '2036-08-17T12:00:00.000Z', legal_hold: false, documento: { id: 'doc-1', nombre_original: 'identificacion-maria.pdf', tipo: 'IDENTIFICACION', mime_type: 'application/pdf', size_bytes: 248000, estatus: 'VIGENTE' }, agregado_por: { nombre: 'Andrea', apellido: 'Ruiz' } },
    { id: 'ev-2', tipo_evidencia: 'ESCRITURA', estatus: 'ACTIVO', created_at: '2026-08-17T14:22:00.000Z', retention_until: '2036-08-17T12:00:00.000Z', legal_hold: false, documento: { id: 'doc-2', nombre_original: 'proyecto-escritura.docx', tipo: 'ESCRITURA', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: 68000, estatus: 'VIGENTE' }, agregado_por: { nombre: 'Andrea', apellido: 'Ruiz' } },
  ], decisiones: [], supersedes: { id: 'fixture-v1', estatus: 'CONFIRMADO', tipo: 'UIF', rule_version_snapshot: '2026.1', created_at: '2026-08-10T12:00:00.000Z' },
};

export const fixtureComplianceDirectory: ComplianceList = {
  revisiones: [
    review,
    { ...review, id: 'fixture-uif-2', estatus: 'CONFIRMADO', updated_at: '2026-08-16T12:00:00.000Z', expediente: { ...expediente, numero_pravia: 'EXP-2026-0138', cliente_alias: 'Grupo Constructor del Norte', tipo_acto: { nombre: 'Poder irrevocable' } }, resultado_json: { ...result, estado_evaluacion: 'EVALUADO', estado_aviso: 'PRESENTADO_EXTERNAMENTE', clasificacion: 'REQUIERE_AVISO', acto: 'PODER_IRREVOCABLE_ADMINISTRACION_DOMINIO', umbral_uma: null, umbral_mxn: null, faltantes: [], alertas: [] } },
    { ...review, id: 'fixture-uif-3', estatus: 'BORRADOR', updated_at: '2026-08-15T12:00:00.000Z', expediente: { ...expediente, numero_pravia: 'EXP-2026-0132', cliente_alias: 'Servicios Integrales MX', tipo_acto: { nombre: 'Fideicomiso de garantía' } }, resultado_json: { ...result, estado_evaluacion: 'INFORMACION_INCOMPLETA', estado_aviso: 'POR_DETERMINAR', clasificacion: 'INCOMPLETO', acto: 'FIDEICOMISO_TRASLATIVO_GARANTIA', monto_base_mxn: null, faltantes: ['Importe jurídico', 'Beneficiario controlador'], alertas: [] } },
    { ...review, id: 'fixture-uif-4', estatus: 'CONFIRMADO', updated_at: '2026-08-12T12:00:00.000Z', expediente: { ...expediente, numero_pravia: 'EXP-2026-0124', cliente_alias: 'Carlos Alberto Muñoz', tipo_acto: { nombre: 'Mutuo con garantía' } }, resultado_json: { ...result, estado_evaluacion: 'EVALUADO', estado_aviso: 'REQUIERE_AVISO', clasificacion: 'REQUIERE_AVISO', acto: 'MUTUO_CREDITO_NO_FINANCIERO', faltantes: [], alertas: [] } },
  ],
  meta: { page: 1, pageSize: 12, total: 4, totalPages: 1 }, metrics: { expedientes_evaluados: 4, requieren_revision: 2, avisos_por_presentar: 2, obligaciones_vencidas: 1 },
};

export const fixtureComplianceDetail: ComplianceDetail = {
  revision: review,
  historial: [{ ...review, id: 'fixture-v1', estatus: 'CONFIRMADO', created_at: '2026-08-10T12:00:00.000Z', updated_at: '2026-08-10T16:00:00.000Z', master_data_changed: false, resultado_json: { ...result, estado_evaluacion: 'EVALUADO', faltantes: [], alertas: [] }, decisiones: [{ id: 'decision-1', decision: 'CONFIRMAR', decidido_at: '2026-08-10T16:00:00.000Z', decidido_por: { nombre: 'Andrea', apellido: 'Ruiz' } }] }],
  workspace: {
    parties: review.master_snapshot.comparecientes.map((party: any) => ({ id: `snap-${party.id}`, compareciente_id: party.id, role: party.caracter.clave, snapshot: party, snapshot_version: party.version, captured_at: review.snapshot_captured_at })),
    beneficialOwners: [{ id: 'bc-1', compareciente_id: 'party-2', status: 'PENDIENTE_DE_CONFIRMAR', control_type: 'CONTROL_INDIRECTO', documented_percentage: '55', declaration: 'Declaración recibida; falta documento soporte.', source: 'DECLARACION_CLIENTE', confirmed_at: null }],
    pepReviews: [{ id: 'pep-1', compareciente_id: 'party-1', status: 'NO_EVALUADO', declaration: 'PENDIENTE', official_source: null, official_query_at: null, human_reviewed_at: null, notes: 'Consulta oficial PEP no configurada' }],
    screenings: [{ id: 'screen-1', compareciente_id: 'party-1', provider: 'OFFICIAL_UIF_PEP_QUERY', status: 'NOT_CONFIGURED', queried_at: null }],
    payments: [{ id: 'pay-1', amount_mxn: '1250000', method: 'TRANSFERENCIA', payment_date: '2026-08-17T12:00:00.000Z', institution: 'Institución documentada', reference: 'TRX-••4821', masked_account: '****4821', evidence_document_id: null }],
    obligations: [
      { id: 'obl-1', type: 'AVISO_ORDINARIO', legal_basis: result.fundamento, rule_version: result.version_normativa, rule_status: 'VIGENTE', origin_date: '2026-08-17T12:00:00.000Z', due_at: result.fecha_limite_aviso, channel: 'DECLARANOT', status: 'REQUIERE_AVISO', checklist: { identity: true, beneficial_owner: false, pep_review: false, payment_review: true }, external_filed_at: null, external_folio: null },
      { id: 'obl-0', type: 'AVISO_ORDINARIO', legal_basis: result.fundamento, rule_version: 'LFPIORPI-2025-07-16+UMA-2026', rule_status: 'VIGENTE', origin_date: '2026-07-02T12:00:00.000Z', due_at: '2026-08-17T23:59:59.999Z', channel: 'DECLARANOT', status: 'PRESENTADO_EXTERNAMENTE', checklist: { identity: true, beneficial_owner: true, pep_review: true, payment_review: true }, external_filed_at: '2026-08-12T16:40:00.000Z', external_folio: 'DN-2026-00842', external_receipt_id: 'doc-3', external_confirmed_by: 'u1' },
    ],
    events: [
      { id: 'event-4', event_type: 'REEVALUACION_CREADA', summary: 'Se creó una nueva versión de evaluación.', created_at: '2026-08-17T17:15:00.000Z' },
      { id: 'event-3', event_type: 'ACTIVIDAD_VULNERABLE_EVALUADA', summary: 'La evaluación determinó una obligación de Aviso sujeta a revisión.', created_at: '2026-08-17T17:10:00.000Z' },
      { id: 'event-2', event_type: 'EVIDENCIA_AGREGADA', summary: 'Se agregó evidencia: identificacion-maria.pdf.', created_at: '2026-08-17T14:15:00.000Z' },
      { id: 'event-1', event_type: 'EVALUACION_CREADA', summary: 'Se creó la evaluación de cumplimiento.', created_at: '2026-08-17T14:00:00.000Z' },
    ],
    aiProposals: [{ id: 'ai-1', proposal_type: 'EVIDENCIA_FALTANTE', content: { message: 'PROPUESTA — REQUIERE CONFIRMACIÓN HUMANA.', missing: ['Comprobante de transferencia'] }, source_document_id: 'doc-2', source_page: 4, confidence: '0.86', model: 'configured-model', prompt_version: 'compliance-extract-v1', status: 'PROPUESTA_REQUIERE_CONFIRMACION', created_at: '2026-08-17T17:00:00.000Z' }],
    sensitiveRedacted: false,
  },
};
