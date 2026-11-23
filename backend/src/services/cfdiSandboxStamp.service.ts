import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { CfdiProvider, CfdiProviderDraft, CfdiProviderStampResult } from './cfdiProvider';
import { FinanceFiscalError, parseCfdi40Xml, validateUseCfdi, type FiscalActor } from './financeFiscal.service';
import { FacturamaSandboxError, validateFacturamaPayload, type FacturamaPayload } from './facturamaSandboxProvider';
import { sandboxRuntimeAllowed } from './cfdiRuntimeProvider';
import { cfdiSandboxPayload } from '../domain/cfdiSandboxPayload';
import { expedienteAccessWhere } from '../middleware/auth.middleware';
import { uploadFile, deleteFile } from './supabase.service';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
// PostgreSQL JSONB normalizes object key order. Hash the canonical value, not
// insertion order, so recovery validates the identical persisted snapshot.
export function sandboxSnapshotHash(value: unknown): string {
  const canonical = (item: any): any => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().filter((key) => item[key] !== undefined).map((key) => [key, canonical(item[key])])) : item;
  return hash(JSON.stringify(canonical(value)));
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const lock = (org: string, id: string) => Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:cfdi-draft-id:${org}:${id}`}))`;
const ready = new Set(['DRAFT', 'BORRADOR', 'PREFACTURA']);
const UUID = /^[0-9a-f-]{36}$/i;
type Intent = { status: 'IN_FLIGHT' | 'RECOVERY_REQUIRED' | 'COMPLETED'; attempt: string; lease?: string; payload: FacturamaPayload; sha256: string;
  started_at: string; provider_reference?: string; error_code?: string; completed_at?: string };

export function fiscalLocalDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** A provider call is never inside a long DB transaction. Its immutable intent
 * is committed first; on uncertain outcomes we reconcile rather than POST again.
 * This path cannot be enabled on production DB/Storage or use customer RFCs. */
export class CfdiSandboxStampService {
  constructor(private readonly db: PrismaClient, private readonly provider: CfdiProvider) {}

