import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import type { Request } from "express";
import prisma from "../config/prisma";
import { expedienteAccessWhere } from "../middleware/auth.middleware";
import { ComplianceError } from "../domain/compliance";
import {
  deriveComplianceState,
  evaluateLegalRule,
  selectEffectiveRuleRevisions,
  type LegalCondition,
  type LegalRuleOutcome,
  type LegalRuleRevisionInput,
} from "../domain/complianceLegalEngine";
import {
  accountSafeValues,
  comparePaymentFacts,
  evaluateRiskMethodology,
  mergePaymentDocumentExtractions,
  paymentSemanticFingerprint,
  paymentVerificationIsStale,
  questionnaireCompleteness,
  semanticFingerprint,
  validateQuestionnaireDefinition,
  validateRiskMethodology,
} from "../domain/complianceH5";
import { canAccessDocumento, comparecienteObjectWhere } from "./objectAccess.service";
import { ensureOperationScreeningForPartyTx } from "./operationScreening.service";
import { deleteFile, downloadFile, uploadFile } from "../storage/storage.service";
import { ComplianceDocumentService } from "./complianceDocument.service";
import {
  extraerFinanzasDesdeDocumento,
  getOpenAIModelName,
  type FinancialDocumentExtractionResult,
} from "./openaiDocument.service";
import { recordAIFailure, recordAIUsages } from "./aiUsage.service";
import { ExpedientePartiesService } from "./expedienteParties.service";

type User = NonNullable<Request["user"]>;
type Db = PrismaClient | Prisma.TransactionClient;
function questionnaireObjectScope(user: User): Prisma.ComplianceQuestionnaireAssessmentWhereInput {
  return { OR: [{ target_compareciente_id: null }, ...(user.permissions.includes("comparecientes.read") ? [{
    targetCompareciente: { organization_id: user.organizationId, archived_at: null, ...comparecienteObjectWhere(user) },
  }] : [])] };
}
function requireH5Permission(user: User, permission: User["permissions"][number] = "compliance.read") {
  if (!user.organizationId || !user.id)
    throw new ComplianceError("Falta el contexto de organización.", "TENANT_CONTEXT_REQUIRED", 403);
  if (!user.permissions.includes(permission) || !user.permissions.includes("compliance.sensitive.read"))
    throw new ComplianceError("No tienes permiso para acceder a estos datos.", "H5_SENSITIVE_ACCESS_DENIED", 403);
}

async function requireCurrentReview(db: Db, user: User, reviewId: string) {
  const current = await db.expedienteComplianceState.findFirst({
    where: { organization_id: user.organizationId, current_review_id: reviewId },
    select: { id: true },
  });
  if (!current) throw new ComplianceError("La evaluación ya no es la vigente.", "H5_REVIEW_STALE", 409);
}
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function effectiveH5LegalRevisions(db: Db, user: User, legalDate: Date | null) {
  if (!legalDate) return [];
  return selectEffectiveRuleRevisions(await db.complianceLegalRuleRevision.findMany({ where: {
    organization_id: user.organizationId, status: { in: ["ACTIVE", "RETIRED"] },
    verified_by_id: { not: null }, verified_at: { not: null }, activated_at: { not: null },
    effective_from: { lte: legalDate }, OR: [{ effective_to: null }, { effective_to: { gte: legalDate } }],
    rule: { kind: { in: ["PAYMENT_RESTRICTION", "PROVIDER_IDENTIFICATION"] } },
  }, include: { rule: true }, orderBy: [{ rule_id: "asc" }, { version: "desc" }] }));
}
const legalConfigurationFingerprint = (revisions: Array<{ id: string; checksum: string }>) =>
  semanticFingerprint(revisions.map(({ id, checksum }) => ({ id, checksum })).sort((a, b) => a.id.localeCompare(b.id)));
const text = (value: unknown, max = 500) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const required = (value: unknown, code: string) => {
  const result = text(value, 160);
  if (!result)
    throw new ComplianceError("Falta información obligatoria.", code);
  return result;
};
const decimal = (value: unknown, code: string, precision = 20, scale = 6) => {
  if (value === undefined || value === null || value === "") return null;
  try {
    const result = new Prisma.Decimal(String(value));
    if (!result.isFinite() || result.isNegative() || result.decimalPlaces() > scale || result.gte(new Prisma.Decimal(10).pow(precision - scale))) throw new Error("invalid decimal");
    return result;
  } catch {
    throw new ComplianceError("El importe no es válido.", code);
  }
};
const date = (value: unknown, code: string) => {
  if (!value) return null;
  const result = new Date(String(value));
  if (Number.isNaN(result.getTime()))
    throw new ComplianceError("La fecha no es válida.", code);
  return result;
};

async function scopedReview(db: Db, user: User, reviewId: string) {
  requireH5Permission(user);
  const review = await db.complianceReview.findFirst({
    where: {
      id: reviewId,
      organization_id: user.organizationId,
      expediente: { archived_at: null, ...expedienteAccessWhere(user) },
    },
    select: {
      id: true,
      organization_id: true,
      expediente_id: true,
      is_canonical_legal_engine: true,
      fecha_operacion: true,
    },
  });
  if (!review || review.organization_id !== user.organizationId) {
    throw new ComplianceError(
      "La evaluación no está disponible.",
      "H5_REVIEW_NOT_FOUND",
      404,
    );
  }
  return review as {
    id: string;
    organization_id: string;
    expediente_id: string;
    is_canonical_legal_engine: boolean;
    fecha_operacion: Date | null;
  };
}

async function recomputeCaseState(db: Db, user: User, reviewId: string) {
  const requirements = await db.complianceRequirement.findMany({
    where: {
      organization_id: user.organizationId,
      review_id: reviewId,
      blocks_completion: true,
    },
    select: { status: true, deadline: true },
  });
  const pending = requirements.filter(
    (item) => !["CUMPLIDO", "NO_APLICA"].includes(item.status),
  );
  const state = deriveComplianceState(
    requirements.map((item) => item.status),
    requirements.map((item) => item.deadline),
  );
  const current = await db.expedienteComplianceState.findFirst({
    where: {
      organization_id: user.organizationId,
      current_review_id: reviewId,
    },
    select: { id: true },
  });
  if (current)
    await db.expedienteComplianceState.update({
      where: { id: current.id },
      data: {
        state: state as any,
        pending_count: pending.length,
        next_deadline:
          pending
            .map((item) => item.deadline)
            .filter(Boolean)
            .sort((a, b) => a!.getTime() - b!.getTime())[0] || null,
        updated_by_id: user.id,
        version: { increment: 1 },
      },
    });
}

function paymentFields(body: any) {
  const currency = body.currency_original
    ? text(body.currency_original, 100).toUpperCase()
    : null;
  if (currency && !/^[A-Z]{3}$/.test(currency))
    throw new ComplianceError(
      "La moneda debe usar código ISO de tres letras.",
      "H5_PAYMENT_CURRENCY_INVALID",
    );
  const amount = decimal(body.amount_original, "H5_PAYMENT_AMOUNT_INVALID");
  const exchangeRate = decimal(
    body.exchange_rate,
    "H5_PAYMENT_EXCHANGE_RATE_INVALID",
    24, 12,
  );
  if (
    currency &&
    currency !== "MXN" &&
    amount &&
    !exchangeRate &&
    body.exchange_rate_unknown !== true
  ) {
    throw new ComplianceError(
      "Confirma el tipo de cambio o marca expresamente que no está disponible.",
      "H5_PAYMENT_EXCHANGE_RATE_REQUIRED",
    );
  }
  if (exchangeRate && exchangeRate.isZero())
    throw new ComplianceError(
      "El tipo de cambio debe ser mayor que cero.",
      "H5_PAYMENT_EXCHANGE_RATE_INVALID",
    );
  if (exchangeRate && (!body.exchange_rate_date || !text(body.exchange_rate_source) || !text(body.exchange_rate_criterion)))
    throw new ComplianceError("La conversión requiere fecha, fuente y criterio confirmados.", "H5_PAYMENT_FX_PROVENANCE_REQUIRED");
  const equivalent =
    amount && (currency === "MXN" || exchangeRate)
      ? currency === "MXN"
        ? amount
        : amount.mul(exchangeRate!)
      : null;
  if (equivalent) decimal(equivalent, "H5_PAYMENT_EQUIVALENT_PRECISION_INVALID");
  const rawAccount = body.account_number;
  const secret =
    process.env.PAYMENT_ACCOUNT_FINGERPRINT_SECRET ||
    process.env.AUTH_JWT_SECRET;
  if (rawAccount && !secret)
    throw new ComplianceError(
      "No está configurado el secreto para proteger la cuenta.",
      "H5_PAYMENT_FINGERPRINT_SECRET_REQUIRED",
      503,
    );
  const safeAccount = rawAccount
    ? accountSafeValues(rawAccount, secret!)
    : { account_last4: null, account_fingerprint: null };
  const states =
    body.field_states && typeof body.field_states === "object"
      ? body.field_states
      : {};
  if (Array.isArray(states) || Object.values(states).some((state) => !["VALUE", "CONFIRMED_UNKNOWN"].includes(String(state))))
    throw new ComplianceError("Confirma los datos o indica expresamente que no están identificados.", "H5_PAYMENT_FIELD_STATE_INVALID");
  return {
    scope:
      body.scope === "EXPLICIT_ACT_SET"
        ? ("EXPLICIT_ACT_SET" as const)
        : ("GENERAL_INSTRUMENT" as const),
    amount_original: amount,
    currency_original: currency,
    payment_date: date(body.payment_date, "H5_PAYMENT_DATE_INVALID"),
    method_raw: text(body.method_raw) || null,
    method_code: null,
    method_label_snapshot: null,
    institution: text(body.institution) || null,
    reference: text(body.reference) || null,
    ...safeAccount,
    payer_raw: text(body.payer_raw) || null,
    payee_raw: text(body.payee_raw) || null,
    exchange_rate: exchangeRate,
    exchange_rate_date: date(
      body.exchange_rate_date,
      "H5_PAYMENT_EXCHANGE_RATE_DATE_INVALID",
    ),
    exchange_rate_source: text(body.exchange_rate_source) || null,
    exchange_rate_criterion: text(body.exchange_rate_criterion) || null,
    equivalent_mxn: equivalent,
    declared_paid: decimal(
      body.declared_paid,
      "H5_PAYMENT_DECLARED_PAID_INVALID",
    ),
    declared_pending: decimal(
      body.declared_pending,
      "H5_PAYMENT_DECLARED_PENDING_INVALID",
    ),
    field_states: json(states),
    source: text(body.source, 80) || "HUMAN_CONFIRMED",
    change_reason: text(body.change_reason, 1000) || null,
  };
}

function paymentProposalView(proposal: any) {
  if (!proposal) return proposal;
  const { account_fingerprint: _fingerprint, ...content } = proposal.content || {};
  return { ...proposal, content };
}

