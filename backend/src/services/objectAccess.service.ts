import type { Request } from 'express';
import prisma from '../config/prisma';
import { expedienteAccessWhere } from '../middleware/auth.middleware';

type AuthUser = NonNullable<Request['user']>;

const hasGlobalRead = (user: AuthUser) => ['DIRECCION', 'ADMINISTRACION', 'CONSULTA'].includes(user.rol);
const hasGlobalFinanceRead = (user: AuthUser) => hasGlobalRead(user) || user.rol === 'FINANCIERO';
const hasOrganizationWrite = (user: AuthUser) => ['DIRECCION', 'ADMINISTRACION'].includes(user.rol);

// Shared records are readable by members with the module's read permission.
// Assignment remains a separate write concern, not a visibility filter.
export const prospectoReadWhere = (user: AuthUser) => ({ organization_id: user.organizationId });
export const cotizacionReadWhere = (user: AuthUser) => ({ organization_id: user.organizationId });

export const prospectoObjectWhere = (user: AuthUser) =>
  ({
    organization_id: user.organizationId,
    ...(hasOrganizationWrite(user) ? {} : { OR: [
      { user_id: user.id },
      { collaborators: { some: { organization_id: user.organizationId, user_id: user.id, active: true } } },
    ] }),
  });

export const cotizacionObjectWhere = (user: AuthUser) =>
  ({
    organization_id: user.organizationId,
    ...(hasOrganizationWrite(user) ? {} : { OR: [
      { user_id: user.id },
      { collaborators: { some: { organization_id: user.organizationId, user_id: user.id, active: true } } },
    ] }),
  });

export const comparecienteObjectWhere = (user: AuthUser) => {
  void user;
  return {};
};

export const predioObjectWhere = (user: AuthUser) => {
  void user;
  return {};
};

export async function canReadProspecto(user: AuthUser, id: string) {
  if (!user.permissions.includes('prospectos.read')) return false;
  return Boolean(await prisma.prospecto.findFirst({ where: { id, archived_at: null, ...prospectoReadWhere(user) }, select: { id: true } }));
}

export async function canReadCotizacion(user: AuthUser, id: string) {
  if (!user.permissions.includes('cotizaciones.read')) return false;
  return Boolean(await prisma.cotizacion.findFirst({ where: { id, ...cotizacionReadWhere(user) }, select: { id: true } }));
}

export async function canAccessProspecto(user: AuthUser, id: string) {
  return Boolean(await prisma.prospecto.findFirst({ where: { id, archived_at: null, ...prospectoObjectWhere(user) }, select: { id: true } }));
}

export async function canAccessCotizacion(user: AuthUser, id: string) {
  return Boolean(await prisma.cotizacion.findFirst({ where: { id, ...cotizacionObjectWhere(user) }, select: { id: true } }));
}

export async function canAccessCompareciente(user: AuthUser, id: string) {
  return Boolean(await prisma.compareciente.findFirst({
    where: {
      id, organization_id: user.organizationId,
      archived_at: null,
      ...comparecienteObjectWhere(user),
    },
    select: { id: true },
  }));
}

export async function canAccessPredio(user: AuthUser, id: string) {
  return Boolean(await prisma.predio.findFirst({
    where: { id, organization_id: user.organizationId, archived_at: null, ...predioObjectWhere(user) },
    select: { id: true },
  }));
}

