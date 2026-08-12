import type { ExpedienteEstatus, Role, TareaExternaEstatus } from '@prisma/client';
import { ExpedienteWorkflowError } from './expedienteWorkflow';

export interface DeliveryItemInput {
  documento_id: string;
  tipo: 'DOCUMENTO' | 'TESTIMONIO' | 'COPIA';
  cantidad: number;
}

export interface DeliveryInput {
  receptor_nombre: string;
  receptor_caracter: string;
  fecha_efectiva: Date;
  medio: string;
  evidencia_documento_id: string;
  items: DeliveryItemInput[];
  observaciones?: string;
}

const requiredText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

export function validateDeliveryInput(input: DeliveryInput, activeDocumentIds: Set<string>, now = new Date()) {
  if (!requiredText(input.receptor_nombre) || !requiredText(input.receptor_caracter) || !requiredText(input.medio)) {
    throw new ExpedienteWorkflowError('Completa el receptor, su carácter y el medio de entrega.', 'EXPEDIENTE_DELIVERY_RECIPIENT_REQUIRED');
  }
  if (!(input.fecha_efectiva instanceof Date) || Number.isNaN(input.fecha_efectiva.getTime()) || input.fecha_efectiva.getTime() > now.getTime() + 5 * 60_000) {
    throw new ExpedienteWorkflowError('Registra una fecha efectiva válida que no esté en el futuro.', 'EXPEDIENTE_DELIVERY_DATE_INVALID');
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ExpedienteWorkflowError('Indica al menos un documento, testimonio o copia entregada.', 'EXPEDIENTE_DELIVERY_ITEMS_REQUIRED');
  }
  const validTypes = new Set(['DOCUMENTO', 'TESTIMONIO', 'COPIA']);
  if (input.items.some((item) => !activeDocumentIds.has(item.documento_id) || !validTypes.has(item.tipo) || !Number.isInteger(item.cantidad) || item.cantidad < 1)) {
    throw new ExpedienteWorkflowError('La relación de documentos entregados contiene datos inválidos o ajenos al expediente.', 'EXPEDIENTE_DELIVERY_ITEMS_INVALID');
  }
  if (!requiredText(input.evidencia_documento_id) || !activeDocumentIds.has(input.evidencia_documento_id)) {
    throw new ExpedienteWorkflowError('Selecciona un acuse o evidencia vigente del expediente.', 'EXPEDIENTE_DELIVERY_EVIDENCE_REQUIRED');
  }
}

export function assertSpecializedTransition(role: Role, current: ExpedienteEstatus, target?: ExpedienteEstatus) {
  if (!target || current === target) return;
  if (role === 'RECEPCION' && (current !== 'LISTO_ENTREGA' || target !== 'ENTREGADO')) {
    throw new ExpedienteWorkflowError('Recepción solo puede registrar la entrega final de un expediente listo.', 'EXPEDIENTE_DELIVERY_TRANSITION_DENIED', 403);
  }
  if (role === 'GESTORIA') {
    const allowed = (current === 'FIRMADO' && target === 'POST_FIRMA')
      || (current === 'POST_FIRMA' && target === 'LISTO_ENTREGA');
    if (!allowed) {
      throw new ExpedienteWorkflowError('Gestoría solo puede avanzar el seguimiento postfirma por su secuencia autorizada.', 'EXPEDIENTE_POSTFIRMA_TRANSITION_DENIED', 403);
    }
  }
}

export function assertPostfirmaReadyForDelivery(
  tasks: Array<{ estatus: TareaExternaEstatus }>,
  requirements: Array<{ obligatorio: boolean; validado: boolean; omitido: boolean }>,
) {
  if (tasks.length === 0) {
    throw new ExpedienteWorkflowError('Registra al menos un trámite postfirma antes de marcar el expediente listo para entrega.', 'EXPEDIENTE_POSTFIRMA_TASK_REQUIRED');
  }
  if (tasks.some((task) => task.estatus !== 'COMPLETADA')) {
    throw new ExpedienteWorkflowError('Concluye todos los trámites postfirma antes de marcar el expediente listo para entrega.', 'EXPEDIENTE_POSTFIRMA_TASKS_PENDING');
  }
  if (requirements.some((requirement) => requirement.obligatorio && !requirement.validado && !requirement.omitido)) {
    throw new ExpedienteWorkflowError('Aún hay requisitos documentales obligatorios pendientes.', 'EXPEDIENTE_POSTFIRMA_REQUIREMENTS_PENDING');
  }
}
