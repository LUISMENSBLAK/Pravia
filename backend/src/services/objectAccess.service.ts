import type { Request } from 'express';
import prisma from '../config/prisma';
import { expedienteAccessWhere } from '../middleware/auth.middleware';

type AuthUser = NonNullable<Request['user']>;

const hasGlobalRead = (user: AuthUser) => ['DIRECCION', 'ADMINISTRACION', 'CONSULTA'].includes(user.rol);
const canOperateCommercialCatalog = (user: AuthUser) => user.rol === 'RECEPCION';

export const prospectoObjectWhere = (user: AuthUser) =>
  hasGlobalRead(user) || canOperateCommercialCatalog(user) ? {} : { user_id: user.id };

export const cotizacionObjectWhere = (user: AuthUser) =>
  hasGlobalRead(user) || canOperateCommercialCatalog(user) ? {} : { user_id: user.id };

export const comparecienteObjectWhere = (user: AuthUser) => {
  if (hasGlobalRead(user)) return {};
  const expedienteScope = expedienteAccessWhere(user);
  return {
    OR: [
      { creado_por_id: user.id },
      { expedientes: { some: { expediente: expedienteScope } } },
      { representacionesComoRepresentante: { some: { expediente: expedienteScope } } },
      { representacionesComoRepresentado: { some: { expediente: expedienteScope } } },
    ],
  };
};

export async function canAccessProspecto(user: AuthUser, id: string) {
  if (hasGlobalRead(user) || canOperateCommercialCatalog(user)) return true;
  return Boolean(await prisma.prospecto.findFirst({ where: { id, archived_at: null, ...prospectoObjectWhere(user) }, select: { id: true } }));
}

export async function canAccessCotizacion(user: AuthUser, id: string) {
  if (hasGlobalRead(user) || canOperateCommercialCatalog(user)) return true;
  return Boolean(await prisma.cotizacion.findFirst({ where: { id, ...cotizacionObjectWhere(user) }, select: { id: true } }));
}

export async function canAccessCompareciente(user: AuthUser, id: string) {
  if (hasGlobalRead(user)) return true;
  return Boolean(await prisma.compareciente.findFirst({
    where: {
      id,
      archived_at: null,
      ...comparecienteObjectWhere(user),
    },
    select: { id: true },
  }));
}

export async function canAccessDocumento(user: AuthUser, id: string) {
  if (hasGlobalRead(user)) return true;
  const document = await prisma.documento.findUnique({
    where: { id },
    select: {
      id: true,
      subido_por_id: true,
      prospecto_id: true,
      cotizacion_id: true,
      expediente_id: true,
      compareciente_id: true,
      prospectoVinculos: { where: { estatus: 'ACTIVO' }, select: { prospecto_id: true } },
      cotizacionVinculos: { where: { estatus: 'ACTIVO' }, select: { cotizacion_id: true } },
      expedienteVinculos: { where: { estatus: 'ACTIVO' }, select: { expediente_id: true } },
      comparecienteVinculos: { where: { estatus: 'ACTIVO' }, select: { compareciente_id: true } },
    },
  });
  if (!document) return false;
  if (document.subido_por_id === user.id) return true;

  const prospectIds = [document.prospecto_id, ...document.prospectoVinculos.map((link) => link.prospecto_id)].filter(Boolean) as string[];
  const quoteIds = [document.cotizacion_id, ...document.cotizacionVinculos.map((link) => link.cotizacion_id)].filter(Boolean) as string[];
  const expedienteIds = [document.expediente_id, ...document.expedienteVinculos.map((link) => link.expediente_id)].filter(Boolean) as string[];
  const comparecienteIds = [document.compareciente_id, ...document.comparecienteVinculos.map((link) => link.compareciente_id)].filter(Boolean) as string[];

  if ((await Promise.all(prospectIds.map((recordId) => canAccessProspecto(user, recordId)))).some(Boolean)) return true;
  if ((await Promise.all(quoteIds.map((recordId) => canAccessCotizacion(user, recordId)))).some(Boolean)) return true;
  if ((await Promise.all(comparecienteIds.map((recordId) => canAccessCompareciente(user, recordId)))).some(Boolean)) return true;
  if (expedienteIds.length) {
    const accessible = await prisma.expediente.findFirst({
      where: { id: { in: expedienteIds }, archived_at: null, ...expedienteAccessWhere(user) },
      select: { id: true },
    });
    if (accessible) return true;
  }
  return false;
}

export async function canAttachDocumento(user: AuthUser, targets: {
  prospecto_id?: string | null;
  cotizacion_id?: string | null;
  expediente_id?: string | null;
  compareciente_id?: string | null;
}) {
  if (targets.prospecto_id && !(await canAccessProspecto(user, targets.prospecto_id))) return false;
  if (targets.cotizacion_id && !(await canAccessCotizacion(user, targets.cotizacion_id))) return false;
  if (targets.compareciente_id && !(await canAccessCompareciente(user, targets.compareciente_id))) return false;
  if (targets.expediente_id) {
    const record = await prisma.expediente.findFirst({
      where: { id: targets.expediente_id, archived_at: null, ...expedienteAccessWhere(user) },
      select: { id: true },
    });
    if (!record) return false;
  }
  return true;
}

export async function canAccessAltaSession(user: AuthUser, sessionId: string) {
  const elevated = ['DIRECCION', 'ADMINISTRACION'].includes(user.rol);
  return Boolean(await prisma.comparecienteAltaSession.findFirst({
    where: { id: sessionId, archived_at: null, ...(elevated ? {} : { usuario_id: user.id }) },
    select: { id: true },
  }));
}

export async function canAccessAltaCarga(user: AuthUser, sessionId: string, cargaId: string) {
  if (!(await canAccessAltaSession(user, sessionId))) return false;
  return Boolean(await prisma.cargaTemporalDocumento.findFirst({
    where: { id: cargaId, alta_session_id: sessionId, archived_at: null },
    select: { id: true },
  }));
}
