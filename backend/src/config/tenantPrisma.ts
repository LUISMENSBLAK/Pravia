import type { Prisma } from '@prisma/client';
import { currentActorContext, TenantContextError } from '../auth/actorContext';

// Modelos que poseen organization_id explícito. Los hijos derivados también lo
// conservan para defensa en profundidad, consultas directas e índices eficientes.
export const TENANT_SCOPED_MODELS = new Set([
  'UserInvitation', 'Notification', 'Prospecto', 'ProspectoSeguimiento', 'ProspectoTransicion', 'ProspectoFuenteNotarial', 'Notaria', 'NotariaContacto',
  'Cotizacion', 'CotizacionVersion', 'CotizacionSeguimiento', 'CotizacionTransicion', 'Expediente', 'ExpedienteEstatus_Log',
  'ExpedienteEtapa', 'Documento', 'ExpedienteDocumento', 'CotizacionDocumento', 'ProspectoDocumento',
  'RequisitoDocumentoVinculo', 'MovimientoDocumento', 'ComunicacionDocumento', 'Compareciente',
  'PersonaFisica', 'RelacionConyugal', 'PersonaMoral', 'PersonaMoralInstrumento', 'ComparecienteDomicilio',
  'ComparecienteContacto', 'ComparecienteIdentificacion', 'ComparecienteDocumento', 'PersonaMoralRepresentante',
  'ExpedienteCompareciente', 'ExpedienteRepresentacion', 'ExpedienteRequisitoDoc', 'MovimientoFinanciero',
  'CategoriaFinanciera', 'CuentaFinanciera', 'HonorarioGenerado', 'MetaHonorario', 'MovimientoDistribucion',
  'ComprobanteFinanciero', 'TransaccionEstadoCuenta', 'ConciliacionFinanciera', 'Pago', 'ExpedienteActividad',
  'AuditLog', 'CalculoISR', 'CalculoISRVersion', 'CalculoISRDocumento', 'CalculoISRPropuesta', 'DomainEventOutbox',
  'DomainEventProcessingLog', 'Tarea', 'EventoAgenda', 'TareaExterna', 'ExpedienteEntrega', 'Comunicacion', 'Nota',
  'MemoriaDespacho', 'ComparecienteAltaSession', 'AIUsageLog', 'AssistantConversation', 'AssistantMessage',
  'AssistantAttachment', 'ComplianceReview', 'ComplianceDecision', 'ComplianceEvidence', 'CompliancePartySnapshot',
  'ComplianceBeneficialOwner', 'CompliancePepReview', 'ComplianceScreeningResult', 'CompliancePayment',
  'ScreeningSource', 'ScreeningSourceVersion', 'ScreeningSourceExecution', 'ScreeningSourceExecutionAttempt', 'ScreeningCandidate',
  'ScreeningHumanResolution', 'ScreeningOperationSnapshot', 'ScreeningReport',
  'ComplianceObligation', 'ComplianceEvent', 'ComplianceAiProposal', 'CargaTemporalDocumento',
  'ComplianceLegalRule', 'ComplianceLegalRuleRevision', 'ExpedienteComplianceState', 'ComplianceRuleResult',
  'ComplianceAlertLeadRevision', 'ComplianceRequirement', 'ComplianceRequirementException', 'ComplianceAlert',
  'StorageCompensationJob', 'ComparecienteDatoFuente', 'ComparecienteAlias', 'ComparecienteActividadEconomica',
  'ConfiguracionActo', 'ConfiguracionEtapa', 'ConfiguracionActividad', 'ConfiguracionDependencia',
  'ConfiguracionExcepcion', 'ConfiguracionExcepcionDependencia', 'CatalogoInstitucion', 'CatalogoCarpeta',
  'CatalogoArtefacto', 'CatalogoArtefactoVersion', 'CatalogoArtefactoActo', 'CatalogoArtefactoRegla',
  'ExpedienteActo', 'ExpedienteDocumentoSnapshot', 'ExpedienteDocumentoSnapshotItem',
  'ExpedienteSeguimientoActividad', 'ExpedienteSeguimientoDependencia', 'ExpedienteSeguimientoHistorial',
  'Predio', 'PredioColindancia', 'ExpedientePredio', 'ExpedienteActoPredio', 'PredioDocumento', 'PredioDatoFuente',
  'ExpedienteArtefactoPendiente', 'ExpedienteArtefactoDocumento',
  'ExpedientePresupuesto', 'ExpedientePresupuestoConcepto', 'ExpedientePresupuestoDistribucion',
  'ExpedientePresupuestoDocumento',
  'ExpedienteIngresoReportado', 'ExpedienteSolicitudPago', 'ExpedienteFinanzaDocumento',
  'ExpedienteFinanzaPropuestaIA',
  'PersonaMoralOwnershipStructure', 'PersonaMoralOwnershipNode', 'PersonaMoralOwnershipEdge',
  'PersonaMoralControlFact', 'PersonaMoralStructureReconciliation', 'ComplianceBcStructureSnapshot',
  'ComplianceBcEvaluation', 'ComplianceBcResult', 'ComplianceBcAiProposal', 'ComplianceBcFormatMapping',
  'ExpedienteSocietyTarget',
  'ComplianceQuestionnaireAssessment', 'ComplianceQuestionnaireAssessmentRevision',
  'ComplianceRiskMethodology', 'ComplianceRiskMethodologyRevision',
  'ComplianceOperationPayment', 'ComplianceOperationPaymentRevision', 'ComplianceOperationPaymentAct',
  'ComplianceOperationPaymentParty', 'ComplianceOperationPaymentEvidence',
  'ComplianceOperationPaymentVerification', 'ComplianceOperationPaymentVerificationRule',
  'ComplianceOfficialDefinitionActivation', 'ComplianceObligationTrigger',
  'ComplianceNoticeFicheRevision', 'ComplianceOfficialProduct', 'ComplianceNoticePresentation',
  'ComplianceNoticeAcknowledgement', 'ComplianceAssistedReview',
  'TimingPolicyRevision', 'TimingInterval',
]);

