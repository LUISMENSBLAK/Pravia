import { PrismaClient, ExpedienteEstatus, Role, Prisma } from '@prisma/client';
import { ExpedienteProgressService } from './expedienteProgress.service';
import { assertExpedienteTransition, ExpedienteWorkflowError } from '../domain/expedienteWorkflow';
import {
  assertPostfirmaReadyForDelivery,
  assertSpecializedTransition,
  DeliveryInput,
  validateDeliveryInput,
} from '../domain/expedienteAuthorization';

export interface TransicionPayload {
  expedienteId: string;
  versionActual: number;
  nuevoEstatus?: ExpedienteEstatus;
  nuevaEtapaClave?: string;
  actorUserId: string;
  correlationId?: string;
  observaciones?: string;
  fechaEfectiva?: Date;
  datosFirma?: {
    fechaFirma: Date;
    lugar: string;
    autorizaSaldoPendiente?: boolean;
  };
  entrega?: DeliveryInput;
}

export interface ReabrirPayload {
  expedienteId: string;
  versionActual: number;
  actorUserId: string;
  motivoReapertura: string;
  nuevoEstatus?: ExpedienteEstatus;
  correlationId?: string;
}

export class ExpedienteWorkflowService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Ejecuta la transición de estado o etapa de forma atómica y con control de concurrencia optimista
   */
  public async ejecutarTransicion(payload: TransicionPayload) {
    const correlationId = payload.correlationId || crypto.randomUUID();

    // 1. Obtener y verificar usuario autenticado en BD
    const actorUser = await this.prisma.user.findUnique({
      where: { id: payload.actorUserId }
    });
    if (!actorUser || !actorUser.activo) {
      throw new Error('Usuario autenticado no válido o inactivo');
    }

    return await this.prisma.$transaction(async (tx) => {
      // 2. Cargar Expediente
      const exp = await tx.expediente.findUnique({
        where: { id: payload.expedienteId },
        include: {
          requisitos_docs: true,
          comparecientes: { include: { compareciente: true } },
          cotizacion: true,
          flujoVersion: true,
          expedienteDocumentos: { where: { estatus: 'ACTIVO' }, select: { documento_id: true } },
          tareas_externas: { select: { estatus: true } },
        }
      });

      if (!exp) {
        throw new Error('Expediente no encontrado');
      }

      // 3. Validar la secuencia determinística de estados.
      if (payload.nuevoEstatus && payload.nuevoEstatus !== exp.estatus) {
        assertExpedienteTransition(exp.estatus, payload.nuevoEstatus);
      } else if (!payload.nuevaEtapaClave) {
        throw new ExpedienteWorkflowError('La transición no contiene un cambio de estado o etapa.', 'EXPEDIENTE_TRANSITION_EMPTY');
      }

      // 4. Validar matriz de permisos por rol autenticado
      assertSpecializedTransition(actorUser.rol, exp.estatus, payload.nuevoEstatus);

      // 5. Validar exclusivamente contra la versión congelada del flujo.
      let flujoEtapaSnapshot: any = null;
      if (payload.nuevaEtapaClave) {
        const frozenStages = Array.isArray(exp.flujoVersion?.etapas_json)
          ? exp.flujoVersion.etapas_json as Array<Record<string, any>>
          : [];
        flujoEtapaSnapshot = frozenStages.find((stage) => stage.clave === payload.nuevaEtapaClave);

        if (!flujoEtapaSnapshot) {
          throw new ExpedienteWorkflowError(
            `La etapa '${payload.nuevaEtapaClave}' no pertenece a la versión de flujo congelada del expediente.`,
            'EXPEDIENTE_FROZEN_STAGE_NOT_FOUND',
            409,
          );
        }

        const effectiveStatus = payload.nuevoEstatus || exp.estatus;
        const frozenStatus = flujoEtapaSnapshot.estado || flujoEtapaSnapshot.estado_general_relacionado;
        if (frozenStatus !== effectiveStatus) {
          throw new ExpedienteWorkflowError(
            `La etapa '${flujoEtapaSnapshot.nombre}' no corresponde al estado seleccionado.`,
            'EXPEDIENTE_STAGE_STATUS_MISMATCH',
            409,
          );
        }

        if (exp.expediente_etapa_actual_id) {
          const currentStage = await tx.expedienteEtapa.findUnique({ where: { id: exp.expediente_etapa_actual_id } });
          if (currentStage && flujoEtapaSnapshot.orden <= currentStage.orden_snapshot) {
            throw new ExpedienteWorkflowError('No se puede regresar o repetir una etapa por el flujo ordinario.', 'EXPEDIENTE_STAGE_BACKWARD', 409);
          }
          if (currentStage) {
            const mandatoryBetween = frozenStages.filter((stage) =>
              Number(stage.orden) > currentStage.orden_snapshot
              && Number(stage.orden) < Number(flujoEtapaSnapshot.orden)
              && stage.obligatoria === true
              && stage.se_puede_omitir !== true,
            ).length;
            if (mandatoryBetween > 0) {
              throw new ExpedienteWorkflowError(
                `Hay ${mandatoryBetween} etapa(s) obligatoria(s) antes de '${flujoEtapaSnapshot.nombre}'.`,
                'EXPEDIENTE_STAGE_SKIP_NOT_ALLOWED',
                409,
              );
            }
          }
        }
      }

      // 6. Regla especial y checklist de Firma Programada
      if (payload.nuevoEstatus === 'FIRMA_PROGRAMADA') {
        this.validarRequisitosFirma(exp, payload.datosFirma);
      }
      if (payload.nuevoEstatus === 'LISTO_ENTREGA') {
        assertPostfirmaReadyForDelivery(
          exp.tareas_externas,
          exp.requisitos_docs.map((item) => ({
            obligatorio: item.obligatorio,
            validado: item.estatus === 'VALIDADO',
            omitido: item.estatus === 'OMITIDO_JUSTIFICADO',
          })),
        );
      }
      if (payload.nuevoEstatus === 'ENTREGADO') {
        if (!payload.entrega) {
          throw new ExpedienteWorkflowError('Registra la entrega desde la acción de entrega final.', 'EXPEDIENTE_DELIVERY_DATA_REQUIRED');
        }
        validateDeliveryInput(payload.entrega, new Set(exp.expedienteDocumentos.map((item) => item.documento_id)));
      }
      if (payload.nuevoEstatus && ['FIRMADO', 'ENTREGADO'].includes(payload.nuevoEstatus) && !payload.fechaEfectiva) {
        throw new ExpedienteWorkflowError(
          'Registra la fecha efectiva en que ocurrió la firma o entrega.',
          'EXPEDIENTE_EFFECTIVE_DATE_REQUIRED',
        );
      }

      // 7. Cerrar etapa actual e instanciar la nueva etapa operativa
      let nuevaEtapaInstanciaId = exp.expediente_etapa_actual_id;
      let nuevaEtapaNombre = exp.etapa_actual_nombre;

      if (flujoEtapaSnapshot) {
        if (exp.expediente_etapa_actual_id) {
          const etapaActual = await tx.expedienteEtapa.findUnique({
            where: { id: exp.expediente_etapa_actual_id }
          });
          if (etapaActual) {
            const now = new Date();
            const duracionMs = now.getTime() - new Date(etapaActual.fecha_inicio).getTime();
            const duracionDiasNaturales = Number((duracionMs / (1000 * 60 * 60 * 24)).toFixed(2));
            const duracionHoras = Number((duracionMs / (1000 * 60 * 60)).toFixed(2));

            await tx.expedienteEtapa.update({
              where: { id: etapaActual.id },
              data: {
                fecha_fin: now,
                duracion_dias_naturales: duracionDiasNaturales,
                duracion_horas: duracionHoras,
                completada: true
              }
            });

            // Emitir evento de etapa concluida
            await this.registrarEventoOutbox(tx, {
              eventId: crypto.randomUUID(),
              eventType: 'EtapaExpedienteConcluida',
              aggregateId: exp.id,
              actorUserId: actorUser.id,
              correlationId,
              payload: { etapaClave: etapaActual.clave_snapshot, duracionDiasNaturales }
            });
          }
        }

        const nuevaEtapa = await tx.expedienteEtapa.create({
          data: {
            expediente_id: exp.id,
            flujo_etapa_id: null,
            flujo_version_id: exp.flujo_version_id,
            clave_snapshot: flujoEtapaSnapshot.clave,
            nombre_snapshot: flujoEtapaSnapshot.nombre,
            orden_snapshot: flujoEtapaSnapshot.orden,
            duracion_esperada_snapshot: flujoEtapaSnapshot.duracion ?? flujoEtapaSnapshot.duracion_esperada_dias,
            responsable_id: actorUser.id,
            observaciones: payload.observaciones
          }
        });

        nuevaEtapaInstanciaId = nuevaEtapa.id;
        nuevaEtapaNombre = flujoEtapaSnapshot.nombre;

        // Emitir evento de etapa iniciada
        await this.registrarEventoOutbox(tx, {
          eventId: crypto.randomUUID(),
          eventType: 'EtapaExpedienteIniciada',
          aggregateId: exp.id,
          actorUserId: actorUser.id,
          correlationId,
          payload: { etapaClave: flujoEtapaSnapshot.clave, etapaNombre: flujoEtapaSnapshot.nombre }
        });
      }

      // 8. Control de Concurrencia Optimista (WHERE version = versionActual)
      const updateResult = await tx.expediente.updateMany({
        where: {
          id: exp.id,
          version: payload.versionActual
        },
        data: {
          version: payload.versionActual + 1,
          estatus: payload.nuevoEstatus || exp.estatus,
          expediente_etapa_actual_id: nuevaEtapaInstanciaId,
          etapa_actual_nombre: nuevaEtapaNombre,
          fecha_estimada_firma: payload.datosFirma?.fechaFirma || exp.fecha_estimada_firma,
          fecha_real_firma: payload.nuevoEstatus === 'FIRMADO' ? payload.fechaEfectiva : exp.fecha_real_firma,
          fecha_entrega_cliente: payload.nuevoEstatus === 'ENTREGADO' ? payload.fechaEfectiva : exp.fecha_entrega_cliente,
          datos_operacion: payload.datosFirma?.lugar
            ? {
                ...((exp.datos_operacion && typeof exp.datos_operacion === 'object' && !Array.isArray(exp.datos_operacion))
                  ? exp.datos_operacion as Record<string, Prisma.JsonValue>
                  : {}),
                firma: {
                  fecha_programada: payload.datosFirma.fechaFirma.toISOString(),
                  lugar: payload.datosFirma.lugar.trim(),
                  saldo_pendiente_autorizado: Boolean(payload.datosFirma.autorizaSaldoPendiente),
                },
              }
            : exp.datos_operacion === null
              ? Prisma.JsonNull
              : exp.datos_operacion as Prisma.InputJsonValue
        }
      });

      if (updateResult.count === 0) {
        throw new Error(`[409 CONFLICT] El expediente ha sido modificado por otro usuario (Versión esperada: ${payload.versionActual}). Por favor recargue.`);
      }

      if (payload.nuevoEstatus === 'ENTREGADO' && payload.entrega) {
        await tx.expedienteEntrega.create({
          data: {
            expediente_id: exp.id,
            receptor_nombre: payload.entrega.receptor_nombre.trim(),
            receptor_caracter: payload.entrega.receptor_caracter.trim(),
            fecha_efectiva: payload.entrega.fecha_efectiva,
            medio: payload.entrega.medio.trim(),
            items: payload.entrega.items as unknown as Prisma.InputJsonValue,
            evidencia_documento_id: payload.entrega.evidencia_documento_id,
            observaciones: payload.entrega.observaciones?.trim() || null,
            registrado_por_id: actorUser.id,
          },
        });
      }

      // 9. Calcular avances con el estado EFECTIVO post-transición dentro de la transacción
      const nuevosAvances = await ExpedienteProgressService.calcularAvances(tx, exp.id);

      const expActualizado = await tx.expediente.update({
        where: { id: exp.id },
        data: {
          avance_documental: nuevosAvances.documental,
          avance_operativo: nuevosAvances.operativo,
          avance_financiero: nuevosAvances.financiero,
          avance_general: nuevosAvances.general
        }
      });

      // 10. Registrar Actividad Operativa (para el usuario)
      await tx.expedienteActividad.create({
        data: {
          expediente_id: exp.id,
          usuario_id: actorUser.id,
          tipo: 'CAMBIO_ESTATUS',
          titulo: `Transición a ${expActualizado.estatus}`,
          descripcion: payload.observaciones || `Transición ejecutada por ${actorUser.nombre} ${actorUser.apellido}`
        }
      });

      if (payload.nuevoEstatus && payload.nuevoEstatus !== exp.estatus) {
        await tx.expedienteEstatus_Log.create({
          data: {
            expediente_id: exp.id,
            estatus_anterior: exp.estatus,
            estatus_nuevo: payload.nuevoEstatus,
            user_id: actorUser.id,
            fecha_efectiva: payload.fechaEfectiva || new Date(),
            notas: payload.observaciones?.trim() || null,
          }
        });
      }

      // 11. Registrar AuditLog Técnico Inmutable
      await tx.auditLog.create({
        data: {
          user_id: actorUser.id,
          accion: 'TRANSICION_WORKFLOW',
          entidad: 'Expediente',
          entidad_id: exp.id,
          detalles: {
            valores_anteriores: { estatus: exp.estatus, etapa: exp.etapa_actual_nombre, version: payload.versionActual },
            valores_nuevos: { estatus: expActualizado.estatus, etapa: expActualizado.etapa_actual_nombre, version: expActualizado.version },
            correlation_id: correlationId
          }
        }
      });

      // 12. Emitir eventos específicos según el resultado real
      const mainEventId = crypto.randomUUID();
      if (payload.nuevoEstatus && payload.nuevoEstatus !== exp.estatus) {
        await this.registrarEventoOutbox(tx, {
          eventId: mainEventId,
          eventType: 'EstadoExpedienteCambiado',
          aggregateId: exp.id,
          actorUserId: actorUser.id,
          correlationId,
          payload: { estatusAnterior: exp.estatus, estatusNuevo: expActualizado.estatus }
        });

        if (payload.nuevoEstatus === 'FIRMA_PROGRAMADA') {
          await this.registrarEventoOutbox(tx, {
            eventId: crypto.randomUUID(),
            eventType: 'FirmaProgramada',
            aggregateId: exp.id,
            actorUserId: actorUser.id,
            correlationId,
            payload: { fechaFirma: payload.datosFirma?.fechaFirma, lugar: payload.datosFirma?.lugar }
          });
        } else if (payload.nuevoEstatus === 'FIRMADO') {
          await this.registrarEventoOutbox(tx, {
            eventId: crypto.randomUUID(),
            eventType: 'ExpedienteFirmado',
            aggregateId: exp.id,
            actorUserId: actorUser.id,
            correlationId,
            payload: { fechaRealFirma: expActualizado.fecha_real_firma }
          });
        }
      }

      return {
        expediente: expActualizado,
        correlationId
      };
    });
  }

  /**
   * Proceso Excepcional de Reapertura de Expediente (Exclusivo DIRECCION)
   */
  public async reabrirExpediente(payload: ReabrirPayload) {
    const correlationId = payload.correlationId || crypto.randomUUID();

    const actorUser = await this.prisma.user.findUnique({
      where: { id: payload.actorUserId }
    });

    if (!actorUser || actorUser.rol !== 'DIRECCION') {
      throw new Error('Únicamente los usuarios con rol DIRECCION pueden autorizar la reapertura de expedientes');
    }

    return await this.prisma.$transaction(async (tx) => {
      const exp = await tx.expediente.findUnique({ where: { id: payload.expedienteId } });
      if (!exp) throw new Error('Expediente no encontrado');

      const updateResult = await tx.expediente.updateMany({
        where: { id: exp.id, version: payload.versionActual },
        data: {
          version: payload.versionActual + 1,
          estatus: payload.nuevoEstatus || 'EN_PROCESO'
        }
      });

      if (updateResult.count === 0) {
        throw new Error('[409 CONFLICT] Conflicto de concurrencia al reabrir el expediente.');
      }

      const expActualizado = await tx.expediente.findUnique({ where: { id: exp.id } });

      await tx.auditLog.create({
        data: {
          user_id: actorUser.id,
          accion: 'REAPERTURA_EXCEPCIONAL',
          entidad: 'Expediente',
          entidad_id: exp.id,
          detalles: {
            motivo: payload.motivoReapertura,
            estatusAnterior: exp.estatus,
            estatusNuevo: expActualizado!.estatus,
            correlation_id: correlationId
          }
        }
      });

      await this.registrarEventoOutbox(tx, {
        eventId: crypto.randomUUID(),
        eventType: 'ExpedienteReabierto',
        aggregateId: exp.id,
        actorUserId: actorUser.id,
        correlationId,
        payload: { motivo: payload.motivoReapertura, estatusNuevo: expActualizado!.estatus }
      });

      return expActualizado;
    });
  }

  private validarRequisitosFirma(exp: any, datosFirma?: any) {
    if (!datosFirma || !datosFirma.fechaFirma) {
      throw new Error('Debe especificar la fecha y hora programada para la firma');
    }

    // Verificar comparecientes requeridos
    if (!exp.comparecientes || exp.comparecientes.length === 0) {
      throw new Error('No se pueden programar la firma sin comparecientes vinculados al expediente');
    }

    const unvalidated = exp.comparecientes.filter((c: any) => !c.datos_validados);
    if (unvalidated.length > 0) {
      throw new Error(`Existen ${unvalidated.length} compareciente(s) con datos sin validar. Valide las identidades antes de programar firma.`);
    }

    // Verificar checklist obligatorio
    const reqsObligatoriosFaltantes = (exp.requisitos_docs || []).filter(
      (r: any) => r.obligatorio && r.categoria === 'FIRMA' && r.estatus !== 'VALIDADO'
    );

    if (reqsObligatoriosFaltantes.length > 0) {
      throw new Error(`Faltan ${reqsObligatoriosFaltantes.length} documento(s) obligatorios de categoría FIRMA por validar.`);
    }
  }

  private async registrarEventoOutbox(
    tx: Prisma.TransactionClient,
    event: {
      eventId: string;
      eventType: string;
      aggregateId: string;
      actorUserId: string;
      correlationId: string;
      payload: Record<string, unknown>;
    }
  ) {
    await tx.domainEventOutbox.create({
      data: {
        id: event.eventId,
        event_type: event.eventType,
        aggregate_type: 'Expediente',
        aggregate_id: event.aggregateId,
        payload: { ...event.payload, actor_user_id: event.actorUserId },
        correlation_id: event.correlationId,
        estatus: 'PENDIENTE'
      }
    });
  }
}