async function evaluateH5PaymentRulesTx(
  tx: Prisma.TransactionClient,
  user: User,
  review: Awaited<ReturnType<typeof scopedReview>>,
  paymentRevisionId: string,
  correlationId?: string,
) {
  const legalDate = review.fecha_operacion;
  if (!legalDate) return { results: 0, requirements: 0 };
  const payment = await tx.complianceOperationPaymentRevision.findFirst({
    where: {
      id: paymentRevisionId,
      organization_id: user.organizationId,
      review_id: review.id,
      expediente_id: review.expediente_id,
      status: "CONFIRMED",
    },
    include: { acts: true, parties: { include: { expedienteCompareciente: true } } },
  });
  if (!payment) return { results: 0, requirements: 0 };
  const revisions = await effectiveH5LegalRevisions(tx, user, legalDate);
  if (!revisions.length) return { results: 0, requirements: 0 };
  const state = await tx.expedienteComplianceState.findFirst({
    where: {
      organization_id: user.organizationId,
      expediente_id: review.expediente_id,
      current_review_id: review.id,
    },
  });
  if (!state) return { results: 0, requirements: 0 };
  const explicitActIds = payment.acts.map((item) => item.expediente_acto_id);
  const relevantActs =
    payment.scope === "EXPLICIT_ACT_SET"
      ? explicitActIds
      : (
          await tx.expedienteActo.findMany({
            where: {
              organization_id: user.organizationId,
              expediente_id: review.expediente_id,
              estatus: "ACTIVO",
              removed_at: null,
            },
            select: { id: true },
          })
        ).map((item) => item.id);
  let resultCount = 0;
  let requirementCount = 0;
  for (const revision of revisions) {
    const input: LegalRuleRevisionInput = {
      id: revision.id,
      rule_id: revision.rule_id,
      stable_key: revision.rule.stable_key,
      family: revision.rule.family,
      version: revision.version,
      checksum: revision.checksum,
      legal_basis: revision.legal_basis,
      conditions: revision.conditions as unknown as LegalCondition,
      outcome: revision.outcome as unknown as LegalRuleOutcome,
    };
    const contexts =
      revision.rule.kind === "PAYMENT_RESTRICTION"
        ? relevantActs.map((actId) => ({
            actId,
            subjectId: null as string | null,
            contextKind: "PAYMENT" as const,
            outcomePurpose: "PAYMENT_RESTRICTION" as const,
            contextKey: `PAYMENT:${payment.id}`,
            facts: { payment, expediente_acto_id: actId },
          }))
        : payment.parties.map((party) => ({
            actId: party.expedienteCompareciente.expediente_acto_id,
            subjectId: party.compareciente_id,
            contextKind: "PAYMENT_PARTY" as const,
            outcomePurpose: "PROVIDER_IDENTIFICATION" as const,
            contextKey: `PAYMENT:${payment.id}:PARTY:${party.compareciente_id}:${party.role}`,
            facts: { payment, party: { compareciente_id: party.compareciente_id, role: party.role } },
          }));
    for (const context of contexts) {
      const evaluated = evaluateLegalRule(input, context.facts);
      const existing = await tx.complianceRuleResult.findFirst({
        where: {
          organization_id: user.organizationId,
          review_id: review.id,
          rule_revision_id: revision.id,
          expediente_acto_id: context.actId,
          outcome_purpose: context.outcomePurpose,
          context_kind: context.contextKind,
          context_key: context.contextKey,
        },
      });
      const result =
        existing ||
        (await tx.complianceRuleResult.create({
          data: {
            organization_id: user.organizationId,
            review_id: review.id,
            rule_revision_id: revision.id,
            expediente_acto_id: context.actId,
            outcome_purpose: context.outcomePurpose,
            context_kind: context.contextKind,
            context_key: context.contextKey,
            payment_revision_id: payment.id,
            subject_compareciente_id: context.subjectId,
            applicability: evaluated.applicability,
            vulnerable_activity: null,
            notice_required: null,
            notice_type: null,
            notice_channel: null,
            missing_paths: json(evaluated.missingPaths),
            result_snapshot: json({
              ...evaluated,
              rule_kind: revision.rule.kind,
              payment_revision_id: payment.id,
              subject_compareciente_id: context.subjectId,
            }),
            legal_basis_snapshot: json({
              legal_basis: evaluated.legalBasis,
              revision_id: revision.id,
              checksum: revision.checksum,
            }),
          },
        }));
      if (!existing) resultCount += 1;
      if (
        revision.rule.kind === "PROVIDER_IDENTIFICATION" &&
        evaluated.applicability !== "NO_APLICA"
      ) {
        const status =
          evaluated.applicability === "INFORMACION_INCOMPLETA"
            ? "BLOQUEADO_POR_FALTA_DATOS"
            : "PENDIENTE";
        const key = `PAG:PROVIDER:${payment.payment_id}:${revision.rule.stable_key}:${context.actId || "GENERAL"}:${context.subjectId}`;
        const requirement = await tx.complianceRequirement.upsert({
          where: {
            organization_id_review_id_provider_requirement_key: {
              organization_id: user.organizationId,
              review_id: review.id,
              provider: "PAG",
              requirement_key: key,
            },
          },
          create: {
            organization_id: user.organizationId,
            expediente_id: review.expediente_id,
            state_id: state.id,
            review_id: review.id,
            rule_result_id: result.id,
            provider: "PAG",
            requirement_key: key,
            label: evaluated.requirementLabel,
            status,
            target_compareciente_id: context.subjectId,
            source_snapshot: json({
              rule_revision_id: revision.id,
              rule_checksum: revision.checksum,
              payment_revision_id: payment.id,
              payment_id: payment.payment_id,
              reason: "VERIFIED_PROVIDER_IDENTIFICATION_RULE",
            }),
          },
          update: { rule_result_id: result.id, status,
            source_snapshot: json({ rule_revision_id: revision.id, rule_checksum: revision.checksum,
              payment_revision_id: payment.id, payment_id: payment.payment_id, reason: "VERIFIED_PROVIDER_IDENTIFICATION_RULE" }),
          },
        });
        if (requirement.created_at) requirementCount += 1;
      }
    }
  }
  if (resultCount || requirementCount) {
    await recomputeCaseState(tx, user, review.id);
    await tx.auditLog.create({
      data: {
        organization_id: user.organizationId,
        user_id: user.id,
        accion: "EVALUATE_H5_PAYMENT_LEGAL_RULES",
        entidad: "ComplianceOperationPaymentRevision",
        entidad_id: payment.id,
        valores_nuevos: json({
          result_count: resultCount,
          requirement_count: requirementCount,
          auto_provider_promotion: false,
        }),
        correlation_id: correlationId,
        session_id: user.sessionId,
      },
    });
  }
  return { results: resultCount, requirements: requirementCount };
}

export class ComplianceH5Service {
  static async materializeSourceRequirementsTx(tx: Prisma.TransactionClient, user: User, input: {
    reviewId: string; expedienteId: string; stateId: string;
    results: Array<{ id: string; actId: string; revisionId: string; checksum: string; vulnerable: boolean; documents: Array<{ category: string; action: string; target_scope: string }> }>;
    parties: Array<{ compareciente_id: string; expediente_acto_id: string | null }>;
  }) {
    const identities = new Map<string, { provider: "CUE" | "PAG"; target: string | null; label: string; triggers: unknown[] }>();
    const add = (key: string, provider: "CUE" | "PAG", target: string | null, label: string, source: unknown) => {
      const entry = identities.get(key) || { provider, target, label, triggers: [] }; entry.triggers.push(source); identities.set(key, entry);
    };
    for (const result of input.results.filter((item) => item.vulnerable)) {
      const trigger = { rule_result_id: result.id, rule_revision_id: result.revisionId, checksum: result.checksum, expediente_acto_id: result.actId };
      add("CUE:GENERAL", "CUE", null, "Cuestionario general de la operación", trigger);
      for (const document of result.documents) {
        if (document.action === "GO_TO_PAYMENT_EVIDENCE") add("PAG:OPERATION", "PAG", null, "Pagos de la operación y sus evidencias", trigger);
        if (document.action === "GO_TO_QUESTIONNAIRE" && document.target_scope === "EACH_RELEVANT_COMPARECIENTE") {
          for (const personId of new Set(input.parties.filter((party) => !party.expediente_acto_id || party.expediente_acto_id === result.actId).map((party) => party.compareciente_id)))
            add(`CUE:PERSONAL:${personId}`, "CUE", personId, "Cuestionario personal", trigger);
        }
      }
    }
    const statuses: string[] = [];
    for (const [key, value] of identities) {
      const requirement = await tx.complianceRequirement.upsert({
        where: { organization_id_review_id_provider_requirement_key: { organization_id: user.organizationId, review_id: input.reviewId, provider: value.provider, requirement_key: key } },
        create: { organization_id: user.organizationId, expediente_id: input.expedienteId, state_id: input.stateId, review_id: input.reviewId,
          provider: value.provider, requirement_key: key, label: value.label, status: "PENDIENTE", target_compareciente_id: value.target,
          source_snapshot: json({ h5_contract: value.provider === "CUE" ? "CUM-CUE-001" : "CUM-PAG-001", triggers: value.triggers }),
          is_documental: value.provider === "CUE", document_category: value.provider === "CUE" ? "CUESTIONARIOS_RIESGO" : "PAGOS_EVIDENCIAS",
          requires_signed_document: false, missing_action: value.provider === "CUE" ? "GO_TO_QUESTIONNAIRE" : "GO_TO_PAYMENT_EVIDENCE",
        }, update: {},
      });
      statuses.push(requirement.status);
    }
    return statuses;
  }

  static async readWorkspace(user: User, reviewId: string) {
    const review = await scopedReview(prisma, user, reviewId);
    const [
      questionnaires,
      payments,
      providerCandidates,
      activeDefinitions,
      activeMethodologies,
      ambiguousLegacy,
    ] = await Promise.all([
      prisma.complianceQuestionnaireAssessment.findMany({
        where: { organization_id: user.organizationId, review_id: review.id, ...questionnaireObjectScope(user) },
        include: {
          currentRevision: true,
          definitionVersion: { select: { id: true, definition_json: true, definition_checksum: true } },
          targetCompareciente: { select: { id: true, nombre_busqueda: true } },
          requirement: { select: { id: true, label: true, status: true } },
        },
        orderBy: { created_at: "asc" },
      }),
      prisma.complianceOperationPayment.findMany({
        where: {
          organization_id: user.organizationId,
          expediente_id: review.expediente_id,
          currentRevision: { review_id: review.id },
        },
        include: {
          currentRevision: {
            include: {
              acts: true,
              parties: true,
              evidence: true,
              verifications: { orderBy: { created_at: "desc" }, take: 1 },
            },
          },
        },
        orderBy: { created_at: "asc" },
      }),
      user.permissions.includes("comparecientes.read") ? prisma.expedienteCompareciente.findMany({
        where: {
          organization_id: user.organizationId,
          expediente_id: review.expediente_id,
          archived_at: null,
          estatus: "ACTIVO",
          compareciente: { organization_id: user.organizationId, archived_at: null, ...comparecienteObjectWhere(user) },
        },
        select: {
          id: true,
          compareciente_id: true,
          es_proveedor_recursos: true,
          provider_migration_status: true,
          caracter: { select: { clave: true } },
          compareciente: { select: { nombre_busqueda: true } },
        },
        orderBy: { created_at: "asc" },
      }) : Promise.resolve([]),
      prisma.catalogoArtefactoVersion.count({
        where: {
          organization_id: user.organizationId,
          activa: true,
          content_kind: "STRUCTURED_QUESTIONNAIRE",
          artefacto: {
            activo: true,
            purpose: { in: ["CUE_GENERAL", "CUE_PERSONAL"] },
          },
        },
      }),
      prisma.complianceRiskMethodologyRevision.count({
        where: { organization_id: user.organizationId, status: "ACTIVE" },
      }),
      prisma.compliancePayment.count({
        where: {
          organization_id: user.organizationId,
          review_id: review.id,
          h5_migration_status: "PRESERVED_AMBIGUOUS",
        },
      }),
    ]);
    const [acts, evidence, proposals, providerResults, projectVersions, currentState, paymentResults] = await Promise.all([
      prisma.expedienteActo.findMany({ where: { organization_id: user.organizationId, expediente_id: review.expediente_id, estatus: "ACTIVO", removed_at: null }, select: { id: true, tipo_acto: { select: { nombre: true } } } }),
      prisma.complianceEvidence.findMany({ where: { organization_id: user.organizationId, review_id: review.id, expediente_id: review.expediente_id, estatus: "ACTIVO", documento: { estatus: "VIGENTE" } }, include: { documento: { select: { id: true, nombre_original: true, checksum_sha256: true } } } }),
      prisma.complianceAiProposal.findMany({ where: { organization_id: user.organizationId, review_id: review.id, proposal_type: "H5_PAYMENT_EXTRACTION_PREPARE_ONLY", status: "PROPUESTA_REQUIERE_CONFIRMACION" } }),
      prisma.complianceRuleResult.findMany({ where: { organization_id: user.organizationId, review_id: review.id, outcome_purpose: "PROVIDER_IDENTIFICATION" } }),
      prisma.documento.findMany({ where: { organization_id: user.organizationId, expediente_id: review.expediente_id, tipo: "PROYECTO_ESCRITURA", estatus: "VIGENTE" }, select: { id: true, nombre_original: true, checksum_sha256: true } }),
      prisma.expedienteComplianceState.findFirst({ where: { organization_id: user.organizationId, current_review_id: review.id }, select: { id: true } }),
      prisma.complianceRuleResult.findMany({ where: { organization_id: user.organizationId, review_id: review.id, payment_revision_id: { in: payments.flatMap((item) => item.currentRevision ? [item.currentRevision.id] : []) }, outcome_purpose: { in: ["PAYMENT_RESTRICTION", "PROVIDER_IDENTIFICATION"] } }, include: { ruleRevision: { select: { checksum: true } } } }),
    ]);
    const accessibleDocumentIds = new Set<string>();
    if (user.permissions.includes("documentos.read")) for (const id of new Set([...evidence.map((item) => item.documento_id), ...projectVersions.map((item) => item.id)])) {
      if (await canAccessDocumento(user, id)) accessibleDocumentIds.add(id);
    }
    const visibleEvidence = evidence.filter((item) => accessibleDocumentIds.has(item.documento_id));
    const visibleProjects = projectVersions.filter((item) => accessibleDocumentIds.has(item.id));
    const configurationFingerprint = legalConfigurationFingerprint(await effectiveH5LegalRevisions(prisma, user, review.fecha_operacion));
    const confirmedPayments = payments.flatMap((item) => item.currentRevision?.status === "CONFIRMED" ? [{ id: item.currentRevision.id, fingerprint: item.currentRevision.semantic_fingerprint }] : []);
    const visiblePayments = payments.map((item) => {
      if (!item.currentRevision) return item;
      const revision = item.currentRevision;
      const { account_fingerprint: _accountFingerprint, ...displayRevision } = revision;
      const currentEvidence = revision.evidence.flatMap((link) => {
        const source = visibleEvidence.find((candidate) => candidate.id === link.evidence_id);
        return source && source.document_checksum_snapshot === source.documento.checksum_sha256
          ? [{ id: source.id, document_id: source.documento_id, version: source.document_version, checksum: source.document_checksum_snapshot }] : [];
      });
      return { ...item, currentRevision: { ...displayRevision, verifications: revision.verifications.map((verification) => ({
        ...verification,
        stale: paymentVerificationIsStale(verification, {
          currentReview: Boolean(currentState), paymentRevisionId: revision.id, paymentFingerprint: revision.semantic_fingerprint,
          project: (() => { const doc = visibleProjects.find((candidate) => candidate.id === verification.project_document_id); return doc ? { id: doc.id, checksum: doc.checksum_sha256 } : null; })(),
          payments: confirmedPayments, evidence: currentEvidence,
          ruleConfigurationFingerprint: configurationFingerprint,
          rules: paymentResults.filter((result) => result.payment_revision_id === revision.id).map((result) => ({ id: result.id, revision_id: result.rule_revision_id, checksum: result.ruleRevision.checksum })),
        }),
      })) } };
    });
    return {
      review_id: review.id,
      expediente_id: review.expediente_id,
      questionnaires,
      payments: visiblePayments,
      acts,
      evidence: visibleEvidence,
      proposals: proposals.filter((proposal) => Array.isArray(proposal.source_documents) && proposal.source_documents.every((source: any) => accessibleDocumentIds.has(source.id))).map(paymentProposalView),
      provider_results: providerResults,
      project_versions: visibleProjects,
      is_current: Boolean(currentState),
      provider_candidates: providerCandidates.map((item) => ({
        ...item,
        es_proveedor_recursos: item.caracter.clave === "PROVEEDOR_RECURSOS",
      })),
      configuration: {
        questionnaire_definitions: activeDefinitions,
        risk_methodologies: activeMethodologies,
      },
      legacy: { ambiguous_payments_preserved: ambiguousLegacy },
      legal_determinations: {
        payment_restrictions: "RULE_RESULT_ONLY",
        provider_identification: "RULE_RESULT_ONLY",
      },
    };
  }