  private async access(tx: Prisma.TransactionClient, actor: FiscalActor, caseId: string | null) {
    if (!caseId) return;
    const row = await tx.expediente.findFirst({ where: { id: caseId, organization_id: actor.organizationId, archived_at: null,
      ...(actor.rol === 'FINANCIERO' ? {} : expedienteAccessWhere(actor as Parameters<typeof expedienteAccessWhere>[0])) }, select: { id: true } });
    if (!row) throw new FinanceFiscalError(404, 'CFDI_NOT_FOUND', 'Documento fiscal no encontrado.');
  }
  private audit(tx: Prisma.TransactionClient, actor: FiscalActor, id: string, action: string, detail: unknown, correlationId?: string) {
    return tx.auditLog.create({ data: { organization_id: actor.organizationId, user_id: actor.id, entidad: 'DocumentoCfdi', entidad_id: id,
      accion: action, valores_nuevos: json({ environment: 'SANDBOX', fiscal_validity: false, ...object(detail) }),
      correlation_id: correlationId && UUID.test(correlationId) ? correlationId : null } });
  }
  async stamp(actor: FiscalActor, id: string, input: Record<string, unknown>, correlationId?: string) {
    if (!actor.permissions.includes('finanzas.validate') || !actor.permissions.includes('documentos.write')) throw new FinanceFiscalError(403, 'CFDI_STAMP_FORBIDDEN', 'No tienes permiso para timbrar y guardar documentos.');
    if (!sandboxRuntimeAllowed() || !this.provider.configured || this.provider.id !== 'FACTURAMA_SANDBOX') throw new FinanceFiscalError(503, 'CFDI_SANDBOX_NOT_ENABLED', 'El timbrado de prueba sólo está habilitado en la base y Storage locales.');
    const claimed = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw(lock(actor.organizationId, id));
      const row = await tx.documentoCfdi.findFirst({ where: { id, organization_id: actor.organizationId }, include: { entidadFiscal: true } });
      if (!row) throw new FinanceFiscalError(404, 'CFDI_NOT_FOUND', 'Documento fiscal no encontrado.');
      await this.access(tx, actor, row.expediente_id);
      const saved = object(row.draft_payload), intent = saved.sandbox_stamp as Intent | undefined;
      if (row.estado === 'TIMBRADO_SANDBOX' && intent?.status === 'COMPLETED') return { row, intent, completed: true, recover: false };
      if (intent) {
        const expired = intent.status === 'IN_FLIGHT' && Date.now() - new Date(intent.started_at).getTime() > 180_000;
        if (intent.status === 'IN_FLIGHT' && !expired) throw new FinanceFiscalError(409, 'CFDI_STAMP_IN_PROGRESS', 'El intento ya está en curso. No se envió otra solicitud.');
        if (intent.status !== 'RECOVERY_REQUIRED' && !expired) throw new FinanceFiscalError(409, 'CFDI_STAMP_RECONCILIATION_REQUIRED', 'El resultado anterior requiere conciliación por folio; no se volverá a timbrar.');
        if (!intent.payload || sandboxSnapshotHash(intent.payload) !== intent.sha256) throw new FinanceFiscalError(409, 'CFDI_STAMP_SNAPSHOT_INVALID', 'El snapshot del intento no coincide con su huella.');
        const recovery: Intent = { ...intent, status: 'IN_FLIGHT', lease: randomUUID(), started_at: new Date().toISOString() };
        await tx.documentoCfdi.update({ where: { id }, data: { estado: 'TIMBRANDO_SANDBOX', draft_payload: json({ ...saved, sandbox_stamp: recovery }) } });
        return { row, intent: recovery, completed: false, recover: true };
      }
      if (row.source !== 'LOCAL_DRAFT' || !ready.has(row.estado) || row.uuid_fiscal || !row.entidadFiscal) throw new FinanceFiscalError(409, 'CFDI_DRAFT_NOT_STAMPABLE', 'Selecciona una prefactura completa que aún no se haya timbrado.');
      if (!input.expected_updated_at || new Date(String(input.expected_updated_at)).getTime() !== row.updated_at.getTime()) throw new FinanceFiscalError(409, 'CFDI_DRAFT_CHANGED', 'La prefactura cambió. Recárgala antes de timbrar.');
      let payload: FacturamaPayload;
      try { payload = cfdiSandboxPayload(row, row.entidadFiscal, fiscalLocalDate()); }
      catch (error) { throw new FinanceFiscalError(422, 'CFDI_DRAFT_INCOMPLETE', error instanceof Error ? error.message : 'Completa el borrador.'); }
      validateUseCfdi(row.uso_cfdi || '', row.receptor_regimen || '', row.receptor_rfc);
      validateFacturamaPayload({ version: '4.0', tipo: 'I', total: row.total.toFixed(2), emisorRfc: row.emisor_rfc, receptorRfc: row.receptor_rfc, metodoPago: row.metodo_pago as 'PUE' | 'PPD' }, payload);
      const next: Intent = { status: 'IN_FLIGHT', attempt: randomUUID(), lease: randomUUID(), payload, sha256: sandboxSnapshotHash(payload), started_at: new Date().toISOString() };
      await tx.documentoCfdi.update({ where: { id }, data: { estado: 'TIMBRANDO_SANDBOX', provider: this.provider.id, draft_payload: json({ ...saved, sandbox_stamp: next }) } });
      await this.audit(tx, actor, id, 'REQUEST_SANDBOX_CFDI', { attempt: next.attempt, payload_sha256: next.sha256, folio: payload.Folio }, correlationId);
      return { row, intent: next, completed: false, recover: false };
    });
    if (claimed.completed) {
      // Entity includes internal secret references and a BigInt sequence. It is
      // only needed for planning, never part of the public stamp response.
      const { entidadFiscal: _privateEntity, ...cfdi } = claimed.row;
      return { cfdi, idempotent: true, environment: 'SANDBOX', fiscalValidity: false };
    }
    const { row, intent } = claimed;
    const draft: CfdiProviderDraft = { version: '4.0', tipo: 'I', emisorRfc: row.emisor_rfc, receptorRfc: row.receptor_rfc,
      total: row.total.toFixed(2), metodoPago: row.metodo_pago as 'PUE' | 'PPD', facturamaPayload: intent.payload };
    let result: CfdiProviderStampResult | undefined;
    const uploaded: string[] = [];
    try {
      if (claimed.recover) {
        const recoveryProvider = this.provider as CfdiProvider & { recover?: (draft: CfdiProviderDraft, reference: string) => Promise<CfdiProviderStampResult> };
        if (!recoveryProvider.recover) throw new FinanceFiscalError(503, 'CFDI_RECOVERY_UNAVAILABLE', 'Este adaptador no permite recuperar archivos.');
        result = await recoveryProvider.recover(draft, intent.provider_reference || '');
      } else result = await this.provider.stamp(draft);
      const parsed = parseCfdi40Xml(result.xml);
      if (!result.pdf || result.pdf.subarray(0, 5).toString() !== '%PDF-' || parsed.uuid.toUpperCase() !== result.uuid.toUpperCase() || parsed.emisor.rfc !== row.emisor_rfc
        || parsed.receptor.rfc !== row.receptor_rfc || !parsed.total.eq(row.total) || parsed.folio !== intent.payload.Folio || parsed.moneda !== row.moneda) {
        throw new FinanceFiscalError(502, 'CFDI_STAMP_FILES_MISMATCH', 'Los archivos recibidos no corresponden a la prefactura. Se conserva el intento para recuperar.');
      }
      // Save the provider reference before Storage: a failure must remain recoverable.
      await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(lock(actor.organizationId, id));
        const current = await tx.documentoCfdi.findFirstOrThrow({ where: { id, organization_id: actor.organizationId } });
        const active = object(object(current.draft_payload).sandbox_stamp);
        if (active.lease !== intent.lease || active.status !== 'IN_FLIGHT') throw new FinanceFiscalError(409, 'CFDI_STAMP_CHANGED', 'Otro proceso está recuperando el mismo intento. Recarga el registro.');
        await tx.documentoCfdi.update({ where: { id }, data: { provider_reference: result!.providerReference,
          draft_payload: json({ ...object(current.draft_payload), sandbox_stamp: { ...intent, provider_reference: result!.providerReference } }) } });
      });
      const root = `organizations/${actor.organizationId}/fiscal/sandbox/${id}/${randomUUID()}`;
      await uploadFile(result.xml, `${root}.xml`, 'application/xml'); uploaded.push(`${root}.xml`);
      await uploadFile(result.pdf, `${root}.pdf`, 'application/pdf'); uploaded.push(`${root}.pdf`);
      return await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(lock(actor.organizationId, id));
        const current = await tx.documentoCfdi.findFirstOrThrow({ where: { id, organization_id: actor.organizationId } });
        const currentIntent = object(object(current.draft_payload).sandbox_stamp);
        if (currentIntent.attempt !== intent.attempt || currentIntent.lease !== intent.lease || currentIntent.status !== 'IN_FLIGHT') throw new FinanceFiscalError(409, 'CFDI_STAMP_CHANGED', 'El intento fue actualizado; recarga su resultado.');
        const docs: string[] = [];
        for (const [kind, buffer, path] of [['XML', result!.xml, `${root}.xml`], ['PDF', result!.pdf!, `${root}.pdf`]] as const) {
          const document = await tx.documento.create({ data: { organization_id: actor.organizationId, expediente_id: row.expediente_id,
            nombre_original: `${intent.payload.Folio}_PRUEBA.${kind.toLowerCase()}`, nombre_interno: path, storage_key: path,
            tipo: kind === 'XML' ? 'CFDI_XML' : 'CFDI_PDF', categoria: 'OTROS', mime_type: kind === 'XML' ? 'application/xml' : 'application/pdf',
            size_bytes: buffer.length, checksum_sha256: hash(buffer), subido_por_id: actor.id,
            observaciones: 'FACTURAMA SANDBOX — SIN VALIDEZ FISCAL; NO REPRESENTA TIMBRADO PRODUCTIVO' } });
          docs.push(document.id);
        }
        const cfdi = await tx.documentoCfdi.update({ where: { id }, data: { estado: 'TIMBRADO_SANDBOX', provider: this.provider.id,
          provider_reference: result!.providerReference, uuid_fiscal: parsed.uuid, folio: parsed.folio, fecha_emision: parsed.fechaEmision,
          fecha_timbrado: parsed.fechaTimbrado, xml_documento_id: docs[0], pdf_documento_id: docs[1],
          draft_payload: json({ ...object(current.draft_payload), sandbox_stamp: { ...intent, status: 'COMPLETED', provider_reference: result!.providerReference, completed_at: new Date().toISOString() } }) },
          include: { xmlDocumento: true, pdfDocumento: true } });
        // Never create a payment, REP or second receivable as a side effect.
        await this.audit(tx, actor, id, 'COMPLETE_SANDBOX_CFDI', { attempt: intent.attempt, uuid: parsed.uuid, xml_documento_id: docs[0], pdf_documento_id: docs[1], xml_sha256: hash(result!.xml), pdf_sha256: hash(result!.pdf!) }, correlationId);
        return { cfdi, idempotent: false, environment: 'SANDBOX', fiscalValidity: false };
      });
    } catch (error) {
      await Promise.all(uploaded.map((key) => deleteFile(key).catch(() => undefined)));
      const code = error instanceof FacturamaSandboxError || error instanceof FinanceFiscalError ? error.code : 'CFDI_SANDBOX_RECOVERY_REQUIRED';
      const reference = result?.providerReference || (error instanceof FacturamaSandboxError ? error.providerReference : undefined) || intent.provider_reference;
      await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(lock(actor.organizationId, id));
        const current = await tx.documentoCfdi.findFirst({ where: { id, organization_id: actor.organizationId } });
        if (!current) return;
        const active = object(object(current.draft_payload).sandbox_stamp);
        if (active.status === 'COMPLETED' || active.lease !== intent.lease) return;
        await tx.documentoCfdi.update({ where: { id }, data: { estado: 'RECUPERAR_SANDBOX', ...(reference ? { provider_reference: reference } : {}),
          draft_payload: json({ ...object(current.draft_payload), sandbox_stamp: { ...intent, status: 'RECOVERY_REQUIRED', error_code: code, ...(reference ? { provider_reference: reference } : {}) } }) } });
        await this.audit(tx, actor, id, 'RECOVER_SANDBOX_CFDI_REQUIRED', { attempt: intent.attempt, error_code: code, provider_reference: reference || null }, correlationId);
      });
      if (error instanceof FinanceFiscalError) throw error;
      if (error instanceof FacturamaSandboxError) throw new FinanceFiscalError(error.status, error.code, error.message);
      const failure = new FinanceFiscalError(502, 'CFDI_SANDBOX_RECOVERY_REQUIRED', 'No se completó el guardado. El intento queda conservado para recuperar sin emitir otro CFDI.');
      // Retain the cause for server-side diagnostics without serializing a raw
      // provider/Prisma response to the client or its AuditLog.
      Object.defineProperty(failure, 'cause', { value: error, enumerable: false });
      throw failure;
    }
  }
}
