import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { cotizacionObjectWhere, cotizacionReadWhere, prospectoObjectWhere, prospectoReadWhere, predioObjectWhere } from './objectAccess.service';
import { effectiveQuotePropertyValues, quotePropertyValuesPayload, type QuotePropertyRecord } from '../domain/quotePropertyValues';

type Actor = NonNullable<Request['user']>;
export type CommercialPropertyKind = 'cotizacion' | 'prospecto';
type Db = PrismaClient | Prisma.TransactionClient;
export class CommercialPropertyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new CommercialPropertyError(status, code, message); };
const frozen = (kind: CommercialPropertyKind, stage: unknown) => (kind === 'cotizacion'
  ? ['ACEPTADA', 'ACEPTO_ANTICIPO', 'CONVERTIDA_EXPEDIENTE']
  : ['CONVERTIDO_EN_COTIZACION', 'CONVERTIDO_COTIZACION', 'CANCELADO']).includes(String(stage));
const permission = (actor: Actor, kind: CommercialPropertyKind, write = false) => {
  if (!actor.permissions.includes(kind === 'cotizacion' ? write ? 'cotizaciones.write' : 'cotizaciones.read' : write ? 'prospectos.write' : 'prospectos.read'))
    fail(403, 'COMMERCIAL_PROPERTY_DENIED', 'No tienes permiso para esta operación.');
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const commercialPropertySelect = { id: true, apodo: true, clave_catastral: true, cuenta_predial: true,
  folio_real: true, ubicacion_texto: true, valor_operacion: true, valor_catastral: true, valor_avaluo: true,
  version: true, archived_at: true, updated_at: true } as const;

export class CommercialPropertyService {
  constructor(private readonly db: PrismaClient) {}
  private async source(db: Db, actor: Actor, kind: CommercialPropertyKind, id: string, write = false) {
    permission(actor, kind, write);
    const record = kind === 'cotizacion'
      ? await db.cotizacion.findFirst({ where: { id, ...(write ? cotizacionObjectWhere(actor) : cotizacionReadWhere(actor)) } })
      : await db.prospecto.findFirst({ where: { id, archived_at: null, ...(write ? prospectoObjectWhere(actor) : prospectoReadWhere(actor)) } });
    if (!record) return fail(404, 'COMMERCIAL_PROPERTY_NOT_FOUND', 'No se encontró el registro o está fuera de tu alcance.');
    return record;
  }
  async read(actor: Actor, kind: CommercialPropertyKind, id: string) {
    const record = await this.source(this.db, actor, kind, id);
    if (record.predio_principal_id && !actor.permissions.includes('expedientes.read')) fail(403, 'PROPERTY_READ_DENIED', 'No tienes permiso para consultar el inmueble vinculado.');
    const property = record.predio_principal_id ? await this.db.predio.findFirst({ where: {
      id: record.predio_principal_id, organization_id: actor.organizationId, ...predioObjectWhere(actor),
    }, select: commercialPropertySelect }) : null;
    if (record.predio_principal_id && !property) fail(409, 'PROPERTY_SOURCE_UNAVAILABLE', 'No fue posible consultar la ficha vinculada. No se utilizarán valores manuales como sustitutos.');
    const writable = await (kind === 'cotizacion' ? this.db.cotizacion.findFirst({where:{id,...cotizacionObjectWhere(actor)},select:{id:true}})
      : this.db.prospecto.findFirst({where:{id,...prospectoObjectWhere(actor)},select:{id:true}}));
    const canWrite = Boolean(writable && actor.permissions.includes(kind === 'cotizacion' ? 'cotizaciones.write' : 'prospectos.write') && !frozen(kind, record.etapa_contractual ?? record.estado));
    const manual: QuotePropertyRecord = kind === 'cotizacion' ? record as QuotePropertyRecord : {};
    const effective = effectiveQuotePropertyValues({ ...manual, predio_principal: property });
    return { property, source: property ? 'PREDIO_MASTER' : 'MANUAL', expected_updated_at: record.updated_at,
      values: { ...quotePropertyValuesPayload(effective), appraisalValue: effective.valor_avaluo == null ? null : String(effective.valor_avaluo) },
      capabilities: { canWrite, canCreateProperty: canWrite && actor.permissions.includes('expedientes.read') && actor.permissions.includes('expedientes.write'), canOpenProperty: actor.permissions.includes('expedientes.read') } };
  }
  async options(actor: Actor, kind: CommercialPropertyKind, id: string, search: string) {
    await this.source(this.db, actor, kind, id);
    if (!actor.permissions.includes('expedientes.read')) fail(403, 'PROPERTY_READ_DENIED', 'No tienes permiso para consultar el maestro de Predios.');
    const q = search.trim().slice(0, 120);
    return this.db.predio.findMany({ where: { organization_id: actor.organizationId, archived_at: null, ...predioObjectWhere(actor),
      ...(q ? { OR: ['apodo','clave_catastral','cuenta_predial','folio_real','ubicacion_texto'].map(field=>({[field]:{contains:q,mode:'insensitive'}})) } : {}) },
      select: commercialPropertySelect, orderBy:[{updated_at:'desc'},{id:'asc'}],take:25 });
  }
  async select(actor: Actor, kind: CommercialPropertyKind, id: string, raw: Record<string, unknown>) {
    permission(actor,kind,true);
    permission(actor,kind);
    if (Object.keys(raw).some(key=>!['predio_id','expected_updated_at','expected_property_version','confirm'].includes(key)) || raw.confirm !== true)
      fail(400,'PROPERTY_LINK_CONFIRMATION_REQUIRED','Revisa y confirma el inmueble que deseas vincular.');
    if (raw.predio_id !== null && (typeof raw.predio_id !== 'string' || !uuid.test(raw.predio_id))) fail(400,'PROPERTY_ID_INVALID','Selecciona un inmueble válido o desvincúlalo explícitamente.');
    const expected = new Date(String(raw.expected_updated_at || ''));
    if (Number.isNaN(expected.getTime())) fail(400,'PROPERTY_LINK_REVISION_REQUIRED','Actualiza la ficha antes de cambiar el inmueble.');
    await this.db.$transaction(async tx=>{
      // Match the workflow/conversion lock, so selecting and converting cannot race.
      const lock = kind === 'cotizacion' ? `pravia:cot001:${actor.organizationId}:${id}` : `pravia:pro001:${actor.organizationId}:${id}`;
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lock}))`);
      // Quote budget writes use a second canonical lock.
      if(kind === 'cotizacion') await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:quote-budget:${actor.organizationId}:${id}`}))`);
      const current=await this.source(tx,actor,kind,id,true);
      if(frozen(kind,current.etapa_contractual ?? current.estado)) fail(409,'PROPERTY_LINK_FROZEN','El registro aceptado, convertido o cerrado conserva su inmueble.');
      if(current.updated_at.getTime()!==expected.getTime()) fail(409,'PROPERTY_LINK_STALE','El registro cambió en otra sesión. Recarga antes de confirmar.');
      if(raw.predio_id){
        if(!actor.permissions.includes('expedientes.read')) fail(403,'PROPERTY_READ_DENIED','No tienes permiso para seleccionar un inmueble.');
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`pravia:predio-master:${actor.organizationId}:${raw.predio_id}`}))`);
        const property=await tx.predio.findFirst({where:{id:raw.predio_id as string,organization_id:actor.organizationId,archived_at:null,...predioObjectWhere(actor)},select:commercialPropertySelect});
        if(!property) fail(404,'PROPERTY_SOURCE_NOT_FOUND','El inmueble no está disponible en esta Notaría.');
        if(!Number.isSafeInteger(raw.expected_property_version)||property!.version!==raw.expected_property_version) fail(409,'PROPERTY_SOURCE_STALE','La ficha del inmueble cambió. Vuelve a seleccionarla y revisa sus valores.');
      }
      const data={predio_principal_id:raw.predio_id as string|null,updated_at:new Date(Math.max(Date.now(),current.updated_at.getTime()+1))};
      if(kind==='cotizacion') await tx.cotizacion.update({where:{id},data});
      else await tx.prospecto.update({where:{id},data});
      await tx.auditLog.create({data:{organization_id:actor.organizationId,user_id:actor.id,session_id:actor.sessionId,
        accion:'COMMERCIAL_PROPERTY_SELECTED',entidad:kind==='cotizacion'?'Cotizacion':'Prospecto',entidad_id:id,
        valores_anteriores:json({predio_id:current.predio_principal_id}),valores_nuevos:json(data),detalles:{master_modified:false,documents_copied:false,budget_changed:false}}});
    },{maxWait:10000,timeout:20000});
    return this.read(actor,kind,id);
  }
}