  static async publishQuestionnaireDefinition(
    user: User,
    artifactId: string,
    body: any,
    correlationId?: string,
  ) {
    requireH5Permission(user, "compliance.rules.manage");
    const definition = validateQuestionnaireDefinition(body.definition);
    const checksum = semanticFingerprint(definition);
    const purpose =
      definition.scope === "GENERAL"
        ? ("CUE_GENERAL" as const)
        : ("CUE_PERSONAL" as const);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:definition:${user.organizationId}:${artifactId}`}))`);
      const artifact = await tx.catalogoArtefacto.findFirst({
        where: {
          id: artifactId,
          organization_id: user.organizationId,
          activo: true,
        },
        select: { id: true, purpose: true },
      });
      if (!artifact)
        throw new ComplianceError(
          "El artefacto no está disponible.",
          "H5_QUESTIONNAIRE_ARTIFACT_NOT_FOUND",
          404,
        );
      const hasFile = await tx.catalogoArtefactoVersion.findFirst({
        where: { organization_id: user.organizationId, artefacto_id: artifactId, content_kind: "FILE" },
        select: { id: true },
      });
      if (hasFile || (artifact.purpose && artifact.purpose !== purpose))
        throw new ComplianceError("No se puede reclasificar un artefacto existente.", "H5_ARTIFACT_RECLASSIFICATION_BLOCKED", 409);
      const duplicate = await tx.catalogoArtefactoVersion.findFirst({
        where: {
          organization_id: user.organizationId,
          artefacto_id: artifactId,
          definition_checksum: checksum,
        },
      });
      if (duplicate) return duplicate;
      const latest = await tx.catalogoArtefactoVersion.findFirst({
        where: {
          organization_id: user.organizationId,
          artefacto_id: artifactId,
        },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      await tx.catalogoArtefactoVersion.updateMany({
        where: {
          organization_id: user.organizationId,
          artefacto_id: artifactId,
          activa: true,
        },
        data: { activa: false },
      });
      await tx.catalogoArtefacto.update({
        where: { id: artifactId },
        data: { purpose, actualizado_por_id: user.id },
      });
      const version = await tx.catalogoArtefactoVersion.create({
        data: {
          organization_id: user.organizationId,
          artefacto_id: artifactId,
          version: (latest?.version || 0) + 1,
          origen: "CONFIGURACION_H5",
          content_kind: "STRUCTURED_QUESTIONNAIRE",
          definition_json: json(definition),
          definition_checksum: checksum,
          schema_version: 1,
          activa: true,
          creado_por_id: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          organization_id: user.organizationId,
          user_id: user.id,
          accion: "PUBLISH_H5_QUESTIONNAIRE_DEFINITION",
          entidad: "CatalogoArtefactoVersion",
          entidad_id: version.id,
          valores_nuevos: json({ purpose, checksum, version: version.version }),
          correlation_id: correlationId,
          session_id: user.sessionId,
        },
      });
      return version;
    });
  }

  static async ensureQuestionnaires(
    user: User,
    reviewId: string,
    correlationId?: string,
  ) {
    requireH5Permission(user, "compliance.write");
    const review = await scopedReview(prisma, user, reviewId);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:ensure:${user.organizationId}:${review.id}`}))`);
      await requireCurrentReview(tx, user, review.id);
      const personalTargets = user.permissions.includes("comparecientes.read") ? await tx.expedienteCompareciente.findMany({ where: {
        organization_id: user.organizationId, expediente_id: review.expediente_id, archived_at: null, estatus: "ACTIVO",
        compareciente: { organization_id: user.organizationId, archived_at: null, ...comparecienteObjectWhere(user) },
      }, select: { compareciente_id: true } }) : [];
      const requirements = await tx.complianceRequirement.findMany({
        where: {
          organization_id: user.organizationId,
          review_id: review.id,
          provider: "CUE",
          status: { not: "NO_APLICA" },
          OR: [{ target_compareciente_id: null }, { target_compareciente_id: { in: personalTargets.map((item) => item.compareciente_id) } }],
        },
        orderBy: { created_at: "asc" },
      });
      const created: unknown[] = [];
      for (const requirement of requirements) {
        const scope = requirement.target_compareciente_id
          ? ("PERSONAL" as const)
          : ("GENERAL" as const);
        const purpose =
          scope === "GENERAL"
            ? ("CUE_GENERAL" as const)
            : ("CUE_PERSONAL" as const);
        const identity = requirement.target_compareciente_id
          ? `PERSONAL:${requirement.target_compareciente_id}`
          : "GENERAL";
        const existing = await tx.complianceQuestionnaireAssessment.findFirst({
          where: {
            organization_id: user.organizationId,
            review_id: review.id,
            identity_key: identity,
          },
        });
        if (existing) {
          const currentTriggers = Array.isArray(existing.trigger_snapshot)
            ? (existing.trigger_snapshot as unknown[])
            : [existing.trigger_snapshot];
          const trigger = { requirement_id: requirement.id, requirement_key: requirement.requirement_key, source_snapshot: requirement.source_snapshot };
          const requirementAlreadyCaptured = currentTriggers.some((item) => semanticFingerprint(item) === semanticFingerprint(trigger));
          if (!requirementAlreadyCaptured)
            await tx.complianceQuestionnaireAssessment.update({
              where: { id: existing.id },
              data: {
                trigger_snapshot: json([
                  ...currentTriggers,
                  trigger,
                ]),
              },
            });
          created.push(existing);
          continue;
        }
        // Configuration is selected only when creating an assessment. An existing
        // assessment keeps its exact pinned definition even after retirement.
        const definitions = await tx.catalogoArtefactoVersion.findMany({
          where: { organization_id: user.organizationId, activa: true,
            content_kind: "STRUCTURED_QUESTIONNAIRE", artefacto: { activo: true, purpose } },
        });
        const definition = definitions.length === 1 ? definitions[0] : null;
        if (!definition?.definition_json || !definition.definition_checksum) {
          await tx.complianceRequirement.update({ where: { id: requirement.id }, data: {
            status: "BLOQUEADO_POR_FALTA_DATOS",
            source_snapshot: json({ ...(requirement.source_snapshot as object), reason: definitions.length > 1 ? "DEFINITION_AMBIGUOUS" : "DEFINITION_NOT_CONFIGURED" }),
          } });
          continue;
        }
        validateQuestionnaireDefinition(definition.definition_json);
        const assessment = await tx.complianceQuestionnaireAssessment.create({
          data: {
            organization_id: user.organizationId,
            expediente_id: review.expediente_id,
            review_id: review.id,
            requirement_id: requirement.id,
            scope,
            identity_key: identity,
            target_compareciente_id: requirement.target_compareciente_id,
            definition_version_id: definition.id,
            trigger_snapshot: json([
              {
                requirement_id: requirement.id,
                requirement_key: requirement.requirement_key,
                source_snapshot: requirement.source_snapshot,
              },
            ]),
            created_by_id: user.id,
          },
        });
        const fingerprint = semanticFingerprint({
          answers: {},
          definition_version_id: definition.id,
        });
        const revision =
          await tx.complianceQuestionnaireAssessmentRevision.create({
            data: {
              organization_id: user.organizationId,
              assessment_id: assessment.id,
              revision_number: 1,
              answers: json({}),
              definition_version_id: definition.id,
              definition_checksum: definition.definition_checksum,
              completeness: "INCOMPLETE",
              missing_question_ids: json(
                questionnaireCompleteness(definition.definition_json, {})
                  .missing_question_ids,
              ),
              semantic_fingerprint: fingerprint,
              idempotency_key: `initial:${assessment.id}`,
              created_by_id: user.id,
            },
          });
        await tx.complianceQuestionnaireAssessment.update({
          where: { id: assessment.id },
          data: { current_revision_id: revision.id },
        });
        created.push({ ...assessment, currentRevision: revision });
      }
      await tx.auditLog.create({
        data: {
          organization_id: user.organizationId,
          user_id: user.id,
          accion: "ENSURE_H5_QUESTIONNAIRES",
          entidad: "ComplianceReview",
          entidad_id: review.id,
          valores_nuevos: json({
            requirement_count: requirements.length,
            resolved_count: created.length,
          }),
          correlation_id: correlationId,
          session_id: user.sessionId,
        },
      });
      await recomputeCaseState(tx, user, review.id);
      return {
        items: created,
        unresolved_configuration: requirements.length - created.length,
      };
    });
  }

  static async saveQuestionnaire(
    user: User,
    assessmentId: string,
    body: any,
    finalize: boolean,
    correlationId?: string,
  ) {
    requireH5Permission(user, finalize ? "compliance.review" : "compliance.write");
    const key = required(
      body.idempotency_key,
      "H5_QUESTIONNAIRE_IDEMPOTENCY_REQUIRED",
    );
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:questionnaire:${assessmentId}`}))`,
      );
      const assessment = await tx.complianceQuestionnaireAssessment.findFirst({
        where: {
          id: assessmentId,
          organization_id: user.organizationId,
          ...questionnaireObjectScope(user),
          review: {
            expediente: { archived_at: null, ...expedienteAccessWhere(user) },
          },
        },
        include: {
          currentRevision: true,
          definitionVersion: true,
          requirement: true,
        },
      });
      if (
        !assessment?.currentRevision ||
        !assessment.definitionVersion.definition_json ||
        !assessment.definitionVersion.definition_checksum
      )
        throw new ComplianceError(
          "El cuestionario no está disponible.",
          "H5_QUESTIONNAIRE_NOT_FOUND",
          404,
        );
      await requireCurrentReview(tx, user, assessment.review_id);
      const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
      const existing = await tx.complianceQuestionnaireAssessmentRevision.findFirst({
        where: { organization_id: user.organizationId, assessment_id: assessment.id, idempotency_key: key },
      });
      if (existing) {
        if (semanticFingerprint(existing.answers) !== semanticFingerprint(answers) || (existing.status === "FINALIZED") !== finalize)
          throw new ComplianceError("La clave de idempotencia corresponde a otros datos.", "H5_QUESTIONNAIRE_IDEMPOTENCY_CONFLICT", 409);
        return existing;
      }
      if (assessment.currentRevision.status === "FINALIZED")
        throw new ComplianceError(
          "La versión finalizada es inmutable; su reapertura no está disponible.",
          "H5_QUESTIONNAIRE_FINALIZED_IMMUTABLE",
          409,
        );
      if (
        body.base_fingerprint !==
        assessment.currentRevision.semantic_fingerprint
      )
        throw new ComplianceError(
          "El cuestionario cambió; recarga antes de guardar.",
          "H5_QUESTIONNAIRE_STALE",
          409,
        );
      const completeness = questionnaireCompleteness(
        assessment.definitionVersion.definition_json,
        answers,
      );
      if (finalize && completeness.completeness !== "COMPLETE")
        throw new ComplianceError(
          "Completa las respuestas obligatorias antes de finalizar.",
          "H5_QUESTIONNAIRE_INCOMPLETE",
          409,
        );
      let methodology: any = null;
      let evaluation: any = null;
      if (finalize) {
        const matches = await tx.complianceRiskMethodologyRevision.findMany({
          where: {
            organization_id: user.organizationId,
            status: "ACTIVE",
            compatible_definition_version_id: assessment.definition_version_id,
            methodology: { scope: assessment.scope },
            OR: [
              { effective_from: null },
              { effective_from: { lte: new Date() } },
            ],
            AND: [
              {
                OR: [
                  { effective_to: null },
                  { effective_to: { gte: new Date() } },
                ],
              },
            ],
          },
        });
        if (matches.length !== 1)
          throw new ComplianceError(
            matches.length
              ? "Existe más de una metodología activa compatible."
              : "No existe una metodología activa compatible.",
            matches.length
              ? "H5_RISK_METHODOLOGY_AMBIGUOUS"
              : "H5_RISK_METHODOLOGY_NOT_CONFIGURED",
            409,
          );
        methodology = matches[0];
        evaluation = evaluateRiskMethodology(methodology.factor_dsl, answers);
      }
      const fingerprint = semanticFingerprint({
        answers,
        definition_version_id: assessment.definition_version_id,
        methodology_revision_id: methodology?.id || null,
        evaluation,
      });
      const revision =
        await tx.complianceQuestionnaireAssessmentRevision.create({
          data: {
            organization_id: user.organizationId,
            assessment_id: assessment.id,
            revision_number: assessment.currentRevision.revision_number + 1,
            status: finalize ? "FINALIZED" : "DRAFT",
            answers: json(answers),
            definition_version_id: assessment.definition_version_id,
            definition_checksum:
              assessment.definitionVersion.definition_checksum,
            completeness: completeness.completeness,
            missing_question_ids: json(completeness.missing_question_ids),
            methodology_revision_id: methodology?.id || null,
            evaluation_status: finalize ? "EVALUATED" : "PENDING",
            evaluation_snapshot: evaluation
              ? json({
                  ...evaluation,
                  methodology_checksum: methodology.checksum,
                })
              : undefined,
            semantic_fingerprint: fingerprint,
            base_revision_id: assessment.currentRevision.id,
            idempotency_key: key,
            created_by_id: user.id,
            finalized_by_id: finalize ? user.id : null,
            finalized_at: finalize ? new Date() : null,
          },
        });
      await tx.complianceQuestionnaireAssessment.update({
        where: { id: assessment.id },
        data: { current_revision_id: revision.id },
      });
      if (finalize) {
        const triggerIds = Array.isArray(assessment.trigger_snapshot)
          ? assessment.trigger_snapshot.map((item: any) => item.requirement_id).filter(Boolean) : [];
        await tx.complianceRequirement.updateMany({
          where: { id: { in: [...new Set([assessment.requirement_id, ...triggerIds])] },
            organization_id: user.organizationId, review_id: assessment.review_id, provider: "CUE",
            target_compareciente_id: assessment.target_compareciente_id },
          data: { status: "CUMPLIDO" },
        });
        await recomputeCaseState(tx, user, assessment.review_id);
      }
      await tx.complianceEvent.create({
        data: {
          organization_id: user.organizationId,
          review_id: assessment.review_id,
          event_type: finalize
            ? "H5_QUESTIONNAIRE_FINALIZED"
            : "H5_QUESTIONNAIRE_REVISION_SAVED",
          actor_id: user.id,
          summary: finalize
            ? "Cuestionario finalizado con metodología versionada."
            : "Borrador de cuestionario guardado.",
          detail: json({
            assessment_id: assessment.id,
            revision_id: revision.id,
            completeness: completeness.completeness,
          }),
          correlation_id: correlationId,
        },
      });
      await tx.auditLog.create({
        data: {
          organization_id: user.organizationId,
          user_id: user.id,
          accion: finalize
            ? "FINALIZE_H5_QUESTIONNAIRE"
            : "SAVE_H5_QUESTIONNAIRE",
          entidad: "ComplianceQuestionnaireAssessmentRevision",
          entidad_id: revision.id,
          valores_nuevos: json({
            assessment_id: assessmentId,
            fingerprint,
            completeness: completeness.completeness,
          }),
          correlation_id: correlationId,
          session_id: user.sessionId,
        },
      });
      return revision;
    });
  }

  static async publishMethodology(
    user: User,
    body: any,
    correlationId?: string,
  ) {
    requireH5Permission(user, "compliance.rules.manage");
    const stableKey = required(body.stable_key, "H5_METHODOLOGY_KEY_REQUIRED");
    const definition = await prisma.catalogoArtefactoVersion.findFirst({
      where: {
        id: required(
          body.definition_version_id,
          "H5_METHODOLOGY_DEFINITION_REQUIRED",
        ),
        organization_id: user.organizationId,
        content_kind: "STRUCTURED_QUESTIONNAIRE",
      },
    });
    if (!definition)
      throw new ComplianceError(
        "La definición compatible no está disponible.",
        "H5_METHODOLOGY_DEFINITION_NOT_FOUND",
        404,
      );
    const definitionContent = validateQuestionnaireDefinition(definition.definition_json);
    if (body.scope !== definitionContent.scope)
      throw new ComplianceError("El alcance debe coincidir con la definición fijada.", "H5_METHODOLOGY_SCOPE_INVALID");
    validateRiskMethodology(body.factor_dsl, definitionContent);
    const configuredObject = (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
    if (!configuredObject(body.taxonomy) || !configuredObject(body.output_mapping) || !configuredObject(body.provenance))
      throw new ComplianceError("La metodología requiere taxonomía, mapeo de salidas y procedencia explícitos.", "H5_METHODOLOGY_CONFIGURATION_REQUIRED");
    const effectiveFrom = date(body.effective_from, "H5_METHODOLOGY_DATE_INVALID");
    const effectiveTo = date(body.effective_to, "H5_METHODOLOGY_DATE_INVALID");
    if (!effectiveFrom || effectiveTo && effectiveTo < effectiveFrom)
      throw new ComplianceError("Indica una vigencia explícita y válida.", "H5_METHODOLOGY_EFFECTIVE_DATE_REQUIRED");
    if (body.validation_answers)
      evaluateRiskMethodology(body.factor_dsl, body.validation_answers);
    const checksum = semanticFingerprint({
      compatible_definition_version_id: definition.id,
      scope: definitionContent.scope,
      taxonomy: body.taxonomy || {},
      factor_dsl: body.factor_dsl,
      output_mapping: body.output_mapping || {},
      effective_from: effectiveFrom, effective_to: effectiveTo, provenance: body.provenance,
    });
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:methodology:${user.organizationId}:${stableKey}`}))`);
      let master = await tx.complianceRiskMethodology.findFirst({
        where: { organization_id: user.organizationId, stable_key: stableKey },
      });
      if (master && master.scope !== definitionContent.scope)
        throw new ComplianceError("La metodología no puede cambiar de alcance.", "H5_METHODOLOGY_SCOPE_INVALID", 409);
      if (!master)
        master = await tx.complianceRiskMethodology.create({
          data: {
            organization_id: user.organizationId,
            stable_key: stableKey,
            scope: body.scope === "PERSONAL" ? "PERSONAL" : "GENERAL",
            name: required(body.name, "H5_METHODOLOGY_NAME_REQUIRED"),
            created_by_id: user.id,
          },
        });
      const latest = await tx.complianceRiskMethodologyRevision.findFirst({
        where: {
          organization_id: user.organizationId,
          methodology_id: master.id,
        },
        orderBy: { revision_number: "desc" },
      });
      if (latest?.checksum === checksum) return latest;
      await tx.complianceRiskMethodologyRevision.updateMany({
        where: {
          organization_id: user.organizationId,
          methodology_id: master.id,
          status: "ACTIVE",
        },
        data: { status: "RETIRED", retired_at: new Date() },
      });
      const revision = await tx.complianceRiskMethodologyRevision.create({
        data: {
          organization_id: user.organizationId,
          methodology_id: master.id,
          revision_number: (latest?.revision_number || 0) + 1,
          status: "ACTIVE",
          compatible_definition_version_id: definition.id,
          taxonomy: json(body.taxonomy || {}),
          factor_dsl: json(body.factor_dsl),
          output_mapping: json(body.output_mapping || {}),
          checksum,
          effective_from: effectiveFrom,
          effective_to: effectiveTo,
          provenance: json(body.provenance || {}),
          supersedes_revision_id: latest?.id || null,
          created_by_id: user.id,
          verified_by_id: user.id,
          activated_by_id: user.id,
          verified_at: new Date(),
          activated_at: new Date(),
        },
      });
      await tx.complianceRiskMethodology.update({
        where: { id: master.id },
        data: { current_revision_id: revision.id },
      });
      await tx.auditLog.create({
        data: {
          organization_id: user.organizationId,
          user_id: user.id,
          accion: "ACTIVATE_H5_RISK_METHODOLOGY",
          entidad: "ComplianceRiskMethodologyRevision",
          entidad_id: revision.id,
          valores_nuevos: json({ stable_key: stableKey, checksum }),
          correlation_id: correlationId,
          session_id: user.sessionId,
        },
      });
      return revision;
    });
  }

  static async createPaymentRevision(
    user: User,
    reviewId: string,
    body: any,
    correlationId?: string,
    transaction?: Prisma.TransactionClient,
    reviewedProposalAccount?: { account_last4: string; account_fingerprint: string },
  ) {
    requireH5Permission(user, body.confirm ? "compliance.review" : "compliance.write");
    const review = await scopedReview(transaction || prisma, user, reviewId);
    const idempotencyKey = required(
      body.idempotency_key,
      "H5_PAYMENT_IDEMPOTENCY_REQUIRED",
    );
    const paymentId = text(body.payment_id, 64) || null;
    const fields = paymentFields(body);
    if (reviewedProposalAccount) {
      fields.account_last4 = reviewedProposalAccount.account_last4;
      fields.account_fingerprint = reviewedProposalAccount.account_fingerprint;
      fields.field_states = json({ ...(fields.field_states as object), account_number: "VALUE" });
    }
    if (body.account_unchanged && (!paymentId || reviewedProposalAccount || body.account_number || body.field_states?.account_number === "CONFIRMED_UNKNOWN"))
      throw new ComplianceError("La conservación de cuenta requiere un pago existente y no admite una cuenta nueva o desconocida.", "H5_PAYMENT_ACCOUNT_PRESERVE_INVALID");
    const actIds: string[] = [
      ...new Set<string>(
        (Array.isArray(body.expediente_acto_ids)
          ? body.expediente_acto_ids
          : []
        ).map((item: unknown) => String(item)),
      ),
    ];
    if (fields.scope === "EXPLICIT_ACT_SET" && !actIds.length)
      throw new ComplianceError(
        "Selecciona al menos un acto para el alcance explícito.",
        "H5_PAYMENT_ACT_REQUIRED",
      );
    if (fields.scope === "GENERAL_INSTRUMENT" && actIds.length)
      throw new ComplianceError(
        "El alcance general no admite actos explícitos.",
        "H5_PAYMENT_SCOPE_INVALID",
      );
    const partyInputs = Array.isArray(body.parties) ? body.parties : [];
    const evidenceIds: string[] = [
      ...new Set<string>(
        (Array.isArray(body.evidence_ids) ? body.evidence_ids : []).map(
          (item: unknown) => String(item),
        ),
      ),
    ];
    const execute = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:payment-request:${user.organizationId}:${review.id}:${idempotencyKey}`}))`);
      await requireCurrentReview(tx, user, review.id);
      if (paymentId)
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:payment:${paymentId}`}))`,
        );
      let payment = paymentId
        ? await tx.complianceOperationPayment.findFirst({
            where: {
              id: paymentId,
              organization_id: user.organizationId,
              expediente_id: review.expediente_id,
            },
            include: { currentRevision: true },
          })
        : null;
      if (paymentId && !payment)
        throw new ComplianceError(
          "El pago no está disponible.",
          "H5_PAYMENT_NOT_FOUND",
          404,
        );
      if (body.account_unchanged) {
        // Never accept account hashes/last-four supplied by a client. Resolve the
        // reviewed base revision in this tenant and payment, including retries.
        const accountBase = payment?.currentRevision && payment.currentRevision.semantic_fingerprint === body.base_fingerprint
          ? payment.currentRevision
          : await tx.complianceOperationPaymentRevision.findFirst({ where: {
            organization_id: user.organizationId, payment_id: paymentId!, semantic_fingerprint: required(body.base_fingerprint, "H5_PAYMENT_BASE_REQUIRED"),
          } });
        if (!accountBase?.account_fingerprint || !accountBase.account_last4)
          throw new ComplianceError("La cuenta de la revisión base no está disponible.", "H5_PAYMENT_ACCOUNT_BASE_INVALID", 409);
        fields.account_last4 = accountBase.account_last4;
        fields.account_fingerprint = accountBase.account_fingerprint;
        fields.field_states = json({ ...(fields.field_states as object), account_number: "VALUE" });
      }
      const states = fields.field_states as Record<string, unknown>;
      const reviewedFields = ["amount_original", "currency_original", "payment_date", "method_raw", "institution", "payer_raw", "payee_raw", "reference", "account_number", "declared_paid", "declared_pending"];
      if (body.confirm === true) for (const key of reviewedFields) {
        const value = key === "account_number" ? fields.account_fingerprint : (fields as any)[key];
        if (!states[key] || (states[key] === "VALUE" && value == null) || (states[key] === "CONFIRMED_UNKNOWN" && value != null))
          throw new ComplianceError("Revisa cada campo: confirma su valor o indica expresamente que no está identificado.", "H5_PAYMENT_FIELD_REVIEW_REQUIRED");
      }
      const duplicate = await tx.complianceOperationPaymentRevision.findFirst({
            where: {
              organization_id: user.organizationId,
              review_id: review.id,
              ...(payment ? { payment_id: payment.id } : { base_revision_id: null }),
              idempotency_key: idempotencyKey,
            },
            include: { acts: true, parties: true, evidence: true },
          });
      if (duplicate) {
        const sameFields = Object.keys(fields).every((key) => semanticFingerprint((fields as any)[key]) === semanticFingerprint((duplicate as any)[key]));
        const requestedParties = partyInputs.map((item: any) => `${item.role}:${item.expediente_compareciente_id}`).sort();
        if (!sameFields || (duplicate.status === "CONFIRMED") !== (body.confirm === true) ||
          duplicate.requirement_id !== (body.requirement_id || null) ||
          semanticFingerprint(duplicate.acts.map((item) => item.expediente_acto_id).sort()) !== semanticFingerprint([...actIds].sort()) ||
          semanticFingerprint(duplicate.parties.map((item) => `${item.role}:${item.expediente_compareciente_id}`).sort()) !== semanticFingerprint(requestedParties) ||
          semanticFingerprint(duplicate.evidence.map((item) => item.evidence_id).sort()) !== semanticFingerprint([...evidenceIds].sort()))
          throw new ComplianceError("La clave de idempotencia corresponde a otros datos.", "H5_PAYMENT_IDEMPOTENCY_CONFLICT", 409);
        return duplicate;
      }
      if (
        payment?.currentRevision &&
        body.base_fingerprint !== payment.currentRevision.semantic_fingerprint
      )
        throw new ComplianceError(
          "El pago cambió; recarga antes de guardar.",
          "H5_PAYMENT_STALE",
          409,
        );
      if (!payment)
        payment = await tx.complianceOperationPayment.create({
          data: {
            organization_id: user.organizationId,
            expediente_id: review.expediente_id,
            created_by_id: user.id,
          },
          include: { currentRevision: true },
        });
      const acts = actIds.length
        ? await tx.expedienteActo.findMany({
            where: {
              id: { in: actIds },
              organization_id: user.organizationId,
              expediente_id: review.expediente_id,
              estatus: "ACTIVO",
              removed_at: null,
            },
            select: { id: true },
          })
        : [];
      if (acts.length !== actIds.length)
        throw new ComplianceError(
          "Uno o más actos no pertenecen al expediente.",
          "H5_PAYMENT_ACT_SCOPE_INVALID",
          403,
        );
      const partyLinks = partyInputs.length
        ? await tx.expedienteCompareciente.findMany({
            where: {
              id: {
                in: partyInputs.map((item: any) =>
                  String(item.expediente_compareciente_id),
                ),
              },
              organization_id: user.organizationId,
              expediente_id: review.expediente_id,
              archived_at: null,
              estatus: "ACTIVO",
              compareciente: { organization_id: user.organizationId, archived_at: null, ...comparecienteObjectWhere(user) },
            },
            select: { id: true, compareciente_id: true },
          })
        : [];
      if (
        partyLinks.length !==
        new Set(
          partyInputs.map((item: any) =>
            String(item.expediente_compareciente_id),
          ),
        ).size
      )
        throw new ComplianceError(
          "Una persona de pago no pertenece al expediente.",
          "H5_PAYMENT_PARTY_SCOPE_INVALID",
          403,
        );
      const evidences = evidenceIds.length
        ? await tx.complianceEvidence.findMany({
            where: {
              id: { in: evidenceIds },
              organization_id: user.organizationId,
              review_id: review.id,
              estatus: "ACTIVO",
              expediente_id: review.expediente_id,
            },
            include: { documento: true },
          })
        : [];
      if (evidences.length !== evidenceIds.length)
        throw new ComplianceError(
          "Una evidencia no pertenece a esta evaluación.",
          "H5_PAYMENT_EVIDENCE_SCOPE_INVALID",
          403,
        );
      if (evidences.length) requireH5Permission(user, "documentos.read");
      for (const evidence of evidences) {
        if (!(await canAccessDocumento(user, evidence.documento_id)) ||
          evidence.documento.organization_id !== user.organizationId ||
          evidence.documento.estatus !== "VIGENTE" ||
          !evidence.document_checksum_snapshot || evidence.document_checksum_snapshot !== evidence.documento.checksum_sha256)
          throw new ComplianceError("La evidencia no está autorizada o su versión cambió.", "H5_PAYMENT_EVIDENCE_DOCUMENT_DENIED", 403);
      }
      if (body.requirement_id) {
        const requirement = await tx.complianceRequirement.findFirst({ where: {
          id: body.requirement_id, organization_id: user.organizationId, review_id: review.id,
          expediente_id: review.expediente_id, provider: "PAG", target_compareciente_id: null,
          requirement_key: { in: ["PAG:OPERATION", "OPERATION", `PAG:PAYMENT:${payment.id}`, `PAYMENT:${payment.id}`] },
        } });
        if (!requirement) throw new ComplianceError("El requisito no corresponde a este pago de operación.", "H5_PAYMENT_REQUIREMENT_SCOPE_INVALID", 403);
      }
      const semantic = {
        ...fields,
        act_ids: actIds.sort(),
        parties: partyInputs
          .map((item: any) => ({
            relation_id: item.expediente_compareciente_id,
            role: item.role,
          }))
          .sort((a: any, b: any) =>
            `${a.role}:${a.relation_id}`.localeCompare(
              `${b.role}:${b.relation_id}`,
            ),
          ),
        evidence_ids: evidenceIds.sort(),
        evidence_versions: evidences.map((item) => ({ id: item.id, document_id: item.documento_id,
          version: item.documento.fecha_carga.toISOString(), checksum: item.document_checksum_snapshot })).sort((a, b) => a.id.localeCompare(b.id)),
      };
      const fingerprint = paymentSemanticFingerprint(semantic as any);
      const status =
        body.confirm === true ? ("CONFIRMED" as const) : ("DRAFT" as const);
      const currentRevision = payment.currentRevision;
      const revision = await tx.complianceOperationPaymentRevision.create({
        data: {
          organization_id: user.organizationId,
          payment_id: payment.id,
          expediente_id: review.expediente_id,
          review_id: review.id,
          requirement_id: body.requirement_id || null,
          revision_number: (currentRevision?.revision_number || 0) + 1,
          status,
          ...fields,
          semantic_fingerprint: fingerprint,
          base_revision_id: currentRevision?.id || null,
          idempotency_key: idempotencyKey,
          created_by_id: user.id,
          confirmed_by_id: status === "CONFIRMED" ? user.id : null,
          confirmed_at: status === "CONFIRMED" ? new Date() : null,
        },
      });
      if (acts.length)
        await tx.complianceOperationPaymentAct.createMany({
          data: acts.map((act) => ({
            organization_id: user.organizationId,
            payment_revision_id: revision.id,
            expediente_id: review.expediente_id,
            expediente_acto_id: act.id,
          })),
        });
      if (partyInputs.length)
        await tx.complianceOperationPaymentParty.createMany({
          data: partyInputs.map((item: any) => {
            const link = partyLinks.find(
              (candidate) =>
                candidate.id === String(item.expediente_compareciente_id),
            )!;
            if (!["PAYER", "PAYEE", "PROVIDER_RESOURCE"].includes(item.role))
              throw new ComplianceError(
                "El rol de pago no es válido.",
                "H5_PAYMENT_PARTY_ROLE_INVALID",
              );
            return {
              organization_id: user.organizationId,
              payment_revision_id: revision.id,
              expediente_id: review.expediente_id,
              expediente_compareciente_id: link.id,
              compareciente_id: link.compareciente_id,
              role: item.role,
            };
          }),
        });
      if (evidences.length)
        await tx.complianceOperationPaymentEvidence.createMany({
          data: evidences.map((item) => ({
            organization_id: user.organizationId,
            payment_revision_id: revision.id,
            evidence_id: item.id,
            relation_kind: "RECEIPT",
          })),
        });
      await tx.complianceOperationPayment.update({
        where: { id: payment.id },
        data: { current_revision_id: revision.id },
      });
      // Surface deferred scope failures inside the operation. The installed
      // Prisma driver can return the callback value after PostgreSQL rejects a
      // deferred COMMIT; do not acknowledge a revision that was rolled back.
      await tx.$executeRawUnsafe("SET CONSTRAINTS pravia_os.h5_payment_revision_scope_guard, pravia_os.h5_payment_act_scope_guard IMMEDIATE");
      if (status === "CONFIRMED")
        await evaluateH5PaymentRulesTx(
          tx,
          user,
          review,
          revision.id,
          correlationId,
        );
      // Capturing/revising facts is progress, not a successful documentary comparison.
      // Invalidate the operation requirement on every semantic revision.
      {
        await tx.complianceRequirement.updateMany({
          where: {
            organization_id: user.organizationId,
            review_id: review.id,
            provider: "PAG",
            requirement_key: "PAG:OPERATION",
          },
          data: { status: "EN_PROCESO" },
        });
        await recomputeCaseState(tx, user, review.id);
      }
      await tx.complianceEvent.create({
        data: {
          organization_id: user.organizationId,
          review_id: review.id,
          event_type:
            status === "CONFIRMED"
              ? "H5_PAYMENT_CONFIRMED"
              : "H5_PAYMENT_DRAFT_SAVED",
          actor_id: user.id,
          summary:
            status === "CONFIRMED"
              ? "Pago confirmado por una persona autorizada."
              : "Borrador de pago guardado.",
          detail: json({
            payment_id: payment.id,
            revision_id: revision.id,
            fingerprint,
          }),
          correlation_id: correlationId,
        },
      });
      await tx.auditLog.create({
        data: {
          organization_id: user.organizationId,
          user_id: user.id,
          accion:
            status === "CONFIRMED" ? "CONFIRM_H5_PAYMENT" : "SAVE_H5_PAYMENT",
          entidad: "ComplianceOperationPaymentRevision",
          entidad_id: revision.id,
          valores_nuevos: json({ payment_id: payment.id, status, fingerprint }),
          correlation_id: correlationId,
          session_id: user.sessionId,
        },
      });
      return revision;
    };
    return transaction ? execute(transaction) : prisma.$transaction(execute);
  }

  static async verifyPayment(
    user: User,
    paymentRevisionId: string,
    body: any,
    correlationId?: string,
  ) {
    requireH5Permission(user, "compliance.review");
    requireH5Permission(user, "documentos.read");
    if (body.confirm !== true)
      throw new ComplianceError("Confirma los hechos del instrumento antes de verificar.", "H5_PAYMENT_VERIFICATION_CONFIRM_REQUIRED");
    const documentId = required(body.project_document_id, "H5_PAYMENT_PROJECT_DOCUMENT_REQUIRED");
    const idempotencyKey = required(body.idempotency_key, "H5_PAYMENT_VERIFICATION_IDEMPOTENCY_REQUIRED");
    const currency = required(body.consideration_currency, "H5_PAYMENT_CONSIDERATION_CURRENCY_REQUIRED").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new ComplianceError("La moneda confirmada no es válida.", "H5_PAYMENT_CURRENCY_INVALID");
    if (!(await canAccessDocumento(user, documentId)))
      throw new ComplianceError("El documento no está disponible.", "H5_PAYMENT_DOCUMENT_NOT_FOUND", 404);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:verification:${user.organizationId}:${paymentRevisionId}`}))`);
      const revision = await tx.complianceOperationPaymentRevision.findFirst({
        where: { id: paymentRevisionId, organization_id: user.organizationId, status: "CONFIRMED",
          review: { expediente: { archived_at: null, ...expedienteAccessWhere(user) } } },
        include: { payment: true, evidence: { include: { evidence: { include: { documento: true } } } } },
      });
      if (!revision) throw new ComplianceError("El pago confirmado no está disponible.", "H5_PAYMENT_REVISION_NOT_FOUND", 404);
      await requireCurrentReview(tx, user, revision.review_id);
      if (revision.payment.current_revision_id !== revision.id)
        throw new ComplianceError("El pago cambió; verifica su revisión vigente.", "H5_PAYMENT_STALE", 409);
      // Exact canonical project version, never a receipt or arbitrary uploaded document.
      const document = await tx.documento.findFirst({
        where: { id: documentId, organization_id: user.organizationId, expediente_id: revision.expediente_id,
          tipo: "PROYECTO_ESCRITURA", estatus: "VIGENTE" },
      });
      if (!document?.checksum_sha256)
        throw new ComplianceError("Selecciona una versión vigente de proyecto con checksum.", "H5_PAYMENT_DOCUMENT_VERSION_REQUIRED", 409);
      const documentVersion = document.checksum_sha256;
      if (body.project_document_checksum !== document.checksum_sha256)
        throw new ComplianceError("La versión del instrumento cambió desde la revisión humana.", "H5_PAYMENT_PROJECT_STALE", 409);
      const currentPayments = await tx.complianceOperationPayment.findMany({
        where: { organization_id: user.organizationId, expediente_id: revision.expediente_id,
          currentRevision: { review_id: revision.review_id } },
        include: { currentRevision: { include: { verifications: { orderBy: { created_at: "desc" }, take: 1 }, evidence: { include: { evidence: { include: { documento: true } } } } } } },
      });
      const confirmed = currentPayments.map((payment) => payment.currentRevision).filter((payment): payment is NonNullable<typeof payment> => Boolean(payment && payment.status === "CONFIRMED"));
      if (!confirmed.some((payment) => payment.id === revision.id))
        throw new ComplianceError("El conjunto de pagos cambió.", "H5_PAYMENT_STALE", 409);
      const amounts = confirmed.map((payment) => {
        if (payment.currency_original === currency && payment.amount_original !== null) return payment.amount_original;
        if (currency === "MXN" && payment.equivalent_mxn !== null) return payment.equivalent_mxn;
        throw new ComplianceError("No se pueden comparar monedas sin conversión documentada.", "H5_PAYMENT_COMPARISON_CURRENCY_UNRESOLVED", 409);
      });
      const evidence = revision.evidence.map((link) => link.evidence);
      for (const item of evidence) {
        if (item.estatus !== "ACTIVO" || item.documento.estatus !== "VIGENTE" ||
          !item.document_checksum_snapshot || item.document_checksum_snapshot !== item.documento.checksum_sha256 ||
          !(await canAccessDocumento(user, item.documento_id)))
          throw new ComplianceError("Una evidencia cambió o ya no está autorizada.", "H5_PAYMENT_EVIDENCE_DOCUMENT_DENIED", 409);
      }
      const allRuleResults = await tx.complianceRuleResult.findMany({
        where: { organization_id: user.organizationId, review_id: revision.review_id, payment_revision_id: { in: confirmed.map((payment) => payment.id) },
          outcome_purpose: { in: ["PAYMENT_RESTRICTION", "PROVIDER_IDENTIFICATION"] } },
        include: { ruleRevision: true },
      });
      const ruleResults = allRuleResults.filter((result) => result.payment_revision_id === revision.id);
      const consideration = decimal(body.consideration_amount, "H5_PAYMENT_CONSIDERATION_INVALID");
      const instrumentPaid = decimal(body.instrument_paid, "H5_PAYMENT_INSTRUMENT_PAID_INVALID");
      const instrumentPending = decimal(body.instrument_pending, "H5_PAYMENT_INSTRUMENT_PENDING_INVALID");
      if (consideration === null || instrumentPaid === null || instrumentPending === null)
        throw new ComplianceError("Confirma contraprestación, importe pagado y pendiente sin inventar valores ausentes.", "H5_PAYMENT_INSTRUMENT_FACTS_REQUIRED", 409);
      const comparison = comparePaymentFacts({ consideration, payments: amounts, instrument_paid: instrumentPaid, instrument_pending: instrumentPending });
      const legalReview = await scopedReview(tx, user, revision.review_id);
      const ruleConfigurationFingerprint = legalConfigurationFingerprint(await effectiveH5LegalRevisions(tx, user, legalReview.fecha_operacion));
      const snapshot = {
        ...comparison, currency, payment_revision_fingerprint: revision.semantic_fingerprint,
        documentary_review: evidence.length ? "EVIDENCE_PRESENT" : "EVIDENCE_MISSING",
        rule_configuration_fingerprint: ruleConfigurationFingerprint,
        confirmed_payments: confirmed.map((payment) => ({ id: payment.id, fingerprint: payment.semantic_fingerprint })).sort((a, b) => a.id.localeCompare(b.id)),
        evidence: evidence.map((item) => ({ id: item.id, document_id: item.documento_id, version: item.document_version, checksum: item.document_checksum_snapshot })).sort((a, b) => a.id.localeCompare(b.id)),
        rules: ruleResults.map((result) => ({ id: result.id, revision_id: result.rule_revision_id, checksum: result.ruleRevision.checksum })).sort((a, b) => a.id.localeCompare(b.id)),
        consideration: consideration.toString(), instrument_paid: instrumentPaid.toString(), instrument_pending: instrumentPending.toString(),
      };
      const fingerprint = semanticFingerprint({ document_id: document.id, version: documentVersion, checksum: document.checksum_sha256, snapshot });
      const existing = await tx.complianceOperationPaymentVerification.findFirst({ where: {
        organization_id: user.organizationId, payment_revision_id: revision.id,
        OR: [{ idempotency_key: idempotencyKey }, { semantic_fingerprint: fingerprint }],
      } });
      if (existing) {
        if (existing.semantic_fingerprint !== fingerprint) throw new ComplianceError("La clave corresponde a otros hechos confirmados.", "H5_PAYMENT_VERIFICATION_IDEMPOTENCY_CONFLICT", 409);
        return existing;
      }
      const created = await tx.complianceOperationPaymentVerification.create({ data: {
        organization_id: user.organizationId, payment_revision_id: revision.id, project_document_id: document.id,
        project_document_version: documentVersion, project_document_checksum: document.checksum_sha256,
        consideration_amount: consideration, consideration_currency: currency, instrument_paid: instrumentPaid, instrument_pending: instrumentPending,
        comparison_snapshot: json(snapshot), status: evidence.length ? comparison.status : "REVIEW_REQUIRED", semantic_fingerprint: fingerprint,
        idempotency_key: idempotencyKey, created_by_id: user.id, confirmed_by_id: user.id, confirmed_at: new Date(),
      } });
      if (ruleResults.length) await tx.complianceOperationPaymentVerificationRule.createMany({ data: ruleResults.map((result) => ({
        organization_id: user.organizationId, verification_id: created.id, rule_result_id: result.id,
      })) });
      let complete = confirmed.length > 0 && confirmed.length === currentPayments.length;
      for (const payment of confirmed) {
        const latest = payment.id === revision.id ? created : payment.verifications?.[0];
        const currentEvidence = [];
        for (const link of payment.evidence || []) {
          const source = link.evidence;
          if (source.estatus === "ACTIVO" && source.documento.estatus === "VIGENTE" && source.document_checksum_snapshot === source.documento.checksum_sha256 && await canAccessDocumento(user, source.documento_id))
            currentEvidence.push({ id: source.id, document_id: source.documento_id, version: source.document_version, checksum: source.document_checksum_snapshot });
        }
        if (!latest || latest.status !== "MATCH" || !currentEvidence.length || paymentVerificationIsStale(latest, {
          currentReview: true, paymentRevisionId: payment.id, paymentFingerprint: payment.semantic_fingerprint,
          project: { id: document.id, checksum: document.checksum_sha256 },
          payments: confirmed.map((item) => ({ id: item.id, fingerprint: item.semantic_fingerprint })), evidence: currentEvidence,
          rules: allRuleResults.filter((result) => result.payment_revision_id === payment.id).map((result) => ({ id: result.id, revision_id: result.rule_revision_id, checksum: result.ruleRevision.checksum })),
          ruleConfigurationFingerprint,
        })) complete = false;
      }
      await tx.complianceRequirement.updateMany({ where: { organization_id: user.organizationId, review_id: revision.review_id,
        provider: "PAG", requirement_key: "PAG:OPERATION" }, data: { status: complete ? "CUMPLIDO" : "EN_PROCESO" } });
      await recomputeCaseState(tx, user, revision.review_id);
      await tx.auditLog.create({ data: {
        organization_id: user.organizationId, user_id: user.id, accion: "VERIFY_H5_PAYMENT_AGAINST_INSTRUMENT",
        entidad: "ComplianceOperationPaymentVerification", entidad_id: created.id, valores_nuevos: json({ status: created.status, fingerprint }),
        correlation_id: correlationId, session_id: user.sessionId,
      } });
      return created;
    });
  }

  static async confirmProvider(
    user: User,
    paymentRevisionId: string,
    relationId: string,
    body: any,
    correlationId?: string,
  ) {
    requireH5Permission(user, "compliance.review");
    requireH5Permission(user, "expedientes.write");
    requireH5Permission(user, "comparecientes.read");
    if (body.confirm !== true) throw new ComplianceError("Confirma expresamente el rol adicional.", "H5_PROVIDER_CONFIRM_REQUIRED");
    return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:provider:${user.organizationId}:${paymentRevisionId}:${relationId}`}))`);
    const revision = await tx.complianceOperationPaymentRevision.findFirst({
      where: {
        id: paymentRevisionId,
        organization_id: user.organizationId,
        status: "CONFIRMED",
        review: {
          expediente: { archived_at: null, ...expedienteAccessWhere(user) },
        },
      },
      include: { payment: true },
    });
    if (!revision)
      throw new ComplianceError(
        "El pago confirmado no está disponible.",
        "H5_PROVIDER_PAYMENT_NOT_FOUND",
        404,
      );
    await requireCurrentReview(tx, user, revision.review_id);
    if (revision.payment.current_revision_id !== revision.id)
      throw new ComplianceError("El pago cambió; revisa la relación vigente.", "H5_PROVIDER_PAYMENT_STALE", 409);
    const party = await tx.complianceOperationPaymentParty.findFirst({
      where: {
        organization_id: user.organizationId,
        payment_revision_id: revision.id,
        expediente_compareciente_id: relationId,
        role: "PROVIDER_RESOURCE",
      },
    });
    if (!party)
      throw new ComplianceError(
        "La persona no está vinculada como proveedora de recursos.",
        "H5_PROVIDER_PARTY_NOT_FOUND",
        404,
      );
    const result = await tx.complianceRuleResult.findFirst({
      where: {
        id: required(body.rule_result_id, "H5_PROVIDER_RULE_RESULT_REQUIRED"),
        organization_id: user.organizationId,
        review_id: revision.review_id,
        payment_revision_id: revision.id,
        subject_compareciente_id: party.compareciente_id,
        outcome_purpose: "PROVIDER_IDENTIFICATION",
        context_kind: "PAYMENT_PARTY",
        applicability: { in: ["APLICA_SIN_AVISO", "APLICA_CON_AVISO"] },
        ruleRevision: { verified_by_id: { not: null }, verified_at: { not: null }, activated_at: { not: null },
          rule: { kind: "PROVIDER_IDENTIFICATION" } },
      },
      include: { ruleRevision: true },
    });
    if (!result)
      throw new ComplianceError(
        "No existe una determinación jurídica versionada para esta persona y pago.",
        "H5_PROVIDER_RULE_RESULT_NOT_FOUND",
        409,
      );
      const legalReview = await scopedReview(tx, user, revision.review_id);
      const effectiveRules = await effectiveH5LegalRevisions(tx, user, legalReview.fecha_operacion);
      if (!effectiveRules.some((rule) => rule.id === result.rule_revision_id && rule.checksum === result.ruleRevision.checksum))
        throw new ComplianceError("La determinación jurídica cambió; actualiza la revisión antes de confirmar el rol.", "H5_PROVIDER_RULE_RESULT_STALE", 409);
      const linked = await new ExpedientePartiesService(
        prisma,
      ).linkAdditionalProviderRoleInTransaction(tx, user, {
        expedienteId: revision.expediente_id,
        sourceRelationId: relationId,
        paymentRevisionId: revision.id,
      });
      const relation = linked.relation;
      await ensureOperationScreeningForPartyTx(tx, {
        organizationId: user.organizationId,
        expedienteId: revision.expediente_id,
        relationId: relation.id,
        reviewId: revision.review_id,
        actorUserId: user.id,
        correlationId,
      });
      await tx.complianceRequirement.updateMany({ where: {
        organization_id: user.organizationId, review_id: revision.review_id, provider: "PAG",
        rule_result_id: result.id, target_compareciente_id: party.compareciente_id,
        requirement_key: { startsWith: `PAG:PROVIDER:${revision.payment_id}:` },
      }, data: { status: "CUMPLIDO" } });
      const providerDocuments = (result.ruleRevision.outcome as unknown as LegalRuleOutcome).when_true.document_requirements || [];
      if (providerDocuments.some((document) => document.action === "GO_TO_QUESTIONNAIRE" && document.target_scope === "EACH_RELEVANT_COMPARECIENTE")) {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:provider-cue:${user.organizationId}:${revision.review_id}:${party.compareciente_id}`}))`);
        const state = await tx.expedienteComplianceState.findFirst({ where: { organization_id: user.organizationId, current_review_id: revision.review_id } });
        if (!state) throw new ComplianceError("La evaluación cambió durante la confirmación.", "H5_REVIEW_STALE", 409);
        const currentRequirement = await tx.complianceRequirement.findFirst({ where: {
          organization_id: user.organizationId, review_id: revision.review_id, provider: "CUE",
          requirement_key: `CUE:PERSONAL:${party.compareciente_id}`,
        } });
        const trigger = { reason: "VERIFIED_PROVIDER_QUESTIONNAIRE_REQUIREMENT", rule_result_id: result.id,
          rule_revision_id: result.rule_revision_id, rule_checksum: result.ruleRevision.checksum, payment_revision_id: revision.id };
        const currentSource = currentRequirement?.source_snapshot && typeof currentRequirement.source_snapshot === "object"
          ? currentRequirement.source_snapshot as Record<string, unknown> : {};
        const currentTriggers = Array.isArray(currentSource.triggers) ? currentSource.triggers : [];
        const triggers = [...currentTriggers];
        if (!triggers.some((item) => semanticFingerprint(item) === semanticFingerprint(trigger))) triggers.push(trigger);
        const sourceSnapshot = json({ h5_contract: "CUM-CUE-001", triggers });
        await tx.complianceRequirement.upsert({ where: { organization_id_review_id_provider_requirement_key: {
          organization_id: user.organizationId, review_id: revision.review_id, provider: "CUE", requirement_key: `CUE:PERSONAL:${party.compareciente_id}`,
        } }, create: {
          organization_id: user.organizationId, expediente_id: revision.expediente_id, state_id: state.id,
          review_id: revision.review_id, provider: "CUE", requirement_key: `CUE:PERSONAL:${party.compareciente_id}`,
          label: "Cuestionario personal", status: "PENDIENTE", target_compareciente_id: party.compareciente_id,
          source_snapshot: sourceSnapshot,
          is_documental: true, document_category: "CUESTIONARIOS_RIESGO", requires_signed_document: false, missing_action: "GO_TO_QUESTIONNAIRE",
        }, update: { source_snapshot: sourceSnapshot } });
      }
      await recomputeCaseState(tx, user, revision.review_id);
      if (linked.idempotent) return relation;
      await tx.complianceEvent.create({
        data: {
          organization_id: user.organizationId,
          review_id: revision.review_id,
          event_type: "H5_RESOURCE_PROVIDER_CONFIRMED",
          actor_id: user.id,
          summary: "Rol adicional de proveedor de recursos confirmado.",
          detail: json({
            payment_revision_id: revision.id,
            expediente_compareciente_id: relation.id,
            rule_result_id: result.id,
          }),
          correlation_id: correlationId,
        },
      });
      await tx.auditLog.create({
        data: {
          organization_id: user.organizationId,
          user_id: user.id,
          accion: "CONFIRM_H5_RESOURCE_PROVIDER",
          entidad: "ExpedienteCompareciente",
          entidad_id: relation.id,
          valores_nuevos: json({
            caracter: "PROVEEDOR_RECURSOS",
            additional_role: true,
            rule_result_id: result.id,
          }),
          correlation_id: correlationId,
          session_id: user.sessionId,
        },
      });
      return relation;
    });
  }

  static async preparePaymentProposal(
    user: User,
    reviewId: string,
    body: any,
    correlationId?: string,
  ) {
    requireH5Permission(user, "compliance.write");
    requireH5Permission(user, "ia.execute");
    requireH5Permission(user, "documentos.read");
    const review = await scopedReview(prisma, user, reviewId);
    await requireCurrentReview(prisma, user, review.id);
    const operationId = required(
      body.operation_id,
      "H5_PAYMENT_PROPOSAL_OPERATION_REQUIRED",
    );
    const existing = await prisma.complianceAiProposal.findFirst({
      where: {
        organization_id: user.organizationId,
        h5_operation_id: operationId,
      },
    });
    const documentIds: string[] = [
      ...new Set<string>(
        (Array.isArray(body.source_document_ids)
          ? body.source_document_ids
          : []
        ).map((item: unknown) => String(item)),
      ),
    ];
    if (!documentIds.length)
      throw new ComplianceError(
        "Selecciona al menos un documento fuente.",
        "H5_PAYMENT_PROPOSAL_SOURCE_REQUIRED",
      );
    for (const id of documentIds)
      if (!(await canAccessDocumento(user, id)))
        throw new ComplianceError("Un documento fuente no está disponible.", "H5_PAYMENT_PROPOSAL_SOURCE_NOT_FOUND", 404);
    if (existing) {
      const sourceIds = Array.isArray(existing.source_documents) ? existing.source_documents.map((item: any) => item.id).sort() : [];
      if (existing.review_id !== review.id || existing.payment_id !== (body.payment_id || null) ||
        semanticFingerprint(sourceIds) !== semanticFingerprint([...documentIds].sort()))
        throw new ComplianceError("La operación corresponde a otro contexto o fuentes.", "H5_PAYMENT_PROPOSAL_OPERATION_CONFLICT", 409);
      return paymentProposalView(existing);
    }
    for (const id of documentIds)
      if (!(await canAccessDocumento(user, id)))
        throw new ComplianceError(
          "Un documento fuente no está disponible.",
          "H5_PAYMENT_PROPOSAL_SOURCE_NOT_FOUND",
          404,
        );
    const evidences = await prisma.complianceEvidence.findMany({
      where: {
        organization_id: user.organizationId,
        review_id: review.id,
        documento_id: { in: documentIds },
        estatus: "ACTIVO",
        documento: {
          organization_id: user.organizationId,
          expediente_id: review.expediente_id,
          estatus: "VIGENTE",
        },
      },
      include: { documento: true },
    });
    if (
      new Set(evidences.map((item) => item.documento_id)).size !==
        documentIds.length ||
      evidences.some(
        (item) =>
          !item.documento.checksum_sha256 ||
          item.document_checksum_snapshot !== item.documento.checksum_sha256,
      )
    )
      throw new ComplianceError(
        "Las fuentes deben ser evidencia vigente, autorizada y conservar checksum estable.",
        "H5_PAYMENT_PROPOSAL_SOURCE_UNVERSIONED",
        409,
      );
    const documents = documentIds.map(
      (id) => evidences.find((item) => item.documento_id === id)!.documento,
    );
    const base = body.payment_id
      ? await prisma.complianceOperationPayment.findFirst({
          where: {
            id: body.payment_id,
            organization_id: user.organizationId,
            expediente_id: review.expediente_id,
          },
          include: { currentRevision: true },
        })
      : null;
    if (body.payment_id && !base)
      throw new ComplianceError("El pago no está disponible.", "H5_PAYMENT_NOT_FOUND", 404);
    const startedAt = Date.now();
    const extractions: FinancialDocumentExtractionResult[] = [];
    const usageOperationId = `h5:${user.organizationId}:${review.id}:${operationId}:${randomUUID()}`;
    try {
      for (const document of documents) {
        const extraction = await extraerFinanzasDesdeDocumento({
            buffer: await downloadFile(document.storage_key),
            mimeType: document.mime_type,
            tipoDocumento: document.tipo,
            documentoId: document.id,
            nombreOriginal: document.nombre_original,
          }, "H5_OPERATION_PAYMENT");
        extractions.push(extraction);
        await recordAIUsages([extraction.uso], {
          organizationId: user.organizationId, usuarioId: user.id, expedienteId: review.expediente_id,
          operacion: "H5_PAYMENT_DOCUMENT_EXTRACTION", operationId: `${usageOperationId}:${document.id}`,
          metadata: { source_count: 1, questionnaire_answers_sent: false, auto_write: false },
        });
      }
    } catch (error) {
      await recordAIFailure({
        organizationId: user.organizationId,
        usuarioId: user.id,
        expedienteId: review.expediente_id,
        operacion: "H5_PAYMENT_DOCUMENT_EXTRACTION",
        operationId: `${usageOperationId}:failure`,
        modelo: getOpenAIModelName(),
        durationMs: Date.now() - startedAt,
        errorCode: "H5_PAYMENT_AI_FAILED",
        metadata: { source_count: documents.length },
      }).catch(() => undefined);
      throw new ComplianceError(
        "No fue posible preparar la propuesta. Los pagos permanecen sin cambios.",
        "H5_PAYMENT_AI_FAILED",
        502,
      );
    }
    const merged = mergePaymentDocumentExtractions(
      documents.map((document, index) => ({
        document_id: document.id,
        version: document.fecha_carga.toISOString(),
        checksum: document.checksum_sha256!,
        model: extractions[index].modelo,
        // Locators remain document/page based: never duplicate raw receipt OCR.
        fields: extractions[index].campos.map((field) => ({ ...field, fragmento: null })),
        missing: extractions[index].faltantes,
        conflicts: extractions[index].conflictos,
      })),
    );
    const content: Record<string, any> = { ...merged.content };
    const provenance = merged.provenance;
    const extractedAccount = content.account_number;
    if (extractedAccount) {
      const secret = process.env.PAYMENT_ACCOUNT_FINGERPRINT_SECRET || process.env.AUTH_JWT_SECRET;
      if (!secret) throw new ComplianceError("No está configurada la protección de cuentas.", "H5_PAYMENT_FINGERPRINT_SECRET_REQUIRED", 503);
      Object.assign(content, accountSafeValues(extractedAccount, secret));
    }
    delete content.account_number;
    provenance.account_number = (provenance.account_number || []).map((entry: any) => {
      const { value, locator: _locator, ...lineage } = entry;
      return { ...lineage, account_last4: String(value || "").replace(/\D/g, "").slice(-4) };
    });
    const fingerprint = semanticFingerprint({
      content,
      documents: documents.map((item) => ({
        id: item.id,
        checksum: item.checksum_sha256,
      })),
    });
    const proposal = await prisma.complianceAiProposal.create({
      data: {
        organization_id: user.organizationId,
        review_id: review.id,
        expediente_id: review.expediente_id,
        payment_id: base?.id || null,
        base_payment_revision_id: base?.current_revision_id || null,
        proposal_type: "H5_PAYMENT_EXTRACTION_PREPARE_ONLY",
        content: json(content),
        source_document_id: documents[0].id,
        source_document_version: documents[0].fecha_carga.toISOString(),
        source_document_checksum: documents[0].checksum_sha256,
        source_documents: json(
          documents.map((item) => ({
            id: item.id,
            version: item.fecha_carga.toISOString(),
            checksum: item.checksum_sha256,
          })),
        ),
        source_pages: json(extractions.flatMap((item) => item.campos.map((field) => field.pagina).filter((page) => page != null))),
        field_provenance: json(provenance),
        base_fingerprint: base?.currentRevision?.semantic_fingerprint || null,
        proposal_fingerprint: fingerprint,
        confidence: null,
        model: [...new Set(extractions.map((item) => item.modelo))].join(",").slice(0, 120),
        prompt_version:
          "h5-payment-prepare-v1",
        h5_operation_id: operationId,
        requested_by_id: user.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        organization_id: user.organizationId,
        user_id: user.id,
        accion: "PREPARE_H5_PAYMENT_AI_PROPOSAL",
        entidad: "ComplianceAiProposal",
        entidad_id: proposal.id,
        valores_nuevos: json({
          proposal_fingerprint: fingerprint,
          source_count: documents.length,
          silent_write: false,
        }),
        correlation_id: correlationId,
        session_id: user.sessionId,
      },
    });
    return paymentProposalView(proposal);
  }

  static async confirmPaymentProposal(
    user: User,
    proposalId: string,
    body: any,
    correlationId?: string,
  ) {
    requireH5Permission(user, "compliance.review");
    requireH5Permission(user, "compliance.write");
    requireH5Permission(user, "documentos.read");
    if (!body.confirmed_fields || typeof body.confirmed_fields !== "object" || Array.isArray(body.confirmed_fields))
      throw new ComplianceError("Confirma expresamente los campos revisados.", "H5_PAYMENT_REVIEWED_FIELDS_REQUIRED");
    return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:proposal:${user.organizationId}:${proposalId}`}))`);
    const proposal = await tx.complianceAiProposal.findFirst({
      where: {
        id: proposalId,
        organization_id: user.organizationId,
        status: { in: ["PROPUESTA_REQUIERE_CONFIRMACION", "CONFIRMADA_POR_HUMANO"] },
        proposal_type: "H5_PAYMENT_EXTRACTION_PREPARE_ONLY",
      },
    });
    if (
      !proposal ||
      proposal.proposal_fingerprint !== body.proposal_fingerprint
    )
      throw new ComplianceError(
        "La propuesta no está disponible o cambió.",
        "H5_PAYMENT_PROPOSAL_STALE",
        409,
      );
    await scopedReview(tx, user, proposal.review_id);
    await requireCurrentReview(tx, user, proposal.review_id);
    const requestFingerprint = semanticFingerprint({ proposal: proposal.proposal_fingerprint, fields: body.confirmed_fields, idempotency_key: body.idempotency_key });
    const sourceDocuments = Array.isArray(proposal.source_documents)
      ? (proposal.source_documents as Array<{ id: string; checksum: string; version: string }>)
      : [];
    const currentSources = await tx.documento.findMany({
      where: {
        organization_id: user.organizationId,
        id: { in: sourceDocuments.map((item) => item.id) },
        estatus: "VIGENTE",
      },
      select: { id: true, checksum_sha256: true, fecha_carga: true },
    });
    if (
      !sourceDocuments.length || currentSources.length !== sourceDocuments.length ||
      sourceDocuments.some(
        (source) =>
          currentSources.find((item) => item.id === source.id)
            ?.checksum_sha256 !== source.checksum ||
          currentSources.find((item) => item.id === source.id)?.fecha_carga.toISOString() !== source.version,
      )
    )
      throw new ComplianceError(
        "Una fuente documental cambió después de crear la propuesta.",
        "H5_PAYMENT_PROPOSAL_SOURCE_STALE",
        409,
      );
    for (const source of sourceDocuments)
      if (!(await canAccessDocumento(user, source.id)))
        throw new ComplianceError("Una fuente documental ya no está autorizada.", "H5_PAYMENT_PROPOSAL_SOURCE_DENIED", 403);
    const evidences = await tx.complianceEvidence.findMany({ where: {
      organization_id: user.organizationId, review_id: proposal.review_id, expediente_id: proposal.expediente_id,
      documento_id: { in: sourceDocuments.map((item) => item.id) }, estatus: "ACTIVO",
    } });
    if (sourceDocuments.some((source) => !evidences.some((evidence) => evidence.documento_id === source.id && evidence.document_checksum_snapshot === source.checksum)))
      throw new ComplianceError("Una fuente ya no es evidencia vigente de esta evaluación.", "H5_PAYMENT_PROPOSAL_SOURCE_STALE", 409);
    if (proposal.status === "CONFIRMADA_POR_HUMANO") {
      // Reuse the canonical audit trail for a lost-response retry. No second
      // proposal ledger and no reapplication against a later payment revision.
      const decision = await tx.auditLog.findFirst({ where: { organization_id: user.organizationId,
        entidad: "ComplianceAiProposal", entidad_id: proposal.id, accion: "CONFIRM_H5_PAYMENT_AI_PROPOSAL" }, orderBy: { created_at: "desc" } });
      const snapshot = decision?.valores_nuevos as Record<string, any> | null;
      if (snapshot?.request_fingerprint !== requestFingerprint)
        throw new ComplianceError("La propuesta ya fue confirmada con otros datos.", "H5_PAYMENT_PROPOSAL_IDEMPOTENCY_CONFLICT", 409);
      const confirmed = await tx.complianceOperationPaymentRevision.findFirst({ where: {
        id: snapshot.revision_id, organization_id: user.organizationId, review_id: proposal.review_id, status: "CONFIRMED",
      } });
      if (!confirmed) throw new ComplianceError("La confirmación anterior no está disponible.", "H5_PAYMENT_PROPOSAL_STALE", 409);
      return confirmed;
    }
    if (proposal.payment_id) {
      const payment = await tx.complianceOperationPayment.findFirst({
        where: {
          id: proposal.payment_id,
          organization_id: user.organizationId,
        },
        include: { currentRevision: true },
      });
      if (
        payment?.currentRevision?.semantic_fingerprint !==
        proposal.base_fingerprint
      )
        throw new ComplianceError(
          "El pago cambió después de crear la propuesta.",
          "H5_PAYMENT_PROPOSAL_BASE_STALE",
          409,
        );
    }
    const proposedContent = proposal.content as Record<string, any>;
    const acceptAccount = body.confirmed_fields.accept_extracted_account === true;
    if (acceptAccount && (body.confirmed_fields.account_number || body.confirmed_fields.field_states?.account_number === "CONFIRMED_UNKNOWN" ||
      !proposedContent.account_fingerprint || !proposedContent.account_last4))
      throw new ComplianceError("La cuenta extraída no está disponible o contradice la revisión humana.", "H5_PAYMENT_PROPOSAL_ACCOUNT_INVALID", 409);
    const revision = await this.createPaymentRevision(
      user,
      proposal.review_id,
      {
        ...body.confirmed_fields,
        payment_id: proposal.payment_id,
        base_fingerprint: proposal.base_fingerprint,
        idempotency_key: required(
          body.idempotency_key,
          "H5_PAYMENT_IDEMPOTENCY_REQUIRED",
        ),
        confirm: true,
        source: "AI_PROPOSAL_HUMAN_CONFIRMED",
        evidence_ids: evidences.map((item) => item.id),
      },
      correlationId,
      tx,
      acceptAccount ? { account_last4: proposedContent.account_last4, account_fingerprint: proposedContent.account_fingerprint } : undefined,
    );
    await tx.complianceAiProposal.update({
      where: { id: proposal.id },
      data: {
        status: "CONFIRMADA_POR_HUMANO",
        decided_by_id: user.id,
        decided_at: new Date(),
      },
    });
    await tx.auditLog.create({ data: {
      organization_id: user.organizationId, user_id: user.id, accion: "CONFIRM_H5_PAYMENT_AI_PROPOSAL",
      entidad: "ComplianceAiProposal", entidad_id: proposal.id,
      valores_nuevos: json({ revision_id: revision.id, proposal_fingerprint: proposal.proposal_fingerprint, request_fingerprint: requestFingerprint }),
      correlation_id: correlationId, session_id: user.sessionId,
    } });
    return revision;
    });
  }

  static async rejectPaymentProposal(
    user: User,
    proposalId: string,
    body: any,
    correlationId?: string,
  ) {
    requireH5Permission(user, "compliance.review");
    return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:proposal:${user.organizationId}:${proposalId}`}))`);
    const proposal = await tx.complianceAiProposal.findFirst({
      where: {
        id: proposalId,
        organization_id: user.organizationId,
        status: "PROPUESTA_REQUIERE_CONFIRMACION",
        proposal_type: "H5_PAYMENT_EXTRACTION_PREPARE_ONLY",
      },
    });
    if (
      !proposal ||
      proposal.proposal_fingerprint !== body.proposal_fingerprint
    )
      throw new ComplianceError(
        "La propuesta no está disponible o cambió.",
        "H5_PAYMENT_PROPOSAL_STALE",
        409,
      );
    await scopedReview(tx, user, proposal.review_id);
    await requireCurrentReview(tx, user, proposal.review_id);
      const rejected = await tx.complianceAiProposal.update({
        where: { id: proposal.id },
        data: {
          status: "RECHAZADA_POR_HUMANO",
          decided_by_id: user.id,
          decided_at: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          organization_id: user.organizationId,
          user_id: user.id,
          accion: "REJECT_H5_PAYMENT_AI_PROPOSAL",
          entidad: "ComplianceAiProposal",
          entidad_id: proposal.id,
          valores_nuevos: json({
            proposal_fingerprint: proposal.proposal_fingerprint,
            payment_mutated: false,
            reason_recorded: Boolean(text(body.reason, 500)),
          }),
          correlation_id: correlationId,
          session_id: user.sessionId,
        },
      });
      return rejected;
    });
  }

  static legacyPaymentGone() {
    throw new ComplianceError(
      "El registro de pagos anterior fue retirado. Usa el flujo versionado de pagos del expediente.",
      "H5_LEGACY_PAYMENT_ENDPOINT_RETIRED",
      410,
    );
  }

  static async questionnairePdf(user: User, assessmentId: string, persist = false) {
    requireH5Permission(user);
    requireH5Permission(user, "documentos.read");
    if (persist) { requireH5Permission(user, "compliance.write"); requireH5Permission(user, "documentos.write"); }
    const assessment = await prisma.complianceQuestionnaireAssessment.findFirst(
      {
        where: {
          id: assessmentId,
          organization_id: user.organizationId,
          ...questionnaireObjectScope(user),
          review: {
            expediente: { archived_at: null, ...expedienteAccessWhere(user) },
          },
        },
        include: {
          currentRevision: true,
          definitionVersion: true,
          requirement: { select: { label: true } },
          review: {
            select: { expediente: { select: { numero_pravia: true } } },
          },
        },
      },
    );
    if (
      !assessment?.currentRevision ||
      assessment.currentRevision.status !== "FINALIZED"
    )
      throw new ComplianceError(
        "Finaliza el cuestionario antes de generar su resumen.",
        "H5_QUESTIONNAIRE_PDF_NOT_READY",
        409,
      );
    const evaluation = assessment.currentRevision.evaluation_snapshot as any;
    const revision = assessment.currentRevision;
    const definition = validateQuestionnaireDefinition(assessment.definitionVersion.definition_json);
    const answers = revision.answers as Record<string, any>;
    const renderAnswer = (question: { type: string; options?: { code: string; label: string }[] }, value: unknown) => {
      if (value == null || value === "") return "Sin respuesta (no requerida)";
      if (typeof value === "boolean") return value ? "Sí" : "No";
      const label = (item: unknown) => question.options?.find((option) => option.code === item)?.label || String(item);
      return Array.isArray(value) ? value.map(label).join("; ") : label(value);
    };
    const provenance = {
      h5_contract: "CUM-CUE-001", internal: true, official: false, requires_signed_document: false,
      assessment_id: assessment.id, revision_id: revision.id, revision_number: revision.revision_number,
      definition_id: revision.definition_version_id, definition_checksum: revision.definition_checksum,
      answers_fingerprint: revision.semantic_fingerprint, methodology_revision_id: revision.methodology_revision_id,
      methodology_checksum: evaluation?.methodology_checksum, result: evaluation,
    };
    const lines = [
      "PRAVIA OS - Resumen interno de cuestionario",
      `Expediente: ${assessment.review.expediente.numero_pravia}`,
      `Cuestionario: ${assessment.requirement.label}`,
      `Revision: ${assessment.currentRevision.revision_number}`,
      "Completitud: Completo",
      `Resultado interno: ${evaluation?.output_label || "Sin resultado"}`,
      "Documento interno. No es formato oficial ni requiere firma por defecto.",
      ...definition.sections.flatMap((section) => ["", section.label,
        ...(section.questions || []).map((question) => `${question.label}: ${renderAnswer(question, answers[question.id])}`),
        ...(section.repeatable_groups || []).flatMap((group) => [group.label,
          ...(Array.isArray(answers[group.id]) ? answers[group.id] : []).flatMap((row: any, index: number) => [
            `Registro ${index + 1}`, ...group.questions.map((question) => `${question.label}: ${renderAnswer(question, row[question.id])}`),
          ]),
        ]),
      ]),
      "", "Procedencia de la revisión exacta",
      `Assessment: ${assessment.id} / Revision: ${revision.id}`,
      `Definición: ${revision.definition_version_id} / SHA-256: ${revision.definition_checksum}`,
      `Huella de respuestas: ${revision.semantic_fingerprint}`,
      `Metodología: ${revision.methodology_revision_id} / SHA-256: ${evaluation?.methodology_checksum || "No disponible"}`,
    ];
    const buffer = renderH5QuestionnairePdf(lines);
    const fileName = `cuestionario-${assessment.id}-v${revision.revision_number}.pdf`;
    if (!persist) return { buffer, fileName };
    const digest = createHash("sha256").update(buffer).digest("hex");
    const lookup = { organization_id: user.organizationId, review_id: assessment.review_id, requirement_id: assessment.requirement_id,
      tipo_evidencia: "CUM_CUE_INTERNO", estatus: "ACTIVO" as const, document_checksum_snapshot: digest };
    const prior = await prisma.complianceEvidence.findFirst({ where: lookup, include: { documento: true } });
    if (prior) {
      if (!(await canAccessDocumento(user, prior.documento_id))) throw new ComplianceError("El documento interno no está autorizado.", "H5_QUESTIONNAIRE_DOCUMENT_DENIED", 403);
      return { buffer: await downloadFile(prior.documento.storage_key), fileName: prior.documento.nombre_original };
    }
    const storageKey = `organizations/${user.organizationId}/documentos/${randomUUID()}.pdf`;
    await uploadFile(buffer, storageKey, "application/pdf");
    try {
      const stored = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`h5:questionnaire-pdf:${user.organizationId}:${revision.id}`}))`);
        await scopedReview(tx, user, assessment.review_id);
        const winner = await tx.complianceEvidence.findFirst({ where: lookup, include: { documento: true } });
        if (winner) return { winner: true, document: winner.documento };
        const result = await ComplianceDocumentService.registerInternalRecordTx(tx, user, {
          reviewId: assessment.review_id, requirementId: assessment.requirement_id, expedienteId: assessment.expediente_id,
          targetComparecienteId: assessment.target_compareciente_id, sourceRevisionId: revision.id,
          storageKey, buffer, fileName, provenance: json(provenance),
        });
        await tx.auditLog.create({ data: { organization_id: user.organizationId, user_id: user.id,
          accion: "GENERATE_H5_INTERNAL_QUESTIONNAIRE_RECORD", entidad: "ComplianceEvidence", entidad_id: result.evidence.id,
          valores_nuevos: json({ revision_id: revision.id, document_id: result.document.id, checksum: digest, official: false, signed: false }), session_id: user.sessionId,
        } });
        return { winner: false, document: result.document };
      });
      if (stored.winner) {
        await deleteFile(storageKey);
        if (!(await canAccessDocumento(user, stored.document.id))) throw new ComplianceError("El documento interno no está autorizado.", "H5_QUESTIONNAIRE_DOCUMENT_DENIED", 403);
        return { buffer: await downloadFile(stored.document.storage_key), fileName: stored.document.nombre_original };
      }
      return { buffer, fileName };
    } catch (error) { await deleteFile(storageKey).catch(() => undefined); throw error; }
  }
}

export const h5PublicFingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function renderH5QuestionnairePdf(lines: string[]) {
  // Monospaced wrapping avoids truncating long answers/checksums. Spanish Latin
  // characters are encoded correctly; unsupported codepoints remain explicit.
  const wrapped = lines.flatMap((line) => {
    const normalized = line.replace(/[\r\n\t]+/g, " ").replace(/[^\x20-\x7e\xa0-\xff]/gu, (char) => `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`);
    return normalized.match(/.{1,88}/g) || [""];
  });
  const pages: string[][] = [];
  for (let start = 0; start < wrapped.length; start += 43) pages.push(wrapped.slice(start, start + 43));
  const escaped = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"];
  const children: number[] = [];
  for (const [index, page] of pages.entries()) {
    const pageId = objects.length + 1; const streamId = pageId + 1; children.push(pageId);
    const stream = `BT /F1 9 Tf 44 748 Td 15 TL ${page.map((line, row) => `${row ? "T* " : ""}(${escaped(line)}) Tj`).join(" ")} ET\nBT /F1 8 Tf 44 40 Td (Documento interno no oficial - Página ${index + 1}/${pages.length}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${children.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join(
      "\n",
    )}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
