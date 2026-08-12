import prisma from '../config/prisma';

export const logAudit = async (
  userId: string,
  accion: string,
  entidad: string,
  entidadId: string,
  detalles?: any
) => {
  try {
    await prisma.auditLog.create({
      data: {
        user_id: userId,
        accion,
        entidad,
        entidad_id: entidadId,
        detalles: detalles ? JSON.stringify(detalles) : undefined,
      },
    });
  } catch (error) {
    console.error('Error writing to AuditLog:', error);
  }
};
