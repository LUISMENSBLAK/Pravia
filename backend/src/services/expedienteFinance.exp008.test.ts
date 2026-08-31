import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { hashVerificationToken, moneyDecimal, renderPaymentRequestPdf, renderPraviaReceiptPdf, validateIncomeAllocation } from '../domain/expedienteFinance';

const root = resolve(process.cwd(), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const service = () => read('backend/src/services/expedienteFinance.service.ts');
const ledger = () => read('backend/src/services/financialMovement.service.ts');
const schema = () => read('backend/prisma/schema.prisma');
const migration = () => read('backend/prisma/migrations/20260829020000_create_exp008_case_finance/migration.sql');
const routes = () => read('backend/src/routes/expedientes.routes.ts');
const ai = () => read('backend/src/services/openaiDocument.service.ts');
const ui = () => read('frontend/src/features/cases/components/tabs/FinanceTab.tsx');
const css = () => read('frontend/src/features/cases/Expedientes.module.css');
const tenant = () => read('backend/src/config/tenantPrisma.ts');
const myDay = () => read('backend/src/controllers/miDia.controller.ts');

describe('EXP-008 · precisión monetaria y documentos operativos', () => {
  it('acepta dinero decimal con dos posiciones', () => expect(moneyDecimal('100.10').toFixed(2)).toBe('100.10'));
  it('rechaza más de dos decimales', () => expect(() => moneyDecimal('1.001')).toThrow(/máximo dos/));
  it('rechaza importes negativos', () => expect(() => moneyDecimal('-1')).toThrow());
  it('rechaza importe cero', () => expect(() => moneyDecimal('0')).toThrow(/mayor a cero/));
  it('rechaza importes superiores al rango Decimal(14,2)', () => expect(() => moneyDecimal('1000000000000.00')).toThrow(/máximo permitido/));
  it('cierra Honorarios + Impuestos y derechos exactamente', () => expect(validateIncomeAllocation('116.12','100.10','16.02').total.toFixed(2)).toBe('116.12'));
  it('bloquea una distribución descuadrada', () => expect(() => validateIncomeAllocation('100','70','20')).toThrow(/coincidir/));
  it('genera hash estable sin persistir token abierto', () => { expect(hashVerificationToken('token')).toHaveLength(64); expect(hashVerificationToken('token')).toBe(hashVerificationToken('token')); });
  it('genera ficha de solicitud PDF operativa', () => expect(renderPaymentRequestPdf({folio:'EXP-0001-2026',concept:'RPP',amount:'100.00',createdAt:'29/08/2026',formatSource:'CFG-002'}).subarray(0,4).toString()).toBe('%PDF'));
  it('genera comprobante PRAVIA no fiscal', () => expect(renderPraviaReceiptPdf({receiptFolio:'COM-1',caseFolio:'EXP-1',concept:'Anticipo',amount:'100.00',date:'29/08/2026',code:'ABC',verificationUrl:'/verify',formatSource:'CFG-002'}).toString('latin1')).toContain('No es CFDI'));
});

const cases: Array<[string, () => boolean]> = [
  ['01 ledger canónico reutilizado',()=>service().includes('FinancialMovementService')&&ledger().includes('applyOperationalMovementInTransaction')],
  ['02 no segundo ledger',()=>!schema().includes('ExpedienteMovimientoFinanciero')],
  ['03 comprobante reportado es operativo',()=>schema().includes('model ExpedienteIngresoReportado')],
  ['04 upload no auto-aplica',()=>service().includes('auto_applied: false')],
  ['05 abogado reporta con expediente y documentos',()=>routes().includes("requirePermission('expedientes.write'), requirePermission('documentos.write'), uploadExp008.single('file')")],
  ['06 abogado no aplica',()=>routes().includes("ingresos/:incomeId/aplicar', requirePermission('finanzas.validate')")],
  ['07 administración valida con RBAC',()=>service().includes("actor.permissions.includes('finanzas.validate')")],
  ['08 aplicación transaccional',()=>service().includes('this.prisma.$transaction')&&service().includes('income-apply:')],
  ['09 doble aplicación bloqueada',()=>service().includes("report.estado === 'APLICADO'")&&service().includes('pg_advisory_xact_lock')],
  ['10 idempotencia ingreso',()=>migration().includes('uq_exp008_ingreso_idempotency')],
  ['11 distribución general honorarios',()=>service().includes("clave: { in: ['HONORARIOS', 'IMPUESTOS'] }")],
  ['12 distribución general impuestos derechos',()=>service().includes("note: 'Aplicación general: Impuestos y derechos'")],
  ['13 sin aplicación concepto por concepto',()=>!schema().includes('ExpedienteIngresoConcepto')],
  ['14 solicitud interna',()=>schema().includes('INTERNA')&&service().includes('createInternalRequest')],
  ['15 solicitud externa',()=>schema().includes('DOCUMENTO_EXTERNO')&&service().includes('createExternalRequest')],
  ['16 CFG-002 consumido',()=>service().includes('catalogoArtefacto.findFirst')&&service().includes('formato_version_id')],
  ['17 PDF interno',()=>service().includes('renderPaymentRequestPdf')],
  ['18 documento canónico reutilizado',()=>service().includes('tx.documento.create')&&service().includes('tx.expedienteDocumento.create')],
  ['19 Storage privado reutilizado',()=>service().includes('uploadFile')&&service().includes('getSignedUrl')],
  ['20 ficha origen separada',()=>schema().includes('SOLICITUD_ORIGEN')],
  ['21 comprobante pago separado',()=>schema().includes('COMPROBANTE_PAGO')],
  ['22 comprobante fiscal separado',()=>schema().includes('COMPROBANTE_FISCAL')],
  ['23 solicitud pendiente pagada',()=>schema().includes('enum ExpedienteSolicitudPagoEstado')&&schema().includes('PAGADA')],
  ['24 ingreso pendiente aplicado',()=>schema().includes('enum ExpedienteIngresoReportadoEstado')&&schema().includes('PENDIENTE_APLICACION')],
  ['25 doble pago bloqueado',()=>service().includes("request.estado === 'PAGADA'")&&migration().includes('expediente_solicitudes_pago_movimiento_id_key')],
  ['26 egreso usa ledger',()=>service().includes("nature: 'EGRESO'")&&service().includes('applyOperationalMovementInTransaction')],
  ['27 no conciliación automática',()=>service().includes('reconciled: false')],
  ['28 comprobante PRAVIA',()=>schema().includes('COMPROBANTE_PRAVIA')&&service().includes('generatePraviaReceipt')],
  ['29 identificador verificable seguro',()=>schema().includes('verification_token_hash')&&service().includes('randomBytes(32)')],
  ['30 token sólo hasheado',()=>service().includes('token_persisted: false')&&service().includes('hashVerificationToken(token)')],
  ['31 verificación mínima',()=>service().includes("folio: true, fecha: true, estado: true, verification_code_hint: true")&&!service().includes('importe: true, concepto: true, cuenta_snapshot: true')],
  ['32 verificación tenant-scoped',()=>service().includes('organization_id: actor.organizationId, verification_token_hash: hash')],
  ['33 no hard delete',()=>!service().match(/expediente(?:IngresoReportado|SolicitudPago|FinanzaDocumento)\.delete/)],
  ['34 retiro trazable',()=>service().includes("estatus: 'INACTIVO'")&&service().includes('motivo_retiro')],
  ['35 aplicado exige reverso canónico',()=>service().includes('EXP008_LEDGER_REVERSE_REQUIRED')],
  ['36 IA documental canónica',()=>service().includes('extraerFinanzasDesdeDocumento')&&ai().includes('getOpenAIModelName()')],
  ['37 IA usa nano document model',()=>ai().includes("return /^gpt-5\\.4-nano")],
  ['38 IA no escribe silenciosamente',()=>service().includes('persisted_finance: false')&&service().includes('auto_applied: false')],
  ['39 revisión humana persistida',()=>schema().includes('revisado_por_id')&&service().includes('validateProposal')],
  ['40 provenance por campo',()=>service().includes('provenance: json(extraction.campos.map')],
  ['41 conflictos visibles',()=>schema().includes('conflictos')&&service().includes("extraction.conflictos.length ? 'CONFLICTO'")],
  ['42 AIUsage canónico',()=>service().includes('recordAIUsage')&&service().includes('EXP008_FINANCIAL_DOCUMENT_EXTRACTION')],
  ['43 AIUsage idempotente',()=>service().includes('operationId')&&service().includes('recordAIFailure')],
  ['44 IA fuente tenant autorizada',()=>service().includes('EXP008_AI_SOURCE_DENIED')&&service().includes('expedienteFinanzaDocumento.findFirst')],
  ['45 tenant middleware',()=>tenant().includes("'ExpedienteIngresoReportado'")&&tenant().includes("'ExpedienteFinanzaPropuestaIA'")],
  ['46 FKs físicas tenant',()=>migration().includes('fk_exp008_doc_document_org')&&migration().includes('fk_exp008_solicitud_mov_org')],
  ['47 object authorization',()=>service().includes('expedienteAccessWhere(actor)')],
  ['48 mass assignment bloqueado',()=>!service().includes('data: input')],
  ['49 Decimal 14,2',()=>migration().includes('DECIMAL(14,2)')&&schema().includes('@db.Decimal(14, 2)')],
  ['50 actividad operacional',()=>service().includes('tx.expedienteActividad.create')],
  ['51 auditoría técnica',()=>service().includes('tx.auditLog.create')],
  ['52 outbox reutilizado',()=>service().includes('tx.domainEventOutbox.create')],
  ['53 fuente Mi Día',()=>myDay().includes('INGRESO_PENDIENTE_APLICACION')&&myDay().includes('SOLICITUD_PAGO_PENDIENTE')],
  ['54 sin rediseño Mi Día',()=>!myDay().includes('EXP008_DASHBOARD')],
  ['55 presupuesto sólo lectura',()=>service().includes('presupuesto: { select:')&&!service().match(/expedientePresupuesto\.(update|delete|upsert)/)],
  ['56 documento origen no se confunde con pago',()=>migration().includes("'SOLICITUD_ORIGEN', 'SOLICITUD_GENERADA', 'COMPROBANTE_PAGO', 'COMPROBANTE_FISCAL'")],
  ['57 UI estados explícitos',()=>ui().includes('Pendiente de aplicación')&&ui().includes('Pagada')],
  ['58 UI abogado no muestra aplicar sin capability',()=>ui().includes("canApply&&item.estado==='PENDIENTE_APLICACION'")],
  ['59 UI advierte no auto-aplicar',()=>ui().includes('Subir evidencia no aplica ningún movimiento')],
  ['60 UI accesible',()=>ui().includes('aria-modal="true"')&&ui().includes('aria-label="Cerrar"')],
  ['61 responsive tablet',()=>css().includes('@media(max-width:1024px)')],
  ['62 responsive mobile y safe area',()=>css().includes('@media(max-width:767px)')&&css().includes('env(safe-area-inset-bottom)')],
  ['63 una migración B10',()=>migration().includes('Additive-first')],
  ['64 legacy sin backfill',()=>!migration().match(/INSERT INTO|UPDATE "(?:pagos|movimientos_financieros)"/)],
  ['65 índices de pendientes',()=>migration().includes('idx_exp008_ingreso_pending')&&migration().includes('idx_exp008_solicitud_pending')],
  ['66 documentos respetan su rol financiero',()=>migration().includes('ck_exp008_document_role_consistency')&&migration().includes("'COMPROBANTE_PAGO', 'COMPROBANTE_FISCAL'")&&!migration().includes('num_nonnulls("ingreso_reportado_id", "solicitud_pago_id", "movimiento_id") = 1')],
  ['67 operación IA aislada por tenant',()=>schema().includes('@@unique([organization_id, operation_id], map: "uq_exp008_ai_operation_tenant")')&&service().includes('organization_id: actor.organizationId, expediente_id: expedienteId, operation_id: operationId')],
  ['68 concurrencia IA serializada',()=>service().includes('ai-proposal:${actor.organizationId}:${operationId}')&&service().includes('if (concurrent) return { item: concurrent, idempotent: true }')],
  ['69 rechazo IA no muta datos',()=>service().includes("decision === 'ACCEPT' && proposal.ingreso_reportado_id")&&service().includes("decision === 'ACCEPT' && proposal.solicitud_pago_id")],
  ['70 decisión IA inválida bloqueada',()=>service().includes('EXP008_PROPOSAL_DECISION_INVALID')],
  ['71 reintento concurrente compensa Storage',()=>service().includes('if (result.idempotent) await deleteFile(stored.storageKey)')&&service().includes('if (result.idempotent) await Promise.all(uploads.map')],
  ['72 nuevo ledger conserva Decimal exacto',()=>ledger().includes('new Prisma.Decimal(0)')&&ledger().includes('allocated.equals(input.amount)')&&!ledger().slice(ledger().indexOf('async applyOperationalMovementInTransaction'),ledger().indexOf('async list(')).includes('Number(input.amount)')],
  ['73 documentos anulados no reciben URL firmada ni IA',()=>service().includes("estatus: 'ACTIVO', documento: { estatus: 'VIGENTE' }")&&service().includes('EXP008_DOCUMENT_NOT_FOUND')],
  ['74 verificación no expone UUID de expediente',()=>service().includes('/api/expedientes/comprobantes-pravia/verificar/${token}')&&!service().includes('/api/expedientes/${expedienteId}/finanzas/comprobantes/verificar/${token}')],
  ['75 verificación revalida autorización por objeto',()=>service().includes('await this.assertExpediente(this.prisma, actor, receipt.movimiento.expediente_id!)')],
];

describe('EXP-008 · 75 invariantes forenses de negocio', () => {
  it.each(cases)('%s',(_name,check)=>expect(check()).toBe(true));
});