export async function canAccessDocumento(user: AuthUser, id: string) {
  const document = await prisma.documento.findFirst({
    where: { id, organization_id: user.organizationId },
    select: {
      id: true,
      subido_por_id: true,
      prospecto_id: true,
      cotizacion_id: true,
      expediente_id: true,
      compareciente_id: true,
      prospectoVinculos: { where: { estatus: 'ACTIVO' }, select: { prospecto_id: true } },
      fuentesNotarialesProspecto: { select: { prospecto_id: true } },
      cotizacionVinculos: { where: { estatus: 'ACTIVO' }, select: { cotizacion_id: true } },
      expedienteVinculos: { where: { estatus: 'ACTIVO' }, select: { expediente_id: true } },
      comparecienteVinculos: { where: { estatus: 'ACTIVO' }, select: { compareciente_id: true } },
      movimientoVinculos: { where: { estatus: 'ACTIVO' }, select: { movimiento_id: true } },
      predioVinculos: { where: { estatus: 'ACTIVO' }, select: { predio_id: true } },
    },
  });
  if (!document) return false;
  if (hasGlobalRead(user)) return true;
  if (document.subido_por_id === user.id) return true;

  const prospectIds = [document.prospecto_id, ...document.prospectoVinculos.map((link) => link.prospecto_id), ...(document.fuentesNotarialesProspecto ?? []).map((source) => source.prospecto_id)].filter(Boolean) as string[];
  const quoteIds = [document.cotizacion_id, ...document.cotizacionVinculos.map((link) => link.cotizacion_id)].filter(Boolean) as string[];
  const expedienteIds = [document.expediente_id, ...document.expedienteVinculos.map((link) => link.expediente_id)].filter(Boolean) as string[];
  const comparecienteIds = [document.compareciente_id, ...document.comparecienteVinculos.map((link) => link.compareciente_id)].filter(Boolean) as string[];
  const movementIds = document.movimientoVinculos.map((link) => link.movimiento_id);
  const predioIds = document.predioVinculos.map((link) => link.predio_id);

  if ((await Promise.all(prospectIds.map((recordId) => canReadProspecto(user, recordId)))).some(Boolean)) return true;
  if ((await Promise.all(quoteIds.map((recordId) => canReadCotizacion(user, recordId)))).some(Boolean)) return true;
  if (user.permissions.includes('comparecientes.read') && (await Promise.all(comparecienteIds.map((recordId) => canAccessCompareciente(user, recordId)))).some(Boolean)) return true;
  if (expedienteIds.length && user.permissions.includes('expedientes.read')) {
    const accessible = await prisma.expediente.findFirst({
      where: { id: { in: expedienteIds }, organization_id: user.organizationId, archived_at: null },
      select: { id: true },
    });
    if (accessible) return true;
  }
  if (user.permissions.includes('expedientes.read') && (await Promise.all(predioIds.map((recordId) => canAccessPredio(user, recordId)))).some(Boolean)) return true;
  if (movementIds.length && user.permissions.includes('finanzas.read') && user.permissions.includes('documentos.read')) {
    const accessible = await prisma.movimientoFinanciero.findFirst({
      where: {
        id: { in: movementIds },
        organization_id: user.organizationId,
        ...(hasGlobalFinanceRead(user) ? {} : {
          OR: [
            { expediente_id: null },
            { expediente: expedienteAccessWhere(user) },
          ],
        }),
      },
      select: { id: true },
    });
    if (accessible) return true;
  }
  return false;
}

// The generic Documento mutation endpoints only alter a direct Cotización link.
// Reading a colleague's document must not authorize unlinking that quote.
export async function canModifyDocumento(user: AuthUser, id: string) {
  if (!user.permissions.includes('documentos.unlink')) return false;
  const document = await prisma.documento.findFirst({
    where: { id, organization_id: user.organizationId },
    select: { cotizacion_id: true },
  });
  return Boolean(document?.cotizacion_id && await canAccessCotizacion(user, document.cotizacion_id));
}

export async function canAttachDocumento(user: AuthUser, targets: {
  prospecto_id?: string | null;
  cotizacion_id?: string | null;
  expediente_id?: string | null;
  compareciente_id?: string | null;
  movimiento_id?: string | null;
  predio_id?: string | null;
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
  if (targets.movimiento_id) {
    if (!user.permissions.includes('finanzas.write') || !user.permissions.includes('documentos.write')) return false;
    const record = await prisma.movimientoFinanciero.findFirst({
      where: {
        id: targets.movimiento_id,
        organization_id: user.organizationId,
        ...(hasGlobalFinanceRead(user) ? {} : {
          OR: [
            { expediente_id: null },
            { expediente: expedienteAccessWhere(user) },
          ],
        }),
      },
      select: { id: true },
    });
    if (!record) return false;
  }
  if (targets.predio_id && !(await canAccessPredio(user, targets.predio_id))) return false;
  return true;
}

export async function canAccessAltaSession(user: AuthUser, sessionId: string) {
  const elevated = ['DIRECCION', 'ADMINISTRACION'].includes(user.rol);
  return Boolean(await prisma.comparecienteAltaSession.findFirst({
    where: { id: sessionId, organization_id: user.organizationId, archived_at: null, ...(elevated ? {} : { usuario_id: user.id }) },
    select: { id: true },
  }));
}

export async function canAccessAltaCarga(user: AuthUser, sessionId: string, cargaId: string) {
  if (!(await canAccessAltaSession(user, sessionId))) return false;
  return Boolean(await prisma.cargaTemporalDocumento.findFirst({
    where: { id: cargaId, alta_session_id: sessionId, organization_id: user.organizationId, archived_at: null },
    select: { id: true },
  }));
}