const READ_OR_WRITE_WITH_WHERE = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'update', 'updateMany',
  'delete', 'deleteMany', 'count', 'aggregate', 'groupBy',
]);

const WRITES_WITH_DATA = new Set(['update', 'updateMany']);
export const SHARED_OR_TENANT_MODELS = new Set(['TipoActo']);

function tenantWhere(args: any, organizationId: string) {
  args.where = { ...(args.where || {}), organization_id: organizationId };
}

function tenantData(data: any, organizationId: string) {
  if (!data || typeof data !== 'object') return;
  if (data.organization_id !== undefined && data.organization_id !== organizationId) {
    throw new TenantContextError('La operación intentó utilizar una organización distinta de la sesión activa.');
  }
  data.organization_id = organizationId;
}

export const tenantIsolationMiddleware: Prisma.Middleware = async (params, next) => {
  if (!params.model) return next(params);
  const actor = currentActorContext();
  if (actor?.platformOperation) return next(params);
  if (params.model === 'User' && READ_OR_WRITE_WITH_WHERE.has(params.action)) {
    if (!actor?.organizationId) throw new TenantContextError();
    params.args ||= {};
    const requestedWhere = params.args.where || {};
    const tenantMembership = { some: { organization_id: actor.organizationId } };
    // Prisma requires at least one unique field at the top level of every
    // UserWhereUniqueInput. Keep the requested id/email there while enforcing
    // the active tenant through the membership relation.
    params.args.where = ['findUnique', 'findUniqueOrThrow', 'update', 'delete'].includes(params.action)
      ? { ...requestedWhere, organizationMemberships: tenantMembership }
      : { AND: [requestedWhere, { organizationMemberships: tenantMembership }] };
    return next(params);
  }
  if (params.model === 'User' && ['create', 'createMany', 'upsert'].includes(params.action)) {
    throw new TenantContextError('La creación de identidades requiere una operación interna autorizada.');
  }
  if (params.model === 'OrganizationMembership') {
    if (!actor?.organizationId) throw new TenantContextError();
    params.args ||= {};
    if (READ_OR_WRITE_WITH_WHERE.has(params.action)) tenantWhere(params.args, actor.organizationId);
    if (params.action === 'create') tenantData(params.args.data, actor.organizationId);
    if (params.action === 'createMany') {
      const rows = Array.isArray(params.args.data) ? params.args.data : [params.args.data];
      rows.forEach((row: any) => tenantData(row, actor.organizationId));
    }
    if (params.action === 'upsert') {
      tenantWhere(params.args, actor.organizationId);
      tenantData(params.args.create, actor.organizationId);
      if (params.args.update?.organization_id !== undefined) tenantData(params.args.update, actor.organizationId);
    }
    if (WRITES_WITH_DATA.has(params.action) && params.args.data?.organization_id !== undefined) tenantData(params.args.data, actor.organizationId);
    return next(params);
  }
  if (params.model === 'Organization') {
    if (!actor?.organizationId) throw new TenantContextError();
    if (['create', 'createMany', 'upsert', 'delete', 'deleteMany'].includes(params.action)) {
      throw new TenantContextError('La administración de organizaciones requiere una operación de plataforma explícita.');
    }
    params.args ||= {};
    if (READ_OR_WRITE_WITH_WHERE.has(params.action)) params.args.where = { ...(params.args.where || {}), id: actor.organizationId };
    return next(params);
  }
  if (SHARED_OR_TENANT_MODELS.has(params.model)) {
    if (!actor?.organizationId) throw new TenantContextError();
    params.args ||= {};
    if (['update', 'updateMany', 'delete', 'deleteMany'].includes(params.action)) {
      const requestedWhere = params.args.where || {};
      params.args.where = { AND: [requestedWhere, { organization_id: actor.organizationId }] };
    } else if (READ_OR_WRITE_WITH_WHERE.has(params.action)) {
      const requestedWhere = params.args.where || {};
      params.args.where = {
        AND: [requestedWhere, { OR: [{ organization_id: null }, { organization_id: actor.organizationId }] }],
      };
    }
    if (params.action === 'create') tenantData(params.args.data, actor.organizationId);
    if (params.action === 'createMany') {
      const rows = Array.isArray(params.args.data) ? params.args.data : [params.args.data];
      rows.forEach((row: any) => tenantData(row, actor.organizationId));
    }
    if (WRITES_WITH_DATA.has(params.action) && params.args.data?.organization_id !== undefined) {
      tenantData(params.args.data, actor.organizationId);
    }
    if (params.action === 'upsert') {
      const requestedWhere = params.args.where || {};
      params.args.where = { AND: [requestedWhere, { organization_id: actor.organizationId }] };
      tenantData(params.args.create, actor.organizationId);
      if (params.args.update?.organization_id !== undefined) tenantData(params.args.update, actor.organizationId);
    }
    return next(params);
  }
  if (!TENANT_SCOPED_MODELS.has(params.model)) return next(params);
  if (!actor?.organizationId) throw new TenantContextError();
  params.args ||= {};
  if (READ_OR_WRITE_WITH_WHERE.has(params.action)) tenantWhere(params.args, actor.organizationId);
  if (params.action === 'create') tenantData(params.args.data, actor.organizationId);
  if (params.action === 'createMany') {
    const rows = Array.isArray(params.args.data) ? params.args.data : [params.args.data];
    rows.forEach((row: any) => tenantData(row, actor.organizationId));
  }
  if (WRITES_WITH_DATA.has(params.action) && params.args.data?.organization_id !== undefined) {
    tenantData(params.args.data, actor.organizationId);
  }
  if (params.action === 'upsert') {
    tenantWhere(params.args, actor.organizationId);
    tenantData(params.args.create, actor.organizationId);
    if (params.args.update?.organization_id !== undefined) tenantData(params.args.update, actor.organizationId);
  }
  return next(params);
};
